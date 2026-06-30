"use client";

import { useCallback, useState } from "react";
import { Download, Lock, RotateCcw } from "lucide-react";
import Link from "next/link";
import { usePosStore } from "./use-pos-store";
import { usePosYearStore } from "./use-pos-year-store";
import { useAdmin } from "./admin-context";
import { getFlavorName, getItemSizeName } from "./pos-config";
import { usePosVatStore, calcNet } from "./use-pos-vat-store";
import type { DailySummary } from "./pos-types";

function fmt(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

function buildCsv(
  daily: DailySummary,
  startCashCents: number,
  bankDepositCents: number,
  vatRate: number
): string {
  const netCents = Math.round((daily.totalCents * 100) / (100 + vatRate));
  const vatCents = daily.totalCents - netCents;
  const kassenbestandCents = startCashCents + daily.cashCents - bankDepositCents;

  const rows: string[] = [
    "KASSENBUCH PRIMAQ",
    `Datum;${new Date(daily.date).toLocaleDateString("de-DE")}`,
    "",
    "KASSENÜBERSICHT",
    `Startgeld;${(startCashCents / 100).toFixed(2)}`,
    `Bareinnahmen;${(daily.cashCents / 100).toFixed(2)}`,
    `Karteneinnahmen;${(daily.cardCents / 100).toFixed(2)}`,
    `QR-Einnahmen;${(daily.qrCents / 100).toFixed(2)}`,
    `Gesamtumsatz;${(daily.totalCents / 100).toFixed(2)}`,
    `Netto (${vatRate} %);${(netCents / 100).toFixed(2)}`,
    `MwSt (${vatRate} %);${(vatCents / 100).toFixed(2)}`,
    `Bankeinzahlung;${(bankDepositCents / 100).toFixed(2)}`,
    `Kassenbestand;${(kassenbestandCents / 100).toFixed(2)}`,
    "",
    "EINZELBUCHUNGEN",
    "Uhrzeit;Artikel;Menge;Zahlungsart;Preis je (EUR);Summe (EUR)",
  ];

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
          `${getItemSizeName(item)} ${getFlavorName(item.flavor)}`,
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

function downloadCsv(
  daily: DailySummary,
  startCashCents: number,
  bankDepositCents: number,
  vatRate: number
) {
  const csv = buildCsv(daily, startCashCents, bankDepositCents, vatRate);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `primaq-kassenbuch-${daily.date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DailyClosePage({ guestAccess }: { guestAccess?: boolean }) {
  const { daily, resetDaily, hydrated } = usePosStore();
  const { saveDay } = usePosYearStore();
  const { isAdmin, hydrated: adminHydrated } = useAdmin();
  const { vatRate, setVatRate, hydrated: vatHydrated } = usePosVatStore();
  const [confirming, setConfirming] = useState(false);
  const [startCashInput, setStartCashInput] = useState("");
  const [bankDepositInput, setBankDepositInput] = useState("");

  const handleReset = useCallback(() => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    if (daily.orderCount > 0) {
      saveDay(daily);
    }
    resetDaily();
    setConfirming(false);
  }, [confirming, daily, saveDay, resetDaily]);

  if (!hydrated || !adminHydrated || !vatHydrated) {
    return <div className="flex h-40 items-center justify-center text-black/40">Laden…</div>;
  }

  // Guard: operator access blocked
  if (!isAdmin && !guestAccess) {
    return (
      <div className="flex flex-col items-center gap-6 py-20 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-black/5">
          <Lock className="h-8 w-8 text-black/25" />
        </div>
        <div>
          <p className="text-xl font-black text-black/60">Admin-Berechtigung erforderlich</p>
          <p className="mt-1 text-sm text-black/40">
            Bitte als Admin anmelden, um den Tagesabschluss zu sehen.
          </p>
        </div>
        <Link
          href="/verkauf"
          className="rounded-xl bg-primaq-500 px-6 py-3 font-bold text-white hover:bg-primaq-700 transition-colors"
        >
          Zurück zum Verkauf
        </Link>
      </div>
    );
  }

  const hasData = daily.orderCount > 0;
  const netCents = calcNet(daily.totalCents, vatRate);
  const vatCents = daily.totalCents - netCents;

  const startCashCents = Math.round(parseFloat(startCashInput.replace(",", ".") || "0") * 100);
  const bankDepositCents = Math.round(parseFloat(bankDepositInput.replace(",", ".") || "0") * 100);
  const kassenbestandCents = startCashCents + daily.cashCents - bankDepositCents;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="Gesamtumsatz" value={fmt(daily.totalCents)} accent />
        <SummaryCard label="Bar" value={fmt(daily.cashCents)} />
        <SummaryCard label="Karte" value={fmt(daily.cardCents)} />
        <SummaryCard label="QR" value={fmt(daily.qrCents)} />
      </div>

      {/* VAT rate picker + breakdown */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-black/40">MwSt</span>
        <div className="flex gap-1">
          {([0, 7, 19] as const).map((v) => (
            <button
              key={v}
              data-testid={`vat-btn-${v}`}
              onClick={() => setVatRate(v)}
              className={`rounded-lg px-3 py-1 text-sm font-bold transition-colors ${
                vatRate === v
                  ? "bg-primaq-500 text-white shadow-sm"
                  : "border border-black/12 bg-white text-black/50 hover:bg-black/5"
              }`}
            >
              {v} %
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <SummaryCard label="Netto" value={fmt(netCents)} />
        <SummaryCard label={`MwSt ${vatRate} %`} value={fmt(vatCents)} />
      </div>

      {/* Kassenbuch */}
      <div className="rounded-2xl bg-white shadow">
        <div className="border-b border-black/5 px-5 py-3">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">Kassenbuch</p>
        </div>
        <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-black/40">
              Startgeld (€)
            </label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={startCashInput}
              onChange={(e) => setStartCashInput(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-black/[0.02] px-4 py-2.5 text-right text-lg font-bold text-ink focus:border-primaq-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-black/40">
              Bankeinzahlung (€)
            </label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={bankDepositInput}
              onChange={(e) => setBankDepositInput(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-black/[0.02] px-4 py-2.5 text-right text-lg font-bold text-ink focus:border-primaq-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-px border-t border-black/5 bg-black/5">
          <KasseCell label="Startgeld" value={fmt(startCashCents)} />
          <KasseCell label="+ Bareinnahmen" value={fmt(daily.cashCents)} />
          <KasseCell
            label="= Kassenbestand"
            value={fmt(kassenbestandCents)}
            accent={kassenbestandCents >= 0}
            warn={kassenbestandCents < 0}
          />
        </div>
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
                        {item.quantity}× {getItemSizeName(item)} {getFlavorName(item.flavor)}
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
          onClick={() => downloadCsv(daily, startCashCents, bankDepositCents, vatRate)}
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

function KasseCell({
  label,
  value,
  accent = false,
  warn = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={`bg-white px-4 py-3 ${accent ? "text-primaq-600" : warn ? "text-red-600" : ""}`}
    >
      <p className="text-xs font-bold uppercase tracking-widest text-black/40">{label}</p>
      <p className="mt-0.5 text-xl font-black tabular-nums">{value}</p>
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
