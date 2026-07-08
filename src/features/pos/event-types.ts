export type EventStatus = "planned" | "running" | "completed";

/**
 * A planned event/Veranstaltung — a contiguous, possibly multi-day period.
 * Single-day events (including all migrated legacy entries) simply have
 * startDate === endDate.
 */
export type PlannedEvent = {
  eventId: string;
  eventName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD, always >= startDate
  location?: string;
  status: EventStatus;
  createdAt: string;
  updatedAt: string;
};

export function isDateWithinEvent(event: PlannedEvent, date: string): boolean {
  return date >= event.startDate && date <= event.endDate;
}

/** 1-based day index of `date` within the event's range, or null if outside it. */
export function eventDayIndex(event: PlannedEvent, date: string): number | null {
  if (!isDateWithinEvent(event, date)) return null;
  const start = new Date(event.startDate + "T00:00:00Z").getTime();
  const day = new Date(date + "T00:00:00Z").getTime();
  return Math.round((day - start) / 86400000) + 1;
}

export function eventTotalDays(event: PlannedEvent): number {
  const start = new Date(event.startDate + "T00:00:00Z").getTime();
  const end = new Date(event.endDate + "T00:00:00Z").getTime();
  return Math.round((end - start) / 86400000) + 1;
}

/** Derives planned/running/completed purely from today's date vs. the event's range. */
export function deriveEventStatus(event: Pick<PlannedEvent, "startDate" | "endDate">, todayStr: string): EventStatus {
  if (todayStr < event.startDate) return "planned";
  if (todayStr > event.endDate) return "completed";
  return "running";
}
