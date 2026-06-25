"use client";

import { useEffect, useState } from "react";
import { useSyncStatus } from "@/components/sync/use-sync-status";

const STATUS_LABELS: Record<string, string> = {
  offline: "Offline",
  idle: "Bereit",
  syncing: "Synchronisiert…",
  error: "Fehler",
  pending: "Ausstehend",
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 text-sm">
      <span className="w-24 shrink-0 text-black/40">{label}</span>
      <span className="text-black/80">{value}</span>
    </div>
  );
}

export function VersionRuntime() {
  const [idbAvailable, setIdbAvailable] = useState<boolean | null>(null);
  const { status } = useSyncStatus();

  useEffect(() => {
    setIdbAvailable(typeof indexedDB !== "undefined");
  }, []);

  return (
    <div className="mt-4 divide-y divide-black/6 rounded-2xl border border-black/8 bg-white shadow-sm">
      <InfoRow
        label="IndexedDB"
        value={idbAvailable === null ? "…" : idbAvailable ? "verfügbar" : "nicht verfügbar"}
      />
      <InfoRow label="Sync-Status" value={STATUS_LABELS[status] ?? status} />
    </div>
  );
}
