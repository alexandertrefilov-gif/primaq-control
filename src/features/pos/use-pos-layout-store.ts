"use client";

import { useState, useCallback, useEffect } from "react";

export type PanelId = "groessen" | "sorten" | "warenkorb";
export type PanelSize = "klein" | "mittel" | "gross" | "xl";
export type ToggleId = "zahlung" | "live-monitor" | "verkaufszaehler" | "letzte-bestellung";

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

export type PanelConfig = {
  id: PanelId;
  size: PanelSize;
};

export type LayoutConfig = {
  panels: PanelConfig[];
  toggles: Record<ToggleId, boolean>;
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
};

// Maps panel + size to a Tailwind width/flex class
export function panelWidthClass(id: PanelId, size: PanelSize): string {
  if (id === "groessen") {
    const map: Record<PanelSize, string> = {
      klein: "w-32",
      mittel: "w-36",
      gross: "w-44",
      xl: "w-52",
    };
    return map[size];
  }
  if (id === "sorten") {
    return "flex-1 min-w-0";
  }
  // warenkorb
  const map: Record<PanelSize, string> = {
    klein: "w-[340px]",
    mittel: "w-[380px]",
    gross: "w-[440px]",
    xl: "w-[520px]",
  };
  return map[size];
}

type StoreState = { active: LayoutConfig; profiles: LayoutProfile[] };

function loadState(): StoreState {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    if (!raw) return { active: DEFAULT_LAYOUT, profiles: [] };
    const parsed = JSON.parse(raw) as Partial<StoreState>;
    const active = parsed.active ?? DEFAULT_LAYOUT;
    // Merge with defaults so newly added toggles always have a value
    active.toggles = { ...DEFAULT_LAYOUT.toggles, ...(active.toggles ?? {}) };
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
