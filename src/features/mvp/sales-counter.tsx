"use client";

import Link from "next/link";
import { RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { formatCurrency, formatMachineDisplayName, toCents, withoutMachinePrefix } from "./calculations";
import type { CurrentOrder, CurrentOrderItem, DailyOrder, InventoryReport, Machine, MixInventoryStatus, OrderPaymentMethod, PackagingType, SoftServeProduct, SumupSettings } from "./types";

type UndoInfo = { order: DailyOrder; canUndo: boolean; isFinalized: boolean } | null;

type SalesCounterProps = {
  active: boolean;
  machines: Machine[];
  mixLines: InventoryReport["mixLines"];
  currentOrder: CurrentOrder;
  openOrders: CurrentOrder[];
  activeOrderId: string;
  onAddOrderItem: (item: Omit<CurrentOrderItem, "quantity" | "lineTotalGrossCents">) => void;
  onDecrementOrderItem: (itemId: string) => void;
  onIncrementOrderItem: (itemId: string) => void;
  onAddOpenOrder: () => void;
  onSetActiveOrder: (orderId: string) => void;
  onRemoveOrderItem: (itemId: string) => void;
  onClearOrder: () => void;
  onDeleteOrder: () => void;
  onPaymentMethodChange: (paymentMethod: OrderPaymentMethod) => void;
  onCashReceivedChange: (cashReceivedCents: number) => void;
  onCheckout: () => void;
  onCheckoutComplete?: () => void;
  onUndoLastOrder?: () => void;
  undoInfo?: UndoInfo;
  materialWarnings?: { tag: string; name: string; severity: "empty" | "low" }[];
  sumupSettings?: SumupSettings;
  favorites?: string[];
  onToggleFavorite?: (productId: string) => void;
  totalPieces?: number;
  totalRevenueCents?: number;
  salesCount?: number;
};

const quickAmounts = [500, 1000, 2000, 5000, 10000];

export function SalesCounter({
  active,
  machines,
  mixLines,
  currentOrder,
  openOrders,
  activeOrderId,
  onAddOrderItem,
  onDecrementOrderItem,
  onIncrementOrderItem,
  onAddOpenOrder,
  onSetActiveOrder,
  onRemoveOrderItem,
  onClearOrder,
  onDeleteOrder,
  onPaymentMethodChange,
  onCashReceivedChange,
  onCheckout,
  onCheckoutComplete,
  onUndoLastOrder,
  undoInfo,
  materialWarnings,
  sumupSettings,
  favorites = [],
  onToggleFavorite,
  totalPieces = 0,
  totalRevenueCents = 0,
  salesCount = 0,
}: SalesCounterProps) {
  const mixLineLookup = useMemo(
    () =>
      new Map(
        mixLines.map((line) => [
          line.productId,
          // Ohne aktiven Einsatz darf kein Bestand aus alten mixStocks-Daten im Verkauf erscheinen.
          active ? line : { ...line, remainingLiters: 0, estimatedRemainingPortions: 0, status: "Leer" as const, isEmergencyMode: false }
        ] as const)
      ),
    [mixLines, active]
  );
  const visibleMachines = useMemo(
    () =>
      machines
        .filter((machine) => machine.active !== false && machine.visibleInSale !== false)
        .map((machine) => {
          const visibleProducts = dedupeProductsById(machine.products.filter((item) => item.visibleInSale !== false));

          return {
            ...machine,
            products: visibleProducts,
            productGroups: groupProductsByPackagingType(visibleProducts),
            stockLines: getMachineStockLines(visibleProducts, mixLineLookup)
          };
        })
        .filter((machine) => machine.products.length > 0),
    [machines, mixLineLookup]
  );
  const productLookup = useMemo(
    () => new Map(machines.flatMap((machine) => machine.products).map((product) => [product.id, product] as const)),
    [machines]
  );
  const siblingProductsLookup = useMemo(
    () => new Map(machines.flatMap((machine) => machine.products.map((product) => [product.id, machine.products] as const))),
    [machines]
  );
  const orderStockIssue = useMemo(
    () => getOrderStockIssue(currentOrder, productLookup, siblingProductsLookup, mixLineLookup),
    [currentOrder, productLookup, siblingProductsLookup, mixLineLookup]
  );

  // Favoriten: aufgelöste Produkt+Maschinen-Paare
  const favoritesData = useMemo(() => {
    if (!favorites.length) return [];
    return favorites.flatMap((productId) => {
      for (const machine of visibleMachines) {
        const product = machine.products.find((p) => p.id === productId);
        if (product) return [{ machine, product }];
      }
      return [];
    });
  }, [favorites, visibleMachines]);

  // Letzte Bestellung wiederholen
  function handleRepeatLastOrder() {
    if (!undoInfo?.order) return;
    const items = undoInfo.order.items.filter((i) => i.quantity > 0);
    for (const item of items) {
      for (let i = 0; i < item.quantity; i++) {
        onAddOrderItem({
          id: item.id,
          productId: item.productId,
          machineId: item.machineId,
          machineNumber: item.machineNumber,
          name: item.name,
          packagingType: item.packagingType,
          packagingSize: item.packagingSize,
          toppingName: item.toppingName,
          parentProductId: item.parentProductId,
          unitPriceGrossCents: item.unitPriceGrossCents,
          vatRate: item.vatRate,
        });
      }
    }
  }
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    console.log("currentOrder", currentOrder);
    console.log("totalGross", currentOrder.totalGrossCents);
  }, [currentOrder]);

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-2 min-[1024px]:grid-cols-[minmax(0,1fr)_360px] min-[1024px]:gap-3">

      {/* ── LINKS: Monitor + Stats + Produktkacheln ───────────── */}
      <div className="flex min-h-0 flex-col gap-2 min-[1024px]:overflow-y-auto min-[1024px]:[scrollbar-width:thin]">

        {/* Phase 2: Live-Einsatzmonitor */}
        {active && visibleMachines.some((m) => m.stockLines.length > 0) ? (
          <LiveShiftMonitor machines={visibleMachines} />
        ) : null}

        {/* Phase 3: Verkaufszähler */}
        {active ? (
          <SalesStatsBar
            salesCount={salesCount}
            totalPieces={totalPieces}
            totalRevenueCents={totalRevenueCents}
          />
        ) : null}

        <div className="flex flex-col rounded-lg border border-black/10 bg-white p-3 shadow-sm">

          {/* Phase 1b: Letzte Bestellung wiederholen */}
          {undoInfo?.order && active ? (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-black/8 bg-[#f7f8f4] px-3 py-2">
              <span className="text-xs text-black/50 truncate">
                Letzte: {undoInfo.order.items.map((i) => `${i.quantity}× ${withoutMachinePrefix(i.name)}`).join(", ")}
              </span>
              <button
                type="button"
                onClick={handleRepeatLastOrder}
                className="shrink-0 rounded-lg bg-primaq-500 px-3 py-1.5 text-xs font-black text-white"
              >
                ↺ Wiederholen
              </button>
            </div>
          ) : null}

          {/* Phase 1a: Favoriten-Bereich */}
          {favoritesData.length > 0 ? (
            <div className="mb-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-primaq-600">⭐ Favoriten</p>
              <div className="flex flex-wrap gap-2">
                {favoritesData.map(({ machine, product }, idx) => (
                  <SaleProductButton
                    key={`fav-${product.id}`}
                    machineId={machine.id}
                    machineNumber={machine.number}
                    product={product}
                    siblingProducts={machine.products}
                    productIndex={idx}
                    mixLineLookup={mixLineLookup}
                    onAddOrderItem={onAddOrderItem}
                    isFavorite={true}
                    onToggleFavorite={onToggleFavorite}
                    compact
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="overflow-y-auto pr-1">
            {materialWarnings && materialWarnings.length > 0 && active ? (
              <div className="mb-3 grid gap-1.5 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                {materialWarnings.map((w) => (
                  <div key={w.tag} className="flex items-center gap-2 text-sm">
                    <span>{w.severity === "empty" ? "🔴" : "🟡"}</span>
                    <span className={`font-bold ${w.severity === "empty" ? "text-red-800" : "text-yellow-900"}`}>
                      {w.name}: {w.severity === "empty" ? "Einsatzbestand leer" : "Einsatzbestand niedrig"}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {!active && visibleMachines.length > 0 ? (
              <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
                <p className="text-sm font-bold text-orange-900">Kein aktiver Einsatz</p>
                <p className="mt-0.5 text-sm text-orange-800">
                  Artikel auswählen ist möglich. Zum Buchen bitte zuerst{" "}
                  <Link href="/einsaetze" className="font-semibold underline">
                    Einsatz starten
                  </Link>
                  .
                </p>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 min-[600px]:grid-cols-2">
              {visibleMachines.map((machine, machineIndex) => (
                <section
                  key={machine.id}
                  data-testid={`sale-machine-${machine.id}`}
                  className="min-w-0 rounded-lg border border-black/10 bg-[#fbfcf8] p-2.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase text-primaq-700">M{machineIndex + 1}</p>
                      <h3 className="text-sm font-bold leading-tight text-ink">
                        {formatMachineDisplayName(machine.name, machine.number || String(machineIndex + 1))}
                      </h3>
                    </div>
                    <p className="shrink-0 text-[10px] font-semibold text-black/55">{machine.location}</p>
                  </div>

                  {machine.stockLines.length ? (
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {machine.stockLines.map((line) => (
                        <MachineStockStatus
                          key={line.stockFlavorId}
                          line={line}
                        />
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-2 grid gap-2">
                    {machine.productGroups.map((group) => (
                      <div key={group.packagingType} className="grid gap-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-black/55">{group.packagingType}</p>
                        <div className="flex flex-wrap content-start items-start gap-1.5">
                          {group.products.map((product, productIndex) => (
                            <SaleProductButton
                              key={product.id}
                              machineId={machine.id}
                              machineNumber={machine.number}
                              product={product}
                              siblingProducts={machine.products}
                              productIndex={productIndex}
                              mixLineLookup={mixLineLookup}
                              onAddOrderItem={onAddOrderItem}
                              isFavorite={favorites.includes(product.id)}
                              onToggleFavorite={onToggleFavorite}
                            />
                          ))}
                        </div>
                      </div>
                    ))}

                    {machine.products.some((product) => product.toppingEnabled) ? (
                      <div className="grid gap-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-black/55">Topping</p>
                        <div className="flex flex-wrap content-start items-start gap-1.5">
                          {machine.products
                            .filter((product) => product.toppingEnabled)
                            .map((product, productIndex) => (
                              <ToppingButton
                                key={`${product.id}-topping`}
                                machineId={machine.id}
                                machineNumber={machine.number}
                                product={product}
                                siblingProducts={machine.products}
                                productIndex={productIndex}
                                onAddOrderItem={onAddOrderItem}
                              />
                            ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>
              ))}
            </div>

            {visibleMachines.length === 0 ? (
              <div className="mt-4 rounded-lg border border-black/10 bg-[#fbfcf8] p-4 text-sm font-medium text-black/60">
                <p className="text-base font-bold text-ink">Keine sichtbaren Sorten vorhanden.</p>
                <p className="mt-2 leading-5">
                  Prüfe in den Einstellungen, ob eine Maschine aktiv ist, im Verkauf angezeigt wird und die Sorten ebenfalls sichtbar sind.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href="/einstellungen"
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primaq-500 px-4 text-sm font-bold text-white"
                  >
                    Einstellungen öffnen
                  </Link>
                  {!active ? (
                    <Link
                      href="/einsaetze"
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-orange-200 bg-orange-50 px-4 text-sm font-bold text-orange-900"
                    >
                      Einsatz starten
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}

          </div>
        </div>
      </div>

      {/* ── RECHTS: Kalkulator + Kasse ────────────────────────── */}
      <div className="flex min-h-0 flex-col gap-2">
        <div className="min-h-0 flex-1">
          <OrderPanel
            active={active}
            order={currentOrder}
            orders={openOrders}
            activeOrderId={activeOrderId}
            onAddOrder={onAddOpenOrder}
            onSelectOrder={onSetActiveOrder}
            onRemoveOrderItem={onRemoveOrderItem}
            onClearOrder={onClearOrder}
            onDeleteOrder={onDeleteOrder}
            onIncrementOrderItem={onIncrementOrderItem}
            onDecrementOrderItem={onDecrementOrderItem}
            onPaymentMethodChange={onPaymentMethodChange}
            onCashReceivedChange={onCashReceivedChange}
            onCheckout={onCheckout}
            onCheckoutComplete={onCheckoutComplete}
            hideCheckoutButton
            hidePaymentSection
          />
        </div>
        <PaymentPanel
          active={active}
          order={currentOrder}
          onPaymentMethodChange={onPaymentMethodChange}
          onCashReceivedChange={onCashReceivedChange}
          onCheckout={onCheckout}
          onCheckoutComplete={onCheckoutComplete}
          onUndoLastOrder={onUndoLastOrder}
          undoInfo={undoInfo}
          stockIssueReason={orderStockIssue.message}
          sumupSettings={sumupSettings}
          compact
        />
      </div>

    </section>
  );
}

function getProductDisplayName(product: SoftServeProduct, productIndex?: number) {
  const trimmedName = product.name.trim();

  if (trimmedName) {
    return trimmedName;
  }

  if (product.slot === "MIX") {
    return "Mix";
  }

  if (product.slot === "A") {
    return "Vanille";
  }

  if (product.slot === "B") {
    return "Schokolade";
  }

  if (product.aroma.trim()) {
    return product.aroma.trim();
  }

  if (typeof productIndex === "number") {
    return `Sorte ${productIndex + 1}`;
  }

  return "";
}

type MachineStockStatusLine = {
  slotLabel: string;
  stockFlavorId: string;
  name: string;
  startLiters: number;
  refilledLiters: number;
  correctedLiters: number;
  totalStartedLiters: number;
  remainingLiters: number;
  refillLiters: number;
  estimatedRemainingPortions: number | null;
  status: MixInventoryStatus;
  isEmergencyMode: boolean;
};

function getMachineStockLines(
  products: SoftServeProduct[],
  mixLineLookup: Map<string, InventoryReport["mixLines"][number]>
): MachineStockStatusLine[] {
  const seen = new Set<string>();
  const sourceProducts = products.filter((product) => product.slot !== "MIX");

  return sourceProducts.flatMap((product, index) => {
    const link = product.stockLinks[0];

    if (!link?.stockFlavorId || seen.has(link.stockFlavorId)) {
      return [];
    }

    seen.add(link.stockFlavorId);
    const stockLine = mixLineLookup.get(link.stockFlavorId);
    const fallbackName = getProductDisplayName(product, index) || `Sorte ${index + 1}`;

    const sl = stockLine?.startLiters ?? 0;
    const rl = stockLine?.refilledLiters ?? 0;
    const cl = stockLine?.correctedLiters ?? 0;
    return [{
      slotLabel: getStockSlotLabel(product, seen.size),
      stockFlavorId: link.stockFlavorId,
      name: stockLine?.name ?? fallbackName,
      startLiters: sl,
      refilledLiters: rl,
      correctedLiters: cl,
      totalStartedLiters: sl + rl + cl,
      remainingLiters: stockLine?.remainingLiters ?? 0,
      refillLiters: stockLine?.recipe.mixLitersPerBatch ?? product.recipe.mixLitersPerBatch,
      estimatedRemainingPortions: stockLine?.estimatedRemainingPortions ?? null,
      status: stockLine?.status ?? "OK",
      isEmergencyMode: stockLine?.isEmergencyMode ?? false
    }];
  });
}

function getStockSlotLabel(product: SoftServeProduct, position: number) {
  if (product.slot === "A") {
    return "Sorte A";
  }

  if (product.slot === "B") {
    return "Sorte B";
  }

  return position === 1 ? "Sorte A" : position === 2 ? "Sorte B" : `Sorte ${position}`;
}

function MachineStockStatus({
  line,
}: {
  line: MachineStockStatusLine;
}) {
  const stockState = getStockState(line.status);

  return (
    <div className={`grid gap-1.5 rounded-lg border p-2 ${stockState.containerClass}`}>
      <div className="flex min-w-0 items-start justify-between gap-1">
        <p className="min-w-0 text-xs font-black leading-tight text-ink">
          {line.slotLabel}: {line.name}
        </p>
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-black leading-tight ${stockState.badgeClass}`}>
          {stockState.emoji} {stockState.label}
        </span>
      </div>
      <div className={`rounded-lg border px-2 py-1.5 ${stockState.restClass}`}>
        <p className="text-sm font-black">
          Rest {formatQuantityForSale(line.remainingLiters)}
          {line.estimatedRemainingPortions !== null ? (
            <span className="ml-1.5 text-[10px] font-semibold opacity-60">· ca. {line.estimatedRemainingPortions} Port.</span>
          ) : null}
        </p>
      </div>
      {line.status === "Leer" && line.startLiters === 0 && line.remainingLiters <= 0 && !line.isEmergencyMode ? (
        <p className="rounded border border-yellow-200 bg-yellow-50 px-2 py-1 text-[10px] font-bold text-yellow-800">
          Kein Startbestand
        </p>
      ) : null}
    </div>
  );
}

function getStockState(status: MixInventoryStatus) {
  if (status === "Notbetrieb") {
    return {
      emoji: "🔓",
      label: "Notbetrieb",
      containerClass: "border-orange-300 bg-orange-50",
      badgeClass: "bg-orange-100 text-orange-900",
      restClass: "animate-pulse border-orange-300 bg-orange-100 text-orange-900"
    };
  }

  if (status === "Leer" || status === "Nachfüllen") {
    return {
      emoji: "🔴",
      label: status === "Leer" ? "Leer" : "Nachfüllen",
      containerClass: "border-red-300 bg-red-50",
      badgeClass: "bg-red-100 text-red-800",
      restClass: "animate-pulse border-red-300 bg-red-50 text-red-800"
    };
  }

  if (status === "Bald leer") {
    return {
      emoji: "🟡",
      label: "Bald leer",
      containerClass: "border-yellow-300 bg-yellow-50",
      badgeClass: "bg-yellow-100 text-yellow-800",
      restClass: "animate-pulse border-yellow-300 bg-yellow-50 text-yellow-900"
    };
  }

  return {
    emoji: "🟢",
    label: "OK",
    containerClass: "border-green-200 bg-white",
    badgeClass: "bg-green-100 text-green-800",
    restClass: "border-green-200 bg-green-50 text-green-800"
  };
}

function formatQuantityForSale(value: number) {
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value)} L`;
}

function dedupeProductsById(products: SoftServeProduct[]) {
  const seenIds = new Set<string>();

  return products.filter((product) => {
    if (seenIds.has(product.id)) {
      return false;
    }

    seenIds.add(product.id);
    return true;
  });
}

function groupProductsByPackagingType(products: SoftServeProduct[]) {
  const groups = new Map<PackagingType, SoftServeProduct[]>();

  for (const product of products) {
    const packagingType = product.packagingType;
    groups.set(packagingType, [...(groups.get(packagingType) ?? []), product]);
  }

  return Array.from(groups.entries()).map(([packagingType, groupedProducts]) => ({
    packagingType,
    products: groupedProducts
  }));
}

function getProductStockIssue(
  product: SoftServeProduct,
  mixLineLookup: Map<string, InventoryReport["mixLines"][number]>,
  stockLinks = product.stockLinks
) {
  const missingNames = stockLinks
    .map((link) => {
      const stockLine = mixLineLookup.get(link.stockFlavorId);

      if (stockLine?.isEmergencyMode) {
        return null;
      }

      if (!stockLine || stockLine.remainingLiters <= 0) {
        return stockLine?.name ?? link.stockFlavorId;
      }

      return null;
    })
    .filter((name): name is string => Boolean(name));

  const uniqueMissingNames = [...new Set(missingNames)];

  if (!uniqueMissingNames.length) {
    return { blocked: false, message: "" };
  }

  const isMix = stockLinks.length > 1 || product.slot === "MIX";
  const missingLabel = formatNameList(uniqueMissingNames);

  return {
    blocked: true,
    message: isMix
      ? `Mix nicht möglich: ${missingLabel} ${uniqueMissingNames.length === 1 ? "ist" : "sind"} leer. Bitte nachfüllen oder Notbetrieb aktivieren.`
      : `${missingLabel} ist leer. Bitte nachfüllen oder Notbetrieb aktivieren.`
  };
}

function formatNameList(names: string[]) {
  if (names.length <= 1) {
    return names[0] ?? "";
  }

  if (names.length === 2) {
    return `${names[0]} und ${names[1]}`;
  }

  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

function getOrderStockIssue(
  order: CurrentOrder,
  productLookup: Map<string, SoftServeProduct>,
  siblingProductsLookup: Map<string, SoftServeProduct[]>,
  mixLineLookup: Map<string, InventoryReport["mixLines"][number]>
) {
  const requiredLitersByFlavor = new Map<string, number>();

  for (const item of order.items) {
    const product = productLookup.get(item.productId);

    if (!product) {
      continue;
    }

    const stockLinks = getEffectiveStockLinks(product, siblingProductsLookup.get(product.id) ?? [product]);

    if (!stockLinks.length) {
      continue;
    }

    const packagingType = item.portionType ?? item.packagingType ?? product.packagingType;
    const portionGrams = item.portionGrams && item.portionGrams > 0
      ? item.portionGrams
      : product.portionGrams && product.portionGrams > 0
        ? product.portionGrams
        : getFallbackPortionGrams(packagingType);

    for (const link of stockLinks) {
      const currentRequired = requiredLitersByFlavor.get(link.stockFlavorId) ?? 0;
      requiredLitersByFlavor.set(
        link.stockFlavorId,
        currentRequired + (item.quantity * portionGrams * link.ratio) / 1000
      );
    }
  }

  const missingNames = [...requiredLitersByFlavor.entries()]
    .map(([stockFlavorId, requiredLiters]) => {
      const stockLine = mixLineLookup.get(stockFlavorId);

      if (stockLine?.isEmergencyMode) {
        return null;
      }

      if (!stockLine || stockLine.remainingLiters < requiredLiters) {
        return stockLine?.name ?? stockFlavorId;
      }

      return null;
    })
    .filter((name): name is string => Boolean(name));

  const uniqueMissingNames = [...new Set(missingNames)];

  return {
    blocked: uniqueMissingNames.length > 0,
    message: uniqueMissingNames.length
      ? `Buchung nicht möglich: ${formatNameList(uniqueMissingNames)} ${uniqueMissingNames.length === 1 ? "ist" : "sind"} leer oder nicht ausreichend gefüllt. Bitte nachfüllen oder Notbetrieb aktivieren.`
      : ""
  };
}

function getFallbackPortionGrams(packagingType: PackagingType) {
  if (packagingType === "Waffelbecher") {
    return 170;
  }

  if (packagingType === "Becher") {
    return 140;
  }

  return 160;
}

function getEffectiveStockLinks(product: SoftServeProduct, siblingProducts: SoftServeProduct[]) {
  if (product.slot !== "MIX") {
    return product.stockLinks;
  }

  const fallbackLinks = getMixSourceProducts(siblingProducts)
    .map((item) => item.stockLinks[0])
    .filter((link): link is SoftServeProduct["stockLinks"][number] => Boolean(link?.stockFlavorId))
    .map((link) => ({ stockFlavorId: link.stockFlavorId, ratio: 0.5 }));

  return fallbackLinks.length >= 2 ? fallbackLinks : [];
}

function getMixSourceProducts(products: SoftServeProduct[]) {
  const slotProducts = [products.find((item) => item.slot === "A"), products.find((item) => item.slot === "B")]
    .filter(Boolean) as SoftServeProduct[];

  if (slotProducts.length >= 2) {
    return slotProducts.slice(0, 2);
  }

  return products
    .filter((item) => item.slot !== "MIX")
    .filter((item, index, all) => all.findIndex((candidate) => candidate.stockLinks[0]?.stockFlavorId === item.stockLinks[0]?.stockFlavorId) === index)
    .slice(0, 2);
}

function SaleProductButton({
  machineId,
  machineNumber,
  product,
  siblingProducts,
  productIndex,
  mixLineLookup,
  onAddOrderItem,
  isFavorite = false,
  onToggleFavorite,
  compact = false,
}: {
  machineId: string;
  machineNumber: string;
  product: SoftServeProduct;
  siblingProducts: SoftServeProduct[];
  productIndex: number;
  mixLineLookup: Map<string, InventoryReport["mixLines"][number]>;
  onAddOrderItem: (item: Omit<CurrentOrderItem, "quantity" | "lineTotalGrossCents">) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (productId: string) => void;
  compact?: boolean;
}) {
  const displayName = getProductDisplayName(product, productIndex) || `Sorte ${productIndex + 1}`;
  const packagingType = product.packagingType;
  const orderItemId = `${getMachineScopedItemKey(machineId, product.id)}_${packagingType}`;
  const tone = getSaleButtonTone(product, displayName, siblingProducts);
  const stockIssue = getProductStockIssue(product, mixLineLookup, getEffectiveStockLinks(product, siblingProducts));
  const isStockBlocked = stockIssue.blocked;

  const sizeClass = compact
    ? "h-[90px] max-h-[100px] min-h-[90px] w-[90px] min-w-[90px] max-w-[100px]"
    : "h-[140px] min-h-[140px] w-[140px] min-w-[140px]";

  return (
    <div className="relative">
      <button
        type="button"
        data-testid={`sale-add-${orderItemId}`}
        onClick={() => {
          if (isStockBlocked) {
            window.alert(stockIssue.message);
            return;
          }
          onAddOrderItem({
            id: orderItemId,
            productId: product.id,
            machineId,
            machineNumber,
            name: displayName,
            packagingType,
            packagingSize: product.packagingSize,
            unitPriceGrossCents: product.priceCents,
            vatRate: product.vatRate
          });
        }}
        title={isStockBlocked ? stockIssue.message : `${displayName} · ${packagingType} · ${formatCurrency(product.priceCents)}`}
        className={`pointer-events-auto flex aspect-square ${sizeClass} flex-col items-start justify-between overflow-hidden rounded-xl border p-3 text-left shadow-md transition active:scale-[0.97] ${isStockBlocked ? "ring-2 ring-red-400 ring-offset-1" : ""}`}
        style={{
          background: isStockBlocked ? "#fee2e2" : tone.background,
          borderColor: isStockBlocked ? "#fca5a5" : tone.borderColor,
          color: isStockBlocked ? "#991b1b" : tone.textColor,
          textShadow: isStockBlocked ? undefined : tone.textShadow,
          opacity: isStockBlocked ? 0.85 : undefined
        }}
      >
        <span className="line-clamp-3 w-full min-w-0 text-base font-black leading-tight [overflow-wrap:anywhere]">
          {isStockBlocked ? "🔴 " : ""}{displayName}
        </span>
        <span className="grid w-full min-w-0 gap-1 text-sm font-bold leading-tight">
          <span className="truncate text-sm">{isStockBlocked ? "Sorte leer" : packagingType}</span>
          <span className="truncate text-xl tabular-nums">{formatCurrency(product.priceCents)}</span>
        </span>
      </button>

      {/* ⭐ Favoriten-Toggle */}
      {onToggleFavorite ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(product.id); }}
          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/20 text-[10px] leading-none backdrop-blur-sm transition hover:bg-black/35"
          title={isFavorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
        >
          {isFavorite ? "⭐" : "☆"}
        </button>
      ) : null}
    </div>
  );
}

function ToppingButton({
  machineId,
  machineNumber,
  product,
  siblingProducts,
  productIndex,
  onAddOrderItem
}: {
  machineId: string;
  machineNumber: string;
  product: SoftServeProduct;
  siblingProducts: SoftServeProduct[];
  productIndex: number;
  onAddOrderItem: (item: Omit<CurrentOrderItem, "quantity" | "lineTotalGrossCents">) => void;
}) {
  const displayName = getProductDisplayName(product, productIndex) || `Sorte ${productIndex + 1}`;
  const tone = getSaleButtonTone(product, displayName, siblingProducts);
  const toppingOptionId = `${getMachineScopedItemKey(machineId, product.id)}_topping`;

  return (
    <button
      type="button"
      data-testid={`sale-add-${toppingOptionId}`}
      onClick={() =>
        onAddOrderItem({
          id: toppingOptionId,
          productId: "topping",
          machineId,
          machineNumber,
          parentProductId: product.id,
          toppingName: `Topping ${displayName}`,
          name: `Topping ${displayName}`,
          packagingType: product.packagingType,
          packagingSize: product.packagingSize,
          unitPriceGrossCents: product.toppingPriceCents,
          vatRate: product.toppingVatRate
        })
      }
      title={`Topping ${displayName} · ${formatCurrency(product.toppingPriceCents)}`}
      className="pointer-events-auto flex aspect-square h-[140px] min-h-[140px] w-[140px] min-w-[140px] flex-col items-start justify-between overflow-hidden rounded-xl border p-3 text-left shadow-md transition active:scale-[0.97]"
      style={{
        background: tone.background,
        borderColor: tone.borderColor,
        color: tone.textColor,
        textShadow: tone.textShadow
      }}
    >
      <span className="w-full min-w-0 truncate text-base font-black leading-tight">Topping</span>
      <span className="grid w-full min-w-0 gap-1 text-sm font-bold leading-tight">
        <span className="line-clamp-2 text-sm [overflow-wrap:anywhere]">{displayName}</span>
        <span className="truncate text-xl tabular-nums">{formatCurrency(product.toppingPriceCents)}</span>
      </span>
    </button>
  );
}

function getMachineScopedItemKey(machineId: string, itemId: string) {
  return itemId.startsWith(`${machineId}_`) ? itemId : `${machineId}_${itemId}`;
}

function formatPackagingDetail(packagingType: PackagingType, packagingSize: string) {
  const trimmedSize = packagingSize.trim();

  return trimmedSize ? `${packagingType} ${trimmedSize}` : packagingType;
}

function getSaleButtonTone(product: SoftServeProduct, displayName: string, siblingProducts: SoftServeProduct[] = []) {
  const mixColors = getMixComponentColors(product, displayName, siblingProducts);

  if (mixColors.length >= 2) {
    const [leftColor, rightColor] = mixColors;

    return {
      background: `linear-gradient(135deg, ${leftColor} 0%, ${leftColor} 50%, ${rightColor} 50%, ${rightColor} 100%)`,
      borderColor: shadeHexColor(leftColor, -18),
      textColor: getReadableTextColorForMixedColors(leftColor, rightColor),
      textShadow: "0 1px 2px rgba(0,0,0,0.35)"
    };
  }

  if (mixColors.length === 1) {
    const [mixColor] = mixColors;

    return {
      background: mixColor,
      borderColor: shadeHexColor(mixColor, -18),
      textColor: getReadableTextColor(mixColor),
      textShadow: undefined
    };
  }

  const color = product.colorHex && isValidHexColor(product.colorHex) ? product.colorHex : getDefaultProductColor(displayName);
  const lighter = shadeHexColor(color, 22);

  return {
    background: `linear-gradient(145deg, ${lighter} 0%, ${color} 100%)`,
    borderColor: shadeHexColor(color, -18),
    textColor: getReadableTextColor(color),
    textShadow: "0 1px 2px rgba(0,0,0,0.18)"
  };
}

function getMixComponentColors(product: SoftServeProduct, displayName: string, siblingProducts: SoftServeProduct[]) {
  if (product.slot !== "MIX") {
    return [];
  }

  const samePackagingProducts = siblingProducts.filter((item) => item.packagingType === product.packagingType);
  const sourceProducts = getMixSourceProducts(samePackagingProducts).length >= 2
    ? getMixSourceProducts(samePackagingProducts)
    : getMixSourceProducts(siblingProducts);

  return sourceProducts
    .map((item, index) => {
      const name = getProductDisplayName(item, index);
      return item.colorHex && isValidHexColor(item.colorHex) ? item.colorHex : getDefaultProductColor(name);
    })
    .slice(0, 2);
}

function getDefaultProductColor(displayName: string) {
  const n = displayName.trim().toLowerCase();

  if (n.includes("vanille") || n.includes("vanilla")) return "#f5d76e";
  if (n.includes("schoko") || n.includes("choco")) return "#7b3e21";
  if (n.includes("erdbeer") || n.includes("straw")) return "#e84c6b";
  if (n.includes("himbeere") || n.includes("raspberry")) return "#d63060";
  if (n.includes("cheesecake") || n.includes("käse")) return "#f5c98a";
  if (n.includes("karamel") || n.includes("caramel")) return "#c97b2a";
  if (n.includes("pistazie") || n.includes("pistaz")) return "#6aab72";
  if (n.includes("mango")) return "#f5a623";
  if (n.includes("minze") || n.includes("mint")) return "#4cb97f";
  if (n.includes("blau") || n.includes("blue") || n.includes("sky")) return "#5b9fd4";
  if (n.includes("mix")) return "#b8a880";

  return "#e8c84a";
}

function isValidHexColor(value: string | undefined) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function getReadableTextColor(hexColor: string) {
  const { r, g, b } = hexToRgb(hexColor);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  return luminance > 0.58 ? "#1f1a12" : "#ffffff";
}

function getReadableTextColorForMixedColors(leftColor: string, rightColor: string) {
  const left = hexToRgb(leftColor);
  const right = hexToRgb(rightColor);
  const luminance = (
    0.2126 * ((left.r + right.r) / 2) +
    0.7152 * ((left.g + right.g) / 2) +
    0.0722 * ((left.b + right.b) / 2)
  ) / 255;

  return luminance > 0.52 ? "#1f1a12" : "#ffffff";
}

function shadeHexColor(hexColor: string, percent: number) {
  const { r, g, b } = hexToRgb(hexColor);
  const shift = (value: number) => Math.max(0, Math.min(255, Math.round(value + (percent / 100) * 255)));

  return rgbToHex(shift(r), shift(g), shift(b));
}

function hexToRgb(hexColor: string) {
  const value = hexColor.replace("#", "");

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function PaymentPanel({
  active,
  order,
  onPaymentMethodChange,
  onCashReceivedChange,
  onCheckout,
  onCheckoutComplete,
  onUndoLastOrder,
  undoInfo,
  stockIssueReason,
  sumupSettings,
  compact = false
}: {
  active: boolean;
  order: CurrentOrder;
  onPaymentMethodChange: (paymentMethod: OrderPaymentMethod) => void;
  onCashReceivedChange: (cashReceivedCents: number) => void;
  onCheckout: () => void;
  onCheckoutComplete?: () => void;
  onUndoLastOrder?: () => void;
  undoInfo?: UndoInfo;
  stockIssueReason?: string;
  sumupSettings?: SumupSettings;
  compact?: boolean;
}) {
  const [undoDialog, setUndoDialog] = useState<"idle" | "confirm" | "finalized">("idle");
  const differenceCents = order.cashReceivedCents - order.totalGrossCents;
  const checkoutState = getCheckoutState(active, order, stockIssueReason);
  const canBook = checkoutState.canBook;

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    console.log("checkoutState", checkoutState);
  }, [checkoutState]);

  if (compact) {
    return (
      <section data-testid="payment-panel" className="shrink-0 rounded-lg border border-black/10 bg-white p-3 shadow-sm">
        {/* Zahlungsart */}
        <div className="mb-2 grid gap-1.5 rounded-lg border border-blue-100 bg-blue-50 p-2">
          <p className="text-[10px] font-black uppercase tracking-wide text-blue-700">Zahlungsart</p>
          <div className={`grid gap-1.5 ${sumupSettings?.enabled ? "grid-cols-3" : "grid-cols-2"}`}>
            <button type="button" data-testid="payment-cash-button" onClick={() => onPaymentMethodChange("cash")}
              className={`min-h-10 rounded-lg border px-2 text-sm font-bold ${order.paymentMethod === "cash" ? "border-primaq-500 bg-primaq-50 text-primaq-700" : "border-black/10 bg-white text-black/65"}`}>
              💶 Bar
            </button>
            <button type="button" data-testid="payment-card-button" onClick={() => onPaymentMethodChange("card")}
              className={`min-h-10 rounded-lg border px-2 text-sm font-bold ${order.paymentMethod === "card" ? "border-primaq-500 bg-primaq-50 text-primaq-700" : "border-black/10 bg-white text-black/65"}`}>
              💳 Karte
            </button>
            {sumupSettings?.enabled ? (
              <button type="button" data-testid="payment-qr-button" onClick={() => onPaymentMethodChange("qr")}
                className={`min-h-10 rounded-lg border px-2 text-sm font-bold ${order.paymentMethod === "qr" ? "border-primaq-500 bg-primaq-50 text-primaq-700" : "border-black/10 bg-white text-black/65"}`}>
                📱 QR
              </button>
            ) : null}
          </div>
        </div>

        {/* Gegeben / QR */}
        {order.paymentMethod === "qr" && sumupSettings?.enabled ? (
          <div className="mb-2">
            <QrPaymentPanel
              totalGrossCents={order.totalGrossCents}
              paymentLink={sumupSettings.paymentLink}
              hintText={sumupSettings.hintText}
              onConfirm={() => { onCheckout(); onCheckoutComplete?.(); }}
              onCancel={() => onPaymentMethodChange("cash")}
              canConfirm={canBook}
              compact
            />
          </div>
        ) : order.paymentMethod === "cash" ? (
          <div className="mb-2 grid gap-1.5 rounded-lg border border-yellow-100 bg-yellow-50 p-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-yellow-800">Gegeben</p>
            <div className="flex min-h-11 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
              <input
                inputMode="decimal"
                data-testid="cash-received-input"
                value={order.cashReceivedCents ? (order.cashReceivedCents / 100).toString().replace(".", ",") : ""}
                onChange={(event) => onCashReceivedChange(toCents(event.target.value))}
                className="min-h-11 min-w-0 flex-1 rounded-lg bg-transparent px-3 text-lg font-bold outline-none"
              />
              <button type="button" data-testid="cash-received-reset-button" onClick={() => onCashReceivedChange(0)}
                className="mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-yellow-100 text-sm font-black text-yellow-900 ring-1 ring-yellow-200"
                aria-label="Gegeben leeren">
                ×
              </button>
            </div>
            <div className="grid grid-cols-5 gap-1">
              {quickAmounts.map((amount) => (
                <button key={amount} type="button" data-testid={`cash-quick-add-${amount}`}
                  onClick={() => onCashReceivedChange(order.cashReceivedCents + amount)}
                  className="min-h-8 rounded-lg bg-white text-xs font-bold text-ink ring-1 ring-yellow-200">
                  {amount / 100} €
                </button>
              ))}
            </div>
            <div className={`rounded-lg px-2 py-1.5 ${differenceCents < 0 ? "bg-orange-100 text-orange-900" : "bg-green-50 text-green-900"}`}>
              <span className="block text-[10px] font-semibold uppercase tracking-wide">
                {differenceCents < 0 ? "Noch offen" : differenceCents === 0 ? "Passt genau" : "Rückgeld"}
              </span>
              <span className="text-base font-black">
                {differenceCents === 0 ? "Passt genau" : differenceCents > 0 ? formatCurrency(differenceCents) : formatCurrency(Math.abs(differenceCents))}
              </span>
            </div>
          </div>
        ) : (
          <div className="mb-2 grid gap-1.5 rounded-lg border border-blue-100 bg-blue-50 p-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-blue-700">Gegeben</p>
            <div className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2">
              <span className="text-xs font-bold text-blue-700">Zu zahlen</span>
              <span className="text-lg font-black text-blue-950">{formatCurrency(order.totalGrossCents)}</span>
            </div>
          </div>
        )}

        {/* Warnungen */}
        {!active ? (
          <p data-testid="checkout-shift-warning" className="mb-2 rounded-lg border border-orange-200 bg-orange-50 p-2 text-xs font-bold text-orange-900">
            Kein aktiver Einsatz.
          </p>
        ) : null}
        {stockIssueReason ? (
          <p className="mb-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs font-bold text-red-800">
            {stockIssueReason}
          </p>
        ) : null}

        {/* Bestellung buchen */}
        {order.paymentMethod === "qr" && sumupSettings?.enabled ? null : (
          <button
            type="button"
            data-testid="checkout-button"
            disabled={!canBook}
            onClick={() => { if (!canBook) return; onCheckout(); onCheckoutComplete?.(); }}
            className={`mb-1.5 min-h-16 w-full rounded-xl px-4 text-xl font-black text-white transition ${canBook ? "bg-green-600 shadow-md active:scale-[0.99]" : "cursor-not-allowed bg-black/25"}`}
          >
            Bestellung buchen
          </button>
        )}

        {/* Letzte Buchung zurückholen */}
        {undoInfo ? (
          <button type="button"
            onClick={() => setUndoDialog(undoInfo.canUndo ? "confirm" : "finalized")}
            className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-bold text-orange-800 transition active:scale-[0.99]">
            <RotateCcw className="h-3.5 w-3.5" />
            Letzte Buchung zurückholen
          </button>
        ) : null}

        {undoDialog === "confirm" && undoInfo ? (
          <div className="mt-2 grid gap-2 rounded-lg border border-orange-200 bg-orange-50 p-2">
            <p className="text-xs font-bold text-orange-900">
              Letzte Buchung wirklich zurückholen? (#{undoInfo.order.orderNumber} · {formatCurrency(undoInfo.order.totalGrossCents)})
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={() => setUndoDialog("idle")}
                className="min-h-8 rounded-lg border border-black/15 bg-white text-xs font-bold text-black/70">
                Abbrechen
              </button>
              <button type="button" onClick={() => { onUndoLastOrder?.(); setUndoDialog("idle"); }}
                className="min-h-8 rounded-lg bg-orange-600 text-xs font-bold text-white active:scale-[0.99]">
                Zurückholen
              </button>
            </div>
          </div>
        ) : null}

        {undoDialog === "finalized" ? (
          <div className="mt-2 grid gap-2 rounded-lg border border-red-200 bg-red-50 p-2">
            <p className="text-xs font-bold text-red-900">Tag bereits abgeschlossen – kann nicht zurückgeholt werden.</p>
            <button type="button" onClick={() => setUndoDialog("idle")}
              className="min-h-8 rounded-lg border border-black/15 bg-white text-xs font-bold text-black/70">
              Schließen
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section data-testid="payment-panel" className="rounded-lg border border-black/10 bg-white p-3 shadow-sm">
      <div className="grid gap-3 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(320px,420px)]">
        {/* ── Zahlungsart ───────────────────────────────────────── */}
        <div className="grid content-start gap-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
          <p className="text-xs font-black uppercase tracking-wide text-blue-700">Zahlungsart</p>
          <div className={`grid gap-2 ${sumupSettings?.enabled ? "grid-cols-3" : "grid-cols-2"}`}>
            <button
              type="button"
              data-testid="payment-cash-button"
              onClick={() => onPaymentMethodChange("cash")}
              className={`min-h-16 rounded-lg border px-3 text-base font-bold ${
                order.paymentMethod === "cash"
                  ? "border-primaq-500 bg-primaq-50 text-primaq-700"
                  : "border-black/10 bg-white text-black/65"
              }`}
            >
              💶 Bar
            </button>
            <button
              type="button"
              data-testid="payment-card-button"
              onClick={() => onPaymentMethodChange("card")}
              className={`min-h-16 rounded-lg border px-3 text-base font-bold ${
                order.paymentMethod === "card"
                  ? "border-primaq-500 bg-primaq-50 text-primaq-700"
                  : "border-black/10 bg-white text-black/65"
              }`}
            >
              💳 Karte
            </button>
            {sumupSettings?.enabled ? (
              <button
                type="button"
                data-testid="payment-qr-button"
                onClick={() => onPaymentMethodChange("qr")}
                className={`min-h-16 rounded-lg border px-3 text-base font-bold ${
                  order.paymentMethod === "qr"
                    ? "border-primaq-500 bg-primaq-50 text-primaq-700"
                    : "border-black/10 bg-white text-black/65"
                }`}
              >
                📱 QR
              </button>
            ) : null}
          </div>
        </div>

        {/* ── Gegeben / QR-Panel ───────────────────────────────────── */}
        {order.paymentMethod === "qr" && sumupSettings?.enabled ? (
          <QrPaymentPanel
            totalGrossCents={order.totalGrossCents}
            paymentLink={sumupSettings.paymentLink}
            hintText={sumupSettings.hintText}
            onConfirm={() => { onCheckout(); onCheckoutComplete?.(); }}
            onCancel={() => onPaymentMethodChange("cash")}
            canConfirm={canBook}
          />
        ) : (
          <div className={`grid content-start gap-2 rounded-lg border p-3 ${
            order.paymentMethod === "cash" ? "border-yellow-100 bg-yellow-50" : "border-blue-100 bg-blue-50 text-blue-900"
          }`}>
            <p className={`text-xs font-black uppercase tracking-wide ${order.paymentMethod === "cash" ? "text-yellow-800" : "text-blue-700"}`}>
              Gegeben
            </p>
            {order.paymentMethod === "cash" ? (
              <>
                <div className="flex min-h-16 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
                  <input
                    inputMode="decimal"
                    data-testid="cash-received-input"
                    value={order.cashReceivedCents ? (order.cashReceivedCents / 100).toString().replace(".", ",") : ""}
                    onChange={(event) => onCashReceivedChange(toCents(event.target.value))}
                    className="min-h-16 min-w-0 flex-1 rounded-lg bg-transparent px-3 text-xl font-bold outline-none"
                  />
                  <button
                    type="button"
                    data-testid="cash-received-reset-button"
                    onClick={() => onCashReceivedChange(0)}
                    className="mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-yellow-100 text-lg font-black text-yellow-900 ring-1 ring-yellow-200"
                    aria-label="Gegeben leeren"
                    title="Gegeben leeren"
                  >
                    ×
                  </button>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {quickAmounts.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      data-testid={`cash-quick-add-${amount}`}
                      onClick={() => onCashReceivedChange(order.cashReceivedCents + amount)}
                      className="min-h-16 rounded-lg bg-white text-sm font-bold text-ink ring-1 ring-yellow-200"
                    >
                      {amount / 100} €
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="grid gap-2 rounded-lg bg-white/70 p-3">
                <p className="text-sm font-black text-blue-900">Kartenzahlung gewählt</p>
                <div className="flex items-end justify-between gap-3">
                  <span className="text-sm font-bold text-blue-700">Zu zahlen</span>
                  <span className="text-xl font-black text-blue-950">{formatCurrency(order.totalGrossCents)}</span>
                </div>
                <p className="text-xs font-bold uppercase tracking-wide text-blue-600">Keine Bargeldeingabe erforderlich</p>
              </div>
            )}
          </div>
        )}

        <div className="grid content-start gap-2 rounded-lg border border-black/10 bg-slate-50 p-3 text-sm">
          <p className="text-xs font-black uppercase tracking-wide text-slate-600">Zusammenfassung</p>
          <div className="flex justify-between gap-3">
            <span className="font-semibold text-black/60">Artikel gesamt</span>
            <span className="font-bold text-ink">{order.items.reduce((sum, item) => sum + item.quantity, 0)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="font-semibold text-black/60">Summe</span>
            <span className="text-lg font-bold text-ink">{formatCurrency(order.totalGrossCents)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="font-semibold text-black/60">MwSt-Summe</span>
            <span className="font-bold text-ink">{formatCurrency(order.vatCents)}</span>
          </div>
        </div>

        <div className={`grid content-start gap-2 rounded-lg border p-3 ${
          order.paymentMethod !== "cash"
            ? "border-black/10 bg-slate-50 text-black/55"
            : differenceCents < 0
              ? "border-orange-200 bg-orange-50 text-orange-900"
              : "border-green-200 bg-green-50 text-green-900"
        }`}>
          <p className="text-xs font-black uppercase tracking-wide">{order.paymentMethod === "cash" ? "Rückgeld" : "Kartenzahlung"}</p>
          {order.paymentMethod === "cash" ? (
            <p className="text-2xl font-black">
              {differenceCents === 0
                ? "Passt genau"
                : differenceCents > 0
                  ? formatCurrency(differenceCents)
                  : `Noch offen: ${formatCurrency(Math.abs(differenceCents))}`}
            </p>
          ) : (
            <p className="text-2xl font-black">Kein Rückgeld</p>
          )}
          <p className="text-xs font-bold uppercase opacity-70">
            {order.paymentMethod === "cash"
              ? differenceCents < 0 ? "Noch offen" : differenceCents === 0 ? "Passt genau" : "Rückgeld"
              : "Karte"}
          </p>
        </div>

        <div className="grid content-start gap-4 rounded-lg border-2 border-green-400 bg-green-50 p-4 min-[1100px]:col-start-3 min-[1100px]:row-start-1 min-[1100px]:row-span-2">
          <p className="text-sm font-black uppercase tracking-wide text-green-800">Bestellung</p>
          {!active ? (
            <p data-testid="checkout-shift-warning" className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-900">
              Kein aktiver Einsatz. Bitte unter Einsätze einen Einsatz starten.
            </p>
          ) : null}
          {stockIssueReason ? (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
              {stockIssueReason}
            </p>
          ) : null}
          {order.paymentMethod === "qr" && sumupSettings?.enabled ? null : (
            <button
              type="button"
              data-testid="checkout-button"
              disabled={!canBook}
              title={canBook ? "Bestellung buchen" : checkoutState.reason}
              onClick={() => {
                if (!canBook) return;
                onCheckout();
                onCheckoutComplete?.();
              }}
              className={`min-h-20 w-full rounded-xl px-4 text-2xl font-black text-white transition ${
                canBook
                  ? "bg-green-600 shadow-md active:scale-[0.99]"
                  : "cursor-not-allowed bg-black/25"
              }`}
            >
              Bestellung buchen
            </button>
          )}

          {undoInfo ? (
            <button
              type="button"
              onClick={() => setUndoDialog(undoInfo.canUndo ? "confirm" : "finalized")}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 text-sm font-bold text-orange-800 transition active:scale-[0.99]"
            >
              <RotateCcw className="h-4 w-4" />
              Letzte Buchung zurückholen
            </button>
          ) : null}

          {undoDialog === "confirm" && undoInfo ? (
            <div className="grid gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
              <p className="text-sm font-bold text-orange-900">Letzte Buchung wirklich zurückholen?</p>
              <p className="text-xs text-orange-700">
                Bestellung #{undoInfo.order.orderNumber} · {formatCurrency(undoInfo.order.totalGrossCents)}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setUndoDialog("idle")}
                  className="min-h-10 rounded-lg border border-black/15 bg-white text-sm font-bold text-black/70"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUndoLastOrder?.();
                    setUndoDialog("idle");
                  }}
                  className="min-h-10 rounded-lg bg-orange-600 text-sm font-bold text-white active:scale-[0.99]"
                >
                  Zurückholen
                </button>
              </div>
            </div>
          ) : null}

          {undoDialog === "finalized" ? (
            <div className="grid gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-bold text-red-900">Tag bereits abgeschlossen</p>
              <p className="text-xs text-red-700">
                Diese Buchung liegt in einem bereits abgeschlossenen Tag und kann nicht zurückgeholt werden.
              </p>
              <button
                type="button"
                onClick={() => setUndoDialog("idle")}
                className="min-h-10 rounded-lg border border-black/15 bg-white text-sm font-bold text-black/70"
              >
                Schließen
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function getCheckoutState(activeShift: boolean, activeOrder: CurrentOrder, stockIssueReason = "") {
  const paymentMethod = activeOrder.paymentMethod;
  const totalGrossCents = Number(activeOrder.totalGrossCents) || 0;
  const givenAmountCents = Number(activeOrder.cashReceivedCents) || 0;
  const hasItems = activeOrder.items.length > 0;
  const hasShift = Boolean(activeShift);
  const hasPayment = paymentMethod === "cash" || paymentMethod === "card" || paymentMethod === "qr";
  const cashOk = paymentMethod !== "cash" || givenAmountCents >= totalGrossCents;
  const stockOk = !stockIssueReason;
  const canBook = hasShift && hasItems && totalGrossCents > 0 && hasPayment && cashOk && stockOk;
  const reason = !hasShift
    ? "Kein Einsatz"
    : !hasItems
      ? "Keine Artikel"
      : totalGrossCents <= 0
        ? "Keine Summe"
        : !hasPayment
          ? "Keine Zahlungsart"
          : !cashOk
            ? "Zu wenig gegeben"
            : !stockOk
              ? stockIssueReason
              : "";

  return {
    activeShift: hasShift,
    activeOrder: activeOrder.id ?? "order",
    activeOrderItemsLength: activeOrder.items.length,
    totalGrossCents,
    paymentMethod,
    givenAmountCents,
    hasItems,
    hasPayment,
    cashOk,
    stockOk,
    canBook,
    reason
  };
}

function OrderItemRow({
  item,
  onDecrement,
  onIncrement,
  onRemove,
}: {
  item: CurrentOrderItem;
  onDecrement: () => void;
  onIncrement: () => void;
  onRemove: () => void;
}) {
  const [removeArmed, setRemoveArmed] = useState(false);
  const removeTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(removeTimerRef.current), []);

  function handleRemoveClick() {
    if (removeArmed) {
      clearTimeout(removeTimerRef.current);
      setRemoveArmed(false);
      onRemove();
    } else {
      setRemoveArmed(true);
      removeTimerRef.current = setTimeout(() => setRemoveArmed(false), 3000);
    }
  }

  // 60 px base → 72 px on md (tablet/iPad breakpoint)
  const btnBase =
    "flex shrink-0 items-center justify-center rounded-xl font-black transition-all active:scale-[0.94] h-[60px] w-[60px] md:h-[72px] md:w-[72px]";

  return (
    <li
      data-testid={`order-item-${item.id}`}
      className="border-b border-black/6 px-3 py-2.5 last:border-b-0"
    >
      {/* top: name + packaging detail + line total — all in one row */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-bold leading-snug text-ink">
            {withoutMachinePrefix(item.name)}
          </span>
          <span className="ml-1.5 text-[11px] text-black/40">
            {formatPackagingDetail(item.packagingType ?? "Waffel", item.packagingSize ?? "")}
            {" · "}{formatCurrency(item.unitPriceGrossCents)}/Stk
          </span>
        </div>
        <span className="shrink-0 text-sm font-black tabular-nums text-ink">
          {formatCurrency(item.lineTotalGrossCents)}
        </span>
      </div>
      {/* touch controls */}
      <div className="mt-2 flex items-center gap-2">
        {/* decrement */}
        <button
          type="button"
          onClick={onDecrement}
          aria-label="Weniger"
          className={`${btnBase} border border-black/10 bg-[#f0f0ea] text-2xl text-black/60 active:bg-black/15`}
        >
          −
        </button>
        {/* qty display */}
        <div className="flex w-10 shrink-0 flex-col items-center leading-none md:w-12">
          <span className="text-2xl font-black tabular-nums text-ink">{item.quantity}</span>
          <span className="text-[10px] font-semibold text-black/35">Stück</span>
        </div>
        {/* increment */}
        <button
          type="button"
          onClick={onIncrement}
          aria-label="Mehr"
          className={`${btnBase} border border-primaq-200 bg-primaq-50 text-2xl text-primaq-700 active:bg-primaq-100`}
        >
          +
        </button>
        {/* spacer pushes delete to the right */}
        <div className="flex-1" />
        {/* delete with 2-click safety */}
        <button
          type="button"
          onClick={handleRemoveClick}
          aria-label={removeArmed ? "Löschen bestätigen" : "Artikel entfernen"}
          className={`flex h-[60px] shrink-0 items-center justify-center rounded-xl font-black transition-all active:scale-[0.94] md:h-[72px] ${
            removeArmed
              ? "min-w-[60px] bg-red-500 px-3 text-xs text-white md:min-w-[72px]"
              : "w-[60px] bg-[#f0f0ea] text-black/40 active:bg-red-50 active:text-red-600 md:w-[72px]"
          }`}
        >
          {removeArmed ? "Entfernen?" : <Trash2 className="h-5 w-5" />}
        </button>
      </div>
    </li>
  );
}

// Two-click safety hook: first click arms, second click within 3 s confirms.
function useTwoClickAction(onConfirm: () => void, timeoutMs = 3000) {
  const [armed, setArmed] = useState(false);
  const timerRef = { current: undefined as ReturnType<typeof setTimeout> | undefined };

  function handleClick() {
    if (armed) {
      clearTimeout(timerRef.current);
      setArmed(false);
      onConfirm();
    } else {
      setArmed(true);
      timerRef.current = setTimeout(() => setArmed(false), timeoutMs);
    }
  }

  // Expose a cancel helper so parent can reset on unmount / route change.
  function cancel() { clearTimeout(timerRef.current); setArmed(false); }

  return { armed, handleClick, cancel };
}

export function OrderPanel({
  active,
  order,
  orders,
  activeOrderId,
  onAddOrder,
  onSelectOrder,
  onRemoveOrderItem,
  onClearOrder,
  onDeleteOrder,
  onIncrementOrderItem,
  onDecrementOrderItem,
  onPaymentMethodChange,
  onCashReceivedChange,
  onCheckout,
  onCheckoutComplete,
  hideCheckoutButton = false,
  hidePaymentSection = false
}: {
  active: boolean;
  order: CurrentOrder;
  orders: CurrentOrder[];
  activeOrderId: string;
  onAddOrder: () => void;
  onSelectOrder: (orderId: string) => void;
  onRemoveOrderItem: (itemId: string) => void;
  onClearOrder: () => void;
  onDeleteOrder: () => void;
  onIncrementOrderItem: (itemId: string) => void;
  onDecrementOrderItem: (itemId: string) => void;
  onPaymentMethodChange: (paymentMethod: OrderPaymentMethod) => void;
  onCashReceivedChange: (cashReceivedCents: number) => void;
  onCheckout: () => void;
  onCheckoutComplete?: () => void;
  hideCheckoutButton?: boolean;
  hidePaymentSection?: boolean;
}) {
  const differenceCents = order.cashReceivedCents - order.totalGrossCents;
  const canCheckout = getCheckoutState(active, order).canBook;
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
  const hasItems = order.items.length > 0;
  const canDelete = orders.length > 1;

  const clearAction = useTwoClickAction(onClearOrder);
  const deleteAction = useTwoClickAction(onDeleteOrder);

  return (
    <aside data-testid="order-panel" className="flex min-h-0 h-full flex-col overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 border-b border-black/8 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-black text-ink">Kalkulator</h2>
          <p className="text-xs text-black/50">
            {hasItems ? `${totalQty} Artikel · ${formatCurrency(order.totalGrossCents)}` : "Noch keine Artikel gewählt."}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            disabled={!hasItems}
            onClick={clearAction.handleClick}
            className={`min-h-8 rounded-lg border px-2.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              clearAction.armed
                ? "border-orange-400 bg-orange-500 text-white"
                : "border-black/12 bg-white text-black/60"
            }`}
          >
            {clearAction.armed ? "Nochmal drücken" : "Leeren"}
          </button>
          <button
            type="button"
            disabled={!canDelete}
            onClick={deleteAction.handleClick}
            className={`min-h-8 rounded-lg border px-2.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              deleteAction.armed
                ? "border-red-500 bg-red-600 text-white"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {deleteAction.armed ? "Nochmal drücken" : "Löschen"}
          </button>
        </div>
      </div>

      {/* ── Order tabs ──────────────────────────────────────────────── */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-black/8 px-3 py-2 [scrollbar-width:none]">
        {orders.map((item, index) => {
          const isActive = item.id === activeOrderId;
          const label = item.title?.trim() || `Bestellung ${index + 1}`;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectOrder(item.id!)}
              className={`min-h-7 shrink-0 rounded-md border px-2.5 text-xs font-bold transition-colors ${
                isActive
                  ? "border-primaq-400 bg-primaq-500 text-white"
                  : "border-black/10 bg-[#f5f5f0] text-black/65"
              }`}
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onAddOrder}
          className="min-h-7 shrink-0 rounded-md border border-dashed border-primaq-400/40 px-2.5 text-xs font-bold text-primaq-600"
        >
          + Neu
        </button>
      </div>

      {/* ── Item list ───────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]" style={{ maxHeight: "60vh" }}>
        {hasItems ? (
          <ul>
            {order.items.map((item) => (
              <OrderItemRow
                key={item.id}
                item={item}
                onDecrement={() => onDecrementOrderItem(item.id)}
                onIncrement={() => onIncrementOrderItem(item.id)}
                onRemove={() => onRemoveOrderItem(item.id)}
              />
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-sm font-medium text-black/50">Noch keine Artikel gewählt.</p>
        )}
      </div>

      {/* ── Payment section (optional) ──────────────────────────────── */}
      {hidePaymentSection ? null : (
        <div className="border-t border-black/10 px-3 pt-3 pb-3">
          <div className="grid gap-1 text-sm">
            <div className="flex justify-between gap-3">
              <span className="font-semibold text-black/55">Artikel gesamt</span>
              <span className="font-bold text-ink">{totalQty}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="font-semibold text-black/55">Summe</span>
              <span className="text-base font-black text-ink">{formatCurrency(order.totalGrossCents)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="font-semibold text-black/55">MwSt-Summe</span>
              <span className="font-bold text-ink">{formatCurrency(order.vatCents)}</span>
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="payment-cash-button"
              onClick={() => onPaymentMethodChange("cash")}
              className={`min-h-10 rounded-lg border px-3 text-sm font-bold ${
                order.paymentMethod === "cash"
                  ? "border-primaq-500 bg-primaq-50 text-primaq-700"
                  : "border-black/10 bg-white text-black/65"
              }`}
            >
              Bar
            </button>
            <button
              type="button"
              data-testid="payment-card-button"
              onClick={() => onPaymentMethodChange("card")}
              className={`min-h-10 rounded-lg border px-3 text-sm font-bold ${
                order.paymentMethod === "card"
                  ? "border-primaq-500 bg-primaq-50 text-primaq-700"
                  : "border-black/10 bg-white text-black/65"
              }`}
            >
              Karte
            </button>
          </div>

          {order.paymentMethod === "cash" ? (
            <div className="mt-2.5 grid gap-2">
              <label className="grid gap-1.5 text-xs font-semibold text-black/65">
                Gegeben
                <div className="flex min-h-11 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
                  <input
                    inputMode="decimal"
                    data-testid="cash-received-input"
                    value={order.cashReceivedCents ? (order.cashReceivedCents / 100).toString().replace(".", ",") : ""}
                    onChange={(event) => onCashReceivedChange(toCents(event.target.value))}
                    className="min-h-11 min-w-0 flex-1 rounded-lg bg-transparent px-3 text-base font-bold outline-none"
                  />
                  <button
                    type="button"
                    data-testid="cash-received-reset-button"
                    onClick={() => onCashReceivedChange(0)}
                    className="mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f5f5f0] text-sm font-black text-ink"
                    aria-label="Gegeben leeren"
                  >
                    ×
                  </button>
                </div>
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {quickAmounts.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    data-testid={`cash-quick-add-${amount}`}
                    onClick={() => onCashReceivedChange(order.cashReceivedCents + amount)}
                    className="min-h-9 rounded-lg bg-[#f5f5f0] text-xs font-bold text-ink ring-1 ring-black/8"
                  >
                    {amount / 100} €
                  </button>
                ))}
              </div>
              <div className={`rounded-lg px-3 py-2.5 ${differenceCents < 0 ? "bg-yellow-50 text-yellow-900" : "bg-primaq-50 text-primaq-900"}`}>
                <p className="text-[10px] font-semibold uppercase tracking-wide">
                  {differenceCents < 0 ? "Noch offen" : differenceCents === 0 ? "Passt genau" : "Rückgeld"}
                </p>
                <p className="mt-0.5 text-lg font-black">
                  {differenceCents === 0
                    ? "Passt genau"
                    : differenceCents > 0
                      ? formatCurrency(differenceCents)
                      : `Noch offen: ${formatCurrency(Math.abs(differenceCents))}`}
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-2.5 grid gap-1.5 rounded-lg bg-blue-50 px-3 py-2.5 text-sm text-blue-900">
              <p className="font-black">Kartenzahlung gewählt</p>
              <div className="flex items-end justify-between gap-3">
                <span className="text-xs font-bold text-blue-600 uppercase tracking-wide">Zu zahlen</span>
                <span className="text-lg font-black text-blue-950">{formatCurrency(order.totalGrossCents)}</span>
              </div>
            </div>
          )}

          {hideCheckoutButton ? null : (
            <button
              type="button"
              data-testid="checkout-button"
              disabled={!canCheckout}
              onClick={() => { onCheckout(); onCheckoutComplete?.(); }}
              className="mt-2.5 min-h-12 w-full rounded-lg bg-primaq-500 px-4 text-base font-bold text-white disabled:cursor-not-allowed disabled:bg-black/25"
            >
              Bestellung buchen
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

// ── QR Payment Panel ──────────────────────────────────────────────────────────

function QrPaymentPanel({
  totalGrossCents,
  paymentLink,
  hintText,
  onConfirm,
  onCancel,
  canConfirm,
  compact = false,
}: {
  totalGrossCents: number;
  paymentLink: string;
  hintText: string;
  onConfirm: () => void;
  onCancel: () => void;
  canConfirm: boolean;
  compact?: boolean;
}) {
  const amountStr = (totalGrossCents / 100).toFixed(2);
  const qrUrl = paymentLink
    ? `${paymentLink}${paymentLink.includes("?") ? "&" : "?"}amount=${amountStr}`
    : "";

  return (
    <div className="grid content-start gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3">
      <p className="text-xs font-black uppercase tracking-wide text-violet-700">📱 QR-Zahlung</p>

      <div className="flex flex-col items-center gap-3 rounded-lg bg-white p-4">
        {qrUrl ? (
          <QRCodeSVG value={qrUrl} size={compact ? 120 : 160} level="M" />
        ) : (
          <div className="flex h-40 w-40 items-center justify-center rounded-lg border border-black/10 bg-[#f5f5f0] text-xs text-black/40 text-center p-4">
            SumUp Payment Link in den Einstellungen hinterlegen
          </div>
        )}
        <div className="text-center">
          <p className="text-xs font-semibold text-black/50">Bestellbetrag</p>
          <p className="text-2xl font-black text-ink">{formatCurrency(totalGrossCents)}</p>
        </div>
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-center">
          <p className="text-xs font-bold text-violet-700">Status: Zahlung offen</p>
          {hintText ? <p className="mt-0.5 text-xs text-violet-600">{hintText}</p> : null}
        </div>
      </div>

      <button
        type="button"
        disabled={!canConfirm}
        onClick={onConfirm}
        className={`min-h-12 w-full rounded-lg px-4 text-base font-black text-white transition ${
          canConfirm ? "bg-green-600 active:scale-[0.99]" : "cursor-not-allowed bg-black/25"
        }`}
      >
        ✓ Zahlung bestätigt
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="min-h-10 w-full rounded-lg border border-black/15 bg-white text-sm font-bold text-black/65"
      >
        Abbrechen
      </button>
    </div>
  );
}

// ── Phase 2: Live-Einsatzmonitor ──────────────────────────────────────────────

function liveTrafficLight(remaining: number, total: number): "green" | "yellow" | "red" | "gray" {
  if (total <= 0) return "gray";
  const pct = remaining / total;
  if (pct > 0.3) return "green";
  if (pct > 0.1) return "yellow";
  return "red";
}

type VisibleMachine = {
  id: string;
  name: string;
  number: string;
  stockLines: MachineStockStatusLine[];
};

function LiveShiftMonitor({ machines }: { machines: VisibleMachine[] }) {
  const allLines = machines.flatMap((m) =>
    m.stockLines.map((l) => ({ ...l, machineName: `Maschine ${m.number}`, machineId: m.id }))
  );

  if (!allLines.length) return null;

  return (
    <div className="rounded-lg border border-black/10 bg-white px-3 py-2.5 shadow-sm">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-black/40">Live-Monitor</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {machines.map((m) => {
          if (!m.stockLines.length) return null;
          return (
            <div key={m.id} className="flex items-center gap-2">
              <span className="text-xs font-bold text-black/40 shrink-0">M{m.number}</span>
              <div className="flex gap-2">
                {m.stockLines.map((line) => {
                  const light = liveTrafficLight(line.remainingLiters, line.totalStartedLiters);
                  const dot = light === "red" ? "🔴" : light === "yellow" ? "🟡" : light === "green" ? "🟢" : "⚪";
                  const nameCls =
                    light === "red"
                      ? "text-red-700"
                      : light === "yellow"
                      ? "text-yellow-700"
                      : "text-ink";
                  return (
                    <div key={line.stockFlavorId} className="flex items-baseline gap-1">
                      <span className="text-[11px]">{dot}</span>
                      <span className={`text-xs font-bold ${nameCls}`}>{line.name}</span>
                      <span className="text-xs font-black tabular-nums text-ink">
                        {Math.round(line.remainingLiters * 10) / 10} L
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Phase 3: Verkaufszähler ───────────────────────────────────────────────────

function SalesStatsBar({
  salesCount,
  totalPieces,
  totalRevenueCents,
}: {
  salesCount: number;
  totalPieces: number;
  totalRevenueCents: number;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-black/10 bg-primaq-50 px-3 py-2 shadow-sm">
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-black tabular-nums text-primaq-700">{totalPieces}</span>
        <span className="text-xs font-semibold text-primaq-600">Port.</span>
      </div>
      <div className="h-4 w-px bg-primaq-200" />
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-black tabular-nums text-primaq-700">{salesCount}</span>
        <span className="text-xs font-semibold text-primaq-600">Verkäufe</span>
      </div>
      <div className="h-4 w-px bg-primaq-200" />
      <div className="flex flex-1 items-baseline justify-end gap-1">
        <span className="text-xl font-black tabular-nums text-primaq-700">
          {formatCurrency(totalRevenueCents)}
        </span>
      </div>
    </div>
  );
}
