"use client";

import { useState, useCallback, useEffect } from "react";
import { dbGet, dbSet } from "@/lib/db";
import { enqueueSettingsSync } from "@/lib/sync/enqueue-settings";

export type EventPlan = {
  date: string; // YYYY-MM-DD
  name: string;
};

export const EVENT_PLAN_KEY = "primaq-pos-event-plan";

function parseEvents(raw: string | null): EventPlan[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e): e is EventPlan => typeof e?.date === "string" && typeof e?.name === "string"
    );
  } catch {
    return [];
  }
}

export function useEventPlanStore() {
  const [events, setEvents] = useState<EventPlan[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    dbGet(EVENT_PLAN_KEY)
      .then((raw) => {
        setEvents(parseEvents(raw));
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
  }, []);

  useEffect(() => {
    const onSynced = (e: Event) => {
      const { key, data } = (e as CustomEvent<{ key: string; data: unknown }>).detail;
      if (key !== EVENT_PLAN_KEY) return;
      setEvents(parseEvents(JSON.stringify(data)));
    };
    window.addEventListener("primaq-settings-synced", onSynced);
    return () => window.removeEventListener("primaq-settings-synced", onSynced);
  }, []);

  const saveEvent = useCallback((event: EventPlan) => {
    setEvents((prev) => {
      const next = [...prev.filter((e) => e.date !== event.date), event].sort((a, b) =>
        a.date.localeCompare(b.date)
      );
      void dbSet(EVENT_PLAN_KEY, JSON.stringify(next));
      void enqueueSettingsSync(EVENT_PLAN_KEY, next);
      return next;
    });
  }, []);

  const removeEvent = useCallback((date: string) => {
    setEvents((prev) => {
      const next = prev.filter((e) => e.date !== date);
      void dbSet(EVENT_PLAN_KEY, JSON.stringify(next));
      void enqueueSettingsSync(EVENT_PLAN_KEY, next);
      return next;
    });
  }, []);

  return { events, saveEvent, removeEvent, hydrated };
}
