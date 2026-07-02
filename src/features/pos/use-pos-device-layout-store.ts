"use client";

import { useCallback, useEffect, useState } from "react";

// ── Nur localStorage – KEINE Supabase-Synchronisation ─────────────────────────
const LS_KEY = "primaq-pos-device-layout-v1";

export type DeviceLayout = {
  cartWidth: number;         // 320 – 520
  flavorAreaHeight: number;  // 280 – 700
  sizeAreaHeight: number;    // 90  – 200
  paymentAreaHeight: number; // 180 – 450
};

export const DL_MINS: DeviceLayout = {
  cartWidth: 320,
  flavorAreaHeight: 280,
  sizeAreaHeight: 90,
  paymentAreaHeight: 180,
};

export const DL_MAXS: DeviceLayout = {
  cartWidth: 520,
  flavorAreaHeight: 700,
  sizeAreaHeight: 200,
  paymentAreaHeight: 450,
};

export const DL_DEFAULTS: DeviceLayout = {
  cartWidth: 400,
  flavorAreaHeight: 480,
  sizeAreaHeight: 116,
  paymentAreaHeight: 240,
};

export type DLPresetId =
  | "ipad-12-9"
  | "ipad-11"
  | "desktop-wide"
  | "compact"
  | "large-flavors"
  | "large-cart";

export const DL_PRESETS: Record<DLPresetId, { label: string; layout: DeviceLayout }> = {
  "ipad-12-9":    { label: 'iPad 12.9"',      layout: { cartWidth: 400, flavorAreaHeight: 480, sizeAreaHeight: 116, paymentAreaHeight: 240 } },
  "ipad-11":      { label: 'iPad 11"',         layout: { cartWidth: 360, flavorAreaHeight: 400, sizeAreaHeight: 105, paymentAreaHeight: 220 } },
  "desktop-wide": { label: "Desktop breit",    layout: { cartWidth: 460, flavorAreaHeight: 500, sizeAreaHeight: 120, paymentAreaHeight: 260 } },
  "compact":      { label: "Kompakt",          layout: { cartWidth: 340, flavorAreaHeight: 380, sizeAreaHeight: 95,  paymentAreaHeight: 210 } },
  "large-flavors":{ label: "Große Sorten",     layout: { cartWidth: 380, flavorAreaHeight: 580, sizeAreaHeight: 110, paymentAreaHeight: 220 } },
  "large-cart":   { label: "Großer Warenkorb", layout: { cartWidth: 500, flavorAreaHeight: 450, sizeAreaHeight: 110, paymentAreaHeight: 215 } },
};

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function clampDeviceLayout(l: Partial<DeviceLayout>): DeviceLayout {
  return {
    cartWidth:         clamp(l.cartWidth         ?? DL_DEFAULTS.cartWidth,         DL_MINS.cartWidth,         DL_MAXS.cartWidth),
    flavorAreaHeight:  clamp(l.flavorAreaHeight  ?? DL_DEFAULTS.flavorAreaHeight,  DL_MINS.flavorAreaHeight,  DL_MAXS.flavorAreaHeight),
    sizeAreaHeight:    clamp(l.sizeAreaHeight    ?? DL_DEFAULTS.sizeAreaHeight,    DL_MINS.sizeAreaHeight,    DL_MAXS.sizeAreaHeight),
    paymentAreaHeight: clamp(l.paymentAreaHeight ?? DL_DEFAULTS.paymentAreaHeight, DL_MINS.paymentAreaHeight, DL_MAXS.paymentAreaHeight),
  };
}

function loadFromLS(): DeviceLayout {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DL_DEFAULTS;
    return clampDeviceLayout(JSON.parse(raw) as Partial<DeviceLayout>);
  } catch {
    return DL_DEFAULTS;
  }
}

function saveToLS(l: DeviceLayout): void {
  localStorage.setItem(LS_KEY, JSON.stringify({ ...l, updatedAt: new Date().toISOString() }));
}

export function usePosDeviceLayoutStore() {
  const [layout, setLayout] = useState<DeviceLayout>(DL_DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLayout(loadFromLS());
    setHydrated(true);
  }, []);

  // update in memory only (during drag – no LS write)
  const update = useCallback((partial: Partial<DeviceLayout>) => {
    setLayout((prev) => clampDeviceLayout({ ...prev, ...partial }));
  }, []);

  // commit current state to localStorage (on pointerup)
  const commit = useCallback(() => {
    setLayout((prev) => {
      saveToLS(prev);
      return prev;
    });
  }, []);

  const applyPreset = useCallback((id: DLPresetId) => {
    const l = clampDeviceLayout(DL_PRESETS[id].layout);
    setLayout(l);
    saveToLS(l);
  }, []);

  const reset = useCallback(() => {
    localStorage.removeItem(LS_KEY);
    setLayout(DL_DEFAULTS);
  }, []);

  return { layout, hydrated, update, commit, applyPreset, reset };
}
