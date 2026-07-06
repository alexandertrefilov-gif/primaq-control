"use client";

import { useCallback, useEffect, useState } from "react";

// Per-device grid track sizes for the fixed sales-view quadrant layout.
// This is deliberately plain localStorage (not Dexie/dbSet, not synced via
// enqueueSettingsSync) — every device keeps its own resize, never synced to
// Supabase and never shared between devices.

export type PosGridLayout = {
  columns: {
    /** Placeholder weight for the flexible Sorte column — with Größe fixed
     *  at middlePx, Sorte is the sole flex-grow consumer, so its rendered
     *  width is always "whatever remains" regardless of this value's
     *  magnitude. Kept for schema completeness / potential future use. */
    flavorsFr: number;
    middlePx: number; // Größe-Spalte (oben)
    cartPx: number;   // Warenkorb-Spalte
  };
  rows: {
    topPx: number;    // Sorte/Größe-Zeile
    bottomPx: number; // Betrag/Zahlungsmittel-Zeile
  };
  /** Independent flex-grow weights splitting the bottom row between Betrag
   *  and Zahlungsmittel. Sentinel {0, 0} ("never customized") means: mirror
   *  the top row's Sorte/Größe split exactly, so Größe and Zahlungsmittel
   *  stay visually aligned in the same column by default. The moment
   *  Splitter E is dragged, real positive pixel weights are stored and the
   *  bottom row permanently decouples from the top row from then on. After
   *  clampGridLayout, non-sentinel values hold the actual current pixel
   *  widths (valid directly as flex-grow weights with flex-basis 0). */
  bottomSplit: {
    amountFr: number;
    paymentFr: number;
  };
  updatedAt: string;
};

export const GRID_GUTTER_PX = 12;

export const GRID_MIN = {
  flavorsWidth: 460,
  flavorsHeight: 360,
  sizeWidth: 260,
  sizeHeight: 300,
  amountWidth: 420,
  amountHeight: 220,
  paymentWidth: 300,
  paymentHeight: 220,
  cartWidth: 340,
} as const;

export const TOP_ROW_MIN = Math.max(GRID_MIN.flavorsHeight, GRID_MIN.sizeHeight);
export const BOTTOM_ROW_MIN = Math.max(GRID_MIN.amountHeight, GRID_MIN.paymentHeight);
export const LEFT_AREA_MIN_WIDTH = Math.max(
  GRID_MIN.flavorsWidth + GRID_GUTTER_PX + GRID_MIN.sizeWidth,
  GRID_MIN.amountWidth + GRID_GUTTER_PX + GRID_MIN.paymentWidth
);

export const DEFAULT_GRID_LAYOUT: PosGridLayout = {
  columns: { flavorsFr: 1, middlePx: 340, cartPx: 420 },
  rows: { topPx: 560, bottomPx: 300 },
  bottomSplit: { amountFr: 0, paymentFr: 0 },
  updatedAt: "",
};

const LS_KEY = "primaq-pos-grid-layout-v1";
// Legacy free/device-panel engines from an earlier layout system — never
// read for defaults, only ever removed defensively on reset.
const LEGACY_KEYS = ["primaq-pos-free-layout-v1", "primaq-pos-device-layout-v1"];

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readFromStorage(): PosGridLayout {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_GRID_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<{
      columns: Partial<PosGridLayout["columns"]>;
      rows: Partial<PosGridLayout["rows"]>;
      bottomSplit: Partial<PosGridLayout["bottomSplit"]>;
      updatedAt: string;
    }>;
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_GRID_LAYOUT;
    const columns = parsed.columns ?? {};
    const rows = parsed.rows ?? {};
    const bottomSplit = parsed.bottomSplit ?? {};
    return {
      columns: {
        flavorsFr: num(columns.flavorsFr, DEFAULT_GRID_LAYOUT.columns.flavorsFr),
        middlePx: num(columns.middlePx, DEFAULT_GRID_LAYOUT.columns.middlePx),
        cartPx: num(columns.cartPx, DEFAULT_GRID_LAYOUT.columns.cartPx),
      },
      rows: {
        topPx: num(rows.topPx, DEFAULT_GRID_LAYOUT.rows.topPx),
        bottomPx: num(rows.bottomPx, DEFAULT_GRID_LAYOUT.rows.bottomPx),
      },
      bottomSplit: {
        amountFr: num(bottomSplit.amountFr, DEFAULT_GRID_LAYOUT.bottomSplit.amountFr),
        paymentFr: num(bottomSplit.paymentFr, DEFAULT_GRID_LAYOUT.bottomSplit.paymentFr),
      },
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return DEFAULT_GRID_LAYOUT;
  }
}

type GridLayoutPatch = {
  columns?: Partial<PosGridLayout["columns"]>;
  rows?: Partial<PosGridLayout["rows"]>;
  bottomSplit?: Partial<PosGridLayout["bottomSplit"]>;
};

