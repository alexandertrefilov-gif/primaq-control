"use client";

import { Download, FileJson, FileSpreadsheet, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { formatCurrency, formatMachineDisplayName, withoutMachinePrefix } from "./calculations";
import { inventoryDisplayItems, salesAreaLabels } from "./catalog";
import type { CurrentOrderItem, DailyOrder, DayReport, Machine, OrderPaymentMethod, Shift, VatRate } from "./types";
import { useMvpStore } from "./use-mvp-store";

type SheetRow = Record<string, string | number>;
type WorkbookSheets = Record<string, SheetRow[]>;

const missing = "nicht erfasst";
const paymentLabels: Record<OrderPaymentMethod, string> = {
  cash: "Bar",
  card: "Karte",
  qr: "QR"
};

export function YearCloseClient() {
  const {
    hydrated,
    activeShift,
    reports,
    completedOrders,
    currentOrder,
    machines,
    inventory,
    inventoryReport
  } = useMvpStore();
  const availableYears = useMemo(() => buildYears(reports, completedOrders, activeShift?.date), [activeShift?.date, completedOrders, reports]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | OrderPaymentMethod>("all");

  const data = useMemo(
    () => buildYearCloseData({ year, month, eventFilter, paymentFilter, activeShift, reports, completedOrders, currentOrder, machines, inventory, inventoryReport }),
    [activeShift, completedOrders, currentOrder, eventFilter, inventory, inventoryReport, machines, month, paymentFilter, reports, year]
  );

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm font-semibold leading-6 text-yellow-900">
        Diese Auswertung dient der Vorbereitung für den Steuerberater. Steuerliche Prüfung, GoBD, TSE und DATEV-Anforderungen müssen durch Steuerberater/Kassenanbieter bestätigt werden.
      </section>

      <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-lg font-bold text-ink">Jahresabschluss</h2>
            <p className="mt-1 text-sm text-black/62">Steuerberater-Modus mit Jahresdaten aus lokal gespeicherten Einsätzen, Tagesberichten, Verkäufen und Lagerdaten.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Select label="Jahr" value={year} onChange={setYear} options={availableYears.map((item) => [item, item])} />
            <Select label="Monat" value={month} onChange={setMonth} options={[["all", "Alle"], ...Array.from({ length: 12 }, (_, index) => {
              const value = String(index + 1).padStart(2, "0");
              return [value, value] as [string, string];
            })]} />
            <Select label="Einsatz" value={eventFilter} onChange={setEventFilter} options={[["all", "Alle"], ...data.eventOptions.map((item) => [item, item] as [string, string])]} />
            <Select label="Zahlungsart" value={paymentFilter} onChange={(value) => setPaymentFilter(value as "all" | OrderPaymentMethod)} options={[["all", "Alle"], ["cash", "Bar"], ["card", "Karte"]]} />
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <ExportButton label="Jahresabschluss Excel exportieren" icon="xlsx" onClick={() => exportWorkbook(`PrimaQ_Jahresabschluss_${year}.xlsx`, data.sheets)} />
          <ExportButton label="Jahresabschluss CSV exportieren" onClick={() => exportCsv(`PrimaQ_Jahresabschluss_${year}.csv`, data.sheets)} />
          <ExportButton label="Jahresabschluss JSON exportieren" icon="json" onClick={() => exportJson(`PrimaQ_Jahresabschluss_${year}.json`, data.sheets)} />
          <ExportButton label="Monatsübersicht Excel exportieren" icon="xlsx" onClick={() => exportWorkbook(`PrimaQ_Monatsuebersicht_${year}.xlsx`, { Übersicht: data.sheets.Übersicht, MwSt: data.sheets["MwSt-Auswertung"] })} />
          <ExportButton label="Einsatzberichte gesammelt exportieren" onClick={() => exportCsv(`PrimaQ_Einsatzberichte_${year}.csv`, { Einsätze: data.sheets.Einsätze })} />
          <ExportButton label="Jahresabschluss PDF exportieren" icon="pdf" onClick={() => exportPdf(year)} />
        </div>
      </section>

      <SummaryGrid rows={data.sheets.Übersicht} />
      <DataTable title="Einsätze" rows={data.sheets.Einsätze} />
      <DataTable title="Bestellungen / Verkäufe" rows={data.sheets.Verkäufe} />
      <DataTable title="Warenbestand" rows={data.sheets.Warenbestand} />
      <DataTable title="Rechnungen / Ausgaben" rows={data.sheets.Rechnungen} />
    </div>
  );
}

function buildYearCloseData({
  year,
  month,
  eventFilter,
  paymentFilter,
  activeShift,
  reports,
  completedOrders,
  currentOrder,
  machines,
  inventory,
  inventoryReport
}: {
  year: string;
  month: string;
  eventFilter: string;
  paymentFilter: "all" | OrderPaymentMethod;
  activeShift: ReturnType<typeof useMvpStore>["activeShift"];
  reports: DayReport[];
  completedOrders: DailyOrder[];
  currentOrder: ReturnType<typeof useMvpStore>["currentOrder"];
  machines: Machine[];
  inventory: ReturnType<typeof useMvpStore>["inventory"];
  inventoryReport: ReturnType<typeof useMvpStore>["inventoryReport"];
}) {
  const yearReports = reports.filter((report) => dateMatches(report.shift.date, year, month));
  const eventOptions = Array.from(
    new Set([
      ...yearReports.map((report) => report.shift.eventName).filter(Boolean),
      ...(activeShift && dateMatches(activeShift.date, year, month) ? [activeShift.eventName] : [])
    ])
  );
  const filteredReports = eventFilter === "all" ? yearReports : yearReports.filter((report) => report.shift.eventName === eventFilter);
  const activeShiftInYear = activeShift && dateMatches(activeShift.date, year, month) && (eventFilter === "all" || activeShift.eventName === eventFilter);
  const activeMachines = machines.filter((machine) => machine.active !== false).map((machine) => formatMachineDisplayName(machine.name, machine.number)).join(", ") || missing;
  const shiftLookup = new Map<string, Shift>(reports.map((report) => [report.shift.id, report.shift]));
  if (activeShift) {
    shiftLookup.set(activeShift.id, activeShift);
  }
  const completedSaleRows: SheetRow[] = completedOrders.flatMap((order) => {
    const shift = shiftLookup.get(order.shiftId);

    if (!shift || !dateMatches(shift.date, year, month)) {
      return [];
    }

    if (eventFilter !== "all" && shift.eventName !== eventFilter) {
      return [];
    }

    return orderToSaleRows(order, shift, machines, paymentFilter, order.status === "correction" ? "storno" : "abgeschlossen");
  });
  const openOrderRows: SheetRow[] = activeShiftInYear
    ? currentOrder.items
        .map((item) =>
          itemToSaleRow(item, {
            date: new Date().toISOString(),
            shiftId: activeShift.id,
            paymentMethod: currentOrder.paymentMethod,
            status: "offen"
          })
        )
        .filter((row) => paymentFilter === "all" || row.Zahlungsart === paymentLabels[paymentFilter])
    : [];
  const orderRows = [...completedSaleRows, ...openOrderRows];
  const summary = summarizeYear(filteredReports, completedSaleRows);
  const packagingInventoryRows = inventoryDisplayItems.map((item) => {
    const line = inventory[item.id] ?? { purchasePriceCents: null, endQuantity: null, startQuantity: null, unit: item.unit };
    const reportLine = inventoryReport.lines.find((entry) => entry.itemId === item.id);
    const purchasePrice = line.purchasePriceCents ?? 0;
    const endQuantity = line.endQuantity ?? 0;

    return {
      Artikel: item.name,
      Anfangsbestand: line.startQuantity ?? missing,
      Wareneingang: missing,
      Warenausgang: missing,
      Verbrauch: reportLine?.actualQuantity ?? reportLine?.expectedQuantity ?? missing,
      Endbestand: line.endQuantity ?? missing,
      Einheit: line.unit,
      Einkaufspreis: line.purchasePriceCents === null ? missing : money(line.purchasePriceCents),
      Warenwert: line.purchasePriceCents === null || line.endQuantity === null ? missing : money(Math.round(endQuantity * purchasePrice))
    };
  });
  const softServeInventoryRows = inventoryReport.mixLines.map((line) => ({
    Artikel: line.name,
    Anfangsbestand: line.startLiters,
    Wareneingang: line.refilledLiters,
    Warenausgang: line.consumedLiters,
    Verbrauch: line.consumedLiters,
    Endbestand: line.remainingLiters,
    Einheit: "L",
    Einkaufspreis: missing,
    Warenwert: missing
  }));
  const inventoryRows = [...softServeInventoryRows, ...packagingInventoryRows];
  const sheets: WorkbookSheets = {
    Übersicht: summary,
    Einsätze: filteredReports.length ? filteredReports.map((report) => reportToShiftRow(report, activeMachines)) : [emptyRow(["Hinweis"], "Keine abgeschlossenen Tagesberichte erfasst")],
    Verkäufe: orderRows.length ? orderRows : [emptyRow(["Hinweis"], "Keine detaillierten Bestellungen für dieses Jahr erfasst")],
    Zahlungen: buildPaymentRows(orderRows),
    Warenbestand: inventoryRows,
    Wareneingang: [emptyRow(["Datum", "Artikel", "Menge", "Einheit", "Wert"], "nicht erfasst")],
    Warenausgang: [emptyRow(["Datum", "Artikel", "Menge", "Einheit", "Wert"], "nicht erfasst")],
    Rechnungen: [emptyRow(["Datum", "Lieferant", "Rechnungsnummer", "Kategorie", "Betrag brutto", "Netto", "MwSt", "Zahlungsstatus", "Datei/Beleg"], "nicht erfasst")],
    "MwSt-Auswertung": buildVatRows(filteredReports, completedSaleRows),
    Kassendifferenzen: filteredReports.length ? filteredReports.map((report) => ({
      Datum: report.shift.date,
      Einsatz: report.shift.eventName,
      Startgeld: money(report.shift.startingCashCents),
      Endgeld: money(report.endCashCents),
      Kassendifferenz: money(report.cashDifferenceCents)
    })) : [emptyRow(["Hinweis"], "nicht erfasst")]
  };

  return { sheets, eventOptions };
}

function summarizeYear(reports: DayReport[], saleRows: SheetRow[]) {
  const grossFromSales = saleRows.reduce((sum, row) => sum + Number(row["Summe brutto Cent"] ?? 0), 0);
  const netFromSales = saleRows.reduce((sum, row) => sum + Number(row["Netto Cent"] ?? 0), 0);
  const vat7FromSales = saleRows
    .filter((row) => row["MwSt-Satz"] === "7 %")
    .reduce((sum, row) => sum + Number(row["Summe brutto Cent"] ?? 0) - Number(row["Netto Cent"] ?? 0), 0);
  const vat19FromSales = saleRows
    .filter((row) => row["MwSt-Satz"] === "19 %")
    .reduce((sum, row) => sum + Number(row["Summe brutto Cent"] ?? 0) - Number(row["Netto Cent"] ?? 0), 0);
  const gross = grossFromSales || reports.reduce((sum, report) => sum + report.taxReport.grossCents, 0);
  const net = netFromSales || reports.reduce((sum, report) => sum + report.taxReport.netCents, 0);
  const inventoryCost = reports.reduce((sum, report) => sum + report.inventoryReport.estimatedCostCents, 0);
  const cashCents = sumPayment(saleRows, "Bar") || reports.reduce((sum, report) => sum + report.totals.cashCents, 0);
  const cardCents = sumPayment(saleRows, "Karte") || reports.reduce((sum, report) => sum + report.totals.cardCents, 0);
  const shiftCount = new Set([
    ...reports.map((report) => report.shift.id),
    ...saleRows.map((row) => String(row["Einsatz-ID"] ?? "")).filter(Boolean)
  ]).size;

  return [
    { Kennzahl: "Umsatz gesamt brutto", Wert: money(gross) },
    { Kennzahl: "Umsatz netto", Wert: money(net) },
    { Kennzahl: "MwSt 0 %", Wert: money(0) },
    { Kennzahl: "MwSt 7 %", Wert: money(vat7FromSales || reports.reduce((sum, report) => sum + report.taxReport.vat7Cents, 0)) },
    { Kennzahl: "MwSt 19 %", Wert: money(vat19FromSales || reports.reduce((sum, report) => sum + report.taxReport.vat19Cents, 0)) },
    { Kennzahl: "Barumsatz", Wert: money(cashCents) },
    { Kennzahl: "Kartenumsatz", Wert: money(cardCents) },
    { Kennzahl: "Gratis", Wert: money(reports.reduce((sum, report) => sum + report.totals.freeCents, 0)) },
    { Kennzahl: "Storno", Wert: money(reports.reduce((sum, report) => sum + report.totals.cancelCents, 0)) },
    { Kennzahl: "Kassendifferenzen", Wert: money(reports.reduce((sum, report) => sum + report.cashDifferenceCents, 0)) },
    { Kennzahl: "Anzahl Einsätze", Wert: shiftCount },
    { Kennzahl: "Gesamtstücke Softeis", Wert: reports.reduce((sum, report) => sum + report.totals.totalPieces, 0) || saleRows.reduce((sum, row) => sum + Number(row.Menge ?? 0), 0) },
    { Kennzahl: "Wareneinsatz", Wert: money(inventoryCost) },
    { Kennzahl: "Geschätzter Gewinn brutto", Wert: money(gross - inventoryCost) },
    { Kennzahl: "Geschätzter Gewinn netto", Wert: money(net - inventoryCost) }
  ];
}

function reportToShiftRow(report: DayReport, machines: string): SheetRow {
  return {
    Datum: report.shift.date,
    "Einsatz/Event": report.shift.eventName,
    Standort: salesAreaLabels[report.shift.salesArea],
    Mitarbeiter: report.shift.employees.join(", ") || missing,
    Maschinen: machines,
    "Umsatz brutto": money(report.taxReport.grossCents),
    Bar: money(report.totals.cashCents),
    Karte: money(report.totals.cardCents),
    Gratis: money(report.totals.freeCents),
    Storno: money(report.totals.cancelCents),
    Kassendifferenz: money(report.cashDifferenceCents),
    "Tagesabschluss vorhanden": "Ja"
  };
}

function orderToSaleRows(order: DailyOrder, shift: Shift, machines: Machine[], paymentFilter: "all" | OrderPaymentMethod, status: string) {
  return order.items
    .map((item) => itemToSaleRow(item, { date: order.bookedAt ?? order.createdAt, shiftId: shift.id, paymentMethod: order.paymentMethod, status, machines }))
    .filter((row) => paymentFilter === "all" || row.Zahlungsart === paymentLabels[paymentFilter]);
}

function itemToSaleRow(
  item: CurrentOrderItem,
  context: { date: string; shiftId: string; paymentMethod: OrderPaymentMethod; status: string; machines?: Machine[] }
): SheetRow {
  const gross = item.grossTotalCents ?? item.lineTotalGrossCents ?? item.quantity * item.unitPriceGrossCents;
  const vatRate = item.taxRateAtBooking ?? item.vatRate;
  const net = item.netTotalCents ?? Math.round(gross / (1 + vatRate / 100));
  const vat = item.taxAmountCents ?? gross - net;
  const machine = context.machines?.find((entry) => entry.id === item.machineId);
  const packaging = item.packageNameAtBooking ?? ([item.portionType ?? item.packagingType, item.packagingSize].filter(Boolean).join(" ") || missing);

  return {
    "Datum/Uhrzeit": context.date,
    "Einsatz-ID": context.shiftId,
    Status: context.status,
    "Produkt/Sorte": withoutMachinePrefix(item.itemNameAtBooking ?? item.name),
    Maschine: item.machineDisplayNameAtBooking ?? item.machineNameAtBooking ?? (machine?.name ? formatMachineDisplayName(machine.name, machine.number) : (item.machineNumber ? `MASCHINE ${item.machineNumber}` : missing)),
    Verpackung: packaging,
    Menge: item.quantity,
    "Einzelpreis brutto": money(item.grossPriceCents ?? item.unitPriceGrossCents),
    "Summe brutto": money(gross),
    "Summe brutto Cent": gross,
    "MwSt-Satz": `${vatRate} %`,
    Netto: money(net),
    "Netto Cent": net,
    "MwSt-Betrag": money(vat),
    Zahlungsart: paymentLabels[context.paymentMethod]
  };
}

function buildPaymentRows(rows: SheetRow[]) {
  return rows.length ? rows.map((row) => ({
    "Datum/Uhrzeit": row["Datum/Uhrzeit"],
    Zahlungsart: row.Zahlungsart,
    Betrag: row["Summe brutto"],
    Status: row.Status
  })) : [emptyRow(["Hinweis"], "nicht erfasst")];
}

function buildVatRows(reports: DayReport[], rows: SheetRow[]) {
  const vatRates: VatRate[] = [0, 7, 19];

  return vatRates.map((rate) => {
    const saleRows = rows.filter((row) => row["MwSt-Satz"] === `${rate} %`);
    const gross = saleRows.reduce((sum, row) => sum + Number(row["Summe brutto Cent"] ?? 0), 0);
    const net = saleRows.reduce((sum, row) => sum + Number(row["Netto Cent"] ?? 0), 0);
    const saleVat = gross - net;
    const reportVat = rate === 7
      ? reports.reduce((sum, report) => sum + report.taxReport.vat7Cents, 0)
      : rate === 19
        ? reports.reduce((sum, report) => sum + report.taxReport.vat19Cents, 0)
        : 0;

    return {
      "MwSt-Satz": `${rate} %`,
      Brutto: money(gross),
      Netto: money(net),
      "MwSt-Betrag": money(saleVat || reportVat)
    };
  });
}

function SummaryGrid({ rows }: { rows: SheetRow[] }) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-ink">Übersicht</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {rows.map((row) => (
          <div key={String(row.Kennzahl)} className="rounded-lg bg-[#fbfcf8] p-3">
            <p className="text-xs font-semibold uppercase text-black/45">{row.Kennzahl}</p>
            <p className="mt-1 text-lg font-bold text-ink">{row.Wert}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function DataTable({ title, rows }: { title: string; rows: SheetRow[] }) {
  const headers = Object.keys(rows[0] ?? {});

  return (
    <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[60rem] border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="text-xs uppercase text-black/50">
              {headers.map((header) => (
                <th key={header} className="border-b border-black/10 px-3 py-2 font-bold">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {headers.map((header) => (
                  <td key={header} className="border-b border-black/5 px-3 py-3">{row[header]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-black/72">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-12 rounded-lg border border-black/15 bg-white px-3 text-base outline-none focus:border-primaq-500"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

function ExportButton({ label, icon, onClick }: { label: string; icon?: "xlsx" | "json" | "pdf"; onClick: () => void }) {
  const Icon = icon === "json" ? FileJson : icon === "pdf" ? Printer : icon === "xlsx" ? FileSpreadsheet : Download;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-4 text-sm font-bold text-ink"
    >
      <Icon className="h-5 w-5" /> {label}
    </button>
  );
}

async function exportWorkbook(fileName: string, sheets: WorkbookSheets) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();

  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
  }

  XLSX.writeFile(workbook, fileName);
}

function exportJson(fileName: string, sheets: WorkbookSheets) {
  downloadFile(fileName, JSON.stringify(sheets, null, 2), "application/json");
}

function exportCsv(fileName: string, sheets: WorkbookSheets) {
  downloadFile(fileName, Object.entries(sheets).map(([name, rows]) => `[${name}]\n${rowsToCsv(rows)}`).join("\n\n"), "text/csv;charset=utf-8");
}

function exportPdf(year: string) {
  document.title = `PrimaQ_Jahresabschluss_${year}`;
  window.print();
}

function rowsToCsv(rows: SheetRow[]) {
  const headers = Object.keys(rows[0] ?? {});
  const body = rows.map((row) => headers.map((header) => csvCell(String(row[header] ?? ""))).join(";"));
  return [headers.map(csvCell).join(";"), ...body].join("\n");
}

function csvCell(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
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

function emptyRow(headers: string[], value: string): SheetRow {
  return headers.reduce((row, header, index) => ({ ...row, [header]: index === 0 ? value : missing }), {});
}

function buildYears(reports: DayReport[], completedOrders: DailyOrder[], activeDate?: string) {
  const years = new Set([String(new Date().getFullYear())]);
  reports.forEach((report) => years.add(report.shift.date.slice(0, 4)));
  completedOrders.forEach((order) => years.add((order.bookedAt ?? order.createdAt).slice(0, 4)));
  if (activeDate) {
    years.add(activeDate.slice(0, 4));
  }
  return Array.from(years).sort((a, b) => b.localeCompare(a));
}

function dateMatches(date: string, year: string, month: string) {
  return date.startsWith(month === "all" ? year : `${year}-${month}`);
}

function money(cents: number) {
  return formatCurrency(cents);
}

function sumPayment(rows: SheetRow[], label: string) {
  return rows
    .filter((row) => row.Zahlungsart === label)
    .reduce((sum, row) => sum + Number(row["Summe brutto Cent"] ?? 0), 0);
}
