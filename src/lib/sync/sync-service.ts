import { getDeviceId } from "./device-registry";
import { getNetworkMonitor } from "./network-monitor";
import { getPending, ack, markFailed, getQueueStats } from "./sync-queue";
import { dbGet, dbSet } from "@/lib/db";
import {
  checkConnection,
  checkTables,
  writeHealthCheck,
  readHealthCheck,
  upsertYearHistory,
  pullYearHistory,
  upsertSettings,
  pullSettings,
  upsertSalesState,
  pullSalesState,
  type YearHistoryPayload,
  type SettingsPayload,
  type SettingsRow,
  type SalesStatePayload,
  type SalesStateRow,
} from "./supabase-sync";
import { SALES_STATE_META_KEY } from "./enqueue-sales-state";

export type SyncStatus = "offline" | "idle" | "syncing" | "error" | "pending";

export interface SyncStats {
  pendingCount: number;
  failedCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

type StatusListener = (status: SyncStatus, stats: SyncStats) => void;

const isDev = process.env.NODE_ENV === "development";
const YEAR_HISTORY_KEY = "primaq-pos-year-history";

function log(...args: unknown[]): void {
  if (isDev) console.log("[Sync]", ...args);
}

/** Extracts a human-readable message from any thrown value, including Supabase PostgrestError objects. */
function extractErrorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (e.message) parts.push(String(e.message));
    if (e.code) parts.push(`[${String(e.code)}]`);
    if (e.details) parts.push(String(e.details));
    if (e.hint) parts.push(`Hint: ${String(e.hint)}`);
    if (parts.length > 0) return parts.join(" ");
    try { return JSON.stringify(e); } catch { /* ignore */ }
  }
  return String(err);
}

class SyncService {
  private unsubscribeNetwork?: () => void;
  private _running = false;
  private _deviceId: string | null = null;
  private _isOnline = false;
  private _isFlushing = false;
  private _status: SyncStatus = "offline";
  private _stats: SyncStats = {
    pendingCount: 0,
    failedCount: 0,
    lastSyncAt: null,
    lastError: null,
  };
  private _statusListeners = new Set<StatusListener>();

  get running(): boolean {
    return this._running;
  }

  get status(): SyncStatus {
    return this._status;
  }

  get stats(): SyncStats {
    return { ...this._stats };
  }

  /** Subscribe to status/stats changes. Immediately calls listener with current state. */
  subscribeStatus(listener: StatusListener): () => void {
    this._statusListeners.add(listener);
    listener(this._status, { ...this._stats });
    return () => this._statusListeners.delete(listener);
  }

  private _notify(): void {
    this._statusListeners.forEach((fn) => fn(this._status, { ...this._stats }));
  }

  private _deriveStatus(): void {
    if (!this._isOnline) {
      this._status = "offline";
    } else if (this._isFlushing) {
      this._status = "syncing";
    } else if (this._stats.failedCount > 0) {
      this._status = "error";
    } else if (this._stats.pendingCount > 0) {
      this._status = "pending";
    } else {
      this._status = "idle";
    }
  }

  private async _refreshStats(): Promise<void> {
    const { pending, failed } = await getQueueStats();
    this._stats = {
      pendingCount: pending,
      failedCount: failed,
      lastSyncAt: this._stats.lastSyncAt,
      lastError: this._stats.lastError,
    };
    this._deriveStatus();
    this._notify();
  }

