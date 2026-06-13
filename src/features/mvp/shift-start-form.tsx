"use client";

import { CalendarDays, ChevronDown, ChevronUp, Euro, MapPin, Play, UsersRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCurrency, formatMachineDisplayName, formatQuantity, toCents } from "./calculations";
import { salesAreaLabels } from "./catalog";
import { _mvpInternals } from "./use-mvp-store";
import type { CurrentOrder, InventoryReport, Machine, MachineLocation, MixStockInput, MixStockMovement, MvpTotals, ProductId, SalesArea, Shift, ShiftFormData, SoftServeRecipe, StockFlavor } from "./types";

type ShiftStartFormProps = {
  activeShift: Shift | null;
  totals: MvpTotals;
  machines: Machine[];
  stockFlavors: Record<string, StockFlavor>;
  currentOrder: CurrentOrder;
  dailySales: { orders: { id: string; createdAt: string; totalGrossCents: number }[] };
  endCashCents?: number;
  onStart: (formData: ShiftFormData) => void;
  onReset: () => void;
  mixLines?: InventoryReport["mixLines"];
  mixStockMovements?: Record<string, MixStockMovement[]>;
  onStep?: (productId: string, type: "initial_plus" | "initial_minus" | "refill_plus" | "refill_minus", input: MixStockInput) => void;
  onSetActualStock?: (productId: string, liters: number, reason?: string) => void;
  onResetStockFlavor?: (productId: string) => void;
  onAddInventoryFlavor?: (input: { name: string; colorHex?: string; recipe: SoftServeRecipe; warningThresholdPortions: number; stockInput: MixStockInput; savePermanent: boolean; portionWeights?: Partial<Record<import("./types").PackagingType, number>> }) => void;
  onDeleteInventoryFlavor?: (productId: string, force?: boolean) => { ok: true } | { ok: false; reason: "linked" | "movements" | "missing"; message: string };
  onUpdateFlavorPortionWeights?: (flavorId: string, weights: Partial<Record<import("./types").PackagingType, number>>) => void;
  generalStock?: Record<string, import("./types").GeneralStockItem>;
  onActivateEmergencyMode?: (stockFlavorId: string, flavorName: string, remainingLiters: number) => void;
  onResetMachine?: (machineId: string, withSalesData?: boolean) => void;
  onResetFlavorStock?: (flavorId: string, withConsumption?: boolean) => void;
};

const today = new Date().toISOString().slice(0, 10);

