"use client";

import { useState, useCallback, useEffect } from "react";
import { dbGet, dbSet } from "@/lib/db";
import { enqueueSettingsSync } from "@/lib/sync/enqueue-settings";
import { deriveEventStatus, type PlannedEvent } from "./event-types";

/** Legacy shape: one entry per single day, connected only by a matching name string. */
type LegacyEventPlan = { date: string; name: string };

export const EVENT_PLAN_KEY = "primaq-pos-event-plan-v2";
const LEGACY_EVENT_PLAN_KEY = "primaq-pos-event-plan";
const MIGRATION_MARKER_KEY = "primaq-pos-event-plan-migrated";

function createId(): string {
  return `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseLegacyEvents(raw: string | null): LegacyEventPlan[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e): e is LegacyEventPlan => typeof e?.date === "string" && typeof e?.name === "string"
    );
  } catch {
    return [];
  }
}

function parsePlannedEvents(raw: string | null): PlannedEvent[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e): e is PlannedEvent =>
        typeof e?.eventId === "string" &&
        typeof e?.eventName === "string" &&
        typeof e?.startDate === "string" &&
        typeof e?.endDate === "string"
    );
  } catch {
    return [];
  }
}

/**
 * Converts every legacy single-day entry into its own one-day PlannedEvent
 * (startDate === endDate). Deliberately does NOT merge consecutive same-name
 * entries into a multi-day bundle — that would risk incorrectly joining two
 * genuinely separate events that just happen to share a name (e.g. the same
 * yearly street festival on two different weekends). Old entries stay exactly
 * as they were: one-day events. Only newly created events use real ranges.
 */
function migrateLegacyEvents(legacy: LegacyEventPlan[]): PlannedEvent[] {
  const today = todayStr();
  return legacy.map((entry) => ({
    eventId: createId(),
    eventName: entry.name,
    startDate: entry.date,
    endDate: entry.date,
    status: deriveEventStatus({ startDate: entry.date, endDate: entry.date }, today),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

function withCurrentStatus(events: PlannedEvent[]): PlannedEvent[] {
  const today = todayStr();
  return events.map((e) => ({ ...e, status: deriveEventStatus(e, today) }));
}

export function useEventPlanStore() {
  const [events, setEvents] = useState<PlannedEvent[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const alreadyMigrated = (await dbGet(MIGRATION_MARKER_KEY)) === "1";
        const v2Raw = await dbGet(EVENT_PLAN_KEY);
        let current = parsePlannedEvents(v2Raw);

        if (!alreadyMigrated) {
          const legacyRaw = await dbGet(LEGACY_EVENT_PLAN_KEY);
          const legacy = parseLegacyEvents(legacyRaw);
          if (legacy.length > 0) {
            const migrated = migrateLegacyEvents(legacy);
            current = [...current, ...migrated].sort((a, b) => a.startDate.localeCompare(b.startDate));
            await dbSet(EVENT_PLAN_KEY, JSON.stringify(current));
            void enqueueSettingsSync(EVENT_PLAN_KEY, current);
          }
          await dbSet(MIGRATION_MARKER_KEY, "1");
        }

        setEvents(withCurrentStatus(current));
        setHydrated(true);
      } catch {
        setHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    const onSynced = (e: Event) => {
      const { key, data } = (e as CustomEvent<{ key: string; data: unknown }>).detail;
      if (key !== EVENT_PLAN_KEY) return;
      setEvents(withCurrentStatus(parsePlannedEvents(JSON.stringify(data))));
    };
    window.addEventListener("primaq-settings-synced", onSynced);
    return () => window.removeEventListener("primaq-settings-synced", onSynced);
  }, []);

  /** Sorts, re-derives status, writes to storage/cloud, and returns the new state. */
  const finalize = useCallback((next: PlannedEvent[]): PlannedEvent[] => {
    const sorted = withCurrentStatus([...next].sort((a, b) => a.startDate.localeCompare(b.startDate)));
    void dbSet(EVENT_PLAN_KEY, JSON.stringify(sorted));
    void enqueueSettingsSync(EVENT_PLAN_KEY, sorted);
    return sorted;
  }, []);

  /** Creates a new planned event (range or single day — pass startDate === endDate). */
  const createEvent = useCallback(
    (input: { eventName: string; startDate: string; endDate: string; location?: string }) => {
      const now = new Date().toISOString();
      const event: PlannedEvent = {
        eventId: createId(),
        eventName: input.eventName,
        startDate: input.startDate,
        endDate: input.endDate,
        location: input.location,
        status: deriveEventStatus(input, todayStr()),
        createdAt: now,
        updatedAt: now,
      };
      setEvents((prev) => finalize([...prev, event]));
      return event;
    },
    [finalize]
  );

  const updateEvent = useCallback(
    (eventId: string, patch: Partial<Pick<PlannedEvent, "eventName" | "startDate" | "endDate" | "location">>) => {
      setEvents((prev) =>
        finalize(
          prev.map((e) => (e.eventId === eventId ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e))
        )
      );
    },
    [finalize]
  );

  const removeEvent = useCallback(
    (eventId: string) => {
      setEvents((prev) => finalize(prev.filter((e) => e.eventId !== eventId)));
    },
    [finalize]
  );

  return { events, hydrated, createEvent, updateEvent, removeEvent };
}