export function usePosGridLayoutStore() {
  const [layout, setLayout] = useState<PosGridLayout>(DEFAULT_GRID_LAYOUT);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLayout(readFromStorage());
    setHydrated(true);
  }, []);

  const update = useCallback((patch: GridLayoutPatch) => {
    setLayout((prev) => {
      const next: PosGridLayout = {
        columns: { ...prev.columns, ...patch.columns },
        rows: { ...prev.rows, ...patch.rows },
        bottomSplit: { ...prev.bottomSplit, ...patch.bottomSplit },
        updatedAt: new Date().toISOString(),
      };
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

/**
 * Clamps stored track sizes against the grid container's live pixel size so
 * a saved layout from a wider/taller device never causes overlap or a
 * horizontal scrollbar. Every track is floored at its GRID_MIN — even on a
 * viewport too small to fit all minimums at once, since GRID_MIN is already
 * the smallest legal configuration; the container's own overflow-y-auto
 * handles any residual vertical overflow, and the flexible Sorte column
 * absorbs width instead of ever overflowing horizontally.
 *
 * The bottom row's amount/payment split is independent of the top row's
 * Sorte/Größe split: both are flex-grow based, so they always exactly fill
 * the shared left-area width with no separate overflow risk — clamping here
 * only keeps the *ratio* from pushing either side below its own minimum.
 */
export function clampGridLayout(
  raw: PosGridLayout,
  containerWidth: number,
  containerHeight: number
): PosGridLayout {
  let { middlePx, cartPx } = raw.columns;
  let { topPx, bottomPx } = raw.rows;
  let { amountFr, paymentFr } = raw.bottomSplit;

  if (containerWidth > 0) {
    const cartMax = containerWidth - LEFT_AREA_MIN_WIDTH - GRID_GUTTER_PX;
    cartPx = clamp(cartPx, GRID_MIN.cartWidth, Math.max(GRID_MIN.cartWidth, cartMax));

    const leftAreaWidth = containerWidth - cartPx - GRID_GUTTER_PX;
    const middleMax = leftAreaWidth - GRID_MIN.flavorsWidth - GRID_GUTTER_PX;
    middlePx = clamp(middlePx, GRID_MIN.sizeWidth, Math.max(GRID_MIN.sizeWidth, middleMax));

    const bottomAvail = Math.max(leftAreaWidth - GRID_GUTTER_PX, 0);
    const notCustomized = amountFr <= 0 && paymentFr <= 0;
    // Sentinel: mirror the top row's Sorte/Größe split so Größe (oben) and
    // Zahlungsmittel (unten) stay in the same column until the user
    // explicitly drags Splitter E.
    const flavorsWidth = Math.max(leftAreaWidth - middlePx - GRID_GUTTER_PX, 0);
    const desiredAmountPx = notCustomized ? flavorsWidth : bottomAvail * (amountFr / (amountFr + paymentFr));
    let amountPx = clamp(
      desiredAmountPx,
      GRID_MIN.amountWidth,
      Math.max(GRID_MIN.amountWidth, bottomAvail - GRID_MIN.paymentWidth)
    );
    amountFr = amountPx;
    paymentFr = Math.max(bottomAvail - amountPx, 0);
  } else {
    cartPx = Math.max(cartPx, GRID_MIN.cartWidth);
    middlePx = Math.max(middlePx, GRID_MIN.sizeWidth);
    // No live measurement yet (container not attached/observed at all) —
    // fall back to an even split rather than the {0,0} sentinel, which
    // would render both bottom-row areas at zero width.
    if (amountFr <= 0 && paymentFr <= 0) {
      amountFr = 1;
      paymentFr = 1;
    }
  }

  if (containerHeight > 0) {
    const bottomMax = containerHeight - TOP_ROW_MIN - GRID_GUTTER_PX;
    bottomPx = clamp(bottomPx, BOTTOM_ROW_MIN, Math.max(BOTTOM_ROW_MIN, bottomMax));

    const topMax = containerHeight - bottomPx - GRID_GUTTER_PX;
    topPx = clamp(topPx, TOP_ROW_MIN, Math.max(TOP_ROW_MIN, topMax));
  } else {
    topPx = Math.max(topPx, TOP_ROW_MIN);
    bottomPx = Math.max(bottomPx, BOTTOM_ROW_MIN);
  }

  return {
    columns: {
      flavorsFr: raw.columns.flavorsFr > 0 ? raw.columns.flavorsFr : DEFAULT_GRID_LAYOUT.columns.flavorsFr,
      middlePx,
      cartPx,
    },
    rows: { topPx, bottomPx },
    bottomSplit: { amountFr, paymentFr },
    updatedAt: raw.updatedAt,
  };
}
