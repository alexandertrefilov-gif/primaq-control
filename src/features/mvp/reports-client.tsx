"use client";

import { Download, FileJson } from "lucide-react";
import { useMemo, useState } from "react";
import { formatCurrency, summarizeReports, withoutMachinePrefix } from "./calculations";
import { products } from "./catalog";
import type { DayReport, ReportSummary } from "./types";
import { useMvpStore } from "./use-mvp-store";

export function ReportsClient() {
  const { hydrated, reports } = useMvpStore();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const sortedReports = useMemo(
    () => [...reports].sort((a, b) => b.shift.date.localeCompare(a.shift.date)),
    [reports]
  );
  const monthReports = useMemo(
    () => sortedReports.filter((report) => report.shift.date.startsWith(month)),
    [month, sortedReports]
  );
  const monthSummary = useMemo(() => summarizeReports(monthReports), [monthReports]);
  const latestReport = sortedReports[0] ?? null;

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm font-semibold leading-6 text-yellow-900">
        Diese Auswertung ist eine vorbereitende Betriebsuebersicht und ersetzt keine zertifizierte Kasse oder Steuerberatung.
      </section>

      <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-ink">Monatsuebersicht</h2>
            <p className="mt-1 text-sm text-black/62">Summen aus gespeicherten Tagesberichten im Browser.</p>
          </div>
          <label className="grid gap-2 text-sm font-semibold text-black/72">
            Monat
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="min-h-12 rounded-lg border border-black/15 bg-white px-3 text-base outline-none focus:border-primaq-500"
            />
          </label>
        </div>

        <SummaryGrid summary={monthSummary} />

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <ExportButton
            label="Monatsbericht als JSON exportieren"
            icon="json"
            disabled={!monthReports.length}
            onClick={() => exportJson(`primaq-monatsbericht-${month}.json`, { month, summary: monthSummary, reports: monthReports })}
          />
          <ExportButton
            label="Monatsbericht als CSV exportieren"
            disabled={!monthReports.length}
            onClick={() => exportCsv(`primaq-monatsbericht-${month}.csv`, taxAdvisorCsv(monthReports))}
          />
        </div>
      </section>

      <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-ink">Tagesberichte</h2>
        <p className="mt-1 text-sm text-black/62">Jeder erstellte Tagesabschluss wird lokal als Berichtshistorie gespeichert.</p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <ExportButton
            label="Tagesbericht als JSON exportieren"
            icon="json"
            disabled={!latestReport}
            onClick={() => latestReport && exportJson(`primaq-tagesbericht-${latestReport.shift.date}.json`, latestReport)}
          />
          <ExportButton
            label="Tagesbericht als CSV exportieren"
            disabled={!latestReport}
            onClick={() => latestReport && exportCsv(`primaq-tagesbericht-${latestReport.shift.date}.csv`, dayReportCsv(latestReport))}
          />
        </div>

        <div className="mt-4 grid gap-3">
          {sortedReports.length ? (
            sortedReports.map((report) => <DayReportCard key={report.id} report={report} />)
          ) : (
            <p className="rounded-lg bg-[#fbfcf8] p-3 text-sm font-medium text-black/65">
              Noch keine Tagesberichte gespeichert. Erstelle zuerst einen Tagesabschluss.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-ink">Steuerberater-Export</h2>
        <p className="mt-1 text-sm text-black/62">Spaltenstruktur fuer die spaetere Weitergabe als Betriebsuebersicht.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[62rem] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-black/50">
                {[
                  "Datum",
                  "Standort",
                  "Umsatz brutto",
                  "Umsatz netto",
                  "MwSt 7 %",
                  "MwSt 19 %",
                  "Bar",
                  "Karte",
                  "Storno",
                  "Gratis",
                  "Kassendifferenz",
                  "Wareneinsatz"
                ].map((header) => (
                  <th key={header} className="border-b border-black/10 px-3 py-2 font-bold">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedReports.map((report) => (
                <tr key={report.id} className="border-b border-black/5">
                  <td className="px-3 py-3">{formatDate(report.shift.date)}</td>
                  <td className="px-3 py-3">{report.shift.eventName}</td>
                  <td className="px-3 py-3">{formatCurrency(report.taxReport.grossCents)}</td>
                  <td className="px-3 py-3">{formatCurrency(report.taxReport.netCents)}</td>
                  <td className="px-3 py-3">{formatCurrency(report.taxReport.vat7Cents)}</td>
                  <td className="px-3 py-3">{formatCurrency(report.taxReport.vat19Cents)}</td>
                  <td className="px-3 py-3">{formatCurrency(report.totals.cashCents)}</td>
                  <td className="px-3 py-3">{formatCurrency(report.totals.cardCents)}</td>
                  <td className="px-3 py-3">{formatCurrency(report.totals.cancelCents)}</td>
                  <td className="px-3 py-3">{formatCurrency(report.totals.freeCents)}</td>
                  <td className="px-3 py-3">{formatCurrency(report.cashDifferenceCents)}</td>
                  <td className="px-3 py-3">{formatCurrency(report.inventoryReport.estimatedCostCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryGrid({ summary }: { summary: ReportSummary }) {
  const metrics = [
    ["Tagesberichte", String(summary.reportCount)],
    ["Umsatz gesamt", formatCurrency(summary.grossCents)],
    ["Umsatz Softeis", formatCurrency(summary.softServeRevenueCents)],
    ["Umsatz Toppings", formatCurrency(summary.toppingRevenueCents)],
    ["Bruttoumsatz", formatCurrency(summary.grossCents)],
    ["Nettoumsatz", formatCurrency(summary.netCents)],
    ["MwSt-Betrag", formatCurrency(summary.vatCents)],
    ["MwSt 7 %", formatCurrency(summary.vat7Cents)],
    ["MwSt 19 %", formatCurrency(summary.vat19Cents)],
    ["Barumsatz", formatCurrency(summary.cashCents)],
    ["Kartenzahlung", formatCurrency(summary.cardCents)],
    ["Gratis-Ausgaben", formatCurrency(summary.freeCents)],
    ["Storno", formatCurrency(summary.cancelCents)],
    ["Kassendifferenz", formatCurrency(summary.cashDifferenceCents)],
    ["Wareneinsatz", formatCurrency(summary.inventoryCostCents)]
  ];

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-[#fbfcf8] p-3">
          <p className="text-xs font-semibold uppercase text-black/45">{label}</p>
          <p className="mt-1 text-xl font-bold text-ink">{value}</p>
        </div>
      ))}
    </div>
  );
}

function DayReportCard({ report }: { report: DayReport }) {
  return (
    <article className="rounded-lg border border-black/10 bg-[#fbfcf8] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-bold text-ink">{formatDate(report.shift.date)} · {report.shift.eventName}</h3>
          <p className="mt-1 text-sm text-black/62">{report.shift.employees.join(", ") || "Keine Mitarbeiter eingetragen"}</p>
        </div>
        <p className="text-xl font-bold text-ink">{formatCurrency(report.taxReport.grossCents)}</p>
      </div>
      <div className="mt-3 grid gap-2 text-sm text-black/70 sm:grid-cols-3">
        <p>Netto: {formatCurrency(report.taxReport.netCents)}</p>
        <p>MwSt: {formatCurrency(report.taxReport.vatCents)}</p>
        <p>Softeis: {formatCurrency(report.totals.softServeRevenueCents)}</p>
        <p>Toppings: {formatCurrency(report.totals.toppingRevenueCents)}</p>
        <p>Wareneinsatz Eis: {formatCurrency(report.inventoryReport.estimatedCostCents)}</p>
        {report.materialCostReport && report.materialCostReport.totalCostCents > 0 ? (
          <p>Materialkosten: {formatCurrency(report.materialCostReport.totalCostCents)}</p>
        ) : null}
        <p>Bar: {formatCurrency(report.totals.cashCents)}</p>
        <p>Karte: {formatCurrency(report.totals.cardCents)}</p>
        <p>Differenz: {formatCurrency(report.cashDifferenceCents)}</p>
      </div>
    </article>
  );
}

function ExportButton({
  label,
  icon,
  disabled,
  onClick
}: {
  label: string;
  icon?: "json";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = icon === "json" ? FileJson : Download;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-14 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-4 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon className="h-5 w-5" /> {label}
    </button>
  );
}

function dayReportCsv(report: DayReport) {
  return rowsToCsv([
    ["Feld", "Wert"],
    ["Datum", report.shift.date],
    ["Standort", report.shift.eventName],
    ["Umsatz brutto", formatCurrency(report.taxReport.grossCents)],
    ["Umsatz Softeis", formatCurrency(report.totals.softServeRevenueCents)],
    ["Umsatz Toppings", formatCurrency(report.totals.toppingRevenueCents)],
    ["Umsatz netto", formatCurrency(report.taxReport.netCents)],
    ["MwSt 7 %", formatCurrency(report.taxReport.vat7Cents)],
    ["MwSt 19 %", formatCurrency(report.taxReport.vat19Cents)],
    ["Bar", formatCurrency(report.totals.cashCents)],
    ["Karte", formatCurrency(report.totals.cardCents)],
    ["Storno", formatCurrency(report.totals.cancelCents)],
    ["Gratis", formatCurrency(report.totals.freeCents)],
    ["Kassendifferenz", formatCurrency(report.cashDifferenceCents)],
    ["Wareneinsatz Eis", formatCurrency(report.inventoryReport.estimatedCostCents)],
    ["Materialkosten Verpackung", formatCurrency(report.materialCostReport?.totalCostCents ?? 0)],
    ...report.totals.toppingTotals.flatMap((topping) => [
      [`Topping ${withoutMachinePrefix(topping.name)} Stueck`, String(topping.count)],
      [`Topping ${withoutMachinePrefix(topping.name)} Umsatz`, formatCurrency(topping.revenueCents)]
    ]),
    ...products.map((product) => [
      `Stueckzahl ${product.name}`,
      String(report.totals.productTotals[product.id]?.count ?? 0)
    ])
  ]);
}

function taxAdvisorCsv(reports: DayReport[]) {
  return rowsToCsv([
    [
      "Datum",
      "Standort",
      "Umsatz brutto",
      "Umsatz netto",
      "MwSt 7 %",
      "MwSt 19 %",
      "Bar",
      "Karte",
      "Storno",
      "Gratis",
      "Kassendifferenz",
      "Wareneinsatz"
    ],
    ...reports.map((report) => [
      report.shift.date,
      report.shift.eventName,
      formatCurrency(report.taxReport.grossCents),
      formatCurrency(report.taxReport.netCents),
      formatCurrency(report.taxReport.vat7Cents),
      formatCurrency(report.taxReport.vat19Cents),
      formatCurrency(report.totals.cashCents),
      formatCurrency(report.totals.cardCents),
      formatCurrency(report.totals.cancelCents),
      formatCurrency(report.totals.freeCents),
      formatCurrency(report.cashDifferenceCents),
      formatCurrency(report.inventoryReport.estimatedCostCents)
    ])
  ]);
}

function rowsToCsv(rows: string[][]) {
  return rows.map((row) => row.map((cell) => `"${cell.replaceAll("\"", "\"\"")}"`).join(";")).join("\n");
}

function exportJson(fileName: string, data: unknown) {
  downloadFile(fileName, JSON.stringify(data, null, 2), "application/json");
}

function exportCsv(fileName: string, content: string) {
  downloadFile(fileName, content, "text/csv;charset=utf-8");
}

function downloadFile(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("de-DE").format(new Date(date));
}
