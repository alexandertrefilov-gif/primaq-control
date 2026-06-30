"use client";

import { useState, useCallback, useEffect } from "react";
import { dbGet, dbSet } from "@/lib/db";
import { enqueue } from "@/lib/sync/sync-queue";
import { getDeviceId } from "@/lib/sync/device-registry";
import type { DailySummary } from "./pos-types";

async function enqueueDaySync(day: DailySummary): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    await enqueue({
      entity: "pos_year_history",
      operation: "upsert",
      payload: JSON.stringify({
        businessId: "default",
        deviceId,
        date: day.date,
        summary: day,
      }),
      deviceId,
    });
  } catch {
    // sync errors must never disrupt the local POS flow
  }
}

const LS_KEY = "primaq-pos-year-history";

export function usePosYearStore() {
  const [history, setHistory] = useState<DailySummary[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    dbGet(LS_KEY)
      .then((raw) => {
        try {
          if (raw) setHistory(JSON.parse(raw) as DailySummary[]);
        } catch {
          // keep empty
        }
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
  }, []);

  // Reload when sync service pulls new entries from Supabase into IDB
  useEffect(() => {
    const onSynced = () => {
      dbGet(LS_KEY)
        .then((raw) => {
          try {
            if (raw) setHistory(JSON.parse(raw) as DailySummary[]);
          } catch { /* keep current */ }
        })
        .catch(() => {});
    };
    window.addEventListener("primaq-year-history-synced", onSynced);
    return () => window.removeEventListener("primaq-year-history-synced", onSynced);
  }, []);

  const saveDay = useCallback((day: DailySummary) => {
    setHistory((prev) => {
      const next = [...prev.filter((d) => d.date !== day.date), day]
        .sort((a, b) => a.date.localeCompare(b.date));
      void dbSet(LS_KEY, JSON.stringify(next));
      return next;
    });
    void enqueueDaySync(day);
  }, []);

  return { history, saveDay, hydrated };
}
