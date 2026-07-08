"use client";

import { Fragment, useCallback, useState, useMemo } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Lock, Plus, Trash2 } from "lucide-react";
import { useAdmin } from "./admin-context";
import { useReportData } from "./use-report-data";
import { ReportEventDebug } from "./report-event-debug";
import { ReportResetDialog } from "./report-reset-dialog";
import { groupDaysByEvent } from "./group-days-by-event";
import { getFlavorName, getItemSizeName } from "./pos-config";
import { usePosVatStore, calcNetForDay, effectiveVatRate } from "./use-pos-vat-store";
import { useEventPlanStore } from "./use-event-plan-store";
import { eventTotalDays, isDateWithinEvent, type PlannedEvent } from "./event-types";
import { getSyncService } from "@/lib/sync/sync-service";
import type { DailySummary } from "./pos-types";

const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function fmt(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

function fmtNum(cents: number) {
  return (cents / 100).toFixed(2);
}

function pct(part: number, total: number) {
  if (total === 0) return "0,0 %";
  return ((part / total) * 100).toFixed(1).replace(".", ",") + " %";
}

// ── Data helpers ─────────────────────────────────────────────────────────────

type MonthRow = {
  month: number;
  label: string;
  totalCents: number;
  cashCents: number;
  cardCents: number;
  qrCents: number;
  orderCount: number;
  netCents: number;
  vatCents: number;
};

type ArticleRow = {
  key: string;
  name: string;
  qty: number;
  revenueCents: number;
};

function computeMonthly(days: DailySummary[], year: number, vatRate: number): MonthRow[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const monthDays = days.filter((d) => d.date.startsWith(prefix));
    const total = monthDays.reduce((s, d) => s + d.totalCents, 0);
    const net = monthDays.reduce((s, d) => s + calcNetForDay(d, vatRate), 0);
    return {
      month,
      label: MONTHS[i],
      totalCents: total,
      cashCents: monthDays.reduce((s, d) => s + d.cashCents, 0),
      cardCents: monthDays.reduce((s, d) => s + d.cardCents, 0),
      qrCents: monthDays.reduce((s, d) => s + d.qrCents, 0),
      orderCount: monthDays.reduce((s, d) => s + d.orderCount, 0),
      netCents: net,
      vatCents: total - net,
    };
  });
}

function computeArticles(days: DailySummary[]): ArticleRow[] {
  const map = new Map<string, ArticleRow>();
  for (const d of days) {
    for (const order of d.orders) {
      for (const item of order.items) {
        const key = `${item.size}|${item.flavor}`;
        const existing = map.get(key);
        if (existing) {
          existing.qty += item.quantity;
          existing.revenueCents += item.quantity * item.unitPriceCents;
        } else {
          map.set(key, {
            key,
            name: `${getItemSizeName(item)} ${getFlavorName(item.flavor)}`,
            qty: item.quantity,
            revenueCents: item.quantity * item.unitPriceCents,
          });
        }
      }
    }
  }
  return [...map.values()].sort((a, b) => b.revenueCents - a.revenueCents);
}

// ── Export functions ──────────────────────────────────────────────────────────

function buildCsv(days: DailySummary[], year: number, vatRate: number): string {
  const vatLabel = `${vatRate} %`;
  const rows: string[] = [
    `PrimaQ POS – Jahresübersicht ${year}`,
    "",
    `Datum;Einsatz / Veranstaltung;Umsatz brutto (€);Bar (€);Karte (€);QR (€);Bestellungen;Netto ${vatLabel} (€);MwSt ${vatLabel} (€)`,
  ];
  for (const d of days) {
    const net = calcNetForDay(d, vatRate);
    rows.push(
      [
        d.date,
        d.eventName ?? "",
        fmtNum(d.totalCents),
        fmtNum(d.cashCents),
        fmtNum(d.cardCents),
        fmtNum(d.qrCents),
        d.orderCount,
        fmtNum(net),
        fmtNum(d.totalCents - net),
      ].join(";")
    );
  }
  return "﻿" + rows.join("\n");
}

function datevRevenueAccount(vatRate: number): string {
  if (vatRate === 0) return "8200";
  if (vatRate === 7) return "8300";
  if (vatRate === 19) return "8400";
  return "8400";
}

