"use client";

import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatCurrency, formatQuantity, parseQuantityInput, toCents } from "./calculations";
import { defaultSoftServeRecipe, isGenericSoftMixInventoryName } from "./catalog";
import type { GeneralStockItem, InventoryLine, InventoryReport, MaterialCategory, MaterialItem } from "./types";
import { useMvpStore } from "./use-mvp-store";
import type { MixStockInput, SoftServeRecipe } from "./types";

export function InventoryClient() {
  const {
    hydrated,
    inventory,
    inventoryMovements,
    inventoryReport,
    generalStock,
    generalStockMovements,
    addGeneralStockItem,
    updateGeneralStockItem,
    deactivateGeneralStockItem,
    addGeneralStockReceipt,
    addGeneralStockDeduction,
    reactivateGeneralStockItem,
    updateInventoryLine,
    addInventoryMovement,
    materialCategories,
    materialItems,
    shiftMaterialAssignments,
    activeShift,
    addMaterialCategory,
    renameMaterialCategory,
    deleteMaterialCategory,
    purgeOrphanedMaterialItems,
    addMaterialItem,
    addMaterialItemWithMovement,
    updateMaterialItem,
    addMaterialMovement,
    resetFlavorStockOnly,
  } = useMvpStore();

  // Verwaiste Artikel: existieren in materialItems aber in keiner Kategorie
  const validItemIds = new Set<string>();
  for (const cat of materialCategories) {
    for (const id of cat.itemIds) validItemIds.add(id);
  }
  const orphanedItems = Object.values(materialItems).filter((i) => !validItemIds.has(i.id));

  // netQty = was aktuell physisch im Einsatz ist (zugewiesen - verbraucht - zurück - verloren)
  const activeAssignmentsByItemId = Object.fromEntries(
    (activeShift
      ? shiftMaterialAssignments.filter((a) => a.shiftId === activeShift.id)
      : []
    ).map((a) => [a.itemId, Math.max(0, a.assignedQty - (a.consumedQty ?? 0) - a.returnedQty - a.lossQty)])
  );
  const consumedQtyByItemId = Object.fromEntries(
    (activeShift
      ? shiftMaterialAssignments.filter((a) => a.shiftId === activeShift.id)
      : []
    ).map((a) => [a.itemId, a.consumedQty ?? 0])
  );

  if (!hydrated) {
    return <div className="animate-pulse rounded-lg border border-black/10 bg-white p-8 text-center text-sm text-black/40">Laden…</div>;
  }

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-primaq-500/20 bg-primaq-50 p-4">
        <div>
          <h2 className="text-base font-bold text-primaq-800">Einsatz-Bestand</h2>
          <p className="mt-1 text-sm leading-5 text-primaq-700">
            Mixbestand, Restportionen und Nachfüllungen pro Sorte werden auf der Einsätze-Seite verwaltet.
          </p>
        </div>
        <div className="mt-3">
          <Link href="/einsaetze" className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primaq-500 px-4 text-sm font-bold text-white">
            Zu Einsätze →
          </Link>
        </div>
      </section>

      <GeneralStockPanel
        items={generalStock}
        movements={generalStockMovements}
        mixLines={inventoryReport.mixLines}
        onAdd={addGeneralStockItem}
        onUpdate={updateGeneralStockItem}
        onDeactivate={deactivateGeneralStockItem}
        onReceipt={addGeneralStockReceipt}
        onDeduction={addGeneralStockDeduction}
        onReactivate={reactivateGeneralStockItem}
        onResetMixStock={(flavorId) => resetFlavorStockOnly(flavorId, true)}
      />

      {orphanedItems.length > 0 && (
        <OrphanedItemsBanner count={orphanedItems.length} onPurge={purgeOrphanedMaterialItems} />
      )}

      <MaterialPanel
        categories={materialCategories}
        items={materialItems}
        movements={inventoryMovements}
        activeAssignmentsByItemId={activeAssignmentsByItemId}
        consumedQtyByItemId={consumedQtyByItemId}
        onAddCategory={addMaterialCategory}
        onRenameCategory={renameMaterialCategory}
        onDeleteCategory={deleteMaterialCategory}
        onAddItem={addMaterialItem}
        onAddItemWithMovement={addMaterialItemWithMovement}
        onUpdateItem={updateMaterialItem}
        onMovement={addMaterialMovement}
      />
    </div>
  );
}

type WarenInput = {
  productName: string; flavorName: string; manufacturer?: string;
  recipe: SoftServeRecipe; unit: "Pkg" | "kg" | "Stück";
  initialQuantity?: number; minQuantity?: number | null; purchasePriceCents?: number | null; note?: string;
};
type WarenPatch = {
  productName?: string; flavorName?: string; manufacturer?: string;
  recipe?: SoftServeRecipe; unit?: "Pkg" | "kg" | "Stück";
  minQuantity?: number | null; purchasePriceCents?: number | null; note?: string;
};
type ReceiptInput = { quantity: number; date: string; priceCents?: number | null; note?: string };
type DeductionInput = { quantity: number; reason: string; note?: string };