  private _recordSync(): void {
    const now = new Date().toISOString();
    console.log("[Sync] recordSync", now);
    this._stats.lastSyncAt = now;
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("primaq-last-sync", now);
        // CustomEvent guarantees UI update independently of the subscription path.
        window.dispatchEvent(new CustomEvent("primaq-sync-completed", { detail: { at: now } }));
      }
    } catch { /* ignore — private/storage-blocked contexts */ }
  }

  async init(): Promise<void> {
    // Restore last sync timestamp so the UI never shows "—" after a reload.
    try {
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem("primaq-last-sync");
        if (saved) this._stats.lastSyncAt = saved;
      }
    } catch { /* ignore */ }

    try {
      this._deviceId = await getDeviceId();
      log("Device:", this._deviceId.slice(0, 8));

      const status = await checkConnection();
      this._isOnline = status === "CONNECTED";

      if (status === "CONNECTED") {
        log("Connected");
        await checkTables();
        try {
          await writeHealthCheck(this._deviceId);
          log("HealthCheck geschrieben");
          await readHealthCheck(this._deviceId);
          log("HealthCheck gelesen");
        } catch (err) {
          // sync_health table missing — non-fatal, continue with pull
          console.warn("[Sync] sync_health nicht verfügbar:", err);
        }
        await this.pull();
        this._recordSync();
      } else {
        log("Offline");
      }
    } catch (err) {
      log("init error:", err);
    }
    await this._refreshStats();
    log("Init abgeschlossen");
  }

  async flush(): Promise<void> {
    try {
      const status = await checkConnection();
      this._isOnline = status === "CONNECTED";
      const pending = await getPending();

      console.log("[SalesSync 4] flush started", `| status=${status}`, `| pending=${pending.length}`, `| entities=${pending.map((o) => o.entity).join(", ") || "–"}`);

      if (status === "OFFLINE") {
        if (pending.length > 0) {
          log(`Flush übersprungen — offline (${pending.length} ausstehend)`);
        }
        await this._refreshStats();
        return;
      }

      if (pending.length === 0) {
        this._recordSync();
        await this._refreshStats();
        return;
      }

      this._isFlushing = true;
      this._deriveStatus();
      this._notify();
      log(`Flush gestartet — ${pending.length} ausstehend`);

      let hadError = false;
      let lastErr: string | null = null;

      for (const op of pending) {
        console.log("[SalesSync 5] processing entity", op.entity, `| operation=${op.operation}`, `| id=${op.id}`);
        if (op.entity === "pos_year_history" && op.operation === "upsert") {
          try {
            await upsertYearHistory(JSON.parse(op.payload) as YearHistoryPayload);
            await ack([op.id]);
          } catch (err) {
            hadError = true;
            lastErr = extractErrorText(err);
            console.error("[Sync] Flush-Fehler pos_year_history", {
              id: op.id,
              retryCount: op.retryCount,
              payloadSize: op.payload.length,
              error: err,
            });
            await markFailed(op.id);
          }
        } else if (op.entity === "pos_settings" && op.operation === "upsert") {
          let payloadKey = "(unbekannt)";
          try {
            payloadKey = (JSON.parse(op.payload) as Record<string, unknown>).settingsKey as string ?? payloadKey;
          } catch { /* ignore parse error */ }
          try {
            await upsertSettings(JSON.parse(op.payload) as SettingsPayload);
            await ack([op.id]);
          } catch (err) {
            hadError = true;
            lastErr = extractErrorText(err);
            console.error("[Sync] Flush-Fehler settings", {
              id: op.id,
              settingsKey: payloadKey,
              retryCount: op.retryCount,
              payloadBytes: op.payload.length,
              error: err,
            });
            await markFailed(op.id);
          }
        } else if (op.entity === "pos_sales_state" && op.operation === "upsert") {
          let businessDate = "(unbekannt)";
          let parsedPayload: SalesStatePayload | null = null;
          try {
            parsedPayload = JSON.parse(op.payload) as SalesStatePayload;
            businessDate = parsedPayload.businessDate ?? businessDate;
          } catch { /* ignore parse error */ }
          console.log("[SalesSync 6] calling upsertSalesState", `| businessDate=${businessDate}`, `| orderCount=${(parsedPayload?.daily as Record<string,unknown>)?.orderCount ?? "?"}`, `| payloadBytes=${op.payload.length}`);
          try {
            await upsertSalesState(parsedPayload ?? (JSON.parse(op.payload) as SalesStatePayload));
            await ack([op.id]);
            console.log("[SalesSync 8] success | businessDate=", businessDate);
          } catch (err) {
            hadError = true;
            lastErr = extractErrorText(err);
            // SCHRITT 8 (Fehler) – Supabase hat Fehler zurückgegeben
            console.error("[Sync:8] upsertSalesState FEHLER", {
              id: op.id,
              businessDate,
              retryCount: op.retryCount,
              payloadBytes: op.payload.length,
              error: err,
            });
            await markFailed(op.id);
          }
        } else {
          await ack([op.id]);
        }
      }

      this._isFlushing = false;
      if (!hadError) {
        this._recordSync();
        this._stats.lastError = null;
        log("Flush beendet");
      } else {
        this._stats.lastError = lastErr;
        log("Flush beendet (Fehler)");
      }
    } catch (err) {
      this._isFlushing = false;
      console.error("[Sync] flush() Fehler:", err);
      log("flush error:", err);
    }
    await this._refreshStats();
  }

  async pull(): Promise<void> {
    // Pull year history (no local → remote wins; local date present → skip)
    try {
      const remote = await pullYearHistory("default");
      if (remote.length > 0) {
        const raw = await dbGet(YEAR_HISTORY_KEY);
        const local = raw
          ? (JSON.parse(raw) as Array<{ date: string }>)
          : [];
        const localDates = new Set(local.map((d) => d.date));
        const toAdd = remote
          .filter((r) => !localDates.has(r.date))
          .map((r) => r.summary as { date: string });
        if (toAdd.length > 0) {
          const merged = [...local, ...toAdd].sort((a, b) =>
            a.date.localeCompare(b.date)
          );
          await dbSet(YEAR_HISTORY_KEY, JSON.stringify(merged));
          log(`Pull: ${toAdd.length} Tage ergänzt`);
        }
      }
    } catch (err) {
      log("pull year history error:", err);
    }

    // Pull settings (Last Write Wins based on updated_at)
    try {
      const remoteSettings = await pullSettings("default");
      let updated = 0;
      for (const row of remoteSettings) {
        if (await this._applySettingsRow(row)) updated++;
      }
      if (updated > 0) log(`Pull: ${updated} Einstellungen aktualisiert`);
    } catch (err) {
      log("pull settings error:", err);
    }

    // Pull sales state for today (Last Write Wins)
    const today = new Date().toISOString().slice(0, 10);
    try {
      const remoteRow = await pullSalesState("default", today);
      if (remoteRow && (await this._applySalesStateRow(remoteRow))) {
        log("Pull: Tagesstand aktualisiert");
      }
    } catch (err) {
      log("pull sales state error:", err);
    }
  }

  private async _applySettingsRow(row: SettingsRow): Promise<boolean> {
    const metaKey = `${row.settings_key}-meta`;
    const metaRaw = await dbGet(metaKey);
    const localMeta = metaRaw
      ? (JSON.parse(metaRaw) as { updatedAt: string })
      : null;

    const localUpdatedAt = localMeta?.updatedAt ?? null;
    const cloudUpdatedAt = row.updated_at;

    if (localMeta && cloudUpdatedAt <= localUpdatedAt!) {
      // Always log this decision so it's visible in DevTools on any device
      console.log(
        `[Sync] _applySettingsRow SKIP ${row.settings_key}`,
        `| cloud=${cloudUpdatedAt}`,
        `| local=${localUpdatedAt}`,
        "| Lokal ist neuer oder gleich — kein Überschreiben"
      );
      return false;
    }

    console.log(
      `[Sync] _applySettingsRow APPLY ${row.settings_key}`,
      `| cloud=${cloudUpdatedAt}`,
      `| local=${localUpdatedAt ?? "null (kein Meta)"}`
    );

    await dbSet(row.settings_key, JSON.stringify(row.data));
    await dbSet(metaKey, JSON.stringify({ updatedAt: cloudUpdatedAt }));
    return true;
  }

  private async _applySalesStateRow(row: SalesStateRow): Promise<boolean> {
    const metaRaw = await dbGet(SALES_STATE_META_KEY);
    const localMeta = metaRaw
      ? (JSON.parse(metaRaw) as { updatedAt: string })
      : null;

    const localPosRaw = await dbGet("primaq-pos-state");
    const localPos = localPosRaw
      ? (JSON.parse(localPosRaw) as { cart: unknown; daily: Record<string, unknown> })
      : null;
    const localOrderCount = localPos?.daily?.orderCount ?? 0;
    const cloudData = row.data as Record<string, unknown>;
    const cloudOrderCount = cloudData?.orderCount ?? "?";

    if (localMeta && row.updated_at <= localMeta.updatedAt) {
      console.log(
        `[Sync] _applySalesStateRow SKIP ${row.business_date}`,
        `| cloud.updated_at=${row.updated_at}`,
        `| local.updatedAt=${localMeta.updatedAt}`,
        `| cloud.orderCount=${cloudOrderCount}`,
        `| local.orderCount=${localOrderCount}`,
        `| reason=cloud<=local`,
      );
      return false;
    }

    console.log(
      `[Sync] _applySalesStateRow APPLY ${row.business_date}`,
      `| cloud.updated_at=${row.updated_at}`,
      `| local.updatedAt=${localMeta?.updatedAt ?? "null"}`,
      `| cloud.orderCount=${cloudOrderCount}`,
      `| local.orderCount.before=${localOrderCount}`,
    );

    // Preserve the active cart — only replace daily
    await dbSet(
      "primaq-pos-state",
      JSON.stringify({ cart: localPos?.cart ?? [], daily: row.data }),
    );
    await dbSet(SALES_STATE_META_KEY, JSON.stringify({ updatedAt: row.updated_at }));

    console.log(
      `[Sync] _applySalesStateRow DONE ${row.business_date}`,
      `| local.orderCount.after=${cloudOrderCount}`,
    );

    // Notify use-pos-store to re-render — IDB was updated but React state is not
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("primaq-pos-state-synced", { detail: { daily: row.data } }),
      );
    }

    return true;
  }

  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;
    try {
      await this.init();
      // Guard: don't subscribe again if stop() was called during async init()
      // or if a concurrent start() (React strict-mode double-mount) already subscribed.
      if (this._running && !this.unsubscribeNetwork) {
        this.unsubscribeNetwork = getNetworkMonitor().subscribe((online) => {
          this._isOnline = online;
          if (online) {
            void this.flush();
          } else {
            this._deriveStatus();
            this._notify();
          }
        });
      }
    } catch (err) {
      log("start error:", err);
    }
  }

  stop(): void {
    this._running = false;
    this.unsubscribeNetwork?.();
    this.unsubscribeNetwork = undefined;
  }
}

// Lazy singleton — mirrors the Dexie and NetworkMonitor pattern.
let _service: SyncService | undefined;

export function getSyncService(): SyncService {
  if (!_service) _service = new SyncService();
  return _service;
}
