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
  type YearHistoryPayload,
  type SettingsPayload,
  type SettingsRow,
} from "./supabase-sync";

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

  async init(): Promise<void> {
    try {
      this._deviceId = await getDeviceId();
      log("Device:", this._deviceId.slice(0, 8));

      const status = await checkConnection();
      this._isOnline = status === "CONNECTED";

      if (status === "CONNECTED") {
        log("Connected");
        await checkTables();
        await writeHealthCheck(this._deviceId);
        log("HealthCheck geschrieben");
        await readHealthCheck(this._deviceId);
        log("HealthCheck gelesen");
        await this.pull();
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

      if (status === "OFFLINE") {
        if (pending.length > 0) {
          log(`Flush übersprungen — offline (${pending.length} ausstehend)`);
        }
        await this._refreshStats();
        return;
      }

      if (pending.length === 0) {
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
        if (op.entity === "pos_year_history" && op.operation === "upsert") {
          try {
            await upsertYearHistory(JSON.parse(op.payload) as YearHistoryPayload);
            await ack([op.id]);
          } catch (err) {
            hadError = true;
            lastErr = err instanceof Error ? err.message : String(err);
            await markFailed(op.id);
          }
        } else if (op.entity === "pos_settings" && op.operation === "upsert") {
          try {
            await upsertSettings(JSON.parse(op.payload) as SettingsPayload);
            await ack([op.id]);
          } catch (err) {
            hadError = true;
            lastErr = err instanceof Error ? err.message : String(err);
            await markFailed(op.id);
          }
        } else {
          await ack([op.id]);
        }
      }

      this._isFlushing = false;
      if (!hadError) {
        this._stats.lastSyncAt = new Date().toISOString();
        this._stats.lastError = null;
        log("Flush beendet");
      } else {
        this._stats.lastError = lastErr;
        log("Flush beendet (Fehler)");
      }
    } catch (err) {
      this._isFlushing = false;
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
  }

  private async _applySettingsRow(row: SettingsRow): Promise<boolean> {
    const metaKey = `${row.settings_key}-meta`;
    const metaRaw = await dbGet(metaKey);
    const localMeta = metaRaw
      ? (JSON.parse(metaRaw) as { updatedAt: string })
      : null;
    if (localMeta && row.updated_at <= localMeta.updatedAt) return false;
    const payload = row.payload as SettingsPayload;
    await dbSet(row.settings_key, JSON.stringify(payload.data));
    await dbSet(
      metaKey,
      JSON.stringify({ updatedAt: row.updated_at, deviceId: row.device_id }),
    );
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
