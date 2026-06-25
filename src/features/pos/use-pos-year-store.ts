"use client";

import { useState, useCallback, useEffect } from "react";
import { dbGet, dbSet } from "@/lib/db";
import type { DailySummary } from "./pos-types";

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

  const saveDay = useCallback((day: DailySummary) => {
    setHistory((prev) => {
      const next = [...prev.filter((d) => d.date !== day.date), day]
        .sort((a, b) => a.date.localeCompare(b.date));
      void dbSet(LS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { history, saveDay, hydrated };
}
