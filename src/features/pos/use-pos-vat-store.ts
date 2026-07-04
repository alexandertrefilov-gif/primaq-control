"use client";

import { useState, useCallback, useEffect } from "react";
import { dbGet, dbSet } from "@/lib/db";
import { enqueueSettingsSync } from "@/lib/sync/enqueue-settings";

export const VAT_RATE_KEY = "primaq-pos-vat-rate";
export const DEFAULT_VAT_RATE = 7;

function parseVatRate(raw: string | null): number | null {
  if (raw === null) return null;
  const n = parseFloat(raw);
  return !isNaN(n) && n >= 0 && n <= 100 ? n : null;
}

/** Reads and persists the VAT rate (0–100, decimals allowed). Default: 7 %. */
export function usePosVatStore() {
  const [vatRate, setVatRateState] = useState<number>(DEFAULT_VAT_RATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    dbGet(VAT_RATE_KEY)
      .then((raw) => {
        const parsed = parseVatRate(raw);
        if (parsed !== null) setVatRateState(parsed);
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
  }, []);

  // Live-reload when sync writes new settings from another device
  useEffect(() => {
    const onSynced = (e: Event) => {
      const { key, data } = (e as CustomEvent<{ key: string; data: unknown }>).detail;
      if (key !== VAT_RATE_KEY) return;
      const parsed = parseVatRate(String(data));
      if (parsed !== null) setVatRateState(parsed);
    };
    window.addEventListener("primaq-settings-synced", onSynced);
    return () => window.removeEventListener("primaq-settings-synced", onSynced);
  }, []);

  const setVatRate = useCallback((rate: number) => {
    const safe = Math.max(0, Math.min(100, rate));
    setVatRateState(safe);
    void dbSet(VAT_RATE_KEY, String(safe));
    void enqueueSettingsSync(VAT_RATE_KEY, safe);
  }, []);

  return { vatRate, setVatRate, hydrated };
}

/** Net amount from gross at the given VAT rate. */
export function calcNet(grossCents: number, vatRate: number): number {
  if (vatRate === 0) return grossCents;
  return Math.round(grossCents / (1 + vatRate / 100));
}

/**
 * The VAT rate that applied to a given day: its own stored rate if the day was
 * closed after this field was introduced, otherwise the fallback (current) rate.
 * Historical days must never be recalculated at today's rate once they have
 * their own stored value — only unstamped legacy days fall back.
 */
export function effectiveVatRate(day: { vatRate?: number }, fallbackVatRate: number): number {
  return day.vatRate ?? fallbackVatRate;
}

/** Net amount for a day, using its own stored VAT rate (falling back to the given rate). */
export function calcNetForDay(day: { totalCents: number; vatRate?: number }, fallbackVatRate: number): number {
  return calcNet(day.totalCents, effectiveVatRate(day, fallbackVatRate));
}
