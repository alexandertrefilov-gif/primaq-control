"use client";

import { useCallback, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import { usePosStore } from "./use-pos-store";
import { FLAVORS, SIZES } from "./pos-types";
import type { DailySummary } from "./pos-types";

function fmt(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

function buildCsv(daily: DailySummary): string {
  const rows: string[] = ["Uhrzeit;Artikel;Menge;Zahlungsart;Preis je (EUR);Summe (EUR)"];
  for (const order of daily.orders) {
    const time = new Date(order.createdAt).toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const method =
      order.paymentMethod === "bar" ? "Bar" : order.paymentMethod === "karte" ? "Karte" : "QR";
    for (const item of order.items) {
      rows.push(
        [
          time,
          `${SIZES[item.size].label} ${FLAVORS[item.flavor].label}`,
          item.quantity,
          method,
          (item.unitPriceCents / 100).toFixed(2),
          ((item.quantity * item.unitPriceCents) / 100).toFixed(2),
        ].join(";")
      );
    }
  }
  return "﻿" + rows.join("\n");
}

function downloadCsv(daily: DailySummary) {
  const csv = buildCsv(daily);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `primaq-${daily.date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DailyClosePage() {
  const { daily, resetDaily, hydrated } = usePosStore();
  const [confirming, setConfirming] = useState(false);

  const handleReset = useCallback(() => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    resetDaily();
    setConfirming(false);
  }, [confirming, resetDaily]);

  if (!hydrated) {
    return <div className="flex h-40 items-center justify-center text-black/40">Laden…</div>;
  }

  const hasData = daily.orderCount > 0;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="Gesamtumsatz" value={fmt(daily.totalCents)} accent />
        <SummaryCard label="Bar" value={fmt(daily.cashCents)} />
        <SummaryCard label="Karte" value={fmt(daily.cardCents)} />
        <SummaryCard label="QR" value={fmt(daily.qrCents)} />
      </div>

      <div className="flex items-center gap-4 rounded-2xl bg-white px-5 py-4 shadow">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">Bestellungen</p>
          <p className="text-4xl font-black text-ink">{daily.orderCount}</p>
        </div>
        <div className="mx-4 h-12 w-px bg-black/10" />
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">Datum</p>
          <p className="text-xl font-bold text-ink">
            {new Date(daily.date).toLocaleDateString("de-DE", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
        </div>
      </div>

      {/* Order list */}
      {hasData && (
        <div className="rounded-2xl bg-white shadow">
          <div className="border-b border-black/5 px-5 py-3">
            <p className="text-xs font-bold uppercase tracking-widest text-black/40">
              Bestellungen heute
            </p>
          </div>
          <div className="divide-y divide-black/5">
            {daily.orders.map((order) => {
              const time = new Date(order.createdAt).toLocaleTimeString("de-DE", {
                hour: "2-digit",
                minute: "2-digit",
              });
              const method =
                order.paymentMethod === "bar"
                  ? "Bar"
                  : order.paymentMethod === "karte"
                    ? "Karte"
                    : "QR";
              return (
                <div key={order.id} className="flex items-start gap-4 px-5 py-3">
                  <span className="shrink-0 text-sm font-semibold text-black/40 tabular-nums">
                    {time}
                  </span>
                  <div className="flex-1 min-w-0">
                    {order.items.map((item) => (
                      <p key={item.id} className="text-sm text-ink">
                        {item.quantity}× {SIZES[item.size].label} {FLAVORS[item.flavor].label}
                      </p>
                    ))}
                  </div>
                  <span className="shrink-0 rounded-lg bg-black/5 px-2 py-0.5 text-xs font-semibold text-black/50">
                    {method}
                  </span>
                  <span className="shrink-0 font-bold text-ink tabular-nums">
                    {fmt(order.totalCents)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!hasData && (
        <div className="rounded-2xl border-2 border-dashed border-black/10 py-12 text-center text-black/30">
          Noch keine Bestellungen heute
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => downloadCsv(daily)}
          disabled={!hasData}
          className="flex items-center gap-2 rounded-xl bg-primaq-500 px-5 py-3 font-bold text-white shadow hover:bg-primaq-700 disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30 transition-colors"
        >
          <Download className="h-4 w-4" />
          CSV exportieren
        </button>

        <button
          onClick={handleReset}
          className={
            confirming
              ? "flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 font-bold text-white shadow transition-colors"
              : "flex items-center gap-2 rounded-xl border border-black/15 bg-white px-5 py-3 font-bold text-black/60 shadow hover:bg-red-50 hover:text-red-700 transition-colors"
          }
          onBlur={() => setConfirming(false)}
        >
          <RotateCcw className="h-4 w-4" />
          {confirming ? "Wirklich zurücksetzen?" : "Tagesdaten zurücksetzen"}
        </button>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "rounded-2xl bg-primaq-500 p-5 text-white shadow"
          : "rounded-2xl bg-white p-5 shadow"
      }
    >
      <p className={`text-xs font-bold uppercase tracking-widest ${accent ? "text-white/70" : "text-black/40"}`}>
        {label}
      </p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}
