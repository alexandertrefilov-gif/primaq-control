import { getDeviceId } from "./device-registry";
import { getNetworkMonitor } from "./network-monitor";
import { getPending, ack } from "./sync-queue";

const isDev = process.env.NODE_ENV === "development";

function log(...args: unknown[]): void {
  if (isDev) console.log("[Sync]", ...args);
}

class SyncService {
  private unsubscribeNetwork?: () => void;
  private _running = false;

  get running(): boolean {
    return this._running;
  }

  async init(): Promise<void> {
    try {
      const deviceId = await getDeviceId();
      log("Device:", deviceId.slice(0, 8));
    } catch (err) {
      log("init error:", err);
    }
  }

  async flush(): Promise<void> {
    try {
      const pending = await getPending();
      if (pending.length === 0) return;
      log(`Flush gestartet — ${pending.length} ausstehend`);
      // Phase 2.2 simulation: ack all ops without sending to Supabase.
      // Phase 2.3 replaces this with real Supabase upserts per entity type.
      await ack(pending.map((op) => op.id));
      log("Flush beendet");
    } catch (err) {
      log("flush error:", err);
    }
  }

  async pull(): Promise<void> {
    // Phase 2.3: pull remote changes from Supabase.
  }

  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;
    try {
      await this.init();
      this.unsubscribeNetwork = getNetworkMonitor().subscribe((online) => {
        if (online) void this.flush();
      });
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