function formatDate(dateStr: string) {
  try {
    return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function GeneralStockPanel({
  items,
  movements,
  mixLines,
  onAdd,
  onUpdate,
  onDeactivate,
  onReceipt,
  onDeduction,
  onReactivate,
  onResetMixStock,
}: {
  items: Record<string, GeneralStockItem>;
  movements: Record<string, import("./types").GeneralStockMovement[]>;
  mixLines: InventoryReport["mixLines"];
  onAdd: (input: WarenInput) => void;
  onUpdate: (id: string, patch: WarenPatch) => void;
  onDeactivate: (id: string) => void;
  onReceipt: (itemId: string, input: ReceiptInput) => void;
  onDeduction: (itemId: string, input: DeductionInput) => void;
  onReactivate: (itemId: string) => void;
  onResetMixStock: (flavorId: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const allItems = Object.values(items);
  const activeItems = allItems.filter((i) => i.active !== false);
  const inactiveItems = allItems.filter((i) => i.active === false);
  const visibleItems = showInactive ? allItems : activeItems;

  return (
    <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Pulver-Lager</h2>
          <p className="mt-1 text-sm text-black/60">Allgemeiner Warenbestand. Unabhängig von Maschinen und Sorten.</p>
        </div>
        <button
          type="button"
          onClick={() => { setShowAdd(true); setEditingId(null); setCopyingId(null); }}
          className="flex shrink-0 min-h-10 items-center gap-2 rounded-lg bg-primaq-500 px-3 text-sm font-black text-white"
        >
          <Plus className="h-4 w-4" /> Ware anlegen
        </button>
      </div>

      {showAdd ? (
        <div className="mt-4">
          <WarenForm
            onCancel={() => setShowAdd(false)}
            onSubmit={(input) => { onAdd(input); setShowAdd(false); }}
          />
        </div>
      ) : null}

      {copyingId ? (() => {
        const src = items[copyingId];
        return src ? (
          <div className="mt-4">
            <WarenForm
              templateOf={src}
              onCancel={() => setCopyingId(null)}
              onSubmit={(input) => { onAdd(input); setCopyingId(null); }}
            />
          </div>
        ) : null;
      })() : null}

      {visibleItems.length === 0 && !showAdd ? (
        <p className="mt-4 rounded-lg bg-[#fbfcf8] p-3 text-sm text-black/50">
          Noch keine Waren angelegt. Klicke auf &bdquo;Ware anlegen&ldquo;, um zu beginnen.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {visibleItems.map((item) => {
            const mixLine = item.flavorId
              ? mixLines.find((l) => l.productId === item.flavorId)
              : undefined;
            return editingId === item.id ? (
              <WarenForm
                key={item.id}
                initial={item}
                onCancel={() => setEditingId(null)}
                onSubmit={(patch) => { onUpdate(item.id, patch); setEditingId(null); }}
              />
            ) : (
              <WarenCard
                key={item.id}
                item={item}
                mixLine={mixLine}
                movements={movements[item.id] ?? []}
                onEdit={() => { setEditingId(item.id); setCopyingId(null); setShowAdd(false); }}
                onCopy={() => { setCopyingId(item.id); setEditingId(null); setShowAdd(false); }}
                onDeactivate={() => onDeactivate(item.id)}
                onReactivate={() => onReactivate(item.id)}
                onReceipt={(input) => onReceipt(item.id, input)}
                onDeduction={(input) => onDeduction(item.id, input)}
                onResetMixStock={item.flavorId ? () => onResetMixStock(item.flavorId!) : undefined}
              />
            );
          })}
        </div>
      )}

      {inactiveItems.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowInactive((v) => !v)}
          className="mt-3 text-xs font-semibold text-black/45 underline"
        >
          {showInactive ? "Deaktivierte ausblenden" : `${inactiveItems.length} deaktivierte Ware${inactiveItems.length !== 1 ? "n" : ""} anzeigen`}
        </button>
      ) : null}
    </section>
  );
}

function WarenCard({
  item,
  mixLine,
  movements,
  onEdit,
  onCopy,
  onDeactivate,
  onReactivate,
  onReceipt,
  onDeduction,
  onResetMixStock,
}: {
  item: GeneralStockItem;
  mixLine: import("./types").MixInventoryLine | undefined;
  movements: import("./types").GeneralStockMovement[];
  onEdit: () => void;
  onCopy: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onReceipt: (input: ReceiptInput) => void;
  onDeduction: (input: DeductionInput) => void;
  onResetMixStock?: () => void;
}) {
  const [panel, setPanel] = useState<"receipt" | "deduction" | "correction" | null>(null);
  const [confirmZero, setConfirmZero] = useState(false);
  const [confirmMixReset, setConfirmMixReset] = useState(false);

  // receipt fields
  const [qty, setQty] = useState("");
  const [receiveDate, setReceiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [price, setPrice] = useState("");
  const [receiptReason, setReceiptReason] = useState<"Einkauf" | "Rückgabe" | "Korrektur" | "">("Einkauf");

  // deduction fields
  const [deductQty, setDeductQty] = useState("");
  const [deductReason, setDeductReason] = useState<"Verbrauch" | "Verlust" | "Korrektur" | "Vertippt" | "Sonstiges">("Verbrauch");
  const [deductNote, setDeductNote] = useState("");

  // correction fields
  const [correctionTarget, setCorrectionTarget] = useState("");

  const r = item.recipe;
  const isInactive = item.active === false;
  const lastReceipt = [...movements].reverse().find((m) => m.type === "receipt");
  const lastDeduction = [...movements].reverse().find((m) => m.type === "deduction");

  // Einsatz-Bestand: liters in machine → approximate packages
  const pkgsInUse = (() => {
    if (!mixLine || mixLine.remainingLiters <= 0 || r.mixLitersPerBatch <= 0) return 0;
    const packageKg = typeof r.packageKg === "number" && r.packageKg > 0 ? r.packageKg : r.powderKgPerBatch;
    const batches = mixLine.remainingLiters / r.mixLitersPerBatch;
    return batches * (r.powderKgPerBatch / packageKg);
  })();
  const pkgsInUsRounded = Math.round(pkgsInUse * 10) / 10;
  const showEinsatz = mixLine !== undefined;

  const correctionParsed = parseQuantityInput(correctionTarget);
  const correctionDelta = typeof correctionParsed === "number" ? Math.round((correctionParsed - item.quantityOnHand) * 1000) / 1000 : null;
  const belowMin = item.minQuantity != null && item.minQuantity > 0 && item.quantityOnHand > 0 && item.quantityOnHand < item.minQuantity;

  function commitReceipt() {
    const q = parseQuantityInput(qty);
    if (!q || q <= 0) return;
    const note = receiptReason || undefined;
    onReceipt({ quantity: q, date: receiveDate, priceCents: price.trim() ? toCents(price) : null, note });
    setQty(""); setPrice("");
    setPanel(null);
  }

  function commitDeduction() {
    const q = parseQuantityInput(deductQty);
    if (!q || q <= 0) return;
    onDeduction({ quantity: q, reason: deductReason, note: deductNote.trim() || undefined });
    setDeductQty(""); setDeductNote("");
    setPanel(null);
  }

  function commitCorrection() {
    if (correctionDelta === null) return;
    if (correctionDelta === 0) { setPanel(null); return; }
    const label = `Korrektur von ${formatQuantity(item.quantityOnHand, item.unit)} auf ${formatQuantity(correctionParsed!, item.unit)}`;
    if (correctionDelta > 0) {
      onReceipt({ quantity: correctionDelta, date: new Date().toISOString().slice(0, 10), note: label });
    } else {
      onDeduction({ quantity: Math.abs(correctionDelta), reason: "Korrektur", note: label });
    }
    setCorrectionTarget("");
    setPanel(null);
  }

  function commitZero() {
    if (item.quantityOnHand > 0) {
      onDeduction({ quantity: item.quantityOnHand, reason: "Korrektur", note: "Bestand auf 0 gesetzt" });
    }
    setConfirmZero(false);
  }

  function togglePanel(p: "receipt" | "deduction" | "correction") {
    setPanel(panel === p ? null : p);
    setConfirmZero(false);
    setConfirmMixReset(false);
  }

  return (
    <div className={`overflow-hidden rounded-lg border ${isInactive ? "border-black/8 bg-black/3 opacity-60" : "border-black/8 bg-[#fbfcf8]"}`}>
      {/* Info row */}
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="font-bold text-ink">{item.productName}</p>
          <p className="text-xs font-semibold text-black/50">
            {item.flavorName}{item.manufacturer ? ` · ${item.manufacturer}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-black/40">
            Rezept: {formatQuantity(r.powderKgPerBatch, "kg")} + {formatQuantity(r.waterLitersPerBatch, "L")} = {formatQuantity(r.mixLitersPerBatch, "L")} Mix
            {item.note ? ` · ${item.note}` : ""}
          </p>
        </div>
        {!isInactive ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={onEdit} className="min-h-9 rounded-lg border border-black/15 bg-white px-3 text-xs font-black text-black/65">
              Bearbeiten
            </button>
            <button type="button" onClick={onCopy} className="min-h-9 rounded-lg border border-black/15 bg-white px-3 text-xs font-black text-black/65">
              Kopieren
            </button>
            <button type="button" onClick={onDeactivate}
              className="min-h-9 rounded-lg border border-black/15 bg-white px-3 text-xs font-black text-black/45"
              title={movements.length > 0 ? "Deaktivieren" : "Löschen"}>
              {movements.length > 0 ? "Deaktiv." : "Löschen"}
            </button>
          </div>
        ) : (
          <button type="button" onClick={onReactivate}
            className="shrink-0 min-h-9 rounded-lg border border-primaq-300 bg-primaq-50 px-3 text-xs font-black text-primaq-700">
            Wiederherstellen
          </button>
        )}
      </div>

      {/* Stock row */}
      {!isInactive ? (
        <>
          <div className="flex items-center gap-2 border-t border-black/6 px-3 pb-2 pt-2">
            <div className="flex-1">
              {showEinsatz ? (
                <div className="grid gap-0.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-2xl font-black tabular-nums ${belowMin ? "text-yellow-600" : "text-ink"}`}>{formatQuantity(item.quantityOnHand, item.unit)}</span>
                    <span className="text-xs font-semibold text-black/40">im Lager</span>
                    {belowMin ? <span className="text-xs font-semibold text-yellow-600">⚠ unter Mindestbestand</span> : null}
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-base font-bold tabular-nums text-primaq-700">
                      {pkgsInUsRounded % 1 === 0 ? pkgsInUsRounded : pkgsInUsRounded.toFixed(1)} {item.unit}
                    </span>
                    <span className="text-xs font-semibold text-black/40">
                      im Einsatz ≈ {Math.round(mixLine!.remainingLiters * 10) / 10} L
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-base font-semibold tabular-nums text-black/65">
                      {Math.round((item.quantityOnHand + pkgsInUsRounded) * 10) / 10} {item.unit}
                    </span>
                    <span className="text-xs font-semibold text-black/40">gesamt</span>
                  </div>
                </div>
              ) : (
                <div>
                  <span className={`text-2xl font-black tabular-nums ${belowMin ? "text-yellow-600" : "text-ink"}`}>{formatQuantity(item.quantityOnHand, item.unit)}</span>
                  {belowMin ? <span className="ml-2 text-xs font-semibold text-yellow-600">⚠ unter Mindestbestand</span> : null}
                </div>
              )}
              {item.minQuantity != null && item.minQuantity > 0 ? (
                <p className="text-xs text-black/35">Min: {formatQuantity(item.minQuantity, item.unit)}</p>
              ) : null}
              {item.purchasePriceCents ? (
                <p className="text-xs text-black/45">{formatCurrency(item.purchasePriceCents)}/{item.unit}</p>
              ) : null}
            </div>
            <button type="button" onClick={() => togglePanel("deduction")}
              className={`min-h-12 w-14 rounded-lg text-2xl font-black ${panel === "deduction" ? "bg-red-500 text-white" : "border border-red-200 bg-red-50 text-red-700"}`}>
              −
            </button>
            <button type="button" onClick={() => togglePanel("receipt")}
              className={`min-h-12 w-14 rounded-lg text-2xl font-black ${panel === "receipt" ? "bg-primaq-500 text-white" : "border border-primaq-300 bg-primaq-50 text-primaq-700"}`}>
              +
            </button>
          </div>
          {/* Secondary action buttons */}
          <div className="flex gap-1.5 border-t border-black/5 px-3 pb-3 pt-2">
            <button type="button" onClick={() => { togglePanel("correction"); setCorrectionTarget(""); }}
              className={`min-h-9 flex-1 rounded-lg border text-xs font-black ${panel === "correction" ? "border-primaq-400 bg-primaq-100 text-primaq-800" : "border-black/12 bg-white text-black/60"}`}>
              Bestand korrigieren
            </button>
            {confirmZero ? (
              <>
                <span className="flex items-center text-xs font-semibold text-red-700">Auf 0 setzen?</span>
                <button type="button" onClick={() => setConfirmZero(false)} className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-xs font-black text-black/60">Nein</button>
                <button type="button" onClick={commitZero} className="min-h-9 rounded-lg bg-red-600 px-2 text-xs font-black text-white">Ja</button>
              </>
            ) : (
              <button type="button" onClick={() => { setConfirmZero(true); setPanel(null); setConfirmMixReset(false); }}
                className="min-h-9 rounded-lg border border-red-200 bg-white px-3 text-xs font-black text-red-700">
                Auf 0 setzen
              </button>
            )}
          </div>

          {/* Mixbestand zurücksetzen – löscht mixStocks/remainingLiters/Refills dieser Sorte */}
          {onResetMixStock ? (
            <div className="flex items-center gap-1.5 border-t border-black/5 px-3 pb-3 pt-2">
              {confirmMixReset ? (
                <>
                  <span className="flex-1 text-xs font-semibold text-orange-700">Mixbestand zurücksetzen?</span>
                  <button type="button" onClick={() => setConfirmMixReset(false)}
                    className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-xs font-black text-black/60">
                    Nein
                  </button>
                  <button type="button" onClick={() => { onResetMixStock(); setConfirmMixReset(false); }}
                    className="min-h-9 rounded-lg bg-orange-600 px-2 text-xs font-black text-white">
                    Ja, zurücksetzen
                  </button>
                </>
              ) : (
                <button type="button"
                  onClick={() => { setConfirmMixReset(true); setPanel(null); setConfirmZero(false); }}
                  className="min-h-9 rounded-lg border border-orange-200 bg-white px-3 text-xs font-black text-orange-700">
                  Mixbestand zurücksetzen
                </button>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      {/* History strip */}
      {(lastReceipt || lastDeduction) && !isInactive ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-black/6 px-3 py-2 text-xs text-black/50">
          {lastReceipt ? (
            <span>Eingang: <strong className="font-black text-green-700">+{formatQuantity(lastReceipt.quantity, item.unit)}</strong> am {formatDate(lastReceipt.date)}</span>
          ) : null}
          {lastDeduction ? (
            <span>Ausgang: <strong className="font-black text-red-700">−{formatQuantity(lastDeduction.quantity, item.unit)}</strong> am {formatDate(lastDeduction.date)}{lastDeduction.note ? ` · ${lastDeduction.note}` : ""}</span>
          ) : null}
        </div>
      ) : null}

      {/* Receipt panel */}
      {panel === "receipt" ? (
        <div className="grid gap-2 border-t border-black/8 bg-primaq-50 px-3 pb-3 pt-2">
          <p className="text-xs font-black text-primaq-800">+ Bestand erhöhen</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-black/60">
              Menge ({item.unit})
              <div className="flex min-h-10 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
                <input autoFocus inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitReceipt(); if (e.key === "Escape") setPanel(null); }}
                  className="min-h-10 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none" placeholder="0" />
                <span className="pr-2 text-xs text-black/40">{item.unit}</span>
              </div>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-black/60">
              Datum
              <input type="date" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)}
                className="min-h-10 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
            </label>
            <fieldset className="grid gap-1">
              <legend className="text-xs font-semibold text-black/60">Grund (optional)</legend>
              <div className="grid grid-cols-3 gap-1">
                {(["Einkauf", "Rückgabe", "Korrektur"] as const).map((g) => (
                  <button key={g} type="button" onClick={() => setReceiptReason(receiptReason === g ? "" : g)}
                    className={`min-h-9 rounded-lg border text-xs font-bold ${receiptReason === g ? "border-primaq-500 bg-white text-primaq-700" : "border-black/10 bg-white/70 text-black/55"}`}>
                    {g}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="grid gap-1 text-xs font-semibold text-black/60">
              Preis/{item.unit} (opt.)
              <div className="flex min-h-10 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
                <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
                  className="min-h-10 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none" placeholder="0,00" />
                <span className="pr-2 text-xs text-black/40">EUR</span>
              </div>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setPanel(null)} className="min-h-10 rounded-lg border border-black/15 bg-white text-sm font-bold text-black/65">Abbrechen</button>
            <button type="button" disabled={!parseQuantityInput(qty) || (parseQuantityInput(qty) ?? 0) <= 0}
              onClick={commitReceipt} className="min-h-10 rounded-lg bg-primaq-500 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-black/25">
              Einbuchen
            </button>
          </div>
        </div>
      ) : null}

      {/* Deduction panel */}
      {panel === "deduction" ? (
        <div className="grid gap-2 border-t border-black/8 bg-red-50 px-3 pb-3 pt-2">
          <p className="text-xs font-black text-red-800">− Bestand reduzieren</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-black/60">
              Menge ({item.unit})
              <div className="flex min-h-10 items-center rounded-lg border border-black/15 bg-white focus-within:border-red-400">
                <input autoFocus inputMode="decimal" value={deductQty} onChange={(e) => setDeductQty(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitDeduction(); if (e.key === "Escape") setPanel(null); }}
                  className="min-h-10 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none" placeholder="0" />
                <span className="pr-2 text-xs text-black/40">{item.unit}</span>
              </div>
            </label>
            <fieldset className="grid gap-1">
              <legend className="text-xs font-semibold text-black/60">Grund (Pflicht)</legend>
              <div className="grid grid-cols-3 gap-1">
                {(["Verbrauch", "Verlust", "Korrektur", "Vertippt", "Sonstiges"] as const).map((g) => (
                  <button key={g} type="button" onClick={() => setDeductReason(g)}
                    className={`min-h-9 rounded-lg border text-xs font-bold ${deductReason === g ? "border-red-500 bg-white text-red-700" : "border-black/10 bg-white/70 text-black/55"}`}>
                    {g}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="grid gap-1 text-xs font-semibold text-black/60 sm:col-span-2">
              Notiz (opt.)
              <input value={deductNote} onChange={(e) => setDeductNote(e.target.value)}
                className="min-h-10 rounded-lg border border-black/15 bg-white px-2 text-sm outline-none focus:border-red-400" placeholder="z. B. Ablaufdatum" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setPanel(null)} className="min-h-10 rounded-lg border border-black/15 bg-white text-sm font-bold text-black/65">Abbrechen</button>
            <button type="button" disabled={!parseQuantityInput(deductQty) || (parseQuantityInput(deductQty) ?? 0) <= 0}
              onClick={commitDeduction} className="min-h-10 rounded-lg bg-red-600 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-black/25">
              Ausbuchen
            </button>
          </div>
        </div>
      ) : null}

      {/* Correction panel */}
      {panel === "correction" ? (
        <div className="grid gap-2 border-t border-black/8 bg-[#f0f4ea] px-3 pb-3 pt-2">
          <p className="text-xs font-black text-ink">Bestand korrigieren</p>
          <p className="text-xs text-black/55">
            Aktuell: <strong>{formatQuantity(item.quantityOnHand, item.unit)}</strong>
            {typeof correctionDelta === "number" && correctionDelta !== 0 ? (
              <span className={`ml-2 font-bold ${correctionDelta > 0 ? "text-green-700" : "text-red-700"}`}>
                → {correctionDelta > 0 ? "+" : ""}{formatQuantity(correctionDelta, item.unit)}
              </span>
            ) : null}
          </p>
          <label className="grid gap-1 text-xs font-semibold text-black/60">
            Neuer Zielbestand ({item.unit})
            <div className="flex min-h-10 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
              <input autoFocus inputMode="decimal" value={correctionTarget} onChange={(e) => setCorrectionTarget(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitCorrection(); if (e.key === "Escape") setPanel(null); }}
                className="min-h-10 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none" placeholder={String(item.quantityOnHand).replace(".", ",")} />
              <span className="pr-2 text-xs text-black/40">{item.unit}</span>
            </div>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setPanel(null)} className="min-h-10 rounded-lg border border-black/15 bg-white text-sm font-bold text-black/65">Abbrechen</button>
            <button type="button"
              disabled={typeof correctionDelta !== "number"}
              onClick={commitCorrection}
              className="min-h-10 rounded-lg bg-primaq-500 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-black/25">
              Korrigieren
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WarenForm({
  initial,
  templateOf,
  onCancel,
  onSubmit,
}: {
  initial?: GeneralStockItem;
  templateOf?: GeneralStockItem;
  onCancel: () => void;
  onSubmit: (input: WarenInput) => void;
}) {
  const src = templateOf ?? initial;
  const isTemplate = !!templateOf;
  const [productName, setProductName] = useState(src?.productName ?? "");
  const [flavorName, setFlavorName] = useState(isTemplate ? "" : (initial?.flavorName ?? ""));
  const [manufacturer, setManufacturer] = useState(src?.manufacturer ?? "");
  const [powder, setPowder] = useState(String(src?.recipe.powderKgPerBatch ?? 2).replace(".", ","));
  const [water, setWater] = useState(String(src?.recipe.waterLitersPerBatch ?? 4).replace(".", ","));
  const [mix, setMix] = useState(String(src?.recipe.mixLitersPerBatch ?? 6).replace(".", ","));
  const [unit, setUnit] = useState<"Pkg" | "kg" | "Stück">(src?.unit ?? "Pkg");
  const [qty, setQty] = useState("");
  const [minQty, setMinQty] = useState(src?.minQuantity != null ? String(src.minQuantity).replace(".", ",") : "");
  const [price, setPrice] = useState(src?.purchasePriceCents ? String(src.purchasePriceCents / 100).replace(".", ",") : "");
  const [note, setNote] = useState(isTemplate ? "" : (initial?.note ?? ""));

  const parsedPowder = parseQuantityInput(powder) ?? 2;
  const parsedWater = parseQuantityInput(water) ?? 4;
  const parsedMix = parseQuantityInput(mix) ?? 6;
  const parsedQty = parseQuantityInput(qty) ?? 0;
  const isMixName = isGenericSoftMixInventoryName(productName.trim()) || isGenericSoftMixInventoryName(flavorName.trim());
  const canSubmit = productName.trim().length > 0 && flavorName.trim().length > 0 && parsedMix > 0 && !isMixName;

  return (
    <div className="grid gap-3 rounded-lg border border-primaq-200 bg-primaq-50 p-4">
      <p className="text-sm font-black text-ink">{isTemplate ? "Neue Sorte aus Vorlage erstellen" : initial ? "Ware bearbeiten" : "Neue Ware anlegen"}</p>
      {isTemplate ? (
        <p className="text-xs text-black/50">Vorlage: <strong>{templateOf!.productName} – {templateOf!.flavorName}</strong>. Bestand startet bei 0.</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-black/70">
          Warenname *
          <input value={productName} onChange={(e) => setProductName(e.target.value)}
            placeholder="z. B. MAC 3 Vanille"
            className="min-h-10 rounded-lg border border-black/15 bg-white px-3 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/70">
          Geschmack * (Sortenname)
          <input value={flavorName} onChange={(e) => setFlavorName(e.target.value)}
            placeholder="z. B. Vanille"
            className="min-h-10 rounded-lg border border-black/15 bg-white px-3 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
      </div>

      <label className="grid gap-1 text-xs font-semibold text-black/70">
        Hersteller / Marke (optional)
        <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)}
          placeholder="z. B. Heinrichs, Erlenbacher"
          className="min-h-10 rounded-lg border border-black/15 bg-white px-3 text-sm outline-none focus:border-primaq-500" />
      </label>

      <fieldset className="grid gap-1.5">
        <legend className="text-xs font-semibold text-black/70">Rezept pro Mischung</legend>
        <div className="grid grid-cols-3 gap-2">
          {([["Pulver (kg)", powder, setPowder, "kg"], ["Wasser (L)", water, setWater, "L"], ["Ergebnis (L) *", mix, setMix, "L Mix"]] as const).map(([label, val, set, unit_]) => (
            <label key={label} className="grid gap-1 text-xs font-semibold text-black/60">
              {label}
              <div className={`flex min-h-10 items-center rounded-lg border bg-white focus-within:border-primaq-500 ${label.includes("*") ? "border-primaq-300" : "border-black/15"}`}>
                <input inputMode="decimal" value={val} onChange={(e) => set(e.target.value)}
                  className="min-h-10 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none" />
                <span className={`pr-2 text-xs ${label.includes("*") ? "text-primaq-600" : "text-black/40"}`}>{unit_}</span>
              </div>
            </label>
          ))}
        </div>
        {parsedPowder > 0 && parsedWater > 0 && parsedMix > 0 ? (
          <p className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black/55">
            {formatQuantity(parsedPowder, "kg")} + {formatQuantity(parsedWater, "L")} = <strong className="text-primaq-700">{formatQuantity(parsedMix, "L")} Mix</strong>
          </p>
        ) : null}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <fieldset className="grid gap-1.5">
          <legend className="text-xs font-semibold text-black/70">Einheit</legend>
          <div className="grid grid-cols-3 gap-1">
            {(["Pkg", "kg", "Stück"] as const).map((u) => (
              <button key={u} type="button" onClick={() => setUnit(u)}
                className={`min-h-9 rounded-lg border text-xs font-bold ${unit === u ? "border-primaq-500 bg-white text-primaq-700" : "border-black/10 bg-white/70 text-black/55"}`}>
                {u}
              </button>
            ))}
          </div>
        </fieldset>
        {(!initial || isTemplate) ? (
          <label className="grid gap-1 text-xs font-semibold text-black/70">
            Startbestand ({unit})
            <div className="flex min-h-10 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
              <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)}
                className="min-h-10 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none" placeholder="0" />
              <span className="pr-2 text-xs text-black/40">{unit}</span>
            </div>
          </label>
        ) : null}
        <label className="grid gap-1 text-xs font-semibold text-black/70">
          Einkaufspreis/{unit} (opt.)
          <div className="flex min-h-10 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
              className="min-h-10 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none" placeholder="0,00" />
            <span className="pr-2 text-xs text-black/40">EUR</span>
          </div>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-black/70">
          Mindestbestand ({unit}, optional)
          <div className="flex min-h-10 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
            <input inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value)}
              className="min-h-10 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none" placeholder="z. B. 5" />
            <span className="pr-2 text-xs text-black/40">{unit}</span>
          </div>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/70">
          Notiz (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="z. B. Charge 2026-A"
            className="min-h-10 rounded-lg border border-black/15 bg-white px-3 text-sm outline-none focus:border-primaq-500" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-black/15 bg-white text-sm font-black text-black/65">
          Abbrechen
        </button>
        <button type="button" disabled={!canSubmit}
          onClick={() => onSubmit({
            productName: productName.trim(),
            flavorName: flavorName.trim(),
            manufacturer: manufacturer.trim() || undefined,
            recipe: { powderKgPerBatch: parsedPowder, waterLitersPerBatch: parsedWater, mixLitersPerBatch: parsedMix, packageKg: src?.recipe.packageKg ?? null },
            unit,
            initialQuantity: parsedQty > 0 ? parsedQty : undefined,
            minQuantity: minQty.trim() ? (parseQuantityInput(minQty) ?? null) : null,
            purchasePriceCents: price.trim() ? toCents(price) : null,
            note: note.trim() || undefined,
          })}
          className="min-h-11 rounded-lg bg-primaq-500 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-black/25">
          {isTemplate ? "Sorte anlegen" : initial ? "Speichern" : "Ware anlegen"}
        </button>
      </div>
    </div>
  );
}

export function MixInventoryPanel({
  lines,
  movements,
  hasActiveShift,
  flavorPortionWeights,
  onAddMixStock,
  onSetActualStock,
  onResetStockFlavor,
  onAddInventoryFlavor,
  onDeleteInventoryFlavor,
  onUpdateFlavorPortionWeights,
  hideManageFlavors,
  onActivateEmergencyMode,
}: {
  lines: InventoryReport["mixLines"];
  movements: Record<string, import("./types").MixStockMovement[]>;
  hasActiveShift: boolean;
  flavorPortionWeights?: Record<string, Partial<Record<import("./types").PackagingType, number>>>;
  onAddMixStock: (productId: string, input: MixStockInput) => void;
  onSetActualStock: (productId: string, liters: number, reason?: string) => void;
  onResetStockFlavor: (productId: string) => void;
  onAddInventoryFlavor: (input: {
    name: string;
    colorHex?: string;
    recipe: SoftServeRecipe;
    warningThresholdPortions: number;
    stockInput: MixStockInput;
    savePermanent: boolean;
    portionWeights?: Partial<Record<import("./types").PackagingType, number>>;
  }) => void;
  onDeleteInventoryFlavor: (productId: string, force?: boolean) => { ok: true } | { ok: false; reason: "linked" | "movements" | "missing"; message: string };
  onUpdateFlavorPortionWeights?: (flavorId: string, weights: Partial<Record<import("./types").PackagingType, number>>) => void;
  hideManageFlavors?: boolean;
  onActivateEmergencyMode?: (stockFlavorId: string, flavorName: string, remainingLiters: number) => void;
}) {
  const [showAddFlavor, setShowAddFlavor] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{
    line: InventoryReport["mixLines"][number];
    stage: "confirm" | "movements";
    message?: string;
  } | null>(null);
  const [resetDialog, setResetDialog] = useState<
    { line: InventoryReport["mixLines"][number] }
    | null
  >(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  const handleDelete = (line: InventoryReport["mixLines"][number], force = false) => {
    const result = onDeleteInventoryFlavor(line.productId, force);

    if (result.ok) {
      setDeleteDialog(null);
      setDeleteNotice(null);
      return;
    }

    if (result.reason === "movements") {
      setDeleteDialog({ line, stage: "movements", message: result.message });
      return;
    }

    setDeleteDialog(null);
    setDeleteNotice(result.message);
  };

  if (!lines.length) {
    return (
      <section className="grid gap-4 rounded-lg border border-dashed border-black/15 bg-white p-4">
        <h2 className="text-lg font-bold text-ink">Mixbestand pro Sorte</h2>
        <p className="mt-2 text-sm font-medium text-black/60">
          Keine sichtbaren Softeis-Sorten vorhanden. Lege Sorten in den Einstellungen an.
        </p>
        {!hideManageFlavors ? <AddFlavorButton onClick={() => setShowAddFlavor(true)} /> : null}
        {showAddFlavor ? (
          <AddFlavorForm
            onCancel={() => setShowAddFlavor(false)}
            onSubmit={(input) => {
              onAddInventoryFlavor(input);
              setShowAddFlavor(false);
            }}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className="grid gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-ink">Bestand pro Sorte</h2>
          <p className="mt-1 text-sm leading-5 text-black/60">
            Jede reale Sorte wird nur einmal angezeigt. Mix ist nur eine rechnerische Kombination.
          </p>
        </div>
        {!hideManageFlavors ? <AddFlavorButton onClick={() => setShowAddFlavor(true)} /> : null}
      </div>
      {showAddFlavor ? (
        <AddFlavorForm
          onCancel={() => setShowAddFlavor(false)}
          onSubmit={(input) => {
            onAddInventoryFlavor(input);
            setShowAddFlavor(false);
          }}
        />
      ) : null}
      {deleteNotice ? (
        <p className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm font-bold text-yellow-900">
          {deleteNotice}
        </p>
      ) : null}
      <div className="grid gap-3">
        {lines.map((line) => (
          <MixInventoryCard
            key={line.productId}
            line={line}
            lineMovements={movements[line.productId] ?? []}
            portionWeights={flavorPortionWeights?.[line.productId]}
            onAddMixStock={onAddMixStock}
            onSetActualStock={onSetActualStock}
            onRequestReset={() => setResetDialog({ line })}
            onRequestDelete={() => {
              setDeleteNotice(null);
              setDeleteDialog({ line, stage: "confirm" });
            }}
            onUpdatePortionWeights={onUpdateFlavorPortionWeights ? (w) => onUpdateFlavorPortionWeights(line.productId, w) : undefined}
            hideManage={hideManageFlavors}
            onActivateEmergencyMode={onActivateEmergencyMode ? (flavorId, flavorName, liters) => onActivateEmergencyMode(flavorId, flavorName, liters) : undefined}
          />
        ))}
      </div>
      {deleteDialog ? (
        <ConfirmDeleteFlavorDialog
          line={deleteDialog.line}
          stage={deleteDialog.stage}
          message={deleteDialog.message}
          onCancel={() => setDeleteDialog(null)}
          onConfirm={() => handleDelete(deleteDialog.line, deleteDialog.stage === "movements")}
        />
      ) : null}
      {resetDialog ? (
        <StockResetDialog
          flavorName={resetDialog.line.name}
          onCancel={() => setResetDialog(null)}
          onConfirm={() => {
            onResetStockFlavor(resetDialog.line.productId);
            setResetDialog(null);
          }}
        />
      ) : null}
    </section>
  );
}

function AddFlavorButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primaq-500 px-4 text-sm font-black text-white"
    >
      <Plus className="h-5 w-5" /> Neue Sorte hinzufügen
    </button>
  );
}

function AddFlavorForm({
  onCancel,
  onSubmit
}: {
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    colorHex?: string;
    recipe: SoftServeRecipe;
    warningThresholdPortions: number;
    stockInput: MixStockInput;
    savePermanent: boolean;
    portionWeights?: Partial<Record<import("./types").PackagingType, number>>;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [colorHex, setColorHex] = useState("#f2d46f");
  const [powder, setPowder] = useState(String(defaultSoftServeRecipe.powderKgPerBatch).replace(".", ","));
  const [water, setWater] = useState(String(defaultSoftServeRecipe.waterLitersPerBatch).replace(".", ","));
  const [mixLiters, setMixLiters] = useState(String(defaultSoftServeRecipe.mixLitersPerBatch).replace(".", ","));
  const [warningThreshold, setWarningThreshold] = useState("20");
  const [pwBecher, setPwBecher] = useState("");
  const [pwWaffel, setPwWaffel] = useState("");
  const [pwWaffelbecher, setPwWaffelbecher] = useState("");
  const [mode, setMode] = useState<MixStockInput["mode"]>("batches");
  const [value, setValue] = useState("");
  const [saveMode, setSaveMode] = useState<"shift" | "permanent">("shift");

  const parsedPowder = parseQuantityInput(powder) ?? defaultSoftServeRecipe.powderKgPerBatch;
  const parsedWater = parseQuantityInput(water) ?? defaultSoftServeRecipe.waterLitersPerBatch;
  const parsedMixLiters = parseQuantityInput(mixLiters) ?? defaultSoftServeRecipe.mixLitersPerBatch;
  const parsedValue = parseQuantityInput(value);
  const warningThresholdPortions = parseQuantityInput(warningThreshold) ?? 20;
  const recipe: SoftServeRecipe = {
    powderKgPerBatch: parsedPowder,
    waterLitersPerBatch: parsedWater,
    mixLitersPerBatch: parsedMixLiters,
    packageKg: null
  };
  const previewLiters = typeof parsedValue === "number" && parsedMixLiters > 0
    ? mode === "batches" ? parsedValue * parsedMixLiters : parsedValue
    : 0;
  const canSubmit = name.trim().length > 0 && parsedMixLiters > 0;

  return (
    <section className="rounded-lg border border-primaq-500/20 bg-primaq-50 p-4">
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="grid gap-1.5 text-sm font-semibold text-black/72">
            Sortenname *
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="z. B. Vanille"
              className="min-h-12 rounded-lg border border-black/15 bg-white px-3 text-base font-bold outline-none focus:border-primaq-500"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-black/72">
            Farbe
            <input
              type="color"
              value={colorHex}
              onChange={(event) => setColorHex(event.target.value)}
              className="h-12 w-16 rounded-lg border border-black/15 bg-white p-1"
            />
          </label>
        </div>

        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-semibold text-black/72">Rezept pro Mischung</legend>
          <div className="grid grid-cols-3 gap-2">
            <label className="grid gap-1 text-xs font-semibold text-black/60">
              Pulver (kg)
              <div className="flex min-h-11 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
                <input
                  inputMode="decimal"
                  value={powder}
                  onChange={(e) => setPowder(e.target.value)}
                  className="min-h-11 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none"
                />
                <span className="pr-2 text-xs text-black/40">kg</span>
              </div>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-black/60">
              Wasser (L)
              <div className="flex min-h-11 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
                <input
                  inputMode="decimal"
                  value={water}
                  onChange={(e) => setWater(e.target.value)}
                  className="min-h-11 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none"
                />
                <span className="pr-2 text-xs text-black/40">L</span>
              </div>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-black/60">
              Ergebnis (L) *
              <div className="flex min-h-11 items-center rounded-lg border border-primaq-300 bg-white focus-within:border-primaq-500">
                <input
                  inputMode="decimal"
                  value={mixLiters}
                  onChange={(event) => setMixLiters(event.target.value)}
                  className="min-h-11 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none"
                />
                <span className="pr-2 text-xs text-primaq-600">L</span>
              </div>
            </label>
          </div>
          {parsedPowder > 0 && parsedWater > 0 && parsedMixLiters > 0 ? (
            <p className="rounded-lg bg-white/70 px-3 py-1.5 text-xs font-semibold text-black/55">
              {formatQuantity(parsedPowder, "kg")} + {formatQuantity(parsedWater, "L")} = <strong className="text-primaq-700">{formatQuantity(parsedMixLiters, "L")} Mix</strong>
            </p>
          ) : null}
        </fieldset>

        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-semibold text-black/72">Portionsgewichte (optional)</legend>
          <div className="grid grid-cols-3 gap-2">
            {([["Becher", pwBecher, setPwBecher], ["Waffel", pwWaffel, setPwWaffel], ["Waffelbecher", pwWaffelbecher, setPwWaffelbecher]] as const).map(([label, val, setter]) => (
              <label key={label} className="grid gap-1 text-xs font-semibold text-black/60">
                {label}
                <div className="flex min-h-11 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
                  <input
                    inputMode="decimal"
                    value={val}
                    placeholder="—"
                    onChange={(e) => setter(e.target.value)}
                    className="min-h-11 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none"
                  />
                  <span className="pr-2 text-xs text-black/40">g</span>
                </div>
              </label>
            ))}
          </div>
          <p className="text-xs text-black/40">Leer lassen = globaler Standard wird verwendet.</p>
        </fieldset>

        <label className="grid gap-1.5 text-sm font-semibold text-black/72">
          Warnschwelle (Restportionen)
          <div className="flex min-h-12 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
            <input
              inputMode="numeric"
              value={warningThreshold}
              onChange={(event) => setWarningThreshold(event.target.value)}
              className="min-h-12 min-w-0 flex-1 bg-transparent px-3 text-base font-bold outline-none"
            />
            <span className="pr-3 text-sm font-bold text-black/50">Port.</span>
          </div>
        </label>

        <div className="grid gap-1.5">
          <p className="text-sm font-semibold text-black/72">Startbestand</p>
          <div className="flex items-center gap-2">
            {(["batches", "liters"] as MixStockInput["mode"][]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={`min-h-11 shrink-0 rounded-lg border px-3 text-sm font-bold ${
                  mode === item ? "border-primaq-500 bg-white text-primaq-700" : "border-black/10 bg-white/70 text-black/65"
                }`}
              >
                {item === "batches" ? "Mischungen" : "Liter"}
              </button>
            ))}
            <div className="flex min-h-11 flex-1 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
              <input
                inputMode="decimal"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className="min-h-11 min-w-0 flex-1 bg-transparent px-3 text-base font-bold outline-none"
              />
              <span className="pr-3 text-sm font-bold text-black/50">{mode === "batches" ? "Misch." : "L"}</span>
            </div>
            {previewLiters > 0 ? (
              <span className="shrink-0 text-sm font-semibold text-black/50">= {formatQuantity(previewLiters, "L")}</span>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(["shift", "permanent"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setSaveMode(item)}
              className={`min-h-11 rounded-lg border px-3 text-sm font-bold ${
                saveMode === item ? "border-primaq-500 bg-white text-primaq-700" : "border-black/10 bg-white/70 text-black/65"
              }`}
            >
              {item === "shift" ? "Nur für diesen Einsatz" : "Dauerhaft speichern"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-black/15 bg-white px-4 text-sm font-black text-black/70"
          >
            Abbrechen
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              const parsedPwBecher = parseQuantityInput(pwBecher);
              const parsedPwWaffel = parseQuantityInput(pwWaffel);
              const parsedPwWaffelbecher = parseQuantityInput(pwWaffelbecher);
              const portionWeights: Partial<Record<import("./types").PackagingType, number>> = {};
              if (parsedPwBecher && parsedPwBecher > 0) portionWeights.Becher = parsedPwBecher;
              if (parsedPwWaffel && parsedPwWaffel > 0) portionWeights.Waffel = parsedPwWaffel;
              if (parsedPwWaffelbecher && parsedPwWaffelbecher > 0) portionWeights.Waffelbecher = parsedPwWaffelbecher;
              onSubmit({
                name,
                colorHex,
                recipe,
                warningThresholdPortions,
                stockInput: { mode, value: parsedValue ?? 0 },
                savePermanent: saveMode === "permanent",
                portionWeights: Object.keys(portionWeights).length ? portionWeights : undefined
              });
            }}
            className="min-h-11 rounded-lg bg-primaq-500 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-black/25"
          >
            Sorte hinzufügen
          </button>
        </div>
      </div>
    </section>
  );
}

function MixInventoryCard({
  line,
  lineMovements,
  portionWeights,
  onAddMixStock,
  onSetActualStock,
  onRequestReset,
  onRequestDelete,
  onUpdatePortionWeights,
  hideManage,
  onActivateEmergencyMode,
}: {
  line: InventoryReport["mixLines"][number];
  lineMovements: import("./types").MixStockMovement[];
  portionWeights?: Partial<Record<import("./types").PackagingType, number>>;
  onAddMixStock: (productId: string, input: MixStockInput) => void;
  onSetActualStock: (productId: string, liters: number, reason?: string) => void;
  onRequestReset: () => void;
  onRequestDelete: () => void;
  onUpdatePortionWeights?: (weights: Partial<Record<import("./types").PackagingType, number>>) => void;
  hideManage?: boolean;
  onActivateEmergencyMode?: (stockFlavorId: string, flavorName: string, remainingLiters: number) => void;
}) {
  // Refill panel state
  const [activeRefill, setActiveRefill] = useState<"liters" | null>(null);
  const [refillValue, setRefillValue] = useState("");
  const refillParsed = parseQuantityInput(refillValue);
  const refillPreviewLiters = typeof refillParsed === "number"
    ? refillParsed
    : 0;

  // Actions drawer state
  const [showActions, setShowActions] = useState(false);
  const [showMovements, setShowMovements] = useState(false);
  const [showPortionWeights, setShowPortionWeights] = useState(false);
  const [pwBecher, setPwBecher] = useState(portionWeights?.Becher ? String(portionWeights.Becher).replace(".", ",") : "");
  const [pwWaffel, setPwWaffel] = useState(portionWeights?.Waffel ? String(portionWeights.Waffel).replace(".", ",") : "");
  const [pwWaffelbecher, setPwWaffelbecher] = useState(portionWeights?.Waffelbecher ? String(portionWeights.Waffelbecher).replace(".", ",") : "");

  useEffect(() => {
    setPwBecher(portionWeights?.Becher ? String(portionWeights.Becher).replace(".", ",") : "");
    setPwWaffel(portionWeights?.Waffel ? String(portionWeights.Waffel).replace(".", ",") : "");
    setPwWaffelbecher(portionWeights?.Waffelbecher ? String(portionWeights.Waffelbecher).replace(".", ",") : "");
  }, [portionWeights]);

  const { cardBorder, headerBg, restClass } = getStockStyle(line.status);

  function commitRefill() {
    if (typeof refillParsed === "number" && refillParsed > 0 && activeRefill !== null) {
      onAddMixStock(line.productId, { mode: activeRefill, value: refillParsed });
      setRefillValue("");
      setActiveRefill(null);
    }
  }

  return (
    <section className={`overflow-hidden rounded-lg border bg-white shadow-sm ${cardBorder}`}>

      {/* ── Header: ampel status prominently left, name right ── */}
      <div className={`flex items-center gap-3 px-4 py-3 ${headerBg}`}>
        <span className={`shrink-0 text-2xl font-black tabular-nums leading-none ${restClass}`}>
          {getMixStatusEmoji(line.status)} {formatQuantity(line.remainingLiters, "L")}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-black text-ink">{line.name}</p>
          {line.machineName ? <p className="text-xs text-black/45">{line.machineName}</p> : null}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${getMixStatusClass(line.status)}`}>
          {line.status}
        </span>
      </div>

      {/* ── 4-metric grid ── */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-black/8 px-4 py-3 sm:grid-cols-[1fr_1fr_2fr_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-black/45">Startbestand</p>
          <p className={`mt-1 text-xl font-black ${line.startLiters === 0 ? "text-orange-400" : "text-ink"}`}>
            {line.startLiters === 0 ? "—" : formatQuantity(line.startLiters, "L")}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-black/45">Verbrauch</p>
          <p className="mt-1 text-xl font-black text-ink">{formatQuantity(line.consumedLiters, "L")}</p>
        </div>

        <div className="sm:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-black/45">Restbestand</p>
          <StockLevelInput
            value={Math.max(0, line.remainingLiters)}
            className={restClass}
            ariaLabel="Restbestand in Liter"
            onCommit={(newLiters) => {
              onSetActualStock(
                line.productId,
                newLiters,
                `Bestand angepasst · Alt: ${formatQuantity(line.remainingLiters, "L")} → Neu: ${formatQuantity(newLiters, "L")}`
              );
            }}
          />
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-black/45">Restportionen</p>
          <p className="mt-1 text-lg font-black text-ink">
            {line.estimatedRemainingPortions === null ? "—" : line.estimatedRemainingPortions}
          </p>
        </div>
      </div>

      {/* ── Secondary stats: only if there's something to show ── */}
      {line.refilledLiters !== 0 ? (
        <div className="flex flex-wrap gap-x-5 border-b border-black/8 px-4 py-1.5 text-xs font-semibold text-black/45">
          <span>Nachgefüllt: <strong className="font-black text-ink">{formatQuantity(line.refilledLiters, "L")}</strong></span>
        </div>
      ) : null}

      {/* ── 3-button action row ── */}
      <div className="grid grid-cols-3 gap-2 p-3">
        <button
          type="button"
          onClick={() => {
            onAddMixStock(line.productId, { mode: "batches", value: 1 });
            setActiveRefill(null);
            setRefillValue("");
          }}
          className="min-h-12 rounded-lg border border-primaq-300 bg-primaq-50 text-sm font-black text-primaq-700"
        >
          + Mischung
        </button>
        <button
          type="button"
          onClick={() => { setActiveRefill(activeRefill === "liters" ? null : "liters"); setRefillValue(""); }}
          className={`min-h-12 rounded-lg text-sm font-black ${activeRefill === "liters" ? "bg-primaq-500 text-white" : "border border-primaq-300 bg-primaq-50 text-primaq-700"}`}
        >
          + Liter
        </button>
        <button
          type="button"
          onClick={() => setShowActions((v) => !v)}
          className={`min-h-12 rounded-lg border text-sm font-black ${showActions ? "border-black/20 bg-black/5 text-black/70" : "border-black/12 bg-[#fbfcf8] text-black/55"}`}
        >
          Aktionen {showActions ? "▲" : "▼"}
        </button>
      </div>

      {/* ── Refill input — expands below button row ── */}
      {activeRefill !== null ? (
        <div className="flex items-center gap-2 border-t border-black/8 bg-primaq-50 px-3 pb-3 pt-2">
          <div className="flex min-h-12 flex-1 items-center rounded-lg border border-primaq-300 bg-white focus-within:border-primaq-500">
            <input
              autoFocus
              inputMode="decimal"
              value={refillValue}
              placeholder="0"
              onChange={(e) => setRefillValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRefill();
                if (e.key === "Escape") { setActiveRefill(null); setRefillValue(""); }
              }}
              className="min-h-12 min-w-0 flex-1 bg-transparent px-3 text-xl font-bold outline-none"
            />
            <span className="pr-3 text-sm font-bold text-black/40">
              L
            </span>
          </div>
          {refillPreviewLiters > 0 ? (
            <span className="shrink-0 text-sm font-semibold text-primaq-700">+ {formatQuantity(refillPreviewLiters, "L")}</span>
          ) : null}
          <button
            type="button"
            disabled={typeof refillParsed !== "number" || refillParsed <= 0}
            onClick={commitRefill}
            className="min-h-12 shrink-0 rounded-lg bg-primaq-500 px-4 text-base font-black text-white disabled:cursor-not-allowed disabled:bg-black/25"
          >
            Hinzufügen
          </button>
        </div>
      ) : null}

      {/* ── Actions drawer ── */}
      {showActions ? (
        <div className="grid gap-2 border-t border-black/8 bg-[#fbfcf8] px-3 pb-3 pt-2">
          {line.status === "Leer" && !line.isEmergencyMode && onActivateEmergencyMode ? (
            <button
              type="button"
              onClick={() => {
                const confirmed = window.confirm(
                  "Notbetrieb erlaubt den Weiterverkauf, obwohl die Sorte als \"Leer\" markiert ist.\n\nNur aktivieren, wenn tatsächlich noch Ware in der Maschine ist. Diese Aktion wird protokolliert.\n\nJetzt Notbetrieb aktivieren?"
                );
                if (confirmed) {
                  onActivateEmergencyMode(line.productId, line.name, line.remainingLiters);
                }
              }}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-orange-300 bg-orange-50 text-sm font-bold text-orange-800"
            >
              🔓 Notbetrieb aktivieren
            </button>
          ) : null}
          {line.isEmergencyMode ? (
            <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-800">
              🔓 Notbetrieb aktiv
            </p>
          ) : null}
          {onUpdatePortionWeights ? (
            <>
              <button
                type="button"
                onClick={() => setShowPortionWeights((v) => !v)}
                className="flex min-h-11 w-full items-center justify-between rounded-lg border border-black/10 bg-white px-3 text-sm font-bold text-black/55"
              >
                <span>Portionsgewichte</span>
                <span className="text-xs">{showPortionWeights ? "▲" : "▼"}</span>
              </button>
              {showPortionWeights ? (
                <div className="grid gap-2 rounded-lg border border-black/8 bg-white p-3">
                  <div className="grid grid-cols-3 gap-2">
                    {([["Becher", pwBecher, setPwBecher], ["Waffel", pwWaffel, setPwWaffel], ["Waffelbecher", pwWaffelbecher, setPwWaffelbecher]] as const).map(([label, val, setter]) => (
                      <label key={label} className="grid gap-1 text-xs font-semibold text-black/60">
                        {label}
                        <div className="flex min-h-10 items-center rounded-lg border border-black/15 bg-[#fbfcf8] focus-within:border-primaq-500">
                          <input
                            inputMode="decimal"
                            value={val}
                            placeholder="—"
                            onChange={(e) => setter(e.target.value)}
                            className="min-h-10 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none"
                          />
                          <span className="pr-2 text-xs text-black/40">g</span>
                        </div>
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const b = parseQuantityInput(pwBecher);
                      const w = parseQuantityInput(pwWaffel);
                      const wb = parseQuantityInput(pwWaffelbecher);
                      const weights: Partial<Record<import("./types").PackagingType, number>> = {};
                      if (b && b > 0) weights.Becher = b;
                      if (w && w > 0) weights.Waffel = w;
                      if (wb && wb > 0) weights.Waffelbecher = wb;
                      onUpdatePortionWeights(weights);
                      setShowPortionWeights(false);
                    }}
                    className="min-h-9 rounded-lg bg-primaq-500 px-3 text-xs font-black text-white"
                  >
                    Speichern
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setShowMovements((v) => !v)}
            className="flex min-h-11 w-full items-center justify-between rounded-lg border border-black/10 bg-white px-3 text-sm font-bold text-black/55"
          >
            <span>Bewegungen ({lineMovements.length})</span>
            <span className="text-xs">{showMovements ? "▲" : "▼"}</span>
          </button>
          {showMovements ? (
            <div className="grid gap-1">
              {lineMovements.length === 0 ? (
                <p className="px-1 text-xs text-black/40">Keine Bewegungen aufgezeichnet.</p>
              ) : (
                lineMovements.map((mov) => {
                  const isStockAdjustment = mov.type === "correction" && mov.reason?.startsWith("Bestand angepasst");
                  const isStartChange = mov.type === "start" && mov.reason?.startsWith("Startbestand geändert");
                  const typeLabel = mov.type === "start" ? isStartChange ? "Startbestand geändert" : "Start" : mov.type === "refill" ? "Nachfüllung" : isStockAdjustment ? "Bestand angepasst" : "Anpassung";
                  const litersLabel = `${mov.liters >= 0 ? "+" : ""}${formatQuantity(mov.liters, "L")}`;
                  const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(mov.createdAt));
                  return (
                    <div key={mov.id} className="flex items-center justify-between gap-2 rounded-lg border border-black/5 bg-white px-2 py-1.5 text-xs">
                      <div className="min-w-0">
                        <span className="font-black text-ink">{typeLabel}</span>
                        <span className={`ml-1.5 font-bold tabular-nums ${mov.liters < 0 ? "text-red-700" : "text-green-700"}`}>{litersLabel}</span>
                        {mov.reason ? <span className="ml-1.5 text-black/50">· {mov.reason}</span> : null}
                      </div>
                      <span className="shrink-0 text-black/40">{time}</span>
                    </div>
                  );
                })
              )}
            </div>
          ) : null}

          {!hideManage ? (
            <button
              type="button"
              onClick={onRequestReset}
              className="flex min-h-11 w-full items-center justify-center rounded-lg border border-red-200 bg-white text-sm font-black text-red-700"
            >
              Sorte zurücksetzen
            </button>
          ) : null}

          {!hideManage ? (
            <button
              type="button"
              onClick={onRequestDelete}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 text-sm font-black text-red-700"
            >
              <Trash2 className="h-4 w-4" /> Sorte löschen
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function StockLevelInput({
  value,
  className,
  ariaLabel,
  onCommit
}: {
  value: number;
  className: string;
  ariaLabel: string;
  onCommit: (value: number) => void;
}) {
  const [inputValue, setInputValue] = useState(formatStockInputValue(value));

  useEffect(() => {
    setInputValue(formatStockInputValue(value));
  }, [value]);

  const commit = () => {
    const parsed = parseQuantityInput(inputValue);

    if (typeof parsed !== "number" || parsed < 0) {
      setInputValue(formatStockInputValue(value));
      return;
    }

    const rounded = Math.round(parsed * 1000) / 1000;
    setInputValue(formatStockInputValue(rounded));

    if (rounded !== value) {
      onCommit(rounded);
    }
  };

  return (
    <div className="mt-1 flex min-h-12 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
      <input
        inputMode="decimal"
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }

          if (event.key === "Escape") {
            setInputValue(formatStockInputValue(value));
            event.currentTarget.blur();
          }
        }}
        className={`min-h-12 min-w-0 flex-1 rounded-lg bg-transparent px-3 text-xl font-black tabular-nums outline-none ${className}`}
        aria-label={ariaLabel}
      />
      <span className="pr-3 text-sm font-black text-black/45">L</span>
    </div>
  );
}

function formatStockInputValue(value: number) {
  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 3,
    useGrouping: false
  }).format(Math.max(0, value));
}

function getStockStyle(status: InventoryReport["mixLines"][number]["status"]) {
  if (status === "OK") return { cardBorder: "border-black/10", headerBg: "", restClass: "text-green-700" };
  if (status === "Bald leer") return { cardBorder: "border-yellow-300", headerBg: "bg-yellow-50", restClass: "text-yellow-700" };
  if (status === "Notbetrieb") return { cardBorder: "border-orange-300", headerBg: "bg-orange-50", restClass: "text-orange-700" };
  return { cardBorder: "border-red-300", headerBg: "bg-red-50", restClass: "text-red-700" };
}

function StockResetDialog({
  flavorName,
  onCancel,
  onConfirm
}: {
  flavorName?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [confirmText, setConfirmText] = useState("");
  const canContinue = confirmText === "RESET";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
      <section className="w-full max-w-md rounded-lg border border-red-200 bg-white p-4 shadow-xl">
        {step === 1 ? (
          <>
            <h3 className="text-lg font-black text-red-800">
              Sorte wirklich zurücksetzen?
            </h3>
            <p className="mt-2 text-sm font-semibold leading-5 text-black/70">
              Startbestand, Nachfüllungen, Verbrauch, Korrekturen, Restbestand, Restportionen und Bewegungen dieser Sorte werden auf 0 gesetzt.
            </p>
            {flavorName ? (
              <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-black text-red-800">{flavorName}</p>
            ) : null}
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-black/15 bg-white px-4 text-sm font-black text-black/70">
                Abbrechen
              </button>
              <button type="button" onClick={() => setStep(2)} className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-black text-white">
                Weiter
              </button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h3 className="text-lg font-black text-red-800">Bitte RESET eingeben.</h3>
            <input
              autoFocus
              type="text"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                }
              }}
              placeholder="RESET"
              className="mt-4 min-h-12 w-full rounded-lg border border-red-300 bg-white px-3 text-base font-black text-ink outline-none focus:border-red-500"
            />
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-black/15 bg-white px-4 text-sm font-black text-black/70">
                Abbrechen
              </button>
              <button
                type="button"
                disabled={!canContinue}
                onClick={() => setStep(3)}
                className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-black/25"
              >
                Weiter
              </button>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h3 className="text-lg font-black text-red-800">Endgültig zurücksetzen?</h3>
            <p className="mt-2 text-sm font-semibold leading-5 text-black/70">
              Stammdaten, Sorten, Rezepte, Maschinen, Preise, Farben, Einstellungen und Verkaufsartikel bleiben erhalten.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-black/15 bg-white px-4 text-sm font-black text-black/70">
                Abbrechen
              </button>
              <button type="button" onClick={onConfirm} className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-black text-white">
                Ja, Sorte zurücksetzen
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function ConfirmDeleteFlavorDialog({
  line,
  stage,
  message,
  onCancel,
  onConfirm
}: {
  line: InventoryReport["mixLines"][number];
  stage: "confirm" | "movements";
  message?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const hasMovements = stage === "movements";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
      <section className="w-full max-w-md rounded-lg border border-red-200 bg-white p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-red-50 text-red-700">
            <Trash2 className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-lg font-black text-red-800">
              {hasMovements ? "Lagerbewegungen vorhanden" : "Lager-Sorte löschen"}
            </h3>
            <p className="mt-2 text-sm font-semibold leading-5 text-black/70">
              {message ?? "Lager-Sorte wirklich löschen?"}
            </p>
            <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-black text-red-800">
              {line.name}
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-black/15 bg-white px-4 text-sm font-black text-black/70"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-black text-white"
          >
            {hasMovements ? "Trotzdem löschen" : "Löschen"}
          </button>
        </div>
      </section>
    </div>
  );
}

function getMixStatusClass(status: InventoryReport["mixLines"][number]["status"]) {
  if (status === "OK") {
    return "bg-green-50 text-green-800";
  }

  if (status === "Bald leer") {
    return "bg-yellow-50 text-yellow-800";
  }

  if (status === "Nachfüllen") {
    return "bg-orange-50 text-orange-800";
  }

  if (status === "Notbetrieb") {
    return "bg-orange-100 text-orange-900";
  }

  return "bg-red-50 text-red-800";
}

function getMixStatusEmoji(status: InventoryReport["mixLines"][number]["status"]) {
  if (status === "OK") return "🟢";
  if (status === "Bald leer") return "🟡";
  if (status === "Notbetrieb") return "🔓";
  return "🔴";
}

type MaterialMovementInput = { type: "receipt" | "deduction"; quantity: number; reason?: string; note?: string };

type MaterialItemInput = {
  name: string;
  description?: string | null;
  unit: string;
  purchasePriceCents?: number | null;
  minQuantity?: number | null;
  note?: string | null;
  startQuantity?: number;
  saleTag?: string;
  purchaseUnit?: string;
  itemsPerPurchaseUnit?: number;
};

function getCatSummary(
  category: MaterialCategory,
  items: Record<string, MaterialItem>,
  movements: Record<string, import("./types").InventoryMovement[]>
) {
  const catItems = category.itemIds.map((id) => items[id]).filter(Boolean) as MaterialItem[];
  const active = catItems.filter((i) => i.active !== false);
  const units = [...new Set(active.map((i) => i.unit))];
  const totalQty = active.reduce((s, i) => s + i.quantityOnHand, 0);
  const unit = units.length === 1 ? units[0] : (category.defaultUnit || "Stk.");
  const mixedUnits = units.length > 1;
  const allMoves = category.itemIds.flatMap((id) => movements[id] ?? []);
  const lastMove = allMoves.length > 0 ? allMoves.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)) : undefined;
  const lastMoveItem = lastMove ? items[lastMove.itemId] : undefined;
  return { activeCount: active.length, totalQty, unit, mixedUnits, lastMove, lastMoveItem };
}

function OrphanedItemsBanner({
  count,
  onPurge,
}: {
  count: number;
  onPurge: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  function handlePurge() {
    onPurge();
    setConfirming(false);
  }

  return (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600" />
        <div className="flex-1">
          <p className="text-sm font-bold text-yellow-800">
            Alte Materialdaten ohne Kategorie gefunden
          </p>
          <p className="mt-0.5 text-sm text-yellow-700">
            {count} Artikel {count === 1 ? "existiert" : "existieren"} im Lager, ohne einer Kategorie zuzugehören.
            Diese werden im Dashboard nicht angezeigt.
          </p>
          {confirming ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-yellow-800">
                {count} Artikel endgültig löschen?
              </p>
              <button
                onClick={handlePurge}
                className="inline-flex min-h-8 items-center rounded-lg bg-red-600 px-3 text-xs font-bold text-white"
              >
                Ja, löschen
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="inline-flex min-h-8 items-center rounded-lg border border-black/15 bg-white px-3 text-xs font-bold text-ink"
              >
                Abbrechen
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-yellow-300 bg-white px-3 text-xs font-bold text-yellow-800"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Alte Materialdaten bereinigen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MaterialPanel({
  categories,
  items,
  movements,
  activeAssignmentsByItemId,
  consumedQtyByItemId,
  onAddCategory,
  onRenameCategory,
  onDeleteCategory,
  onAddItem,
  onAddItemWithMovement,
  onUpdateItem,
  onMovement,
}: {
  categories: MaterialCategory[];
  items: Record<string, MaterialItem>;
  movements: Record<string, import("./types").InventoryMovement[]>;
  activeAssignmentsByItemId: Record<string, number>;
  consumedQtyByItemId: Record<string, number>;
  onAddCategory: (input: { name: string }) => void;
  onRenameCategory: (catId: string, name: string) => void;
  onDeleteCategory: (catId: string) => void;
  onAddItem: (categoryId: string, input: MaterialItemInput) => void;
  onAddItemWithMovement: (categoryId: string, itemInput: { name: string; unit: string; purchasePriceCents?: number | null; minQuantity?: number | null; note?: string | null }, movementInput: MaterialMovementInput) => void;
  onUpdateItem: (itemId: string, patch: Partial<MaterialItem>) => void;
  onMovement: (itemId: string, input: MaterialMovementInput) => void;
}) {
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [booking, setBooking] = useState<{ type: "receipt" | "deduction"; categoryId: string } | null>(null);
  const [showAddCatDialog, setShowAddCatDialog] = useState(false);

  const openDetailCat = categories.find((c) => c.id === openDetailId) ?? null;
  const bookingCat = booking ? (categories.find((c) => c.id === booking.categoryId) ?? null) : null;

  return (
    <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Verpackung &amp; Material</h2>
          <p className="mt-1 text-sm text-black/60">Flexibles Lagerbuch für Verpackung und Zubehör.</p>
        </div>
        <button type="button" onClick={() => setShowAddCatDialog(true)}
          className="flex shrink-0 min-h-10 items-center gap-2 rounded-lg bg-primaq-500 px-3 text-sm font-black text-white">
          <Plus className="h-4 w-4" /> Kategorie anlegen
        </button>
      </div>

      {categories.length === 0 ? (
        <div className="mt-4 rounded-lg bg-[#fbfcf8] p-5 text-center">
          <p className="text-sm font-semibold text-black/50">Keine Kategorien vorhanden.</p>
          <button type="button" onClick={() => setShowAddCatDialog(true)}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-primaq-300 bg-white px-4 text-sm font-bold text-primaq-700">
            <Plus className="h-4 w-4" /> Kategorie anlegen
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-2">
          {categories.map((cat) => (
            <MaterialCategoryRow
              key={cat.id}
              category={cat}
              itemCount={cat.itemIds.map((id) => items[id]).filter(Boolean).length}
              summary={getCatSummary(cat, items, movements)}
              onOpen={() => setOpenDetailId(cat.id)}
              onReceipt={() => setBooking({ type: "receipt", categoryId: cat.id })}
              onDeduction={() => setBooking({ type: "deduction", categoryId: cat.id })}
              onDelete={() => onDeleteCategory(cat.id)}
            />
          ))}
        </div>
      )}

      {showAddCatDialog ? (
        <AddCategoryDialog
          onClose={() => setShowAddCatDialog(false)}
          onSubmit={(input) => { onAddCategory(input); setShowAddCatDialog(false); }}
        />
      ) : null}

      {openDetailCat ? (
        <CategoryDetailModal
          category={openDetailCat}
          items={items}
          movements={movements}
          activeAssignmentsByItemId={activeAssignmentsByItemId}
          consumedQtyByItemId={consumedQtyByItemId}
          onClose={() => setOpenDetailId(null)}
          onAddItem={(input) => onAddItem(openDetailCat.id, input)}
          onUpdateItem={onUpdateItem}
          onMovement={onMovement}
          onRename={(name) => onRenameCategory(openDetailCat.id, name)}
          onDelete={() => { onDeleteCategory(openDetailCat.id); setOpenDetailId(null); }}
        />
      ) : null}

      {booking && bookingCat ? (
        <QuickBookingModal
          type={booking.type}
          category={bookingCat}
          items={items}
          onClose={() => setBooking(null)}
          onAddItemWithMovement={(itemInput, movInput) => {
            onAddItemWithMovement(bookingCat.id, itemInput, movInput);
            setBooking(null);
          }}
          onMovement={(itemId, input) => { onMovement(itemId, input); setBooking(null); }}
        />
      ) : null}
    </section>
  );
}

function AddCategoryDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (input: { name: string }) => void;
}) {
  const [name, setName] = useState("");

  function handleSubmit() {
    if (!name.trim()) return;
    onSubmit({ name: name.trim() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white pb-safe-area shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-black/8 px-4 py-3">
          <h3 className="text-base font-black text-ink">Kategorie anlegen</h3>
          <button type="button" onClick={onClose}
            className="flex min-h-9 min-w-9 items-center justify-center rounded-lg bg-black/6 text-sm font-black text-black/50">✕</button>
        </div>
        <div className="px-4 py-4">
          <label className="grid gap-1.5 text-xs font-semibold text-black/60">
            Kategoriename *
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") onClose(); }}
              placeholder="z. B. Becher, Waffeln, Löffel …"
              className="min-h-10 rounded-lg border border-black/15 bg-[#fbfcf8] px-3 text-sm font-bold outline-none focus:border-primaq-500" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-black/8 px-4 pb-4 pt-3">
          <button type="button" onClick={onClose}
            className="min-h-11 rounded-lg border border-black/15 bg-white text-sm font-bold text-black/65">Abbrechen</button>
          <button type="button" disabled={!name.trim()} onClick={handleSubmit}
            className="min-h-11 rounded-lg bg-primaq-500 text-sm font-bold text-white disabled:bg-black/25">Anlegen</button>
        </div>
      </div>
    </div>
  );
}

function MaterialCategoryRow({
  category,
  itemCount,
  summary,
  onOpen,
  onReceipt,
  onDeduction,
  onDelete,
}: {
  category: MaterialCategory;
  itemCount: number;
  summary: ReturnType<typeof getCatSummary>;
  onOpen: () => void;
  onReceipt: () => void;
  onDeduction: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { activeCount, totalQty, unit, mixedUnits, lastMove, lastMoveItem } = summary;

  return (
    <div className="rounded-lg border border-black/8 bg-[#fbfcf8]">
      <div className="flex items-center gap-2 px-3 py-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="font-black text-ink">{category.name}</p>
          <p className="text-xs text-black/55">
            {activeCount} {activeCount === 1 ? "Artikel" : "Artikel"}
            {activeCount > 0 ? (
              <>{" · "}{mixedUnits ? "versch. Einheiten" : `Gesamt: ${formatQuantity(totalQty, unit)}`}</>
            ) : null}
          </p>
          {lastMove ? (
            <p className="mt-0.5 text-xs text-black/40">
              Letzte Buchung: {lastMove.type === "receipt" ? "+" : "−"}{formatQuantity(lastMove.quantity, lastMoveItem?.unit ?? unit)}
              {lastMoveItem ? ` ${lastMoveItem.name}` : ""}
              {" "}am {formatDate(lastMove.date)}
            </p>
          ) : null}
        </button>
        <button type="button" onClick={(e) => { e.stopPropagation(); onDeduction(); }}
          className="min-h-11 w-11 shrink-0 rounded-lg border border-red-200 bg-red-50 text-xl font-black text-red-700">−</button>
        <button type="button" onClick={(e) => { e.stopPropagation(); onReceipt(); }}
          className="min-h-11 w-11 shrink-0 rounded-lg border border-primaq-300 bg-primaq-50 text-xl font-black text-primaq-700">+</button>
        <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
          className="min-h-11 shrink-0 rounded-lg border border-black/10 bg-white px-3 text-xs font-bold text-black/40">
          Löschen
        </button>
      </div>

      {confirmDelete ? (
        <div className="flex items-center gap-2 border-t border-black/8 bg-red-50 px-3 py-2.5">
          <p className="flex-1 text-xs font-semibold text-red-800">
            {itemCount === 0
              ? "Kategorie wirklich löschen?"
              : `Kategorie inkl. ${itemCount} Artikel löschen?`}
          </p>
          <button type="button" onClick={() => setConfirmDelete(false)}
            className="min-h-8 rounded-lg border border-black/15 bg-white px-3 text-xs font-bold text-black/60">Nein</button>
          <button type="button" onClick={() => { onDelete(); setConfirmDelete(false); }}
            className="min-h-8 rounded-lg bg-red-600 px-3 text-xs font-bold text-white">Ja, löschen</button>
        </div>
      ) : null}
    </div>
  );
}

function CategoryDetailModal({
  category,
  items,
  movements,
  activeAssignmentsByItemId,
  consumedQtyByItemId,
  onClose,
  onAddItem,
  onUpdateItem,
  onMovement,
  onRename,
  onDelete,
}: {
  category: MaterialCategory;
  items: Record<string, MaterialItem>;
  movements: Record<string, import("./types").InventoryMovement[]>;
  activeAssignmentsByItemId: Record<string, number>;
  consumedQtyByItemId: Record<string, number>;
  onClose: () => void;
  onAddItem: (input: MaterialItemInput) => void;
  onUpdateItem: (itemId: string, patch: Partial<MaterialItem>) => void;
  onMovement: (itemId: string, input: MaterialMovementInput) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(category.name);
  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const catItems = category.itemIds.map((id) => items[id]).filter(Boolean) as MaterialItem[];
  const activeItems = catItems.filter((i) => i.active !== false);
  const inactiveItems = catItems.filter((i) => i.active === false);
  const visibleItems = showInactive ? catItems : activeItems;

  function submitRename() {
    if (nameInput.trim()) onRename(nameInput.trim());
    setEditingName(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white pb-safe-area shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-black/8 bg-white px-4 py-3">
          {editingName ? (
            <>
              <input autoFocus value={nameInput} onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitRename(); if (e.key === "Escape") setEditingName(false); }}
                className="min-h-9 flex-1 rounded-lg border border-black/15 bg-[#fbfcf8] px-3 text-base font-black outline-none focus:border-primaq-500" />
              <button type="button" onClick={submitRename} className="min-h-9 rounded-lg bg-primaq-500 px-3 text-sm font-bold text-white">OK</button>
              <button type="button" onClick={() => setEditingName(false)} className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold text-black/60">✕</button>
            </>
          ) : (
            <>
              <h3 className="flex-1 text-base font-black uppercase tracking-wide text-ink">{category.name}</h3>
              <button type="button" onClick={() => { setNameInput(category.name); setEditingName(true); }}
                className="min-h-8 rounded px-2 text-xs font-bold text-black/40">Umbenennen</button>
              {confirmDelete ? (
                <>
                  <span className="text-xs font-semibold text-red-700">Löschen?</span>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-8 rounded border border-black/15 bg-white px-2 text-xs font-bold text-black/60">Nein</button>
                  <button type="button" onClick={onDelete} className="min-h-8 rounded bg-red-600 px-2 text-xs font-bold text-white">Ja</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)}
                  className="min-h-8 rounded px-2 text-xs font-bold text-red-500">Löschen</button>
              )}
            </>
          )}
          <button type="button" onClick={onClose}
            className="ml-1 flex min-h-9 min-w-9 items-center justify-center rounded-lg bg-black/6 text-sm font-black text-black/50">✕</button>
        </div>

        {/* Item list */}
        <div className="divide-y divide-black/6">
          {visibleItems.length === 0 && !showAddItem ? (
            <p className="px-4 py-4 text-sm text-black/40">Noch keine Artikel. Klicke auf &bdquo;+ Artikel anlegen&ldquo;.</p>
          ) : (
            visibleItems.map((item) =>
              editingItemId === item.id ? (
                <div key={item.id} className="px-4 py-3">
                  <MaterialItemEditForm item={item}
                    onCancel={() => setEditingItemId(null)}
                    onSave={(patch) => { onUpdateItem(item.id, patch); setEditingItemId(null); }} />
                </div>
              ) : (
                <DetailItemRow key={item.id} item={item}
                  movements={movements[item.id] ?? []}
                  assignedQty={activeAssignmentsByItemId[item.id] ?? 0}
                  consumedQty={consumedQtyByItemId[item.id] ?? 0}
                  onEdit={() => { setEditingItemId(item.id); setShowAddItem(false); }}
                  onDeactivate={() => onUpdateItem(item.id, { active: false })}
                  onReactivate={() => onUpdateItem(item.id, { active: true })}
                  onMovement={(input) => onMovement(item.id, input)} />
              )
            )
          )}
        </div>

        {/* Add item form */}
        {showAddItem ? (
          <div className="border-t border-black/6 px-4 py-3">
            <MaterialItemAddForm defaultUnit={category.defaultUnit || "Stk."} onCancel={() => setShowAddItem(false)}
              onSubmit={(input) => { onAddItem(input); setShowAddItem(false); }} />
          </div>
        ) : null}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-black/8 px-4 py-3">
          <button type="button" onClick={() => { setShowAddItem(true); setEditingItemId(null); }}
            className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm font-bold text-black/70">
            <Plus className="h-4 w-4" /> Artikel anlegen
          </button>
          {inactiveItems.length > 0 ? (
            <button type="button" onClick={() => setShowInactive((v) => !v)}
              className="text-xs font-semibold text-black/40 underline">
              {showInactive ? "Deaktivierte ausblenden" : `${inactiveItems.length} deaktiviert`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function movementLabel(type: import("./types").InventoryMovementType): { label: string; sign: "+" | "−"; color: string } {
  switch (type) {
    case "receipt": return { label: "Wareneingang", sign: "+", color: "text-green-700" };
    case "deduction": return { label: "Abgang", sign: "−", color: "text-red-700" };
    case "assigned_to_shift": return { label: "Einsatz-Zuweisung", sign: "−", color: "text-primaq-700" };
    case "returned_from_shift": return { label: "Rückbuchung", sign: "+", color: "text-green-700" };
    case "loss": return { label: "Verlust", sign: "−", color: "text-red-700" };
    case "correction": return { label: "Korrektur", sign: "+", color: "text-black/50" };
  }
}

function DetailItemRow({
  item,
  movements,
  assignedQty,
  consumedQty,
  onEdit,
  onDeactivate,
  onReactivate,
  onMovement,
}: {
  item: MaterialItem;
  movements: import("./types").InventoryMovement[];
  assignedQty: number;
  consumedQty: number;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onMovement: (input: MaterialMovementInput) => void;
}) {
  const [panel, setPanel] = useState<"correction" | null>(null);
  const [confirmZero, setConfirmZero] = useState(false);
  const [corrTarget, setCorrTarget] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const { name, description, unit, quantityOnHand: qoh, active, purchasePriceCents, minQuantity, note: itemNote } = item;
  const isInactive = active === false;
  const corrParsed = parseQuantityInput(corrTarget);
  const corrDelta = typeof corrParsed === "number" ? Math.round((corrParsed - qoh) * 1000) / 1000 : null;
  const totalQty = qoh + assignedQty;
  const belowMin = minQuantity != null && qoh <= minQuantity && !isInactive;

  function commitCorrection() {
    if (corrDelta === null || corrDelta === 0) { setPanel(null); return; }
    const note = `Korrektur von ${formatQuantity(qoh, unit)} auf ${formatQuantity(corrParsed!, unit)}`;
    if (corrDelta > 0) onMovement({ type: "receipt", quantity: corrDelta, reason: "Korrektur", note });
    else onMovement({ type: "deduction", quantity: Math.abs(corrDelta), reason: "Korrektur", note });
    setCorrTarget(""); setPanel(null);
  }
  function commitZero() {
    if (qoh > 0) onMovement({ type: "deduction", quantity: qoh, reason: "Korrektur", note: "Bestand auf 0 gesetzt" });
    setConfirmZero(false);
  }

  const sortedMovements = [...movements].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className={`px-4 ${isInactive ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-2 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">{name}</p>
          {description ? <p className="text-xs text-black/45">{description}</p> : null}
          <p className="text-xs text-black/40">
            {unit}
            {purchasePriceCents ? ` · ${formatCurrency(purchasePriceCents)}/${unit}` : ""}
          </p>
          {itemNote ? <p className="text-xs italic text-black/35">{itemNote}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          {(assignedQty > 0 || consumedQty > 0) ? (
            <div className="mb-1 grid gap-0.5 text-xs">
              <div className="flex items-baseline justify-end gap-1.5">
                <span className="text-black/45">Lagerbestand:</span>
                <span className={`font-black tabular-nums ${belowMin ? "text-red-600" : "text-ink"}`}>
                  {formatQuantity(qoh, unit)}
                </span>
              </div>
              <div className="flex items-baseline justify-end gap-1.5">
                <span className="text-black/45">Im Einsatz:</span>
                <span className="font-black tabular-nums text-primaq-700">{formatQuantity(assignedQty, unit)}</span>
              </div>
              {consumedQty > 0 ? (
                <div className="flex items-baseline justify-end gap-1.5">
                  <span className="text-black/45">Verbraucht:</span>
                  <span className="font-black tabular-nums text-orange-600">−{formatQuantity(consumedQty, unit)}</span>
                </div>
              ) : null}
              <div className="flex items-baseline justify-end gap-1.5 border-t border-black/8 pt-0.5">
                <span className="text-black/45">Gesamt:</span>
                <span className="font-black tabular-nums text-ink">{formatQuantity(totalQty, unit)}</span>
              </div>
            </div>
          ) : (
            <p className={`tabular-nums text-lg font-black leading-none ${belowMin ? "text-red-600" : "text-ink"}`}>
              {formatQuantity(qoh, unit)}
            </p>
          )}
          {belowMin ? (
            <p className="mt-0.5 text-xs font-semibold text-red-600">⚠ Mindestbestand unterschritten</p>
          ) : minQuantity != null ? (
            <p className="mt-0.5 text-xs text-black/35">Min: {formatQuantity(minQuantity, unit)}</p>
          ) : null}
        </div>
        {!isInactive ? (
          <div className="flex shrink-0 flex-wrap gap-1">
            <button type="button" onClick={() => { setPanel(panel === "correction" ? null : "correction"); setConfirmZero(false); setCorrTarget(""); }}
              className={`min-h-9 rounded-lg border px-2 text-xs font-black ${panel === "correction" ? "border-primaq-400 bg-primaq-100 text-primaq-800" : "border-black/12 bg-white text-black/55"}`}>
              Korrig.
            </button>
            {confirmZero ? (
              <>
                <span className="flex items-center text-xs font-semibold text-red-700">Auf 0?</span>
                <button type="button" onClick={() => setConfirmZero(false)} className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-xs font-bold text-black/60">Nein</button>
                <button type="button" onClick={commitZero} className="min-h-9 rounded-lg bg-red-600 px-2 text-xs font-bold text-white">Ja</button>
              </>
            ) : (
              <button type="button" onClick={() => { setConfirmZero(true); setPanel(null); }}
                className="min-h-9 rounded-lg border border-red-200 bg-white px-2 text-xs font-black text-red-700">Auf 0</button>
            )}
            <button type="button" onClick={onEdit} className="min-h-9 rounded-lg border border-black/12 bg-white px-2 text-xs font-black text-black/55">Bearb.</button>
            <button type="button" onClick={onDeactivate} className="min-h-9 rounded-lg border border-black/12 bg-white px-2 text-xs font-black text-black/35">Deaktiv.</button>
          </div>
        ) : (
          <button type="button" onClick={onReactivate} className="min-h-9 rounded-lg border border-primaq-300 bg-primaq-50 px-2 text-xs font-black text-primaq-700">
            Wiederherstellen
          </button>
        )}
      </div>

      {movements.length > 0 && !isInactive ? (
        <div className="pb-2">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-xs font-semibold text-black/40 underline"
          >
            {showHistory ? "Buchungshistorie ausblenden" : `Buchungshistorie (${movements.length})`}
          </button>
          {showHistory ? (
            <div className="mt-2 overflow-hidden rounded-lg border border-black/8">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-black/8 bg-[#f5f5f0] text-left">
                    <th className="px-2 py-1.5 font-semibold text-black/50">Datum</th>
                    <th className="px-2 py-1.5 font-semibold text-black/50">Art</th>
                    <th className="px-2 py-1.5 text-right font-semibold text-black/50">Menge</th>
                    <th className="px-2 py-1.5 font-semibold text-black/50">Einsatz / Grund</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/6">
                  {sortedMovements.map((m) => {
                    const { label, sign, color } = movementLabel(m.type);
                    return (
                      <tr key={m.id} className="even:bg-[#fafafa]">
                        <td className="whitespace-nowrap px-2 py-1.5 text-black/50">{formatDate(m.date)}</td>
                        <td className="px-2 py-1.5 text-black/70">{label}</td>
                        <td className={`whitespace-nowrap px-2 py-1.5 text-right font-black tabular-nums ${color}`}>
                          {sign}{formatQuantity(m.quantity, unit)}
                        </td>
                        <td className="px-2 py-1.5 text-black/50">
                          {m.shiftName ? <span className="font-semibold">{m.shiftName}</span> : null}
                          {m.shiftName && (m.reason || m.note) ? " · " : null}
                          {m.reason ?? m.note ?? ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {panel === "correction" ? (
        <div className="mb-3 grid gap-2 rounded-lg border border-black/8 bg-[#f0f4ea] px-3 pb-3 pt-2">
          <p className="text-xs font-black text-ink">Bestand korrigieren</p>
          <p className="text-xs text-black/55">
            Aktuell: <strong>{formatQuantity(qoh, unit)}</strong>
            {typeof corrDelta === "number" && corrDelta !== 0 ? (
              <span className={`ml-2 font-bold ${corrDelta > 0 ? "text-green-700" : "text-red-700"}`}>
                → {corrDelta > 0 ? "+" : ""}{formatQuantity(corrDelta, unit)}
              </span>
            ) : null}
          </p>
          <label className="grid gap-1 text-xs font-semibold text-black/60">
            Neuer Zielbestand ({unit})
            <div className="flex min-h-10 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
              <input autoFocus inputMode="decimal" value={corrTarget} onChange={(e) => setCorrTarget(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitCorrection(); if (e.key === "Escape") setPanel(null); }}
                className="min-h-10 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none"
                placeholder={String(qoh).replace(".", ",")} />
              <span className="pr-2 text-xs text-black/40">{unit}</span>
            </div>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setPanel(null)} className="min-h-10 rounded-lg border border-black/15 bg-white text-sm font-bold text-black/65">Abbrechen</button>
            <button type="button" disabled={typeof corrDelta !== "number"}
              onClick={commitCorrection} className="min-h-10 rounded-lg bg-primaq-500 text-sm font-bold text-white disabled:bg-black/25">Korrigieren</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function QuickBookingModal({
  type,
  category,
  items,
  onClose,
  onAddItemWithMovement,
  onMovement,
}: {
  type: "receipt" | "deduction";
  category: MaterialCategory;
  items: Record<string, MaterialItem>;
  onClose: () => void;
  onAddItemWithMovement: (itemInput: { name: string; unit: string; purchasePriceCents?: number | null; minQuantity?: number | null; note?: string | null }, movInput: MaterialMovementInput) => void;
  onMovement: (itemId: string, input: MaterialMovementInput) => void;
}) {
  const catItems = category.itemIds.map((id) => items[id]).filter(Boolean) as MaterialItem[];
  const activeItems = catItems.filter((i) => i.active !== false);

  const [selectedId, setSelectedId] = useState<string | "new">(activeItems[0]?.id ?? "new");
  const [qty, setQty] = useState("");
  const [unitCount, setUnitCount] = useState("");  // Anzahl Kartons/Packungen
  const [price, setPrice] = useState("");
  const [receiptReason, setReceiptReason] = useState<"Einkauf" | "Rückgabe" | "Korrektur" | "">("Einkauf");
  const [deductReason, setDeductReason] = useState<"Verbrauch" | "Verlust" | "Korrektur" | "Vertippt" | "Sonstiges">("Verbrauch");
  const [deductNote, setDeductNote] = useState("");
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState(category.defaultUnit || "Stk.");
  const [newPrice, setNewPrice] = useState("");

  const isNew = selectedId === "new";
  const selectedItem = isNew ? null : (items[selectedId] ?? null);
  const unit = isNew ? (newUnit.trim() || "Stk.") : (selectedItem?.unit ?? "Stk.");

  // Einkaufseinheit-Berechnung: wenn Artikel Karton-Daten hat
  const hasPurchaseUnit = !isNew && !!selectedItem?.purchaseUnit && !!selectedItem?.itemsPerPurchaseUnit;
  const ipu = selectedItem?.itemsPerPurchaseUnit ?? 1;
  const parsedUnitCount = hasPurchaseUnit && unitCount.trim() ? parseQuantityInput(unitCount) : null;
  // qty-Feld hat Vorrang; wenn leer und Einheiten eingegeben → berechne
  const computedQtyFromUnits = parsedUnitCount != null && parsedUnitCount > 0 ? parsedUnitCount * ipu : null;
  const effectiveQtyStr = qty.trim() ? qty : (computedQtyFromUnits != null ? String(computedQtyFromUnits) : "");
  const parsedQty = parseQuantityInput(effectiveQtyStr);
  const canSubmit = (parsedQty ?? 0) > 0 && (isNew ? newName.trim().length > 0 : !!selectedItem);

  function handleSubmit() {
    if (!canSubmit || !parsedQty || parsedQty <= 0) return;
    const movInput: MaterialMovementInput = type === "receipt"
      ? { type: "receipt", quantity: parsedQty, reason: receiptReason || undefined }
      : { type: "deduction", quantity: parsedQty, reason: deductReason, note: deductNote.trim() || undefined };

    if (isNew) {
      onAddItemWithMovement(
        { name: newName.trim(), unit: newUnit.trim() || "Stk.", purchasePriceCents: newPrice.trim() ? toCents(newPrice) : null },
        movInput
      );
    } else if (selectedItem) {
      onMovement(selectedItem.id, movInput);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md overflow-y-auto rounded-t-2xl bg-white pb-safe-area shadow-xl sm:max-h-[90vh] sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/8 px-4 py-3">
          <div>
            <h3 className="text-base font-black text-ink">
              {type === "receipt" ? "Wareneingang buchen" : "Materialabgang buchen"}
            </h3>
            <p className="text-xs text-black/50">Kategorie: {category.name}</p>
          </div>
          <button type="button" onClick={onClose}
            className="flex min-h-9 min-w-9 items-center justify-center rounded-lg bg-black/6 text-sm font-black text-black/50">✕</button>
        </div>

        <div className="grid gap-4 px-4 py-4">
          {/* Article selector */}
          <fieldset className="grid gap-1.5">
            <legend className="text-xs font-semibold text-black/60">Artikel auswählen</legend>
            <div className="grid gap-1">
              {activeItems.map((item) => (
                <button key={item.id} type="button" onClick={() => setSelectedId(item.id)}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-bold ${selectedId === item.id ? "border-primaq-500 bg-primaq-50 text-primaq-800" : "border-black/10 bg-white text-black/70"}`}>
                  <span>{item.name}</span>
                  <span className="text-xs font-semibold text-black/40">{formatQuantity(item.quantityOnHand, item.unit)}</span>
                </button>
              ))}
              {type === "receipt" ? (
                <button type="button" onClick={() => setSelectedId("new")}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-bold ${isNew ? "border-primaq-500 bg-primaq-50 text-primaq-800" : "border-dashed border-black/20 bg-white text-black/50"}`}>
                  <Plus className="h-3.5 w-3.5" /> Neuer Artikel
                </button>
              ) : null}
              {activeItems.length === 0 && type === "deduction" ? (
                <p className="rounded-lg bg-[#fbfcf8] px-3 py-2 text-sm text-black/40">Keine aktiven Artikel in dieser Kategorie.</p>
              ) : null}
            </div>
          </fieldset>

          {/* New item fields */}
          {isNew ? (
            <div className="grid gap-2 rounded-lg border border-primaq-200 bg-primaq-50 p-3">
              <p className="text-xs font-black text-primaq-800">Neuer Artikel</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-black/60 sm:col-span-2">
                  Artikelname *
                  <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                    placeholder="z. B. Becherwaffel"
                    className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-black/60">
                  Einheit
                  <input value={newUnit} onChange={(e) => setNewUnit(e.target.value)}
                    className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-black/60">
                  Preis/Einheit (opt.)
                  <input inputMode="decimal" value={newPrice} onChange={(e) => setNewPrice(e.target.value)}
                    placeholder="0,00 €"
                    className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
                </label>
              </div>
            </div>
          ) : null}

          {/* Einkaufseinheit-Helper (nur bei Wareneingang mit konfiguriertem Artikel) */}
          {type === "receipt" && hasPurchaseUnit ? (
            <div className="grid gap-2 rounded-lg border border-primaq-200 bg-primaq-50 p-3">
              <p className="text-xs font-black text-primaq-800">Eingang per {selectedItem!.purchaseUnit}</p>
              <label className="grid gap-1 text-xs font-semibold text-black/60">
                Anzahl {selectedItem!.purchaseUnit}s
                <div className="flex min-h-11 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
                  <input inputMode="numeric" value={unitCount} onChange={(e) => { setUnitCount(e.target.value); setQty(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") onClose(); }}
                    className="min-h-11 min-w-0 flex-1 bg-transparent px-3 text-base font-bold outline-none" placeholder="1" />
                  <span className="pr-3 text-sm text-black/40">{selectedItem!.purchaseUnit}</span>
                </div>
              </label>
              {parsedUnitCount != null && parsedUnitCount > 0 ? (
                <p className="text-sm font-bold text-primaq-700">
                  = {parsedUnitCount} × {ipu} {unit} = <span className="text-base">{parsedUnitCount * ipu} {unit}</span>
                </p>
              ) : (
                <p className="text-xs text-black/40">{ipu} {unit} je {selectedItem!.purchaseUnit}</p>
              )}
            </div>
          ) : null}

          {/* Quantity */}
          <label className="grid gap-1 text-xs font-semibold text-black/60">
            {type === "receipt" && hasPurchaseUnit ? `Gesamtmenge (${unit}) — oder direkt eingeben` : `Menge (${unit})`}
            <div className="flex min-h-11 items-center rounded-lg border border-black/15 bg-[#fbfcf8] focus-within:border-primaq-500">
              <input autoFocus={!isNew && !hasPurchaseUnit} inputMode="decimal"
                value={qty}
                onChange={(e) => { setQty(e.target.value); if (e.target.value) setUnitCount(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") onClose(); }}
                placeholder={computedQtyFromUnits != null ? String(computedQtyFromUnits) : "0"}
                className="min-h-11 min-w-0 flex-1 bg-transparent px-3 text-base font-bold outline-none" />
              <span className="pr-3 text-sm text-black/40">{unit}</span>
            </div>
          </label>

          {/* Receipt extras */}
          {type === "receipt" && !isNew ? (
            <>
              <label className="grid gap-1 text-xs font-semibold text-black/60">
                Einkaufspreis je {unit} (opt.)
                <div className="flex min-h-10 items-center rounded-lg border border-black/15 bg-[#fbfcf8] focus-within:border-primaq-500">
                  <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
                    className="min-h-10 min-w-0 flex-1 bg-transparent px-3 text-sm font-bold outline-none" placeholder="0,00" />
                  <span className="pr-3 text-xs text-black/40">EUR</span>
                </div>
              </label>
              <fieldset className="grid gap-1.5">
                <legend className="text-xs font-semibold text-black/60">Grund (optional)</legend>
                <div className="grid grid-cols-3 gap-1">
                  {(["Einkauf", "Rückgabe", "Korrektur"] as const).map((g) => (
                    <button key={g} type="button" onClick={() => setReceiptReason(receiptReason === g ? "" : g)}
                      className={`min-h-9 rounded-lg border text-xs font-bold ${receiptReason === g ? "border-primaq-500 bg-white text-primaq-700" : "border-black/10 bg-white text-black/55"}`}>
                      {g}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          ) : null}

          {/* Deduction extras */}
          {type === "deduction" ? (
            <>
              <fieldset className="grid gap-1.5">
                <legend className="text-xs font-semibold text-black/60">Grund (Pflicht)</legend>
                <div className="grid grid-cols-3 gap-1">
                  {(["Verbrauch", "Verlust", "Korrektur", "Vertippt", "Sonstiges"] as const).map((g) => (
                    <button key={g} type="button" onClick={() => setDeductReason(g)}
                      className={`min-h-9 rounded-lg border text-xs font-bold ${deductReason === g ? "border-red-500 bg-white text-red-700" : "border-black/10 bg-white text-black/55"}`}>
                      {g}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="grid gap-1 text-xs font-semibold text-black/60">
                Notiz (opt.)
                <input value={deductNote} onChange={(e) => setDeductNote(e.target.value)}
                  className="min-h-9 rounded-lg border border-black/15 bg-[#fbfcf8] px-3 text-sm outline-none focus:border-red-400" />
              </label>
            </>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-black/8 px-4 pb-4 pt-3">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-black/15 bg-white text-sm font-bold text-black/65">Abbrechen</button>
          <button type="button" disabled={!canSubmit} onClick={handleSubmit}
            className={`min-h-11 rounded-lg text-sm font-bold text-white disabled:bg-black/25 ${type === "receipt" ? "bg-primaq-500" : "bg-red-600"}`}>
            Buchen
          </button>
        </div>
      </div>
    </div>
  );
}

const SALE_TAG_OPTIONS = [
  { value: "", label: "— Kein Verkaufsverbrauch —" },
  { value: "Waffel", label: "Waffel" },
  { value: "Waffelbecher", label: "Waffelbecher" },
  { value: "Becher", label: "Becher (Pappbecher)" },
  { value: "Löffel", label: "Löffel" },
  { value: "Serviette", label: "Serviette" },
  { value: "topping", label: "Topping" },
];

function MaterialItemAddForm({
  defaultUnit,
  onCancel,
  onSubmit,
}: {
  defaultUnit: string;
  onCancel: () => void;
  onSubmit: (input: MaterialItemInput) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState(defaultUnit || "Stk.");
  const [price, setPrice] = useState("");
  const [minQty, setMinQty] = useState("");
  const [startQty, setStartQty] = useState("");
  const [saleTag, setSaleTag] = useState("");
  const [purchaseUnit, setPurchaseUnit] = useState("");
  const [itemsPerUnit, setItemsPerUnit] = useState("");

  function handleSubmit() {
    if (!name.trim()) return;
    const ipu = parseQuantityInput(itemsPerUnit);
    onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      unit: unit.trim() || "Stk.",
      purchasePriceCents: price.trim() ? toCents(price) : null,
      minQuantity: minQty.trim() ? (parseQuantityInput(minQty) ?? null) : null,
      startQuantity: startQty.trim() ? (parseQuantityInput(startQty) ?? undefined) : undefined,
      saleTag: saleTag || undefined,
      purchaseUnit: purchaseUnit.trim() || undefined,
      itemsPerPurchaseUnit: ipu && ipu > 0 ? ipu : undefined,
    });
  }

  return (
    <div>
      <p className="mb-3 text-xs font-black text-ink">Artikel anlegen</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-black/60 sm:col-span-2">
          Artikelname *
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") onCancel(); }}
            placeholder="z. B. Waffel Standard"
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/60 sm:col-span-2">
          Beschreibung (opt.)
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="z. B. Standard Softeiswaffel 120 mm"
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/60">
          Einheit
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Stk."
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/60">
          Einkaufspreis je Einheit (opt.)
          <div className="flex min-h-9 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
              className="min-h-9 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none" placeholder="0,00" />
            <span className="pr-2 text-xs text-black/40">EUR</span>
          </div>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/60">
          Mindestbestand (opt.)
          <input inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value)}
            placeholder="—"
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/60">
          Startbestand (opt.)
          <input inputMode="decimal" value={startQty} onChange={(e) => setStartQty(e.target.value)}
            placeholder="0"
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
        {/* Verkaufsverknüpfung */}
        <label className="grid gap-1 text-xs font-semibold text-black/60 sm:col-span-2">
          Verkaufsverbrauch (opt.)
          <select value={saleTag} onChange={(e) => setSaleTag(e.target.value)}
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500">
            {SALE_TAG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {/* Einkaufseinheit */}
        <label className="grid gap-1 text-xs font-semibold text-black/60">
          Einkaufseinheit (opt.)
          <input value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)}
            placeholder="z. B. Karton"
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/60">
          Stück je Einheit (opt.)
          <input inputMode="numeric" value={itemsPerUnit} onChange={(e) => setItemsPerUnit(e.target.value)}
            placeholder="z. B. 1000"
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="min-h-9 rounded-lg border border-black/15 bg-white text-sm font-bold text-black/65">Abbrechen</button>
        <button type="button" disabled={!name.trim()} onClick={handleSubmit}
          className="min-h-9 rounded-lg bg-primaq-500 text-sm font-bold text-white disabled:bg-black/25">Anlegen</button>
      </div>
    </div>
  );
}

function MaterialItemEditForm({
  item,
  onCancel,
  onSave,
}: {
  item: MaterialItem;
  onCancel: () => void;
  onSave: (patch: Partial<MaterialItem>) => void;
}) {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? "");
  const [unit, setUnit] = useState(item.unit);
  const [price, setPrice] = useState(item.purchasePriceCents ? String(item.purchasePriceCents / 100).replace(".", ",") : "");
  const [minQty, setMinQty] = useState(item.minQuantity != null ? String(item.minQuantity).replace(".", ",") : "");
  const [note, setNote] = useState(item.note ?? "");
  const [saleTag, setSaleTag] = useState(item.saleTag ?? "");
  const [purchaseUnit, setPurchaseUnit] = useState(item.purchaseUnit ?? "");
  const [itemsPerUnit, setItemsPerUnit] = useState(item.itemsPerPurchaseUnit != null ? String(item.itemsPerPurchaseUnit) : "");
  return (
    <div>
      <p className="mb-2 text-xs font-black text-ink">Artikel bearbeiten</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-black/70 sm:col-span-2">
          Artikelname
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/70 sm:col-span-2">
          Beschreibung (opt.)
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="z. B. Standard Softeiswaffel 120 mm"
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/70">
          Einheit
          <input value={unit} onChange={(e) => setUnit(e.target.value)}
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/70">
          Einkaufspreis je Einheit (opt.)
          <div className="flex min-h-9 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
              className="min-h-9 min-w-0 flex-1 bg-transparent px-2 text-sm font-bold outline-none" placeholder="0,00" />
            <span className="pr-2 text-xs text-black/40">EUR</span>
          </div>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/70">
          Mindestbestand (opt.)
          <input inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value)}
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/70">
          Notiz (opt.)
          <input value={note} onChange={(e) => setNote(e.target.value)}
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/70 sm:col-span-2">
          Verkaufsverbrauch (opt.)
          <select value={saleTag} onChange={(e) => setSaleTag(e.target.value)}
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500">
            {SALE_TAG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/70">
          Einkaufseinheit (opt.)
          <input value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)}
            placeholder="z. B. Karton"
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-black/70">
          Stück je Einheit (opt.)
          <input inputMode="numeric" value={itemsPerUnit} onChange={(e) => setItemsPerUnit(e.target.value)}
            placeholder="z. B. 1000"
            className="min-h-9 rounded-lg border border-black/15 bg-white px-2 text-sm font-bold outline-none focus:border-primaq-500" />
        </label>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="min-h-9 rounded-lg border border-black/15 bg-white text-sm font-bold text-black/65">Abbrechen</button>
        <button type="button" onClick={() => {
          const ipu = parseQuantityInput(itemsPerUnit);
          onSave({
            name: name.trim() || item.name,
            description: description.trim() || null,
            unit: unit.trim() || "Stk.",
            purchasePriceCents: price.trim() ? toCents(price) : null,
            minQuantity: minQty.trim() ? (parseQuantityInput(minQty) ?? null) : null,
            note: note.trim() || null,
            saleTag: saleTag || undefined,
            purchaseUnit: purchaseUnit.trim() || undefined,
            itemsPerPurchaseUnit: ipu && ipu > 0 ? ipu : undefined,
          });
        }}
          className="min-h-9 rounded-lg bg-primaq-500 text-sm font-bold text-white">Speichern</button>
      </div>
    </div>
  );
}
