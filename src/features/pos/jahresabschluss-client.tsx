"use client";

import { useCallback, useState, useMemo } from "react";
import { ChevronDown, Download, FileSpreadsheet, Lock, Trash2 } from "lucide-react";
import { useAdmin } from "./admin-context";
import { usePosYearStore } from "./use-pos-year-store";
import { ResetTestDataDialog } from "./reset-test-data-dialog";
import { getFlavorName, getItemSizeName } from "./pos-config";
import { usePosVatStore, calcNet } from "./use-pos-vat-store";
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
    const net = calcNet(total, vatRate);
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
    `Datum;Umsatz brutto (€);Bar (€);Karte (€);QR (€);Bestellungen;Netto ${vatLabel} (€);MwSt ${vatLabel} (€)`,
  ];
  for (const d of days) {
    const net = calcNet(d.totalCents, vatRate);
    rows.push(
      [
        d.date,
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

  const revenueAccount = datevRevenueAccount(vatRate);
  const rows: string[] = [];

  for (const d of days) {
    const belegdatum = d.date.slice(8, 10) + d.date.slice(5, 7); // DDMM
    const ref = `POS-${d.date.replace(/-/g, "")}`;

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
    ["Datum", "Umsatz brutto (€)", "Bar (€)", "Karte (€)", "QR (€)", "Bestellungen", `Netto ${vatLabel} (€)`, `MwSt ${vatLabel} (€)`],
    ...days.map((d) => {
      const net = calcNet(d.totalCents, vatRate);
      return [
        d.date,
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

// ── Main component ────────────────────────────────────────────────────────────

export function JahresabschlussClient() {
  const { isAdmin, hydrated: adminHydrated } = useAdmin();
  const { history, hydrated } = usePosYearStore();
  const { vatRate, hydrated: vatHydrated } = usePosVatStore();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const handleResetSuccess = useCallback(() => {
    setShowResetDialog(false);
    setResetDone(true);
    setTimeout(() => window.location.reload(), 2500);
  }, []);

  const years = useMemo(() => {
    const set = new Set(history.map((d) => parseInt(d.date.slice(0, 4))));
    set.add(currentYear);
    return [...set].sort((a, b) => b - a);
  }, [history, currentYear]);

  const days = useMemo(
    () => history.filter((d) => d.date.startsWith(String(selectedYear))),
    [history, selectedYear]
  );

  const monthly = useMemo(() => computeMonthly(days, selectedYear, vatRate), [days, selectedYear, vatRate]);
  const articles = useMemo(() => computeArticles(days), [days]);

  const totalCents = days.reduce((s, d) => s + d.totalCents, 0);
  const totalOrders = days.reduce((s, d) => s + d.orderCount, 0);
  const cashCents = days.reduce((s, d) => s + d.cashCents, 0);
  const cardCents = days.reduce((s, d) => s + d.cardCents, 0);
  const qrCents = days.reduce((s, d) => s + d.qrCents, 0);
  const netCents = calcNet(totalCents, vatRate);
  const vatCents = totalCents - netCents;
  const hasData = days.length > 0;

  if (!hydrated || !adminHydrated || !vatHydrated) {
    return <div className="flex h-40 items-center justify-center text-black/40">Laden…</div>;
  }

  if (!isAdmin) {
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
            <KpiCard label="Netto" value={fmt(netCents)} />
            <KpiCard label={`MwSt ${vatRate} %`} value={fmt(vatCents)} />
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

      {/* ── Reset test data ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-red-700/60">
          Testbetrieb
        </p>
        <p className="mb-4 text-sm text-red-800/70">
          Alle Testverkäufe und Statistiken löschen. Sorten, Bilder und Einstellungen bleiben vollständig erhalten.
        </p>
        <button
          data-testid="reset-test-data-btn"
          onClick={() => setShowResetDialog(true)}
          className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-red-700 active:scale-[0.97]"
        >
          <Trash2 className="h-4 w-4" />
          Testdaten zurücksetzen
        </button>
      </div>

      <ResetTestDataDialog
        open={showResetDialog}
        onClose={() => setShowResetDialog(false)}
        onSuccess={handleResetSuccess}
      />

      {resetDone && (
        <div
          data-testid="reset-success-snackbar"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2 rounded-2xl bg-green-600 px-5 py-3 text-sm font-bold text-white shadow-xl"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Alle Testdaten wurden erfolgreich gelöscht.
        </div>
      )}
    </div>
  );
}
