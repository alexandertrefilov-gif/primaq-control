"use client";

import { useCallback, useState } from "react";
import { useSyncStatus } from "./use-sync-status";
import { getSyncService } from "@/lib/sync/sync-service";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "Gerade eben";
  if (diff < 3_600_000) return `Vor ${Math.floor(diff / 60_000)} Min.`;
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatRow({ label, value, error }: { label: string; value: string | number; error?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-black/50">{label}</span>
      <span className={error ? "font-semibold text-red-600" : "font-semibold text-black/80"}>
        {value}
      </span>
    </div>
  );
}

export function SyncPanel() {
  const { status, stats } = useSyncStatus();
  const [flushing, setFlushing] = useState(false);

  const handleManualSync = useCallback(async () => {
    setFlushing(true);
    try {
      const service = getSyncService();
      await service.flush();
      await service.pull(); // pull after manual sync to get latest remote state
    } finally {
      setFlushing(false);
    }
  }, []);

  return (
    <div className="mt-4 rounded-2xl border border-black/8 bg-white p-5 shadow-sm">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-black/40">
        Cloud-Synchronisation
      </p>
      <p className="mb-4 text-sm text-black/50">
        Jahresdaten mit der Cloud abgleichen. Lokale Daten werden niemals überschrieben.
      </p>

      <div className="divide-y divide-black/6">
        <StatRow label="Ausstehend" value={stats.pendingCount} />
        <StatRow label="Fehlgeschlagen" value={stats.failedCount} />
        <StatRow
          label="Letzter Sync"
          value={stats.lastSyncAt ? relativeTime(stats.lastSyncAt) : "—"}
        />
        {stats.lastError && (
          <StatRow label="Letzter Fehler" value={stats.lastError} error />
        )}
      </div>

      <button
        data-testid="manual-sync-btn"
        onClick={handleManualSync}
        disabled={flushing || status === "syncing"}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primaq-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primaq-700 active:scale-[0.97] disabled:opacity-60"
      >
        {flushing || status === "syncing" ? "Synchronisiert…" : "Jetzt synchronisieren"}
      </button>
    </div>
  );
}
