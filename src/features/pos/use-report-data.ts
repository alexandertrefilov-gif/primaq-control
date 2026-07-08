"use client";

import { useMemo } from "react";
import { usePosStore } from "./use-pos-store";
import { usePosYearStore } from "./use-pos-year-store";
import type { DailySummary } from "./pos-types";

/**
 * A day as seen by the reports. `isLive` marks today's still-open business
 * day merged in from the live sales state — it has not been closed via
 * "Tagesdaten zurücksetzen" yet and so has no entry in pos_year_history.
 */
export type ReportDay = DailySummary & { isLive?: boolean };

/**
 * Single data source for Wochen-, Monats- und Jahresbericht.
 *
 * Without this merge, an event name (or any sales) set today are only
 * visible in Tagesbericht (which reads the live state directly) — Woche/
 * Monat/Jahr read exclusively from pos_year_history, which only gains an
 * entry for "today" once an admin explicitly closes the day. That gap is
 * why a same-day Einsatz could appear in the Tagesbericht but not the
 * Wochenbericht: the day just hadn't been closed yet.
 *
 * This hook merges the closed historical days with today's live daily
 * summary (if it has any bookings and isn't already closed), so every
 * report reads from the same list and reflects an in-progress event
 * immediately instead of only after end-of-day close.
 */
export function useReportData(): {
  days: ReportDay[];
  hydrated: boolean;
  /** Today's live (not-yet-closed) event name, if any bookings exist today. */
  activeEventName: string | null;
  /** Today's live order count, regardless of whether it's merged into `days`. */
  todayOrderCount: number;
} {
  const { daily, hydrated: dailyHydrated } = usePosStore();
  const { history, hydrated: historyHydrated } = usePosYearStore();

  const days = useMemo<ReportDay[]>(() => {
    const alreadyClosed = history.some((d) => d.date === daily.date);
    if (daily.orderCount > 0 && !alreadyClosed) {
      return [...history, { ...daily, isLive: true }];
    }
    return history;
  }, [history, daily]);

  return {
    days,
    hydrated: historyHydrated && dailyHydrated,
    activeEventName: daily.orderCount > 0 ? daily.eventName ?? null : null,
    todayOrderCount: daily.orderCount,
  };
}
