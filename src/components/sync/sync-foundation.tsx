"use client";

import { useEffect } from "react";
import { getDeviceId } from "@/lib/sync/device-registry";

/**
 * Renders nothing. Initializes the device registry (stable deviceId in IDB)
 * on first mount so it is ready before any sync operations are needed.
 */
export function SyncFoundation() {
  useEffect(() => {
    void getDeviceId();
  }, []);
  return null;
}
