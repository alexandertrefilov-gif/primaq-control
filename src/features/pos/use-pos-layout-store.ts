"use client";

import { useState, useCallback, useEffect } from "react";

export type PanelId = "groessen" | "sorten" | "warenkorb";
export type PanelSize = "klein" | "mittel" | "gross" | "xl";
export type ToggleId = "zahlung" | "live-monitor" | "verkaufszaehler" | "letzte-bestellung";
export type CartFontSize = "normal" | "gross" | "xl";
export type PresetId = "standard" | "ipad" | "rush_hour" | "grossanzeige";

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

export type PanelConfig = {
  id: PanelId;
  size: PanelSize;
};

export type LayoutConfig = {
  panels: PanelConfig[];
  toggles: Record<ToggleId, boolean>;
  // Fine-grained size controls
  flavorCardSize: number;    // 110–190 px, default 140
  sizeColumnWidth: number;   // 120–240 px, default 176  (= w-44)
  qtyButtonSize: number;     // 40–80 px,  default 44
  cartFontSize: CartFontSize;
  cartWidth: number;         // 320–520 px, default 400
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
  flavorCardSize: 140,
  sizeColumnWidth: 176,
  qtyButtonSize: 44,
  cartFontSize: "normal",
  cartWidth: 400,
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

function loadState(): StoreState {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    if (!raw) return { active: DEFAULT_LAYOUT, profiles: [] };
    const parsed = JSON.parse(raw) as Partial<StoreState>;
    // Spread DEFAULT_LAYOUT first so any newly-added fields get their default values
    const active: LayoutConfig = {
      ...DEFAULT_LAYOUT,
      ...(parsed.active ?? {}),
      toggles: { ...DEFAULT_LAYOUT.toggles, ...(parsed.active?.toggles ?? {}) },
    };
    return { active, profiles: parsed.profiles ?? [] };
  } catch {
    return { active: DEFAULT_LAYOUT, profiles: [] };
  }
}

function saveState(state: StoreState) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    }
  } catch { /* quota exceeded */ }
}

export function usePosLayoutStore() {
  const [state, setState] = useState<StoreState>({ active: DEFAULT_LAYOUT, profiles: [] });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  const update = useCallback((config: LayoutConfig) => {
    setState((prev) => {
      const next = { ...prev, active: config };
      saveState(next);
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
      saveState(next);
      return next;
    });
  }, []);

  const loadProfile = useCallback((id: string) => {
    setState((prev) => {
      const profile = prev.profiles.find((p) => p.id === id);
      if (!profile) return prev;
      const next = { ...prev, active: profile.config };
      saveState(next);
      return next;
    });
  }, []);

  const deleteProfile = useCallback((id: string) => {
    setState((prev) => {
      const next = { ...prev, profiles: prev.profiles.filter((p) => p.id !== id) };
      saveState(next);
      return next;
    });
  }, []);

  const resetToDefault = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, active: DEFAULT_LAYOUT };
      saveState(next);
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
