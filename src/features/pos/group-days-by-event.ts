import { calcNetForDay } from "./use-pos-vat-store";
import type { ReportDay } from "./use-report-data";

/**
 * A run of report days sharing the same eventName, in the order the report
 * period presents them (chronological). Days with no eventName are grouped
 * under `eventName: null` ("Ohne Einsatz").
 *
 * IMPORTANT limitation (no eventId in the data model — see use-report-data.ts
 * / pos-types.ts DailySummary): grouping is done by matching the `eventName`
 * string. Two genuinely different events that happen to share an identical
 * name are indistinguishable and will be merged into one group. A typo'd
 * name creates its own separate group instead of joining the intended one.
 * This is an accepted, documented trade-off for avoiding a data-model
 * migration (per-order/per-day eventId) — see PR/report notes.
 */
export type EventGroup = {
  /** Grouping key: the eventName, or null for "Ohne Einsatz". */
  eventName: string | null;
  days: ReportDay[];
  totalCents: number;
  cashCents: number;
  cardCents: number;
  qrCents: number;
  orderCount: number;
  netCents: number;
  vatCents: number;
  /** True if any day in this group is the live, not-yet-closed today. */
  hasLiveDay: boolean;
};

/**
 * Groups report days by eventName, preserving each group's first-occurrence
 * order (chronological, since callers pass days already date-sorted).
 * Only days that actually carry data (a ReportDay, not an empty calendar
 * slot) should be passed in — filter those out before calling this.
 */
export function groupDaysByEvent(days: ReportDay[], fallbackVatRate: number): EventGroup[] {
  const order: (string | null)[] = [];
  const byKey = new Map<string | null, ReportDay[]>();

  for (const day of days) {
    const key = day.eventName ?? null;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(day);
  }

  return order.map((key) => {
    const groupDays = byKey.get(key)!;
    const totalCents = groupDays.reduce((s, d) => s + d.totalCents, 0);
    const cashCents = groupDays.reduce((s, d) => s + d.cashCents, 0);
    const cardCents = groupDays.reduce((s, d) => s + d.cardCents, 0);
    const qrCents = groupDays.reduce((s, d) => s + d.qrCents, 0);
    const orderCount = groupDays.reduce((s, d) => s + d.orderCount, 0);
    const netCents = groupDays.reduce((s, d) => s + calcNetForDay(d, fallbackVatRate), 0);
    return {
      eventName: key,
      days: groupDays,
      totalCents,
      cashCents,
      cardCents,
      qrCents,
      orderCount,
      netCents,
      vatCents: totalCents - netCents,
      hasLiveDay: groupDays.some((d) => d.isLive),
    };
  });
}

/** Distinct event labels among a set of days, in first-occurrence order. "Ohne Einsatz" for null. */
export function distinctEventLabels(days: { eventName?: string | null }[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const d of days) {
    const label = d.eventName ?? "Ohne Einsatz";
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}
