"use client";

import { Fragment, useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Download, Lock, Trash2 } from "lucide-react";
import { useAdmin } from "./admin-context";
import { useReportData, type ReportDay } from "./use-report-data";
import { ReportEventDebug } from "./report-event-debug";
import { groupDaysByEvent } from "./group-days-by-event";
import { usePosVatStore, calcNetForDay } from "./use-pos-vat-store";
import { ReportResetDialog } from "./report-reset-dialog";
import { getSyncService } from "@/lib/sync/sync-service";

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

function daysOfMonth(history: ReportDay[], year: number, month: number): ReportDay[] {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return history.filter((d) => d.date.startsWith(prefix)).sort((a, b) => a.date.localeCompare(b.date));
}

function weekdayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return WEEKDAY_SHORT[d.getUTCDay()];
}

// ── CSV export ────────────────────────────────────────────────────────────────

function buildMonthCsv(days: ReportDay[], year: number, month: number, vatRate: number): string {
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

// ── Reset target ──────────────────────────────────────────────────────────────

type ResetTarget =
  | { kind: "period" }
  | { kind: "event"; eventId: string | null; eventName: string | null }
  | { kind: "day"; date: string };

// ── Component ─────────────────────────────────────────────────────────────────

export function MonatsberichtClient({ guestAccess }: { guestAccess?: boolean }) {
  const { isAdmin, hydrated: adminHydrated } = useAdmin();
  const { days: history, hydrated, activeEventName, todayOrderCount } = useReportData();
  const { vatRate, hydrated: vatHydrated } = usePosVatStore();

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null);

  const days = useMemo(() => daysOfMonth(history, year, month), [history, year, month]);
  const historyDaysToDelete = useMemo(() => days.filter((d) => !d.isLive), [days]);
  const hasLiveDay = days.some((d) => d.isLive);
  const eventGroups = useMemo(() => groupDaysByEvent(days, vatRate), [days, vatRate]);

  const totalCents = days.reduce((s, d) => s + d.totalCents, 0);
  const cashCents  = days.reduce((s, d) => s + d.cashCents,  0);
  const cardCents  = days.reduce((s, d) => s + d.cardCents,  0);
  const qrCents    = days.reduce((s, d) => s + d.qrCents,    0);
  const orderCount = days.reduce((s, d) => s + d.orderCount, 0);
  const netCents   = days.reduce((s, d) => s + calcNetForDay(d, vatRate), 0);
  const vatCents   = totalCents - netCents;
  const hasData    = days.length > 0;

  const monthLabel = MONTHS[month - 1];
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;

  const resetDialogProps = useMemo(() => {
    if (!resetTarget) return null;
    if (resetTarget.kind === "period") {
      return {
        title: `${monthLabel} ${year} zurücksetzen`,
        scopeLabel: `${monthLabel} ${year}`,
        unitLabel: "Monatsdaten",
        strongConfirmWord: "MONAT LÖSCHEN",
        daysToDelete: historyDaysToDelete.map((d) => ({ date: d.date, eventName: d.eventName ?? null })),
        hasLiveDay,
        onConfirm: async () => {
          const dates = historyDaysToDelete.map((d) => d.date);
          await getSyncService().resetHistoryDates(dates);
        },
      };
    }
    if (resetTarget.kind === "event") {
      const group = eventGroups.find((g) =>
        resetTarget.eventId ? g.eventId === resetTarget.eventId : g.eventName === resetTarget.eventName
      );
      const deletable = (group?.days ?? []).filter((d) => !d.isLive);
      return {
        title: `${resetTarget.eventName ?? "Ohne Einsatz"} löschen`,
        scopeLabel: resetTarget.eventName ?? "Ohne Einsatz",
        unitLabel: "diesen Einsatz",
        daysToDelete: deletable.map((d) => ({ date: d.date, eventName: d.eventName ?? null })),
        hasLiveDay: !!group?.hasLiveDay,
        onConfirm: async () => {
          await getSyncService().resetHistoryDates(deletable.map((d) => d.date));
        },
      };
    }
    const day = days.find((d) => d.date === resetTarget.date);
    return {
      title: `Tagesabschluss ${resetTarget.date} löschen`,
      scopeLabel: resetTarget.date,
      unitLabel: "diesen Tagesabschluss",
      daysToDelete: day && !day.isLive ? [{ date: day.date, eventName: day.eventName ?? null }] : [],
      hasLiveDay: !!day?.isLive,
      onConfirm: async () => {
        await getSyncService().resetHistoryDates([resetTarget.date]);
      },
    };
  }, [resetTarget, monthLabel, year, historyDaysToDelete, hasLiveDay, eventGroups, days]);

  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else { setMonth((m) => m - 1); }
  }

  function nextMonth() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else { setMonth((m) => m + 1); }
  }

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

      {/* ── Grouped-by-Einsatz table ────────────────────────────────────────
          Ebene 1: Einsatz (bzw. "Ohne Einsatz"), Ebene 2: Tage innerhalb
          dieses Einsatzes. */}
      {hasData ? (
        <div className="rounded-2xl bg-white shadow overflow-hidden">
          <div className="border-b border-black/5 px-5 py-3">
            <p className="text-xs font-bold uppercase tracking-widest text-black/40">
              {monthLabel} {year} · Gruppierung nach Einsatz
            </p>
          </div>
          <div className="overflow-x-auto">
            <table data-testid="month-table" className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 text-left">
                  <th className="px-5 py-3 font-bold text-black/40">Datum</th>
                  <th className="px-4 py-3 font-bold text-black/40">Tag</th>
                  <th className="px-4 py-3 text-right font-bold text-black/40">Umsatz</th>
                  <th className="px-4 py-3 text-right font-bold text-black/40">Bar</th>
                  <th className="px-4 py-3 text-right font-bold text-black/40">Karte</th>
                  <th className="px-4 py-3 text-right font-bold text-black/40">QR</th>
                  <th className="px-4 py-3 text-right font-bold text-black/40">Bestellungen</th>
                  <th className="px-4 py-3 text-right font-bold text-black/40">MwSt</th>
                  <th className="px-4 py-3 text-right font-bold text-black/40">Netto</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {eventGroups.map((group) => {
                  const groupKey = group.eventId ?? group.eventName ?? "ohne-einsatz";
                  return (
                  <Fragment key={`group-${groupKey}`}>
                    <tr
                      data-testid={`month-event-group-${groupKey}`}
                      className="border-b border-black/5 bg-primaq-50/60"
                    >
                      <td className="px-5 py-2.5 font-black text-ink" colSpan={2}>
                        {group.eventName ?? "Ohne Einsatz"}
                        {group.hasLiveDay && (
                          <span className="ml-1.5 rounded-full bg-primaq-100 px-1.5 py-0.5 text-[10px] font-bold text-primaq-700">
                            läuft
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-black text-ink tabular-nums">{fmt(group.totalCents)}</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-black/60">{fmt(group.cashCents)}</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-black/60">{fmt(group.cardCents)}</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-black/60">{fmt(group.qrCents)}</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-black/60">{group.orderCount}</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-black/60">{fmt(group.vatCents)}</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-black/60">{fmt(group.netCents)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {isAdmin && group.days.some((d) => !d.isLive) && (
                          <button
                            data-testid={`month-delete-event-${groupKey}`}
                            onClick={() => setResetTarget({ kind: "event", eventId: group.eventId, eventName: group.eventName })}
                            className="rounded-lg p-1.5 text-black/30 transition-colors hover:bg-red-50 hover:text-red-600"
                            aria-label={`${group.eventName ?? "Ohne Einsatz"} löschen`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                    {group.days.map((d) => (
                      <tr key={d.date} data-testid={`month-day-row-${d.date}`} className="border-b border-black/5">
                        <td className="px-5 py-2 pl-8 text-ink tabular-nums">
                          {d.date}
                          {d.eventTotalDays && d.eventTotalDays > 1 && (
                            <span className="ml-1.5 text-[10px] font-bold text-black/35">
                              Tag {d.eventDayIndex} von {d.eventTotalDays}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-black/60">{weekdayLabel(d.date)}</td>
                        <td className="px-4 py-2 text-right font-bold text-ink tabular-nums">{fmt(d.totalCents)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-black/60">
                          {d.cashCents > 0 ? fmt(d.cashCents) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-black/60">
                          {d.cardCents > 0 ? fmt(d.cardCents) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-black/60">
                          {d.qrCents > 0 ? fmt(d.qrCents) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-black/60">{d.orderCount}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-black/60">
                          {fmt(d.totalCents - calcNetForDay(d, vatRate))}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-black/60">
                          {fmt(calcNetForDay(d, vatRate))}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isAdmin && !d.isLive && (
                            <button
                              data-testid={`month-delete-day-${d.date}`}
                              onClick={() => setResetTarget({ kind: "day", date: d.date })}
                              className="rounded-lg p-1.5 text-black/25 transition-colors hover:bg-red-50 hover:text-red-600"
                              aria-label={`Tagesabschluss ${d.date} löschen`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-black/[0.02] font-bold">
                  <td className="px-5 py-3 font-black text-ink" colSpan={2}>Gesamt</td>
                  <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(totalCents)}</td>
                  <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(cashCents)}</td>
                  <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(cardCents)}</td>
                  <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(qrCents)}</td>
                  <td className="px-4 py-3 text-right text-ink tabular-nums">{orderCount}</td>
                  <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(vatCents)}</td>
                  <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(netCents)}</td>
                  <td />
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

      {isAdmin && (
        <ReportEventDebug
          visibleDays={days}
          activeEventName={activeEventName}
          todayOrderCount={todayOrderCount}
          rangeLabel={`${monthLabel} ${year}`}
        />
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
            onClick={() => setResetTarget({ kind: "period" })}
            className="flex items-center gap-2 rounded-xl border border-red-200 bg-white px-5 py-3 font-bold text-red-600 shadow-sm hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            Monatsdaten zurücksetzen
          </button>
        )}
      </div>

      {resetDialogProps && (
        <ReportResetDialog
          open={resetTarget !== null}
          onClose={() => setResetTarget(null)}
          {...resetDialogProps}
        />
      )}
    </div>
  );
}
