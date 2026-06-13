"use client";

import { useEffect, useMemo } from "react";
import { SalesCounter } from "./sales-counter";
import { useMvpStore } from "./use-mvp-store";
import { packagingConsumptionRules } from "./catalog";

export function VerkaufClient() {
  const {
    activeShift,
    machines,
    currentOrder,
    openOrders,
    activeOrderId,
    dailySales,
    inventoryReport,
    materialItems,
    shiftMaterialAssignments,
    addOrderItem,
    decrementOrderItem,
    incrementItemInActiveOpenOrder,
    addOpenOrder,
    setActiveOrder,
    removeOrderItem,
    clearActiveOpenOrder,
    deleteActiveOpenOrder,
    setOrderPaymentMethod,
    setOrderCashReceived,
    checkoutCurrentOrder,
    undoLastOrder,
    undoInfo,
    sumupSettings,
    favorites,
    toggleFavorite,
    totals,
    completedOrders,
  } = useMvpStore();

  const salesCount = activeShift
    ? completedOrders.filter((o) => o.shiftId === activeShift.id && o.status === "completed").length
    : 0;

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    console.log("dailySales", dailySales);
  }, [dailySales]);

  const hasActiveShift = Boolean(activeShift);

  // Material-Warnungen: prüfe für jede Verpackungsregel ob Einsatzbestand vorhanden
  const materialWarnings = useMemo(() => {
    if (!activeShift) return [];
    const shiftAssignments = shiftMaterialAssignments.filter((a) => a.shiftId === activeShift.id);
    const warnings: { tag: string; name: string; severity: "empty" | "low" }[] = [];
    const seenTags = new Set<string>();

    for (const rules of Object.values(packagingConsumptionRules)) {
      for (const { saleTag } of rules) {
        if (seenTags.has(saleTag)) continue;
        seenTags.add(saleTag);
        // Finde MaterialItem mit diesem saleTag
        const item = Object.values(materialItems).find((i) => i.saleTag === saleTag && i.active !== false);
        if (!item) continue;
        const assignment = shiftAssignments.find((a) => a.itemId === item.id);
        // Ohne Zuweisung oder bei automatisch erfasstem Verbrauch (assignedQty === consumedQty)
        // ist der Lagerbestand (quantityOnHand) der maßgebliche Restbestand.
        const remaining = !assignment || assignment.autoTracked
          ? item.quantityOnHand
          : Math.max(0, assignment.assignedQty - (assignment.consumedQty ?? 0) - assignment.returnedQty - assignment.lossQty);
        if (remaining === 0) {
          warnings.push({ tag: saleTag, name: item.name, severity: "empty" });
        } else if (item.minQuantity != null && remaining < item.minQuantity) {
          warnings.push({ tag: saleTag, name: item.name, severity: "low" });
        }
      }
    }
    return warnings;
  }, [activeShift, shiftMaterialAssignments, materialItems]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <SalesCounter
        active={hasActiveShift}
        machines={machines}
        mixLines={inventoryReport.mixLines}
        currentOrder={currentOrder}
        openOrders={openOrders}
        activeOrderId={activeOrderId}
        onAddOrderItem={addOrderItem}
        onDecrementOrderItem={decrementOrderItem}
        onIncrementOrderItem={incrementItemInActiveOpenOrder}
        onAddOpenOrder={addOpenOrder}
        onSetActiveOrder={setActiveOrder}
        onRemoveOrderItem={removeOrderItem}
        onClearOrder={clearActiveOpenOrder}
        onDeleteOrder={deleteActiveOpenOrder}
        onPaymentMethodChange={setOrderPaymentMethod}
        onCashReceivedChange={setOrderCashReceived}
        onCheckout={checkoutCurrentOrder}
        onUndoLastOrder={undoLastOrder}
        undoInfo={undoInfo}
        materialWarnings={materialWarnings}
        sumupSettings={sumupSettings}
        favorites={favorites}
        onToggleFavorite={toggleFavorite}
        totalPieces={totals.totalPieces}
        totalRevenueCents={totals.expectedRevenueCents}
        salesCount={salesCount}
      />
    </div>
  );
}
