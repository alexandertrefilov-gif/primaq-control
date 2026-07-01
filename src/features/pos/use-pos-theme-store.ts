"use client";

import { useState, useEffect } from "react";

const THEME_KEY = "primaq-pos-theme";
export type PosTheme = "graphite" | "hell";

export function usePosThemeStore() {
  const [theme, setThemeState] = useState<PosTheme>("graphite");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    const t: PosTheme = stored === "hell" ? "hell" : "graphite";
    setThemeState(t);
    document.documentElement.setAttribute("data-pos-theme", t);
    setHydrated(true);
  }, []);

  const setTheme = (t: PosTheme) => {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
    document.documentElement.setAttribute("data-pos-theme", t);
  };

  return { theme, setTheme, hydrated };
}