function buildDatevCsv(days: DailySummary[], year: number, vatRate: number): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const dateFrom = `${year}0101`;
  const dateTo = `${year}1231`;

  // DATEV Buchungsstapel v4 header (28 semicolon-separated fields)
  const meta = [
    '"EXTF"', "700", "21", '"Buchungsstapel"', "4",
    ts, "", '""', '""', '""', "", "1",
    dateFrom, "4", dateFrom, dateTo,
    '"PrimaQ POS"', '""', "1", "0", "0",
    '"EUR"', '""', '""', '""', '""', '""', '""',
  ].join(";");

  const fieldHeader = [
    "Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz",
    "Kurs", "Basis-Umsatz", "WKZ Basis-Umsatz", "Konto",
    "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum",
    "Belegfeld 1", "Buchungstext",
  ].join(";");

  const rows: string[] = [];

  for (const d of days) {
    const belegdatum = d.date.slice(8, 10) + d.date.slice(5, 7); // DDMM
    const ref = `POS-${d.date.replace(/-/g, "")}`;
    const revenueAccount = datevRevenueAccount(effectiveVatRate(d, vatRate));

    const addRow = (cents: number, konto: string, text: string) => {
      if (cents <= 0) return;
      const amount = (cents / 100).toFixed(2).replace(".", ",");
      rows.push(
        [amount, "S", "EUR", "", "", "", konto, revenueAccount, "", belegdatum, ref, `"${text}"`].join(";")
      );
    };

    addRow(d.cashCents, "1000", `Bareinnahmen ${d.date}`);
    addRow(d.cardCents, "1200", `Karteneinnahmen ${d.date}`);
    addRow(d.qrCents, "1200", `QR-Einnahmen ${d.date}`);
  }

  return [meta, fieldHeader, ...rows].join("\n");
}

async function downloadXlsx(
  days: DailySummary[],
  year: number,
  monthly: MonthRow[],
  articles: ArticleRow[],
  vatRate: number,
) {
  const XLSX = await import("xlsx");
  const vatLabel = `${vatRate} %`;

  const wb = XLSX.utils.book_new();

  // Sheet 1: Monthly overview
  const monthData = [
    ["Monat", "Umsatz brutto (€)", "Bar (€)", "Karte (€)", "QR (€)", "Bestellungen", `Netto ${vatLabel} (€)`, `MwSt ${vatLabel} (€)`],
    ...monthly.map((m) => [
      m.label,
      m.totalCents / 100,
      m.cashCents / 100,
      m.cardCents / 100,
      m.qrCents / 100,
      m.orderCount,
      m.netCents / 100,
      m.vatCents / 100,
    ]),
  ];
  const wsMonthly = XLSX.utils.aoa_to_sheet(monthData);
  XLSX.utils.book_append_sheet(wb, wsMonthly, "Monatsuebersicht");

  // Sheet 2: Article statistics
  const totalRevenue = articles.reduce((s, a) => s + a.revenueCents, 0);
  const articleData = [
    ["Artikel", "Menge", "Umsatz (€)", "Anteil %"],
    ...articles.map((a) => [
      a.name,
      a.qty,
      a.revenueCents / 100,
      totalRevenue > 0 ? +((a.revenueCents / totalRevenue) * 100).toFixed(2) : 0,
    ]),
  ];
  const wsArticles = XLSX.utils.aoa_to_sheet(articleData);
  XLSX.utils.book_append_sheet(wb, wsArticles, "Artikel-Statistik");

  // Sheet 3: All days
  const dayData = [
    ["Datum", "Einsatz / Veranstaltung", "Umsatz brutto (€)", "Bar (€)", "Karte (€)", "QR (€)", "Bestellungen", `Netto ${vatLabel} (€)`, `MwSt ${vatLabel} (€)`],
    ...days.map((d) => {
      const net = calcNetForDay(d, vatRate);
      return [
        d.date,
        d.eventName ?? "",
        d.totalCents / 100,
        d.cashCents / 100,
        d.cardCents / 100,
        d.qrCents / 100,
        d.orderCount,
        net / 100,
        (d.totalCents - net) / 100,
      ];
    }),
  ];
  const wsDays = XLSX.utils.aoa_to_sheet(dayData);
  XLSX.utils.book_append_sheet(wb, wsDays, "Tagesuebersicht");

  XLSX.writeFile(wb, `primaq-jahresabschluss-${year}.xlsx`);
}

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, accent, testId }: { label: string; value: string; accent?: boolean; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className={
        accent
          ? "rounded-2xl bg-primaq-500 p-5 text-white shadow"
          : "rounded-2xl bg-white p-5 shadow"
      }
    >
      <p className={`text-xs font-bold uppercase tracking-widest ${accent ? "text-white/70" : "text-black/40"}`}>
        {label}
      </p>
      <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
    </div>
  );
}

