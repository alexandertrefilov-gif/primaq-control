"use client";

import { useState, useCallback, useEffect } from "react";
import { dbGet, dbSet } from "@/lib/db";
import { enqueueSettingsSync } from "@/lib/sync/enqueue-settings";

export type PanelId = "groessen" | "sorten" | "warenkorb";
export type PanelSize = "klein" | "mittel" | "gross" | "xl";
export type ToggleId = "zahlung" | "live-monitor" | "verkaufszaehler" | "letzte-bestellung";
export type CartFontSize = "normal" | "gross" | "xl";
export type PresetId = "standard" | "ipad" | "rush_hour" | "grossanzeige";
export type CardSizePreset = "klein" | "mittel" | "gross";

export const PANEL_LABELS: Record<PanelId, string> = {
  groessen: "Größenbereich",
  sorten: "Sortenbereich",
  warenkorb: "Warenkorb",
};

export const SIZE_LABELS: Record<PanelSize, string> = {
  klein: "Klein",
  mittel: "Mittel",
  gross: "Groß",
  xl: "XL",
};

export const TOGGLE_LABELS: Record<ToggleId, string> = {
  zahlung: "Zahlungsbereich",
  "live-monitor": "Live-Monitor",
  verkaufszaehler: "Verkaufszähler",
  "letzte-bestellung": "Letzte Bestellung",
};

export const CART_FONT_LABELS: Record<CartFontSize, string> = {
  normal: "Normal",
  gross: "Groß",
  xl: "Extra Groß",
};

export const CARD_SIZE_LABELS: Record<CardSizePreset, string> = {
  klein: "Klein",
  mittel: "Mittel",
  gross: "Groß",
};

// Shared CSS custom properties for Sorten- (Punkt 1) und Größenkarten (Punkt 2) —
// beide Bereiche lesen dieselben Variablen, damit sie immer gemeinsam skalieren.
// clamp() hält die Werte responsiv zwischen iPad- und Desktop-Breiten.
export const CARD_SIZE_VARS: Record<CardSizePreset, {
  cardSize: string;
  cardGap: string;
  cardRadius: string;
  sizeCardHeight: string;
}> = {
  klein: {
    cardSize: "clamp(120px, 11vw, 150px)",
    cardGap: "8px",
    cardRadius: "14px",
    sizeCardHeight: "clamp(80px, 9vh, 96px)",
  },
  mittel: {
    cardSize: "clamp(150px, 13vw, 180px)",
    cardGap: "10px",
    cardRadius: "16px",
    sizeCardHeight: "clamp(100px, 11vh, 120px)",
  },
  gross: {
    cardSize: "clamp(180px, 15vw, 210px)",
    cardGap: "12px",
    cardRadius: "20px",
    sizeCardHeight: "clamp(120px, 13vh, 145px)",
  },
};

export type PanelConfig = {
  id: PanelId;
  size: PanelSize;
};

export type TextColorMode = "auto" | "light" | "dark";

export type SalesSizeOverride = {
  label: string;
  priceCents: number;
  order: number;
  backgroundColor: string;
  textColorMode: TextColorMode;
  imageDataUrl: string | null;
  imageScale: number; // zoom 50–200, default 100
  showAsQuickAmount: boolean; // price appears in payment quick amounts
};

export type PaymentConfig = {
  barColor: string;        // active green by default
  karteColor: string;      // active blue by default
  qrColor: string;         // active purple by default
  bookColor: string;       // "Bestellung buchen" button color
  billColor: string;       // color for bill quick-amount buttons
  customColor: string;     // color for custom quick-amount buttons
  bills: number[];         // active bill amounts in cents [500, 1000, 2000, 5000]
  customAmounts: number[]; // admin-defined quick amounts in cents
};

export const DEFAULT_PAYMENT: PaymentConfig = {
  barColor: "#16a34a",
  karteColor: "#2563eb",
  qrColor: "#7c3aed",
  bookColor: "#16a34a",
  billColor: "#0284c7",
  customColor: "#7c3aed",
  bills: [500, 1000, 2000, 5000],
  customAmounts: [],
};

export function computeTextColor(mode: TextColorMode, bgHex: string): string {
  if (mode === "light") return "#ffffff";
  if (mode === "dark") return "#1a1a1a";
  const hex = bgHex.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16) || 0;
  const g = parseInt(hex.slice(2, 4), 16) || 0;
  const b = parseInt(hex.slice(4, 6), 16) || 0;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? "#1a1a1a" : "#ffffff";
}

