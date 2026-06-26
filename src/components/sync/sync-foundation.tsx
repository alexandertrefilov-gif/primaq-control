"use client";

import { useEffect } from "react";
import { getSyncService } from "@/lib/sync/sync-service";

/**
 * Renders nothing. Starts the SyncService on mount and flushes the queue
 * whenever a sales-state op is enqueued (so bookings upload immediately
 * instead of waiting for the manual sync button).
 */
export function SyncFoundation() {
  useEffect(() => {
    const service = getSyncService();
    void service.start();
    return () => service.stop();
  }, []);

  useEffect(() => {
    const onEnqueued = () => {
      // SCHRITT 6 – Event empfangen, flush startet
      console.log("[Sync:6] primaq-sales-state-enqueued empfangen → starte flush()");
      void getSyncService().flush();
    };
    window.addEventListener("primaq-sales-state-enqueued", onEnqueued);
    return () => window.removeEventListener("primaq-sales-state-enqueued", onEnqueued);
  }, []);

  return null;
}
