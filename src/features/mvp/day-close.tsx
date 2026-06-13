"use client";

import { Download, FileJson, Save } from "lucide-react";
import { useState } from "react";
import { formatCurrency, fromCentsInput, toCents, withoutMachinePrefix } from "./calculations";
import { products, salesAreaLabels } from "./catalog";
import { TotalsSummary } from "./totals-summary";
import type { DayReport, InventoryReport, MaterialCostReport, MvpTotals, Shift, TaxReport } from "./types";

type DayCloseProps = {
  activeShift: Shift | null;
  totals: MvpTotals;
  inventoryReport: InventoryReport;
  taxReport: TaxReport;
  materialCostReport: MaterialCostReport;
  dayReport: DayReport | null;
  onCreateReport: (endCashCents: number) => DayReport | null;
};

export function DayClose({ activeShift, totals, taxReport, materialCostReport, dayReport, onCreateReport }: DayCloseProps) {
  const [endCash, setEndCash] = useState("");
  const [endCashError, setEndCashError] = useState(false);

  const report = dayReport;

  function createReport() {
    if (endCash.trim() === "") {
      setEndCashError(true);
      return;
    }

    setEndCashError(false);
    onCreateReport(toCents(endCash));
  }

  function exportJson() {
    if (!report) {
      return;
    }

    downloadFile(
      `primaq-tagesbericht-${report.shift.date}.json`,
      JSON.stringify(report, null, 2),
      "application/json"
    );
  }

  function exportCsv() {
    if (!report) {
      return;
    }

    downloadFile(`primaq-tagesbericht-${report.shift.date}.csv`, toCsv(report), "text/csv;charset=utf-8");
  }

  return (
    <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-ink">Tagesbericht erstellen</h2>
      <p className="mt-1 text-sm leading-5 text-black/62">Keine TSE- oder Kassenfunktion. Der Bericht ist ein operativer Tagesexport fuer die spaetere Weiterverarbeitung.</p>

      {!activeShift ? (
        <p className="mt-4 rounded-lg bg-yellow-50 p-3 text-sm font-medium text-yellow-800">
          Bitte zuerst einen Einsatz starten.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-2 text-sm font-semibold text-black/72">
              Endgeld (Pflichtfeld)
              <input
                inputMode="decimal"
                data-testid="day-close-end-cash-input"
                value={endCash}
                onChange={(event) => {
                  setEndCash(event.target.value);
                  if (endCashError) {
                    setEndCashError(false);
                  }
                }}
                placeholder={fromCentsInput(activeShift.startingCashCents + totals.cashCents)}
                aria-invalid={endCashError}
                className={`min-h-12 rounded-lg border bg-white px-3 text-base outline-none focus:border-primaq-500 ${endCashError ? "border-red-500" : "border-black/15"}`}
              />
              {endCashError ? (
                <p data-testid="day-close-end-cash-error" className="text-sm font-semibold text-red-700">
                  Bitte das ausgezählte Endgeld eintragen. Ohne diese Angabe kann die Kassendifferenz nicht berechnet werden.
                </p>
              ) : null}
            </label>

            <button
              type="button"
              data-testid="day-close-create-report-button"
              onClick={createReport}
              className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-primaq-500 px-4 text-base font-bold text-white"
            >
              <Save className="h-5 w-5" /> Tagesbericht erstellen
            </button>
          </div>

          <div className="mt-4">
            <TotalsSummary totals={totals} startingCashCents={activeShift.startingCashCents} endCashCents={report?.endCashCents} />
          </div>

          <div className="mt-4">
            <TaxCloseSummary report={report?.taxReport ?? taxReport} />
          </div>

          {(report?.materialCostReport ?? materialCostReport).lines.length > 0 ? (
            <div className="mt-4">
              <MaterialCostCloseSummary report={report?.materialCostReport ?? materialCostReport} />
            </div>
          ) : null}

          {report ? (
            <div className="mt-4 grid gap-4">
              <ReportPreview report={report} />
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={exportJson}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-4 text-sm font-bold text-ink"
                >
                  <FileJson className="h-5 w-5" /> Bericht als JSON exportieren
                </button>
                <button
                  type="button"
                  onClick={exportCsv}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-4 text-sm font-bold text-ink"
                >
                  <Download className="h-5 w-5" /> Bericht als CSV exportieren
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function TaxCloseSummary({ report }: { report: TaxReport }) {
  return (
    <section className="grid gap-3 rounded-lg border border-black/10 bg-[#fbfcf8] p-4 sm:grid-cols-2 xl:grid-cols-5">
      <Metric testId="tax-gross" label="Bruttoumsatz" value={formatCurrency(report.grossCents)} />
      <Metric label="Umsatz Softeis" value={formatCurrency(report.softServeGrossCents)} />
      <Metric label="Umsatz Toppings" value={formatCurrency(report.toppingGrossCents)} />
      <Metric testId="tax-net" label="Nettoumsatz" value={formatCurrency(report.netCents)} />
      <Metric testId="tax-vat" label="MwSt-Betrag" value={formatCurrency(report.vatCents)} />
      <Metric testId="tax-vat-7" label="MwSt 7 %" value={formatCurrency(report.vat7Cents)} />
      <Metric label="MwSt 19 %" value={formatCurrency(report.vat19Cents)} />
    </section>
  );
}

function Metric({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div data-testid={testId} className="rounded-lg bg-white p-3">
      <p className="text-xs font-semibold uppercase text-black/45">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink">{value}</p>
    </div>
  );
}

function ReportPreview({ report }: { report: DayReport }) {
  return (
    <div data-testid="day-report-preview" className="rounded-lg bg-[#fbfcf8] p-4 text-sm text-black/72">
      <h3 className="font-bold text-ink">Bericht</h3>
      <div className="mt-3 grid gap-2">
        <p>Standort/Event: {report.shift.eventName}</p>
        <p>Verkaufsbereich: {salesAreaLabels[report.shift.salesArea]}</p>
        <p>Mitarbeiter: {report.shift.employees.length ? report.shift.employees.join(", ") : "nicht eingetragen"}</p>
        <p>Umsatz gesamt: {formatCurrency(report.totals.expectedRevenueCents)}</p>
        <p>Umsatz Softeis: {formatCurrency(report.totals.softServeRevenueCents)}</p>
        <p>Umsatz Toppings: {formatCurrency(report.totals.toppingRevenueCents)}</p>
        <p>Geschaetzter Wareneinsatz (Softeis): {formatCurrency(report.inventoryReport.estimatedCostCents)}</p>
        {report.materialCostReport && report.materialCostReport.lines.length > 0 ? (
          <p>Materialkosten (Verpackung): {formatCurrency(report.materialCostReport.totalCostCents)}</p>
        ) : null}
        <p>Kassendifferenz: {formatCurrency(report.cashDifferenceCents)}</p>
      </div>
      {report.totals.toppingTotals.length ? (
        <div className="mt-3 grid gap-2">
          {report.totals.toppingTotals.map((topping) => (
            <p key={topping.name} className="rounded bg-white p-2">
              {withoutMachinePrefix(topping.name)}: {topping.count} Stk. · {formatCurrency(topping.revenueCents)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MaterialCostCloseSummary({ report }: { report: MaterialCostReport }) {
  return (
    <section className="rounded-lg border border-black/10 bg-[#fbfcf8] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-ink">Verpackung &amp; Material</h3>
          <p className="mt-1 text-sm text-black/62">
            Materialkosten basierend auf zugewiesenen und nicht zurückgegebenen Mengen × Einkaufspreis.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase text-black/45">Materialkosten</p>
          <p className="text-lg font-bold text-ink">{formatCurrency(report.totalCostCents)}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {report.lines.map((line) => {
          const deductedQty = line.assignedQty - line.returnedQty;
          return (
            <div key={line.itemId} className="rounded-lg bg-white p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-ink">{line.itemName}</p>
                  <p className="mt-1 text-xs text-black/55">
                    Zugewiesen: {formatQuantity(line.assignedQty, line.unit)}
                    {" · "}Zurück: {formatQuantity(line.returnedQty, line.unit)}
                    {line.lossQty > 0 ? ` · Verlust: ${formatQuantity(line.lossQty, line.unit)}` : ""}
                    {" · "}Verbraucht: {formatQuantity(deductedQty, line.unit)}
                    {line.purchasePriceCents ? ` · ${formatCurrency(line.purchasePriceCents)}/${line.unit}` : ""}
                  </p>
                </div>
                <p className="shrink-0 font-bold text-ink">
                  {line.costCents != null ? formatCurrency(line.costCents) : "—"}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {report.lines.some((l) => l.purchasePriceCents == null) ? (
        <p className="mt-3 rounded-lg bg-yellow-50 p-3 text-xs font-semibold text-yellow-800">
          Für einige Artikel ist kein Einkaufspreis hinterlegt — diese werden mit 0 € berechnet.
        </p>
      ) : null}
    </section>
  );
}

function formatQuantity(qty: number, unit: string) {
  const rounded = Math.round(qty * 100) / 100;
  return `${rounded} ${unit}`;
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

function toCsv(report: DayReport) {
  const rows = [
    ["Feld", "Wert"],
    ["Datum", report.shift.date],
    ["Standort/Event", report.shift.eventName],
    ["Verkaufsbereich", salesAreaLabels[report.shift.salesArea]],
    ["Mitarbeiter", report.shift.employees.join(" | ")],
    ["Startgeld", formatCurrency(report.shift.startingCashCents)],
    ["Endgeld", formatCurrency(report.endCashCents)],
    ["Umsatz gesamt", formatCurrency(report.totals.expectedRevenueCents)],
    ["Umsatz Softeis", formatCurrency(report.totals.softServeRevenueCents)],
    ["Umsatz Toppings", formatCurrency(report.totals.toppingRevenueCents)],
    ["Bar", formatCurrency(report.totals.cashCents)],
    ["Karte", formatCurrency(report.totals.cardCents)],
    ["Gratis", formatCurrency(report.totals.freeCents)],
    ["Storno", formatCurrency(report.totals.cancelCents)],
    ["Kassendifferenz", formatCurrency(report.cashDifferenceCents)],
    ["Bruttoumsatz", formatCurrency(report.taxReport.grossCents)],
    ["Nettoumsatz", formatCurrency(report.taxReport.netCents)],
    ["MwSt-Betrag", formatCurrency(report.taxReport.vatCents)],
    ["MwSt 7 %", formatCurrency(report.taxReport.vat7Cents)],
    ["MwSt 19 %", formatCurrency(report.taxReport.vat19Cents)],
    ["Geschaetzter Wareneinsatz (Softeis)", formatCurrency(report.inventoryReport.estimatedCostCents)],
    ["Materialkosten (Verpackung)", formatCurrency(report.materialCostReport?.totalCostCents ?? 0)],
    ...report.totals.toppingTotals.flatMap((topping) => [
      [`Topping ${withoutMachinePrefix(topping.name)} Stueck`, String(topping.count)],
      [`Topping ${withoutMachinePrefix(topping.name)} Umsatz`, formatCurrency(topping.revenueCents)]
    ]),
    ...products.map((product) => [
      `Stueckzahl ${product.name}`,
      String(report.totals.productTotals[product.id]?.count ?? 0)
    ]),
    ...report.inventoryReport.mixLines.flatMap((line) => [
      [`Softeis ${line.name} Startbestand`, `${line.startLiters} L`],
      [`Softeis ${line.name} Nachgefüllt`, `${line.refilledLiters} L`],
      [`Softeis ${line.name} Verbrauch`, `${line.consumedLiters} L`],
      [`Softeis ${line.name} Restbestand`, `${line.remainingLiters} L`],
      [`Softeis ${line.name} Status`, line.status]
    ]),
    ...(report.materialCostReport?.lines ?? []).flatMap((line) => [
      [`Material ${line.itemName} Zugewiesen`, `${line.assignedQty} ${line.unit}`],
      [`Material ${line.itemName} Zurueck`, `${line.returnedQty} ${line.unit}`],
      [`Material ${line.itemName} Verlust`, `${line.lossQty} ${line.unit}`],
      [`Material ${line.itemName} Kosten`, formatCurrency(line.costCents ?? 0)]
    ])
  ];

  return rows.map((row) => row.map((cell) => `"${cell.replaceAll("\"", "\"\"")}"`).join(";")).join("\n");
}