export function ShiftStartForm({
  activeShift,
  totals,
  machines,
  stockFlavors,
  currentOrder,
  dailySales,
  endCashCents,
  onStart,
  onReset,
  mixLines,
  mixStockMovements,
  onStep,
  onSetActualStock,
  onResetStockFlavor,
  onAddInventoryFlavor,
  onDeleteInventoryFlavor,
  onUpdateFlavorPortionWeights,
  generalStock,
  onActivateEmergencyMode,
  onResetMachine,
  onResetFlavorStock,
}: ShiftStartFormProps) {
  const [date, setDate] = useState(today);
  const [eventName, setEventName] = useState("");
  const [salesArea, setSalesArea] = useState<SalesArea>("truck");
  const [employees, setEmployees] = useState(["", "", "", ""]);
  const [startingCash, setStartingCash] = useState("150,00");
  const [mixStartInputs, setMixStartInputs] = useState<Record<ProductId, MixStockInput>>({});
  const [slotAssignments, setSlotAssignments] = useState<Record<string, { A?: string; B?: string; location?: MachineLocation }>>(() => {
    const result: Record<string, { A?: string; B?: string; location?: MachineLocation }> = {};
    for (const machine of machines) {
      if (machine.active === false || machine.visibleInSale === false) continue;
      const slotA = machine.products.find((p) => p.slot === "A");
      const slotB = machine.products.find((p) => p.slot === "B");
      const aId = slotA?.stockLinks[0]?.stockFlavorId;
      const bId = slotB?.stockLinks[0]?.stockFlavorId;
      result[machine.id] = { location: machine.location };
      if (aId) result[machine.id].A = aId;
      if (bId) result[machine.id].B = bId;
    }
    return result;
  });

  const activeMachines = machines.filter((machine) => machine.active !== false && machine.visibleInSale !== false);
  const activeFlavors = Object.values(stockFlavors).filter((f) => f.active !== false);

  const insufficientStockFlavors = useMemo(() => {
    if (!generalStock) return [] as string[];
    const names: string[] = [];
    for (const machine of activeMachines) {
      const assignment = slotAssignments[machine.id] ?? {};
      for (const slot of ["A", "B"] as const) {
        const flavorId = assignment[slot];
        if (!flavorId) continue;
        const flavor = stockFlavors[flavorId];
        if (!flavor) continue;
        const input = mixStartInputs[flavorId] ?? { mode: "packages" as const, value: null };
        if (!input.value || input.value <= 0) continue;
        const recipe = flavor.recipe;
        const packageKgVal = typeof recipe.packageKg === "number" && recipe.packageKg > 0
          ? recipe.packageKg : recipe.powderKgPerBatch;
        let packagesNeeded = 0;
        if (input.mode === "packages") {
          packagesNeeded = Math.ceil(input.value);
        } else if (input.mode === "batches") {
          packagesNeeded = input.value > 0 ? Math.ceil(input.value * (recipe.powderKgPerBatch / packageKgVal)) : 0;
        } else {
          const batches = recipe.mixLitersPerBatch > 0 ? input.value / recipe.mixLitersPerBatch : 0;
          packagesNeeded = batches > 0 ? Math.ceil(batches * (recipe.powderKgPerBatch / packageKgVal)) : 0;
        }
        const powderEntry = _mvpInternals.findGeneralStockItemForFlavor(generalStock, flavorId);
        const avail = powderEntry?.quantityOnHand ?? null;
        if (avail !== null && packagesNeeded > avail) names.push(flavor.name);
      }
    }
    return names;
  }, [activeMachines, generalStock, mixStartInputs, slotAssignments, stockFlavors]);

  const canStart = useMemo(
    () => date.trim().length > 0 && eventName.trim().length > 0 && insufficientStockFlavors.length === 0,
    [date, eventName, insufficientStockFlavors]
  );

  if (activeShift) {
    const expectedCashInDrawer = activeShift.startingCashCents + totals.cashCents;
    const difference = typeof endCashCents === "number" ? endCashCents - expectedCashInDrawer : 0;
    const pendingItems = currentOrder.items.reduce((sum, item) => sum + item.quantity, 0);
    const lastOrder = dailySales.orders[0];
    return (
      <section className="rounded-lg border border-primaq-500/25 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-primaq-700">Aktiver Einsatz</p>
            <h2 className="mt-1 text-2xl font-bold text-ink">{activeShift.eventName}</h2>
            <div className="mt-3 grid gap-2 text-sm text-black/70 sm:grid-cols-2">
              <p className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primaq-700" />
                {new Intl.DateTimeFormat("de-DE").format(new Date(activeShift.date))}
              </p>
              <p className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primaq-700" />
                {salesAreaLabels[activeShift.salesArea]}
              </p>
              <p className="flex items-center gap-2">
                <UsersRound className="h-4 w-4 text-primaq-700" />
                {activeShift.employees.length ? activeShift.employees.join(", ") : "Keine Mitarbeiter eingetragen"}
              </p>
              <p className="flex items-center gap-2">
                <Euro className="h-4 w-4 text-primaq-700" />
                Startgeld {formatCurrency(activeShift.startingCashCents)}
              </p>
            </div>
          </div>
          <span className="rounded-full bg-primaq-50 px-3 py-1 text-xs font-semibold text-primaq-700">
            Einsatz aktiv
          </span>
        </div>

        <div className="mt-5">
          <p className="text-xs font-semibold uppercase text-black/45">Maschinenbelegung</p>
          {activeMachines.length ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {activeMachines.map((machine, idx) => {
                const slotAId = machine.products.find((p) => p.slot === "A")?.stockLinks[0]?.stockFlavorId;
                const slotBId = machine.products.find((p) => p.slot === "B")?.stockLinks[0]?.stockFlavorId;
                const hasMix = machine.products.some((p) => p.slot === "MIX" && p.visibleInSale !== false);
                const slotAFlavor = stockFlavors[slotAId ?? ""];
                const slotBFlavor = stockFlavors[slotBId ?? ""];
                const location = machine.location;
                return (
                  <div key={machine.id} className="rounded-lg bg-[#fbfcf8] p-3">
                    <p className="text-xs font-bold uppercase text-primaq-700">Maschine {idx + 1}</p>
                    <p className="font-bold text-ink">{formatMachineDisplayName(machine.name, machine.number)}</p>
                    {location ? <p className="text-xs text-black/45">{location}</p> : null}
                    <div className="mt-2 grid gap-1">
                      <SlotRow label="Sorte A" name={slotAFlavor ? slotAFlavor.name : "—"} color={slotAFlavor?.colorHex} />
                      <SlotRow label="Sorte B" name={slotBFlavor ? slotBFlavor.name : "—"} color={slotBFlavor?.colorHex} />
                      {hasMix ? <SlotRow label="Mix" name="50% A + 50% B" /> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-1 text-sm text-black/55">
              Keine aktiven Maschinen.{" "}
              <Link href="/einstellungen" className="font-semibold underline text-primaq-700">Einstellungen →</Link>
            </p>
          )}
        </div>

        <div className="mt-5 border-t border-black/10 pt-5">
          <p className="text-sm font-bold uppercase text-primaq-700">Live Übersicht</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <LiveMetric label="Gesamtstücke" value={`${totals.totalPieces}`} />
            <LiveMetric label="Umsatz gesamt" value={formatCurrency(totals.expectedRevenueCents)} />
            <LiveMetric label="Bar" value={formatCurrency(totals.cashCents)} />
            <LiveMetric label="Karte" value={formatCurrency(totals.cardCents)} />
            <LiveMetric label="Gratis" value={formatCurrency(totals.freeCents)} />
            <LiveMetric label="Storno" value={formatCurrency(totals.cancelCents)} />
            <LiveMetric label="Startgeld" value={formatCurrency(activeShift.startingCashCents)} />
            <LiveMetric label="Endgeld" value={typeof endCashCents === "number" ? formatCurrency(endCashCents) : "offen"} />
            <LiveMetric label="Differenz" value={typeof endCashCents === "number" ? formatCurrency(difference) : "offen"} highlight />
          </div>
        </div>

        <div className="mt-5 grid gap-3 text-sm text-black/65 md:grid-cols-3">
          <p className="rounded-lg bg-[#fbfcf8] p-3">
            <span className="block text-xs font-semibold uppercase text-black/45">Aktuelle Bestellung</span>
            <span className="mt-1 block font-bold text-ink">{pendingItems} Artikel · {formatCurrency(currentOrder.totalGrossCents)}</span>
          </p>
          <p className="rounded-lg bg-[#fbfcf8] p-3">
            <span className="block text-xs font-semibold uppercase text-black/45">Letzte Bestellung</span>
            <span className="mt-1 block font-bold text-ink">{lastOrder ? formatCurrency(lastOrder.totalGrossCents) : "noch keine"}</span>
          </p>
          <p className="rounded-lg bg-[#fbfcf8] p-3">
            <span className="block text-xs font-semibold uppercase text-black/45">Abgeschlossene Bestellungen</span>
            <span className="mt-1 block font-bold text-ink">{dailySales.orders.length}</span>
          </p>
        </div>

        {mixLines !== undefined ? (
          <MachineStockPanel
            machines={activeMachines}
            stockFlavors={stockFlavors}
            mixLines={mixLines}
            mixStockMovements={mixStockMovements ?? {}}
            generalStock={generalStock}
            onStep={onStep ?? (() => {})}
            onSetActualStock={onSetActualStock ?? (() => {})}
            onActivateEmergencyMode={onActivateEmergencyMode}
            onResetMachine={onResetMachine}
            onResetFlavorStock={onResetFlavorStock}
          />
        ) : null}

        <button
          type="button"
          onClick={onReset}
          className="mt-5 min-h-12 w-full rounded-lg border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-700"
        >
          Einsatz zuruecksetzen
        </button>
      </section>
    );
  }

  return (
    <form
      className="rounded-lg border border-black/10 bg-white p-4 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();

        if (!canStart) {
          return;
        }

        const deploymentMachines = activeMachines
          .map((machine) => {
            const assignment = slotAssignments[machine.id] ?? {};
            const slots = (["A", "B"] as const)
              .filter((s) => assignment[s])
              .map((s) => ({ slot: s, stockFlavorId: assignment[s]! }));
            return {
              machineId: machine.id,
              location: assignment.location ?? machine.location,
              slots
            };
          })
          .filter((d) => d.slots.length > 0);

        onStart({
          date,
          eventName,
          salesArea,
          employees,
          startingCashCents: toCents(startingCash),
          mixStartInputs,
          deploymentMachines
        });
      }}
    >
      <h2 className="text-lg font-bold text-ink">Neuen Einsatz starten</h2>

      <div className="mt-4 grid gap-4">
        <label className="grid gap-2 text-sm font-semibold text-black/72">
          <span className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primaq-700" /> Datum
          </span>
          <input
            type="date"
            data-testid="shift-date-input"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="min-h-12 rounded-lg border border-black/15 bg-white px-3 text-base outline-none focus:border-primaq-500"
          />
        </label>

        <label className="grid gap-2 text-sm font-semibold text-black/72">
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primaq-700" /> Standort/Event
          </span>
          <input
            data-testid="shift-event-input"
            value={eventName}
            onChange={(event) => setEventName(event.target.value)}
            placeholder="z. B. Stadtfest Marktplatz"
            className="min-h-12 rounded-lg border border-black/15 bg-white px-3 text-base outline-none focus:border-primaq-500"
          />
        </label>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold text-black/72">Verkaufsbereich</legend>
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
          <legend className="flex items-center gap-2 text-sm font-semibold text-black/72">
            <UsersRound className="h-4 w-4 text-primaq-700" /> Mitarbeiter 1-4
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {employees.map((employee, index) => (
              <input
                key={index}
                data-testid={`shift-employee-${index + 1}`}
                value={employee}
                onChange={(event) => {
                  const nextEmployees = [...employees];
                  nextEmployees[index] = event.target.value;
                  setEmployees(nextEmployees);
                }}
                placeholder={`Mitarbeiter ${index + 1}`}
                className="min-h-12 rounded-lg border border-black/15 bg-white px-3 text-base outline-none focus:border-primaq-500"
              />
            ))}
          </div>
        </fieldset>

        <label className="grid gap-2 text-sm font-semibold text-black/72">
          <span className="flex items-center gap-2">
            <Euro className="h-4 w-4 text-primaq-700" /> Start-Bargeld
          </span>
          <input
            inputMode="decimal"
            data-testid="shift-starting-cash-input"
            value={startingCash}
            onChange={(event) => setStartingCash(event.target.value)}
            className="min-h-12 rounded-lg border border-black/15 bg-white px-3 text-base outline-none focus:border-primaq-500"
          />
        </label>

        {activeMachines.length ? (
          <section className="grid gap-4 rounded-lg border border-black/10 bg-[#fbfcf8] p-4">
            <h3 className="text-base font-black text-ink">Maschinenbelegung</h3>
            {activeMachines.map((machine, machineIdx) => {
              const assignment = slotAssignments[machine.id] ?? {};
              const hasMixSlot = machine.products.some((p) => p.slot === "MIX");
              const hasSlotA = machine.products.some((p) => p.slot === "A");
              const hasSlotB = machine.products.some((p) => p.slot === "B");
              return (
                <div key={machine.id} className="rounded-lg border border-black/10 bg-white p-3">
                  <p className="text-xs font-bold uppercase text-primaq-700">Maschine {machineIdx + 1}</p>
                  <p className="font-bold text-ink">{formatMachineDisplayName(machine.name, machine.number)}</p>
                  <div className="mt-3 grid gap-3">
                    <fieldset className="grid gap-1">
                      <legend className="text-xs font-semibold text-black/55">Standort</legend>
                      <div className="flex gap-2">
                        {(["Wagen", "Zelt"] as MachineLocation[]).map((loc) => (
                          <button
                            key={loc}
                            type="button"
                            onClick={() => setSlotAssignments((prev) => ({ ...prev, [machine.id]: { ...prev[machine.id], location: loc } }))}
                            className={`min-h-10 flex-1 rounded-lg border px-3 text-sm font-bold ${
                              (assignment.location ?? machine.location) === loc
                                ? "border-primaq-500 bg-primaq-50 text-primaq-700"
                                : "border-black/10 text-black/65"
                            }`}
                          >
                            {loc}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    {hasSlotA ? (
                      <label className="grid gap-1 text-xs font-semibold text-black/55">
                        Sorte A
                        <select
                          value={assignment.A ?? ""}
                          onChange={(e) => setSlotAssignments((prev) => ({ ...prev, [machine.id]: { ...prev[machine.id], A: e.target.value || undefined } }))}
                          className="min-h-11 w-full rounded-lg border border-black/15 bg-white px-3 text-sm font-bold text-ink outline-none focus:border-primaq-500"
                        >
                          <option value="">— keine Sorte —</option>
                          {activeFlavors.map((f) => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {hasSlotB ? (
                      <label className="grid gap-1 text-xs font-semibold text-black/55">
                        Sorte B
                        <select
                          value={assignment.B ?? ""}
                          onChange={(e) => setSlotAssignments((prev) => ({ ...prev, [machine.id]: { ...prev[machine.id], B: e.target.value || undefined } }))}
                          className="min-h-11 w-full rounded-lg border border-black/15 bg-white px-3 text-sm font-bold text-ink outline-none focus:border-primaq-500"
                        >
                          <option value="">— keine Sorte —</option>
                          {activeFlavors.map((f) => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {hasMixSlot ? (
                      <p className="text-xs text-black/45">Mix: 50 % A + 50 % B</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </section>
        ) : (
          <p className="text-sm text-black/55">
            Keine aktiven Maschinen.{" "}
            <Link href="/einstellungen" className="font-semibold underline text-primaq-700">Einstellungen →</Link>
          </p>
        )}

        {activeMachines.some((m) => {
          const assignment = slotAssignments[m.id] ?? {};
          return assignment.A || assignment.B;
        }) ? (
          <section className="grid gap-3 rounded-lg border border-primaq-500/20 bg-primaq-50 p-4">
            <div>
              <h3 className="text-base font-black text-ink">Startbestand</h3>
              <p className="mt-1 text-sm font-semibold text-black/60">
                Füllmenge pro Maschinenschacht. Eingabe in Paketen — Liter werden automatisch berechnet.
              </p>
            </div>
            <div className="grid gap-4">
              {activeMachines.map((machine, machineIdx) => {
                const assignment = slotAssignments[machine.id] ?? {};
                const assignedSlots = (["A", "B"] as const).filter((s) => assignment[s]);
                if (!assignedSlots.length) return null;
                return (
                  <div key={machine.id} className="grid gap-2">
                    <p className="text-xs font-bold uppercase text-primaq-700">
                      Maschine {machineIdx + 1} · {formatMachineDisplayName(machine.name, machine.number)}
                    </p>
                    {assignedSlots.map((slot) => {
                      const flavorId = assignment[slot]!;
                      const flavor = stockFlavors[flavorId];
                      const recipe = flavor?.recipe ?? { powderKgPerBatch: 0, waterLitersPerBatch: 0, mixLitersPerBatch: 0, packageKg: null };
                      const input = mixStartInputs[flavorId] ?? { mode: "packages" as const, value: null };
                      const packageKgVal = typeof recipe.packageKg === "number" && recipe.packageKg > 0
                        ? recipe.packageKg
                        : recipe.powderKgPerBatch;
                      const batchesPerPkg = recipe.powderKgPerBatch > 0 ? packageKgVal / recipe.powderKgPerBatch : 1;
                      const litersPerPkg = batchesPerPkg * recipe.mixLitersPerBatch;

                      const val = input.value ?? 0;
                      let previewLiters = 0;
                      let packagesNeeded = 0;
                      if (input.mode === "packages") {
                        packagesNeeded = Math.ceil(val);
                        previewLiters = val * litersPerPkg;
                      } else if (input.mode === "batches") {
                        previewLiters = val * recipe.mixLitersPerBatch;
                        packagesNeeded = val > 0 ? Math.ceil(val * (recipe.powderKgPerBatch / packageKgVal)) : 0;
                      } else {
                        previewLiters = val;
                        const batchesCalc = val / (recipe.mixLitersPerBatch || 1);
                        packagesNeeded = batchesCalc > 0 ? Math.ceil(batchesCalc * (recipe.powderKgPerBatch / packageKgVal)) : 0;
                      }

                      const powderEntry = generalStock
                        ? _mvpInternals.findGeneralStockItemForFlavor(generalStock, flavorId)
                        : undefined;
                      const stockAvailable = powderEntry?.quantityOnHand ?? null;
                      const stockInsufficient = stockAvailable !== null && packagesNeeded > stockAvailable;
                      const slotLabel = `Slot ${slot}`;
                      const flavorName = flavor?.name || slotLabel;

                      const modeLabel: Record<string, string> = { packages: "Pakete", batches: "Mischungen", liters: "Liter" };
                      const unitLabel: Record<string, string> = { packages: "Pkg", batches: "Mix", liters: "L" };

                      return (
                        <div key={slot} className="rounded-lg border border-black/10 bg-white p-3">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-black text-ink">
                                <span className="mr-2 text-xs font-bold text-primaq-700">{slotLabel}</span>
                                {flavorName}
                              </p>
                              {litersPerPkg > 0 ? (
                                <p className="text-xs text-black/45">1 Pkg → {formatDecimal(litersPerPkg)} L Mix</p>
                              ) : recipe.mixLitersPerBatch > 0 ? (
                                <p className="text-xs text-black/45">
                                  {formatDecimal(recipe.powderKgPerBatch)} kg + {formatDecimal(recipe.waterLitersPerBatch)} L = {formatDecimal(recipe.mixLitersPerBatch)} L Mix
                                </p>
                              ) : null}
                            </div>
                            <div className="text-right">
                              {input.mode === "packages" && val > 0 ? (
                                <p className="text-sm font-black text-primaq-700">
                                  {packagesNeeded} Pkg → {formatDecimal(previewLiters)} L
                                </p>
                              ) : previewLiters > 0 ? (
                                <p className="text-sm font-black text-primaq-700">{formatDecimal(previewLiters)} L Start</p>
                              ) : null}
                              <div className="mt-0.5 flex flex-wrap justify-end gap-2 text-xs font-semibold">
                                {stockAvailable !== null ? (
                                  <span className="text-black/50">{formatDecimal(stockAvailable)} Pkg im Lager</span>
                                ) : (
                                  <span className="text-black/40">Lager nicht erfasst</span>
                                )}
                                {packagesNeeded > 0 ? (
                                  <span className={stockInsufficient ? "font-black text-red-700" : "text-primaq-700"}>
                                    Bedarf: {packagesNeeded} Pkg{stockInsufficient ? " — zu wenig!" : ""}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)]">
                            <div className="grid grid-cols-3 gap-1.5">
                              {(["packages", "batches", "liters"] as MixStockInput["mode"][]).map((mode) => (
                                <button
                                  key={mode}
                                  type="button"
                                  onClick={() => setMixStartInputs((current) => ({
                                    ...current,
                                    [flavorId]: { ...input, mode }
                                  }))}
                                  className={`min-h-10 rounded-lg border px-2 text-xs font-bold ${
                                    input.mode === mode
                                      ? "border-primaq-500 bg-primaq-50 text-primaq-700"
                                      : "border-black/10 bg-white text-black/55"
                                  }`}
                                >
                                  {modeLabel[mode]}
                                </button>
                              ))}
                            </div>
                            <div className="flex min-h-10 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
                              <input
                                inputMode="decimal"
                                value={input.value === null ? "" : formatDecimal(input.value)}
                                onChange={(event) => setMixStartInputs((current) => ({
                                  ...current,
                                  [flavorId]: { ...input, value: parseDecimalInput(event.target.value) }
                                }))}
                                className="min-h-10 min-w-0 flex-1 rounded-lg bg-transparent px-3 text-base font-bold outline-none"
                              />
                              <span className="pr-3 text-sm font-bold text-black/50">
                                {unitLabel[input.mode] ?? "L"}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>

      {insufficientStockFlavors.length > 0 ? (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          Nicht genügend Bestand im Lager: {insufficientStockFlavors.join(", ")}. Bitte Lager auffüllen oder Startmenge reduzieren.
        </p>
      ) : null}

      <button
        type="submit"
        data-testid="shift-start-button"
        disabled={!canStart}
        className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-primaq-500 px-4 text-base font-bold text-white disabled:cursor-not-allowed disabled:bg-black/25"
      >
        <Play className="h-5 w-5" /> Neuen Einsatz starten
      </button>
    </form>
  );
}

function parseDecimalInput(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatDecimal(value: number | null) {
  if (value === null) {
    return "";
  }

  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 3
  }).format(value);
}

function SlotRow({ label, name, color }: { label: string; name: string; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs font-semibold text-black/45">{label}</span>
      {color ? (
        <span className="h-3 w-3 shrink-0 rounded-full border border-black/10" style={{ background: color }} />
      ) : null}
      <span className="text-sm font-bold text-ink">{name}</span>
    </div>
  );
}

function LiveMetric({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${highlight ? "bg-primaq-50" : "bg-[#fbfcf8]"}`}>
      <p className="text-xs font-semibold uppercase text-black/45">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink">{value}</p>
    </div>
  );
}

// ── Machine-oriented stock panel ──────────────────────────────────────────────

function MachineStockPanel({
  machines,
  stockFlavors,
  mixLines,
  mixStockMovements,
  generalStock,
  onStep,
  onSetActualStock,
  onActivateEmergencyMode,
  onResetMachine,
  onResetFlavorStock,
}: {
  machines: Machine[];
  stockFlavors: Record<string, StockFlavor>;
  mixLines: InventoryReport["mixLines"];
  mixStockMovements: Record<string, MixStockMovement[]>;
  generalStock?: Record<string, import("./types").GeneralStockItem>;
  onStep: (productId: string, type: "initial_plus" | "initial_minus" | "refill_plus" | "refill_minus", input: MixStockInput) => void;
  onSetActualStock: (productId: string, liters: number, reason?: string) => void;
  onActivateEmergencyMode?: (stockFlavorId: string, flavorName: string, remainingLiters: number) => void;
  onResetMachine?: (machineId: string, withSalesData?: boolean) => void;
  onResetFlavorStock?: (flavorId: string, withConsumption?: boolean) => void;
}) {
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);
  const [resetStep, setResetStep] = useState<"confirm" | "sales" | null>(null);
  const mixLineByFlavorId = new Map(mixLines.map((l) => [l.productId, l]));

  const machineGroups = machines.map((machine, machineIdx) => {
    const slots = (["A", "B"] as const).flatMap((s) => {
      const flavorId = machine.products.find((p) => p.slot === s)?.stockLinks[0]?.stockFlavorId;
      return flavorId && stockFlavors[flavorId] ? [{ slot: s, flavorId }] : [];
    });
    return { machine, machineIdx, slots };
  }).filter((g) => g.slots.length > 0);

  if (!machineGroups.length) {
    return (
      <div className="mt-5 rounded-lg border border-dashed border-black/15 bg-white p-4 text-sm text-black/55">
        Keine aktiven Maschinen mit zugeordneten Sorten.
      </div>
    );
  }

  return (
    <div className="mt-5 grid gap-4">
      <p className="text-sm font-bold uppercase text-black/45">Maschinenbestand</p>
      {machineGroups.map(({ machine, machineIdx, slots }) => (
        <div key={machine.id} className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-black/65">
              Maschine {machineIdx + 1} · {formatMachineDisplayName(machine.name, machine.number)}
              {machine.location ? ` · ${machine.location}` : ""}
            </p>
            {onResetMachine ? (
              confirmResetId === machine.id && resetStep === "confirm" ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-red-700">Bestand zurücksetzen?</span>
                  <button type="button" onClick={() => { setConfirmResetId(null); setResetStep(null); }}
                    className="min-h-8 rounded-lg border border-black/15 bg-white px-2 text-xs font-black text-black/60">
                    Abbrechen
                  </button>
                  <button type="button" onClick={() => setResetStep("sales")}
                    className="min-h-8 rounded-lg bg-red-600 px-2 text-xs font-black text-white">
                    Ja, Bestand löschen
                  </button>
                </div>
              ) : confirmResetId === machine.id && resetStep === "sales" ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-orange-700">Verkäufe auch löschen?</span>
                  <button type="button" onClick={() => { onResetMachine(machine.id, false); setConfirmResetId(null); setResetStep(null); }}
                    className="min-h-8 rounded-lg border border-black/15 bg-white px-2 text-xs font-black text-black/60">
                    Nein
                  </button>
                  <button type="button" onClick={() => { onResetMachine(machine.id, true); setConfirmResetId(null); setResetStep(null); }}
                    className="min-h-8 rounded-lg bg-red-700 px-2 text-xs font-black text-white">
                    Ja, alles löschen
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => { setConfirmResetId(machine.id); setResetStep("confirm"); }}
                  className="min-h-8 rounded-lg border border-red-200 bg-red-50 px-2 text-xs font-black text-red-700">
                  Maschine zurücksetzen
                </button>
              )
            ) : null}
          </div>
          {slots.map(({ slot, flavorId }) => {
            const flavor = stockFlavors[flavorId]!;
            const line = mixLineByFlavorId.get(flavorId) ?? null;
            const movements = mixStockMovements[flavorId] ?? [];
            const generalStockItem = generalStock
              ? _mvpInternals.findGeneralStockItemForFlavor(generalStock, flavorId)
              : undefined;
            return (
              <MachineSlotCard
                key={`${machine.id}_${slot}`}
                slot={slot}
                flavor={flavor}
                line={line}
                movements={movements}
                generalStockItem={generalStockItem}
                onStep={(type, input) => onStep(flavorId, type, input)}
                onSetActualStock={(liters, reason) => onSetActualStock(flavorId, liters, reason)}
                onActivateEmergencyMode={
                  onActivateEmergencyMode
                    ? (flavorName, remainingLiters) => onActivateEmergencyMode(flavorId, flavorName, remainingLiters)
                    : undefined
                }
                onResetFlavorStock={onResetFlavorStock ? (withConsumption) => onResetFlavorStock(flavorId, withConsumption) : undefined}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function MachineSlotCard({
  slot,
  flavor,
  line,
  movements,
  generalStockItem,
  onStep,
  onSetActualStock,
  onActivateEmergencyMode,
  onResetFlavorStock,
}: {
  slot: "A" | "B";
  flavor: StockFlavor;
  line: InventoryReport["mixLines"][number] | null;
  movements: MixStockMovement[];
  generalStockItem?: import("./types").GeneralStockItem;
  onStep: (type: "initial_plus" | "initial_minus" | "refill_plus" | "refill_minus", input: MixStockInput) => void;
  onSetActualStock: (liters: number, reason?: string) => void;
  onActivateEmergencyMode?: (flavorName: string, remainingLiters: number) => void;
  onResetFlavorStock?: (withConsumption?: boolean) => void;
}) {
  const [editField, setEditField] = useState<"initial" | "refill" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [resetFlavorDialog, setResetFlavorDialog] = useState(false);

  const recipe = flavor.recipe;
  const pkgKg = typeof recipe.packageKg === "number" && recipe.packageKg > 0 ? recipe.packageKg : recipe.powderKgPerBatch;
  const batchesPerPkg = recipe.powderKgPerBatch > 0 ? pkgKg / recipe.powderKgPerBatch : 1;
  const litersPerPkg = batchesPerPkg * recipe.mixLitersPerBatch;

  const stepInput: MixStockInput = { mode: "packages", value: 1 };

  // Lager-Sperre: wenn ein Pulver-Eintrag vorhanden ist aber leer, sperren
  const warehouseQty = generalStockItem?.quantityOnHand ?? null;
  const warehouseBlocked = warehouseQty !== null && warehouseQty < 1;

  function openEdit(field: "initial" | "refill") {
    const current = field === "initial" ? (line?.startLiters ?? 0) : (line?.refilledLiters ?? 0);
    setEditField(field);
    setEditValue(String(current).replace(".", ","));
  }

  function commitEdit() {
    if (!editField) return;
    const target = parseFloat(editValue.replace(",", "."));
    if (!Number.isFinite(target) || target < 0) { setEditField(null); return; }
    const current = editField === "initial" ? (line?.startLiters ?? 0) : (line?.refilledLiters ?? 0);
    const delta = Math.round((target - current) * 1000) / 1000;
    if (delta > 0) {
      onStep(editField === "initial" ? "initial_plus" : "refill_plus", { mode: "liters", value: delta });
    } else if (delta < 0) {
      onStep(editField === "initial" ? "initial_minus" : "refill_minus", { mode: "liters", value: Math.abs(delta) });
    }
    setEditField(null);
  }

  const status = line?.status ?? "OK";
  const statusColors: Record<string, string> = {
    OK: "text-green-700 bg-green-50 border-green-200",
    "Bald leer": "text-yellow-700 bg-yellow-50 border-yellow-200",
    Nachfüllen: "text-orange-700 bg-orange-50 border-orange-200",
    Leer: "text-red-700 bg-red-50 border-red-200",
    Notbetrieb: "text-purple-700 bg-purple-50 border-purple-200",
  };
  const statusColor = statusColors[status] ?? statusColors.OK;
  const borderLeft = status === "Leer" || status === "Notbetrieb"
    ? "border-l-4 border-l-red-400"
    : status === "Nachfüllen"
    ? "border-l-4 border-l-orange-400"
    : "border-l-4 border-l-green-400";

  const allMovements = movements.filter((m) =>
    m.type === "initial_plus" || m.type === "initial_minus" ||
    m.type === "refill_plus" || m.type === "refill_minus" ||
    m.type === "initial" || m.type === "start" ||
    m.type === "refill" || m.type === "correction_initial" || m.type === "correction_refill"
  );
  const initialMovements = allMovements.filter((m) =>
    m.type === "initial_plus" || m.type === "initial_minus" ||
    m.type === "initial" || m.type === "start" || m.type === "correction_initial"
  );
  const refillMovements = allMovements.filter((m) =>
    m.type === "refill_plus" || m.type === "refill_minus" ||
    m.type === "refill" || m.type === "correction_refill"
  );

  function movementSign(m: MixStockMovement) {
    return m.type === "initial_minus" || m.type === "refill_minus" ? "−" : "+";
  }
  function movementColor(m: MixStockMovement) {
    return m.type === "initial_minus" || m.type === "refill_minus" ? "text-red-600" : "text-primaq-700";
  }
  function movementLabel(m: MixStockMovement) {
    if (m.type === "initial_plus" || m.type === "initial_minus") return "Startbest.";
    if (m.type === "refill_plus" || m.type === "refill_minus") return "Nachfüllung";
    if (m.type === "correction_initial") return "Korr. Start";
    if (m.type === "correction_refill") return "Korr. Nachf.";
    if (m.type === "initial" || m.type === "start") return "Startbest.";
    return "Nachfüllung";
  }
  function movementAmount(m: MixStockMovement) {
    if (m.packages) return `${m.packages} Pkg`;
    return formatQuantity(m.liters, "L");
  }

  const btnMinus = "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/15 bg-white text-xl font-black text-black/60 active:bg-black/5";
  const btnPlus = "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primaq-300 bg-primaq-50 text-xl font-black text-primaq-700 active:bg-primaq-100";

  return (
    <div className={`overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm ${borderLeft}`}>
      {/* Flavor header */}
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          {flavor.colorHex ? (
            <span className="h-3 w-3 shrink-0 rounded-full border border-black/10" style={{ background: flavor.colorHex }} />
          ) : null}
          <span className="mr-1 text-xs font-bold text-primaq-700">Slot {slot}</span>
          <span className="font-black text-ink">{flavor.name}</span>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-black ${statusColor}`}>{status}</span>
      </div>

      {/* Compact +/− controls */}
      <div className="grid gap-0 border-t border-black/8">
        {/* Startbestand row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-black/6">
          <button type="button" className={btnMinus} onClick={() => onStep("initial_minus", stepInput)}>−</button>
          <div className="flex-1 text-center">
            <p className="text-[10px] font-semibold uppercase text-black/40 leading-none mb-0.5">Startbestand</p>
            {editField === "initial" ? (
              <div className="flex items-center justify-center gap-1">
                <input
                  autoFocus
                  inputMode="decimal"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditField(null); }}
                  className="w-20 rounded border border-primaq-400 px-2 py-0.5 text-center text-base font-black outline-none"
                />
                <span className="text-xs text-black/40">L</span>
              </div>
            ) : litersPerPkg > 0 && (line?.startLiters ?? 0) > 0 ? (
              <button type="button" onClick={() => openEdit("initial")} className="text-xl font-black text-ink hover:text-primaq-700">
                {((line?.startLiters ?? 0) / litersPerPkg).toFixed(1)} Pkg
              </button>
            ) : (
              <button type="button" onClick={() => openEdit("initial")} className="text-xl font-black text-ink hover:text-primaq-700">
                {formatQuantity(Math.max(0, line?.startLiters ?? 0), "L")}
              </button>
            )}
            {litersPerPkg > 0 && (line?.startLiters ?? 0) > 0 ? (
              <p className="text-[10px] text-black/35 mt-0.5 leading-none">
                ≈ {formatQuantity(line?.startLiters ?? 0, "L")}
              </p>
            ) : null}
            {warehouseBlocked ? (
              <p className="mt-1 text-[10px] font-bold text-red-600">0 Pkg im Lager</p>
            ) : warehouseQty !== null ? (
              <p className="mt-1 text-[10px] text-black/40">{warehouseQty} Pkg im Lager</p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={warehouseBlocked}
            title={warehouseBlocked ? "Nicht genügend Pulver im Lager. Bitte zuerst Ware im Lager buchen." : undefined}
            className={warehouseBlocked ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-[#f5f5f0] text-xl font-black text-black/25 cursor-not-allowed" : btnPlus}
            onClick={() => !warehouseBlocked && onStep("initial_plus", stepInput)}
          >+</button>
        </div>

        {/* Nachgefüllt row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-black/6">
          <button type="button" className={btnMinus} onClick={() => onStep("refill_minus", stepInput)}>−</button>
          <div className="flex-1 text-center">
            <p className="text-[10px] font-semibold uppercase text-black/40 leading-none mb-0.5">Nachgefüllt</p>
            {editField === "refill" ? (
              <div className="flex items-center justify-center gap-1">
                <input
                  autoFocus
                  inputMode="decimal"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditField(null); }}
                  className="w-20 rounded border border-primaq-400 px-2 py-0.5 text-center text-base font-black outline-none"
                />
                <span className="text-xs text-black/40">L</span>
              </div>
            ) : litersPerPkg > 0 && (line?.refilledLiters ?? 0) > 0 ? (
              <button type="button" onClick={() => openEdit("refill")} className="text-xl font-black text-ink hover:text-primaq-700">
                {((line?.refilledLiters ?? 0) / litersPerPkg).toFixed(1)} Pkg
              </button>
            ) : (
              <button type="button" onClick={() => openEdit("refill")} className="text-xl font-black text-ink hover:text-primaq-700">
                {formatQuantity(Math.max(0, line?.refilledLiters ?? 0), "L")}
              </button>
            )}
            {litersPerPkg > 0 && (line?.refilledLiters ?? 0) > 0 ? (
              <p className="text-[10px] text-black/35 mt-0.5 leading-none">
                ≈ {formatQuantity(line?.refilledLiters ?? 0, "L")}
              </p>
            ) : null}
            {warehouseBlocked ? (
              <p className="mt-1 text-[10px] font-bold text-red-600">Nachfüllung gesperrt</p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={warehouseBlocked}
            title={warehouseBlocked ? "Nicht genügend Pulver im Lager. Bitte zuerst Ware im Lager buchen." : undefined}
            className={warehouseBlocked ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-[#f5f5f0] text-xl font-black text-black/25 cursor-not-allowed" : btnPlus}
            onClick={() => !warehouseBlocked && onStep("refill_plus", stepInput)}
          >+</button>
        </div>

        {/* Verbraucht + Restbestand — read-only formula breakdown */}
        {line ? (
          <div className="bg-[#f8f9f5] px-4 py-3">
            <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-x-1 text-center text-xs">
              <div>
                <p className="text-[10px] font-semibold uppercase text-black/40 leading-none">Start</p>
                {litersPerPkg > 0 ? (
                  <>
                    <p className="mt-0.5 font-black text-ink">{(line.startLiters / litersPerPkg).toFixed(1)} Pkg</p>
                    <p className="text-[9px] text-black/30">{formatQuantity(line.startLiters, "L")}</p>
                  </>
                ) : (
                  <p className="mt-0.5 font-black text-ink">{formatQuantity(line.startLiters, "L")}</p>
                )}
              </div>
              <span className="text-black/30 font-bold">+</span>
              <div>
                <p className="text-[10px] font-semibold uppercase text-black/40 leading-none">Nachf.</p>
                {litersPerPkg > 0 ? (
                  <>
                    <p className="mt-0.5 font-black text-ink">{(line.refilledLiters / litersPerPkg).toFixed(1)} Pkg</p>
                    <p className="text-[9px] text-black/30">{formatQuantity(line.refilledLiters, "L")}</p>
                  </>
                ) : (
                  <p className="mt-0.5 font-black text-ink">{formatQuantity(line.refilledLiters, "L")}</p>
                )}
              </div>
              <span className="text-black/30 font-bold">−</span>
              <div>
                <p className="text-[10px] font-semibold uppercase text-black/40 leading-none">Verbraucht</p>
                <p className="mt-0.5 font-black text-ink">{formatQuantity(line.consumedLiters, "L")}</p>
                {line.estimatedRemainingPortions != null ? (
                  <p className="text-[9px] text-black/30">≈{line.estimatedRemainingPortions} Port.</p>
                ) : null}
              </div>
              <span className="text-black/30 font-bold">=</span>
              <div>
                <p className="text-[10px] font-semibold uppercase text-black/40 leading-none">Rest</p>
                {litersPerPkg > 0 && line.remainingLiters > 0 ? (
                  <>
                    <p className={`mt-0.5 font-black ${line.remainingLiters < 0 ? "text-red-600" : "text-primaq-700"}`}>
                      {(Math.max(0, line.remainingLiters) / litersPerPkg).toFixed(1)} Pkg
                    </p>
                    <p className="text-[9px] text-black/30">{formatQuantity(Math.max(0, line.remainingLiters), "L")}</p>
                  </>
                ) : (
                  <p className={`mt-0.5 font-black ${line.remainingLiters < 0 ? "text-red-600" : "text-primaq-700"}`}>
                    {formatQuantity(Math.max(0, line.remainingLiters), "L")}
                    {line.remainingLiters < 0 ? (
                      <span className="ml-1 text-[9px] text-red-500">(−{formatQuantity(Math.abs(line.remainingLiters), "L")})</span>
                    ) : null}
                  </p>
                )}
              </div>
            </div>
            {/* Show correction term when non-zero so the formula always adds up visibly */}
            {Math.abs(line.correctedLiters) > 0.001 ? (
              <p className="mt-2 rounded bg-orange-100 px-2 py-1 text-center text-[10px] font-bold text-orange-700">
                Korrektur: {line.correctedLiters > 0 ? "+" : "−"}{formatQuantity(Math.abs(line.correctedLiters), "L")} (im Restbestand enthalten)
              </p>
            ) : null}
          </div>
        ) : (
          <div className="px-4 py-2.5 text-xs text-black/40">Kein Bestand erfasst</div>
        )}
      </div>

      {line?.isEmergencyMode ? (
        <div className="border-t border-orange-200 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-800">
          🔓 Notbetrieb aktiv
        </div>
      ) : status === "Leer" && onActivateEmergencyMode ? (
        <button
          type="button"
          onClick={() => {
            const confirmed = window.confirm(
              "Notbetrieb erlaubt den Weiterverkauf, obwohl die Sorte als \"Leer\" markiert ist.\n\nNur aktivieren, wenn tatsächlich noch Ware in der Maschine ist. Diese Aktion wird protokolliert.\n\nJetzt Notbetrieb aktivieren?"
            );
            if (confirmed) {
              onActivateEmergencyMode(flavor.name, line?.remainingLiters ?? 0);
            }
          }}
          className="flex w-full items-center justify-center gap-2 border-t border-orange-200 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-800"
        >
          🔓 Notbetrieb aktivieren
        </button>
      ) : null}

      {/* Per-flavor stock reset — 3-option dialog */}
      {onResetFlavorStock ? (
        <div className="border-t border-black/6 px-3 py-2">
          {resetFlavorDialog ? (
            <div className="grid gap-1.5">
              <p className="text-xs font-black text-ink">
                Bestand zurücksetzen — was soll gelöscht werden?
              </p>
              <p className="text-[10px] text-black/50">
                Verbrauch durch Verkäufe bleibt bei „Nur Bestand&quot; erhalten.
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => { onResetFlavorStock(false); setResetFlavorDialog(false); }}
                  className="min-h-8 rounded-lg border border-black/15 bg-white px-2.5 text-xs font-black text-black/70"
                >
                  Nur Bestand
                </button>
                <button
                  type="button"
                  onClick={() => { onResetFlavorStock(true); setResetFlavorDialog(false); }}
                  className="min-h-8 rounded-lg bg-red-600 px-2.5 text-xs font-black text-white"
                >
                  Komplett zurücksetzen
                </button>
                <button
                  type="button"
                  onClick={() => setResetFlavorDialog(false)}
                  className="min-h-8 rounded-lg border border-black/10 bg-[#f5f5f0] px-2.5 text-xs font-bold text-black/50"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setResetFlavorDialog(true)}
              className="min-h-8 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-black text-red-700"
            >
              Bestand zurücksetzen
            </button>
          )}
        </div>
      ) : null}

      {/* History */}
      {allMovements.length > 0 ? (
        <div className="border-t border-black/8">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2 text-xs font-semibold text-black/50"
          >
            <span>Verlauf ({allMovements.length})</span>
            {showHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showHistory ? (
            <div className="border-t border-black/8 bg-[#fbfcf8]">
              {initialMovements.length > 0 ? (
                <div className="px-4 py-2">
                  <p className="mb-1 text-[10px] font-bold uppercase text-black/40">Startbestand</p>
                  <ul>
                    {initialMovements.map((m) => (
                      <li key={m.id} className="flex items-center justify-between py-1 text-xs">
                        <span className="text-black/45">
                          {new Date(m.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                          {" · "}{movementLabel(m)}
                        </span>
                        <span className={`font-bold ${movementColor(m)}`}>
                          {movementSign(m)} {movementAmount(m)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {refillMovements.length > 0 ? (
                <div className={`px-4 py-2 ${initialMovements.length > 0 ? "border-t border-black/8" : ""}`}>
                  <p className="mb-1 text-[10px] font-bold uppercase text-black/40">Nachfüllungen</p>
                  <ul>
                    {refillMovements.map((m) => (
                      <li key={m.id} className="flex items-center justify-between py-1 text-xs">
                        <span className="text-black/45">
                          {new Date(m.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                          {" · "}{movementLabel(m)}
                        </span>
                        <span className={`font-bold ${movementColor(m)}`}>
                          {movementSign(m)} {movementAmount(m)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
