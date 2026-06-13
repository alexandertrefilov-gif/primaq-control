"use client";

import { Download, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { formatCurrency, formatQuantity, parseQuantityInput, withoutMachinePrefix } from "./calculations";
import { salesAreaLabels } from "./catalog";
import { ShiftStartForm } from "./shift-start-form";
import type { DailyOrder, DayReport, GeneralStockItem, MaterialCategory, MaterialCostReport, MaterialItem, MixInventoryLine, MvpTotals, Shift, ShiftMaterialAssignment, StockFlavor } from "./types";
import { useMvpStore } from "./use-mvp-store";

export function EinsatzClient() {
  const {
    activeShift, hydrated, startShift, resetCurrentShift, totals, machines, stockFlavors,
    currentOrder, dailySales, dayReport, completedOrders,
    inventoryReport, taxReport, materialCostReport, mixStockMovements, generalStock,
    createDayReport, stepMixStock,
    setActualStock, resetStockFlavor, addInventoryFlavor, deleteInventoryFlavor,
    updateStockFlavorPortionWeights,
    activateEmergencyMode, resetMachineStock, resetFlavorStockOnly,
    materialCategories, materialItems, shiftMaterialAssignments,
    assignMaterialToShift, returnMaterialFromShift, returnPowderToStock,
  } = useMvpStore();

  const [showPowderReturn, setShowPowderReturn] = useState(false);
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [showAbschluss, setShowAbschluss] = useState(false);

  if (!hydrated) {
    return <div className="animate-pulse rounded-lg border border-black/10 bg-white p-8 text-center text-sm text-black/40">Laden…</div>;
  }

  const activeAssignments = activeShift
    ? shiftMaterialAssignments.filter((a) => a.shiftId === activeShift.id)
    : [];

  const remainingMixLines = (inventoryReport.mixLines ?? []).filter(
    (l) => l.remainingLiters > 0.01
  );

  function handleReset() {
    if (remainingMixLines.length > 0) {
      setShowPowderReturn(true);
    } else if (activeAssignments.length > 0) {
      setShowReturnDialog(true);
    } else {
      setShowAbschluss(true);
    }
  }

  function handlePowderReturnDone() {
    setShowPowderReturn(false);
    if (activeAssignments.length > 0) {
      setShowReturnDialog(true);
    } else {
      setShowAbschluss(true);
    }
  }

  function handleReturnDone() {
    setShowReturnDialog(false);
    setShowAbschluss(true);
  }

  return (
    <>
      <ShiftStartForm
        activeShift={activeShift}
        totals={totals}
        machines={machines}
        stockFlavors={stockFlavors}
        currentOrder={currentOrder}
        dailySales={dailySales}
        endCashCents={dayReport?.endCashCents}
        onStart={startShift}
        onReset={handleReset}
        mixLines={inventoryReport.mixLines}
        mixStockMovements={mixStockMovements}
        onStep={stepMixStock}
        onSetActualStock={setActualStock}
        onResetStockFlavor={resetStockFlavor}
        onAddInventoryFlavor={addInventoryFlavor}
        onDeleteInventoryFlavor={deleteInventoryFlavor}
        onUpdateFlavorPortionWeights={updateStockFlavorPortionWeights}
        generalStock={generalStock}
        onActivateEmergencyMode={activateEmergencyMode}
        onResetMachine={resetMachineStock}
        onResetFlavorStock={resetFlavorStockOnly}
      />

      {activeShift && materialCategories.length > 0 ? (
        <MaterialAssignmentSection
          shiftId={activeShift.id}
          categories={materialCategories}
          items={materialItems}
          assignments={activeAssignments}
          onAssign={assignMaterialToShift}
        />
      ) : null}

      {showPowderReturn ? (
        <PowderReturnDialog
          mixLines={remainingMixLines}
          stockFlavors={stockFlavors}
          generalStock={generalStock}
          onReturn={returnPowderToStock}
          onDone={handlePowderReturnDone}
          onClose={() => setShowPowderReturn(false)}
        />
      ) : null}

      {showReturnDialog ? (
        <MaterialReturnDialog
          assignments={activeAssignments}
          items={materialItems}
          onReturn={returnMaterialFromShift}
          onDone={handleReturnDone}
          onClose={() => setShowReturnDialog(false)}
        />
      ) : null}

      {showAbschluss && activeShift ? (
        <AbschlussSheet
          shift={activeShift}
          totals={totals}
          completedOrders={completedOrders.filter((o) => o.shiftId === activeShift.id)}
          mixLines={inventoryReport.mixLines}
          generalStock={generalStock}
          materialCostReport={materialCostReport}
          existingReport={dayReport}
          onCreateReport={createDayReport}
          onConfirm={() => {
            setShowAbschluss(false);
            resetCurrentShift();
          }}
          onCancel={() => setShowAbschluss(false)}
        />
      ) : null}
    </>
  );
}

// ─── Powder Return Dialog ─────────────────────────────────────────────────────

const POWDER_LOSS_REASONS = ["Entsorgt", "Verdorben", "Beschädigt", "Sonstiges"] as const;

function PowderReturnDialog({
  mixLines,
  stockFlavors,
  generalStock,
  onReturn,
  onDone,
  onClose,
}: {
  mixLines: { productId: string; name: string; remainingLiters: number }[];
  stockFlavors: Record<string, StockFlavor>;
  generalStock: Record<string, import("./types").GeneralStockItem>;
  onReturn: (flavorId: string, returnPkgs: number) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  type RowState = { returnInput: string; lossReason: string };
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(mixLines.map((l) => [l.productId, { returnInput: "", lossReason: "" }]))
  );

  function patch(flavorId: string, p: Partial<RowState>) {
    setRows((r) => ({ ...r, [flavorId]: { ...r[flavorId], ...p } }));
  }

  const activeRows = mixLines.map((l) => {
    const flavor = stockFlavors[l.productId];
    const recipe = flavor?.recipe;
    const pkgKg = recipe ? (typeof recipe.packageKg === "number" && recipe.packageKg > 0 ? recipe.packageKg : recipe.powderKgPerBatch) : 0;
    const batchesPerPkg = recipe && recipe.powderKgPerBatch > 0 ? pkgKg / recipe.powderKgPerBatch : 0;
    const litersPerPkg = batchesPerPkg * (recipe?.mixLitersPerBatch ?? 0);
    const remainingPkgs = litersPerPkg > 0 ? l.remainingLiters / litersPerPkg : 0;
    const row = rows[l.productId] ?? { returnInput: "", lossReason: "" };
    const parsedReturn = Math.min(remainingPkgs, Math.max(0, parseQuantityInput(row.returnInput) ?? 0));
    const impliedLoss = Math.max(0, remainingPkgs - parsedReturn);
    return { l, flavor, litersPerPkg, remainingPkgs, row, parsedReturn, impliedLoss };
  });

  const hasUnresolved = activeRows.some((r) => r.impliedLoss > 0.01 && !r.row.lossReason);

  function handleConfirm() {
    for (const { l, parsedReturn, litersPerPkg } of activeRows) {
      if (litersPerPkg <= 0) continue;
      const fullPkgs = Math.floor(parsedReturn);
      if (fullPkgs > 0) onReturn(l.productId, fullPkgs);
    }
    onDone();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white pb-safe-area shadow-xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 border-b border-black/8 bg-white px-4 py-3">
          <h3 className="text-base font-black text-ink">Pulver zurückbuchen</h3>
          <p className="text-xs text-black/50">
            Restbestand zurück ins Lager oder als Verlust buchen.
          </p>
        </div>

        <div className="divide-y divide-black/6">
          {activeRows.map(({ l, litersPerPkg, remainingPkgs, row, parsedReturn, impliedLoss }) => (
            <div key={l.productId} className="px-4 py-4">
              <p className="mb-3 text-sm font-black text-ink">{l.name}</p>

              {/* Formula bar */}
              <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-[#f5f5f0] p-2 text-center text-xs">
                <div>
                  <p className="font-semibold text-black/50">Restbestand</p>
                  <p className="mt-0.5 font-black text-ink">
                    {litersPerPkg > 0 ? `${remainingPkgs.toFixed(2)} Pkg` : `${l.remainingLiters.toFixed(2)} L`}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-black/50">Zurück ins Lager</p>
                  <p className="mt-0.5 font-black text-primaq-700">
                    {litersPerPkg > 0 ? `${Math.floor(parsedReturn)} Pkg` : "—"}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-black/50">Verlust</p>
                  <p className={`mt-0.5 font-black ${impliedLoss > 0.01 ? "text-red-600" : "text-black/35"}`}>
                    {litersPerPkg > 0 ? `${impliedLoss.toFixed(2)} Pkg` : "—"}
                  </p>
                </div>
              </div>

              {litersPerPkg > 0 ? (
                <label className="grid gap-1 text-xs font-semibold text-black/60">
                  Zurück ins Lager (ganze Pakete)
                  <div className="flex min-h-10 items-center rounded-lg border border-black/15 bg-[#fbfcf8] focus-within:border-primaq-500">
                    <input
                      autoFocus
                      inputMode="decimal"
                      value={row.returnInput}
                      onChange={(e) => patch(l.productId, { returnInput: e.target.value })}
                      placeholder={String(Math.floor(remainingPkgs))}
                      className="min-h-10 min-w-0 flex-1 bg-transparent px-3 text-sm font-bold outline-none"
                    />
                    <span className="pr-3 text-xs text-black/40">Pkg</span>
                  </div>
                </label>
              ) : (
                <p className="text-xs text-black/45">
                  Kein Paketrezept hinterlegt — Rückbuchung nicht möglich ({l.remainingLiters.toFixed(2)} L verbleibend).
                </p>
              )}

              {impliedLoss > 0.01 ? (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                  <p className="text-xs font-black text-red-700">
                    Verlust: {impliedLoss.toFixed(2)} Pkg — Grund angeben (Pflichtfeld)
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {POWDER_LOSS_REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => patch(l.productId, { lossReason: r })}
                        className={`min-h-8 rounded-lg border px-2.5 text-xs font-bold transition-colors ${
                          row.lossReason === r
                            ? "border-red-500 bg-red-600 text-white"
                            : "border-red-200 bg-white text-red-700"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  {!row.lossReason ? (
                    <p className="mt-1.5 text-xs font-semibold text-red-600">Bitte Verlustgrund auswählen.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-black/8 px-4 pb-4 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-lg border border-black/15 bg-white text-sm font-bold text-black/65"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={hasUnresolved}
            className="min-h-11 rounded-lg bg-red-600 text-sm font-bold text-white disabled:bg-black/25"
          >
            Weiter
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Material Assignment Section ──────────────────────────────────────────────

function MaterialAssignmentSection({
  shiftId,
  categories,
  items,
  assignments,
  onAssign,
}: {
  shiftId: string;
  categories: MaterialCategory[];
  items: Record<string, MaterialItem>;
  assignments: ShiftMaterialAssignment[];
  onAssign: (itemId: string, categoryId: string, qty: number) => void;
}) {
  const [showDialog, setShowDialog] = useState(false);
  const [prefillItemId, setPrefillItemId] = useState<string | null>(null);

  const assignedByItemId = Object.fromEntries(assignments.map((a) => [a.itemId, a]));

  const categoriesWithItems = categories
    .map((cat) => ({
      cat,
      catItems: cat.itemIds
        .map((id) => items[id])
        .filter((i): i is MaterialItem => !!i && i.active !== false),
    }))
    .filter((c) => c.catItems.length > 0);

  return (
    <section className="mt-4 rounded-lg border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Materialzuweisung</h2>
          <p className="mt-0.5 text-xs text-black/55">
            Verpackung &amp; Material aus dem Lager für diesen Einsatz reservieren.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setPrefillItemId(null); setShowDialog(true); }}
          className="flex shrink-0 min-h-10 items-center gap-2 rounded-lg bg-primaq-500 px-3 text-sm font-black text-white"
        >
          <Plus className="h-4 w-4" /> Aus Lager zuweisen
        </button>
      </div>

      {assignments.length === 0 ? (
        <p className="mt-4 rounded-lg bg-[#fbfcf8] p-4 text-center text-sm text-black/45">
          Noch kein Material für diesen Einsatz aus dem Lager reserviert.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {categoriesWithItems.map(({ cat, catItems }) => {
            const assignedItems = catItems.filter((i) => assignedByItemId[i.id]);
            if (assignedItems.length === 0) return null;
            return (
              <div key={cat.id} className="rounded-lg border border-black/8 bg-[#fbfcf8]">
                <p className="px-3 pt-3 text-xs font-black uppercase tracking-wide text-ink/60">
                  {cat.name}
                </p>
                <div className="divide-y divide-black/6">
                  {assignedItems.map((item) => {
                    const a = assignedByItemId[item.id]!;
                    const consumed = a.consumedQty ?? 0;
                    const remaining = Math.max(0, a.assignedQty - consumed - a.returnedQty - a.lossQty);
                    const isEmpty = remaining === 0 && a.assignedQty > 0;
                    const isLow = !isEmpty && item.minQuantity != null && remaining < item.minQuantity;
                    const canRefill = item.quantityOnHand > 0;
                    return (
                      <div key={item.id} className="px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-bold text-ink">{item.name}</p>
                              {isEmpty ? <span className="rounded bg-red-100 px-1 text-[10px] font-black text-red-700">LEER</span>
                                : isLow ? <span className="rounded bg-yellow-100 px-1 text-[10px] font-black text-yellow-700">NIEDRIG</span>
                                : null}
                            </div>
                            <div className="mt-0.5 flex gap-3 text-[11px] text-black/45">
                              <span>Start: {formatQuantity(a.assignedQty, item.unit)}</span>
                              {consumed > 0 ? <span className="text-orange-600">−{formatQuantity(consumed, item.unit)} Verkauf</span> : null}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className={`text-base font-black tabular-nums ${isEmpty ? "text-red-600" : isLow ? "text-yellow-700" : "text-primaq-700"}`}>
                              {formatQuantity(remaining, item.unit)}
                            </p>
                            <p className="text-xs text-black/40">verbleibend</p>
                          </div>
                          <button
                            type="button"
                            disabled={!canRefill}
                            onClick={() => { setPrefillItemId(item.id); setShowDialog(true); }}
                            title={!canRefill ? "Kein Bestand im Lager verfügbar" : undefined}
                            className={`min-h-9 shrink-0 rounded-lg px-2.5 text-xs font-black ${
                              canRefill
                                ? "border border-primaq-300 bg-primaq-50 text-primaq-700"
                                : "border border-black/10 bg-black/5 text-black/30 cursor-not-allowed"
                            }`}
                          >
                            + Nachfüllen
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showDialog ? (
        <MaterialAssignmentDialog
          shiftId={shiftId}
          categories={categories}
          items={items}
          assignments={assignments}
          prefillItemId={prefillItemId}
          onAssign={onAssign}
          onClose={() => setShowDialog(false)}
        />
      ) : null}
    </section>
  );
}

// ─── Assignment Dialog ─────────────────────────────────────────────────────────

function MaterialAssignmentDialog({
  shiftId,
  categories,
  items,
  assignments,
  prefillItemId,
  onAssign,
  onClose,
}: {
  shiftId: string;
  categories: MaterialCategory[];
  items: Record<string, MaterialItem>;
  assignments: ShiftMaterialAssignment[];
  prefillItemId: string | null;
  onAssign: (itemId: string, categoryId: string, qty: number) => void;
  onClose: () => void;
}) {
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const categoriesWithItems = categories
    .map((cat) => ({
      cat,
      catItems: cat.itemIds
        .map((id) => items[id])
        .filter((i): i is MaterialItem => !!i && i.active !== false),
    }))
    .filter((c) => c.catItems.length > 0);

  function handleSubmit() {
    const newErrors: Record<string, string> = {};
    let hasAny = false;

    for (const { cat, catItems } of categoriesWithItems) {
      for (const item of catItems) {
        const raw = qtys[item.id] ?? "";
        if (!raw.trim()) continue;
        const parsed = parseQuantityInput(raw);
        if (!parsed || parsed <= 0) {
          newErrors[item.id] = "Ungültige Menge";
          continue;
        }
        if (parsed > item.quantityOnHand) {
          newErrors[item.id] = `Max: ${formatQuantity(item.quantityOnHand, item.unit)}`;
          continue;
        }
        hasAny = true;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    if (!hasAny) { onClose(); return; }

    for (const { cat, catItems } of categoriesWithItems) {
      for (const item of catItems) {
        const raw = qtys[item.id] ?? "";
        if (!raw.trim()) continue;
        const parsed = parseQuantityInput(raw);
        if (parsed && parsed > 0) {
          onAssign(item.id, cat.id, parsed);
        }
      }
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white pb-safe-area shadow-xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/8 bg-white px-4 py-3">
          <div>
            <h3 className="text-base font-black text-ink">
              {prefillItemId ? "Nachfüllen aus Lager" : "Aus Lager zuweisen"}
            </h3>
            <p className="text-xs text-black/50">Menge leer lassen = nicht zuweisen</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-9 min-w-9 items-center justify-center rounded-lg bg-black/6 text-sm font-black text-black/50"
          >
            ✕
          </button>
        </div>

        <div className="divide-y divide-black/6">
          {categoriesWithItems.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-black/40">
              Keine aktiven Artikel im Lager vorhanden.
            </p>
          ) : (
            categoriesWithItems.map(({ cat, catItems }) => (
              <div key={cat.id} className="px-4 py-3">
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-ink/55">
                  {cat.name}
                </p>
                <div className="grid gap-2">
                  {catItems.map((item) => {
                    const existing = assignments.find((a) => a.itemId === item.id);
                    const alreadyAssigned = existing
                      ? existing.assignedQty - existing.returnedQty - existing.lossQty
                      : 0;
                    return (
                      <div key={item.id} className={`flex items-center gap-2 rounded-lg px-1 py-1 ${prefillItemId === item.id ? "bg-primaq-50 ring-1 ring-primaq-300" : ""}`}>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-ink">{item.name}</p>
                          <p className="text-xs text-black/40">
                            Lagerbestand: {formatQuantity(item.quantityOnHand, item.unit)}
                            {alreadyAssigned > 0 ? ` · Im Einsatz: ${formatQuantity(alreadyAssigned, item.unit)}` : ""}
                          </p>
                          {errors[item.id] ? (
                            <p className="text-xs font-semibold text-red-600">{errors[item.id]}</p>
                          ) : null}
                        </div>
                        <div className={`flex min-h-9 w-28 shrink-0 items-center rounded-lg border bg-[#fbfcf8] focus-within:border-primaq-500 ${errors[item.id] ? "border-red-400" : "border-black/15"}`}>
                          <input
                            autoFocus={prefillItemId === item.id}
                            inputMode="decimal"
                            value={qtys[item.id] ?? ""}
                            onChange={(e) => {
                              setQtys((q) => ({ ...q, [item.id]: e.target.value }));
                              setErrors((er) => { const n = { ...er }; delete n[item.id]; return n; });
                            }}
                            placeholder="0"
                            className="min-h-9 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none"
                          />
                          <span className="pr-2 text-xs text-black/35">{item.unit}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-black/8 px-4 pb-4 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-lg border border-black/15 bg-white text-sm font-bold text-black/65"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="min-h-11 rounded-lg bg-primaq-500 text-sm font-bold text-white"
          >
            Zuweisen
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Return Dialog ─────────────────────────────────────────────────────────────

const LOSS_REASONS = ["Entsorgt", "Verdorben", "Beschädigt", "Sonstiges"] as const;

function MaterialReturnDialog({
  assignments,
  items,
  onReturn,
  onDone,
  onClose,
}: {
  assignments: ShiftMaterialAssignment[];
  items: Record<string, MaterialItem>;
  onReturn: (itemId: string, returnQty: number, lossQty: number, lossReason?: string) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  type RowState = { returnInput: string; lossReason: string };
  const initialRows = Object.fromEntries(
    assignments.map((a) => {
      // physischer Restbestand = zugewiesen - verbraucht (Verkauf) - bereits zurück/verloren
      const physRemaining = Math.max(0, a.assignedQty - (a.consumedQty ?? 0) - a.returnedQty - a.lossQty);
      return [a.itemId, { returnInput: String(physRemaining), lossReason: "" } as RowState];
    })
  );
  const [rows, setRows] = useState<Record<string, RowState>>(initialRows);

  function patch(itemId: string, p: Partial<RowState>) {
    setRows((r) => ({ ...r, [itemId]: { ...r[itemId], ...p } }));
  }

  const activeRows = assignments
    .map((a) => {
      const remaining = Math.max(0, a.assignedQty - (a.consumedQty ?? 0) - a.returnedQty - a.lossQty);
      const row = rows[a.itemId] ?? { returnInput: String(remaining), lossReason: "" };
      const parsedReturn = Math.min(remaining, Math.max(0, parseQuantityInput(row.returnInput) ?? 0));
      const impliedLoss = remaining - parsedReturn;
      return { a, remaining, row, parsedReturn, impliedLoss, unit: items[a.itemId]?.unit ?? a.unit };
    })
    .filter((r) => r.remaining > 0);

  const hasUnresolvedLoss = activeRows.some((r) => r.impliedLoss > 0 && !r.row.lossReason);

  function handleConfirm() {
    for (const { a, remaining, row, parsedReturn, impliedLoss } of activeRows) {
      onReturn(a.itemId, parsedReturn, impliedLoss, impliedLoss > 0 ? (row.lossReason || "Sonstiges") : undefined);
    }
    onDone();
  }

  if (assignments.length === 0) {
    onDone();
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white pb-safe-area shadow-xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 border-b border-black/8 bg-white px-4 py-3">
          <h3 className="text-base font-black text-ink">Material zurückbuchen</h3>
          <p className="text-xs text-black/50">
            Restbestand zurück ins Lager buchen. Differenz wird als Verlust gebucht.
          </p>
        </div>

        <div className="divide-y divide-black/6">
          {activeRows.map(({ a, remaining, row, parsedReturn, impliedLoss, unit }) => (
            <div key={a.itemId} className="px-4 py-4">
              <p className="mb-3 text-sm font-black text-ink">{a.itemName}</p>

              {/* Formula bar */}
              {(a.consumedQty ?? 0) > 0 ? (
                <div className="mb-2 flex gap-3 rounded-lg bg-orange-50 px-3 py-2 text-xs">
                  <span className="font-semibold text-black/50">Verbraucht (Verkauf):</span>
                  <span className="font-black text-orange-600">−{formatQuantity(a.consumedQty!, unit)}</span>
                  <span className="ml-auto font-semibold text-black/50">Restbestand: {formatQuantity(remaining, unit)}</span>
                </div>
              ) : null}
              <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-[#f5f5f0] p-2 text-center text-xs">
                <div>
                  <p className="font-semibold text-black/50">Restbestand</p>
                  <p className="mt-0.5 font-black text-ink">{formatQuantity(remaining, unit)}</p>
                </div>
                <div>
                  <p className="font-semibold text-black/50">Zurück ins Lager</p>
                  <p className="mt-0.5 font-black text-primaq-700">{formatQuantity(parsedReturn, unit)}</p>
                </div>
                <div>
                  <p className="font-semibold text-black/50">Verlust</p>
                  <p className={`mt-0.5 font-black ${impliedLoss > 0 ? "text-red-600" : "text-black/35"}`}>
                    {formatQuantity(impliedLoss, unit)}
                  </p>
                </div>
              </div>

              <label className="grid gap-1 text-xs font-semibold text-black/60">
                Zurück ins Lager ({unit})
                <div className="flex min-h-10 items-center rounded-lg border border-black/15 bg-[#fbfcf8] focus-within:border-primaq-500">
                  <input
                    autoFocus
                    inputMode="decimal"
                    value={row.returnInput}
                    onChange={(e) => patch(a.itemId, { returnInput: e.target.value })}
                    className="min-h-10 min-w-0 flex-1 bg-transparent px-3 text-sm font-bold outline-none"
                  />
                  <span className="pr-3 text-xs text-black/40">{unit}</span>
                </div>
              </label>

              {impliedLoss > 0 ? (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                  <p className="text-xs font-black text-red-700">
                    Verlust: {formatQuantity(impliedLoss, unit)} — Grund angeben (Pflichtfeld)
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {LOSS_REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => patch(a.itemId, { lossReason: r })}
                        className={`min-h-8 rounded-lg border px-2.5 text-xs font-bold transition-colors ${
                          row.lossReason === r
                            ? "border-red-500 bg-red-600 text-white"
                            : "border-red-200 bg-white text-red-700"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  {!row.lossReason ? (
                    <p className="mt-1.5 text-xs font-semibold text-red-600">Bitte Verlustgrund auswählen.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-black/8 px-4 pb-4 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-lg border border-black/15 bg-white text-sm font-bold text-black/65"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={hasUnresolvedLoss}
            className="min-h-11 rounded-lg bg-red-600 text-sm font-bold text-white disabled:bg-black/25"
          >
            Einsatz beenden
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Phase 4: Automatischer Einsatzabschluss ─────────────────────────────────

function AbschlussSheet({
  shift,
  totals,
  completedOrders,
  mixLines,
  materialCostReport,
  onCreateReport,
  onConfirm,
  onCancel,
}: {
  shift: Shift;
  totals: MvpTotals;
  completedOrders: DailyOrder[];
  mixLines: MixInventoryLine[];
  generalStock: Record<string, GeneralStockItem>;
  materialCostReport: MaterialCostReport;
  existingReport: DayReport | null;
  onCreateReport: (endCashCents: number) => DayReport | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const salesCount = completedOrders.filter((o) => o.status === "completed").length;

  // Per-Sorte aus completedOrders aggregieren
  const flavorCounts: Record<string, number> = {};
  for (const order of completedOrders) {
    if (order.status !== "completed") continue;
    for (const item of order.items) {
      const name = withoutMachinePrefix(item.name);
      flavorCounts[name] = (flavorCounts[name] ?? 0) + item.quantity;
    }
  }
  const flavorList = Object.entries(flavorCounts).filter(([, c]) => c > 0).sort(([, a], [, b]) => b - a);

  // Pulververbrauch aus mixLines näherungsweise in Pakete umrechnen
  const powderUsage = mixLines
    .filter((l) => l.consumedLiters > 0)
    .map((l) => {
      const r = l.recipe;
      const pkgKg = typeof r.packageKg === "number" && r.packageKg > 0 ? r.packageKg : r.powderKgPerBatch;
      const pkgs = r.mixLitersPerBatch > 0 ? (l.consumedLiters / r.mixLitersPerBatch) * (r.powderKgPerBatch / pkgKg) : 0;
      return { name: l.name, pkgs };
    });

  // Auto-Bericht beim Öffnen erzeugen (einmalig pro Mount, sonst Render-Loop:
  // onCreateReport erzeugt jedes Mal ein neues Report-Objekt -> setState -> Re-Render)
  useEffect(() => {
    onCreateReport(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exportCsv() {
    const rows: [string, string][] = [
      ["Einsatz", shift.eventName],
      ["Datum", shift.date],
      ["Bereich", salesAreaLabels[shift.salesArea]],
      ["", ""],
      ["Verkäufe", String(salesCount)],
      ["Portionen", String(totals.totalPieces)],
      ["Umsatz", formatCurrency(totals.expectedRevenueCents)],
      ["Bar", formatCurrency(totals.cashCents)],
      ["Karte", formatCurrency(totals.cardCents)],
      ["", ""],
      ...flavorList.map(([n, c]): [string, string] => [`Sorte ${n}`, String(c)]),
      ["", ""],
      ...powderUsage.map((l): [string, string] => [`Pulver ${l.name}`, `${Math.round(l.pkgs * 10) / 10} Pkg`]),
      ["", ""],
      ...materialCostReport.lines.map((l): [string, string] => [
        `Material ${l.itemName}`, `${l.assignedQty - l.returnedQty} ${l.unit}`
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `primaq-abschluss-${shift.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white pb-safe-area shadow-xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/8 bg-white px-4 py-3">
          <div>
            <h3 className="text-base font-black text-ink">Einsatz beenden</h3>
            <p className="text-xs text-black/50">{shift.eventName} · {shift.date}</p>
          </div>
          <button type="button" onClick={onCancel}
            className="flex min-h-9 min-w-9 items-center justify-center rounded-lg bg-black/6 text-sm font-black text-black/50">✕</button>
        </div>

        <div className="divide-y divide-black/6 px-4">
          <div className="py-4">
            <p className="text-xs font-bold uppercase tracking-wide text-black/40">Zusammenfassung</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-[#f7f8f4] p-3 text-center">
                <p className="text-2xl font-black text-ink">{salesCount}</p>
                <p className="text-[10px] font-semibold uppercase text-black/45">Verkäufe</p>
              </div>
              <div className="rounded-lg bg-[#f7f8f4] p-3 text-center">
                <p className="text-2xl font-black text-ink">{totals.totalPieces}</p>
                <p className="text-[10px] font-semibold uppercase text-black/45">Portionen</p>
              </div>
              <div className="rounded-lg bg-primaq-50 p-3 text-center">
                <p className="text-xl font-black text-primaq-700">{formatCurrency(totals.expectedRevenueCents)}</p>
                <p className="text-[10px] font-semibold uppercase text-primaq-600">Umsatz</p>
              </div>
            </div>
          </div>

          {flavorList.length > 0 ? (
            <div className="py-4">
              <p className="text-xs font-bold uppercase tracking-wide text-black/40">Sorten</p>
              <div className="mt-2 grid gap-1">
                {flavorList.map(([name, count]) => (
                  <div key={name} className="flex justify-between gap-2 text-sm">
                    <span className="text-black/70">{name}</span>
                    <span className="font-black tabular-nums text-ink">{count} Port.</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {powderUsage.length > 0 ? (
            <div className="py-4">
              <p className="text-xs font-bold uppercase tracking-wide text-black/40">Pulververbrauch</p>
              <div className="mt-2 grid gap-1">
                {powderUsage.map((l) => (
                  <div key={l.name} className="flex justify-between gap-2 text-sm">
                    <span className="text-black/70">{l.name}</span>
                    <span className="font-black tabular-nums text-ink">≈ {Math.round(l.pkgs * 10) / 10} Pkg</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {materialCostReport.lines.length > 0 ? (
            <div className="py-4">
              <p className="text-xs font-bold uppercase tracking-wide text-black/40">Material</p>
              <div className="mt-2 grid gap-1">
                {materialCostReport.lines.map((l) => (
                  <div key={l.itemId} className="flex justify-between gap-2 text-sm">
                    <span className="text-black/70">{l.itemName}</span>
                    <span className="font-black tabular-nums text-ink">{l.assignedQty - l.returnedQty} {l.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-2 py-4">
            <button type="button" onClick={exportCsv}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white text-sm font-bold text-ink">
              <Download className="h-4 w-4" /> CSV exportieren
            </button>
            <button type="button" onClick={onConfirm}
              className="min-h-12 w-full rounded-lg bg-primaq-500 text-base font-black text-white">
              Einsatz jetzt beenden
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
