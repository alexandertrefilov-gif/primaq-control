"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Edit3, Eye, Plus, Trash2 } from "lucide-react";
import { formatCurrency, formatMachineDisplayName, toCents } from "./calculations";
import { salesAreaLabels } from "./catalog";
import { ShiftStartForm } from "./shift-start-form";
import type { DailyOrder, DayReport, Machine, SalesArea, Shift, ShiftFormData, ShiftMachineDeployment } from "./types";
import { useMvpStore } from "./use-mvp-store";

type ShiftOverviewEntry = {
  id: string;
  date: string;
  eventName: string;
  location: string;
  status: "aktiv" | "abgeschlossen" | "offen";
  employees: string;
  machineRows: MachineSummary[];
  grossCents: number;
  cashCents: number;
  cardCents: number;
  totalPieces: number;
  hasDayClose: boolean;
  shift: Shift;
  report?: DayReport;
  isActive: boolean;
};

type MachineSummary = {
  key: string;
  machineId?: string;
  machineName: string;
  location: string;
  grossCents: number;
  cashCents: number;
  cardCents: number;
  totalPieces: number;
  sortCounts: Record<string, number>;
};

const currentYear = String(new Date().getFullYear());

export function EinsatzOverviewClient() {
  const {
    hydrated,
    activeShift,
    reports,
    completedOrders,
    machines,
    stockFlavors,
    dayReport,
    totals,
    currentOrder,
    dailySales,
    generalStock,
    activateEmergencyMode,
    startShift,
    resetCurrentShift,
    deleteShift,
    updateShiftDetails
  } = useMvpStore();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [showNewShiftForm, setShowNewShiftForm] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ShiftOverviewEntry | null>(null);
  const [editingEntry, setEditingEntry] = useState<ShiftOverviewEntry | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<ShiftOverviewEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const entries = useMemo(
    () => buildEntries({ activeShift, reports, completedOrders, machines, dayReport }),
    [activeShift, completedOrders, dayReport, machines, reports]
  );
  const sortColumns = useMemo(() => buildSortColumns(entries), [entries]);
  const yearOptions = useMemo(() => buildYearOptions(entries), [entries]);
  const filteredEntries = useMemo(
    () => entries.filter((entry) => entry.date.slice(0, 4) === selectedYear),
    [entries, selectedYear]
  );
  const tableMinWidth = `${1190 + sortColumns.length * 76}px`;

  if (!hydrated) {
    return <div className="animate-pulse rounded-lg border border-black/10 bg-white p-8 text-center text-sm text-black/40">Laden…</div>;
  }

  return (
    <section className="grid gap-4">
      {notice ? (
        <div className="rounded-lg border border-primaq-500/25 bg-primaq-50 p-3 text-sm font-semibold text-primaq-800">
          {notice}
        </div>
      ) : null}

      <div className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-ink">Einsaetze im Jahr</h2>
            <p className="mt-1 text-sm text-black/60">
              Aktive und abgeschlossene Einsaetze aus den lokalen PrimaQ-Daten.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="grid gap-2 text-sm font-semibold text-black/70 sm:min-w-40">
              Jahr auswaehlen
              <select
                value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value)}
                className="min-h-12 rounded-lg border border-black/15 bg-white px-3 text-base font-bold outline-none focus:border-primaq-500"
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              data-testid="new-shift-button"
              onClick={() => {
                if (activeShift) {
                  setNotice("Es läuft bereits ein aktiver Einsatz.");
                  setShowNewShiftForm(false);
                  return;
                }

                setNotice(null);
                setShowNewShiftForm((current) => !current);
              }}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 text-sm font-black text-white shadow-sm active:scale-[0.99]"
            >
              <Plus className="h-4 w-4" />
              + Neuer Einsatz
            </button>
          </div>
        </div>
      </div>

      {showNewShiftForm ? (
        <ShiftStartForm
          activeShift={null}
          totals={totals}
          machines={machines}
          stockFlavors={stockFlavors}
          currentOrder={currentOrder}
          dailySales={dailySales}
          endCashCents={dayReport?.endCashCents}
          generalStock={generalStock}
          onActivateEmergencyMode={activateEmergencyMode}
          onStart={(formData) => {
            startShift(formData);
            setShowNewShiftForm(false);
            setNotice("Neuer Einsatz wurde gestartet.");
            setSelectedYear(formData.date.slice(0, 4));
          }}
          onReset={resetCurrentShift}
        />
      ) : null}

      <div className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table data-testid="shift-overview-table" style={{ minWidth: tableMinWidth }} className="w-full table-fixed text-left text-sm">
            <thead className="bg-[#fbfcf8] text-xs uppercase text-black/50">
              <tr>
                <TableHead className="w-[96px] whitespace-nowrap">Datum</TableHead>
                <TableHead className="w-[200px]">Einsatz/Event</TableHead>
                <TableHead className="w-[190px] whitespace-nowrap">Maschine</TableHead>
                <TableHead className="w-[190px]">Aktionen</TableHead>
                <TableHead className="w-[150px]">Mitarbeiter</TableHead>
                {sortColumns.map((column) => (
                  <TableHead key={column} title={column} className="w-[76px] text-center normal-case">
                    {shortenSortColumnLabel(column)}
                  </TableHead>
                ))}
                <TableHead className="w-[96px] text-center">Bar</TableHead>
                <TableHead className="w-[96px] text-center">Karte</TableHead>
                <TableHead className="w-[108px] text-center">Umsatz brutto</TableHead>
                <TableHead className="w-[72px] text-center">Stk.</TableHead>
                <TableHead className="w-[88px] text-center">Abschluss</TableHead>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {filteredEntries.map((entry) => (
                <ShiftTableGroup
                  key={entry.id}
                  entry={entry}
                  sortColumns={sortColumns}
                  onOpen={setSelectedEntry}
                  onEdit={setEditingEntry}
                  onDelete={(item) => {
                    setDeleteEntry(item);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-black/15 bg-white p-6 text-center text-sm text-black/60">
          Keine Einsaetze fuer {selectedYear} vorhanden.
        </div>
      ) : null}

      {selectedEntry ? (
        <DetailPanel entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
      ) : null}

      {editingEntry ? (
        <EditShiftDialog
          entry={editingEntry}
          onCancel={() => setEditingEntry(null)}
          onSave={(patch) => {
            updateShiftDetails(editingEntry.id, patch);
            setEditingEntry(null);
            setNotice("Einsatzdaten wurden aktualisiert.");
          }}
        />
      ) : null}

      {deleteEntry ? (
        <DeleteDialog
          entry={deleteEntry}
          onCancel={() => {
            setDeleteEntry(null);
          }}
          onDelete={() => {
            const wasActive = deleteEntry.isActive;
            deleteShift(deleteEntry.id);
            setDeleteEntry(null);
            setSelectedEntry((current) => current?.id === deleteEntry.id ? null : current);
            setEditingEntry((current) => current?.id === deleteEntry.id ? null : current);
            setNotice(wasActive ? "Der aktive Einsatz wurde gelöscht." : "Einsatz wurde gelöscht.");
          }}
        />
      ) : null}
    </section>
  );
}

function buildEntries({
  activeShift,
  reports,
  completedOrders,
  machines,
  dayReport
}: {
  activeShift: Shift | null;
  reports: DayReport[];
  completedOrders: DailyOrder[];
  machines: Machine[];
  dayReport: DayReport | null;
}) {
  const entries: ShiftOverviewEntry[] = [];
  const ordersByShift = groupOrdersByShift(completedOrders);
  const activeReport = activeShift
    ? reports.find((report) => report.shift.id === activeShift.id) ?? (dayReport?.shift.id === activeShift.id ? dayReport : undefined)
    : undefined;

  if (activeShift) {
    const activeOrders = ordersByShift.get(activeShift.id) ?? [];
    const activeDeployedIds = deployedMachineIdSet(activeShift.deploymentMachines);
    const activeMachineSummaries = buildMachineSummaries(activeOrders, machines, true, activeDeployedIds);
    const activeTotals = summarizeMachineRows(activeMachineSummaries);

    entries.push({
      id: activeShift.id,
      date: activeShift.date,
      eventName: activeShift.eventName,
      location: salesAreaLabels[activeShift.salesArea],
      status: "aktiv",
      employees: activeShift.employees.length ? activeShift.employees.join(", ") : "nicht erfasst",
      machineRows: activeMachineSummaries,
      grossCents: activeTotals.grossCents,
      cashCents: activeTotals.cashCents,
      cardCents: activeTotals.cardCents,
      totalPieces: activeTotals.totalPieces,
      hasDayClose: Boolean(activeReport),
      shift: activeShift,
      report: activeReport,
      isActive: true
    });
  }

  reports
    .filter((report) => report.shift.id !== activeShift?.id)
    .forEach((report) => {
      const reportOrders = ordersByShift.get(report.shift.id) ?? [];
      const reportDeployedIds = deployedMachineIdSet(report.shift.deploymentMachines);
      const reportMachineSummaries = buildMachineSummaries(reportOrders, machines, false, reportDeployedIds);

      entries.push({
        id: report.shift.id,
        date: report.shift.date,
        eventName: report.shift.eventName,
        location: salesAreaLabels[report.shift.salesArea],
        status: "abgeschlossen",
        employees: report.shift.employees.length ? report.shift.employees.join(", ") : "nicht erfasst",
        machineRows: reportMachineSummaries,
        grossCents: report.taxReport.grossCents,
        cashCents: report.totals.cashCents,
        cardCents: report.totals.cardCents,
        totalPieces: report.totals.totalPieces,
        hasDayClose: true,
        shift: report.shift,
        report,
        isActive: false
      });
    });

  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

function buildYearOptions(entries: ShiftOverviewEntry[]) {
  const years = new Set([currentYear]);
  entries.forEach((entry) => years.add(entry.date.slice(0, 4)));
  return Array.from(years).sort((a, b) => b.localeCompare(a));
}

function buildSortColumns(entries: ShiftOverviewEntry[]) {
  const labels = new Set<string>();

  entries.forEach((entry) => {
    entry.machineRows.forEach((machineRow) => {
      Object.keys(machineRow.sortCounts).forEach((label) => labels.add(label));
    });
  });

  return Array.from(labels).sort((a, b) => a.localeCompare(b, "de"));
}

function buildSortColumnsFromMachineRows(machineRows: MachineSummary[]) {
  const labels = new Set<string>();

  machineRows.forEach((machineRow) => {
    Object.keys(machineRow.sortCounts).forEach((label) => labels.add(label));
  });

  return Array.from(labels).sort((a, b) => a.localeCompare(b, "de"));
}

function machineRowToneClasses(index: number) {
  if (index % 2 === 0) {
    return {
      cell: "bg-primaq-50/70",
      label: "text-primaq-700"
    };
  }

  return {
    cell: "bg-[#fbfcf8]",
    label: "text-black/70"
  };
}

function shortenSortColumnLabel(label: string) {
  const normalized = label.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  const mixMatch = normalized.match(/^Mix\s+(.+?)\s+\+\s+(.+?)(?:\s*\/.*)?$/i);
  if (mixMatch) {
    return `Mix ${shortToken(mixMatch[1])}+${shortToken(mixMatch[2])}`;
  }

  const [basePart] = normalized.split(" / ");
  if (basePart.length <= 14) {
    return basePart;
  }

  return basePart
    .split(/\s+/)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function shortToken(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .split(/\s+/)
    .slice(0, 1)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function formatDate(value: string) {
  if (!value) {
    return "nicht erfasst";
  }

  return new Intl.DateTimeFormat("de-DE").format(new Date(value));
}

function TableHead({
  children,
  className = "",
  title
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return <th title={title} className={`px-3 py-3 font-bold ${className}`}>{children}</th>;
}

function TableCell({
  children,
  className = "",
  rowSpan,
  title,
  testId
}: {
  children: React.ReactNode;
  className?: string;
  rowSpan?: number;
  title?: string;
  testId?: string;
}) {
  return <td rowSpan={rowSpan} title={title} data-testid={testId} className={`px-3 py-3 text-black/68 ${className}`}>{children}</td>;
}

function groupOrdersByShift(orders: DailyOrder[]) {
  return orders.reduce((map, order) => {
    const key = order.shiftId;
    const next = map.get(key) ?? [];
    next.push(order);
    map.set(key, next);
    return map;
  }, new Map<string, DailyOrder[]>());
}

function buildMachineSummaries(
  orders: DailyOrder[],
  machines: Machine[],
  includeCurrentMachines: boolean,
  deployedMachineIds?: Set<string>
) {
  const machineLookup = new Map(machines.map((machine) => [machine.id, machine] as const));
  // When no deployment filter is specified, restrict to machines that currently exist in the store.
  // This prevents showing rows for machines that were deleted after old orders were booked.
  const existingMachineIds = new Set(machines.map((m) => m.id));
  const allowedMachineIds = deployedMachineIds ?? existingMachineIds;
  const machineSummaries = new Map<string, MachineSummary>();

  for (const order of orders) {
    for (const item of order.items) {
      // Skip items from machines not in the allowed set (deployment or current store)
      if (item.machineId && !allowedMachineIds.has(item.machineId)) {
        continue;
      }

      const machine = item.machineId ? machineLookup.get(item.machineId) : undefined;
      const machineSnapshotName = resolveMachineNameAtBooking(item, machine);
      const machineSnapshotLocation = item.machineLocationAtBooking?.trim() || machine?.location || "nicht erfasst";
      const key = buildMachineSummaryKey(order.shiftId, item, machineSnapshotName);
      const grossCents = resolveItemGrossCents(item);
      const paymentMethod = item.paymentMethod ?? order.paymentMethod;
      const sortLabel = `${resolveItemNameAtBooking(item)} / ${resolvePackageNameAtBooking(item)}`;
      const nextSummary = machineSummaries.get(key) ?? {
        key,
        machineId: item.machineId,
        machineName: machineSnapshotName,
        location: machineSnapshotLocation,
        grossCents: 0,
        cashCents: 0,
        cardCents: 0,
        totalPieces: 0,
        sortCounts: {}
      };

      nextSummary.grossCents += grossCents;
      nextSummary.cashCents += paymentMethod === "cash" ? grossCents : 0;
      nextSummary.cardCents += paymentMethod === "card" || paymentMethod === "qr" ? grossCents : 0;
      nextSummary.totalPieces += item.quantity;
      nextSummary.sortCounts[sortLabel] = (nextSummary.sortCounts[sortLabel] ?? 0) + item.quantity;

      machineSummaries.set(key, nextSummary);
    }
  }

  if (includeCurrentMachines) {
    machines
      .filter((machine) => machine.active !== false && machine.visibleInSale !== false)
      .filter((machine) => allowedMachineIds.has(machine.id))
      .forEach((machine) => {
        const key = `machine:${machine.id}`;
        const hasBookedSummary = Array.from(machineSummaries.values()).some((summary) => summary.machineId === machine.id);

        if (!machineSummaries.has(key) && !hasBookedSummary) {
          machineSummaries.set(key, {
            key,
            machineId: machine.id,
            machineName: formatMachineDisplayName(machine.name, machine.number),
            location: machine.location,
            grossCents: 0,
            cashCents: 0,
            cardCents: 0,
            totalPieces: 0,
            sortCounts: {}
          });
        }
      });
  }

  return Array.from(machineSummaries.values()).sort((a, b) => a.machineName.localeCompare(b.machineName, "de"));
}

function deployedMachineIdSet(deploymentMachines?: ShiftMachineDeployment[]) {
  if (!deploymentMachines?.length) return undefined;
  return new Set(deploymentMachines.map((d) => d.machineId));
}

function summarizeMachineRows(machineRows: MachineSummary[]) {
  return machineRows.reduce(
    (totals, machineRow) => ({
      grossCents: totals.grossCents + machineRow.grossCents,
      cashCents: totals.cashCents + machineRow.cashCents,
      cardCents: totals.cardCents + machineRow.cardCents,
      totalPieces: totals.totalPieces + machineRow.totalPieces
    }),
    {
      grossCents: 0,
      cashCents: 0,
      cardCents: 0,
      totalPieces: 0
    }
  );
}

function buildMachineSummaryKey(shiftId: string, item: DailyOrder["items"][number], machineName: string) {
  if (item.machineId?.trim()) {
    return `shift:${shiftId}:machine:${item.machineId}`;
  }

  const snapshotKey = item.machineNameAtBooking?.trim() || item.machineDisplayNameAtBooking?.trim() || machineName;
  return `shift:${shiftId}:snapshot:${snapshotKey || "unbekannt"}`;
}

function resolveMachineNameAtBooking(item: DailyOrder["items"][number], machine?: Machine) {
  return (
    item.machineNameAtBooking?.trim() ||
    item.machineDisplayNameAtBooking?.trim() ||
    (machine ? formatMachineDisplayName(machine.name, machine.number) : item.machineNumber ? `MASCHINE ${item.machineNumber}` : "MASCHINE")
  );
}

function resolveItemNameAtBooking(item: DailyOrder["items"][number]) {
  return item.itemNameAtBooking?.trim() || item.name || "Produkt";
}

function resolvePackageNameAtBooking(item: DailyOrder["items"][number]) {
  return item.packageNameAtBooking?.trim() || formatPackageName(item);
}

function resolveItemGrossCents(item: DailyOrder["items"][number]) {
  return item.grossTotalCents ?? item.lineTotalGrossCents ?? (item.unitGrossCents ?? item.grossPriceCents ?? item.unitPriceGrossCents) * item.quantity;
}

function formatPackageName(item: { portionType?: string; packagingType?: string; packagingSize?: string }) {
  const base = item.portionType ?? item.packagingType ?? "Waffel";
  const size = item.packagingSize?.trim();
  return size ? `${base} ${size}` : base;
}

function ShiftTableGroup({
  entry,
  sortColumns,
  onOpen,
  onEdit,
  onDelete
}: {
  entry: ShiftOverviewEntry;
  sortColumns: string[];
  onOpen: (entry: ShiftOverviewEntry) => void;
  onEdit: (entry: ShiftOverviewEntry) => void;
  onDelete: (entry: ShiftOverviewEntry) => void;
}) {
  const machineRows = entry.machineRows.length
    ? entry.machineRows
    : [{
        key: `${entry.id}:empty`,
        machineName: "Keine Maschinen erfasst",
        location: "nicht erfasst",
        grossCents: 0,
        cashCents: 0,
        cardCents: 0,
        totalPieces: 0,
        sortCounts: {}
      }];
  const sortTotals = summarizeSortTotals(machineRows);

  return (
    <>
      {machineRows.map((machineRow, index) => {
        const machineTone = machineRowToneClasses(index);
        const machineLabel = `Maschine ${index + 1}`;

        return (
          <tr key={machineRow.key} data-testid={`shift-overview-machine-row-${machineRow.machineId ?? machineRow.key}`} className="align-top">
            <TableCell>
              <div className="whitespace-nowrap font-semibold text-ink">{formatDate(entry.date)}</div>
            </TableCell>
            <TableCell>
              <div className="grid min-w-0 gap-1">
                <span className="truncate font-bold text-ink" title={entry.eventName || "Ohne Namen"}>
                  {entry.eventName || "Ohne Namen"}
                </span>
                <span className="truncate text-xs text-black/50" title={entry.location}>{entry.location}</span>
                <StatusBadge status={entry.status} />
              </div>
            </TableCell>
            <TableCell className={machineTone.cell}>
              <div className="grid min-w-0 gap-1">
                <span className={`truncate whitespace-nowrap font-bold ${machineTone.label}`} title={machineRow.machineName}>
                  {machineLabel}
                </span>
                <span className="truncate whitespace-nowrap text-xs text-black/50" title={machineRow.machineName}>
                  {machineRow.machineName}
                </span>
                <span className="truncate whitespace-nowrap text-xs text-black/50" title={machineRow.location}>Standort: {machineRow.location}</span>
              </div>
            </TableCell>
            <TableCell className="overflow-hidden">
              <EntryActions
                entry={entry}
                onOpen={onOpen}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            </TableCell>
            <TableCell className={machineTone.cell}>
              <div className="truncate whitespace-nowrap font-medium text-black/70" title={entry.employees}>
                {formatEmployeesCompact(entry.employees)}
              </div>
            </TableCell>
            {sortColumns.map((column) => (
              <TableCell key={column} className={`text-center tabular-nums whitespace-nowrap ${machineTone.cell}`}>
                {machineRow.sortCounts[column] ?? 0}
              </TableCell>
            ))}
            <TableCell className={`text-center font-semibold tabular-nums whitespace-nowrap text-ink ${machineTone.cell}`}>{formatCurrency(machineRow.cashCents)}</TableCell>
            <TableCell className={`text-center font-semibold tabular-nums whitespace-nowrap text-ink ${machineTone.cell}`}>{formatCurrency(machineRow.cardCents)}</TableCell>
            <TableCell className={`text-center font-bold tabular-nums whitespace-nowrap text-ink ${machineTone.cell}`}>{formatCurrency(machineRow.grossCents)}</TableCell>
            <TableCell
              testId={`shift-overview-pieces-${machineRow.machineId ?? machineRow.key}`}
              className={`text-center tabular-nums whitespace-nowrap ${machineTone.cell}`}
            >
              {machineRow.totalPieces}
            </TableCell>
            <TableCell className="text-center whitespace-nowrap">{entry.hasDayClose ? "Ja" : "Nein"}</TableCell>
          </tr>
        );
      })}

      <tr className="border-t-2 border-primaq-200 bg-primaq-50 font-semibold">
        <TableCell className="font-semibold text-black/55">{formatDate(entry.date)}</TableCell>
        <TableCell className="font-bold text-ink" title={entry.eventName || "Ohne Namen"}>
          <span className="block truncate">Einsatz-Summe</span>
        </TableCell>
        <TableCell className="font-semibold text-black/55">Alle Maschinen</TableCell>
        <TableCell className="text-black/45">-</TableCell>
        <TableCell className="font-semibold text-black/55" title={entry.employees}>
          <span className="block truncate whitespace-nowrap">{formatEmployeesCompact(entry.employees)}</span>
        </TableCell>
        {sortColumns.map((column) => (
          <TableCell key={column} className="text-center tabular-nums font-semibold text-ink">
            {sortTotals[column] ?? 0}
          </TableCell>
        ))}
        <TableCell className="text-center font-semibold tabular-nums text-ink">{formatCurrency(entry.cashCents)}</TableCell>
        <TableCell className="text-center font-semibold tabular-nums text-ink">{formatCurrency(entry.cardCents)}</TableCell>
        <TableCell className="text-center font-bold tabular-nums text-ink">{formatCurrency(entry.grossCents)}</TableCell>
        <TableCell className="text-center tabular-nums">{entry.totalPieces}</TableCell>
        <TableCell className="text-center whitespace-nowrap">{entry.hasDayClose ? "Ja" : "Nein"}</TableCell>
      </tr>
    </>
  );
}

function summarizeSortTotals(machineRows: MachineSummary[]) {
  return machineRows.reduce<Record<string, number>>((totals, machineRow) => {
    for (const [label, quantity] of Object.entries(machineRow.sortCounts)) {
      totals[label] = (totals[label] ?? 0) + quantity;
    }
    return totals;
  }, {});
}

function splitEmployees(value: string) {
  return value
    .split(",")
    .map((employee) => employee.trim())
    .filter(Boolean);
}

function formatEmployeesCompact(value: string) {
  const employees = splitEmployees(value);
  return employees.length ? employees.join(", ") : "nicht erfasst";
}

function MachineRowsCompactTable({ machineRows }: { machineRows: MachineSummary[] }) {
  const sortColumns = buildSortColumnsFromMachineRows(machineRows);

  if (!machineRows.length) {
    return <div className="text-xs font-semibold text-black/50">Keine Buchungen erfasst.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-black/10">
      <table className="min-w-[980px] w-full table-fixed text-left text-xs">
        <thead className="bg-[#fbfcf8] text-black/50">
          <tr>
            <TableHead className="w-[180px]">Maschine</TableHead>
            {sortColumns.map((column) => (
              <TableHead key={column} className="w-[72px] text-center normal-case" title={column}>
                {shortenSortColumnLabel(column)}
              </TableHead>
            ))}
            <TableHead className="w-[88px] text-center">Bar</TableHead>
            <TableHead className="w-[88px] text-center">Karte</TableHead>
            <TableHead className="w-[108px] text-center">Umsatz brutto</TableHead>
            <TableHead className="w-[72px] text-center">Stk.</TableHead>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {machineRows.map((machineRow, index) => {
            const machineTone = machineRowToneClasses(index);
            const machineLabel = `Maschine ${index + 1}`;

            return (
              <tr key={machineRow.key}>
                <TableCell className={`font-semibold text-ink ${machineTone.cell}`}>
                <div className="grid gap-0.5">
                    <span className={`whitespace-nowrap ${machineTone.label}`} title={machineRow.machineName}>{machineLabel}</span>
                    <span className="truncate whitespace-nowrap text-[11px] font-medium text-black/50" title={machineRow.machineName}>
                      {machineRow.machineName}
                    </span>
                    <span className="text-[11px] font-medium text-black/50">Standort: {machineRow.location}</span>
                  </div>
                </TableCell>
                {sortColumns.map((column) => (
                  <TableCell key={column} className={`text-center tabular-nums whitespace-nowrap ${machineTone.cell}`}>
                    {machineRow.sortCounts[column] ?? 0}
                  </TableCell>
                ))}
                <TableCell className={`text-center font-semibold tabular-nums whitespace-nowrap text-ink ${machineTone.cell}`}>{formatCurrency(machineRow.cashCents)}</TableCell>
                <TableCell className={`text-center font-semibold tabular-nums whitespace-nowrap text-ink ${machineTone.cell}`}>{formatCurrency(machineRow.cardCents)}</TableCell>
                <TableCell className={`text-center font-bold tabular-nums whitespace-nowrap text-ink ${machineTone.cell}`}>{formatCurrency(machineRow.grossCents)}</TableCell>
                <TableCell className={`text-center tabular-nums whitespace-nowrap ${machineTone.cell}`}>{machineRow.totalPieces}</TableCell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: ShiftOverviewEntry["status"] }) {
  const color = status === "aktiv"
    ? "border-primaq-500/25 bg-primaq-50 text-primaq-700"
    : status === "abgeschlossen"
      ? "border-black/10 bg-[#fbfcf8] text-black/65"
      : "border-yellow-200 bg-yellow-50 text-yellow-800";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${color}`}>
      {status}
    </span>
  );
}

function EntryActions({
  entry,
  onOpen,
  onEdit,
  onDelete
}: {
  entry: ShiftOverviewEntry;
  onOpen: (entry: ShiftOverviewEntry) => void;
  onEdit: (entry: ShiftOverviewEntry) => void;
  onDelete: (entry: ShiftOverviewEntry) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        data-testid={`open-shift-${entry.id}`}
        onClick={() => onOpen(entry)}
        className="inline-flex w-full min-h-10 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-xs font-bold text-black/70"
      >
        <Eye className="h-3.5 w-3.5 shrink-0" />
        Oeffnen
      </button>
      <button
        type="button"
        data-testid={`edit-shift-${entry.id}`}
        onClick={() => onEdit(entry)}
        className="inline-flex w-full min-h-10 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-xs font-bold text-black/70"
      >
        <Edit3 className="h-3.5 w-3.5 shrink-0" />
        Bearbeiten
      </button>
      <button
        type="button"
        data-testid={`delete-shift-${entry.id}`}
        onClick={() => onDelete(entry)}
        className="inline-flex w-full min-h-10 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700"
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        Loeschen
      </button>
    </div>
  );
}

function MiniLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="rounded-lg bg-[#fbfcf8] p-3">
      <span className="block text-xs font-semibold uppercase text-black/45">{label}</span>
      <span className="mt-1 block font-bold text-ink">{value}</span>
    </p>
  );
}

function DetailPanel({ entry, onClose }: { entry: ShiftOverviewEntry; onClose: () => void }) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-primaq-700">Details</p>
          <h2 className="mt-1 text-2xl font-bold text-ink">{entry.eventName || "Ohne Namen"}</h2>
          <p className="mt-1 text-sm text-black/60">{formatDate(entry.date)} · {entry.location}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-lg border border-black/10 bg-white px-4 text-sm font-bold text-black/70"
        >
          Schliessen
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniLine label="Status" value={entry.status} />
        <MiniLine label="Umsatz brutto" value={formatCurrency(entry.grossCents)} />
        <MiniLine label="Bar" value={formatCurrency(entry.cashCents)} />
        <MiniLine label="Karte" value={formatCurrency(entry.cardCents)} />
        <MiniLine label="Gesamtstuecke" value={String(entry.totalPieces)} />
        <MiniLine label="Tagesabschluss" value={entry.hasDayClose ? "Ja" : "Nein"} />
        <MiniLine label="Mitarbeiter" value={entry.employees} />
        <div>
          <p className="text-xs font-semibold uppercase text-black/45">Maschinen</p>
          <div className="mt-2">
            <MachineRowsCompactTable machineRows={entry.machineRows} />
          </div>
        </div>
      </div>
      {entry.isActive ? (
        <Link
          href="/einsatz"
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-primaq-500 px-4 text-sm font-bold text-white"
        >
          Aktiven Einsatz oeffnen
        </Link>
      ) : null}
    </section>
  );
}

function EditShiftDialog({
  entry,
  onCancel,
  onSave
}: {
  entry: ShiftOverviewEntry;
  onCancel: () => void;
  onSave: (patch: Partial<ShiftFormData>) => void;
}) {
  const [date, setDate] = useState(entry.shift.date);
  const [eventName, setEventName] = useState(entry.shift.eventName);
  const [salesArea, setSalesArea] = useState<SalesArea>(entry.shift.salesArea);
  const [employees, setEmployees] = useState(() => {
    const next = [...entry.shift.employees];
    while (next.length < 4) {
      next.push("");
    }
    return next.slice(0, 4);
  });
  const [startingCash, setStartingCash] = useState(formatCentsInput(entry.shift.startingCashCents));

  return (
    <Modal>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            date,
            eventName,
            salesArea,
            employees,
            startingCashCents: toCents(startingCash)
          });
        }}
      >
        <div>
          <p className="text-sm font-semibold text-primaq-700">Einsatz bearbeiten</p>
          <h2 className="mt-1 text-xl font-bold text-ink">{entry.eventName || "Ohne Namen"}</h2>
        </div>

        <label className="grid gap-2 text-sm font-semibold text-black/70">
          Datum
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="min-h-12 rounded-lg border border-black/15 px-3 text-base outline-none focus:border-primaq-500"
          />
        </label>

        <label className="grid gap-2 text-sm font-semibold text-black/70">
          Einsatzname/Event
          <input
            value={eventName}
            onChange={(event) => setEventName(event.target.value)}
            className="min-h-12 rounded-lg border border-black/15 px-3 text-base outline-none focus:border-primaq-500"
          />
        </label>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold text-black/70">Standort</legend>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(salesAreaLabels) as SalesArea[]).map((area) => (
              <button
                key={area}
                type="button"
                onClick={() => setSalesArea(area)}
                className={`min-h-12 rounded-lg border px-2 text-sm font-bold ${
                  salesArea === area
                    ? "border-primaq-500 bg-primaq-50 text-primaq-700"
                    : "border-black/10 bg-white text-black/65"
                }`}
              >
                {salesAreaLabels[area]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold text-black/70">Mitarbeiter</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {employees.map((employee, index) => (
              <input
                key={index}
                value={employee}
                onChange={(event) => {
                  const nextEmployees = [...employees];
                  nextEmployees[index] = event.target.value;
                  setEmployees(nextEmployees);
                }}
                placeholder={`Mitarbeiter ${index + 1}`}
                className="min-h-12 rounded-lg border border-black/15 px-3 text-base outline-none focus:border-primaq-500"
              />
            ))}
          </div>
        </fieldset>

        <label className="grid gap-2 text-sm font-semibold text-black/70">
          Startgeld
          <input
            inputMode="decimal"
            value={startingCash}
            onChange={(event) => setStartingCash(event.target.value)}
            className="min-h-12 rounded-lg border border-black/15 px-3 text-base outline-none focus:border-primaq-500"
          />
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 rounded-lg border border-black/10 bg-white px-4 text-sm font-bold text-black/70"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            className="min-h-12 rounded-lg bg-primaq-500 px-4 text-sm font-bold text-white"
          >
            Speichern
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({
  entry,
  onCancel,
  onDelete
}: {
  entry: ShiftOverviewEntry;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const hasSales = hasShiftSales(entry);

  return (
    <Modal>
      <div className="grid gap-4">
        <div>
          <p className="text-sm font-semibold text-red-700">Einsatz loeschen</p>
          <h2 className="mt-1 text-xl font-bold text-ink">{entry.eventName || "Ohne Namen"}</h2>
          <p className="mt-1 text-sm text-black/60">{formatDate(entry.date)} · {entry.location}</p>
        </div>

        <p className="rounded-lg bg-red-50 p-4 text-sm font-bold text-red-800">
          {hasSales
            ? "Dieser Einsatz enthält bereits Verkäufe. Wirklich löschen?"
            : "Einsatz wirklich löschen?"}
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 rounded-lg border border-black/10 bg-white px-4 text-sm font-bold text-black/70"
          >
            Abbrechen
          </button>
          <button
            type="button"
            data-testid="confirm-delete-shift"
            onClick={onDelete}
            className="min-h-12 rounded-lg bg-red-600 px-4 text-sm font-bold text-white"
          >
            {hasSales ? "Trotzdem löschen" : "Löschen"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function hasShiftSales(entry: ShiftOverviewEntry) {
  return entry.totalPieces > 0 || entry.grossCents > 0 || entry.cashCents > 0 || entry.cardCents > 0 || entry.hasDayClose;
}

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-4 shadow-xl">
        {children}
      </div>
    </div>
  );
}

function formatCentsInput(cents: number) {
  return (cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
