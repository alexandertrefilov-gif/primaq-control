"use client";

import { useState, useCallback } from "react";
import { Minus, Plus, Trash2, X, ShoppingCart } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/utils";
import { usePosStore } from "./use-pos-store";
import type { Flavor, PaymentMethod, Size } from "./pos-types";
import { FLAVORS, FLAVOR_ORDER, SIZES, SIZE_ORDER } from "./pos-types";

function fmt(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  bar: "Bar",
  karte: "Karte",
  qr: "QR",
};

const QUICK_AMOUNTS = [5, 10, 20, 50, 100];

export function SalesPage() {
  const { cart, cartTotal, addToCart, removeFromCart, changeQty, clearCart, bookOrder, hydrated } =
    usePosStore();

  const [selectedSize, setSelectedSize] = useState<Size | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>("bar");
  const [cashInput, setCashInput] = useState("");
  const [showQr, setShowQr] = useState(false);

  const cashCents = Math.round(parseFloat(cashInput.replace(",", ".")) * 100) || 0;
  const change = cashCents - cartTotal;
  const canBook =
    cart.length > 0 && (payment !== "bar" || cashCents >= cartTotal);

  const handleSize = useCallback((size: Size) => setSelectedSize(size), []);

  const handleFlavor = useCallback(
    (flavor: Flavor) => {
      if (!selectedSize) return;
      addToCart(selectedSize, flavor);
      setSelectedSize(null);
    },
    [selectedSize, addToCart]
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
    <div className="flex flex-1 min-h-0 gap-4">
      {/* ── Left: size selection ────────────────────────────────────── */}
      <div className="flex w-56 shrink-0 flex-col gap-3 min-h-0">
        <p className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-black/40">
          Größe wählen
        </p>
        {SIZE_ORDER.map((size) => {
          const s = SIZES[size];
          const active = selectedSize === size;
          return (
            <button
              key={size}
              onClick={() => handleSize(size)}
              className={cn(
                "flex flex-1 flex-col items-center justify-center rounded-2xl border-2 transition-all select-none",
                active
                  ? "border-primaq-500 bg-primaq-500 text-white shadow-lg scale-[1.02]"
                  : "border-transparent bg-white text-ink shadow hover:border-primaq-500/40 hover:bg-primaq-50 active:scale-95"
              )}
            >
              <span className="text-3xl font-black leading-tight">{s.label}</span>
              <span
                className={cn(
                  "text-xl font-bold leading-tight",
                  active ? "text-white/85" : "text-primaq-700"
                )}
              >
                {fmt(s.priceCents)}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Right: cart + payment ───────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-3 min-h-0">
        {/* Cart */}
        <div className="flex flex-1 flex-col rounded-2xl bg-white shadow min-h-0">
          <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-widest text-black/40">
              Warenkorb
            </span>
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-black/35 hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                Leeren
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-2 min-h-0">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-black/20">
                <ShoppingCart className="h-10 w-10" />
                <span className="text-sm">Größe antippen um zu starten</span>
              </div>
            ) : (
              <ul className="divide-y divide-black/5">
                {cart.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ink truncate">
                        {SIZES[item.size].label} {FLAVORS[item.flavor].label}
                      </p>
                      <p className="text-xs text-black/45">{fmt(item.unitPriceCents)} je</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => changeQty(item.id, -1)}
                        className="grid h-8 w-8 place-items-center rounded-full bg-black/5 hover:bg-red-100 hover:text-red-600 active:scale-90 transition-all"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center font-bold text-ink">{item.quantity}</span>
                      <button
                        onClick={() => changeQty(item.id, 1)}
                        className="grid h-8 w-8 place-items-center rounded-full bg-black/5 hover:bg-primaq-100 hover:text-primaq-700 active:scale-90 transition-all"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="grid h-8 w-8 place-items-center rounded-full text-black/25 hover:bg-red-50 hover:text-red-500 active:scale-90 transition-all"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="w-16 text-right font-bold text-ink">
                      {fmt(item.quantity * item.unitPriceCents)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="shrink-0 border-t border-black/10 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-black/55">Gesamt</span>
              <span className="text-3xl font-black text-ink">{fmt(cartTotal)}</span>
            </div>
          </div>
        </div>

        {/* Payment */}
        <div className="shrink-0 rounded-2xl bg-white p-4 shadow">
          <div className="mb-3 flex gap-2">
            {(["bar", "karte", "qr"] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                onClick={() => handlePaymentChange(m)}
                className={cn(
                  "flex-1 rounded-xl py-2.5 text-sm font-bold transition-all",
                  payment === m
                    ? "bg-primaq-500 text-white shadow"
                    : "bg-black/5 text-black/50 hover:bg-black/10"
                )}
              >
                {PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>

          {payment === "bar" && (
            <div className="mb-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-sm font-semibold text-black/55">Gegeben</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.50"
                  min="0"
                  value={cashInput}
                  onChange={(e) => setCashInput(e.target.value)}
                  placeholder="0,00"
                  className="flex-1 rounded-xl border border-black/15 bg-black/[0.03] px-3 py-2 text-right text-xl font-bold outline-none focus:border-primaq-500 focus:ring-2 focus:ring-primaq-500/20"
                />
                <span className="shrink-0 text-sm font-semibold text-black/55">€</span>
              </div>
              <div className="flex gap-1.5">
                {QUICK_AMOUNTS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setCashInput(String(a))}
                    className="flex-1 rounded-lg bg-black/5 py-1.5 text-sm font-bold text-black/65 hover:bg-primaq-100 hover:text-primaq-700 active:scale-95 transition-all"
                  >
                    {a}€
                  </button>
                ))}
              </div>
              {cashCents >= cartTotal && cartTotal > 0 && (
                <div className="flex items-center justify-between rounded-xl bg-green-50 px-4 py-2.5">
                  <span className="text-sm font-semibold text-green-700">Rückgeld</span>
                  <span className="text-2xl font-black text-green-700">{fmt(change)}</span>
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleBook}
            disabled={!canBook}
            className={cn(
              "w-full rounded-xl py-4 text-lg font-black transition-all select-none",
              canBook
                ? "bg-primaq-500 text-white shadow-md hover:bg-primaq-700 active:scale-[0.98]"
                : "cursor-not-allowed bg-black/8 text-black/20"
            )}
          >
            {payment === "qr" ? "QR anzeigen" : "Bestellung buchen"}
          </button>
        </div>
      </div>

      {/* ── Flavor picker overlay ────────────────────────────────────── */}
      {selectedSize && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setSelectedSize(null)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-black/40">
                  Sorte wählen
                </p>
                <p className="text-2xl font-black text-ink">
                  {SIZES[selectedSize].label}{" "}
                  <span className="text-primaq-700">{fmt(SIZES[selectedSize].priceCents)}</span>
                </p>
              </div>
              <button
                onClick={() => setSelectedSize(null)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/5 hover:bg-black/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {FLAVOR_ORDER.map((flavor) => (
                <button
                  key={flavor}
                  onClick={() => handleFlavor(flavor)}
                  className="rounded-2xl bg-primaq-100 px-4 py-5 text-center text-base font-bold text-primaq-900 hover:bg-primaq-500 hover:text-white active:scale-95 transition-all select-none"
                >
                  {FLAVORS[flavor].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── QR payment overlay ───────────────────────────────────────── */}
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
            <p className="mb-6 text-5xl font-black text-ink">{fmt(cartTotal)}</p>
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
