"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Download, Lock, Trash2 } from "lucide-react";
import { useAdmin } from "./admin-context";
import { useReportData, type ReportDay } from "./use-report-data";
import { ReportEventDebug } from "./report-event-debug";
import { usePosVatStore, calcNetForDay } from "./use-pos-vat-store";
import { ReportResetDialog } from "./report-reset-dialog";
import { getSyncService } from "@/lib/sync/sync-service";

// ── ISO week arithmetic ───────────────────────────────────────────────────────

/** Returns the ISO week-year and week-number for a YYYY-MM-DD string. */
function isoWeekOf(dateStr: string): { isoYear: number; isoWeek: number } {
  const d = new Date(dateStr + "T12:00:00Z");
  // ISO weeks are defined by their Thursday
  const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  thu.setUTCDate(thu.getUTCDate() + (4 - (thu.getUTCDay() || 7)));
  const jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  const isoWeek = Math.ceil(((thu.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
  return { isoYear: thu.getUTCFullYear(), isoWeek };
}

/** Returns the Monday of the given ISO week as a UTC Date. */
function mondayOfIsoWeek(isoYear: number, isoWeek: number): Date {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  return new Date(Date.UTC(isoYear, 0, 4 - dow + 1 + (isoWeek - 1) * 7));
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmt(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

function fmtNum(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ── Data helpers ──────────────────────────────────────────────────────────────

type WeekDay = {
  dateStr: string;      // YYYY-MM-DD
  label: string;        // "Montag", "Dienstag", …
  summary: ReportDay | null;
};

function buildWeekDays(history: ReportDay[], isoYear: number, isoWeek: number): WeekDay[] {
  const monday = mondayOfIsoWeek(isoYear, isoWeek);
  return WEEKDAYS.map((label, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const dateStr = toDateStr(d);
    const summary = history.find((s) => s.date === dateStr) ?? null;
    return { dateStr, label, summary };
  });
}

// ── CSV export ────────────────────────────────────────────────────────────────

function buildWeekCsv(days: WeekDay[], isoYear: number, isoWeek: number, vatRate: number): string {
  const kw = `KW${String(isoWeek).padStart(2, "0")}`;
  const vatLabel = `${vatRate} %`;
  const rows: string[] = [
    `PrimaQ POS – Wochenbericht ${kw} ${isoYear}`,
    "",
    `Datum;Wochentag;Einsatz / Veranstaltung;Umsatz brutto (€);Bar (€);Karte (€);QR (€);Bestellungen;Netto ${vatLabel} (€);MwSt ${vatLabel} (€)`,
  ];
  let totalCents = 0, cashCents = 0, cardCents = 0, qrCents = 0, orders = 0, netTotalCents = 0;
  for (const d of days) {
    const s = d.summary;
    if (s) {
      const net = calcNetForDay(s, vatRate);
      rows.push([d.dateStr, d.label, s.eventName ?? "", fmtNum(s.totalCents), fmtNum(s.cashCents),
        fmtNum(s.cardCents), fmtNum(s.qrCents), s.orderCount,
        fmtNum(net), fmtNum(s.totalCents - net)].join(";"));
      totalCents += s.totalCents; cashCents += s.cashCents;
      cardCents += s.cardCents; qrCents += s.qrCents; orders += s.orderCount;
      netTotalCents += net;
    } else {
      rows.push([d.dateStr, d.label, "", "0,00", "0,00", "0,00", "0,00", "0", "0,00", "0,00"].join(";"));
    }
  }
  rows.push(["", "Gesamt", "", fmtNum(totalCents), fmtNum(cashCents),
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

export function WochenberichtClient({ guestAccess }: { guestAccess?: boolean }) {
  const { isAdmin, hydrated: adminHydrated } = useAdmin();
  const { days: history, hydrated, activeEventName, todayOrderCount } = useReportData();
  const { vatRate, hydrated: vatHydrated } = usePosVatStore();
  const [resetOpen, setResetOpen] = useState(false);

  const today = new Date();
  const { isoYear: todayYear, isoWeek: todayWeek } = isoWeekOf(
    today.toISOString().slice(0, 10)
  );

  const [isoYear, setIsoYear] = useState(todayYear);
  const [isoWeek, setIsoWeek] = useState(todayWeek);

  const weekDays = useMemo(
    () => buildWeekDays(history, isoYear, isoWeek),
    [history, isoYear, isoWeek]
  );

  const monday = mondayOfIsoWeek(isoYear, isoWeek);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const totalCents = weekDays.reduce((s, d) => s + (d.summary?.totalCents ?? 0), 0);
  const cashCents  = weekDays.reduce((s, d) => s + (d.summary?.cashCents  ?? 0), 0);
  const cardCents  = weekDays.reduce((s, d) => s + (d.summary?.cardCents  ?? 0), 0);
  const qrCents    = weekDays.reduce((s, d) => s + (d.summary?.qrCents    ?? 0), 0);
  const orderCount = weekDays.reduce((s, d) => s + (d.summary?.orderCount ?? 0), 0);
  const netCents   = weekDays.reduce((s, d) => s + (d.summary ? calcNetForDay(d.summary, vatRate) : 0), 0);
  const vatCents   = totalCents - netCents;
  const hasData    = totalCents > 0;

  // Only real, closed pos_year_history entries are ever deletable — a day
  // slot with no summary at all has nothing to delete either, and was
  // previously wrongly included here (any falsy `summary?.isLive` matched).
  const historyDaysToDelete = useMemo(
    () => weekDays.filter((d) => d.summary && !d.summary.isLive),
    [weekDays]
  );
  const hasLiveDay = weekDays.some((d) => d.summary?.isLive);

  function prevWeek() {
    if (isoWeek === 1) {
      const newYear = isoYear - 1;
      // Find the last week of the previous year
      const { isoWeek: lastWeek } = isoWeekOf(`${newYear}-12-28`);
      setIsoYear(newYear);
      setIsoWeek(lastWeek);
    } else {
      setIsoWeek((w) => w - 1);
    }
  }

  function nextWeek() {
    const { isoYear: maxYear, isoWeek: maxWeek } = isoWeekOf(`${isoYear}-12-28`);
    if (isoWeek >= maxWeek && isoYear === maxYear) {
      setIsoYear((y) => y + 1);
      setIsoWeek(1);
    } else if (isoWeek >= maxWeek) {
      setIsoYear((y) => y + 1);
      setIsoWeek(1);
    } else {
      setIsoWeek((w) => w + 1);
    }
  }

  const kw = `KW${String(isoWeek).padStart(2, "0")}`;
  const dateRangeLabel = `${toDateStr(monday)} – ${toDateStr(sunday)}`;

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
            Bitte als Admin anmelden, um den Wochenbericht zu sehen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Week navigator ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          data-testid="prev-week"
          onClick={prevWeek}
          className="grid h-9 w-9 place-items-center rounded-xl border border-black/10 bg-white shadow hover:bg-black/5 transition-colors"
          aria-label="Vorherige Woche"
        >
          <ChevronLeft className="h-4 w-4 text-black/50" />
        </button>

        <div className="flex-1 text-center">
          <p className="text-lg font-black text-ink">{kw} {isoYear}</p>
          <p className="text-xs text-black/40">{dateRangeLabel}</p>
        </div>

        <button
          data-testid="next-week"
          onClick={nextWeek}
          className="grid h-9 w-9 place-items-center rounded-xl border border-black/10 bg-white shadow hover:bg-black/5 transition-colors"
          aria-label="Nächste Woche"
        >
          <ChevronRight className="h-4 w-4 text-black/50" />
        </button>
      </div>

      {/* ── KPIs ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl bg-primaq-500 p-5 text-white shadow">
          <p className="text-xs font-bold uppercase tracking-widest text-white/70">Umsatz brutto</p>
          <p data-testid="week-total" className="mt-1 text-2xl font-black tabular-nums">{fmt(totalCents)}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">Netto</p>
          <p className="mt-1 text-2xl font-black tabular-nums">{fmt(netCents)}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">{`MwSt ${vatRate} %`}</p>
          <p className="mt-1 text-2xl font-black tabular-nums">{fmt(vatCents)}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">Bestellungen</p>
          <p className="mt-1 text-2xl font-black tabular-nums">{orderCount}</p>
        </div>
      </div>

      {/* ── Daily table ───────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white shadow overflow-hidden">
        <div className="border-b border-black/5 px-5 py-3">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">
            {kw} {isoYear} · Tagesdaten
          </p>
        </div>
        <div className="overflow-x-auto">
          <table data-testid="week-table" className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/5 text-left">
                <th className="px-5 py-3 font-bold text-black/40">Datum</th>
                <th className="px-4 py-3 font-bold text-black/40">Wochentag</th>
                <th className="px-4 py-3 font-bold text-black/40">Einsatz</th>
                <th className="px-4 py-3 text-right font-bold text-black/40">Umsatz</th>
                <th className="px-4 py-3 text-right font-bold text-black/40">Bar</th>
                <th className="px-4 py-3 text-right font-bold text-black/40">Karte</th>
                <th className="px-4 py-3 text-right font-bold text-black/40">QR</th>
                <th className="px-4 py-3 text-right font-bold text-black/40">Bestellungen</th>
              </tr>
            </thead>
            <tbody>
              {weekDays.map((d) => (
                <tr
                  key={d.dateStr}
                  data-testid={`week-day-row-${d.dateStr}`}
                  className={`border-b border-black/5 ${d.summary ? "" : "opacity-30"}`}
                >
                  <td className="px-5 py-3 font-semibold text-ink tabular-nums">{d.dateStr}</td>
                  <td className="px-4 py-3 text-black/60">{d.label}</td>
                  <td className="px-4 py-3 text-sm text-black/60">
                    {d.summary
                      ? d.summary.eventName
                        ? <>
                            {d.summary.eventName}
                            {d.summary.isLive && (
                              <span className="ml-1.5 rounded-full bg-primaq-100 px-1.5 py-0.5 text-[10px] font-bold text-primaq-700">
                                läuft
                              </span>
                            )}
                          </>
                        : "Ohne Einsatz"
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-ink tabular-nums">
                    {d.summary ? fmt(d.summary.totalCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-black/60">
                    {d.summary && d.summary.cashCents > 0 ? fmt(d.summary.cashCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-black/60">
                    {d.summary && d.summary.cardCents > 0 ? fmt(d.summary.cardCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-black/60">
                    {d.summary && d.summary.qrCents > 0 ? fmt(d.summary.qrCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-black/60">
                    {d.summary ? d.summary.orderCount : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-black/[0.02] font-bold">
                <td className="px-5 py-3 font-black text-ink" colSpan={2}>Gesamt</td>
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

      {!hasData && (
        <p className="text-center text-sm text-black/30">
          Keine Abschlüsse in {kw} {isoYear}. Tagesabschlüsse werden beim Zurücksetzen automatisch gespeichert.
        </p>
      )}

      {isAdmin && (
        <ReportEventDebug
          visibleDays={weekDays.flatMap((d) => (d.summary ? [d.summary] : []))}
          activeEventName={activeEventName}
          todayOrderCount={todayOrderCount}
          rangeLabel={`${kw} ${isoYear}`}
        />
      )}

      {/* ── CSV export + Reset ────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <button
          data-testid="csv-export-week"
          onClick={() =>
            triggerDownload(
              buildWeekCsv(weekDays, isoYear, isoWeek, vatRate),
              `primaq-wochenbericht-${kw}-${isoYear}.csv`
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
            data-testid="reset-week-btn"
            onClick={() => setResetOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-red-200 bg-white px-5 py-3 font-bold text-red-600 shadow-sm hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            Wochendaten zurücksetzen
          </button>
        )}
      </div>

      <ReportResetDialog
        open={resetOpen}
        title={`${kw} ${isoYear} zurücksetzen`}
        scopeLabel={`${kw} ${isoYear} (${dateRangeLabel})`}
        unitLabel="Wochendaten"
        historyCount={historyDaysToDelete.length}
        hasLiveDay={hasLiveDay}
        onClose={() => setResetOpen(false)}
        onConfirm={async () => {
          // Only ever delete closed history days — the live, not-yet-closed
          // day has no pos_year_history entry to reset yet; use
          // "Tagesdaten zurücksetzen" for that.
          const dates = historyDaysToDelete.map((d) => d.dateStr);
          await getSyncService().resetHistoryDates(dates);
        }}
      />
    </div>
  );
}
