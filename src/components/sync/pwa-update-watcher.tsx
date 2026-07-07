"use client";

import { useCallback, useEffect, useState } from "react";

// Poll for a new service-worker version periodically while the app stays
// open — iOS Safari standalone PWAs don't reliably re-check on every
// navigation, so a kiosk tab left open for hours/days can otherwise never
// notice a new Vercel deployment until it's fully closed and reopened.
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Renders a small "Neue Version verfügbar" banner when a new service worker
 * has taken control of the page (next-pwa's generated SW calls skipWaiting()
 * + clientsClaim() unconditionally, so the *network layer* updates
 * immediately — but the already-running JS in this tab is only replaced by
 * an actual reload). All POS state is persisted to IndexedDB continuously,
 * so a reload here never loses an in-progress cart or unsent sync ops.
 */
export function PwaUpdateWatcher() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      setUpdateAvailable(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let cancelled = false;
    navigator.serviceWorker.getRegistration().then((registration) => {
      if (!registration || cancelled) return;
      void registration.update().catch(() => {});
      const interval = setInterval(() => {
        void registration.update().catch(() => {});
      }, UPDATE_CHECK_INTERVAL_MS);
      return () => clearInterval(interval);
    });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  if (!updateAvailable) return null;

  return (
    <div
      data-testid="pwa-update-banner"
      className="fixed inset-x-0 bottom-0 z-[9999] flex items-center justify-center gap-3 bg-primaq-700 px-4 py-3 text-sm font-semibold text-white shadow-lg"
    >
      <span>Neue Version verfügbar.</span>
      <button
        onClick={handleReload}
        className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-primaq-700 transition-colors hover:bg-white/90 active:scale-95"
      >
        Jetzt aktualisieren
      </button>
    </div>
  );
}
