"use client";

import { useCallback, useEffect, useState } from "react";

// ── Nur localStorage – KEINE Supabase-Synchronisation ─────────────────────────
const LS_KEY = "primaq-pos-device-layout-v1";

export type DeviceLayout = {
  cartWidth:     number; // 300 – 540
  flavorsHeight: number; // 280 – 620
  sizesHeight:   number; // 80  – 180
  paymentHeight: number; // 190 – 360
};

export const DL_MINS: DeviceLayout = {
  cartWidth:     300,
  flavorsHeight: 280,
  sizesHeight:    80,
  paymentHeight: 190,
};

export const DL_MAXS: DeviceLayout = {
  cartWidth:     540,
  flavorsHeight: 620,
  sizesHeight:   180,
  paymentHeight: 360,
};

export const DL_DEFAULTS: DeviceLayout = {
  cartWidth:     400,
  flavorsHeight: 480,
  sizesHeight:   116,
  paymentHeight: 240,
};

export type DLPresetId =
  | "ipad-12-9"
  | "ipad-11"
  | "desktop-wide"
  | "compact"
  | "large-flavors"
  | "large-cart";

export const DL_PRESETS: Record<DLPresetId, { label: string; layout: DeviceLayout }> = {
  "ipad-12-9":    { label: 'iPad 12.9"',      layout: { cartWidth: 400, flavorsHeight: 480, sizesHeight: 116, paymentHeight: 240 } },
  "ipad-11":      { label: 'iPad 11"',         layout: { cartWidth: 360, flavorsHeight: 400, sizesHeight: 105, paymentHeight: 220 } },
  "desktop-wide": { label: "Desktop breit",    layout: { cartWidth: 460, flavorsHeight: 500, sizesHeight: 120, paymentHeight: 260 } },
  "compact":      { label: "Kompakt",          layout: { cartWidth: 340, flavorsHeight: 380, sizesHeight:  95, paymentHeight: 210 } },
  "large-flavors":{ label: "Große Sorten",     layout: { cartWidth: 380, flavorsHeight: 580, sizesHeight: 110, paymentHeight: 220 } },
  "large-cart":   { label: "Großer Warenkorb", layout: { cartWidth: 500, flavorsHeight: 450, sizesHeight: 110, paymentHeight: 215 } },
};

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function clampDeviceLayout(l: Partial<DeviceLayout>): DeviceLayout {
  return {
    cartWidth:     clamp(l.cartWidth     ?? DL_DEFAULTS.cartWidth,     DL_MINS.cartWidth,     DL_MAXS.cartWidth),
    flavorsHeight: clamp(l.flavorsHeight ?? DL_DEFAULTS.flavorsHeight, DL_MINS.flavorsHeight, DL_MAXS.flavorsHeight),
    sizesHeight:   clamp(l.sizesHeight   ?? DL_DEFAULTS.sizesHeight,   DL_MINS.sizesHeight,   DL_MAXS.sizesHeight),
    paymentHeight: clamp(l.paymentHeight ?? DL_DEFAULTS.paymentHeight, DL_MINS.paymentHeight, DL_MAXS.paymentHeight),
  };
}

// Apply CSS custom properties to <html> element (smooth drag – no React re-render)
export function applyDeviceLayoutCssVars(l: DeviceLayout): void {
  const el = document.documentElement;
  el.style.setProperty("--pos-cart-width",     `${l.cartWidth}px`);
  el.style.setProperty("--pos-flavors-height", `${l.flavorsHeight}px`);
  el.style.setProperty("--pos-sizes-height",   `${l.sizesHeight}px`);
  el.style.setProperty("--pos-payment-height", `${l.paymentHeight}px`);
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
    const l = loadFromLS();
    setLayout(l);
    applyDeviceLayoutCssVars(l);
    setHydrated(true);
  }, []);

  // Save to state + CSS vars + localStorage (called on drag-end and preset apply)
  const save = useCallback((l: DeviceLayout) => {
    const clamped = clampDeviceLayout(l);
    setLayout(clamped);
    applyDeviceLayoutCssVars(clamped);
    saveToLS(clamped);
  }, []);

  const applyPreset = useCallback((id: DLPresetId) => {
    save(DL_PRESETS[id].layout);
  }, [save]);

  const reset = useCallback(() => {
    localStorage.removeItem(LS_KEY);
    setLayout(DL_DEFAULTS);
    applyDeviceLayoutCssVars(DL_DEFAULTS);
  }, []);

  return { layout, hydrated, save, applyPreset, reset };
}
