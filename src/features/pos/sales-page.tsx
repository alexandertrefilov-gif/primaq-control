"use client";

import { useState, useCallback, useEffect, useMemo, useRef, createContext, useContext } from "react";
import { Check, Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/utils";
import { usePosStore } from "./use-pos-store";
import { usePosFlavorStore } from "./use-pos-flavor-store";
import { usePosLayoutStore } from "./use-pos-layout-store";
import { useAdmin } from "./admin-context";
import type { CartFontSize, TextColorMode } from "./use-pos-layout-store";
import { computeTextColor } from "./use-pos-layout-store";
import {
  FLAVORS,
  MACHINE_GROUP_LABELS,
  SIZES,
  getSizeName,
} from "./pos-config";
import type { FlavorConfig, SizeConfig } from "./pos-config";
import type { CartItem, PaymentMethod } from "./pos-types";

type EffectiveSizeConfig = SizeConfig & {
  backgroundColor: string;
  textColorMode: TextColorMode;
  imageDataUrl: string | null;
  imageScale: number;
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

const QUICK_AMOUNTS = [5, 10, 20, 50, 100];

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

// ── Flavor card ──────────────────────────────────────────────────────────────

function FlavorCard({
  flavor,
  onClick,
}: {
  flavor: FlavorConfig;
  onClick: () => void;
}) {
  const allFlavors = useFlavorList();
  const isMix = !!flavor.isMix && !!flavor.mixColors;
  const part1 = isMix && flavor.mixParts ? allFlavors.find((f) => f.id === flavor.mixParts![0]) : null;
  const part2 = isMix && flavor.mixParts ? allFlavors.find((f) => f.id === flavor.mixParts![1]) : null;

  return (
    <button
      aria-label={flavor.name}
      onClick={onClick}
      className="group flex w-full flex-col items-center gap-1.5 select-none focus-visible:outline-none"
    >
      {/* Circle icon */}
      <div
        className={cn(
          "relative w-full aspect-square overflow-hidden rounded-full shadow-lg transition-all",
          "group-hover:shadow-2xl group-hover:ring-4 group-hover:ring-primaq-400/50 group-hover:ring-offset-2 group-hover:ring-offset-white",
          "group-active:scale-[0.92]"
        )}
      >
        {/* Background */}
        {isMix ? (
          <>
            <div
              className="absolute inset-0"
              style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)", background: flavor.mixColors![0] }}
            />
            <div
              className="absolute inset-0"
              style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)", background: flavor.mixColors![1] }}
            />
            <div className="absolute inset-0 bg-black/10" />
          </>
        ) : (
          <div className="absolute inset-0" style={{ background: flavor.backgroundColor }} />
        )}

        {/* Mix icons: each at the geometric centroid of its triangle */}
        {isMix && part1?.imageSrc && (
          <div
            className="pointer-events-none absolute z-10"
            style={{ left: "33%", top: "33%", transform: "translate(-50%, -50%)" }}
          >
            <ProductImage
              src={part1.imageSrc}
              fallbackSrc={part1.fallbackImageSrc}
              alt=""
              className="h-16 w-16 object-contain drop-shadow-md"
            />
          </div>
        )}
        {isMix && part2?.imageSrc && (
          <div
            className="pointer-events-none absolute z-10"
            style={{ left: "67%", top: "67%", transform: "translate(-50%, -50%)" }}
          >
            <ProductImage
              src={part2.imageSrc}
              fallbackSrc={part2.fallbackImageSrc}
              alt=""
              className="h-16 w-16 object-contain drop-shadow-md"
            />
          </div>
        )}

        {/* Regular product image: large and centered */}
        {!isMix && flavor.imageSrc && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ProductImage
              src={flavor.imageSrc}
              fallbackSrc={flavor.fallbackImageSrc}
              alt=""
              className="h-[82%] w-[82%] object-contain drop-shadow-xl"
            />
          </div>
        )}

        {/* Depth vignette */}
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{ boxShadow: "inset 0 -6px 18px rgba(0,0,0,0.20), inset 0 2px 8px rgba(255,255,255,0.16)" }}
        />
      </div>

      {/* Name below circle */}
      <span className="w-full text-center text-sm font-black leading-tight text-ink line-clamp-2 px-0.5">
        {flavor.name}
      </span>
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
            style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)", background: flavor.mixColors![0] }}
          />
          <div
            className="absolute inset-0"
            style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)", background: flavor.mixColors![1] }}
          />
        </>
      ) : (
        <div className="absolute inset-0" style={{ background: flavor.backgroundColor }} />
      )}
      {/* Mix icons: each anchored at the geometric centroid of its triangle */}
      {isMix && part1?.imageSrc && (
        <div
          className="absolute z-10"
          style={{ left: "33%", top: "33%", transform: "translate(-50%, -50%)" }}
        >
          <ProductImage
            src={part1.imageSrc}
            fallbackSrc={part1.fallbackImageSrc}
            alt=""
            className={large ? "h-7 w-7 object-contain drop-shadow-sm" : "h-5 w-5 object-contain drop-shadow-sm"}
          />
        </div>
      )}
      {isMix && part2?.imageSrc && (
        <div
          className="absolute z-10"
          style={{ left: "67%", top: "67%", transform: "translate(-50%, -50%)" }}
        >
          <ProductImage
            src={part2.imageSrc}
            fallbackSrc={part2.fallbackImageSrc}
            alt=""
            className={large ? "h-7 w-7 object-contain drop-shadow-sm" : "h-5 w-5 object-contain drop-shadow-sm"}
          />
        </div>
      )}
      {!isMix && (
        <div className="relative z-10 flex h-full w-full items-center justify-center">
          {flavor.imageSrc && (
            <ProductImage
              src={flavor.imageSrc}
              fallbackSrc={flavor.fallbackImageSrc}
              alt=""
              className={large ? "h-9 w-9 object-contain drop-shadow-sm" : "h-6 w-6 object-contain drop-shadow-sm"}
            />
          )}
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
      className="grid h-11 w-11 place-items-center rounded-full text-black/25 hover:bg-red-50 hover:text-red-500 active:scale-90 transition-all"
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
}: {
  label: string;
  flavors: FlavorConfig[];
  onFlavorClick: (flavor: FlavorConfig) => void;
  cardSize: number;
}) {
  if (flavors.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5">
      {/* Centered divider header */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-primaq-200/70" />
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-primaq-500 px-1">
          {label}
        </span>
        <div className="flex-1 h-px bg-primaq-200/70" />
      </div>
      {/* auto-fit + justify-center → cards always centered, exact cardSize columns */}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(auto-fit, ${cardSize}px)`,
          justifyContent: "center",
        }}
      >
        {flavors.map((f) => (
          <FlavorCard key={f.id} flavor={f} onClick={() => onFlavorClick(f)} />
        ))}
      </div>
    </div>
  );
}

// ── Size row – horizontal strip above the flavor grid ────────────────────────

function SizeRow({
  selectedId,
  onSelect,
  effectiveSizes,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  effectiveSizes: EffectiveSizeConfig[];
}) {
  if (effectiveSizes.length === 0) {
    return (
      <div className="shrink-0 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-center">
        <p className="text-sm font-bold text-amber-700">
          Keine Verkaufsgröße aktiv. Bitte in Einstellungen → Verkaufsoberfläche mindestens eine Größe aktivieren.
        </p>
      </div>
    );
  }

  return (
    <div className="shrink-0">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-black/40">
        Größe wählen
      </p>
      <div className="flex gap-3">
        {effectiveSizes.map((size) => {
          const isActive = selectedId === size.id;
          const textColor = computeTextColor(size.textColorMode, size.backgroundColor);
          return (
            <button
              key={size.id}
              onClick={() => onSelect(size.id)}
              className={cn(
                "relative flex h-[160px] flex-1 flex-col overflow-hidden rounded-2xl border-2 shadow transition-all select-none",
                isActive
                  ? "border-primaq-500 shadow-lg shadow-primaq-500/20 ring-2 ring-primaq-500/30"
                  : "border-transparent hover:border-primaq-300 active:scale-[0.97]"
              )}
              style={{ backgroundColor: size.backgroundColor }}
            >
              {isActive && (
                <span className="absolute right-2 top-2 z-10 grid h-5 w-5 place-items-center rounded-full bg-primaq-500 text-white">
                  <Check className="h-3 w-3" />
                </span>
              )}
              {/* Image zone: 72 % of button height; overflow-hidden keeps zoom within zone */}
              <div className="flex w-full items-center justify-center overflow-hidden" style={{ height: "72%" }}>
                {size.imageDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={size.imageDataUrl}
                    alt=""
                    className="block h-[95%] w-[95%] object-contain drop-shadow-lg"
                    style={{ transform: `scale(${(size.imageScale ?? 100) / 100})`, transformOrigin: "center" }}
                  />
                ) : (
                  <ProductImage
                    src={size.imageSrc}
                    fallbackSrc={size.fallbackImageSrc}
                    alt=""
                    className="block h-[95%] w-[95%] object-contain drop-shadow-lg"
                    style={{ transform: `scale(${(size.imageScale ?? 100) / 100})`, transformOrigin: "center" }}
                  />
                )}
              </div>
              {/* Text zone: 28 % of button height */}
              <div className="flex flex-col items-center justify-center" style={{ height: "28%" }}>
                <span className="text-xl font-black leading-tight" style={{ color: textColor }}>
                  {size.name}
                </span>
                <span className="text-sm font-bold leading-tight" style={{ color: textColor, opacity: 0.75 }}>
                  {fmt(size.priceCents)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Middle column – flavors ───────────────────────────────────────────────────

function FlavorColumn({
  selectedSize,
  onFlavorClick,
  cardSize,
}: {
  selectedSize: SizeConfig | null;
  onFlavorClick: (flavor: FlavorConfig) => void;
  cardSize: number;
}) {
  const allFlavors = useFlavorList();
  const groups = Object.entries(MACHINE_GROUP_LABELS);

  return (
    <div className="flex flex-1 flex-col rounded-2xl bg-white shadow min-h-0">
      <div className="shrink-0 px-3 pt-3 pb-2 flex items-baseline gap-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-black/40">
          Sorte wählen
        </p>
        {selectedSize && (
          <p className="text-sm font-bold text-primaq-500 ml-auto">
            {selectedSize.name} – {fmt(selectedSize.priceCents)}
          </p>
        )}
      </div>
      {!selectedSize ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center px-4">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-primaq-100">
            <ShoppingCart className="h-7 w-7 text-primaq-500" />
          </div>
          <p className="text-base font-bold text-black/40">Bitte oben eine Größe wählen</p>
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto min-h-0 px-3 pb-3 space-y-3">
        {groups.map(([groupId, groupLabel]) => {
          const flavors = allFlavors.filter((f) => f.group === groupId);
          return (
            <FlavorGroup
              key={groupId}
              label={groupLabel}
              flavors={flavors}
              onFlavorClick={onFlavorClick}
              cardSize={cardSize}
            />
          );
        })}
      </div>
      )}
    </div>
  );
}

// ── Right column – cart + payment ─────────────────────────────────────────────

const CART_FONT_CFG: Record<CartFontSize, { name: string; price: string; qty: string; qtyW: string }> = {
  normal: { name: "text-xl font-bold", price: "text-xl font-black", qty: "text-xl font-black", qtyW: "w-10" },
  gross:  { name: "text-2xl font-bold", price: "text-2xl font-black", qty: "text-2xl font-black", qtyW: "w-11" },
  xl:     { name: "text-2xl font-black", price: "text-2xl font-black", qty: "text-2xl font-black", qtyW: "w-12" },
};

function CartColumn({
  cart,
  cartTotal,
  paymentMethod,
  cashInput,
  cashCents,
  change,
  canBook,
  onPaymentChange,
  onCashInput,
  onChangeQty,
  onRemove,
  onClear,
  onBook,
  widthPx,
  qtyBtnSize,
  cartFontSize,
  showPayment = true,
}: {
  cart: ReturnType<typeof usePosStore>["cart"];
  cartTotal: number;
  paymentMethod: PaymentMethod;
  cashInput: string;
  cashCents: number;
  change: number;
  canBook: boolean;
  onPaymentChange: (m: PaymentMethod) => void;
  onCashInput: (v: string) => void;
  onChangeQty: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onBook: () => void;
  widthPx: number;
  qtyBtnSize: number;
  cartFontSize: CartFontSize;
  showPayment?: boolean;
}) {
  const allFlavors = useFlavorList();
  const getLocalFlavorName = (id: string) => allFlavors.find((f) => f.id === id)?.name ?? id;
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
    <div className="flex shrink-0 flex-col gap-2 min-h-0" style={{ width: widthPx }}>
      {/* Cart */}
      <div className="flex flex-1 flex-col rounded-2xl bg-white shadow min-h-0">
        <div className="flex shrink-0 items-center gap-2 border-b border-black/5 px-4 py-2.5">
          <span className="text-[11px] font-bold uppercase tracking-widest text-black/40 mr-auto">
            Warenkorb
          </span>
          <button
            onClick={() => toggleAusgabeModus(!ausgabeModus)}
            title="Ausgabe-Modus: größere Schrift für Zweipersonen-Betrieb"
            className={cn(
              "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors select-none",
              ausgabeModus
                ? "bg-primaq-100 text-primaq-700"
                : "text-black/30 hover:bg-black/5 hover:text-black/50"
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
                  : "text-black/35 hover:bg-red-50 hover:text-red-600"
              )}
            >
              <Trash2 className="h-3 w-3" />
              {clearing ? "Erneut tippen" : "Leeren"}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-black/20 py-6">
              <ShoppingCart className="h-8 w-8" />
              <span className="text-xs">Noch leer</span>
            </div>
          ) : (
            <ul className="divide-y divide-black/5">
              {cart.map((item) => (
                <li key={item.id} className={cn("px-4", ausgabeModus ? "py-5" : "py-4")}>
                  {/* Row 1: badge + name + total */}
                  <div className={cn("flex items-start", ausgabeModus ? "gap-3" : "gap-2.5")}>
                    <CartItemBadge item={item} large={ausgabeModus} />
                    <p className={cn(
                      "flex-1 uppercase leading-tight line-clamp-2 text-ink",
                      ausgabeModus ? "text-2xl font-black" : fontCfg.name
                    )}>
                      {getSizeName(item.size)} {getLocalFlavorName(item.flavor)}
                    </p>
                    <p className={cn(
                      "shrink-0 font-black text-ink tabular-nums pt-0.5",
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
                      <span className="text-xs text-black/40 tabular-nums mr-auto">
                        {fmt(item.unitPriceCents)} je
                      </span>
                    )}
                    <div className={cn("flex items-center gap-1.5", ausgabeModus && "ml-auto")}>
                      <button
                        onClick={() => onChangeQty(item.id, -1)}
                        style={{ height: qtyBtnSize, width: qtyBtnSize }}
                        className="grid place-items-center rounded-full bg-black/5 hover:bg-red-100 hover:text-red-600 active:scale-90 transition-all"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className={cn(
                        "text-center font-black text-ink tabular-nums",
                        ausgabeModus ? `w-12 text-2xl` : `${fontCfg.qtyW} ${fontCfg.qty}`
                      )}>
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => onChangeQty(item.id, 1)}
                        style={{ height: qtyBtnSize, width: qtyBtnSize }}
                        className="grid place-items-center rounded-full bg-black/5 hover:bg-primaq-100 hover:text-primaq-700 active:scale-90 transition-all"
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

        <div className="shrink-0 border-t border-black/10 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-black/50">Gesamt</span>
            <span className="text-2xl font-black text-ink tabular-nums">{fmt(cartTotal)}</span>
          </div>
        </div>
      </div>

      {/* Payment */}
      <div className="shrink-0 rounded-2xl bg-white p-3 shadow">
        {showPayment && (
          <>
            {/* Payment tabs */}
            <div className="mb-3 flex gap-1.5">
              {(["bar", "karte", "qr"] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => onPaymentChange(m)}
                  className={cn(
                    "flex-1 rounded-xl py-2.5 text-sm font-bold transition-all",
                    paymentMethod === m
                      ? "bg-primaq-500 text-white shadow"
                      : "bg-black/5 text-black/50 hover:bg-black/10"
                  )}
                >
                  {PAYMENT_LABELS[m]}
                </button>
              ))}
            </div>

            {/* Karte indicator */}
            {paymentMethod === "karte" && (
              <div className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-blue-50 px-4 py-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600" aria-hidden><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                <span className="text-sm font-semibold text-blue-700">Kartenzahlung gewählt</span>
              </div>
            )}

            {/* Cash input */}
            {paymentMethod === "bar" && (
              <div className="mb-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-sm font-semibold text-black/50">Gegeben</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.50"
                    min="0"
                    value={cashInput}
                    onChange={(e) => onCashInput(e.target.value)}
                    placeholder="0,00"
                    className="flex-1 rounded-xl border border-black/15 bg-black/[0.03] px-2.5 py-1.5 text-right text-lg font-bold outline-none focus:border-primaq-500 focus:ring-2 focus:ring-primaq-500/20"
                  />
                  <span className="shrink-0 text-sm font-semibold text-black/50">€</span>
                </div>
                <div className="flex gap-1">
                  {QUICK_AMOUNTS.map((a) => (
                    <button
                      key={a}
                      onClick={() => onCashInput(String(a))}
                      className="flex-1 rounded-lg bg-black/5 py-1.5 text-xs font-bold text-black/65 hover:bg-primaq-100 hover:text-primaq-700 active:scale-95 transition-all"
                    >
                      {a}€
                    </button>
                  ))}
                </div>
                {cashCents >= cartTotal && cartTotal > 0 && (
                  <div className="flex items-center justify-between rounded-xl bg-green-50 px-3 py-2">
                    <span className="text-sm font-semibold text-green-700">Rückgeld</span>
                    <span className="text-xl font-black text-green-700 tabular-nums">
                      {fmt(change)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Book button – always visible */}
        <button
          data-testid="book-button"
          onClick={onBook}
          disabled={!canBook}
          className={cn(
            "w-full rounded-xl py-4 text-base font-black transition-all select-none",
            canBook
              ? "bg-primaq-500 text-white shadow-md hover:bg-primaq-700 active:scale-[0.98]"
              : "cursor-not-allowed bg-black/8 text-black/20"
          )}
        >
          {showPayment && paymentMethod === "qr" ? "QR anzeigen" : "Bestellung buchen"}
        </button>
      </div>
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
  const [confirming, setConfirming] = useState(false);

  const handleVoidClick = useCallback(() => {
    if (!confirming) { setConfirming(true); return; }
    onVoid();
    setConfirming(false);
  }, [confirming, onVoid]);

  const portionen = daily.orders.reduce(
    (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0),
    0
  );

  // Fallback for orders saved before dailyNumber was introduced
  const orderNum = last
    ? (last.dailyNumber ?? daily.orders.length)
    : null;

  return (
    <div
      data-testid="last-booking-bar"
      className="shrink-0 flex items-center gap-3 rounded-2xl bg-white/90 px-5 py-2.5 shadow backdrop-blur-sm"
    >
      {/* Left: last booking */}
      {showLastBooking && (
        <>
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-black/40">
            Letzte Buchung
          </span>
          <div className="h-4 w-px shrink-0 bg-black/15" />
          {last && orderNum !== null ? (
            <>
              {/* Order number – always visible */}
              <span className="text-sm font-bold text-black/70 tabular-nums">
                #{String(orderNum).padStart(4, "0")}
              </span>
              <div className="h-4 w-px shrink-0 bg-black/15" />

              {/* Betrag – admin only */}
              {isAdmin && (
                <>
                  <span className="text-base font-black text-ink tabular-nums">
                    {fmt(last.totalCents)}
                  </span>
                  <div className="h-4 w-px shrink-0 bg-black/15" />
                </>
              )}

              {/* Zahlungsart – always visible */}
              <span className="text-sm font-semibold text-black/55">
                {BOOKING_PAYMENT_LABEL[last.paymentMethod] ?? last.paymentMethod}
              </span>
              <div className="h-4 w-px shrink-0 bg-black/15" />

              {/* Uhrzeit – always visible */}
              <span className="text-sm font-semibold text-black/55 tabular-nums">
                {new Date(last.createdAt).toLocaleTimeString("de-DE", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <div className="h-4 w-px shrink-0 bg-black/15" />

              {/* Artikel – always visible */}
              <span className="text-xs text-black/35">
                {last.items.reduce((s, i) => s + i.quantity, 0)} Artikel
              </span>

              {/* Stornieren – admin only, 2-tap confirm */}
              {isAdmin && (
                <div className="flex items-center gap-2 shrink-0">
                  {confirming ? (
                    <>
                      <button
                        data-testid="void-confirm"
                        onClick={handleVoidClick}
                        className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-700 transition-colors"
                      >
                        Wirklich stornieren?
                      </button>
                      <button
                        onClick={() => setConfirming(false)}
                        className="rounded-lg bg-black/5 px-2 py-1 text-xs font-semibold text-black/50 hover:bg-black/10 transition-colors"
                      >
                        Abbrechen
                      </button>
                    </>
                  ) : (
                    <button
                      data-testid="void-last-order"
                      onClick={handleVoidClick}
                      className="rounded-lg border border-black/15 bg-white px-3 py-1 text-xs font-semibold text-black/50 hover:bg-red-50 hover:text-red-700 hover:border-red-300 transition-colors"
                    >
                      Stornieren
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <span className="text-sm text-black/35">noch keine</span>
          )}
        </>
      )}

      {/* Right: daily totals – admin only, respects verkaufszaehler toggle */}
      {isAdmin && showStats && (
        <div className={cn(
          "flex items-center gap-4 shrink-0 pl-3 border-l border-black/10",
          showLastBooking ? "ml-auto" : "ml-0"
        )}>
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-black/35">Portionen</p>
            <p className="text-base font-black text-ink tabular-nums">{portionen}</p>
          </div>
          <div className="h-6 w-px bg-black/10" />
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-black/35">Verkäufe</p>
            <p className="text-base font-black text-ink tabular-nums">{daily.orderCount}</p>
          </div>
          <div className="h-6 w-px bg-black/10" />
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-black/35">Umsatz</p>
            <p className="text-base font-black text-primaq-600 tabular-nums">{fmt(daily.totalCents)}</p>
          </div>
        </div>
      )}
    </div>
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

  const [selectedSizeId, setSelectedSizeId] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>("bar");
  const [cashInput, setCashInput] = useState("");
  const [showQr, setShowQr] = useState(false);

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
          name:            ov?.label           ?? s.name,
          priceCents:      ov?.priceCents       ?? s.priceCents,
          backgroundColor: ov?.backgroundColor  ?? "#ffffff",
          textColorMode:   ov?.textColorMode    ?? "auto",
          imageDataUrl:    ov?.imageDataUrl     ?? null,
          imageScale:      ov?.imageScale       ?? 100,
        };
      })
      .filter((s) => layout.sizeVisibility[s.id] !== false);
  }, [layout]);

  // Auto-select first active size when selected size becomes inactive
  useEffect(() => {
    if (!selectedSizeId) return;
    if (!effectiveSizes.find((s) => s.id === selectedSizeId)) {
      setSelectedSizeId(effectiveSizes[0]?.id ?? null);
    }
  }, [effectiveSizes, selectedSizeId]);

  const canBook = cart.length > 0 && (showPayment ? (payment !== "bar" || cashCents >= cartTotal) : true);
  const selectedSize = effectiveSizes.find((s) => s.id === selectedSizeId) ?? null;

  const handleFlavorClick = useCallback(
    (flavor: FlavorConfig) => {
      if (!selectedSizeId || !selectedSize) return;
      addToCart(selectedSizeId, flavor.id, selectedSize.priceCents);
    },
    [selectedSizeId, selectedSize, addToCart]
  );

  const handlePaymentChange = useCallback((method: PaymentMethod) => {
    setPayment(method);
    setCashInput("");
  }, []);

  const handleBook = useCallback(() => {
    if (!canBook) return;
    if (showPayment && payment === "qr") {
      setShowQr(true);
      return;
    }
    bookOrder(showPayment ? payment : "karte");
    setCashInput("");
  }, [canBook, showPayment, payment, bookOrder]);

  const handleQrConfirm = useCallback(() => {
    bookOrder("qr");
    setShowQr(false);
    setCashInput("");
  }, [bookOrder]);

  if (!hydrated || !flavorsHydrated || !layoutHydrated) {
    return (
      <div className="flex h-full items-center justify-center text-black/40">Laden…</div>
    );
  }

  return (
    <FlavorsCtx.Provider value={allFlavors}>
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* Main area: [SizeRow + FlavorColumn] | [CartColumn] */}
      <div className="flex flex-1 min-h-0 gap-3 overflow-hidden">
        {/* Left: stacked selection area */}
        <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-hidden">
          <SizeRow
            selectedId={selectedSizeId}
            onSelect={setSelectedSizeId}
            effectiveSizes={effectiveSizes}
          />
          <FlavorColumn
            selectedSize={selectedSize}
            onFlavorClick={handleFlavorClick}
            cardSize={layout.flavorCardSize}
          />
        </div>
        {/* Right: cart */}
        <CartColumn
          widthPx={layout.cartWidth}
          qtyBtnSize={layout.qtyButtonSize}
          cartFontSize={layout.cartFontSize}
          showPayment={showPayment}
          cart={cart}
          cartTotal={cartTotal}
          paymentMethod={payment}
          cashInput={cashInput}
          cashCents={cashCents}
          change={change}
          canBook={canBook}
          onPaymentChange={handlePaymentChange}
          onCashInput={setCashInput}
          onChangeQty={changeQty}
          onRemove={removeFromCart}
          onClear={clearCart}
          onBook={handleBook}
        />
      </div>

      {/* Bottom status bar – visibility controlled by letzte-bestellung toggle */}
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
            className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-2xl text-center mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-black/40">
              QR-Zahlung
            </p>
            <p className="mb-6 text-5xl font-black text-ink tabular-nums">{fmt(cartTotal)}</p>
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
              className="w-full rounded-2xl bg-black/5 py-3 text-base font-semibold text-black/50 hover:bg-black/10 transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
    </FlavorsCtx.Provider>
  );
}
