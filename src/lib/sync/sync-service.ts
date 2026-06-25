import { getDeviceId } from "./device-registry";
import { getNetworkMonitor } from "./network-monitor";
import { getPending, ack, markFailed } from "./sync-queue";
import {
  checkConnection,
  checkTables,
  writeHealthCheck,
  readHealthCheck,
  upsertYearHistory,
  type YearHistoryPayload,
} from "./supabase-sync";

const isDev = process.env.NODE_ENV === "development";

function log(...args: unknown[]): void {
  if (isDev) console.log("[Sync]", ...args);
}

class SyncService {
  private unsubscribeNetwork?: () => void;
  private _running = false;
  private _deviceId: string | null = null;

  get running(): boolean {
    return this._running;
  }

  async init(): Promise<void> {
    try {
      this._deviceId = await getDeviceId();
      log("Device:", this._deviceId.slice(0, 8));

      const status = await checkConnection();
      if (status === "CONNECTED") {
        log("Connected");
        await checkTables();
        await writeHealthCheck(this._deviceId);
        log("HealthCheck geschrieben");
        await readHealthCheck(this._deviceId);
        log("HealthCheck gelesen");
      } else {
        log("Offline");
      }
    } catch (err) {
      log("init error:", err);
    }
  }

  async flush(): Promise<void> {
    try {
      const status = await checkConnection();
      const pending = await getPending();

      if (status === "OFFLINE") {
        if (pending.length > 0) {
          log(`Flush übersprungen — offline (${pending.length} ausstehend)`);
        }
        return; // Queue bleibt vollständig erhalten.
      }

      if (pending.length === 0) return;
      log(`Flush gestartet — ${pending.length} ausstehend`);

      for (const op of pending) {
        if (op.entity === "pos_year_history" && op.operation === "upsert") {
          try {
            await upsertYearHistory(JSON.parse(op.payload) as YearHistoryPayload);
            await ack([op.id]);
          } catch {
            await markFailed(op.id);
          }
        } else {
          // Unknown or test entities — ack without Supabase write.
          await ack([op.id]);
        }
      }

      log("Flush beendet");
    } catch (err) {
      log("flush error:", err);
    }
  }

  async pull(): Promise<void> {
    // Phase 2.4: pull remote changes from Supabase.
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
          if (online) void this.flush();
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
