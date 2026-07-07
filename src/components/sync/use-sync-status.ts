"use client";

import { useEffect, useState } from "react";
import { getSyncService, type SyncStatus, type SyncStats } from "@/lib/sync/sync-service";

const emptyStats: SyncStats = {
  pendingCount: 0,
  failedCount: 0,
  lastSyncAt: null,
  lastPushAt: null,
  lastPullAt: null,
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

    // Belt-and-suspenders: also listen for the CustomEvent that _recordPush()/
    // _recordPull() dispatch. This guarantees the UI updates even if the
    // subscription callback is missed due to React batching or subscription
    // timing.
    const onSyncCompleted = (e: Event) => {
      const detail = (e as CustomEvent<{ at: string; direction?: "push" | "pull" }>).detail;
      if (!detail?.at) return;
      setStats((prev) => ({
        ...prev,
        lastSyncAt: detail.at,
        lastPushAt: detail.direction === "push" ? detail.at : prev.lastPushAt,
        lastPullAt: detail.direction === "pull" ? detail.at : prev.lastPullAt,
      }));
    };
    window.addEventListener("primaq-sync-completed", onSyncCompleted);

    return () => {
      unsubscribe();
      window.removeEventListener("primaq-sync-completed", onSyncCompleted);
    };
  }, []);

  return { status, stats };
}
