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
      console.log("[Sync] primaq-sales-state-enqueued → auto-flush");
      void getSyncService().flush();
    };
    window.addEventListener("primaq-sales-state-enqueued", onEnqueued);
    return () => window.removeEventListener("primaq-sales-state-enqueued", onEnqueued);
  }, []);

  return null;
}
