"use client";

import { useState, useEffect } from "react";

const GUIDED_MODE_KEY = "primaq-guided-mode";

export function useGuidedModeStore() {
  const [guidedMode, setGuidedModeState] = useState(true); // default enabled
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(GUIDED_MODE_KEY);
    if (stored !== null) setGuidedModeState(stored === "true");
    setHydrated(true);
  }, []);

  const setGuidedMode = (value: boolean) => {
    setGuidedModeState(value);
    localStorage.setItem(GUIDED_MODE_KEY, String(value));
  };

  return { guidedMode, setGuidedMode, hydrated };
}
