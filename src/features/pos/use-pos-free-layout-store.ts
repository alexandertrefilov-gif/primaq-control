"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Nur localStorage – KEINE Supabase-Synchronisation
const LS_KEY = "primaq-pos-free-layout-v1";

export type PanelId = "flavors" | "sizes" | "payment" | "cart";
export type ResizeMode = "move" | "e" | "s" | "se";

export type PanelRect = { x: number; y: number; w: number; h: number };
export type FreeLayout = { panels: Record<PanelId, PanelRect>; updatedAt?: string };

export const FL_PANEL_MINS: Record<PanelId, { w: number; h: number }> = {
  flavors: { w: 240, h: 160 },
  sizes:   { w: 240, h: 60  },
  payment: { w: 240, h: 120 },
  cart:    { w: 220, h: 160 },
};

const HEADER_H = 56; // approximate header height to subtract from window.innerHeight

/** Calculate default panel rects for the given viewport dimensions. */
export function defaultPanels(vw: number, vh: number): Record<PanelId, PanelRect> {
  const ch      = Math.max(400, vh - HEADER_H);
  const cw      = Math.max(600, vw);
  const cartW   = Math.max(300, Math.round(cw * 0.34));
  const leftW   = Math.max(300, cw - cartW - 8);
  const flavorH = Math.max(160, Math.round(ch * 0.56));
  const sizesH  = Math.max(60,  Math.round(ch * 0.13));
  const payH    = Math.max(120, ch - flavorH - sizesH);
  return {
    flavors: { x: 0,         y: 0,                w: leftW, h: flavorH },
    sizes:   { x: 0,         y: flavorH,          w: leftW, h: sizesH  },
    payment: { x: 0,         y: flavorH + sizesH, w: leftW, h: payH    },
    cart:    { x: leftW + 8, y: 0,                w: cartW, h: ch       },
  };
}

function getWindowDims(): { vw: number; vh: number } {
  if (typeof window === "undefined") return { vw: 1280, vh: 720 };
  return { vw: window.innerWidth, vh: window.innerHeight };
}

function loadFromLS(): Record<PanelId, PanelRect> | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FreeLayout;
    return parsed?.panels ?? null;
  } catch {
    return null;
  }
}

function saveToLS(panels: Record<PanelId, PanelRect>): void {
  localStorage.setItem(LS_KEY, JSON.stringify({ panels, updatedAt: new Date().toISOString() }));
}

export function usePosFreePanelStore() {
  const [panels, setPanels] = useState<Record<PanelId, PanelRect> | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadFromLS();
    if (saved) {
      setPanels(saved);
    } else {
      // Eagerly build defaults from window dimensions (no container ref needed)
      const { vw, vh } = getWindowDims();
      setPanels(defaultPanels(vw, vh));
    }
    setHydrated(true);
  }, []);

  const save = useCallback((p: Record<PanelId, PanelRect>) => {
    setPanels(p);
    saveToLS(p);
  }, []);

  const reset = useCallback(() => {
    localStorage.removeItem(LS_KEY);
    const { vw, vh } = getWindowDims();
    setPanels(defaultPanels(vw, vh));
  }, []);

  // Stable ref for access inside event listeners without re-subscribing
  const panelsRef = useRef(panels);
  useEffect(() => { panelsRef.current = panels; }, [panels]);

  return { panels, panelsRef, hydrated, save, reset };
}
