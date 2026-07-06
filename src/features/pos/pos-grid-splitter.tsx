"use client";

import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

type SplitterProps = {
  /** Layout-Modus aktiv — nur dann sichtbar, ziehbar und mit Resize-Cursor. */
  active: boolean;
  /** Incremental pixel delta since the previous pointermove — caller just adds it on. */
  onDrag: (deltaPx: number) => void;
  testId: string;
};

// The grid gutter track itself is only 12px — a real mouse cursor easily
// overshoots that while the visible pill inside it is thinner still (4px).
// While active, the actual pointer-handling element balloons 8px past each
// edge of the track (via absolute positioning, so it doesn't affect grid
// sizing) to make grabbing it forgiving; the visible pill stays thin and
// centered. Inactive, it stays exactly track-sized so it never steals
// clicks meant for neighboring cards.
const HIT_OVERHANG_PX = 8;

export function VerticalSplitter({ active, onDrag, testId }: SplitterProps) {
  const lastXRef = useRef(0);
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!active) return;
    draggingRef.current = true;
    lastXRef.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [active]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const delta = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;
    if (delta !== 0) onDrag(delta);
  }, [onDrag]);

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  return (
    <div className="relative h-full w-full">
      <div
        data-testid={testId}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={cn(
          "select-none",
          // width is NOT set here while active: an explicit width (e.g.
          // Tailwind's w-full) wins over conflicting left/right insets on an
          // absolutely positioned box, silently cancelling the overhang.
          // left/right alone must be the only thing determining the box.
          active ? "absolute inset-y-0 z-10 cursor-col-resize" : "h-full w-full"
        )}
        style={active ? { touchAction: "none", left: -HIT_OVERHANG_PX, right: -HIT_OVERHANG_PX } : undefined}
      >
        {active && (
          <div className="pointer-events-none absolute inset-y-1 left-1/2 w-1 -translate-x-1/2 rounded-full bg-primaq-400/70" />
        )}
      </div>
    </div>
  );
}

export function HorizontalSplitter({ active, onDrag, testId }: SplitterProps) {
  const lastYRef = useRef(0);
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!active) return;
    draggingRef.current = true;
    lastYRef.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [active]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const delta = e.clientY - lastYRef.current;
    lastYRef.current = e.clientY;
    if (delta !== 0) onDrag(delta);
  }, [onDrag]);

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  return (
    <div className="relative h-full w-full">
      <div
        data-testid={testId}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={cn(
          "select-none",
          // height is NOT set here while active — see VerticalSplitter for why
          // an explicit height would cancel the top/bottom overhang.
          active ? "absolute inset-x-0 z-10 cursor-row-resize" : "h-full w-full"
        )}
        style={active ? { touchAction: "none", top: -HIT_OVERHANG_PX, bottom: -HIT_OVERHANG_PX } : undefined}
      >
        {active && (
          <div className="pointer-events-none absolute inset-x-1 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primaq-400/70" />
        )}
      </div>
    </div>
  );
}