export type LayoutConfig = {
  panels: PanelConfig[];
  toggles: Record<ToggleId, boolean>;
  sizeVisibility: Record<string, boolean>; // which sizes appear in the sales UI
  salesSizes: Record<string, SalesSizeOverride>; // label/price overrides per size
  // Fine-grained size controls
  flavorCardSize: number;    // 110–240 px, default 140 — legacy, no longer drives rendering
  cardSizePreset: CardSizePreset; // Klein/Mittel/Groß — skaliert Sorten- und Größenkarten gemeinsam
  sizeColumnWidth: number;   // 120–240 px, default 176  (= w-44)
  qtyButtonSize: number;     // 40–80 px,  default 44
  cartFontSize: CartFontSize;
  cartWidth: number;         // 320–520 px, default 400
  payment: PaymentConfig;    // payment area colors + quick amounts
};

export type LayoutProfile = {
  id: string;
  name: string;
  config: LayoutConfig;
};

const LS_KEY = "primaq-pos-layout-v1";

export const DEFAULT_LAYOUT: LayoutConfig = {
  panels: [
    { id: "groessen", size: "gross" },
    { id: "sorten", size: "gross" },
    { id: "warenkorb", size: "gross" },
  ],
  toggles: {
    zahlung: true,
    "live-monitor": true,
    verkaufszaehler: true,
    "letzte-bestellung": true,
  },
  sizeVisibility: { klein: true, mittel: true, gross: true },
  salesSizes: {
    klein: { label: "Klein", priceCents: 250, order: 1, backgroundColor: "#F6F2E8", textColorMode: "auto", imageDataUrl: null, imageScale: 100, showAsQuickAmount: true },
    mittel: { label: "Mittel", priceCents: 350, order: 2, backgroundColor: "#F8E3A0", textColorMode: "auto", imageDataUrl: null, imageScale: 100, showAsQuickAmount: true },
    gross:  { label: "Groß",  priceCents: 500, order: 3, backgroundColor: "#F4C96D", textColorMode: "auto", imageDataUrl: null, imageScale: 100, showAsQuickAmount: true },
  },
  flavorCardSize: 180,
  cardSizePreset: "mittel",
  sizeColumnWidth: 176,
  qtyButtonSize: 44,
  cartFontSize: "normal",
  cartWidth: 400,
  payment: DEFAULT_PAYMENT,
};

export const PRESETS: Record<PresetId, { label: string; description: string; config: LayoutConfig }> = {
  standard: {
    label: "Standard",
    description: "Ausgewogene Kasse für Normalbetrieb",
    config: DEFAULT_LAYOUT,
  },
  ipad: {
    label: "iPad",
    description: "Größere Touch-Targets für iPad-Betrieb",
    config: {
      ...DEFAULT_LAYOUT,
      flavorCardSize: 150,
      cardSizePreset: "klein",
      sizeColumnWidth: 176,
      qtyButtonSize: 52,
      cartFontSize: "normal",
      cartWidth: 420,
    },
  },
  rush_hour: {
    label: "Rush-Hour",
    description: "Große Buttons, bessere Lesbarkeit unter Stress",
    config: {
      ...DEFAULT_LAYOUT,
      flavorCardSize: 130,
      cardSizePreset: "klein",
      sizeColumnWidth: 160,
      qtyButtonSize: 56,
      cartFontSize: "gross",
      cartWidth: 440,
    },
  },
  grossanzeige: {
    label: "Großanzeige",
    description: "Extra große Schrift, ideal für 2-Personen-Betrieb",
    config: {
      ...DEFAULT_LAYOUT,
      flavorCardSize: 160,
      cardSizePreset: "gross",
      sizeColumnWidth: 200,
      qtyButtonSize: 64,
      cartFontSize: "xl",
      cartWidth: 480,
    },
  },
};

// Syncs the abstract size (Klein/Mittel/Groß/XL) with the corresponding pixel value
export function panelSizeToPixels(id: PanelId, size: PanelSize): Partial<LayoutConfig> {
  if (id === "groessen") {
    const w: Record<PanelSize, number> = { klein: 128, mittel: 144, gross: 176, xl: 208 };
    return { sizeColumnWidth: w[size] };
  }
  if (id === "warenkorb") {
    const w: Record<PanelSize, number> = { klein: 340, mittel: 380, gross: 440, xl: 520 };
    return { cartWidth: w[size] };
  }
  return {};
}

