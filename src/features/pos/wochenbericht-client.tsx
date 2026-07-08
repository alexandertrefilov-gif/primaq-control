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
const WEEKDAY_BY_DATE = new Map<string, string>();

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
    WEEKDAY_BY_DATE.set(dateStr, label);
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

// ── Reset target ──────────────────────────────────────────────────────────────

type ResetTarget =
  | { kind: "period" }
  | { kind: "event"; eventId: string | null; eventName: string | null }
  | { kind: "day"; date: string };

// ── Component ─────────────────────────────────────────────────────────────────

export function WochenberichtClient({ guestAccess }: { guestAccess?: boolean }) {
  const { isAdmin, hydrated: adminHydrated } = useAdmin();
  const { days: history, hydrated, activeEventName, todayOrderCount } = useReportData();
  const { vatRate, hydrated: vatHydrated } = usePosVatStore();
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null);

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

  // Only days with an actual pos_year_history (or live) entry are grouped —
  // empty calendar slots carry nothing to show or delete.
  const daysWithData = useMemo(
    () => weekDays.flatMap((d) => (d.summary ? [d.summary] : [])),
    [weekDays]
  );
  const eventGroups = useMemo(() => groupDaysByEvent(daysWithData, vatRate), [daysWithData, vatRate]);

  // Only real, closed pos_year_history entries are ever deletable — a day
  // slot with no summary at all has nothing to delete either, and was
  // previously wrongly included here (any falsy `summary?.isLive` matched).
  const historyDaysToDelete = useMemo(
    () => weekDays.filter((d) => d.summary && !d.summary.isLive),
    [weekDays]
  );
  const hasLiveDay = weekDays.some((d) => d.summary?.isLive);

  // ── Reset-Dialog: berechnet Ziel-Tage/Titel/Label je nach resetTarget ──────
  const resetDialogProps = useMemo(() => {
    if (!resetTarget) return null;
    if (resetTarget.kind === "period") {
      return {
        title: `${`KW${String(isoWeek).padStart(2, "0")}`} ${isoYear} zurücksetzen`,
        scopeLabel: `KW${String(isoWeek).padStart(2, "0")} ${isoYear}`,
        unitLabel: "Wochendaten",
        strongConfirmWord: "WOCHE LÖSCHEN",
        daysToDelete: historyDaysToDelete.map((d) => ({ date: d.dateStr, eventName: d.summary?.eventName ?? null })),
        hasLiveDay,
        onConfirm: async () => {
          const dates = historyDaysToDelete.map((d) => d.dateStr);
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
    const day = daysWithData.find((d) => d.date === resetTarget.date);
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
  }, [resetTarget, isoWeek, isoYear, historyDaysToDelete, hasLiveDay, eventGroups, daysWithData]);

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

      {/* ── Grouped-by-Einsatz table ────────────────────────────────────────
          Ebene 1: Einsatz (bzw. "Ohne Einsatz"), Ebene 2: Tage innerhalb
          dieses Einsatzes. Tage ohne Daten (leere Kalenderslots) werden hier
          nicht aufgeführt — es gibt nichts zu zeigen oder zu löschen. */}
      {hasData ? (
        <div className="rounded-2xl bg-white shadow overflow-hidden" data-testid="week-table">
          <div className="border-b border-black/5 px-5 py-3">
            <p className="text-xs font-bold uppercase tracking-widest text-black/40">
              {kw} {isoYear} · Gruppierung nach Einsatz
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 text-left">
                  <th className="px-5 py-3 font-bold text-black/40">Datum</th>
                  <th className="px-4 py-3 font-bold text-black/40">Wochentag</th>
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
                      data-testid={`week-event-group-${groupKey}`}
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
                            data-testid={`week-delete-event-${groupKey}`}
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
                      <tr key={d.date} data-testid={`week-day-row-${d.date}`} className="border-b border-black/5">
                        <td className="px-5 py-2 pl-8 text-ink tabular-nums">
                          {d.date}
                          {d.eventTotalDays && d.eventTotalDays > 1 && (
                            <span className="ml-1.5 text-[10px] font-bold text-black/35">
                              Tag {d.eventDayIndex} von {d.eventTotalDays}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-black/60">{WEEKDAY_BY_DATE.get(d.date) ?? ""}</td>
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
                              data-testid={`week-delete-day-${d.date}`}
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
                  <td className="px-5 py-3 font-black text-ink" colSpan={2}>Gesamt {kw}</td>
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
            onClick={() => setResetTarget({ kind: "period" })}
            className="flex items-center gap-2 rounded-xl border border-red-200 bg-white px-5 py-3 font-bold text-red-600 shadow-sm hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            Wochendaten zurücksetzen
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
