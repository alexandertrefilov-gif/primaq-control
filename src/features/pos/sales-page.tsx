"use client";

import { useState, useCallback } from "react";
import { Check, Minus, Plus, Settings, ShoppingCart, Trash2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { usePosStore } from "./use-pos-store";
import {
  FLAVORS,
  MACHINE_GROUP_LABELS,
  SIZES,
  getFlavorName,
  getSizeConfig,
  getSizeName,
} from "./pos-config";
import type { FlavorConfig, SizeConfig } from "./pos-config";
import type { PaymentMethod } from "./pos-types";

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
}: {
  src?: string;
  fallbackSrc?: string;
  alt: string;
  className?: string;
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
  const isMix = !!flavor.isMix && !!flavor.mixColors;
  const part1 = isMix && flavor.mixParts ? FLAVORS.find((f) => f.id === flavor.mixParts![0]) : null;
  const part2 = isMix && flavor.mixParts ? FLAVORS.find((f) => f.id === flavor.mixParts![1]) : null;

  return (
    <button
      aria-label={flavor.name}
      onClick={onClick}
      className="relative flex flex-1 flex-col items-center justify-end overflow-hidden rounded-2xl shadow-md transition-all active:scale-[0.97] hover:shadow-xl hover:ring-2 hover:ring-primaq-500/40 select-none"
      style={{ color: flavor.textColor }}
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

      {/* Image area (flex-1 so it fills all space above the label) */}
      <div className="relative z-10 flex min-h-0 flex-1 w-full items-center justify-center">
        {isMix ? (
          /* Mix: show both component images side by side */
          <div className="flex w-full items-center justify-around px-3 py-2">
            {part1?.imageSrc && (
              <ProductImage
                src={part1.imageSrc}
                fallbackSrc={part1.fallbackImageSrc}
                alt=""
                className="h-14 w-14 object-contain drop-shadow-md opacity-90"
              />
            )}
            {part2?.imageSrc && (
              <ProductImage
                src={part2.imageSrc}
                fallbackSrc={part2.fallbackImageSrc}
                alt=""
                className="h-14 w-14 object-contain drop-shadow-md opacity-90"
              />
            )}
          </div>
        ) : (
          flavor.imageSrc && (
            <ProductImage
              src={flavor.imageSrc}
              fallbackSrc={flavor.fallbackImageSrc}
              alt=""
              className="max-h-24 max-w-full object-contain drop-shadow-lg p-2"
            />
          )
        )}
      </div>

      {/* Name label at bottom */}
      <div className="relative z-10 w-full shrink-0 bg-black/25 px-2 py-2 text-center backdrop-blur-[2px]">
        <span
          className="block text-sm font-black leading-tight"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}
        >
          {flavor.name}
        </span>
      </div>
    </button>
  );
}

// ── Machine flavor group ──────────────────────────────────────────────────────

function FlavorGroup({
  label,
  flavors,
  onFlavorClick,
}: {
  label: string;
  flavors: FlavorConfig[];
  onFlavorClick: (flavor: FlavorConfig) => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-2 min-h-0">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-primaq-700">
          {label}
        </span>
        <div className="flex-1 h-px bg-primaq-100" />
      </div>
      <div className="flex flex-1 gap-2 min-h-0">
        {flavors.map((f) => (
          <FlavorCard key={f.id} flavor={f} onClick={() => onFlavorClick(f)} />
        ))}
      </div>
    </div>
  );
}

// ── Left column – sizes ───────────────────────────────────────────────────────

