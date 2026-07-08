"use client";

import type { ReportDay } from "./use-report-data";

/**
 * Admin-only debug strip shown on Wochen-/Monats-/Jahresbericht: makes the
 * event-name data flow (Tagesabschluss → useReportData → this report)
 * directly inspectable, so "warum erscheint mein Einsatz nicht" can be
 * answered by looking at this panel instead of guessing.
 */
export function ReportEventDebug({
  visibleDays,
  activeEventName,
  todayOrderCount,
  rangeLabel,
}: {
  /** The days actually shown in this report's current date range. */
  visibleDays: ReportDay[];
  activeEventName: string | null;
  todayOrderCount: number;
  rangeLabel: string;
}) {
  const ordersInRange = visibleDays.reduce((s, d) => s + d.orderCount, 0);
  const ordersWithoutEvent = visibleDays
    .filter((d) => !d.eventName)
    .reduce((s, d) => s + d.orderCount, 0);

  return (
    <div
      data-testid="report-event-debug"
      className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800"
    >
      <p className="mb-1.5 font-bold uppercase tracking-widest text-amber-600">
        Debug: Einsatz-Zuordnung
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <span>
          Aktiver Einsatz: <strong>{activeEventName ?? "keiner"}</strong>
        </span>
        <span>
          Verkäufe heute: <strong>{todayOrderCount}</strong>
        </span>
        <span>
          Verkäufe in {rangeLabel}: <strong>{ordersInRange}</strong>
        </span>
        <span>
          Ohne Einsatz: <strong>{ordersWithoutEvent}</strong>
        </span>
      </div>
    </div>
  );
}
