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
import {
  usePosFreePanelStore,
  FL_PANEL_MINS,
  PANEL_GAP,
  normalizeLayout,
  defaultPanelsForWorkspace,
  type PanelId,
  type PanelRect,
  type ResizeMode,
} from "./use-pos-free-layout-store";
import type { CartFontSize, PaymentConfig, TextColorMode } from "./use-pos-layout-store";
import { computeTextColor } from "./use-pos-layout-store";
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
        "rounded-2xl transition-all duration-200",
        "group-hover:brightness-110 group-active:scale-[0.96]",
        isSelected
          ? "ring-[3px] ring-[#22c55e] scale-[1.04]"
          : "ring-0",
        guidedMode && !isSelected && hasAnySelection && "opacity-50",
      )}
      style={isSelected ? { boxShadow: "0 0 22px rgba(34,197,94,0.45)" } : undefined}
    >
      {/* Square card – aspect-square fills the column width */}
      <div className="relative w-full aspect-square overflow-hidden rounded-2xl shadow-lg">
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
  cardSize,
  selectedFlavorId,
  guidedMode = false,
}: {
  label: string;
  flavors: FlavorConfig[];
  onFlavorClick: (flavor: FlavorConfig) => void;
  cardSize: number;
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
      {/* auto-fit + justify-center → cards always centered, exact cardSize columns */}
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(auto-fit, ${cardSize}px)`,
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
  cardSize,
  pendingFlavor,
  guidedMode = false,
  guidedActive = false,
}: {
  onFlavorClick: (flavor: FlavorConfig) => void;
  cardSize: number;
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
          Sorte wählen
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
              cardSize={cardSize}
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
        Größe wählen
      </p>
      {effectiveSizes.length === 0 ? (
        <p className="py-2 text-center text-sm pos-text-dim">
          Keine Größe aktiv – bitte in Einstellungen aktivieren.
        </p>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col gap-2">
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
                  "flex flex-1 min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl transition-all duration-200 select-none",
                  isActive
                    ? "shadow-md hover:brightness-110 active:scale-[0.97]"
                    : "opacity-35 cursor-not-allowed"
                )}
                style={{ backgroundColor: bgColor }}
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
  { n: 3, label: "Zahlung" },
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

function PaymentBlock({
  showPayment,
  paymentMethod,
  cashInput,
  cashCents,
  cartTotal,
  change,
  canBook,
  onPaymentChange,
  onCashInput,
  onBook,
  effectiveSizes,
  paymentConfig,
  guidedMode = false,
  guidedStep = null,
}: {
  showPayment: boolean;
  paymentMethod: PaymentMethod;
  cashInput: string;
  cashCents: number;
  cartTotal: number;
  change: number;
  canBook: boolean;
  onPaymentChange: (m: PaymentMethod) => void;
  onCashInput: (v: string) => void;
  onBook: () => void;
  effectiveSizes: EffectiveSizeConfig[];
  paymentConfig: PaymentConfig;
  guidedMode?: boolean;
  guidedStep?: 3 | 4 | null;
}) {
  const barColor   = paymentConfig.barColor   ?? "#16a34a";
  const karteColor = paymentConfig.karteColor ?? "#2563eb";
  const qrColor    = paymentConfig.qrColor    ?? "#7c3aed";
  const bookColor  = paymentConfig.bookColor  ?? "#16a34a";
  const methodColor: Record<PaymentMethod, string> = { bar: barColor, karte: karteColor, qr: qrColor };

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

  // Whether book button is in "compact inline" mode (side-by-side with quick amounts)
  const inlineBook = showPayment && paymentMethod === "bar";

  return (
    <div
      data-testid="payment-zone"
      className={cn(
        // h-full + flex-col: fills the FreeDashboardPanel body; overflow-auto: internal scroll if panel too small
        "h-full flex flex-col overflow-auto rounded-2xl pos-section p-2 transition-all",
        guidedMode && guidedStep === 3 && "ring-2 ring-[#00D6A3]/50",
        guidedMode && guidedStep === 4 && "ring-2 ring-green-400/40"
      )}
    >
      {/* Guided step labels */}
      {guidedMode && showPayment && guidedStep === 3 && (
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-full bg-[#00D6A3]/15 px-2.5 py-0.5 text-xs font-black uppercase tracking-widest text-[#00D6A3]">
            Schritt 3 von 4
          </span>
          <span className="text-xs font-semibold text-[#00D6A3]">Zahlungsart auswählen</span>
        </div>
      )}
      {guidedMode && guidedStep === 4 && (
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-full bg-[#00D6A3]/15 px-2.5 py-0.5 text-xs font-black uppercase tracking-widest text-[#00D6A3]">
            Schritt {showPayment ? "4 von 4" : "3 von 3"}
          </span>
          <span className="text-xs font-semibold text-[#00D6A3]">Betrag eingeben</span>
        </div>
      )}
      {showPayment && (
        <>
          {/* Zeile 1: Payment tabs – 64 px */}
          <div
            data-guided-active={guidedMode && guidedStep === 3 ? "true" : undefined}
            className={cn(
              "mb-2 flex gap-2 rounded-2xl transition-all",
              guidedMode && guidedStep === 3 && "guided-ring-pulse"
            )}
          >
            {(["bar", "karte", "qr"] as PaymentMethod[]).map((m) => {
              const color = methodColor[m];
              const isActive = paymentMethod === m;
              return (
                <button
                  key={m}
                  data-testid={`payment-tab-${m}`}
                  onClick={() => onPaymentChange(m)}
                  className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl transition-all duration-200 active:scale-[0.97] select-none"
                  style={{
                    minHeight: 72,
                    backgroundColor: isActive ? color : `${color}22`,
                    color: isActive ? "#ffffff" : color,
                    boxShadow: isActive
                      ? `0 0 0 3px ${color}50, 0 6px 20px ${color}35`
                      : undefined,
                  }}
                >
                  {PAYMENT_ICONS[m]}
                  <span className="text-lg font-black leading-none">{PAYMENT_LABELS[m]}</span>
                </button>
              );
            })}
          </div>

          {/* Karte indicator */}
          {paymentMethod === "karte" && (
            <div className="mb-1.5 flex items-center justify-center gap-2 rounded-xl px-4 py-2"
              style={{ backgroundColor: `${karteColor}20` }}>
              <CreditCard className="h-5 w-5" style={{ color: karteColor }} aria-hidden />
              <span className="text-sm font-semibold" style={{ color: karteColor }}>Kartenzahlung gewählt</span>
            </div>
          )}

          {/* Zeile 2: Gegeben-Eingabe (nur Bar) */}
          {paymentMethod === "bar" && (
            <div
              data-guided-active={guidedMode && guidedStep === 4 && !canBook ? "true" : undefined}
              className={cn(
                "mb-1.5 flex items-stretch gap-1.5",
                guidedMode && guidedStep === 4 && !canBook && "guided-ring-pulse rounded-xl"
              )}
            >
              <button
                data-testid="cash-minus"
                onClick={() => onCashInput((Math.max(0, cashCents - 50) / 100).toFixed(2))}
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
                className="min-h-[56px] min-w-0 flex-1 rounded-xl border-2 px-3 text-center text-4xl font-black tabular-nums outline-none transition-all pos-input focus:ring-4 focus:ring-green-500/20"
              />
              <button
                data-testid="cash-plus"
                onClick={() => onCashInput(((cashCents + 50) / 100).toFixed(2))}
                className="h-14 w-14 shrink-0 grid place-items-center rounded-xl bg-green-500/20 text-green-400 text-2xl font-black transition-all hover:bg-green-500/30 active:scale-95 select-none"
              >+</button>
              <button
                data-testid="cash-clear"
                onClick={() => onCashInput("")}
                className="h-14 w-14 shrink-0 grid place-items-center rounded-xl bg-orange-500/20 text-orange-400 text-xl font-black transition-all hover:bg-orange-500/30 active:scale-95 select-none"
              >C</button>
            </div>
          )}
        </>
      )}

      {/* Zeile 3: Schnellbeträge (Bar) + Bestellung buchen – gemeinsame Zeile */}
      <div className="flex items-stretch gap-1.5">
        {/* Schnellbeträge – scrollbar nur im Bar-Modus sichtbar */}
        {inlineBook && (
          <div
            data-testid="quick-amounts-row"
            className="flex flex-1 min-w-0 gap-1.5 overflow-x-auto"
            style={{ scrollbarWidth: "none" }}
          >
            {quickItems.map(({ cents, bgColor, textColor }) => (
              <button
                key={cents}
                data-testid={`quick-amount-${cents}`}
                onClick={() => onCashInput(((cashCents + cents) / 100).toFixed(2))}
                className="shrink-0 w-[110px] rounded-xl min-h-[62px] flex flex-col items-center justify-center px-1 text-xl font-black leading-tight tracking-tight transition-all active:scale-95 select-none hover:brightness-110"
                style={{ backgroundColor: bgColor, color: textColor }}
              >
                {fmt(cents)}
              </button>
            ))}
          </div>
        )}

        {/* Bestellung buchen */}
        <button
          data-testid="book-button"
          data-guided-ready={guidedMode && guidedStep === 4 && canBook ? "true" : undefined}
          onClick={onBook}
          disabled={!canBook}
          className={cn(
            "shrink-0 flex items-center justify-center gap-2 rounded-2xl min-h-[60px] font-black transition-all select-none",
            inlineBook ? "w-[230px] text-base px-3" : "flex-1 text-xl px-4",
            canBook
              ? "text-white shadow-lg hover:brightness-110 active:scale-[0.98]"
              : "pos-overlay pos-text-dim cursor-not-allowed",
            guidedMode && guidedStep === 4 && canBook && "guided-book-pulse"
          )}
          style={canBook ? { backgroundColor: bookColor } : undefined}
        >
          <ShoppingCart className="h-6 w-6 shrink-0" aria-hidden />
          <span className="leading-tight text-center uppercase tracking-wide">
            {showPayment && paymentMethod === "qr" ? "QR anzeigen" : "Bestellung buchen"}
          </span>
        </button>
      </div>

      {/* Rückgeld – gleiche Schriftgröße wie Gegeben-Feld */}
      {showPayment && paymentMethod === "bar" && cashCents >= cartTotal && cartTotal > 0 && (
        <div className="mt-1.5 flex items-center justify-between rounded-xl bg-green-500/15 px-4 py-2">
          <span className="text-sm font-bold uppercase tracking-wide text-green-400">Rückgeld</span>
          <span className="text-4xl font-black tabular-nums text-green-400">{fmt(change)}</span>
        </div>
      )}
      {/* Noch offen – wenn eingegebener Betrag noch nicht ausreicht */}
      {showPayment && paymentMethod === "bar" && cashCents > 0 && cashCents < cartTotal && cartTotal > 0 && (
        <div className="mt-1.5 flex items-center justify-between rounded-xl bg-orange-500/15 px-4 py-2">
          <span className="text-sm font-bold uppercase tracking-wide text-orange-400">Noch offen</span>
          <span className="text-4xl font-black tabular-nums text-orange-400">{fmt(cartTotal - cashCents)}</span>
        </div>
      )}
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

        <div className="flex-none border-t pos-border-c px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold pos-text-muted">Gesamt</span>
            <span className="text-2xl font-black pos-text tabular-nums">{fmt(cartTotal)}</span>
          </div>
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

// ── Free-panel drag/resize helpers ───────────────────────────────────────────

function FreeDashboardPanel({
  panelId,
  rect,
  editMode,
  isOverlapping,
  label,
  children,
  onDragStart,
  onResizeStart,
}: {
  panelId: PanelId;
  rect: PanelRect;
  editMode: boolean;
  isOverlapping: boolean;
  label: string;
  children: React.ReactNode;
  onDragStart: (panelId: PanelId, e: React.PointerEvent) => void;
  onResizeStart: (panelId: PanelId, mode: Exclude<ResizeMode, "move">, e: React.PointerEvent) => void;
}) {
  return (
    // Panel = single unit: position + dimensions from store; flex column so header + body fill exactly
    <div
      data-panel={panelId}
      data-overlap={isOverlapping ? "true" : undefined}
      style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl",
        editMode && !isOverlapping && "ring-2 ring-primaq-400/60",
        editMode && isOverlapping  && "ring-2 ring-red-500/80",
      )}
    >
      {/* Drag handle – flex-none so it doesn't steal height from body */}
      {editMode && (
        <div
          data-testid={`fl-drag-${panelId}`}
          className="flex-none h-7 z-10 cursor-move flex items-center justify-between px-2 bg-primaq-500/30 hover:bg-primaq-500/45 touch-none select-none backdrop-blur-sm"
          onPointerDown={(e) => onDragStart(panelId, e)}
        >
          <span className="text-[9px] font-black uppercase tracking-widest text-white/90 truncate">{label}</span>
          <span className="text-white/50 text-sm leading-none">⠿</span>
        </div>
      )}

      {/* Body – takes remaining height; children fill this via h-full */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>

      {/* Resize handles – absolute within the panel. Edges: 16px hitbox + 4px stripe. Corners: 24px. */}
      {editMode && (
        <>
          {/* Edges – z-20; inner div shows visual stripe at the edge, outer div is the full hitbox */}
          <div data-testid={`fl-resize-n-${panelId}`}
            className="absolute inset-x-0 top-0 h-3 z-20 cursor-ns-resize touch-none select-none group"
            onPointerDown={(e) => onResizeStart(panelId, "n", e)}>
            <div className="absolute inset-x-0 top-0 h-1 bg-primaq-400/30 group-hover:bg-primaq-400/75 transition-colors" />
          </div>
          <div data-testid={`fl-resize-s-${panelId}`}
            className="absolute inset-x-0 bottom-0 h-3 z-20 cursor-ns-resize touch-none select-none group"
            onPointerDown={(e) => onResizeStart(panelId, "s", e)}>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-primaq-400/30 group-hover:bg-primaq-400/75 transition-colors" />
          </div>
          <div data-testid={`fl-resize-e-${panelId}`}
            className="absolute inset-y-0 right-0 w-4 z-20 cursor-ew-resize touch-none select-none group"
            onPointerDown={(e) => onResizeStart(panelId, "e", e)}>
            <div className="absolute inset-y-0 right-0 w-1 bg-primaq-400/30 group-hover:bg-primaq-400/75 transition-colors" />
          </div>
          <div data-testid={`fl-resize-w-${panelId}`}
            className="absolute inset-y-0 left-0 w-4 z-20 cursor-ew-resize touch-none select-none group"
            onPointerDown={(e) => onResizeStart(panelId, "w", e)}>
            <div className="absolute inset-y-0 left-0 w-1 bg-primaq-400/30 group-hover:bg-primaq-400/75 transition-colors" />
          </div>
          {/* Corners – z-30; override edge hitboxes at intersection areas */}
          <div data-testid={`fl-resize-nw-${panelId}`}
            className="absolute top-0 left-0 w-6 h-6 z-30 cursor-nw-resize touch-none select-none"
            onPointerDown={(e) => onResizeStart(panelId, "nw", e)} />
          <div data-testid={`fl-resize-ne-${panelId}`}
            className="absolute top-0 right-0 w-6 h-6 z-30 cursor-ne-resize touch-none select-none"
            onPointerDown={(e) => onResizeStart(panelId, "ne", e)} />
          <div data-testid={`fl-resize-sw-${panelId}`}
            className="absolute bottom-0 left-0 w-6 h-6 z-30 cursor-sw-resize touch-none select-none"
            onPointerDown={(e) => onResizeStart(panelId, "sw", e)} />
          <div data-testid={`fl-resize-se-${panelId}`}
            className="absolute bottom-0 right-0 w-6 h-6 z-30 cursor-se-resize touch-none select-none flex items-end justify-end p-1.5"
            onPointerDown={(e) => onResizeStart(panelId, "se", e)}>
            <div className="w-3 h-3 border-b-2 border-r-2 border-primaq-400/80 rounded-br-sm" />
          </div>
        </>
      )}
    </div>
  );
}

/** True if two rects share any area. */
function rectsOverlap(a: PanelRect, b: PanelRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Clamps a drag-move delta so the panel stops at PANEL_GAP from any other panel.
 * Uses the start position to determine which side of each obstacle we're approaching.
 * If panels already overlap at the start (e.g. stale layout), clamping is skipped so
 * the user can drag them apart.
 */
function clampMoveAgainstOthers(
  startRect: PanelRect,
  dx: number,
  dy: number,
  others: PanelRect[],
  gap: number,
): { dx: number; dy: number } {
  let cdx = dx;
  let cdy = dy;

  for (const O of others) {
    const P = startRect;
    const nx = P.x + cdx;
    const ny = P.y + cdy;

    // Would the proposed position collide with O (including gap zone)?
    const colX = nx < O.x + O.w + gap && nx + P.w > O.x - gap;
    const colY = ny < O.y + O.h + gap && ny + P.h > O.y - gap;
    if (!colX || !colY) continue;

    // Horizontal constraint: clamp based on original relative position
    if (P.x + P.w <= O.x) {
      // P was to the left of O – prevent right entry
      cdx = Math.min(cdx, O.x - gap - P.x - P.w);
    } else if (P.x >= O.x + O.w) {
      // P was to the right of O – prevent left entry
      cdx = Math.max(cdx, O.x + O.w + gap - P.x);
    }
    // Vertical constraint: clamp based on original relative position
    if (P.y + P.h <= O.y) {
      // P was above O – prevent downward entry
      cdy = Math.min(cdy, O.y - gap - P.y - P.h);
    } else if (P.y >= O.y + O.h) {
      // P was below O – prevent upward entry
      cdy = Math.max(cdy, O.y + O.h + gap - P.y);
    }
  }

  return { dx: cdx, dy: cdy };
}

/**
 * Clamps a resize's candidate rect so the edge(s) being dragged stop at
 * PANEL_GAP from any neighbour they're growing toward — the same
 * collision-prevention `clampMoveAgainstOthers` gives drag, applied to
 * resize. Only edges that actually moved from `startRect` are checked (an
 * edge that didn't move can't create a new overlap), and only against
 * neighbours that were on that side already (an already-overlapping stale
 * layout can still be pulled apart, matching the move-drag behaviour).
 */
function clampResizeAgainstOthers(
  startRect: PanelRect,
  rawRect: PanelRect,
  others: PanelRect[],
  gap: number,
  mn: { w: number; h: number },
): PanelRect {
  let { x, y, w, h } = rawRect;

  const growingRight = x + w > startRect.x + startRect.w;
  const growingLeft  = x < startRect.x;
  const growingDown  = y + h > startRect.y + startRect.h;
  const growingUp    = y < startRect.y;

  for (const O of others) {
    // Perpendicular-axis overlap decides whether a neighbour is even in the way.
    const vOverlap = y < O.y + O.h && y + h > O.y;
    const hOverlap = x < O.x + O.w && x + w > O.x;

    if (growingRight && vOverlap && O.x >= startRect.x + startRect.w) {
      const maxRight = O.x - gap;
      if (x + w > maxRight) w = Math.max(mn.w, maxRight - x);
    }
    if (growingLeft && vOverlap && O.x + O.w <= startRect.x) {
      const minLeft = O.x + O.w + gap;
      if (x < minLeft) { w = Math.max(mn.w, x + w - minLeft); x = minLeft; }
    }
    if (growingDown && hOverlap && O.y >= startRect.y + startRect.h) {
      const maxBottom = O.y - gap;
      if (y + h > maxBottom) h = Math.max(mn.h, maxBottom - y);
    }
    if (growingUp && hOverlap && O.y + O.h <= startRect.y) {
      const minTop = O.y + O.h + gap;
      if (y < minTop) { h = Math.max(mn.h, y + h - minTop); y = minTop; }
    }
  }

  return { x, y, w, h };
}

/** Returns the set of panel IDs that are part of any overlapping pair. */
function findOverlappingPanels(panels: Record<PanelId, PanelRect>): Set<PanelId> {
  const ids = Object.keys(panels) as PanelId[];
  const result = new Set<PanelId>();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (rectsOverlap(panels[ids[i]], panels[ids[j]])) {
        result.add(ids[i]);
        result.add(ids[j]);
      }
    }
  }
  return result;
}

/** Clamp panel to workspace bounds with PANEL_GAP margin; adjusts dimension when position hits an edge. */
function clampToWorkspace(r: PanelRect, wsW: number, wsH: number, mn: { w: number; h: number }): PanelRect {
  const G = PANEL_GAP;
  let { x, y, w, h } = r;
  w = Math.max(mn.w, Math.min(w, wsW - 2 * G));
  h = Math.max(mn.h, Math.min(h, wsH - 2 * G));
  if (x < G) { w = Math.max(mn.w, w + x - G); x = G; }
  if (y < G) { h = Math.max(mn.h, h + y - G); y = G; }
  x = Math.min(x, wsW - w - G);
  y = Math.min(y, wsH - h - G);
  return { x, y, w, h };
}

/** Pure helper: derive new rect from start rect + pointer delta for any resize mode. */
function computePanelRect(
  mode: ResizeMode,
  r: PanelRect,
  dx: number,
  dy: number,
  mn: { w: number; h: number }
): PanelRect {
  const cw = (v: number) => Math.max(mn.w, v);
  const ch = (v: number) => Math.max(mn.h, v);
  switch (mode) {
    case "move": return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
    case "n":  { const h = ch(r.h - dy); return { x: r.x, y: r.y + r.h - h, w: r.w, h }; }
    case "s":  return { x: r.x, y: r.y, w: r.w, h: ch(r.h + dy) };
    case "e":  return { x: r.x, y: r.y, w: cw(r.w + dx), h: r.h };
    case "w":  { const w = cw(r.w - dx); return { x: r.x + r.w - w, y: r.y, w, h: r.h }; }
    case "nw": { const w = cw(r.w - dx); const h = ch(r.h - dy); return { x: r.x + r.w - w, y: r.y + r.h - h, w, h }; }
    case "ne": { const h = ch(r.h - dy); return { x: r.x, y: r.y + r.h - h, w: cw(r.w + dx), h }; }
    case "sw": { const w = cw(r.w - dx); return { x: r.x + r.w - w, y: r.y, w, h: ch(r.h + dy) }; }
    case "se": return { x: r.x, y: r.y, w: cw(r.w + dx), h: ch(r.h + dy) };
  }
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

  // Free-panel layout – device-local, NOT synced to Supabase
  const {
    panels, panelsRef, hydrated: panelsHydrated, hasSavedLayout,
    save: savePanels, updateState, reset: resetPanels,
  } = usePosFreePanelStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [editMode, setEditMode] = useState(false);
  const [savedSnack, setSavedSnack] = useState(false);
  const [overlapSet, setOverlapSet] = useState<Set<PanelId>>(new Set());
  const [overlapSnack, setOverlapSnack] = useState(false);

  // Free-panel drag state – mutated in place during drag (no React re-renders)
  const freeDragRef = useRef<{
    panelId: PanelId;
    mode: ResizeMode;
    startX: number;
    startY: number;
    startRect: PanelRect;
  } | null>(null);

  // Exit edit mode when admin logs out
  useEffect(() => { if (!isAdmin) setEditMode(false); }, [isAdmin]);

  // Keep overlap indicators in sync with panel state (catches initial load with bad layout too)
  useEffect(() => {
    if (!panels) { setOverlapSet(new Set()); return; }
    setOverlapSet(findOverlappingPanels(panels));
  }, [panels]);

  // Pointer listeners for free-panel drag/resize – direct DOM updates, no React re-renders
  useEffect(() => {
    let rafId = 0;
    const onMove = (e: PointerEvent) => {
      const d = freeDragRef.current;
      if (!d) return;
      const ctr = containerRef.current;
      if (!ctr) return;
      const el = ctr.querySelector<HTMLElement>(`[data-panel="${d.panelId}"]`);
      if (!el) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const r  = d.startRect;
      const mn = FL_PANEL_MINS[d.panelId];
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const others = (Object.entries(panelsRef.current!) as [PanelId, PanelRect][])
          .filter(([id]) => id !== d.panelId)
          .map(([, rect]) => rect);
        let raw: PanelRect;
        if (d.mode === "move") {
          // Collision prevention: clamp delta so panel stops at PANEL_GAP from others
          const { dx: cdx, dy: cdy } = clampMoveAgainstOthers(r, dx, dy, others, PANEL_GAP);
          raw = computePanelRect("move", r, cdx, cdy, mn);
        } else {
          // Same collision prevention for resize: the growing edge(s) stop at
          // PANEL_GAP from any neighbour instead of overlapping it.
          const candidate = computePanelRect(d.mode, r, dx, dy, mn);
          raw = clampResizeAgainstOthers(r, candidate, others, PANEL_GAP, mn);
        }
        const nr = clampToWorkspace(raw, ctr.clientWidth, ctr.clientHeight, mn);
        el.style.left   = `${nr.x}px`;
        el.style.top    = `${nr.y}px`;
        el.style.width  = `${nr.w}px`;
        el.style.height = `${nr.h}px`;
      });
    };
    const onUp = () => {
      const d = freeDragRef.current;
      if (!d) return;
      cancelAnimationFrame(rafId);
      freeDragRef.current = null;
      const ctr = containerRef.current;
      if (!ctr) return;
      const el = ctr.querySelector<HTMLElement>(`[data-panel="${d.panelId}"]`);
      if (!el) return;
      el.style.zIndex = ""; // restore stacking order after drag/resize
      const newRect: PanelRect = {
        x: parseFloat(el.style.left)   || d.startRect.x,
        y: parseFloat(el.style.top)    || d.startRect.y,
        w: parseFloat(el.style.width)  || d.startRect.w,
        h: parseFloat(el.style.height) || d.startRect.h,
      };
      const updated = { ...panelsRef.current!, [d.panelId]: newRect };
      const overlapping = findOverlappingPanels(updated);
      if (overlapping.size > 0) {
        updateState(updated); // persist position in-memory but NOT to localStorage
        setOverlapSnack(true);
        setTimeout(() => setOverlapSnack(false), 4000);
      } else {
        savePanels(updated);
        setSavedSnack(true);
        setTimeout(() => setSavedSnack(false), 2500);
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      cancelAnimationFrame(rafId);
    };
  }, [savePanels, updateState, panelsRef]);

  // Correct the store's initial window-based size estimate against the REAL
  // workspace box as soon as it's measurable. The estimate (used before this
  // container exists) can't know the exact header/guided-bar/status-bar
  // chrome height, so without this pass a freshly-generated default layout
  // could be sized for a slightly taller box than actually exists — leaving
  // zero margin at the workspace's true bottom edge. Runs once per mount.
  const didMeasureRef = useRef(false);
  useLayoutEffect(() => {
    if (didMeasureRef.current || !panelsHydrated || !panels) return;
    const ctr = containerRef.current;
    if (!ctr || ctr.clientWidth === 0 || ctr.clientHeight === 0) return;
    didMeasureRef.current = true;
    if (hasSavedLayout) {
      savePanels(normalizeLayout(panels, ctr.clientWidth, ctr.clientHeight));
    } else {
      updateState(defaultPanelsForWorkspace(ctr.clientWidth, ctr.clientHeight));
    }
    // The container only exists once every store has hydrated (an earlier
    // "Laden…" placeholder renders in its place until then) — re-run this
    // effect whenever any of those flags change too, so it doesn't miss the
    // moment the real DOM node (and thus containerRef) first appears.
  }, [panelsHydrated, panels, hasSavedLayout, savePanels, updateState, hydrated, flavorsHydrated, layoutHydrated]);

  // Normalise layout on browser resize (debounced 150 ms)
  useEffect(() => {
    let timer = 0;
    const handleResize = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const ctr = containerRef.current;
        const pnls = panelsRef.current;
        if (!ctr || !pnls) return;
        savePanels(normalizeLayout(pnls, ctr.clientWidth, ctr.clientHeight));
      }, 150);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
    };
  }, [savePanels, panelsRef]);

  const startPanelDrag = useCallback((panelId: PanelId, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = panelsRef.current?.[panelId];
    if (!rect) return;
    freeDragRef.current = { panelId, mode: "move", startX: e.clientX, startY: e.clientY, startRect: { ...rect } };
    // Bring active panel above all others during drag
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-panel="${panelId}"]`);
    if (el) el.style.zIndex = "40";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [panelsRef]);

  const startPanelResize = useCallback((panelId: PanelId, mode: Exclude<ResizeMode, "move">, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = panelsRef.current?.[panelId];
    if (!rect) return;
    freeDragRef.current = { panelId, mode, startX: e.clientX, startY: e.clientY, startRect: { ...rect } };
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-panel="${panelId}"]`);
    if (el) el.style.zIndex = "40";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [panelsRef]);

  // Reset clears the saved custom layout and exits edit mode — the page falls
  // straight back to the stable fixed grid (never re-enters free-layout on its
  // own; only an explicit admin edit click does that again). Also clears the
  // older, already-orphaned device-layout key so no leftover legacy data can
  // resurface either.
  const handleReset = useCallback(() => {
    const ctr = containerRef.current;
    if (ctr && ctr.clientWidth > 0 && ctr.clientHeight > 0) {
      resetPanels(ctr.clientWidth, ctr.clientHeight);
    } else {
      resetPanels();
    }
    try { localStorage.removeItem("primaq-pos-device-layout-v1"); } catch { /* ignore */ }
    setOverlapSet(new Set());
    setEditMode(false);
    setSavedSnack(true);
    setTimeout(() => setSavedSnack(false), 2500);
  }, [resetPanels]);

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

  const canBook = cart.length > 0 && (showPayment ? (payment !== "bar" || cashCents >= cartTotal) : true);

  // Derived guided step — pure function of existing state, no new store needed
  const guidedStep: 1 | 2 | 3 | 4 =
    pendingFlavor !== null ? 2 :
    cart.length === 0 ? 1 :
    (!paymentConfirmed && showPayment) ? 3 :
    4;

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
    setPayment(method);
    setCashInput("");
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
  }, [canBook, showPayment, payment, bookOrder]);

  const handleQrConfirm = useCallback(() => {
    bookOrder("qr");
    setShowQr(false);
    setCashInput("");
    setPaymentConfirmed(false);
  }, [bookOrder]);

  if (!hydrated || !flavorsHydrated || !layoutHydrated || !panelsHydrated) {
    return (
      <div className="flex h-full items-center justify-center pos-text-muted">Laden…</div>
    );
  }

  // The stable fixed grid is what normal sales operation ALWAYS shows — a
  // saved free-layout is never applied outside of an active admin edit
  // session, no matter what (or how stale/corrupted) is in localStorage. A
  // seller must never be able to see a broken register because of a saved or
  // leftover layout from a previous edit session.
  const showFreeLayout = editMode;

  return (
    <FlavorsCtx.Provider value={allFlavors}>
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {guidedMode && <GuidedStepsBar step={guidedStep} />}

      {/*
        Standard: stable fixed grid (unchanged, matches normal sales
        operation exactly). Admin can switch into the free (absolutely
        positioned, drag/resize) panel system via "Layout bearbeiten"; once a
        custom layout is saved it stays active until "Layout zurücksetzen"
        clears it and returns to this same fixed grid.
      */}
      {showFreeLayout && panels ? (
      <div ref={containerRef} data-testid="fl-container" className="flex-1 min-h-0 relative overflow-hidden">
        {panels && (
          <>
            <FreeDashboardPanel
              panelId="flavors"
              rect={panels.flavors}
              editMode={editMode}
              isOverlapping={overlapSet.has("flavors")}
              label="Sorten"
              onDragStart={startPanelDrag}
              onResizeStart={startPanelResize}
            >
              <FlavorColumn
                onFlavorClick={handleFlavorClick}
                cardSize={layout.flavorCardSize}
                pendingFlavor={pendingFlavor}
                guidedMode={guidedMode}
                guidedActive={guidedStep === 1}
              />
            </FreeDashboardPanel>

            <FreeDashboardPanel
              panelId="sizes"
              rect={panels.sizes}
              editMode={editMode}
              isOverlapping={overlapSet.has("sizes")}
              label="Größen"
              onDragStart={startPanelDrag}
              onResizeStart={startPanelResize}
            >
              <SizeRow
                effectiveSizes={effectiveSizes}
                pendingFlavor={pendingFlavor}
                onSizePick={handleSizePick}
                guidedMode={guidedMode}
                guidedActive={guidedStep === 2}
              />
            </FreeDashboardPanel>

            <FreeDashboardPanel
              panelId="payment"
              rect={panels.payment}
              editMode={editMode}
              isOverlapping={overlapSet.has("payment")}
              label="Zahlung"
              onDragStart={startPanelDrag}
              onResizeStart={startPanelResize}
            >
              <PaymentBlock
                showPayment={showPayment}
                paymentMethod={payment}
                cashInput={cashInput}
                cashCents={cashCents}
                cartTotal={cartTotal}
                change={change}
                canBook={canBook}
                onPaymentChange={handlePaymentChange}
                onCashInput={setCashInput}
                onBook={handleBook}
                effectiveSizes={effectiveSizes}
                paymentConfig={layout.payment}
                guidedMode={guidedMode}
                guidedStep={guidedStep === 3 ? 3 : guidedStep === 4 ? 4 : null}
              />
            </FreeDashboardPanel>

            <FreeDashboardPanel
              panelId="cart"
              rect={panels.cart}
              editMode={editMode}
              isOverlapping={overlapSet.has("cart")}
              label="Warenkorb"
              onDragStart={startPanelDrag}
              onResizeStart={startPanelResize}
            >
              <CartColumn
                widthPx={panels.cart.w}
                qtyBtnSize={layout.qtyButtonSize}
                cartFontSize={layout.cartFontSize}
                cart={cart}
                cartTotal={cartTotal}
                onChangeQty={changeQty}
                onRemove={removeFromCart}
                onClear={clearCart}
                effectiveSizes={effectiveSizes}
              />
            </FreeDashboardPanel>
          </>
        )}
      </div>
      ) : (
      <div data-testid="sales-grid" className="flex flex-1 min-h-0 gap-2.5 overflow-hidden">
        {/* Left: Sorten+Größen row, then Zahlung below */}
        <div className="flex flex-1 min-w-0 flex-col gap-2.5">
          <div className="flex min-h-0 gap-2.5" style={{ flex: "3 1 0%" }}>
            <div className="min-w-0 flex-1">
              <FlavorColumn
                onFlavorClick={handleFlavorClick}
                cardSize={layout.flavorCardSize}
                pendingFlavor={pendingFlavor}
                guidedMode={guidedMode}
                guidedActive={guidedStep === 1}
              />
            </div>
            <div className="w-[180px] shrink-0">
              <SizeRow
                effectiveSizes={effectiveSizes}
                pendingFlavor={pendingFlavor}
                onSizePick={handleSizePick}
                guidedMode={guidedMode}
                guidedActive={guidedStep === 2}
              />
            </div>
          </div>
          <div className="min-h-0" style={{ flex: "2 1 0%" }}>
            <PaymentBlock
              showPayment={showPayment}
              paymentMethod={payment}
              cashInput={cashInput}
              cashCents={cashCents}
              cartTotal={cartTotal}
              change={change}
              canBook={canBook}
              onPaymentChange={handlePaymentChange}
              onCashInput={setCashInput}
              onBook={handleBook}
              effectiveSizes={effectiveSizes}
              paymentConfig={layout.payment}
              guidedMode={guidedMode}
              guidedStep={guidedStep === 3 ? 3 : guidedStep === 4 ? 4 : null}
            />
          </div>
        </div>

        {/* Right: Warenkorb – fixed responsive column, spans full height */}
        <div className="min-h-0 shrink-0" style={{ width: "clamp(360px, 30vw, 440px)" }}>
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
          />
        </div>
      </div>
      )}

      {/* Footer: Letzte Buchung / Tagesstatistik */}
      {layout.toggles["letzte-bestellung"] && (
        <SalesStatusBar
          daily={daily}
          onVoid={voidLastOrder}
          showLastBooking={layout.toggles["live-monitor"]}
          showStats={layout.toggles["verkaufszaehler"]}
        />
      )}

      {/* Admin: layout edit toggle */}
      {isAdmin && (
        <button
          data-testid="layout-edit-toggle"
          onClick={() => setEditMode((v) => !v)}
          className={cn(
            "fixed bottom-4 left-4 z-40 rounded-full px-3 py-1.5 text-xs font-bold shadow-md transition-all",
            editMode
              ? "bg-primaq-500 text-white shadow-primaq-500/30"
              : "bg-black/25 text-white/60 hover:bg-black/40 backdrop-blur-sm"
          )}
        >
          {editMode ? "✓ Fertig" : "✏ Layout"}
        </button>
      )}

      {/* Edit-mode floating panel */}
      {editMode && (
        <div
          data-testid="layout-edit-panel"
          className="fixed top-16 right-4 z-40 w-52 rounded-2xl pos-surface shadow-2xl border pos-border-c p-3 space-y-2"
        >
          <p className="text-[10px] font-black uppercase tracking-widest pos-text-label">Freies Layout</p>
          <p className="text-[11px] pos-text-muted leading-snug">Leiste ziehen = verschieben · Ecken/Kanten = skalieren</p>
          <div className="border-t pos-border-c pt-2">
            <button
              data-testid="layout-reset-btn"
              onClick={handleReset}
              className="w-full rounded-lg px-3 py-1.5 text-xs font-semibold text-red-400 pos-overlay hover:bg-red-500/10 transition-colors"
            >
              ↺ Layout zurücksetzen
            </button>
          </div>
        </div>
      )}

      {/* Saved snackbar */}
      {savedSnack && (
        <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-primaq-500 px-4 py-2 text-sm font-bold text-white shadow-lg pointer-events-none">
          Layout für dieses Gerät gespeichert
        </div>
      )}

      {/* Overlap warning – shown when panels collide; layout NOT saved to localStorage */}
      {overlapSnack && (
        <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white shadow-lg pointer-events-none">
          Überlappung – bitte Layout korrigieren
        </div>
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