function SizeColumn({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex w-44 shrink-0 flex-col gap-2 min-h-0">
      <p className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-black/40">
        Größe wählen
      </p>
      {SIZES.map((size: SizeConfig) => {
        const active = selectedId === size.id;
        return (
          <button
            key={size.id}
            onClick={() => onSelect(size.id)}
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl border-2 bg-white shadow transition-all select-none",
              active
                ? "border-primaq-500 bg-primaq-50 shadow-lg shadow-primaq-500/20 ring-2 ring-primaq-500/30"
                : "border-transparent hover:border-primaq-300 hover:bg-primaq-50/60 active:scale-[0.97]"
            )}
          >
            {active && (
              <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-primaq-500 text-white">
                <Check className="h-3 w-3" />
              </span>
            )}
            <ProductImage
              src={size.imageSrc}
              fallbackSrc={size.fallbackImageSrc}
              alt=""
              className="max-h-28 w-auto object-contain drop-shadow"
            />
            <span className={cn("text-xl font-black", active ? "text-primaq-700" : "text-ink")}>
              {size.name}
            </span>
            <span className={cn("text-base font-bold", active ? "text-primaq-500" : "text-black/50")}>
              {fmt(size.priceCents)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Middle column – flavors ───────────────────────────────────────────────────

function FlavorColumn({
  selectedSize,
  onFlavorClick,
}: {
  selectedSize: SizeConfig | null;
  onFlavorClick: (flavor: FlavorConfig) => void;
}) {
  const groups = Object.entries(MACHINE_GROUP_LABELS);

  if (!selectedSize) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-primaq-200 bg-primaq-50/40 text-center min-h-0">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-primaq-100">
          <ShoppingCart className="h-8 w-8 text-primaq-500" />
        </div>
        <p className="text-base font-bold text-black/50">Bitte zuerst</p>
        <p className="text-base font-bold text-black/50">Größe wählen</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 rounded-2xl bg-white p-4 shadow min-h-0">
      <div className="shrink-0">
        <p className="text-[11px] font-bold uppercase tracking-widest text-black/40">
          Sorte wählen
        </p>
        <p className="text-lg font-black text-ink">
          {selectedSize.name}{" "}
          <span className="text-primaq-500">{fmt(selectedSize.priceCents)}</span>
        </p>
      </div>
      {groups.map(([groupId, groupLabel]) => {
        const flavors = FLAVORS.filter((f) => f.group === groupId);
        return (
          <FlavorGroup
            key={groupId}
            label={groupLabel}
            flavors={flavors}
            onFlavorClick={onFlavorClick}
          />
        );
      })}
    </div>
  );
}

// ── Right column – cart + payment ─────────────────────────────────────────────

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
}) {
  return (
    <div className="flex w-80 shrink-0 flex-col gap-2 min-h-0">
      {/* Cart */}
      <div className="flex flex-1 flex-col rounded-2xl bg-white shadow min-h-0">
        <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-3 py-2.5">
          <span className="text-[11px] font-bold uppercase tracking-widest text-black/40">
            Warenkorb
          </span>
          <div className="flex items-center gap-1">
            {cart.length > 0 && (
              <button
                onClick={onClear}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-black/35 hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                Leeren
              </button>
            )}
            <Link
              href="/einstellungen"
              className="grid h-7 w-7 place-items-center rounded-lg text-black/30 hover:bg-black/5 hover:text-black/60 transition-colors"
              title="Einstellungen"
            >
              <Settings className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-black/20 py-6">
              <ShoppingCart className="h-8 w-8" />
              <span className="text-xs">Noch leer</span>
            </div>
          ) : (
            <ul className="divide-y divide-black/5">
              {cart.map((item) => {
                const sizeConf = getSizeConfig(item.size);
                return (
                  <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                    {/* Size thumbnail */}
                    <div className="shrink-0 h-9 w-9 flex items-center justify-center">
                      <ProductImage
                        src={sizeConf?.imageSrc}
                        fallbackSrc={sizeConf?.fallbackImageSrc}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                    {/* Item label */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate leading-tight">
                        {getSizeName(item.size)} {getFlavorName(item.flavor)}
                      </p>
                      <p className="text-xs text-black/40">{fmt(item.unitPriceCents)} je</p>
                    </div>
                    {/* Qty controls */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => onChangeQty(item.id, -1)}
                        className="grid h-7 w-7 place-items-center rounded-full bg-black/5 hover:bg-red-100 hover:text-red-600 active:scale-90 transition-all"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-5 text-center text-sm font-bold text-ink">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => onChangeQty(item.id, 1)}
                        className="grid h-7 w-7 place-items-center rounded-full bg-black/5 hover:bg-primaq-100 hover:text-primaq-700 active:scale-90 transition-all"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => onRemove(item.id)}
                        className="grid h-7 w-7 place-items-center rounded-full text-black/25 hover:bg-red-50 hover:text-red-500 active:scale-90 transition-all"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="w-14 shrink-0 text-right text-sm font-bold text-ink tabular-nums">
                      {fmt(item.quantity * item.unitPriceCents)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-black/10 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-black/50">Gesamt</span>
            <span className="text-2xl font-black text-ink tabular-nums">{fmt(cartTotal)}</span>
          </div>
        </div>
      </div>

      {/* Payment */}
      <div className="shrink-0 rounded-2xl bg-white p-3 shadow">
        {/* Payment tabs */}
        <div className="mb-3 flex gap-1.5">
          {(["bar", "karte", "qr"] as PaymentMethod[]).map((m) => (
            <button
              key={m}
              onClick={() => onPaymentChange(m)}
              className={cn(
                "flex-1 rounded-xl py-2 text-sm font-bold transition-all",
                paymentMethod === m
                  ? "bg-primaq-500 text-white shadow"
                  : "bg-black/5 text-black/50 hover:bg-black/10"
              )}
            >
              {PAYMENT_LABELS[m]}
            </button>
          ))}
        </div>

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
                  className="flex-1 rounded-lg bg-black/5 py-1 text-xs font-bold text-black/65 hover:bg-primaq-100 hover:text-primaq-700 active:scale-95 transition-all"
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

        {/* Book button */}
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
          {paymentMethod === "qr" ? "QR anzeigen" : "Bestellung buchen"}
        </button>
      </div>
    </div>
  );
}

// ── Bottom bar – last booking only (no aggregate totals for operator) ─────────

const BOOKING_PAYMENT_LABEL: Record<string, string> = {
  bar: "Bar",
  karte: "Karte",
  qr: "QR",
};

function LastBookingBar({ daily }: { daily: ReturnType<typeof usePosStore>["daily"] }) {
  const last = daily.orders.length > 0 ? daily.orders[daily.orders.length - 1] : null;

  return (
    <div
      data-testid="last-booking-bar"
      className="shrink-0 flex items-center gap-3 rounded-2xl bg-white/90 px-5 py-2.5 shadow backdrop-blur-sm"
    >
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-black/40">
        Letzte Buchung
      </span>
      <div className="h-4 w-px shrink-0 bg-black/15" />
      {last ? (
        <>
          <span className="text-base font-black text-ink tabular-nums">
            {fmt(last.totalCents)}
          </span>
          <div className="h-4 w-px shrink-0 bg-black/15" />
          <span className="text-sm font-semibold text-black/55">
            {BOOKING_PAYMENT_LABEL[last.paymentMethod] ?? last.paymentMethod}
          </span>
          <div className="h-4 w-px shrink-0 bg-black/15" />
          <span className="text-sm font-semibold text-black/55">
            {new Date(last.createdAt).toLocaleTimeString("de-DE", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <div className="h-4 w-px shrink-0 bg-black/15" />
          <span className="text-xs text-black/35">
            {last.items.reduce((s, i) => s + i.quantity, 0)} Artikel
          </span>
        </>
      ) : (
        <span className="text-sm text-black/35">noch keine</span>
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
    hydrated,
  } = usePosStore();

  const [selectedSizeId, setSelectedSizeId] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>("bar");
  const [cashInput, setCashInput] = useState("");
  const [showQr, setShowQr] = useState(false);

  const cashCents = Math.round(parseFloat(cashInput.replace(",", ".")) * 100) || 0;
  const change = cashCents - cartTotal;
  const canBook = cart.length > 0 && (payment !== "bar" || cashCents >= cartTotal);
  const selectedSize = SIZES.find((s) => s.id === selectedSizeId) ?? null;

  const handleFlavorClick = useCallback(
    (flavor: FlavorConfig) => {
      if (!selectedSizeId) return;
      addToCart(selectedSizeId, flavor.id);
    },
    [selectedSizeId, addToCart]
  );

  const handlePaymentChange = useCallback((method: PaymentMethod) => {
    setPayment(method);
    setCashInput("");
  }, []);

  const handleBook = useCallback(() => {
    if (!canBook) return;
    if (payment === "qr") {
      setShowQr(true);
      return;
    }
    bookOrder(payment);
    setCashInput("");
  }, [canBook, payment, bookOrder]);

  const handleQrConfirm = useCallback(() => {
    bookOrder("qr");
    setShowQr(false);
    setCashInput("");
  }, [bookOrder]);

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center text-black/40">Laden…</div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2">
      {/* 3 main columns */}
      <div className="flex flex-1 min-h-0 gap-3">
        <SizeColumn selectedId={selectedSizeId} onSelect={setSelectedSizeId} />
        <FlavorColumn selectedSize={selectedSize} onFlavorClick={handleFlavorClick} />
        <CartColumn
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

      {/* Bottom bar – last booking only */}
      <LastBookingBar daily={daily} />

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
  );
}
