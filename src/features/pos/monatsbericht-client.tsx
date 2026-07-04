"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Download, Lock, Trash2 } from "lucide-react";
import { useAdmin } from "./admin-context";
import { usePosYearStore } from "./use-pos-year-store";
import { usePosVatStore, calcNetForDay } from "./use-pos-vat-store";
import { ReportResetDialog } from "./report-reset-dialog";
import { getSyncService } from "@/lib/sync/sync-service";
import type { DailySummary } from "./pos-types";

// ── Formatting helpers ────────────────────────────────────────────────────────

const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function fmt(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

function fmtNum(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function daysOfMonth(history: DailySummary[], year: number, month: number): DailySummary[] {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return history.filter((d) => d.date.startsWith(prefix)).sort((a, b) => a.date.localeCompare(b.date));
}

function weekdayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return WEEKDAY_SHORT[d.getUTCDay()];
}

// ── CSV export ────────────────────────────────────────────────────────────────

function buildMonthCsv(days: DailySummary[], year: number, month: number, vatRate: number): string {
  const monthLabel = MONTHS[month - 1];
  const vatLabel = `${vatRate} %`;
  const rows: string[] = [
    `PrimaQ POS – Monatsbericht ${monthLabel} ${year}`,
    "",
    `Datum;Wochentag;Einsatz / Veranstaltung;Umsatz brutto (€);Bar (€);Karte (€);QR (€);Bestellungen;Netto ${vatLabel} (€);MwSt ${vatLabel} (€)`,
  ];
  let totalCents = 0, cashCents = 0, cardCents = 0, qrCents = 0, orders = 0, netTotalCents = 0;
  for (const d of days) {
    const net = calcNetForDay(d, vatRate);
    rows.push([d.date, weekdayLabel(d.date), d.eventName ?? "", fmtNum(d.totalCents), fmtNum(d.cashCents),
      fmtNum(d.cardCents), fmtNum(d.qrCents), d.orderCount,
      fmtNum(net), fmtNum(d.totalCents - net)].join(";"));
    totalCents += d.totalCents; cashCents += d.cashCents;
    cardCents += d.cardCents; qrCents += d.qrCents; orders += d.orderCount;
    netTotalCents += net;
  }
  rows.push(["", "Gesamt", fmtNum(totalCents), fmtNum(cashCents),
    fmtNum(cardCents), fmtNum(qrCents), orders,
    fmtNum(netTotalCents), fmtNum(totalCents - netTotalCents)].join(";"));
  return "﻿" + rows.join("\n");
}

function triggerDownload(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MonatsberichtClient({ guestAccess }: { guestAccess?: boolean }) {
  const { isAdmin, hydrated: adminHydrated } = useAdmin();
  const { history, hydrated } = usePosYearStore();
  const { vatRate, hydrated: vatHydrated } = usePosVatStore();

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [resetOpen, setResetOpen] = useState(false);

  const days = useMemo(() => daysOfMonth(history, year, month), [history, year, month]);

  const totalCents = days.reduce((s, d) => s + d.totalCents, 0);
  const cashCents  = days.reduce((s, d) => s + d.cashCents,  0);
  const cardCents  = days.reduce((s, d) => s + d.cardCents,  0);
  const qrCents    = days.reduce((s, d) => s + d.qrCents,    0);
  const orderCount = days.reduce((s, d) => s + d.orderCount, 0);
  const netCents   = days.reduce((s, d) => s + calcNetForDay(d, vatRate), 0);
  const vatCents   = totalCents - netCents;
  const hasData    = days.length > 0;

  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else { setMonth((m) => m - 1); }
  }

  function nextMonth() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else { setMonth((m) => m + 1); }
  }

  const monthLabel = MONTHS[month - 1];
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;

  if (!hydrated || !adminHydrated || !vatHydrated) {
    return <div className="flex h-40 items-center justify-center text-black/40">Laden…</div>;
  }

  if (!isAdmin && !guestAccess) {
    return (
      <div className="flex flex-col items-center gap-6 py-20 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-black/5">
          <Lock className="h-8 w-8 text-black/25" />
        </div>
        <div>
          <p className="text-lg font-bold text-ink">Admin-Berechtigung erforderlich</p>
          <p className="mt-1 text-sm text-black/40">
            Bitte als Admin anmelden, um den Monatsbericht zu sehen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Month navigator ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          data-testid="prev-month"
          onClick={prevMonth}
          className="grid h-9 w-9 place-items-center rounded-xl border border-black/10 bg-white shadow hover:bg-black/5 transition-colors"
          aria-label="Vorheriger Monat"
        >
          <ChevronLeft className="h-4 w-4 text-black/50" />
        </button>

        <div className="flex-1 text-center">
          <p className="text-lg font-black text-ink">{monthLabel} {year}</p>
          <p className="text-xs text-black/40">{monthKey}</p>
        </div>

        <button
          data-testid="next-month"
          onClick={nextMonth}
          className="grid h-9 w-9 place-items-center rounded-xl border border-black/10 bg-white shadow hover:bg-black/5 transition-colors"
          aria-label="Nächster Monat"
        >
          <ChevronRight className="h-4 w-4 text-black/50" />
        </button>
      </div>

      {/* ── KPIs ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl bg-primaq-500 p-5 text-white shadow">
          <p className="text-xs font-bold uppercase tracking-widest text-white/70">Umsatz brutto</p>
          <p data-testid="month-total" className="mt-1 text-2xl font-black tabular-nums">{fmt(totalCents)}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">Netto</p>
          <p data-testid="month-net" className="mt-1 text-2xl font-black tabular-nums">{fmt(netCents)}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">{`MwSt ${vatRate} %`}</p>
          <p data-testid="month-vat" className="mt-1 text-2xl font-black tabular-nums">{fmt(vatCents)}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">Bestellungen</p>
          <p className="mt-1 text-2xl font-black tabular-nums">{orderCount}</p>
        </div>
      </div>

      {/* ── Daily table ───────────────────────────────────────────────────── */}
      {hasData ? (
        <div className="rounded-2xl bg-white shadow overflow-hidden">
          <div className="border-b border-black/5 px-5 py-3">
            <p className="text-xs font-bold uppercase tracking-widest text-black/40">
              {monthLabel} {year} · {days.length} {days.length === 1 ? "Tag" : "Tage"}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table data-testid="month-table" className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 text-left">
                  <th className="px-5 py-3 font-bold text-black/40">Datum</th>
                  <th className="px-4 py-3 font-bold text-black/40">Tag</th>
                  <th className="px-4 py-3 font-bold text-black/40">Einsatz</th>
                  <th className="px-4 py-3 text-right font-bold text-black/40">Umsatz</th>
                  <th className="px-4 py-3 text-right font-bold text-black/40">Bar</th>
                  <th className="px-4 py-3 text-right font-bold text-black/40">Karte</th>
                  <th className="px-4 py-3 text-right font-bold text-black/40">QR</th>
                  <th className="px-4 py-3 text-right font-bold text-black/40">Bestellungen</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr
                    key={d.date}
                    data-testid={`month-day-row-${d.date}`}
                    className="border-b border-black/5"
                  >
                    <td className="px-5 py-3 font-semibold text-ink tabular-nums">{d.date}</td>
                    <td className="px-4 py-3 text-black/60">{weekdayLabel(d.date)}</td>
                    <td className="px-4 py-3 text-sm text-black/60">{d.eventName ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-bold text-ink tabular-nums">{fmt(d.totalCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-black/60">
                      {d.cashCents > 0 ? fmt(d.cashCents) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-black/60">
                      {d.cardCents > 0 ? fmt(d.cardCents) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-black/60">
                      {d.qrCents > 0 ? fmt(d.qrCents) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-black/60">{d.orderCount}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-black/[0.02] font-bold">
                  <td className="px-5 py-3 font-black text-ink" colSpan={3}>Gesamt</td>
                  <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(totalCents)}</td>
                  <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(cashCents)}</td>
                  <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(cardCents)}</td>
                  <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(qrCents)}</td>
                  <td className="px-4 py-3 text-right text-ink tabular-nums">{orderCount}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-black/10 py-16 text-center">
          <p className="text-base font-bold text-black/30">Keine Abschlüsse in {monthLabel} {year}</p>
          <p className="mt-1 text-sm text-black/25">
            Tagesdaten werden beim Tagesabschluss automatisch gespeichert.
          </p>
        </div>
      )}

      {/* ── CSV export + Reset ────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <button
          data-testid="csv-export-month"
          onClick={() =>
            triggerDownload(
              buildMonthCsv(days, year, month, vatRate),
              `primaq-monatsbericht-${monthKey}.csv`
            )
          }
          disabled={!hasData}
          className="flex items-center gap-2 rounded-xl bg-primaq-500 px-5 py-3 font-bold text-white shadow hover:bg-primaq-700 disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30 transition-colors"
        >
          <Download className="h-4 w-4" />
          CSV exportieren
        </button>

        {isAdmin && hasData && (
          <button
            data-testid="reset-month-btn"
            onClick={() => setResetOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-red-200 bg-white px-5 py-3 font-bold text-red-600 shadow-sm hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            Monatsdaten zurücksetzen
          </button>
        )}
      </div>

      <ReportResetDialog
        open={resetOpen}
        title={`${monthLabel} ${year} zurücksetzen`}
        scopeLabel={`${monthLabel} ${year} (${days.length} ${days.length === 1 ? "Tag" : "Tage"})`}
        onClose={() => setResetOpen(false)}
        onConfirm={async () => {
          await getSyncService().resetHistoryDates(days.map((d) => d.date));
        }}
      />
    </div>
  );
}
