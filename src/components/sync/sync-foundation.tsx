"use client";

import { useEffect } from "react";
import { getSyncService } from "@/lib/sync/sync-service";

/**
 * Renders nothing. Starts the SyncService on mount (initializing device
 * registry + network listener) and stops it cleanly on unmount.
 */
export function SyncFoundation() {
  useEffect(() => {
    const service = getSyncService();
    void service.start();
    return () => service.stop();
  }, []);
  return null;
}