function PaymentBar({ label, cents, total }: { label: string; cents: number; total: number }) {
  const share = total > 0 ? cents / total : 0;
  return (
    <div className="rounded-2xl bg-white p-5 shadow">
      <p className="text-xs font-bold uppercase tracking-widest text-black/40">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-ink">{fmt(cents)}</p>
      <div className="mt-3 h-2 rounded-full bg-black/10">
        <div
          className="h-2 rounded-full bg-primaq-500 transition-all"
          style={{ width: `${(share * 100).toFixed(1)}%` }}
        />
      </div>
      <p className="mt-1 text-right text-xs font-semibold text-black/40">{pct(cents, total)}</p>
    </div>
  );
}

// ── Event plan calendar ───────────────────────────────────────────────────────

const DAYS_HEADER = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

type EventDraft = {
  eventId: string | null; // null while creating a brand-new event
  eventName: string;
  startDate: string;
  endDate: string;
  location: string;
};

function EventPlanTab() {
  const { events, createEvent, updateEvent, removeEvent } = useEventPlanStore();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth()); // 0-11
  const [draft, setDraft] = useState<EventDraft | null>(null);

  // Events that overlap the currently displayed year at all (for the list below).
  const yearEvents = useMemo(
    () => events.filter((e) => e.startDate.slice(0, 4) === String(calYear) || e.endDate.slice(0, 4) === String(calYear)),
    [events, calYear]
  );

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const startOffset = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array<null>(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function prevMonth() {
    if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); }
    else setCalMonth((m) => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); }
    else setCalMonth((m) => m + 1);
  }

  function eventForDate(dateStr: string): PlannedEvent | undefined {
    return events.find((e) => isDateWithinEvent(e, dateStr));
  }

  function openDay(dayNum: number) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    const existing = eventForDate(dateStr);
    if (existing) {
      setDraft({
        eventId: existing.eventId,
        eventName: existing.eventName,
        startDate: existing.startDate,
        endDate: existing.endDate,
        location: existing.location ?? "",
      });
    } else {
      setDraft({ eventId: null, eventName: "", startDate: dateStr, endDate: dateStr, location: "" });
    }
  }

  function openEditFromList(event: PlannedEvent) {
    setCalYear(parseInt(event.startDate.slice(0, 4)));
    setCalMonth(parseInt(event.startDate.slice(5, 7)) - 1);
    setDraft({
      eventId: event.eventId,
      eventName: event.eventName,
      startDate: event.startDate,
      endDate: event.endDate,
      location: event.location ?? "",
    });
  }

  function closeDraft() {
    setDraft(null);
  }

  function handleSave() {
    if (!draft || !draft.eventName.trim()) return;
    const startDate = draft.startDate;
    // Never allow endDate < startDate — clamp instead of rejecting the save.
    const endDate = draft.endDate < startDate ? startDate : draft.endDate;
    const location = draft.location.trim() || undefined;
    if (draft.eventId) {
      updateEvent(draft.eventId, { eventName: draft.eventName.trim(), startDate, endDate, location });
    } else {
      createEvent({ eventName: draft.eventName.trim(), startDate, endDate, location });
    }
    closeDraft();
  }

  function handleDelete() {
    if (!draft?.eventId) return;
    removeEvent(draft.eventId);
    closeDraft();
  }

  return (
    <div className="space-y-6">
      {/* Month navigator */}
      <div className="flex items-center gap-3">
        <button
          data-testid="plan-prev-month"
          onClick={prevMonth}
          className="grid h-9 w-9 place-items-center rounded-xl border border-black/10 bg-white shadow hover:bg-black/5 transition-colors"
          aria-label="Vorheriger Monat"
        >
          <ChevronLeft className="h-4 w-4 text-black/50" />
        </button>
        <div className="flex-1 text-center">
          <p data-testid="plan-month-label" className="text-lg font-black text-ink">
            {MONTHS[calMonth]} {calYear}
          </p>
        </div>
        <button
          data-testid="plan-next-month"
          onClick={nextMonth}
          className="grid h-9 w-9 place-items-center rounded-xl border border-black/10 bg-white shadow hover:bg-black/5 transition-colors"
          aria-label="Nächster Monat"
        >
          <ChevronRight className="h-4 w-4 text-black/50" />
        </button>
      </div>

      {/* Calendar grid — multi-day events render as a connected bar across the
          week row(s) they span, not just isolated dots per day. */}
      <div className="rounded-2xl bg-white shadow overflow-hidden">
        <div className="grid grid-cols-7 border-b border-black/5">
          {DAYS_HEADER.map((d) => (
            <div
              key={d}
              className="py-2.5 text-center text-[11px] font-bold uppercase tracking-widest text-black/40"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((dayNum, i) => {
            if (dayNum === null) {
              return <div key={i} className="aspect-square" />;
            }
            const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
            const event = eventForDate(dateStr);
            const isToday = dateStr === todayStr;
            const isEditing = draft?.startDate === dateStr && !draft.eventId;
            const isEditingExisting = draft?.eventId && event?.eventId === draft.eventId;
            const col = i % 7;
            const isRowStart = col === 0 || dateStr === event?.startDate;
            const isRowEnd = col === 6 || dateStr === event?.endDate;
            return (
              <button
                key={i}
                data-testid={`cal-day-${dateStr}`}
                onClick={() => openDay(dayNum)}
                className={`relative flex flex-col items-center gap-0.5 py-2.5 transition-colors hover:bg-black/5 ${
                  isEditing || isEditingExisting ? "ring-2 ring-inset ring-primaq-400" : ""
                }`}
              >
                {event && (
                  <span
                    aria-hidden
                    className={`absolute inset-y-1 left-0 right-0 -z-10 bg-primaq-100 ${
                      isRowStart ? "rounded-l-lg" : ""
                    } ${isRowEnd ? "rounded-r-lg" : ""}`}
                  />
                )}
                <span
                  className={`text-sm font-semibold leading-none ${
                    isToday
                      ? "flex h-7 w-7 items-center justify-center rounded-full bg-primaq-500 text-white"
                      : event
                        ? "text-primaq-700"
                        : "text-ink"
                  }`}
                >
                  {dayNum}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Edit / Add form */}
      {draft && (
        <div
          data-testid="event-plan-form"
          className="rounded-2xl border border-primaq-200 bg-primaq-50 p-4 space-y-3"
        >
          <p className="text-[11px] font-bold uppercase tracking-widest text-primaq-700/60">
            {draft.startDate === draft.endDate ? draft.startDate : `${draft.startDate} – ${draft.endDate}`}
            {" · "}
            {draft.eventId ? "Einsatz bearbeiten" : "Neuer Einsatz"}
          </p>
          <input
            data-testid="event-plan-name-input"
            type="text"
            value={draft.eventName}
            onChange={(e) => setDraft({ ...draft, eventName: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") closeDraft();
            }}
            placeholder="Name des Einsatzes"
            autoFocus
            className="w-full rounded-xl border border-primaq-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink placeholder-black/25 focus:border-primaq-500 focus:outline-none focus:ring-2 focus:ring-primaq-500/20"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-bold text-black/50">Startdatum</span>
              <input
                data-testid="event-plan-start-input"
                type="date"
                value={draft.startDate}
                onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                className="mt-1 w-full rounded-xl border border-primaq-200 bg-white px-3 py-2 text-sm font-semibold text-ink focus:border-primaq-500 focus:outline-none focus:ring-2 focus:ring-primaq-500/20"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-black/50">Enddatum</span>
              <input
                data-testid="event-plan-end-input"
                type="date"
                value={draft.endDate}
                min={draft.startDate}
                onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                className="mt-1 w-full rounded-xl border border-primaq-200 bg-white px-3 py-2 text-sm font-semibold text-ink focus:border-primaq-500 focus:outline-none focus:ring-2 focus:ring-primaq-500/20"
              />
            </label>
          </div>
          <input
            data-testid="event-plan-location-input"
            type="text"
            value={draft.location}
            onChange={(e) => setDraft({ ...draft, location: e.target.value })}
            placeholder="Ort (optional)"
            className="w-full rounded-xl border border-primaq-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink placeholder-black/25 focus:border-primaq-500 focus:outline-none focus:ring-2 focus:ring-primaq-500/20"
          />
          <div className="flex gap-2">
            <button
              data-testid="event-plan-save"
              onClick={handleSave}
              disabled={!draft.eventName.trim()}
              className="rounded-xl bg-primaq-500 px-4 py-2 text-sm font-bold text-white hover:bg-primaq-700 disabled:bg-black/10 disabled:text-black/30 transition-colors"
            >
              Speichern
            </button>
            {draft.eventId && (
              <button
                data-testid="event-plan-delete"
                onClick={handleDelete}
                className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors"
              >
                Löschen
              </button>
            )}
            <button
              onClick={closeDraft}
              className="ml-auto rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-bold text-black/50 hover:bg-black/5 transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Events list */}
      <div className="rounded-2xl bg-white shadow overflow-hidden">
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">
            Geplante Einsätze {calYear}
          </p>
          <span className="text-xs text-black/30">
            {yearEvents.length} {yearEvents.length === 1 ? "Einsatz" : "Einsätze"}
          </span>
        </div>
        {yearEvents.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-black/30">
            Noch keine Einsätze für {calYear} geplant.{" "}
            Wähle einen Tag im Kalender aus.
          </p>
        ) : (
          <div className="divide-y divide-black/5">
            {yearEvents.map((ev) => {
              const totalDays = eventTotalDays(ev);
              return (
                <div
                  key={ev.eventId}
                  data-testid={`event-plan-item-${ev.eventId}`}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  <span className="shrink-0 rounded-lg bg-primaq-50 px-2.5 py-1 text-xs font-black tabular-nums text-primaq-700">
                    {ev.startDate === ev.endDate ? ev.startDate : `${ev.startDate} – ${ev.endDate}`}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-sm font-semibold text-ink">
                    {ev.eventName}
                    {totalDays > 1 && (
                      <span className="ml-1.5 text-xs font-bold text-black/35">({totalDays} Tage)</span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                      ev.status === "running"
                        ? "bg-primaq-100 text-primaq-700"
                        : ev.status === "completed"
                          ? "bg-black/5 text-black/40"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {ev.status === "running" ? "läuft" : ev.status === "completed" ? "beendet" : "geplant"}
                  </span>
                  <button
                    data-testid={`event-plan-edit-${ev.eventId}`}
                    onClick={() => openEditFromList(ev)}
                    className="shrink-0 rounded-lg border border-black/10 bg-white px-3 py-1 text-xs font-bold text-black/50 hover:bg-black/5 transition-colors"
                  >
                    Bearb.
                  </button>
                  <button
                    data-testid={`event-plan-remove-${ev.eventId}`}
                    onClick={() => removeEvent(ev.eventId)}
                    className="shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-bold text-red-500 hover:bg-red-50 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick add button */}
      <button
        data-testid="event-plan-add-btn"
        onClick={() => {
          const prefix = `${calYear}-${String(calMonth + 1).padStart(2, "0")}`;
          const d = todayStr.startsWith(prefix) ? todayStr : `${prefix}-01`;
          const existing = eventForDate(d);
          setDraft(
            existing
              ? {
                  eventId: existing.eventId,
                  eventName: existing.eventName,
                  startDate: existing.startDate,
                  endDate: existing.endDate,
                  location: existing.location ?? "",
                }
              : { eventId: null, eventName: "", startDate: d, endDate: d, location: "" }
          );
        }}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primaq-200 px-5 py-3 text-sm font-bold text-primaq-600 hover:border-primaq-400 hover:bg-primaq-50/50 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Einsatz hinzufügen
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type ResetTarget =
  | { kind: "period" }
  | { kind: "event"; eventId: string | null; eventName: string | null }
  | { kind: "day"; date: string };

export function JahresabschlussClient({ guestAccess }: { guestAccess?: boolean }) {
  const { isAdmin, hydrated: adminHydrated } = useAdmin();
  const { days: history, hydrated, activeEventName, todayOrderCount } = useReportData();
  const { vatRate, hydrated: vatHydrated } = usePosVatStore();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null);
  const [activeTab, setActiveTab] = useState<"uebersicht" | "planung">("uebersicht");

  const years = useMemo(() => {
    const set = new Set(history.map((d) => parseInt(d.date.slice(0, 4))));
    set.add(currentYear);
    return [...set].sort((a, b) => b - a);
  }, [history, currentYear]);

  const days = useMemo(
    () => history.filter((d) => d.date.startsWith(String(selectedYear))),
    [history, selectedYear]
  );
  const historyDaysToDelete = useMemo(() => days.filter((d) => !d.isLive), [days]);
  const hasLiveDay = days.some((d) => d.isLive);
  const eventGroups = useMemo(() => groupDaysByEvent(days, vatRate), [days, vatRate]);

  const monthly = useMemo(() => computeMonthly(days, selectedYear, vatRate), [days, selectedYear, vatRate]);
  const articles = useMemo(() => computeArticles(days), [days]);

  const resetDialogProps = useMemo(() => {
    if (!resetTarget) return null;
    if (resetTarget.kind === "period") {
      return {
        title: `Jahr ${selectedYear} zurücksetzen`,
        scopeLabel: `${selectedYear}`,
        unitLabel: "Jahresdaten",
        strongConfirmWord: "JAHR LÖSCHEN",
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
  }, [resetTarget, selectedYear, historyDaysToDelete, hasLiveDay, eventGroups, days]);

  const totalCents = days.reduce((s, d) => s + d.totalCents, 0);
  const totalOrders = days.reduce((s, d) => s + d.orderCount, 0);
  const cashCents = days.reduce((s, d) => s + d.cashCents, 0);
  const cardCents = days.reduce((s, d) => s + d.cardCents, 0);
  const qrCents = days.reduce((s, d) => s + d.qrCents, 0);
  const netCents = days.reduce((s, d) => s + calcNetForDay(d, vatRate), 0);
  const vatCents = totalCents - netCents;
  const hasData = days.length > 0;

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
            Bitte melden Sie sich als Admin an, um den Jahresabschluss zu sehen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-2xl bg-black/5 p-1">
        {(["uebersicht", "planung"] as const).map((tab) => (
          <button
            key={tab}
            data-testid={`jahresabschluss-tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-colors ${
              activeTab === tab
                ? "bg-white shadow text-ink"
                : "text-black/40 hover:text-black/60"
            }`}
          >
            {tab === "uebersicht" ? "Übersicht" : "Planung"}
          </button>
        ))}
      </div>

      {activeTab === "planung" && <EventPlanTab />}

      {activeTab === "uebersicht" && (
      <>
      {/* ── Year selector ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <p className="text-sm font-bold text-black/40">Jahr</p>
        <div className="relative">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="appearance-none rounded-xl border border-black/10 bg-white py-2 pl-4 pr-10 text-base font-bold text-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-primaq-500"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40" />
        </div>
        {hasData && (
          <span className="text-sm text-black/40">{days.length} Tage</span>
        )}
      </div>

      {!hasData && (
        <div className="rounded-2xl border-2 border-dashed border-black/10 py-16 text-center">
          <p className="text-base font-bold text-black/30">Keine Daten für {selectedYear}</p>
          <p className="mt-1 text-sm text-black/25">
            Tagesdaten werden beim Tagesabschluss automatisch gespeichert.
          </p>
        </div>
      )}

      {hasData && (
        <>
          {/* ── KPIs ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Umsatz brutto" value={fmt(totalCents)} accent testId="kpi-total" />
            <KpiCard label="Netto" value={fmt(netCents)} testId="kpi-net" />
            <KpiCard label={`MwSt ${vatRate} %`} value={fmt(vatCents)} testId="kpi-vat" />
            <KpiCard label="Bestellungen" value={String(totalOrders)} />
          </div>

          {/* ── Payment breakdown ────────────────────────────────────────── */}
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-black/40">
              Zahlungsarten
            </p>
            <div className="grid grid-cols-3 gap-3">
              <PaymentBar label="Bar" cents={cashCents} total={totalCents} />
              <PaymentBar label="Karte" cents={cardCents} total={totalCents} />
              <PaymentBar label="QR" cents={qrCents} total={totalCents} />
            </div>
          </div>

          {/* ── Monthly overview ─────────────────────────────────────────── */}
          <div className="rounded-2xl bg-white shadow overflow-hidden">
            <div className="border-b border-black/5 px-5 py-3">
              <p className="text-xs font-bold uppercase tracking-widest text-black/40">
                Monatsübersicht {selectedYear}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-left">
                    <th className="px-5 py-3 font-bold text-black/40">Monat</th>
                    <th className="px-4 py-3 text-right font-bold text-black/40">Umsatz</th>
                    <th className="px-4 py-3 text-right font-bold text-black/40">Bar</th>
                    <th className="px-4 py-3 text-right font-bold text-black/40">Karte</th>
                    <th className="px-4 py-3 text-right font-bold text-black/40">QR</th>
                    <th className="px-4 py-3 text-right font-bold text-black/40">Bestellungen</th>
                    <th className="px-4 py-3 text-right font-bold text-black/40">Netto</th>
                    <th className="px-4 py-3 text-right font-bold text-black/40">{`MwSt ${vatRate} %`}</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((m) => (
                    <tr
                      key={m.month}
                      className={m.totalCents > 0 ? "border-b border-black/5" : "border-b border-black/5 opacity-30"}
                    >
                      <td className="px-5 py-3 font-semibold text-ink">{m.label}</td>
                      <td className="px-4 py-3 text-right font-bold text-ink tabular-nums">
                        {m.totalCents > 0 ? fmt(m.totalCents) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-black/60">
                        {m.cashCents > 0 ? fmt(m.cashCents) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-black/60">
                        {m.cardCents > 0 ? fmt(m.cardCents) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-black/60">
                        {m.qrCents > 0 ? fmt(m.qrCents) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-black/60">
                        {m.orderCount > 0 ? m.orderCount : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-black/60">
                        {m.netCents > 0 ? fmt(m.netCents) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-black/60">
                        {m.vatCents > 0 ? fmt(m.vatCents) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-black/[0.02] font-bold">
                    <td className="px-5 py-3 font-black text-ink">Gesamt</td>
                    <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(totalCents)}</td>
                    <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(cashCents)}</td>
                    <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(cardCents)}</td>
                    <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(qrCents)}</td>
                    <td className="px-4 py-3 text-right text-ink tabular-nums">{totalOrders}</td>
                    <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(netCents)}</td>
                    <td className="px-4 py-3 text-right text-ink tabular-nums">{fmt(vatCents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ── Grouped-by-Einsatz overview ───────────────────────────────────
              Ebene 1: Einsatz (bzw. "Ohne Einsatz"), Ebene 2: Tage innerhalb
              dieses Einsatzes. Ergänzt die Monatsübersicht (Buchhaltungssicht)
              um die einsatzbezogene Sicht, die für sicheres Löschen einzelner
              Einsätze benötigt wird. */}
          <div className="rounded-2xl bg-white shadow overflow-hidden" data-testid="year-event-table">
            <div className="border-b border-black/5 px-5 py-3">
              <p className="text-xs font-bold uppercase tracking-widest text-black/40">
                Gruppierung nach Einsatz {selectedYear}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-left">
                    <th className="px-5 py-3 font-bold text-black/40">Datum</th>
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
                        data-testid={`year-event-group-${groupKey}`}
                        className="border-b border-black/5 bg-primaq-50/60"
                      >
                        <td className="px-5 py-2.5 font-black text-ink">
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
                              data-testid={`year-delete-event-${groupKey}`}
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
                        <tr key={d.date} data-testid={`year-day-row-${d.date}`} className="border-b border-black/5">
                          <td className="px-5 py-2 pl-8 text-ink tabular-nums">
                            {d.date}
                            {d.eventTotalDays && d.eventTotalDays > 1 && (
                              <span className="ml-1.5 text-[10px] font-bold text-black/35">
                                Tag {d.eventDayIndex} von {d.eventTotalDays}
                              </span>
                            )}
                          </td>
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
                                data-testid={`year-delete-day-${d.date}`}
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
              </table>
            </div>
          </div>

          {/* ── Article statistics ───────────────────────────────────────── */}
          {articles.length > 0 && (
            <div className="rounded-2xl bg-white shadow overflow-hidden">
              <div className="border-b border-black/5 px-5 py-3">
                <p className="text-xs font-bold uppercase tracking-widest text-black/40">
                  Artikel-Statistik {selectedYear}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-black/5 text-left">
                      <th className="px-5 py-3 font-bold text-black/40">Artikel</th>
                      <th className="px-4 py-3 text-right font-bold text-black/40">Menge</th>
                      <th className="px-4 py-3 text-right font-bold text-black/40">Umsatz</th>
                      <th className="px-4 py-3 text-right font-bold text-black/40">Anteil</th>
                    </tr>
                  </thead>
                  <tbody>
                    {articles.map((a) => (
                      <tr key={a.key} className="border-b border-black/5">
                        <td className="px-5 py-3 font-semibold text-ink">{a.name}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-black/60">{a.qty}</td>
                        <td className="px-4 py-3 text-right font-bold text-ink tabular-nums">{fmt(a.revenueCents)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-black/50">{pct(a.revenueCents, totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Export buttons ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => triggerDownload(buildCsv(days, selectedYear, vatRate), `primaq-jahresabschluss-${selectedYear}.csv`, "text/csv")}
          disabled={!hasData}
          className="flex items-center gap-2 rounded-xl bg-primaq-500 px-5 py-3 font-bold text-white shadow hover:bg-primaq-700 disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30 transition-colors"
        >
          <Download className="h-4 w-4" />
          CSV exportieren
        </button>

        <button
          onClick={() => triggerDownload(buildDatevCsv(days, selectedYear, vatRate), `primaq-datev-${selectedYear}.csv`, "text/csv")}
          disabled={!hasData}
          className="flex items-center gap-2 rounded-xl border border-black/15 bg-white px-5 py-3 font-bold text-black/70 shadow hover:bg-black/5 disabled:cursor-not-allowed disabled:text-black/30 transition-colors"
        >
          <Download className="h-4 w-4" />
          DATEV exportieren
        </button>

        <button
          onClick={() => downloadXlsx(days, selectedYear, monthly, articles, vatRate)}
          disabled={!hasData}
          className="flex items-center gap-2 rounded-xl border border-black/15 bg-white px-5 py-3 font-bold text-black/70 shadow hover:bg-black/5 disabled:cursor-not-allowed disabled:text-black/30 transition-colors"
        >
          <FileSpreadsheet className="h-4 w-4" />
          Excel exportieren
        </button>
      </div>

      {hasData && (
        <p className="text-xs text-black/30">
          {`Konten im DATEV-Export (SKR03): Kasse 1000, Bank/Karte 1200, Erlöse ${vatRate} % MwSt ${datevRevenueAccount(vatRate)}.`}{" "}
          Bitte mit Ihrem Steuerberater abstimmen.
        </p>
      )}

      {isAdmin && (
        <ReportEventDebug
          visibleDays={days}
          activeEventName={activeEventName}
          todayOrderCount={todayOrderCount}
          rangeLabel={`${selectedYear}`}
        />
      )}

      {/* ── Jahresdaten zurücksetzen ─────────────────────────────────────────── */}
      {isAdmin && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-red-700/60">
            Jahresdaten zurücksetzen
          </p>
          <p className="mb-4 text-sm text-red-800/70">
            Alle Abschlüsse für <strong>{selectedYear}</strong> löschen. Andere Jahre und Einstellungen bleiben erhalten.
          </p>
          <button
            data-testid="reset-year-btn"
            onClick={() => setResetTarget({ kind: "period" })}
            disabled={!hasData}
            className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-red-700 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
            {selectedYear} zurücksetzen
          </button>
        </div>
      )}

      {resetDialogProps && (
        <ReportResetDialog
          open={resetTarget !== null}
          onClose={() => setResetTarget(null)}
          {...resetDialogProps}
        />
      )}
      </>
      )}
    </div>
  );
}
