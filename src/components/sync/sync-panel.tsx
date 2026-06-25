"use client";

import { useCallback, useState } from "react";
import { useAdmin } from "@/features/pos/admin-context";
import { dbRemove } from "@/lib/db";
import { getSyncService } from "@/lib/sync/sync-service";
import { useSyncStatus } from "./use-sync-status";

const COMMIT_SHORT =
  process.env.NEXT_PUBLIC_COMMIT_SHA && process.env.NEXT_PUBLIC_COMMIT_SHA !== "unknown"
    ? process.env.NEXT_PUBLIC_COMMIT_SHA.slice(0, 7)
    : null;

const SETTINGS_KEYS = [
  "primaq-pos-flavors-v1",
  "primaq-pos-flavors-v1-meta",
  "primaq-pos-layout-v1",
  "primaq-pos-layout-v1-meta",
];

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
  const { isAdmin } = useAdmin();
  const [flushing, setFlushing] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleManualSync = useCallback(async () => {
    setFlushing(true);
    try {
      const service = getSyncService();
      await service.flush();
      await service.pull();
    } finally {
      setFlushing(false);
    }
  }, []);

  const handleResetAndPull = useCallback(async () => {
    const confirmed = window.confirm(
      "Lokale POS-Einstellungen (Sorten, Layout) löschen und aus Supabase neu laden?\n\n" +
        "Jahres- und Tagesumsätze sind nicht betroffen.\n\n" +
        "Diese Aktion kann nicht rückgängig gemacht werden."
    );
    if (!confirmed) return;

    setResetting(true);
    try {
      await Promise.all(SETTINGS_KEYS.map((k) => dbRemove(k)));
      await getSyncService().pull();
      window.location.reload();
    } catch {
      setResetting(false);
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

      {isAdmin && (
        <button
          data-testid="reset-and-pull-btn"
          onClick={handleResetAndPull}
          disabled={resetting}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 active:scale-[0.97] disabled:opacity-60"
        >
          {resetting ? "Wird geladen…" : "Lokale Einstellungen zurücksetzen und neu laden"}
        </button>
      )}

      {COMMIT_SHORT && (
        <p className="mt-3 text-center text-[10px] text-black/30">Build: {COMMIT_SHORT}</p>
      )}
    </div>
  );
}
