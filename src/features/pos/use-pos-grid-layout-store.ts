"use client";

import { useCallback, useEffect, useState } from "react";

// Per-device grid track sizes for the fixed sales-view quadrant layout.
// This is deliberately plain localStorage (not Dexie/dbSet, not synced via
// enqueueSettingsSync) — every device keeps its own resize, never synced to
// Supabase and never shared between devices.
//
// Only RASTER (shared grid-line) values are stored — never per-panel
// rectangles. Sorte (Bereich 1) and Betrag (Bereich 3) always share column A;
// Größe (Bereich 2) and Zahlungsmittel (Bereich 4) always share column B;
// Warenkorb is column C, spanning both rows. Moving a splitter always moves
// a shared grid line, so both panels on either side of it resize together —
// no panel can ever grow or shrink independently of the raster.

export type PosGridLayout = {
  /** Fractions of the available grid width; colA + colB + colC === 1. */
  colA: number;
  colB: number;
  colC: number;
  /** Fractions of the available grid height; topRow + bottomRow === 1. */
  topRow: number;
  bottomRow: number;
  updatedAt: string;
};

export const GRID_GUTTER_PX = 12;

export const COL_MIN = { a: 480, b: 300, c: 340 } as const;
export const ROW_MIN = { top: 380, bottom: 260 } as const;

export const DEFAULT_GRID_LAYOUT: PosGridLayout = {
  colA: 0.47,
  colB: 0.25,
  colC: 0.28,
  topRow: 0.58,
  bottomRow: 0.42,
  updatedAt: "",
};

const LS_KEY = "primaq-pos-grid-layout-v1";
// Legacy free/device-panel engines from an earlier layout system — never
// read for defaults, only ever removed defensively on reset.
const LEGACY_KEYS = ["primaq-pos-free-layout-v1", "primaq-pos-device-layout-v1"];

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Scales a, b, c proportionally so they sum to exactly 1. */
function normalize3(a: number, b: number, c: number): [number, number, number] {
  const sum = a + b + c;
  if (!(sum > 0)) return [DEFAULT_GRID_LAYOUT.colA, DEFAULT_GRID_LAYOUT.colB, DEFAULT_GRID_LAYOUT.colC];
  return [a / sum, b / sum, c / sum];
}

function normalize2(a: number, b: number): [number, number] {
  const sum = a + b;
  if (!(sum > 0)) return [DEFAULT_GRID_LAYOUT.topRow, DEFAULT_GRID_LAYOUT.bottomRow];
  return [a / sum, b / sum];
}

function readFromStorage(): PosGridLayout {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_GRID_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<PosGridLayout>;
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_GRID_LAYOUT;
    const [colA, colB, colC] = normalize3(
      num(parsed.colA, DEFAULT_GRID_LAYOUT.colA),
      num(parsed.colB, DEFAULT_GRID_LAYOUT.colB),
      num(parsed.colC, DEFAULT_GRID_LAYOUT.colC)
    );
    const [topRow, bottomRow] = normalize2(
      num(parsed.topRow, DEFAULT_GRID_LAYOUT.topRow),
      num(parsed.bottomRow, DEFAULT_GRID_LAYOUT.bottomRow)
    );
    return {
      colA,
      colB,
      colC,
      topRow,
      bottomRow,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return DEFAULT_GRID_LAYOUT;
  }
}

export function usePosGridLayoutStore() {
  const [layout, setLayout] = useState<PosGridLayout>(DEFAULT_GRID_LAYOUT);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLayout(readFromStorage());
    setHydrated(true);
  }, []);

  const update = useCallback((patch: Partial<Omit<PosGridLayout, "updatedAt">>) => {
    setLayout((prev) => {
      const merged = { ...prev, ...patch };
      const [colA, colB, colC] = normalize3(merged.colA, merged.colB, merged.colC);
      const [topRow, bottomRow] = normalize2(merged.topRow, merged.bottomRow);
      const next: PosGridLayout = { colA, colB, colC, topRow, bottomRow, updatedAt: new Date().toISOString() };
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch { /* ignore quota errors */ }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(LS_KEY);
      for (const key of LEGACY_KEYS) localStorage.removeItem(key);
    } catch { /* ignore */ }
    setLayout(DEFAULT_GRID_LAYOUT);
  }, []);

  return { layout, hydrated, update, reset };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export type ClampedGridPx = {
  colAPx: number;
  colBPx: number;
  colCPx: number;
  topRowPx: number;
  bottomRowPx: number;
};

/**
 * Converts stored fractions into concrete pixel track sizes for the current
 * container size, flooring every track at its GRID_MIN — even on a viewport
 * too small to fit all minimums at once, since that floor is already the
 * smallest legal configuration; the container's own overflow-y-auto handles
 * any residual vertical overflow. Never returns fractions directly — the
 * caller feeds these px values straight into CSS custom properties, so a
 * `minmax(min-px, var(--col-a))` grid-template can never overlap or clip a
 * panel below its floor.
 */
export function clampGridLayout(
  raw: PosGridLayout,
  containerWidth: number,
  containerHeight: number
): ClampedGridPx {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return {
      colAPx: COL_MIN.a,
      colBPx: COL_MIN.b,
      colCPx: COL_MIN.c,
      topRowPx: ROW_MIN.top,
      bottomRowPx: ROW_MIN.bottom,
    };
  }

  const availWidth = Math.max(containerWidth - GRID_GUTTER_PX * 2, 0);
  const colMinSum = COL_MIN.a + COL_MIN.b + COL_MIN.c;
  let colAPx: number, colBPx: number, colCPx: number;
  if (colMinSum > availWidth) {
    // Viewport too narrow to honor every column's floor at once — scale all
    // three floors down proportionally so they still sum to availWidth
    // exactly (never overflow/cut off a main area, per spec).
    colAPx = (availWidth * COL_MIN.a) / colMinSum;
    colBPx = (availWidth * COL_MIN.b) / colMinSum;
    colCPx = availWidth - colAPx - colBPx;
  } else {
    colAPx = clamp(raw.colA * availWidth, COL_MIN.a, Math.max(COL_MIN.a, availWidth - COL_MIN.b - COL_MIN.c));
    colBPx = clamp(raw.colB * availWidth, COL_MIN.b, Math.max(COL_MIN.b, availWidth - colAPx - COL_MIN.c));
    colCPx = Math.max(availWidth - colAPx - colBPx, COL_MIN.c);
  }

  const availHeight = Math.max(containerHeight - GRID_GUTTER_PX, 0);
  const rowMinSum = ROW_MIN.top + ROW_MIN.bottom;
  let topRowPx: number, bottomRowPx: number;
  if (rowMinSum > availHeight) {
    // Same proportional-reduction fallback for rows.
    topRowPx = (availHeight * ROW_MIN.top) / rowMinSum;
    bottomRowPx = availHeight - topRowPx;
  } else {
    topRowPx = clamp(raw.topRow * availHeight, ROW_MIN.top, Math.max(ROW_MIN.top, availHeight - ROW_MIN.bottom));
    bottomRowPx = Math.max(availHeight - topRowPx, ROW_MIN.bottom);
  }

  return { colAPx, colBPx, colCPx, topRowPx, bottomRowPx };
}
