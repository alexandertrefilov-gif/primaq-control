"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { formatCurrency, withoutMachinePrefix } from "./calculations";
import { OrderPanel } from "./sales-counter";
import type { CurrentOrderItem, DailyOrder } from "./types";
import { useMvpStore } from "./use-mvp-store";

export function BestellungClient() {
  const router = useRouter();
  const {
    activeShift,
    currentOrder,
    openOrders,
    activeOrderId,
    dailySales,
    addOpenOrder,
    setActiveOrder,
    removeOrderItem,
    clearActiveOpenOrder,
    deleteActiveOpenOrder,
    decrementItemInActiveOpenOrder,
    incrementItemInActiveOpenOrder,
    setOrderPaymentMethod,
    setOrderCashReceived,
    checkoutCurrentOrder,
    cancelCompletedOrder,
    cancelCompletedOrderItem
  } = useMvpStore();

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    console.log("currentOrder", currentOrder);
    console.log("totalGross", currentOrder.totalGrossCents);
    console.log("dailySales", dailySales);
  }, [currentOrder, dailySales]);

  return (
    <div className="grid gap-4">
      <Link
        href="/verkauf"
        className="flex min-h-12 items-center justify-center rounded-lg border border-black/10 bg-white px-4 text-sm font-bold text-black/70"
      >
        Zurück zum Verkauf
      </Link>
      <OrderPanel
        active={Boolean(activeShift)}
        order={currentOrder}
        orders={openOrders}
        activeOrderId={activeOrderId}
        onAddOrder={addOpenOrder}
        onSelectOrder={setActiveOrder}
        onRemoveOrderItem={removeOrderItem}
        onClearOrder={clearActiveOpenOrder}
        onDeleteOrder={deleteActiveOpenOrder}
        onIncrementOrderItem={incrementItemInActiveOpenOrder}
        onDecrementOrderItem={decrementItemInActiveOpenOrder}
        onPaymentMethodChange={setOrderPaymentMethod}
        onCashReceivedChange={setOrderCashReceived}
        onCheckout={checkoutCurrentOrder}
        onCheckoutComplete={() => router.push("/verkauf")}
      />
      <BookedOrdersCorrectionPanel
        orders={dailySales.orders}
        onCancelOrder={cancelCompletedOrder}
        onCancelItem={cancelCompletedOrderItem}
      />
    </div>
  );
}

function BookedOrdersCorrectionPanel({
  orders,
  onCancelOrder,
  onCancelItem
}: {
  orders: DailyOrder[];
  onCancelOrder: (orderId: string, reason?: string) => void;
  onCancelItem: (orderId: string, itemId: string, reason?: string) => void;
}) {
  const originalOrders = orders.filter((order) => order.status !== "correction");
  const correctionOrders = orders.filter((order) => order.status === "correction");

  if (!orders.length) {
    return null;
  }

  return (
    <section data-testid="booked-orders-panel" className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-ink">Gebuchte Bestellungen</h2>
        <p className="mt-1 text-sm text-black/60">Stornos werden als Gegenbuchung gespeichert. Die Originalbestellung bleibt erhalten.</p>
      </div>

      <div className="mt-4 grid gap-3">
        {originalOrders.map((order) => {
          const remainingQuantity = order.items.reduce(
            (sum, item) => sum + getRemainingCorrectableQuantity(orders, order.id, item.itemId ?? item.id),
            0
          );

          return (
            <article key={order.id} data-testid={`booked-order-${order.id}`} className="rounded-lg border border-black/10 bg-[#fbfcf8] p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-ink">Bestellung {order.orderNumber}</p>
                  <p className="mt-1 text-xs font-medium text-black/55">
                    {new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date(order.bookedAt))}
                    {" · "}
                    {order.paymentMethod === "cash" ? "Bar" : "Karte"}
                    {" · "}
                    {formatCurrency(order.totalGrossCents)}
                  </p>
                </div>
                <button
                  type="button"
                  data-testid={`cancel-order-${order.id}`}
                  disabled={remainingQuantity <= 0}
                  onClick={() => {
                    const reason = window.prompt("Grund für Storno der Bestellung?", "Bestellung storniert") ?? undefined;
                    onCancelOrder(order.id, reason);
                  }}
                  className="min-h-10 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Bestellung stornieren
                </button>
              </div>

              <div className="mt-3 grid gap-2">
                {order.items.map((item) => {
                  const remaining = getRemainingCorrectableQuantity(orders, order.id, item.itemId ?? item.id);

                  return (
                    <div key={item.id} className="grid gap-2 rounded-lg bg-white p-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-ink">
                          {item.quantity} × {withoutMachinePrefix(item.itemNameAtBooking ?? item.name)}
                        </p>
                        <p className="mt-1 text-xs text-black/55">
                          {item.packageNameAtBooking ?? [item.portionType ?? item.packagingType, item.packagingSize].filter(Boolean).join(" ")}
                          {" · "}
                          offen stornierbar: {remaining}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={remaining <= 0}
                        onClick={() => {
                          const reason = window.prompt("Grund für Storno der Position?", "Position storniert") ?? undefined;
                          onCancelItem(order.id, item.itemId ?? item.id, reason);
                        }}
                        className="min-h-10 rounded-lg border border-black/10 bg-white px-3 text-xs font-bold text-black/70 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Position stornieren
                      </button>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>

      {correctionOrders.length ? (
        <div data-testid="corrections-panel" className="mt-4 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-900">
          <p className="font-bold">Korrekturen</p>
          <div className="mt-2 grid gap-1">
            {correctionOrders.map((order) => (
              <p key={order.id}>
                Bestellung {order.orderNumber}: {formatCurrency(order.totalGrossCents)} · Bezug {order.originalOrderId} · {order.correctionReason ?? "ohne Grund"}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function getRemainingCorrectableQuantity(orders: DailyOrder[], originalOrderId: string, originalItemId: string) {
  const originalOrder = orders.find((order) => order.id === originalOrderId && order.status !== "correction");
  const originalItem = originalOrder?.items.find((item) => (item.itemId ?? item.id) === originalItemId);
  const originalQuantity = originalItem?.quantity ?? 0;
  const correctedQuantity = orders
    .filter((order) => order.status === "correction" && order.originalOrderId === originalOrderId)
    .flatMap((order) => order.items)
    .filter((item: CurrentOrderItem) => item.originalItemId === originalItemId)
    .reduce((sum, item) => sum + Math.abs(Math.min(0, item.quantity)), 0);

  return Math.max(0, originalQuantity - correctedQuantity);
}
