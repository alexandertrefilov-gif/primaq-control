"use client";

import { useState, useEffect, useCallback } from "react";

const THEME_KEY  = "primaq-pos-theme";
const COLORS_KEY = "primaq-pos-custom-colors";

export type PosTheme = "graphite" | "hell";

export const COLOR_VARS = ["--pos-bg", "--pos-surface", "--pos-section", "--pos-text"] as const;
export type ColorVar = (typeof COLOR_VARS)[number];

export const COLOR_LABELS: Record<ColorVar, string> = {
  "--pos-bg":      "Hintergrund",
  "--pos-surface": "Karten & Panels",
  "--pos-section": "Abschnitte",
  "--pos-text":    "Schrift",
};

const DEFAULTS: Record<PosTheme, Record<ColorVar, string>> = {
  graphite: {
    "--pos-bg":      "#1E1F22",
    "--pos-surface": "#27292E",
    "--pos-section": "#2F3137",
    "--pos-text":    "#E4E6ED",
  },
  hell: {
    "--pos-bg":      "#f7f8f4",
    "--pos-surface": "#ffffff",
    "--pos-section": "#ffffff",
    "--pos-text":    "#18211f",
  },
};

type CustomColors = Partial<Record<ColorVar, string>>;

function loadCustomColors(): CustomColors {
  try {
    const raw = localStorage.getItem(COLORS_KEY);
    if (raw) return JSON.parse(raw) as CustomColors;
  } catch { /* ignore */ }
  return {};
}

function applyAllColors(theme: PosTheme, custom: CustomColors) {
  const el = document.documentElement;
  for (const v of COLOR_VARS) {
    if (custom[v]) {
      el.style.setProperty(v, custom[v]!);
    } else {
      el.style.removeProperty(v);
    }
  }
  // header vars stay in CSS (no customization for now)
  void theme;
}

export function usePosThemeStore() {
  const [theme, setThemeState] = useState<PosTheme>("graphite");
  const [custom, setCustomState] = useState<CustomColors>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    const t: PosTheme = stored === "hell" ? "hell" : "graphite";
    const c = loadCustomColors();
    setThemeState(t);
    setCustomState(c);
    document.documentElement.setAttribute("data-pos-theme", t);
    applyAllColors(t, c);
    setHydrated(true);
  }, []);

  const setTheme = useCallback((t: PosTheme) => {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
    document.documentElement.setAttribute("data-pos-theme", t);
    // re-apply custom overrides (they stay, just the CSS variables in stylesheet change)
    setCustomState((prev) => {
      applyAllColors(t, prev);
      return prev;
    });
  }, []);

  const setCustomColor = useCallback((variable: ColorVar, value: string) => {
    setCustomState((prev) => {
      const next = { ...prev, [variable]: value };
      localStorage.setItem(COLORS_KEY, JSON.stringify(next));
      document.documentElement.style.setProperty(variable, value);
      return next;
    });
  }, []);

  const resetCustomColor = useCallback((variable: ColorVar) => {
    setCustomState((prev) => {
      const next = { ...prev };
      delete next[variable];
      localStorage.setItem(COLORS_KEY, JSON.stringify(next));
      document.documentElement.style.removeProperty(variable);
      return next;
    });
  }, []);

  const resetAllCustomColors = useCallback(() => {
    setCustomState({});
    localStorage.removeItem(COLORS_KEY);
    setThemeState((t) => {
      for (const v of COLOR_VARS) {
        document.documentElement.style.removeProperty(v);
      }
      return t;
    });
  }, []);

  // Resolved = custom override ?? theme default (for showing in the UI)
  const resolvedColors: Record<ColorVar, string> = {} as Record<ColorVar, string>;
  for (const v of COLOR_VARS) {
    resolvedColors[v] = custom[v] ?? DEFAULTS[theme][v];
  }

  return {
    theme,
    setTheme,
    hydrated,
    custom,
    resolvedColors,
    setCustomColor,
    resetCustomColor,
    resetAllCustomColors,
    defaults: DEFAULTS[theme],
  };
}