// Kept for the layout preview only (not used for actual column widths on the sales page)
export function panelWidthClass(id: PanelId, size: PanelSize): string {
  if (id === "groessen") {
    const map: Record<PanelSize, string> = { klein: "w-32", mittel: "w-36", gross: "w-44", xl: "w-52" };
    return map[size];
  }
  if (id === "sorten") return "flex-1 min-w-0";
  const map: Record<PanelSize, string> = { klein: "w-[340px]", mittel: "w-[380px]", gross: "w-[440px]", xl: "w-[520px]" };
  return map[size];
}

type StoreState = { active: LayoutConfig; profiles: LayoutProfile[] };

function parseStoreState(raw: string): StoreState {
  const parsed = JSON.parse(raw) as Partial<StoreState>;
  const active: LayoutConfig = {
    ...DEFAULT_LAYOUT,
    ...(parsed.active ?? {}),
    toggles: { ...DEFAULT_LAYOUT.toggles, ...(parsed.active?.toggles ?? {}) },
    sizeVisibility: { ...DEFAULT_LAYOUT.sizeVisibility, ...(parsed.active?.sizeVisibility ?? {}) },
    salesSizes: Object.fromEntries(
      Object.entries(DEFAULT_LAYOUT.salesSizes).map(([id, def]) => [
        id,
        { ...def, ...(parsed.active?.salesSizes?.[id] ?? {}) },
      ])
    ) as Record<string, SalesSizeOverride>,
    payment: { ...DEFAULT_PAYMENT, ...(parsed.active?.payment ?? {}) },
  };
  return { active, profiles: parsed.profiles ?? [] };
}

export function usePosLayoutStore() {
  const [state, setState] = useState<StoreState>({ active: DEFAULT_LAYOUT, profiles: [] });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    dbGet(LS_KEY)
      .then((raw) => {
        try {
          if (raw) setState(parseStoreState(raw));
        } catch {
          // keep default
        }
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
  }, []);

  // Live-reload when sync writes new settings from another device
  useEffect(() => {
    const onSynced = (e: Event) => {
      const { key, data } = (e as CustomEvent<{ key: string; data: unknown }>).detail;
      if (key !== LS_KEY) return;
      try {
        setState(parseStoreState(JSON.stringify(data)));
      } catch { /* keep current */ }
    };
    window.addEventListener("primaq-settings-synced", onSynced);
    return () => window.removeEventListener("primaq-settings-synced", onSynced);
  }, []);

  const update = useCallback((config: LayoutConfig) => {
    setState((prev) => {
      const next = { ...prev, active: config };
      void dbSet(LS_KEY, JSON.stringify(next));
      void enqueueSettingsSync(LS_KEY, next);
      return next;
    });
  }, []);

  const saveProfile = useCallback((name: string) => {
    setState((prev) => {
      const profile: LayoutProfile = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: name.trim(),
        config: prev.active,
      };
      const next = { ...prev, profiles: [...prev.profiles, profile] };
      void dbSet(LS_KEY, JSON.stringify(next));
      void enqueueSettingsSync(LS_KEY, next);
      return next;
    });
  }, []);

  const loadProfile = useCallback((id: string) => {
    setState((prev) => {
      const profile = prev.profiles.find((p) => p.id === id);
      if (!profile) return prev;
      const next = { ...prev, active: profile.config };
      void dbSet(LS_KEY, JSON.stringify(next));
      void enqueueSettingsSync(LS_KEY, next);
      return next;
    });
  }, []);

  const deleteProfile = useCallback((id: string) => {
    setState((prev) => {
      const next = { ...prev, profiles: prev.profiles.filter((p) => p.id !== id) };
      void dbSet(LS_KEY, JSON.stringify(next));
      void enqueueSettingsSync(LS_KEY, next);
      return next;
    });
  }, []);

  const resetToDefault = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, active: DEFAULT_LAYOUT };
      void dbSet(LS_KEY, JSON.stringify(next));
      void enqueueSettingsSync(LS_KEY, next);
      return next;
    });
  }, []);

  return {
    active: state.active,
    profiles: state.profiles,
    hydrated,
    update,
    saveProfile,
    loadProfile,
    deleteProfile,
    resetToDefault,
  };
}
