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

/**
 * Calculate default panel rects for an EXACT workspace content box (cw × ch —
 * i.e. the free-panel container's own clientWidth/clientHeight, already net
 * of header/status-bar/guided-bar chrome). Every panel is placed to fit
 * inside this box with a full PANEL_GAP margin on every edge, so the result
 * is overlap-free and gap-perfect by construction for whatever box it's given.
 */
export function defaultPanelsForWorkspace(cw: number, ch: number): Record<PanelId, PanelRect> {
  const G = PANEL_GAP;

  // Minimum ch to fit all left-column panels with their inter-row gaps and border gaps
  const totalMinH = FL_PANEL_MINS.flavors.h + FL_PANEL_MINS.sizes.h + FL_PANEL_MINS.payment.h;
  ch = Math.max(totalMinH + 4 * G, ch);
  cw = Math.max(900, cw);

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
 * Estimate-based variant for use BEFORE the workspace container exists (e.g.
 * the very first render pass). `vh` is the full window height; HEADER_H is a
 * rough guess for chrome above the workspace (app header, guided-steps bar,
 * status bar). Callers that already have the container's real clientWidth/
 * clientHeight should use `defaultPanelsForWorkspace` instead — it needs no
 * guessing and is therefore always gap-perfect.
 */
export function defaultPanels(vw: number, vh: number): Record<PanelId, PanelRect> {
  return defaultPanelsForWorkspace(vw, vh - HEADER_H);
}

/**
 * Normalise a saved layout to the current workspace:
 * – Clamp every panel's WIDTH into [FL_PANEL_MINS.w, workspace − 2·PANEL_GAP]
 *   — shrinks panels that no longer fit horizontally, expands undersized ones.
 * – Clamp X on both edges (left/right) — safe since width is already bounded.
 * – Clamp HEIGHT up to minimum only (never shrinks below FL_PANEL_MINS.h) and
 *   clamp Y only at the TOP edge. The three left-column panels' combined
 *   minimum height can legitimately exceed a short workspace (e.g. a small
 *   window with the status bar visible) — forcing every panel's bottom edge
 *   inside the box in that case is mathematically impossible without
 *   shrinking someone below their usable minimum. Panels that extend past
 *   the bottom in that situation are safely clipped by overflow-hidden,
 *   exactly like before; this only affects genuinely too-small workspaces; a
 *   properly-sized one is handled gap-perfectly by `defaultPanelsForWorkspace`.
 * – Finally resolves any residual pairwise overlap that independent per-panel
 *   clamping could still produce (e.g. two horizontal neighbours squeezed
 *   together by a sudden width drop) by nudging the later panel apart.
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

    // Width: shrink to fit / expand to minimum. Height: expand only, never
    // shrinks (see rationale above).
    w = Math.min(Math.max(mn.w, w), Math.max(mn.w, wsW - 2 * G));
    h = Math.max(mn.h, h);

    // Clamp X on both edges (safe: width is bounded to fit above).
    x = Math.max(G, Math.min(x, Math.max(G, wsW - w - G)));
    // Clamp Y only at the top edge — see rationale above.
    y = Math.max(G, y);

    normalized[id] = { x, y, w, h };
  }

  return resolveResidualOverlaps(normalized, wsW, wsH);
}

/**
 * Nudges any pair of panels that still violate the PANEL_GAP invariant apart,
 * along whichever axis needs the smaller correction, re-clamping to the
 * workspace after each nudge. Bounded to a few passes — with the small,
 * fixed panel set this converges immediately in every practical case; if it
 * ever can't fully resolve (workspace far too small for all four minimums)
 * it still leaves panels no worse than before, never crashes or loops.
 */
function resolveResidualOverlaps(
  panels: Record<PanelId, PanelRect>,
  wsW: number,
  wsH: number,
): Record<PanelId, PanelRect> {
  const G = PANEL_GAP;
  const ids: PanelId[] = ["flavors", "sizes", "payment", "cart"];
  const next = { ...panels };

  for (let pass = 0; pass < 4; pass++) {
    let touched = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = next[ids[i]];
        const b = next[ids[j]];
        const xSep = a.x < b.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
        const ySep = a.y < b.y ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
        if (xSep >= G || ySep >= G) continue; // sufficiently separated on at least one axis

        touched = true;
        const needX = G - xSep;
        const needY = G - ySep;
        if (needX <= needY) {
          if (a.x < b.x) {
            const maxX = Math.max(a.x + a.w + G, wsW - b.w - G);
            const nx = Math.min(b.x + needX, maxX);
            next[ids[j]] = { ...b, x: nx };
            const remaining = needX - (nx - b.x);
            if (remaining > 0) next[ids[i]] = { ...a, x: Math.max(G, a.x - remaining) };
          } else {
            const maxX = Math.max(b.x + b.w + G, wsW - a.w - G);
            const nx = Math.min(a.x + needX, maxX);
            next[ids[i]] = { ...a, x: nx };
            const remaining = needX - (nx - a.x);
            if (remaining > 0) next[ids[j]] = { ...b, x: Math.max(G, b.x - remaining) };
          }
        } else {
          if (a.y < b.y) {
            const maxY = Math.max(a.y + a.h + G, wsH - b.h - G);
            const ny = Math.min(b.y + needY, maxY);
            next[ids[j]] = { ...b, y: ny };
            const remaining = needY - (ny - b.y);
            if (remaining > 0) next[ids[i]] = { ...a, y: Math.max(G, a.y - remaining) };
          } else {
            const maxY = Math.max(b.y + b.h + G, wsH - a.h - G);
            const ny = Math.min(a.y + needY, maxY);
            next[ids[i]] = { ...a, y: ny };
            const remaining = needY - (ny - a.y);
            if (remaining > 0) next[ids[j]] = { ...b, y: Math.max(G, b.y - remaining) };
          }
        }
      }
    }
    if (!touched) break;
  }

  return next;
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
  // True once we know whether the user has ever saved a custom layout — lets
  // callers distinguish "still the estimate-based default" (safe to fully
  // recompute against the real workspace) from "user's saved layout" (only
  // ever clamp/normalise, never regenerate from scratch).
  const [hasSavedLayout, setHasSavedLayout] = useState(false);

  useEffect(() => {
    const saved = loadFromLS();
    const { vw, vh } = getWindowDims();
    if (saved) {
      // Normalise positions for the current viewport on load
      const wsH = Math.max(400, vh - HEADER_H);
      setPanels(normalizeLayout(saved, vw, wsH));
      setHasSavedLayout(true);
    } else {
      setPanels(defaultPanels(vw, vh));
      setHasSavedLayout(false);
    }
    setHydrated(true);
  }, []);

  const save = useCallback((p: Record<PanelId, PanelRect>) => {
    setPanels(p);
    saveToLS(p);
    setHasSavedLayout(true);
  }, []);

  /** Update in-memory state only – does NOT write to localStorage (used when overlap detected). */
  const updateState = useCallback((p: Record<PanelId, PanelRect>) => {
    setPanels(p);
  }, []);

  /**
   * Regenerate the default layout. Pass the REAL workspace content box
   * (container clientWidth/clientHeight) when known — this is what makes the
   * post-reset layout gap-perfect regardless of header/status-bar chrome.
   * Falls back to a window-based estimate if the container isn't measurable
   * yet (e.g. reset is somehow triggered before first paint).
   */
  const reset = useCallback((workspaceW?: number, workspaceH?: number) => {
    localStorage.removeItem(LS_KEY);
    const fresh =
      workspaceW && workspaceH
        ? defaultPanelsForWorkspace(workspaceW, workspaceH)
        : defaultPanels(getWindowDims().vw, getWindowDims().vh);
    setPanels(fresh);
    setHasSavedLayout(false);
  }, []);

  // Stable ref for access inside event listeners without re-subscribing
  const panelsRef = useRef(panels);
  useEffect(() => { panelsRef.current = panels; }, [panels]);

  return { panels, panelsRef, hydrated, hasSavedLayout, save, updateState, reset };
}
