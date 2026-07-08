import { calcNetForDay } from "./use-pos-vat-store";
import type { ReportDay } from "./use-report-data";

/**
 * A run of report days belonging to the same event, in the order the report
 * period presents them (chronological). Days with neither eventId nor
 * eventName are grouped under `eventName: null` ("Ohne Einsatz").
 *
 * Grouping prefers `eventId` (set on days closed after the PlannedEvent
 * model was introduced) and falls back to matching the `eventName` string
 * for legacy days that only ever had a free-text name (see
 * pos-types.ts DailySummary, event-types.ts PlannedEvent). This keeps old
 * data fully visible and grouped exactly as before, without requiring any
 * backfill — new data groups more precisely via the id.
 *
 * Residual limitation for legacy (id-less) days only: two genuinely
 * different events that happen to share an identical name are still
 * indistinguishable and will be merged into one name-based group. Any day
 * with a real eventId is immune to that ambiguity.
 */
export type EventGroup = {
  /** The eventId shared by this group's days, if any of them have one. */
  eventId: string | null;
  /** Display name — the eventName of the group's days. */
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

function groupKey(day: ReportDay): string {
  if (day.eventId) return `id:${day.eventId}`;
  if (day.eventName) return `name:${day.eventName}`;
  return "none";
}

/**
 * Groups report days by eventId (falling back to eventName for legacy days
 * without one), preserving each group's first-occurrence order (chronological,
 * since callers pass days already date-sorted). Only days that actually carry
 * data (a ReportDay, not an empty calendar slot) should be passed in — filter
 * those out before calling this.
 */
export function groupDaysByEvent(days: ReportDay[], fallbackVatRate: number): EventGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, ReportDay[]>();

  for (const day of days) {
    const key = groupKey(day);
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
    const first = groupDays[0];
    return {
      eventId: first.eventId ?? null,
      eventName: first.eventName ?? null,
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
