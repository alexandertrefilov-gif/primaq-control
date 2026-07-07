"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/features/pos/admin-context";
import { dbGet, dbRemove } from "@/lib/db";
import { enqueueSettingsSync } from "@/lib/sync/enqueue-settings";
import { getSyncService } from "@/lib/sync/sync-service";
import { getDeviceId } from "@/lib/sync/device-registry";
import { useSyncStatus } from "./use-sync-status";
import { SyncDiagnostic } from "./sync-diagnostic";

const PUBLISH_KEYS = [
  "primaq-pos-flavors-v1",
  "primaq-pos-layout-v1",
  "primaq-pos-vat-rate",
] as const;

const COMMIT_SHORT =
  process.env.NEXT_PUBLIC_COMMIT_SHA && process.env.NEXT_PUBLIC_COMMIT_SHA !== "unknown"
    ? process.env.NEXT_PUBLIC_COMMIT_SHA.slice(0, 7)
    : null;
const BUILD_BRANCH =
  process.env.NEXT_PUBLIC_BUILD_BRANCH && process.env.NEXT_PUBLIC_BUILD_BRANCH !== "unknown"
    ? process.env.NEXT_PUBLIC_BUILD_BRANCH
    : null;
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? null;

const SETTINGS_KEYS = [
  "primaq-pos-flavors-v1",
  "primaq-pos-flavors-v1-meta",
  "primaq-pos-layout-v1",
  "primaq-pos-layout-v1-meta",
  "primaq-pos-vat-rate",
  "primaq-pos-vat-rate-meta",
];

