"use client";

import { useState, useCallback, useEffect } from "react";
import type { DailySummary } from "./pos-types";

const LS_KEY = "primaq-pos-year-history";

function load(): DailySummary[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DailySummary[];
  } catch {
    return [];
  }
}

function persist(days: DailySummary[]) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_KEY, JSON.stringify(days));
    }
  } catch { /* quota exceeded */ }
}

export function usePosYearStore() {
  const [history, setHistory] = useState<DailySummary[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHistory(load());
    setHydrated(true);
  }, []);

  const saveDay = useCallback((day: DailySummary) => {
    setHistory((prev) => {
      const next = [...prev.filter((d) => d.date !== day.date), day]
        .sort((a, b) => a.date.localeCompare(b.date));
      persist(next);
      return next;
    });
  }, []);

  return { history, saveDay, hydrated };
}
