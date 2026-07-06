"use client";

import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, createContext, useContext } from "react";
import { Banknote, CreditCard, Eye, Minus, Plus, QrCode, ShoppingCart, Trash2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/utils";
import { usePosStore } from "./use-pos-store";
import { usePosFlavorStore } from "./use-pos-flavor-store";
import { usePosLayoutStore } from "./use-pos-layout-store";
import { useGuidedModeStore } from "./use-guided-mode-store";
import { useAdmin } from "./admin-context";
import type { CartFontSize, PaymentConfig, TextColorMode } from "./use-pos-layout-store";
import { computeTextColor, cardSizeClamp } from "./use-pos-layout-store";
import {
  usePosGridLayoutStore,
  clampGridLayout,
  clamp,
  COL_MIN,
  ROW_MIN,
  GRID_GUTTER_PX,
} from "./use-pos-grid-layout-store";
import { VerticalSplitter, HorizontalSplitter } from "./pos-grid-splitter";
import {
  FLAVORS,
  MACHINE_GROUP_LABELS,
  SIZES,
  getSizeName,
} from "./pos-config";
import type { FlavorConfig, SizeConfig } from "./pos-config";
import type { CartItem, Order, PaymentMethod } from "./pos-types";

type EffectiveSizeConfig = SizeConfig & {
  backgroundColor: string;
  textColorMode: TextColorMode;
  imageDataUrl: string | null;
  imageScale: number;
  showAsQuickAmount: boolean;
};

// Dynamic flavor context – populated by SalesPage from usePosFlavorStore
const FlavorsCtx = createContext<import("./pos-config").FlavorConfig[]>(FLAVORS);
function useFlavorList() { return useContext(FlavorsCtx); }

function fmt(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  bar: "Bar",
  karte: "Karte",
  qr: "QR",
};

const DEFAULT_PAYMENT_BILLS = [500, 1000, 2000, 5000];

// ── Robust image with automatic fallback ─────────────────────────────────────

function ProductImage({
  src,
  fallbackSrc,
  alt,
  className,
  style,
}: {
  src?: string;
  fallbackSrc?: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const initial = src ?? fallbackSrc;
  const [imgSrc, setImgSrc] = useState(initial);
  const [failed, setFailed] = useState(!initial);

  if (failed || !imgSrc) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imgSrc}
      alt={alt}
      draggable={false}
      className={className}
      style={style}
      onError={() => {
        if (fallbackSrc && imgSrc !== fallbackSrc) {
          setImgSrc(fallbackSrc);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}

// ── Unified flavor image renderer ────────────────────────────────────────────
// Direct <img> – no wrapper state, no background, transparent areas show
// the parent's colored background. Used identically in every flavor context.

function FlavorImage({ src, alt = "", scale = 100, className }: {
  src?: string | null;
  alt?: string;
  scale?: number;
  className?: string;
}) {
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={cn("block h-full w-full object-contain bg-transparent", className)}
      style={{ transform: `scale(${scale / 100})`, transformOrigin: "center" }}
    />
  );
}

// ── Flavor card ──────────────────────────────────────────────────────────────

function FlavorCard({
  flavor,
  onClick,
  isSelected = false,
  guidedMode = false,
  hasAnySelection = false,
}: {
  flavor: FlavorConfig;
  onClick: () => void;
  isSelected?: boolean;
  guidedMode?: boolean;
  hasAnySelection?: boolean;
}) {
  const allFlavors = useFlavorList();
  const isMix = !!flavor.isMix && !!flavor.mixColors;
  const part1 = isMix && flavor.mixParts ? allFlavors.find((f) => f.id === flavor.mixParts![0]) : null;
  const part2 = isMix && flavor.mixParts ? allFlavors.find((f) => f.id === flavor.mixParts![1]) : null;

  return (
    <button
      aria-label={flavor.name}
      onClick={onClick}
      className={cn(
        "group relative flex w-full flex-col select-none focus-visible:outline-none overflow-hidden",
        "transition-all duration-200",
        "group-hover:brightness-110 group-active:scale-[0.96]",
        isSelected
          ? "ring-[3px] ring-[#22c55e] scale-[1.04]"
          : "ring-0",
        guidedMode && !isSelected && hasAnySelection && "opacity-50",
      )}
      style={{
        borderRadius: "var(--pos-card-radius)",
        ...(isSelected ? { boxShadow: "0 0 22px rgba(34,197,94,0.45)" } : {}),
      }}
    >
      {/* Square card – aspect-square fills the column width */}
      <div
        className="relative w-full aspect-square overflow-hidden shadow-lg"
        style={{ borderRadius: "var(--pos-card-radius)" }}
      >
        {/* Background */}
        {isMix ? (
          <>
            <div
              className="absolute inset-0"
              style={{ background: `linear-gradient(135deg, ${flavor.mixColors![0]} 0% 50%, ${flavor.mixColors![1]} 50% 100%)` }}
            />
            <div className="absolute inset-0 bg-black/10" />
          </>
        ) : (
          <div className="absolute inset-0" style={{ background: flavor.backgroundColor }} />
        )}

        {/* Mix images at diagonal quadrants */}
        {isMix && part1?.imageSrc && (
          <div className="pointer-events-none absolute left-[30%] top-[30%] h-[44%] w-[44%] -translate-x-1/2 -translate-y-1/2 overflow-hidden">
            <FlavorImage src={part1.imageSrc} alt="" scale={part1.imageScale ?? 100} className="drop-shadow-md" />
          </div>
        )}
        {isMix && part2?.imageSrc && (
          <div className="pointer-events-none absolute left-[70%] top-[70%] h-[44%] w-[44%] -translate-x-1/2 -translate-y-1/2 overflow-hidden">
            <FlavorImage src={part2.imageSrc} alt="" scale={part2.imageScale ?? 100} className="drop-shadow-md" />
          </div>
        )}

        {/* Single flavor image – fills 80% of card, centered */}
        {!isMix && flavor.imageSrc && (
          <div className="pointer-events-none absolute inset-[10%] flex items-center justify-center">
            <FlavorImage src={flavor.imageSrc} alt="" scale={flavor.imageScale ?? 100} className="drop-shadow-xl" />
          </div>
        )}

        {/* Depth vignette overlay */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ boxShadow: "inset 0 -8px 20px rgba(0,0,0,0.25), inset 0 2px 8px rgba(255,255,255,0.10)" }}
        />

        {/* Name overlay – gradient strip at bottom */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent pt-5 pb-2 px-2">
          <span className="block text-center text-sm font-black text-white leading-tight line-clamp-2 drop-shadow-md">
            {flavor.name}
          </span>
        </div>

        {/* Selected checkmark */}
        {isSelected && (
          <div className="absolute right-2 top-2 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-[#22c55e] text-[10px] font-black text-white shadow">
            ✓
          </div>
        )}
      </div>
    </button>
  );
}

// ── Cart item badge – flavor icon on flavor background ───────────────────────

function CartItemBadge({ item, large }: { item: CartItem; large?: boolean }) {
  const allFlavors = useFlavorList();
  const flavor = allFlavors.find((f) => f.id === item.flavor);

  if (!flavor) {
    return <div className={cn("shrink-0 rounded-full bg-black/10", large ? "h-14 w-14" : "h-9 w-9")} />;
  }

  const isMix = !!flavor.isMix && !!flavor.mixColors;
  const part1 = isMix && flavor.mixParts ? allFlavors.find((f) => f.id === flavor.mixParts![0]) : null;
  const part2 = isMix && flavor.mixParts ? allFlavors.find((f) => f.id === flavor.mixParts![1]) : null;

  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-full", large ? "h-14 w-14" : "h-9 w-9")}>
      {isMix ? (
        <>
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(135deg, ${flavor.mixColors![0]} 0% 50%, ${flavor.mixColors![1]} 50% 100%)` }}
          />
        </>
      ) : (
        <div className="absolute inset-0" style={{ background: flavor.backgroundColor }} />
      )}
      {/* Mix icons: circular containers, same logic as FlavorCard */}
      {isMix && part1?.imageSrc && (
        <div className="absolute left-[32%] top-[32%] h-[42%] w-[42%] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full">
          <FlavorImage src={part1.imageSrc} alt="" scale={part1.imageScale ?? 100} className="drop-shadow-sm" />
        </div>
      )}
      {isMix && part2?.imageSrc && (
        <div className="absolute left-[68%] top-[68%] h-[42%] w-[42%] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full">
          <FlavorImage src={part2.imageSrc} alt="" scale={part2.imageScale ?? 100} className="drop-shadow-sm" />
        </div>
      )}
      {!isMix && flavor.imageSrc && (
        <div className="absolute inset-[8%] flex items-center justify-center overflow-hidden rounded-full">
          <FlavorImage src={flavor.imageSrc} alt="" scale={flavor.imageScale ?? 100} className="drop-shadow-sm" />
        </div>
      )}
    </div>
  );
}

// ── Delete button – 2-tap confirmation with 3-second auto-reset ──────────────

function DeleteButton({ itemId, onRemove }: { itemId: string; onRemove: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleClick = useCallback(() => {
    if (!confirming) {
      setConfirming(true);
      timerRef.current = setTimeout(() => setConfirming(false), 3000);
    } else {
      clearTimeout(timerRef.current);
      onRemove(itemId);
    }
  }, [confirming, itemId, onRemove]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return confirming ? (
    <button
      onClick={handleClick}
      className="h-11 rounded-lg bg-red-500 px-2.5 text-[11px] font-black text-white transition-colors active:scale-95"
    >
      Löschen?
    </button>
  ) : (
    <button
      onClick={handleClick}
      className="grid h-11 w-11 place-items-center rounded-full pos-text-dim hover:bg-red-500/15 hover:text-red-400 active:scale-90 transition-all"
    >
      <X className="h-4 w-4" />
    </button>
  );
}

// ── Machine flavor group ──────────────────────────────────────────────────────

function FlavorGroup({
  label,
  flavors,
  onFlavorClick,
  selectedFlavorId,
  guidedMode = false,
}: {
  label: string;
  flavors: FlavorConfig[];
  onFlavorClick: (flavor: FlavorConfig) => void;
  selectedFlavorId: string | null;
  guidedMode?: boolean;
}) {
  if (flavors.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {/* Centered divider header */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px pos-divider" />
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-primaq-400 px-1">
          {label}
        </span>
        <div className="flex-1 h-px pos-divider" />
      </div>
      {/* auto-fit + justify-center → cards always centered, shared --pos-card-size columns */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, var(--pos-card-size))",
          gap: "var(--pos-card-gap)",
          justifyContent: "center",
        }}
      >
        {flavors.map((f) => (
          <FlavorCard
            key={f.id}
            flavor={f}
            onClick={() => onFlavorClick(f)}
            isSelected={f.id === selectedFlavorId}
            guidedMode={guidedMode}
            hasAnySelection={selectedFlavorId !== null}
          />
        ))}
      </div>
    </div>
  );
}

// ── Size picker modal – large touch-optimised overlay after flavor tap ────────

function SizePickerModal({
  flavor,
  sizes,
  onPick,
  onClose,
}: {
  flavor: FlavorConfig;
  sizes: EffectiveSizeConfig[];
  onPick: (sizeId: string, priceCents: number) => void;
  onClose: () => void;
}) {
  const allFlavors = useFlavorList();
  const isMix = !!flavor.isMix && !!flavor.mixColors;
  const part1 = isMix && flavor.mixParts ? allFlavors.find((f) => f.id === flavor.mixParts![0]) : null;
  const part2 = isMix && flavor.mixParts ? allFlavors.find((f) => f.id === flavor.mixParts![1]) : null;

  const colCount = Math.min(Math.max(sizes.length, 1), 3);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[3px] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[820px] max-h-[90vh] overflow-y-auto overflow-x-hidden rounded-[36px] pos-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header: large flavor circle + name ── */}
        <div className="flex items-center gap-6 border-b pos-border-c px-8 py-7">
          {/* Flavor circle 96 px – identical render logic as FlavorCard */}
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full shadow-lg">
            {isMix && flavor.mixColors ? (
              <>
                <div className="absolute inset-0"
                  style={{ background: `linear-gradient(135deg, ${flavor.mixColors[0]} 0% 50%, ${flavor.mixColors[1]} 50% 100%)` }} />
                <div className="absolute inset-0 bg-black/10" />
              </>
            ) : (
              <div className="absolute inset-0" style={{ background: flavor.backgroundColor }} />
            )}
            {isMix && part1?.imageSrc && (
              <div className="pointer-events-none absolute left-[32%] top-[32%] h-[42%] w-[42%] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full">
                <FlavorImage src={part1.imageSrc} alt="" scale={part1.imageScale ?? 100} />
              </div>
            )}
            {isMix && part2?.imageSrc && (
              <div className="pointer-events-none absolute left-[68%] top-[68%] h-[42%] w-[42%] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full">
                <FlavorImage src={part2.imageSrc} alt="" scale={part2.imageScale ?? 100} />
              </div>
            )}
            {!isMix && flavor.imageSrc && (
              <div className="pointer-events-none absolute inset-[8%] flex items-center justify-center overflow-hidden rounded-full">
                <FlavorImage src={flavor.imageSrc} alt="" scale={flavor.imageScale ?? 100} />
              </div>
            )}
          </div>

          {/* Name */}
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-widest pos-text-label">
              Gewählte Sorte
            </p>
            <p className="truncate text-4xl font-black leading-tight pos-text">
              {flavor.name}
            </p>
          </div>
        </div>

        {/* ── Section label ── */}
        <div className="px-8 pb-4 pt-7">
          <p className="text-[11px] font-bold uppercase tracking-widest pos-text-label">Größe wählen</p>
        </div>

        {/* ── Size cards ── */}
        <div className="px-6 pb-5">
          {sizes.length === 0 ? (
            <p className="py-10 text-center text-base font-semibold pos-text-muted">
              Keine Größe aktiv. Bitte in Einstellungen aktivieren.
            </p>
          ) : (
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}
            >
              {sizes.map((size) => {
                const textColor = computeTextColor(size.textColorMode, size.backgroundColor);
                const hasImage = !!(size.imageDataUrl || size.imageSrc);
                return (
                  <button
                    key={size.id}
                    onClick={() => onPick(size.id, size.priceCents)}
                    className="flex min-h-[140px] w-full overflow-hidden rounded-3xl shadow-md transition-all active:scale-[0.96] hover:brightness-95 select-none"
                    style={{ backgroundColor: size.backgroundColor }}
                  >
                    {/* Left: image column */}
                    {hasImage && (
                      <div className="relative w-32 shrink-0 overflow-hidden">
                        {size.imageDataUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={size.imageDataUrl}
                            alt=""
                            draggable={false}
                            className="absolute inset-0 h-full w-full object-contain drop-shadow-lg"
                            style={{ transform: `scale(${(size.imageScale ?? 100) / 100})`, transformOrigin: "center" }}
                          />
                        ) : (
                          <ProductImage
                            src={size.imageSrc}
                            fallbackSrc={size.fallbackImageSrc}
                            alt=""
                            className="absolute inset-0 h-full w-full object-contain drop-shadow-lg"
                            style={{ transform: `scale(${(size.imageScale ?? 100) / 100})`, transformOrigin: "center" }}
                          />
                        )}
                      </div>
                    )}

                    {/* Right: name + price */}
                    <div className={cn(
                      "flex flex-col justify-center gap-1.5",
                      hasImage ? "px-5 py-5" : "px-7 py-5"
                    )}>
                      <span
                        className="text-3xl font-black leading-tight"
                        style={{ color: textColor }}
                      >
                        {size.name}
                      </span>
                      <span
                        className="text-2xl font-black tabular-nums"
                        style={{ color: textColor, opacity: 0.70 }}
                      >
                        {fmt(size.priceCents)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Cancel ── */}
        <div className="px-6 pb-7">
          <button
            onClick={onClose}
            className="h-[60px] w-full rounded-2xl pos-overlay pos-overlay-hover pos-overlay-active text-lg font-semibold pos-text-muted transition-colors"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Middle column – flavors only (sizes live in SizeRow below) ───────────────

function FlavorColumn({
  onFlavorClick,
  pendingFlavor,
  guidedMode = false,
  guidedActive = false,
}: {
  onFlavorClick: (flavor: FlavorConfig) => void;
  pendingFlavor: FlavorConfig | null;
  guidedMode?: boolean;
  guidedActive?: boolean;
}) {
  const allFlavors = useFlavorList();
  const groups = Object.entries(MACHINE_GROUP_LABELS);

  return (
    <div
      data-testid="flavor-zone"
      data-guided-active={guidedMode && guidedActive ? "true" : undefined}
      className={cn(
        // h-full + flex-col: fills the FreeDashboardPanel body entirely
        "h-full flex flex-col rounded-2xl pos-surface overflow-hidden transition-all",
        guidedMode && guidedActive && "ring-2 ring-[#00D6A3]/50"
      )}
    >
      <div className="flex-none px-3 pt-2 pb-1.5">
        <p className={cn(
          "text-[11px] font-bold uppercase tracking-widest transition-colors",
          guidedMode && guidedActive ? "text-[#00D6A3]" : "pos-text-label"
        )}>
          1. Sorte wählen
        </p>
      </div>
      {/* Scrollable flavor list – flex-1 fills remaining panel height */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 space-y-2">
        {groups.map(([groupId, groupLabel]) => {
          const flavors = allFlavors.filter((f) => f.group === groupId);
          return (
            <FlavorGroup
              key={groupId}
              label={groupLabel}
              flavors={flavors}
              onFlavorClick={onFlavorClick}
              selectedFlavorId={pendingFlavor?.id ?? null}
              guidedMode={guidedMode}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Size row – standalone grid zone between flavors and payment ───────────────

function SizeRow({
  effectiveSizes,
  pendingFlavor,
  onSizePick,
  guidedMode = false,
  guidedActive = false,
}: {
  effectiveSizes: EffectiveSizeConfig[];
  pendingFlavor: FlavorConfig | null;
  onSizePick: (sizeId: string, priceCents: number) => void;
  guidedMode?: boolean;
  guidedActive?: boolean;
}) {
  const active = !!pendingFlavor;
  return (
    <div
      data-testid="size-zone"
      data-guided-active={guidedMode && guidedActive ? "true" : undefined}
      className={cn(
        // h-full: fills its grid cell; vertical column of size cards next to Sorten
        "h-full flex flex-col gap-2 rounded-2xl pos-section overflow-auto p-2 transition-all",
        guidedMode && guidedActive && "guided-ring-pulse"
      )}
    >
      {guidedMode && guidedActive && (
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#00D6A3]/15 px-2.5 py-0.5 text-xs font-black uppercase tracking-widest text-[#00D6A3]">
            Schritt 2 von 4
          </span>
        </div>
      )}
      <p className="text-[11px] font-bold uppercase tracking-widest pos-text-label">
        2. Größe wählen
      </p>
      {effectiveSizes.length === 0 ? (
        <p className="py-2 text-center text-sm pos-text-dim">
          Keine Größe aktiv – bitte in Einstellungen aktivieren.
        </p>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto"
          style={{ gap: "var(--pos-card-gap)" }}
        >
          {effectiveSizes.map((size) => {
            const isActive = active;
            const bgColor = isActive ? (size.backgroundColor === "#ffffff" ? "#D9B15D" : size.backgroundColor) : size.backgroundColor;
            const textColor = isActive ? computeTextColor(size.textColorMode, bgColor) : "color-mix(in srgb, var(--pos-text) 35%, transparent)";
            return (
              <button
                key={size.id}
                data-testid={`size-btn-${size.id}`}
                onClick={() => { if (isActive) onSizePick(size.id, size.priceCents); }}
                className={cn(
                  "shrink-0 flex flex-col items-center justify-center gap-1 transition-all duration-200 select-none",
                  isActive
                    ? "shadow-md hover:brightness-110 active:scale-[0.97]"
                    : "opacity-35 pointer-events-none cursor-not-allowed"
                )}
                style={{
                  backgroundColor: bgColor,
                  width: "var(--pos-size-card-size)",
                  height: "var(--pos-size-card-size)",
                  borderRadius: "var(--pos-card-radius)",
                }}
                aria-disabled={!isActive}
              >
                <span className="text-xl font-black leading-tight text-center" style={{ color: textColor }}>
                  {size.name}
                </span>
                <span className="text-lg font-black tabular-nums leading-none" style={{ color: textColor, opacity: isActive ? 0.82 : 1 }}>
                  {fmt(size.priceCents)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Guided steps bar ─────────────────────────────────────────────────────────

const GUIDED_STEPS = [
  { n: 1, label: "Sorte" },
  { n: 2, label: "Größe" },
  { n: 3, label: "Betrag" },
  { n: 4, label: "Buchen" },
] as const;

function GuidedStepsBar({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div
      data-testid="guided-steps-bar"
      data-active-step={step}
      className="flex shrink-0 items-center gap-1 rounded-2xl pos-section px-3 py-1.5 shadow backdrop-blur-sm"
    >
      {GUIDED_STEPS.map(({ n, label }, i) => {
        const done = n < step;
        const active = n === step;
        const isLast = i === GUIDED_STEPS.length - 1;
        return (
          <div key={n} className={cn("flex items-center gap-1.5", !isLast && "flex-1")}>
            <div
              data-testid={`guided-step-${n}`}
              data-state={done ? "done" : active ? "active" : "pending"}
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black transition-all",
                done  && "bg-[#22C55E] text-white",
                active && "bg-[#00D6A3] text-white",
                !done && !active && "pos-overlay pos-text-dim"
              )}
            >
              {done ? "✓" : n}
            </div>
            <span className={cn(
              "whitespace-nowrap text-sm font-bold transition-colors",
              done  && "text-[#22C55E]",
              active && "text-[#00D6A3]",
              !done && !active && "pos-text-dim"
            )}>
              {label}
            </span>
            {!isLast && (
              <div className={cn(
                "ml-1 h-0.5 flex-1 rounded-full transition-colors",
                done ? "bg-[#22C55E]/50" : "pos-overlay"
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Payment + book block – sits below FlavorColumn in the left area ──────────

const PAYMENT_ICONS: Record<PaymentMethod, React.ReactNode> = {
  bar:   <Banknote className="h-7 w-7" aria-hidden />,
  karte: <CreditCard className="h-7 w-7" aria-hidden />,
  qr:    <QrCode className="h-7 w-7" aria-hidden />,
};

// ── Bereich 3: Betrag eingeben – Eingabezeile + feste Beträge ────────────────

function AmountBlock({
  cashInput,
  cashCents,
  active,
  onCashInput,
  effectiveSizes,
  paymentConfig,
  guidedMode = false,
  guidedActive = false,
}: {
  cashInput: string;
  cashCents: number;
  /** Active once a size has been picked (cart has an item). */
  active: boolean;
  onCashInput: (v: string) => void;
  effectiveSizes: EffectiveSizeConfig[];
  paymentConfig: PaymentConfig;
  guidedMode?: boolean;
  guidedActive?: boolean;
}) {
  // Build colored quick-amount items: sizes get their own color, bills/custom use configured colors
  const quickItems = useMemo(() => {
    const bills = paymentConfig.bills ?? DEFAULT_PAYMENT_BILLS;
    const custom = paymentConfig.customAmounts ?? [];
    const billColor   = paymentConfig.billColor   ?? "#0284c7";
    const customColor = paymentConfig.customColor ?? "#7c3aed";

    // Map size priceCents → size config for color lookup
    const sizeMap = new Map(
      effectiveSizes
        .filter((s) => s.showAsQuickAmount !== false)
        .map((s) => [s.priceCents, s])
    );

    const allCents = Array.from(
      new Set([...Array.from(sizeMap.keys()), ...bills, ...custom])
    ).sort((a, b) => a - b);

    return allCents.map((cents) => {
      const sz = sizeMap.get(cents);
      if (sz) {
        return {
          cents,
          bgColor: sz.backgroundColor,
          textColor: computeTextColor(sz.textColorMode, sz.backgroundColor),
        };
      }
      if (custom.includes(cents)) {
        return { cents, bgColor: customColor, textColor: computeTextColor("auto", customColor) };
      }
      return { cents, bgColor: billColor, textColor: computeTextColor("auto", billColor) };
    });
  }, [effectiveSizes, paymentConfig]);

  return (
    <div
      data-testid="amount-zone"
      data-guided-active={guidedMode && guidedActive ? "true" : undefined}
      className={cn(
        "h-full flex flex-col gap-2 rounded-2xl pos-section p-2 transition-all",
        guidedMode && guidedActive && "guided-ring-pulse ring-2 ring-[#00D6A3]/50",
        !active && "opacity-40 pointer-events-none"
      )}
    >
      <p className="text-[11px] font-bold uppercase tracking-widest pos-text-label">
        3. Betrag eingeben
      </p>

      <div className="flex items-stretch gap-2">
        <button
          data-testid="cash-minus"
          onClick={() => { if (active) onCashInput((Math.max(0, cashCents - 50) / 100).toFixed(2)); }}
          className="h-14 w-14 shrink-0 grid place-items-center rounded-xl bg-red-500/20 text-red-400 text-2xl font-black transition-all hover:bg-red-500/30 active:scale-95 select-none"
        >−</button>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={cashInput}
          onChange={(e) => onCashInput(e.target.value)}
          placeholder="0,00"
          disabled={!active}
          className="min-h-[56px] min-w-0 flex-1 rounded-xl border-2 px-3 text-center text-4xl font-black tabular-nums outline-none transition-all pos-input focus:ring-4 focus:ring-green-500/20"
        />
        <button
          data-testid="cash-plus"
          onClick={() => { if (active) onCashInput(((cashCents + 50) / 100).toFixed(2)); }}
          className="h-14 w-14 shrink-0 grid place-items-center rounded-xl bg-green-500/20 text-green-400 text-2xl font-black transition-all hover:bg-green-500/30 active:scale-95 select-none"
        >+</button>
        <button
          data-testid="cash-clear"
          onClick={() => { if (active) onCashInput(""); }}
          className="h-14 w-14 shrink-0 grid place-items-center rounded-xl bg-orange-500/20 text-orange-400 text-xl font-black transition-all hover:bg-orange-500/30 active:scale-95 select-none"
        >C</button>
      </div>

      <p className="text-[11px] font-bold uppercase tracking-widest pos-text-label">
        Feste Beträge
      </p>
      <div
        data-testid="quick-amounts-row"
        className="flex flex-1 min-h-0 flex-wrap content-start gap-2 overflow-y-auto"
      >
        {quickItems.map(({ cents, bgColor, textColor }) => (
          <button
            key={cents}
            data-testid={`quick-amount-${cents}`}
            onClick={() => { if (active) onCashInput(((cashCents + cents) / 100).toFixed(2)); }}
            className="w-[calc(33.333%-6px)] shrink-0 rounded-xl min-h-[56px] flex flex-col items-center justify-center px-1 text-lg font-black leading-tight tracking-tight transition-all active:scale-95 select-none hover:brightness-110"
            style={{ backgroundColor: bgColor, color: textColor }}
          >
            {fmt(cents)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Bereich 4: Zahlungsmittel wählen & Bestellung buchen ─────────────────────

function PaymentBuchenBlock({
  showPayment,
  paymentMethod,
  canBook,
  active,
  onPaymentChange,
  onBook,
  paymentConfig,
  guidedMode = false,
  guidedActive = false,
}: {
  showPayment: boolean;
  paymentMethod: PaymentMethod;
  canBook: boolean;
  /** Active once Betrag eingeben has a value > 0. */
  active: boolean;
  onPaymentChange: (m: PaymentMethod) => void;
  onBook: () => void;
  paymentConfig: PaymentConfig;
  guidedMode?: boolean;
  guidedActive?: boolean;
}) {
  const barColor   = paymentConfig.barColor   ?? "#16a34a";
  const karteColor = paymentConfig.karteColor ?? "#2563eb";
  const qrColor    = paymentConfig.qrColor    ?? "#7c3aed";
  const bookColor  = paymentConfig.bookColor  ?? "#16a34a";
  const methodColor: Record<PaymentMethod, string> = { bar: barColor, karte: karteColor, qr: qrColor };

  return (
    <div
      data-testid="payment-zone"
      data-guided-active={guidedMode && guidedActive ? "true" : undefined}
      className={cn(
        "h-full flex flex-col gap-2 rounded-2xl pos-section p-2 transition-all",
        guidedMode && guidedActive && "guided-ring-pulse ring-2 ring-green-400/40",
        !active && "opacity-40 pointer-events-none"
      )}
    >
      <p className="text-[11px] font-bold uppercase tracking-widest pos-text-label">
        4. Zahlungsmittel wählen &amp; Buchen
      </p>

      {showPayment && (
        <>
          <div className="flex gap-2">
            {(["bar", "karte", "qr"] as PaymentMethod[]).map((m) => {
              const color = methodColor[m];
              const isActive = paymentMethod === m;
              return (
                <button
                  key={m}
                  data-testid={`payment-tab-${m}`}
                  onClick={() => { if (active) onPaymentChange(m); }}
                  aria-disabled={!active}
                  className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl transition-all duration-200 active:scale-[0.97] select-none"
                  style={{
                    minHeight: 64,
                    backgroundColor: isActive ? color : `${color}22`,
                    color: isActive ? "#ffffff" : color,
                    boxShadow: isActive
                      ? `0 0 0 3px ${color}50, 0 6px 20px ${color}35`
                      : undefined,
                  }}
                >
                  {PAYMENT_ICONS[m]}
                  <span className="text-base font-black leading-none">{PAYMENT_LABELS[m]}</span>
                </button>
              );
            })}
          </div>
          {paymentMethod === "karte" && (
            <div className="flex items-center justify-center gap-2 rounded-xl px-4 py-2"
              style={{ backgroundColor: `${karteColor}20` }}>
              <CreditCard className="h-5 w-5" style={{ color: karteColor }} aria-hidden />
              <span className="text-sm font-semibold" style={{ color: karteColor }}>Kartenzahlung gewählt</span>
            </div>
          )}
        </>
      )}

      {/* Bestellung buchen – volle Breite */}
      <button
        data-testid="book-button"
        data-guided-ready={guidedMode && guidedActive && canBook ? "true" : undefined}
        onClick={onBook}
        disabled={!canBook}
        className={cn(
          "mt-auto flex w-full items-center justify-center gap-2 rounded-2xl min-h-[60px] font-black transition-all select-none text-base px-3",
          canBook
            ? "text-white shadow-lg hover:brightness-110 active:scale-[0.98]"
            : "pos-overlay pos-text-dim cursor-not-allowed",
          guidedMode && guidedActive && canBook && "guided-book-pulse"
        )}
        style={canBook ? { backgroundColor: bookColor } : undefined}
      >
        <ShoppingCart className="h-5 w-5 shrink-0" aria-hidden />
        <span className="leading-tight text-center uppercase tracking-wide">
          {showPayment && paymentMethod === "qr" ? "QR anzeigen" : "Bestellung buchen"}
        </span>
      </button>
    </div>
  );
}

// ── Right column – cart only ──────────────────────────────────────────────────

const CART_FONT_CFG: Record<CartFontSize, { name: string; price: string; qty: string; qtyW: string }> = {
  normal: { name: "text-2xl font-bold",  price: "text-2xl font-black",  qty: "text-2xl font-black",  qtyW: "w-11" },
  gross:  { name: "text-3xl font-bold",  price: "text-3xl font-black",  qty: "text-3xl font-black",  qtyW: "w-12" },
  xl:     { name: "text-3xl font-black", price: "text-3xl font-black",  qty: "text-3xl font-black",  qtyW: "w-14" },
};

function CartColumn({
  cart,
  cartTotal,
  onChangeQty,
  onRemove,
  onClear,
  widthPx,
  qtyBtnSize,
  cartFontSize,
  effectiveSizes,
  cashCents,
  change,
}: {
  cart: ReturnType<typeof usePosStore>["cart"];
  cartTotal: number;
  onChangeQty: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  widthPx: number;
  qtyBtnSize: number;
  cartFontSize: CartFontSize;
  effectiveSizes: EffectiveSizeConfig[];
  cashCents: number;
  change: number;
}) {
  const allFlavors = useFlavorList();
  const getLocalFlavorName = (id: string) => allFlavors.find((f) => f.id === id)?.name ?? id;
  // Resolve size label: current effectiveSizes wins → stored sizeName → static fallback
  const getCartSizeName = (item: ReturnType<typeof usePosStore>["cart"][number]) =>
    effectiveSizes.find((s) => s.id === item.size)?.name ?? item.sizeName ?? getSizeName(item.size);
  const fontCfg = CART_FONT_CFG[cartFontSize];

  const [ausgabeModus, setAusgabeModus] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("primaq-ausgabe-modus") === "1";
    }
    return false;
  });
  const toggleAusgabeModus = useCallback((on: boolean) => {
    setAusgabeModus(on);
    if (typeof window !== "undefined") {
      localStorage.setItem("primaq-ausgabe-modus", on ? "1" : "0");
    }
  }, []);

  const [clearing, setClearing] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleClear = useCallback(() => {
    if (!clearing) {
      setClearing(true);
      clearTimerRef.current = setTimeout(() => setClearing(false), 3000);
    } else {
      clearTimeout(clearTimerRef.current);
      onClear();
      setClearing(false);
    }
  }, [clearing, onClear]);

  useEffect(() => () => clearTimeout(clearTimerRef.current), []);

  return (
    <div data-testid="cart-zone" className="w-full h-full">
      {/* h-full + flex-col: fills the FreeDashboardPanel body; items list scrolls inside */}
      <div className="h-full flex flex-col rounded-2xl pos-surface shadow">
        <div className="flex-none flex items-center gap-2 border-b pos-border-c px-4 py-2.5">
          <span className="text-[11px] font-bold uppercase tracking-widest pos-text-label mr-auto">
            Warenkorb
          </span>
          <button
            onClick={() => toggleAusgabeModus(!ausgabeModus)}
            title="Ausgabe-Modus: größere Schrift für Zweipersonen-Betrieb"
            className={cn(
              "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors select-none",
              ausgabeModus
                ? "bg-primaq-500/20 text-primaq-400"
                : "pos-text-dim pos-hover"
            )}
          >
            Ausgabe
          </button>
          {cart.length > 0 && (
            <button
              onClick={handleClear}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
                clearing
                  ? "bg-red-500 text-white"
                  : "pos-text-dim hover:bg-red-500/15 hover:text-red-400"
              )}
            >
              <Trash2 className="h-3 w-3" />
              {clearing ? "Erneut tippen" : "Leeren"}
            </button>
          )}
        </div>

        {/* flex-1 min-h-0: grows to fill remaining panel height; items scroll internally */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 pos-text-dim py-6">
              <ShoppingCart className="h-8 w-8" />
              <span className="text-xs">Noch leer</span>
            </div>
          ) : (
            <ul className="divide-y pos-border-c">
              {cart.map((item) => (
                <li key={item.id} className={cn("px-4", ausgabeModus ? "py-5" : "py-4")}>
                  {/* Row 1: badge + name + total */}
                  <div className={cn("flex items-start", ausgabeModus ? "gap-3" : "gap-2.5")}>
                    <CartItemBadge item={item} large={ausgabeModus} />
                    <p className={cn(
                      "flex-1 uppercase leading-tight line-clamp-2 pos-text",
                      ausgabeModus ? "text-2xl font-black" : fontCfg.name
                    )}>
                      {getCartSizeName(item)} {getLocalFlavorName(item.flavor)}
                    </p>
                    <p className={cn(
                      "shrink-0 font-black pos-text tabular-nums pt-0.5",
                      ausgabeModus ? "text-2xl" : fontCfg.price
                    )}>
                      {fmt(item.quantity * item.unitPriceCents)}
                    </p>
                  </div>
                  {/* Row 2: unit price + qty controls */}
                  <div className={cn(
                    "mt-2 flex items-center",
                    ausgabeModus ? "pl-[68px]" : "pl-[44px]"
                  )}>
                    {!ausgabeModus && (
                      <span className="text-xs pos-text-muted tabular-nums mr-auto">
                        {fmt(item.unitPriceCents)} je
                      </span>
                    )}
                    <div className={cn("flex items-center gap-1.5", ausgabeModus && "ml-auto")}>
                      <button
                        onClick={() => onChangeQty(item.id, -1)}
                        style={{ height: qtyBtnSize, width: qtyBtnSize }}
                        className="grid place-items-center rounded-full pos-overlay hover:bg-red-500/20 hover:text-red-400 pos-text-muted active:scale-90 transition-all"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className={cn(
                        "text-center font-black pos-text tabular-nums",
                        ausgabeModus ? `w-12 text-2xl` : `${fontCfg.qtyW} ${fontCfg.qty}`
                      )}>
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => onChangeQty(item.id, 1)}
                        style={{ height: qtyBtnSize, width: qtyBtnSize }}
                        className="grid place-items-center rounded-full pos-overlay hover:bg-primaq-500/20 hover:text-primaq-400 pos-text-muted active:scale-90 transition-all"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                      <DeleteButton itemId={item.id} onRemove={onRemove} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div data-testid="cart-summary" className="flex-none border-t pos-border-c px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold pos-text-muted">Gesamt</span>
            <span className="text-3xl font-black pos-text tabular-nums">{fmt(cartTotal)}</span>
          </div>
          {cashCents >= cartTotal && cashCents > 0 && cartTotal > 0 && (
            <div data-testid="cart-change-row" className="rounded-xl bg-green-500/15 px-3 py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold uppercase tracking-wide text-green-400">Rückgeld</span>
                <span className="text-3xl font-black tabular-nums text-green-400">{fmt(change)}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between">
                <span className="text-xs pos-text-muted">Gegeben</span>
                <span className="text-sm font-semibold pos-text-muted tabular-nums">{fmt(cashCents)}</span>
              </div>
            </div>
          )}
          {cashCents > 0 && cashCents < cartTotal && cartTotal > 0 && (
            <div data-testid="cart-open-row" className="rounded-xl bg-orange-500/15 px-3 py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold uppercase tracking-wide text-orange-400">Noch offen</span>
                <span className="text-3xl font-black tabular-nums text-orange-400">{fmt(cartTotal - cashCents)}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between">
                <span className="text-xs pos-text-muted">Gegeben</span>
                <span className="text-sm font-semibold pos-text-muted tabular-nums">{fmt(cashCents)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Last order read-only modal ────────────────────────────────────────────────

function LastOrderModal({
  order,
  orderNum,
  onClose,
  onVoid,
}: {
  order: Order;
  orderNum: number;
  onClose: () => void;
  onVoid: () => void;
}) {
  const { isAdmin } = useAdmin();
  const allFlavors = useFlavorList();
  const getLocalFlavorName = (id: string) => allFlavors.find((f) => f.id === id)?.name ?? id;
  const getLocalSizeName = (item: CartItem) => item.sizeName ?? getSizeName(item.size);

  const [voidConfirming, setVoidConfirming] = useState(false);

  const handleVoid = useCallback(() => {
    if (!voidConfirming) { setVoidConfirming(true); return; }
    onVoid();
    onClose();
  }, [voidConfirming, onVoid, onClose]);

  const time = new Date(order.createdAt).toLocaleString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const totalItems = order.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid="last-order-modal"
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl pos-surface shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between border-b pos-border-c px-6 pt-5 pb-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest pos-text-label">
              Letzte Buchung
            </p>
            <p className="mt-0.5 text-2xl font-black pos-text">
              #{String(orderNum).padStart(4, "0")}
            </p>
          </div>
          <button
            data-testid="modal-close-x"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full pos-text-dim pos-hover hover:pos-text-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Meta info ── */}
        <div className="px-6 py-4 space-y-2.5 border-b pos-border-c">
          <Row label="Datum / Uhrzeit" value={time} />
          <Row label="Zahlungsart" value={BOOKING_PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod} />
          <Row label="Artikel gesamt" value={String(totalItems)} />
          <div className="flex items-center justify-between pt-1">
            <span className="text-sm font-bold pos-text-muted">Gesamtbetrag</span>
            <span className="text-xl font-black pos-text tabular-nums">{fmt(order.totalCents)}</span>
          </div>
        </div>

        {/* ── Article list ── */}
        <div className="px-6 py-4 max-h-64 overflow-y-auto space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-widest pos-text-label">Artikel</p>
          {order.items.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <CartItemBadge item={item} />
                <div className="min-w-0">
                  <p className="text-sm font-bold pos-text leading-snug">
                    {item.quantity}× {getLocalSizeName(item)} {getLocalFlavorName(item.flavor)}
                  </p>
                  <p className="text-xs pos-text-muted tabular-nums">{fmt(item.unitPriceCents)} je</p>
                </div>
              </div>
              <span className="shrink-0 text-sm font-black pos-text tabular-nums">
                {fmt(item.quantity * item.unitPriceCents)}
              </span>
            </div>
          ))}
        </div>

        {/* ── Actions ── */}
        <div className="border-t pos-border-c px-6 py-4 flex gap-3">
          {isAdmin && (
            <button
              data-testid="modal-void-btn"
              onClick={handleVoid}
              className={cn(
                "rounded-xl px-4 py-2.5 text-sm font-bold transition-colors",
                voidConfirming
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "border pos-border-c pos-section text-red-400 hover:bg-red-500/15 hover:border-red-500/30"
              )}
            >
              {voidConfirming ? "Wirklich stornieren?" : "Stornieren"}
            </button>
          )}
          <button
            data-testid="modal-close-btn"
            onClick={onClose}
            className="flex-1 rounded-xl pos-overlay pos-overlay-hover py-2.5 text-sm font-semibold pos-text-muted transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm pos-text-muted">{label}</span>
      <span className="text-sm font-semibold pos-text">{value}</span>
    </div>
  );
}

// ── Bottom status bar – last booking + live daily stats ──────────────────────

const BOOKING_PAYMENT_LABEL: Record<string, string> = {
  bar: "Bar",
  karte: "Karte",
  qr: "QR",
};

function SalesStatusBar({
  daily,
  onVoid,
  showLastBooking = true,
  showStats = true,
}: {
  daily: ReturnType<typeof usePosStore>["daily"];
  onVoid: () => void;
  showLastBooking?: boolean;
  showStats?: boolean;
}) {
  const { isAdmin } = useAdmin();
  const last = daily.orders.length > 0 ? daily.orders[daily.orders.length - 1] : null;
  const [showModal, setShowModal] = useState(false);

  const portionen = daily.orders.reduce(
    (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0),
    0
  );

  // Fallback for orders saved before dailyNumber was introduced
  const orderNum = last
    ? (last.dailyNumber ?? daily.orders.length)
    : null;

  return (
    <>
      <div
        data-testid="last-booking-bar"
        className="shrink-0 flex items-center gap-2 rounded-2xl pos-section px-4 py-1.5 shadow backdrop-blur-sm"
      >
      {/* Left: last booking */}
      {showLastBooking && (
        <>
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider pos-text-label">
            Letzte Buchung
          </span>
          <div className="h-4 w-px shrink-0 pos-divider" />
          {last && orderNum !== null ? (
            <>
              <span className="text-sm font-bold pos-text-muted tabular-nums">
                #{String(orderNum).padStart(4, "0")}
              </span>
              <div className="h-4 w-px shrink-0 pos-divider" />
              <span className="text-base font-black pos-text tabular-nums">
                {fmt(last.totalCents)}
              </span>
              <div className="h-4 w-px shrink-0 pos-divider" />
              <span className="text-sm font-semibold pos-text-muted">
                {BOOKING_PAYMENT_LABEL[last.paymentMethod] ?? last.paymentMethod}
              </span>
              <div className="h-4 w-px shrink-0 pos-divider" />
              <span className="text-sm font-semibold pos-text-muted tabular-nums">
                {new Date(last.createdAt).toLocaleTimeString("de-DE", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <div className="h-4 w-px shrink-0 pos-divider" />
              <span className="text-xs pos-text-dim">
                {last.items.reduce((s, i) => s + i.quantity, 0)} Artikel
              </span>
              <button
                data-testid="show-last-order"
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 rounded-lg border pos-border-c pos-section px-3 py-1 text-xs font-semibold pos-text-muted hover:bg-primaq-500/15 hover:text-primaq-400 transition-colors shrink-0"
              >
                <Eye className="h-3.5 w-3.5" />
                Anzeigen
              </button>
            </>
          ) : (
            <span className="text-sm pos-text-dim">noch keine</span>
          )}
        </>
      )}

      {/* Right: daily totals – admin only, respects verkaufszaehler toggle */}
      {isAdmin && showStats && (
        <div className={cn(
          "flex items-center gap-4 shrink-0 pl-3 border-l pos-border-c",
          showLastBooking ? "ml-auto" : "ml-0"
        )}>
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest pos-text-dim">Portionen</p>
            <p className="text-base font-black pos-text tabular-nums">{portionen}</p>
          </div>
          <div className="h-6 w-px pos-divider" />
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest pos-text-dim">Verkäufe</p>
            <p className="text-base font-black pos-text tabular-nums">{daily.orderCount}</p>
          </div>
          <div className="h-6 w-px pos-divider" />
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest pos-text-dim">Umsatz</p>
            <p className="text-base font-black text-primaq-400 tabular-nums">{fmt(daily.totalCents)}</p>
          </div>
        </div>
      )}
    </div>

    {/* Modal – rendered outside status bar div to avoid stacking-context issues */}
    {showModal && last && orderNum !== null && (
      <LastOrderModal
        order={last}
        orderNum={orderNum}
        onClose={() => setShowModal(false)}
        onVoid={onVoid}
      />
    )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SalesPage() {
  const {
    cart,
    cartTotal,
    daily,
    addToCart,
    removeFromCart,
    changeQty,
    clearCart,
    bookOrder,
    voidLastOrder,
    hydrated,
  } = usePosStore();

  const { allFlavors, hydrated: flavorsHydrated } = usePosFlavorStore();
  const { active: layout, hydrated: layoutHydrated } = usePosLayoutStore();
  const { isAdmin } = useAdmin();
  const { guidedMode } = useGuidedModeStore();

  // The free/device layout engines are not used in normal sales operation at
  // all — no import, no rendering path exists for them here. As a defensive
  // measure, actively wipe both of their localStorage keys on every load, so
  // no leftover or stale entry from an earlier session can ever be picked up
  // if this code path is ever touched again.
  useEffect(() => {
    try {
      localStorage.removeItem("primaq-pos-free-layout-v1");
      localStorage.removeItem("primaq-pos-device-layout-v1");
    } catch { /* ignore */ }
  }, []);

  // Resizable grid splitters (Admin-only "Layout anpassen"): the fixed
  // quadrant topology never changes, only the track sizes — no free x/y/w/h
  // panels, no drag-anywhere. Stored per device (localStorage only).
  const { layout: gridLayoutRaw, update: updateGridLayout, reset: resetGridLayout } = usePosGridLayoutStore();
  const [layoutEditMode, setLayoutEditMode] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const gridResizeObserverRef = useRef<ResizeObserver | null>(null);

  // A callback ref (not useRef + useEffect) because this component returns
  // an early "Laden…" placeholder before hydration finishes — with a plain
  // ref, a mount-only effect would run against that placeholder render
  // (grid div not yet in the tree, ref.current still null) and never fire
  // again once the real grid mounts later. A callback ref instead fires
  // exactly when the DOM node itself attaches/detaches, independent of
  // which render that happens on.
  const gridContainerRef = useCallback((el: HTMLDivElement | null) => {
    gridResizeObserverRef.current?.disconnect();
    gridResizeObserverRef.current = null;
    if (!el) return;
    // ResizeObserver's own callback only fires asynchronously (next frame),
    // which would otherwise let the very first "loaded" paint render one
    // frame of unclamped default track sizes before the observer corrects
    // it. Reading the rect synchronously here — refs attach after layout is
    // flushed — means the clamped values are already in the state update
    // that lands in the same commit, so nothing ever paints unclamped.
    const initial = el.getBoundingClientRect();
    setContainerSize({ width: initial.width, height: initial.height });
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    gridResizeObserverRef.current = ro;
  }, []);

  // Concrete px track sizes for the current container, always floored at
  // COL_MIN/ROW_MIN — never fractions. Sorte+Betrag always share colAPx,
  // Größe+Zahlungsmittel always share colBPx; nothing ever resizes in
  // isolation from this shared raster.
  const gridPx = useMemo(
    () => clampGridLayout(gridLayoutRaw, containerSize.width, containerSize.height),
    [gridLayoutRaw, containerSize]
  );

  // Splitter A/B: gemeinsame Spaltengrenze zwischen Sorte+Betrag (colA) und
  // Größe+Zahlungsmittel (colB) — bewegt beide Zeilen gleichzeitig, weil sie
  // dieselbe Spaltengrenze teilen. Warenkorb (colC) bleibt dabei unberührt:
  // der Transfer ist durch B's EIGENE Untergrenze begrenzt (nicht durch
  // "availWidth - beide Mins", was fälschlich auf Kosten von C ginge).
  const handleDragColAB = useCallback((dx: number) => {
    const availWidth = containerSize.width > 0 ? Math.max(containerSize.width - GRID_GUTTER_PX * 2, 0) : 0;
    const maxAPx = gridPx.colAPx + (gridPx.colBPx - COL_MIN.b);
    const nextAPx = clamp(gridPx.colAPx + dx, COL_MIN.a, Math.max(COL_MIN.a, maxAPx));
    const nextBPx = gridPx.colBPx - (nextAPx - gridPx.colAPx);
    const nextA = availWidth > 0 ? nextAPx / availWidth : gridLayoutRaw.colA;
    const nextB = availWidth > 0 ? nextBPx / availWidth : gridLayoutRaw.colB;
    updateGridLayout({ colA: nextA, colB: nextB });
  }, [containerSize.width, gridPx.colAPx, gridPx.colBPx, gridLayoutRaw.colA, gridLayoutRaw.colB, updateGridLayout]);

  // Splitter B/C: gemeinsame Spaltengrenze zwischen Größe+Zahlungsmittel
  // (colB) und Warenkorb (colC). Sorte/Betrag (colA) bleiben unberührt —
  // der Transfer ist durch C's EIGENE Untergrenze begrenzt.
  const handleDragColBC = useCallback((dx: number) => {
    const availWidth = containerSize.width > 0 ? Math.max(containerSize.width - GRID_GUTTER_PX * 2, 0) : 0;
    const maxBPx = gridPx.colBPx + (gridPx.colCPx - COL_MIN.c);
    const nextBPx = clamp(gridPx.colBPx + dx, COL_MIN.b, Math.max(COL_MIN.b, maxBPx));
    const nextCPx = gridPx.colCPx - (nextBPx - gridPx.colBPx);
    const nextB = availWidth > 0 ? nextBPx / availWidth : gridLayoutRaw.colB;
    const nextC = availWidth > 0 ? nextCPx / availWidth : gridLayoutRaw.colC;
    updateGridLayout({ colB: nextB, colC: nextC });
  }, [containerSize.width, gridPx.colBPx, gridPx.colCPx, gridLayoutRaw.colB, gridLayoutRaw.colC, updateGridLayout]);

  // Splitter Top/Bottom: gemeinsame Zeilengrenze zwischen oberer Reihe
  // (Sorte/Größe) und unterer Reihe (Betrag/Zahlungsmittel).
  const handleDragRow = useCallback((dy: number) => {
    const availHeight = containerSize.height > 0 ? Math.max(containerSize.height - GRID_GUTTER_PX, 0) : 0;
    const maxTop = availHeight > 0 ? availHeight - ROW_MIN.bottom : Infinity;
    const nextTopPx = clamp(gridPx.topRowPx + dy, ROW_MIN.top, Math.max(ROW_MIN.top, maxTop));
    const nextTop = availHeight > 0 ? nextTopPx / availHeight : gridLayoutRaw.topRow;
    const nextBottom = availHeight > 0 ? (gridPx.bottomRowPx - (nextTopPx - gridPx.topRowPx)) / availHeight : gridLayoutRaw.bottomRow;
    updateGridLayout({ topRow: nextTop, bottomRow: nextBottom });
  }, [containerSize.height, gridPx.topRowPx, gridPx.bottomRowPx, gridLayoutRaw.topRow, gridLayoutRaw.bottomRow, updateGridLayout]);

  const [pendingFlavor, setPendingFlavor] = useState<FlavorConfig | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>("bar");
  const [cashInput, setCashInput] = useState("");
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  useEffect(() => {
    setShowDebug(new URLSearchParams(window.location.search).get("debug") === "1");
  }, []);

  type DebugEntry = {
    step1: { sizeId: string; displayName: string | undefined; sizes: { id: string; name: string }[] };
    flavorId: string;
  };
  const [debugEntry, setDebugEntry] = useState<DebugEntry | null>(null);

  const cashCents = Math.round(parseFloat(cashInput.replace(",", ".")) * 100) || 0;
  const change = cashCents - cartTotal;
  const showPayment = layout.toggles.zahlung;

  // Sorten- (Bereich 1) und Größenkarten (Bereich 2) sind unabhängig
  // einstellbar, aber beide quadratisch — jede liest ihre eigene
  // CSS-Variable, responsiv per clamp() begrenzt auf den gewählten Wert.
  const productCardSize = cardSizeClamp(layout.productCardSizePx);
  const sizeCardSize = cardSizeClamp(layout.sizeCardSizePx);

  // Effective sizes: merge static defaults with salesSizes overrides, filter by visibility
  const effectiveSizes = useMemo<EffectiveSizeConfig[]>(() => {
    return SIZES
      .map((s) => {
        const ov = layout.salesSizes?.[s.id];
        return {
          ...s,
          name:               ov?.label              ?? s.name,
          priceCents:         ov?.priceCents          ?? s.priceCents,
          backgroundColor:    ov?.backgroundColor     ?? "#ffffff",
          textColorMode:      ov?.textColorMode       ?? "auto",
          imageDataUrl:       ov?.imageDataUrl        ?? null,
          imageScale:         ov?.imageScale          ?? 100,
          showAsQuickAmount:  ov?.showAsQuickAmount   ?? true,
        };
      })
      .filter((s) => layout.sizeVisibility[s.id] !== false);
  }, [layout]);

  // Buchen erfordert: Warenkorb nicht leer, Betrag eingegeben (>0), und bei
  // aktivem Zahlungsbereich ein explizit gewähltes Zahlungsmittel — bei Bar
  // zusätzlich einen ausreichenden Betrag.
  const canBook = cart.length > 0 && cashCents > 0 && (
    showPayment
      ? (paymentConfirmed && (payment !== "bar" || cashCents >= cartTotal))
      : true
  );

  // Derived guided step — pure function of existing state, no new store needed.
  // Reihenfolge: 1 Sorte, 2 Größe, 3 Betrag eingeben, 4 Zahlungsmittel + Buchen.
  const guidedStep: 1 | 2 | 3 | 4 =
    pendingFlavor !== null ? 2 :
    cart.length === 0 ? 1 :
    cashCents === 0 ? 3 :
    4;

  // Always-on step gating (independent of the guidedMode visual toggle): a
  // locked area stays visible but dimmed, with no pointer-events and no
  // onClick effect, until the previous step is actually completed.
  // betragActive: Bereich 3 (Betrag eingeben) unlocks once a size has been
  // picked. zahlungActive: Bereich 4 (Zahlungsmittel + Buchen) unlocks only
  // once an amount > 0 has actually been entered.
  const betragActive = cart.length > 0;
  const zahlungActive = betragActive && cashCents > 0;

  // Reset paymentConfirmed when cart empties (booking or manual removal)
  useEffect(() => {
    if (cart.length === 0) setPaymentConfirmed(false);
  }, [cart.length]);

  const handleFlavorClick = useCallback((flavor: FlavorConfig) => {
    setPendingFlavor(flavor);
  }, []);

  const handleSizePick = useCallback((sizeId: string, priceCents: number) => {
    if (!pendingFlavor) return;
    const displayName = effectiveSizes.find((s) => s.id === sizeId)?.name;
    setDebugEntry({
      step1: { sizeId, displayName, sizes: effectiveSizes.map((s) => ({ id: s.id, name: s.name })) },
      flavorId: pendingFlavor.id,
    });
    addToCart(sizeId, pendingFlavor.id, priceCents, displayName);
    setPendingFlavor(null);
  }, [pendingFlavor, addToCart, effectiveSizes]);

  const handlePaymentChange = useCallback((method: PaymentMethod) => {
    // Betrag eingeben kommt VOR Zahlungsmittel wählen — der bereits
    // eingegebene Betrag bleibt beim Wechsel des Zahlungsmittels erhalten.
    setPayment(method);
    setPaymentConfirmed(true);
  }, []);

  const handleBook = useCallback(() => {
    if (!canBook) return;
    if (showPayment && payment === "qr") {
      setShowQr(true);
      return;
    }
    bookOrder(showPayment ? payment : "karte");
    setCashInput("");
    setPaymentConfirmed(false);
    setPayment("bar");
  }, [canBook, showPayment, payment, bookOrder]);

  const handleQrConfirm = useCallback(() => {
    bookOrder("qr");
    setShowQr(false);
    setCashInput("");
    setPaymentConfirmed(false);
    setPayment("bar");
  }, [bookOrder]);

  if (!hydrated || !flavorsHydrated || !layoutHydrated) {
    return (
      <div className="flex h-full items-center justify-center pos-text-muted">Laden…</div>
    );
  }

  return (
    <FlavorsCtx.Provider value={allFlavors}>
    <div
      className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden"
      style={{
        "--pos-card-size": productCardSize,
        "--pos-size-card-size": sizeCardSize,
        "--pos-card-gap": "12px",
        "--pos-card-radius": "16px",
      } as React.CSSProperties}
    >
      {guidedMode && <GuidedStepsBar step={guidedStep} />}

      {isAdmin && (
        <div className="flex shrink-0 items-center gap-2">
          <button
            data-testid="grid-layout-toggle"
            onClick={() => setLayoutEditMode((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors select-none",
              layoutEditMode ? "bg-primaq-500 text-white shadow" : "pos-overlay pos-hover pos-text-muted"
            )}
          >
            {layoutEditMode ? "Fertig" : "Layout anpassen"}
          </button>
          {layoutEditMode && (
            <>
              <span className="text-xs pos-text-dim">Linien ziehen zum Anpassen</span>
              <button
                data-testid="grid-layout-reset"
                onClick={() => resetGridLayout()}
                className="rounded-xl border pos-border-c px-3 py-1.5 text-xs font-semibold pos-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                Layout zurücksetzen
              </button>
            </>
          )}
        </div>
      )}

      {/*
        Stable raster — only shared grid LINES move, never an isolated
        panel. Sorte (1) + Betrag (3) always share column A's width; Größe
        (2) + Zahlungsmittel (4) always share column B's width; Warenkorb is
        column C, spanning both rows. Three splitters, each a real grid
        track (not the `gap` shorthand) so it can be grabbed and dragged:

        Columns: [A] [gutter A/B] [B] [gutter B/C] [C = Warenkorb]
        Rows:    [oben] [gutter oben/unten] [unten]

        minmax(MIN, var) on every column means the browser itself enforces
        the floor — a panel can never be squeezed thinner than its minimum,
        and nothing can ever overlap or run under a neighbor.
      */}
      <div
        ref={gridContainerRef}
        data-testid="sales-grid"
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        style={{
          display: "grid",
          // The minmax() floor must never exceed what clampGridLayout already
          // computed: on a viewport too small to honor every true minimum at
          // once, it proportionally shrinks all tracks below COL_MIN/ROW_MIN
          // so nothing overflows — but CSS minmax(min, preferred) would
          // silently re-floor back up to the fixed constant if we passed
          // that literal here, undoing the shrink and cutting off a panel.
          gridTemplateColumns: `minmax(${Math.min(COL_MIN.a, gridPx.colAPx)}px, ${gridPx.colAPx}px) ${GRID_GUTTER_PX}px minmax(${Math.min(COL_MIN.b, gridPx.colBPx)}px, ${gridPx.colBPx}px) ${GRID_GUTTER_PX}px minmax(${Math.min(COL_MIN.c, gridPx.colCPx)}px, ${gridPx.colCPx}px)`,
          gridTemplateRows: `minmax(${Math.min(ROW_MIN.top, gridPx.topRowPx)}px, ${gridPx.topRowPx}px) ${GRID_GUTTER_PX}px minmax(${Math.min(ROW_MIN.bottom, gridPx.bottomRowPx)}px, ${gridPx.bottomRowPx}px)`,
        }}
      >
        <div className="min-h-0 min-w-0 overflow-hidden" style={{ gridColumn: "1 / 2", gridRow: "1 / 2" }}>
          <FlavorColumn
            onFlavorClick={handleFlavorClick}
            pendingFlavor={pendingFlavor}
            guidedMode={guidedMode}
            guidedActive={guidedStep === 1}
          />
        </div>

        <div style={{ gridColumn: "2 / 3", gridRow: "1 / 4" }}>
          <VerticalSplitter active={layoutEditMode} onDrag={handleDragColAB} testId="grid-vsplit-1" />
        </div>

        <div className="min-h-0 min-w-0 overflow-hidden" style={{ gridColumn: "3 / 4", gridRow: "1 / 2" }}>
          <SizeRow
            effectiveSizes={effectiveSizes}
            pendingFlavor={pendingFlavor}
            onSizePick={handleSizePick}
            guidedMode={guidedMode}
            guidedActive={guidedStep === 2}
          />
        </div>

        <div style={{ gridColumn: "4 / 5", gridRow: "1 / 4" }}>
          <VerticalSplitter active={layoutEditMode} onDrag={handleDragColBC} testId="grid-vsplit-2" />
        </div>

        {/* Warenkorb – volle Höhe, spannt alle drei Zeilen (oben, hsplit, unten) */}
        <div className="min-h-0 overflow-hidden" style={{ gridColumn: "5 / 6", gridRow: "1 / 4" }}>
          <CartColumn
            widthPx={380}
            qtyBtnSize={layout.qtyButtonSize}
            cartFontSize={layout.cartFontSize}
            cart={cart}
            cartTotal={cartTotal}
            onChangeQty={changeQty}
            onRemove={removeFromCart}
            onClear={clearCart}
            effectiveSizes={effectiveSizes}
            cashCents={cashCents}
            change={change}
          />
        </div>

        <div style={{ gridColumn: "1 / 4", gridRow: "2 / 3" }}>
          <HorizontalSplitter active={layoutEditMode} onDrag={handleDragRow} testId="grid-hsplit" />
        </div>

        <div className="min-h-0 min-w-0 overflow-hidden" style={{ gridColumn: "1 / 2", gridRow: "3 / 4" }}>
          <AmountBlock
            cashInput={cashInput}
            cashCents={cashCents}
            active={betragActive}
            onCashInput={setCashInput}
            effectiveSizes={effectiveSizes}
            paymentConfig={layout.payment}
            guidedMode={guidedMode}
            guidedActive={guidedStep === 3}
          />
        </div>

        <div className="min-h-0 min-w-0 overflow-hidden" style={{ gridColumn: "3 / 4", gridRow: "3 / 4" }}>
          <PaymentBuchenBlock
            showPayment={showPayment}
            paymentMethod={payment}
            canBook={canBook}
            active={zahlungActive}
            onPaymentChange={handlePaymentChange}
            onBook={handleBook}
            paymentConfig={layout.payment}
            guidedMode={guidedMode}
            guidedActive={guidedStep === 4}
          />
        </div>
      </div>

      {/* Footer: Letzte Buchung / Tagesstatistik */}
      {layout.toggles["letzte-bestellung"] && (
        <SalesStatusBar
          daily={daily}
          onVoid={voidLastOrder}
          showLastBooking={layout.toggles["live-monitor"]}
          showStats={layout.toggles["verkaufszaehler"]}
        />
      )}

      {/* QR overlay */}
      {showQr && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowQr(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl pos-surface p-8 shadow-2xl text-center mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 text-[11px] font-bold uppercase tracking-widest pos-text-label">
              QR-Zahlung
            </p>
            <p className="mb-6 text-5xl font-black pos-text tabular-nums">{fmt(cartTotal)}</p>
            <div className="mb-6 flex justify-center">
              <QRCodeSVG
                value={`https://primaq.de/pay?total=${cartTotal}`}
                size={200}
                level="M"
              />
            </div>
            <button
              onClick={handleQrConfirm}
              className="mb-3 w-full rounded-2xl bg-primaq-500 py-4 text-lg font-black text-white hover:bg-primaq-700 transition-colors"
            >
              Zahlung bestätigt
            </button>
            <button
              onClick={() => setShowQr(false)}
              className="w-full rounded-2xl pos-overlay pos-overlay-hover py-3 text-base font-semibold pos-text-muted transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>

    {/* ── Debug overlay – Admin only ───────────────────────────────────────── */}
    {(process.env.NODE_ENV !== "production" || showDebug) && isAdmin && debugEntry && (() => {
      const { step1, flavorId } = debugEntry;
      const cartItem = cart.find((i) => i.size === step1.sizeId && i.flavor === flavorId)
        ?? cart.findLast?.((i) => i.flavor === flavorId)
        ?? cart[cart.length - 1];
      const step3 = cartItem
        ? (cartItem.sizeName ?? effectiveSizes.find((s) => s.id === cartItem.size)?.name ?? getSizeName(cartItem.size))
        : "—";
      return (
        <div className="fixed bottom-4 right-4 z-[200] w-72 rounded-2xl bg-black/90 p-4 text-xs font-mono text-white shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-bold text-yellow-300">POS Debug</span>
            <button onClick={() => setDebugEntry(null)} className="text-white/50 hover:text-white">✕</button>
          </div>

          <div className="mb-2 border-t border-white/10 pt-2">
            <p className="font-bold text-green-400">STEP 1 – handleSizePick</p>
            <p>sizeId: <span className="text-yellow-200">{step1.sizeId}</span></p>
            <p>displayName: <span className="text-yellow-200">{step1.displayName ?? "undefined"}</span></p>
            <p className="mt-1 text-white/40">effectiveSizes:</p>
            {step1.sizes.map((s) => (
              <p key={s.id} className="pl-2 text-white/60">{s.id} → &quot;{s.name}&quot;</p>
            ))}
          </div>

          <div className="mb-2 border-t border-white/10 pt-2">
            <p className="font-bold text-blue-400">STEP 2 – CartItem</p>
            {cartItem ? (
              <>
                <p>item.size: <span className="text-yellow-200">{cartItem.size}</span></p>
                <p>item.sizeName: <span className="text-yellow-200">{cartItem.sizeName ?? "undefined"}</span></p>
              </>
            ) : (
              <p className="text-white/40">kein CartItem gefunden</p>
            )}
          </div>

          <div className="border-t border-white/10 pt-2">
            <p className="font-bold text-orange-400">STEP 3 – Render</p>
            <p>getCartSizeName: <span className="text-yellow-200">{step3}</span></p>
          </div>
        </div>
      );
    })()}

    </FlavorsCtx.Provider>
  );
}