// Plain-localStorage settings that never go through the cloud-sync pipeline
// (deliberately device-local) — a full device reset still clears these so
// a "reset" genuinely returns to defaults, not just the synced subset.
const LOCAL_ONLY_KEYS = [
  "primaq-pos-grid-layout-v1",
  "primaq-pos-theme",
  "primaq-pos-custom-colors",
  "primaq-guided-mode",
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

function StatRow({
  label,
  value,
  error,
  testId,
}: {
  label: string;
  value: string | number;
  error?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-black/50">{label}</span>
      <span
        data-testid={testId}
        className={error ? "font-semibold text-red-600" : "font-semibold text-black/80"}
      >
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
  const [factoryResetting, setFactoryResetting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishDone, setPublishDone] = useState(false);
  const [deviceIdShort, setDeviceIdShort] = useState<string | null>(null);
  const [swInfo, setSwInfo] = useState<{ active: string | null; waiting: boolean } | null>(null);

  useEffect(() => {
    void getDeviceId().then((id) => setDeviceIdShort(id.slice(0, 8)));
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) { setSwInfo({ active: null, waiting: false }); return; }
      setSwInfo({
        active: reg.active?.scriptURL ?? null,
        waiting: !!reg.waiting,
      });
    });
  }, []);

  useEffect(() => {
    if (!publishDone) return;
    const t = setTimeout(() => setPublishDone(false), 4000);
    return () => clearTimeout(t);
  }, [publishDone]);

  const handleManualSync = useCallback(async () => {
    setFlushing(true);
    try {
      await getSyncService().syncNow();
    } finally {
      setFlushing(false);
    }
  }, []);

  const handlePublishSettings = useCallback(async () => {
    setPublishing(true);
    setPublishDone(false);
    try {
      let enqueued = 0;
      for (const key of PUBLISH_KEYS) {
        const raw = await dbGet(key);
        if (raw) {
          try {
            await enqueueSettingsSync(key, JSON.parse(raw) as unknown);
            enqueued++;
          } catch {
            // skip malformed entry
          }
        }
      }
      if (enqueued > 0) {
        await getSyncService().flush();
      }
      setPublishDone(true);
    } finally {
      setPublishing(false);
    }
  }, []);

  const handleResetAndPull = useCallback(async () => {
    const confirmed = window.confirm(
      "Lokale POS-Einstellungen (Sorten, Layout, Grundeinstellungen) löschen und aus Supabase neu laden?\n\n" +
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

  const handleFactoryReset = useCallback(async () => {
    const confirmed = window.confirm(
      "Dieses Gerät komplett zurücksetzen?\n\n" +
        "Löscht lokale POS-Einstellungen, geräteeigene Anzeigeeinstellungen " +
        "(Theme, Layout-Splitter, geführter Modus) und den kompletten " +
        "App-Cache (Service Worker). Die App lädt danach die aktuellsten " +
        "Einstellungen aus der Cloud.\n\n" +
        "Jahres- und Tagesumsätze sind nicht betroffen.\n\n" +
        "Diese Aktion kann nicht rückgängig gemacht werden."
    );
    if (!confirmed) return;

    setFactoryResetting(true);
    try {
      // 1. Cloud-synced settings (IndexedDB) — same scope as reset-and-pull.
      await Promise.all(SETTINGS_KEYS.map((k) => dbRemove(k)));

      // 2. Device-local-only settings (plain localStorage, never synced).
      for (const key of LOCAL_ONLY_KEYS) {
        try { window.localStorage.removeItem(key); } catch { /* ignore */ }
      }

      // 3. Service worker cache storage — force every asset to be re-fetched.
      if (typeof caches !== "undefined") {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }

      // 4. Unregister the current SW so the next load installs a fully fresh one.
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      }

      // 5. Re-pull fresh settings from the cloud before reloading.
      try {
        await getSyncService().pull();
      } catch {
        // Offline or pull failed — reload anyway, defaults apply until sync succeeds.
      }

      window.location.reload();
    } catch {
      setFactoryResetting(false);
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
        <StatRow testId="pending-count-value" label="Ausstehend" value={stats.pendingCount} />
        <StatRow testId="failed-count-value" label="Fehlgeschlagen" value={stats.failedCount} />
        <StatRow
          testId="last-sync-value"
          label="Letzter Sync"
          value={stats.lastSyncAt ? relativeTime(stats.lastSyncAt) : "—"}
        />
        <StatRow
          testId="last-push-value"
          label="Letzter Push (an Cloud)"
          value={stats.lastPushAt ? relativeTime(stats.lastPushAt) : "—"}
        />
        <StatRow
          testId="last-pull-value"
          label="Letzter Pull (von Cloud)"
          value={stats.lastPullAt ? relativeTime(stats.lastPullAt) : "—"}
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
        <>
          <button
            data-testid="publish-settings-btn"
            onClick={handlePublishSettings}
            disabled={publishing}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-primaq-200 bg-primaq-50 px-4 py-2.5 text-sm font-semibold text-primaq-700 transition-colors hover:bg-primaq-100 active:scale-[0.97] disabled:opacity-60"
          >
            {publishing ? "Wird veröffentlicht…" : "Aktuelle Einstellungen in Cloud veröffentlichen"}
          </button>
          {publishDone && (
            <p className="mt-2 text-center text-xs font-medium text-green-600">
              Aktuelle POS-Einstellungen wurden veröffentlicht.
            </p>
          )}
        </>
      )}

      {isAdmin && (
        <button
          data-testid="reset-and-pull-btn"
          onClick={handleResetAndPull}
          disabled={resetting}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 active:scale-[0.97] disabled:opacity-60"
        >
          {resetting ? "Wird geladen…" : "Cloud-Einstellungen auf diesem Gerät erzwingen"}
        </button>
      )}

      {isAdmin && (
        <button
          data-testid="factory-reset-btn"
          onClick={handleFactoryReset}
          disabled={factoryResetting}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-red-300 bg-red-100 px-4 py-2.5 text-sm font-bold text-red-700 transition-colors hover:bg-red-200 active:scale-[0.97] disabled:opacity-60"
        >
          {factoryResetting ? "Wird zurückgesetzt…" : "Dieses Gerät zurücksetzen"}
        </button>
      )}

      {isAdmin && <SyncDiagnostic />}

      {isAdmin && (
        <div className="mt-4 rounded-xl border border-black/8 bg-black/2 p-3 text-[10px] text-black/40">
          <p className="mb-1 font-bold uppercase tracking-widest text-black/30">Debug</p>
          <div className="space-y-0.5">
            <p>Build: {COMMIT_SHORT ?? "—"}{BUILD_BRANCH ? ` (${BUILD_BRANCH})` : ""}</p>
            <p>Build-Zeit: {BUILD_TIME ? new Date(BUILD_TIME).toLocaleString("de-DE") : "—"}</p>
            <p>Dieses Gerät: {deviceIdShort ?? "…"}</p>
            <p>
              Service Worker: {swInfo === null ? "…" : swInfo.active ? "aktiv" : "nicht registriert"}
              {swInfo?.waiting ? " — Update wartet (bitte neu laden)" : ""}
            </p>
          </div>
        </div>
      )}

      {!isAdmin && COMMIT_SHORT && (
        <p className="mt-3 text-center text-[10px] text-black/30">Build: {COMMIT_SHORT}</p>
      )}
    </div>
  );
}
