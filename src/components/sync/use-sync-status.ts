"use client";

import { useEffect, useState } from "react";
import { getSyncService, type SyncStatus, type SyncStats } from "@/lib/sync/sync-service";

const emptyStats: SyncStats = {
  pendingCount: 0,
  failedCount: 0,
  lastSyncAt: null,
  lastError: null,
};

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>("offline");
  const [stats, setStats] = useState<SyncStats>(emptyStats);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const service = getSyncService();
    const unsubscribe = service.subscribeStatus((s, st) => {
      setStatus(s);
      setStats(st);
    });
    return unsubscribe;
  }, []);

  return { status, stats };
}
