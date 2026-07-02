"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Nur localStorage – KEINE Supabase-Synchronisation
const LS_KEY = "primaq-pos-free-layout-v1";

export type PanelId = "flavors" | "sizes" | "payment" | "cart";
export type ResizeMode = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

export type PanelRect = { x: number; y: number; w: number; h: number };
export type FreeLayout = { panels: Record<PanelId, PanelRect>; updatedAt?: string };

/** Minimum gap between panels and from workspace edges (px). */
export const PANEL_GAP = 8;

export const FL_PANEL_MINS: Record<PanelId, { w: number; h: number }> = {
  flavors: { w: 520, h: 360 },
  sizes:   { w: 420, h: 100 },
  payment: { w: 520, h: 220 },
  cart:    { w: 340, h: 360 },
};

const HEADER_H = 56; // approximate header height to subtract from window.innerHeight

/** Calculate default panel rects from viewport dimensions, respecting FL_PANEL_MINS and PANEL_GAP. */
export function defaultPanels(vw: number, vh: number): Record<PanelId, PanelRect> {
  const G = PANEL_GAP;

  // Minimum ch to fit all left-column panels with their inter-row gaps and border gaps
  const totalMinH = FL_PANEL_MINS.flavors.h + FL_PANEL_MINS.sizes.h + FL_PANEL_MINS.payment.h;
  const ch = Math.max(totalMinH + 4 * G, vh - HEADER_H);
  const cw = Math.max(900, vw);

  // Available area inset by PANEL_GAP on all sides
  const availW = cw - 2 * G;
  const availH = ch - 2 * G;

  // Two columns: cart on right, separated by PANEL_GAP
  const cartW = Math.max(FL_PANEL_MINS.cart.w, Math.round(availW * 0.34));
  const leftW = Math.max(FL_PANEL_MINS.flavors.w, availW - cartW - G);

  // Three rows in left column with PANEL_GAP between each row
  const leftH = availH - 2 * G; // space available for 3 panels (2 inter-row gaps removed)

  let flavorH: number, sizesH: number, payH: number;
  if (leftH <= totalMinH) {
    // Workspace is tight – use minimum heights exactly
    flavorH = FL_PANEL_MINS.flavors.h;
    sizesH  = FL_PANEL_MINS.sizes.h;
    payH    = FL_PANEL_MINS.payment.h;
  } else {
    // Distribute extra space above minimums proportionally
    const extra = leftH - totalMinH;
    flavorH = FL_PANEL_MINS.flavors.h + Math.round(extra * 0.55);
    sizesH  = FL_PANEL_MINS.sizes.h   + Math.round(extra * 0.13);
    payH    = Math.max(FL_PANEL_MINS.payment.h, leftH - flavorH - sizesH);
  }

  return {
    flavors: { x: G,             y: G,                              w: leftW, h: flavorH },
    sizes:   { x: G,             y: G + flavorH + G,               w: leftW, h: sizesH  },
    payment: { x: G,             y: G + flavorH + G + sizesH + G,  w: leftW, h: payH    },
    cart:    { x: G + leftW + G, y: G,                              w: cartW, h: availH  },
  };
}

/**
 * Normalise a saved layout to the current workspace:
 * – Expand panels that are below FL_PANEL_MINS (never shrinks a panel)
 * – Clamp positions so panels sit within [PANEL_GAP, ws – PANEL_GAP] on every edge
 */
export function normalizeLayout(
  panels: Record<PanelId, PanelRect>,
  wsW: number,
  wsH: number,
): Record<PanelId, PanelRect> {
  const G = PANEL_GAP;
  const ids: PanelId[] = ["flavors", "sizes", "payment", "cart"];
  const normalized = {} as Record<PanelId, PanelRect>;

  for (const id of ids) {
    const mn = FL_PANEL_MINS[id];
    let { x, y, w, h } = panels[id];

    // Enforce minimum sizes (expand only, never shrink)
    w = Math.max(mn.w, w);
    h = Math.max(mn.h, h);

    // Clamp X so the panel stays within horizontal workspace bounds (both edges).
    x = Math.max(G, Math.min(x, Math.max(G, wsW - w - G)));
    // Clamp Y only at the TOP edge (prevent going above the workspace).
    // Do NOT clamp the bottom edge: clamping y upward when the workspace is shorter
    // than the total stacked panel height would push payment into sizes and create an
    // overlap. Panels that extend below the container are safely clipped by overflow-hidden.
    y = Math.max(G, y);

    normalized[id] = { x, y, w, h };
  }

  return normalized;
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
    const { vw, vh } = getWindowDims();
    if (saved) {
      // Normalise positions for the current viewport on load
      const wsH = Math.max(400, vh - HEADER_H);
      setPanels(normalizeLayout(saved, vw, wsH));
    } else {
      setPanels(defaultPanels(vw, vh));
    }
    setHydrated(true);
  }, []);

  const save = useCallback((p: Record<PanelId, PanelRect>) => {
    setPanels(p);
    saveToLS(p);
  }, []);

  /** Update in-memory state only – does NOT write to localStorage (used when overlap detected). */
  const updateState = useCallback((p: Record<PanelId, PanelRect>) => {
    setPanels(p);
  }, []);

  const reset = useCallback(() => {
    localStorage.removeItem(LS_KEY);
    const { vw, vh } = getWindowDims();
    setPanels(defaultPanels(vw, vh));
  }, []);

  // Stable ref for access inside event listeners without re-subscribing
  const panelsRef = useRef(panels);
  useEffect(() => { panelsRef.current = panels; }, [panels]);

  return { panels, panelsRef, hydrated, save, updateState, reset };
}
