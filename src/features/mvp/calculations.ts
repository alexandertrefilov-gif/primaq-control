import {
  defaultSoftServeItems,
  defaultSoftServeRecipe,
  inventoryDisplayItems,
  inventoryItems,
  isGenericSoftMixInventoryName,
  products,
  recipes,
  softMixInventoryItemId
} from "./catalog";
import type {
  DayReport,
  InventoryItemId,
  InventoryReport,
  InventoryState,
  MixInventoryStatus,
  MvpTotals,
  Product,
  ProductId,
  ProductSettings,
  ReportSummary,
  SaleTransaction,
  TaxReport,
  Topping,
  ConsumptionEntry,
  GeneralStockItem,
  Machine,
  MixStockState,
  PackagingType,
  StockFlavor
} from "./types";

const createProductTotals = (productItems: Product[]) =>
  productItems.reduce(
    (acc, product) => ({
      ...acc,
      [product.id]: {
        count: 0,
        cash: 0,
        card: 0,
        free: 0,
        cancel: 0,
        revenueCents: 0,
        cashCents: 0,
        cardCents: 0,
        freeCents: 0,
        cancelCents: 0
      }
    }),
    {} as MvpTotals["productTotals"]
  );

function ensureProductTotal(productTotals: MvpTotals["productTotals"], productId: ProductId) {
  productTotals[productId] ??= {
    count: 0,
    cash: 0,
    card: 0,
    free: 0,
    cancel: 0,
    revenueCents: 0,
    cashCents: 0,
    cardCents: 0,
    freeCents: 0,
    cancelCents: 0
  };

  return productTotals[productId];
}

export function calculateTaxFromGross(grossCents: number, vatRate: number) {
  const normalizedVatRate = vatRate > 1 ? vatRate / 100 : vatRate;
  const netCents = Math.round(grossCents / (1 + normalizedVatRate));
  const taxAmountCents = grossCents - netCents;

  return {
    grossCents,
    netCents,
    taxAmountCents
  };
}

export function calculateTotals(transactions: SaleTransaction[], softServeItems: Product[] = defaultSoftServeItems): MvpTotals {
  const productTotals = createProductTotals([...softServeItems, products.find((product) => product.id === "topping")!]);

  for (const transaction of transactions) {
    const productTotal = ensureProductTotal(productTotals, transaction.productId);

    if (transaction.paymentKind === "cancel") {
      productTotal.cancel += 1;
      productTotal.count -= 1;
      productTotal.revenueCents -= transaction.amountCents;
      productTotal.cancelCents += transaction.amountCents;
      continue;
    }

    if (transaction.quantity > 0 || transaction.quantity < 0) {
      const sign = transaction.quantity > 0 ? 1 : -1;
      productTotal.count += sign;
      productTotal[transaction.paymentKind] += sign;

      if (transaction.paymentKind === "cash") {
        productTotal.cashCents += sign * transaction.amountCents;
        productTotal.revenueCents += sign * transaction.amountCents;
      }

      if (transaction.paymentKind === "card") {
        productTotal.cardCents += sign * transaction.amountCents;
        productTotal.revenueCents += sign * transaction.amountCents;
      }

      if (transaction.paymentKind === "free") {
        productTotal.freeCents += sign * transaction.amountCents;
      }
    }
  }

  for (const productTotal of Object.values(productTotals)) {
    productTotal.count = Math.max(0, productTotal.count);
  }

  const totals: MvpTotals = Object.entries(productTotals).reduce(
    (acc, [productId, productTotal]) => {
      acc.totalPieces += productTotal.count;
      acc.expectedRevenueCents += productTotal.revenueCents;
      acc.cashCents += productTotal.cashCents;
      acc.cardCents += productTotal.cardCents;
      acc.freeCents += productTotal.freeCents;
      acc.cancelCents += productTotal.cancelCents;

      return acc;
    },
    {
      productTotals,
      totalPieces: 0,
      toppingCount: 0,
      toppingTotals: [],
      expectedRevenueCents: 0,
      softServeRevenueCents: 0,
      toppingRevenueCents: 0,
      cashCents: 0,
      cardCents: 0,
      freeCents: 0,
      cancelCents: 0
    } as MvpTotals
  );

  const toppingMap = new Map<string, { name: string; count: number; revenueCents: number }>();

  for (const transaction of transactions) {
    if (transaction.productId !== "topping") {
      continue;
    }

    const name = withoutMachinePrefix(transaction.toppingName ?? "Topping");
    const current = toppingMap.get(name) ?? { name, count: 0, revenueCents: 0 };

    if (transaction.paymentKind === "cancel" || transaction.quantity < 0) {
      current.count -= 1;
      current.revenueCents -= transaction.amountCents;
    } else {
      current.count += 1;

      if (transaction.paymentKind === "cash" || transaction.paymentKind === "card") {
        current.revenueCents += transaction.amountCents;
      }
    }

    toppingMap.set(name, current);
  }

  totals.toppingTotals = Array.from(toppingMap.values()).map((topping) => ({
    ...topping,
    count: Math.max(0, topping.count)
  }));
  totals.toppingCount = productTotals.topping?.count ?? 0;
  totals.toppingRevenueCents = productTotals.topping?.revenueCents ?? 0;
  totals.softServeRevenueCents = softServeItems
    .reduce((sum, product) => sum + totals.productTotals[product.id].revenueCents, 0);

  return totals;
}

export function calculateTaxReport(
  transactions: SaleTransaction[],
  productSettings: ProductSettings,
  toppings: Topping[],
  softServeItems: Product[] = defaultSoftServeItems
): TaxReport {
  const lineMap = new Map<string, TaxReport["lines"][number]>();

  for (const transaction of transactions) {
    if (transaction.paymentKind !== "cash" && transaction.paymentKind !== "card") {
      continue;
    }

    const product = [...softServeItems, ...products].find((item) => item.id === transaction.productId);
    const topping = transaction.toppingId
      ? toppings.find((item) => item.id === transaction.toppingId)
      : undefined;
    const vatRate = transaction.taxRateAtBooking ?? transaction.vatRate ?? topping?.vatRate ?? productSettings[transaction.productId]?.vatRate ?? 7;
    const isTopping = transaction.productId === "topping";
    const bookedName = isTopping
      ? transaction.toppingName ?? topping?.name ?? "Topping"
      : transaction.itemNameAtBooking ?? product?.name ?? "Produkt";
    const name = withoutMachinePrefix(bookedName);
    const key = `${transaction.productId}-${name}-${vatRate}`;
    const grossCents = transaction.quantity < 0
      ? transaction.grossTotalCents ?? -transaction.amountCents
      : transaction.amountCents ?? transaction.grossPriceCents ?? transaction.grossTotalCents ?? 0;
    const { netCents, taxAmountCents } = calculateTaxFromGross(grossCents, vatRate);
    const vatCents = taxAmountCents;
    const current =
      lineMap.get(key) ??
      {
        productId: transaction.productId,
        name,
        grossCents: 0,
        netCents: 0,
        vatCents: 0,
        vatRate
      };

    lineMap.set(key, {
      ...current,
      grossCents: current.grossCents + grossCents,
      netCents: current.netCents + netCents,
      vatCents: current.vatCents + vatCents
    });
  }

  const lines = Array.from(lineMap.values());

  return lines.reduce(
    (acc, line) => ({
      ...acc,
      grossCents: acc.grossCents + line.grossCents,
      netCents: acc.netCents + line.netCents,
      vatCents: acc.vatCents + line.vatCents,
      softServeGrossCents: acc.softServeGrossCents + (line.productId === "topping" ? 0 : line.grossCents),
      toppingGrossCents: acc.toppingGrossCents + (line.productId === "topping" ? line.grossCents : 0),
      vat7Cents: acc.vat7Cents + (line.vatRate === 7 ? line.vatCents : 0),
      vat19Cents: acc.vat19Cents + (line.vatRate === 19 ? line.vatCents : 0),
      lines: [...acc.lines, line]
    }),
    {
      grossCents: 0,
      netCents: 0,
      vatCents: 0,
      softServeGrossCents: 0,
      toppingGrossCents: 0,
      vat7Cents: 0,
      vat19Cents: 0,
      lines: [] as TaxReport["lines"]
    }
  );
}

export function summarizeReports(reports: DayReport[]): ReportSummary {
  return reports.reduce(
    (acc, report) => ({
      reportCount: acc.reportCount + 1,
      grossCents: acc.grossCents + report.taxReport.grossCents,
      netCents: acc.netCents + report.taxReport.netCents,
      vatCents: acc.vatCents + report.taxReport.vatCents,
      vat7Cents: acc.vat7Cents + report.taxReport.vat7Cents,
      vat19Cents: acc.vat19Cents + report.taxReport.vat19Cents,
      cashCents: acc.cashCents + report.totals.cashCents,
      cardCents: acc.cardCents + report.totals.cardCents,
      softServeRevenueCents: acc.softServeRevenueCents + report.totals.softServeRevenueCents,
      toppingRevenueCents: acc.toppingRevenueCents + report.totals.toppingRevenueCents,
      freeCents: acc.freeCents + report.totals.freeCents,
      cancelCents: acc.cancelCents + report.totals.cancelCents,
      cashDifferenceCents: acc.cashDifferenceCents + report.cashDifferenceCents,
      inventoryCostCents: acc.inventoryCostCents + report.inventoryReport.estimatedCostCents
    }),
    {
      reportCount: 0,
      grossCents: 0,
      netCents: 0,
      vatCents: 0,
      vat7Cents: 0,
      vat19Cents: 0,
      cashCents: 0,
      cardCents: 0,
      softServeRevenueCents: 0,
      toppingRevenueCents: 0,
      freeCents: 0,
      cancelCents: 0,
      cashDifferenceCents: 0,
      inventoryCostCents: 0
    }
  );
}

export function formatCurrency(cents: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR"
  }).format(cents / 100);
}

export function withoutMachinePrefix(name: string) {
  return name
    .replace(/^Topping\s+Gelmatic\s+[^·]+·\s*/i, "Topping ")
    .replace(/^Gelmatic\s+[^·]+·\s*/i, "");
}

export function formatMachineDisplayName(name: string | undefined, number?: string) {
  const trimmedName = name?.trim() ?? "";
  const trimmedNumber = number?.trim() ?? "";

  if (!trimmedName) {
    return trimmedNumber ? `MASCHINE ${trimmedNumber}` : "MASCHINE";
  }

  const match = trimmedName.match(/^Gelmatic\s+(\d+)$/i);

  if (match) {
    return `MASCHINE ${match[1]}`;
  }

  return trimmedName;
}

export function toCents(value: string) {
  const normalized = value.replace(",", ".").trim();
  const numberValue = Number(normalized || 0);

  if (!Number.isFinite(numberValue)) {
    return 0;
  }

  return Math.round(numberValue * 100);
}

export function parsePriceToCents(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) : 0;
  }

  if (typeof value === "string") {
    return toCents(value);
  }

  return 0;
}

export function fromCentsInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function calculateInventoryReport(
  totals: MvpTotals,
  inventory: InventoryState,
  consumptionEntries: ConsumptionEntry[] = [],
  mixStocks: MixStockState = {},
  stockFlavors: Record<string, StockFlavor> = {},
  portionWeights: Record<PackagingType, number> = { Waffel: 160, Waffelbecher: 170, Becher: 140 },
  emergencyMode: Record<string, boolean> = {},
  machines: Machine[] = [],
  generalStock: Record<string, GeneralStockItem> = {}
): InventoryReport {
  const expectedByItem = inventoryItems.reduce(
    (acc, item) => ({ ...acc, [item.id]: 0 }),
    {} as Record<InventoryItemId, number>
  );

  if (consumptionEntries.length) {
    for (const entry of consumptionEntries) {
      if (!entry.inventoryItemId) {
        continue;
      }

      expectedByItem[entry.inventoryItemId] += entry.quantity;
    }
  } else {
    for (const product of products) {
      const soldCount = totals.productTotals[product.id]?.count ?? 0;
      const recipe = recipes[product.id];

      for (const [itemId, quantity] of Object.entries(recipe) as [InventoryItemId, number][]) {
        expectedByItem[itemId] += soldCount * quantity;
      }
    }
  }

  const lines = inventoryDisplayItems.map((item) => {
    const line = inventory[item.id];
    const expectedQuantity = roundQuantity(expectedByItem[item.id]);
    const actualQuantity =
      typeof line?.startQuantity === "number" && typeof line?.endQuantity === "number"
        ? roundQuantity(line.startQuantity - line.endQuantity)
        : null;
    const differenceQuantity =
      typeof actualQuantity === "number" ? roundQuantity(actualQuantity - expectedQuantity) : null;
    const quantityForCost = actualQuantity ?? expectedQuantity;
    const estimatedCostCents =
      typeof line?.purchasePriceCents === "number"
        ? Math.round(quantityForCost * line.purchasePriceCents)
        : null;

    return {
      itemId: item.id,
      name: item.name,
      unit: line?.unit ?? item.unit,
      expectedQuantity,
      actualQuantity,
      differenceQuantity,
      purchasePriceCents: line?.purchasePriceCents ?? null,
      estimatedCostCents,
      warning: buildInventoryWarning(item.unit, expectedQuantity, actualQuantity, differenceQuantity)
    };
  });

  const warnings = lines.flatMap((line) => (line.warning ? [`${line.name}: ${line.warning}`] : []));
  const consumedMixByProduct = consumptionEntries.reduce((acc, entry) => {
    if (entry.inventoryItemId !== softMixInventoryItemId || !entry.productId) {
      return acc;
    }

    acc[entry.productId] = (acc[entry.productId] ?? 0) + entry.quantity;
    return acc;
  }, {} as Record<ProductId, number>);
  const globalPortionWeight = portionWeights.Waffel ?? portionWeights.Becher ?? portionWeights.Waffelbecher ?? 160;
  const machineFlavorIds = new Set(
    machines
      .filter((m) => m.active !== false && m.visibleInSale !== false)
      .flatMap((m) => m.products)
      .filter((p) => p.slot === "A" || p.slot === "B")
      .flatMap((p) => p.stockLinks.map((l) => l.stockFlavorId))
  );
  const activeStockFlavors = Object.values(stockFlavors).filter(
    (flavor) =>
      flavor.active !== false &&
      flavor.id !== softMixInventoryItemId &&
      !isGenericSoftMixInventoryName(flavor.name) &&
      machineFlavorIds.has(flavor.id)
  );
  const mixLines = activeStockFlavors.map((flavor) => {
      const stockKey = flavor.id;
      const stock = mixStocks[stockKey];
      const startLiters = roundQuantity(stock?.startLiters ?? 0);
      const refilledLiters = roundQuantity(stock?.refilledLiters ?? 0);
      const correctedLiters = roundQuantity(stock?.correctedLiters ?? 0);
      const consumedLiters = roundQuantity(consumedMixByProduct[stockKey] ?? 0);
      const remainingLiters = roundQuantity(startLiters + refilledLiters + correctedLiters - consumedLiters);
      const flavorPortionWeight = flavor.portionWeights?.Waffel ?? flavor.portionWeights?.Becher ?? flavor.portionWeights?.Waffelbecher;
      const portionWeight = flavorPortionWeight && flavorPortionWeight > 0 ? flavorPortionWeight : globalPortionWeight;
      const estimatedRemainingPortions = portionWeight > 0
        ? Math.max(0, Math.floor((remainingLiters * 1000) / portionWeight))
        : null;

      const isEmergencyMode = emergencyMode[stockKey] === true;
      const baseStatus = buildMixStatus(remainingLiters, estimatedRemainingPortions, flavor.warningThresholdPortions);
      const status: MixInventoryStatus = isEmergencyMode && remainingLiters <= 0 ? "Notbetrieb" : baseStatus;

      return {
        productId: stockKey,
        name: flavor.name,
        machineName: undefined,
        recipe: flavor.recipe,
        startLiters,
        refilledLiters,
        correctedLiters,
        consumedLiters,
        remainingLiters,
        estimatedRemainingPortions,
        status,
        isEmergencyMode
      };
    });
  for (const [stockKey, stock] of Object.entries(mixStocks)) {
    if (stockFlavors[stockKey] || !stock.name || stockKey === softMixInventoryItemId || isGenericSoftMixInventoryName(stock.name)) {
      continue;
    }

    const startLiters = roundQuantity(stock.startLiters);
    const refilledLiters = roundQuantity(stock.refilledLiters);
    const correctedLitersAdhoc = roundQuantity(stock.correctedLiters ?? 0);
    const consumedLiters = roundQuantity(consumedMixByProduct[stockKey] ?? 0);
    const remainingLiters = roundQuantity(startLiters + refilledLiters + correctedLitersAdhoc - consumedLiters);
    const portionGrams = stock.portionGrams ?? 160;
    const estimatedRemainingPortions = portionGrams > 0
      ? Math.max(0, Math.floor((remainingLiters * 1000) / portionGrams))
      : null;

    const isEmergencyModeAdhoc = emergencyMode[stockKey] === true;
    const baseStatusAdhoc = buildMixStatus(remainingLiters, estimatedRemainingPortions, 20);
    const statusAdhoc: MixInventoryStatus = isEmergencyModeAdhoc && remainingLiters <= 0 ? "Notbetrieb" : baseStatusAdhoc;

    mixLines.push({
      productId: stockKey,
      name: stock.name,
      machineName: undefined,
      recipe: stock.recipe ?? defaultSoftServeRecipe,
      startLiters,
      refilledLiters,
      correctedLiters: correctedLitersAdhoc,
      consumedLiters,
      remainingLiters,
      estimatedRemainingPortions,
      status: statusAdhoc,
      isEmergencyMode: isEmergencyModeAdhoc
    });
  }
  const mixPriceCentsPerLiter = inventory[softMixInventoryItemId]?.purchasePriceCents ?? null;
  const legacyMixCostCents = mixPriceCentsPerLiter !== null
    ? Math.round(mixLines.reduce((sum, line) => sum + line.consumedLiters, 0) * mixPriceCentsPerLiter)
    : 0;
  // Einkaufspreise je Sorte kommen aus dem Pulver-Lager (generalStock), nicht aus dem
  // (in der UI nicht editierbaren) Sammel-Eintrag inventory[softMixInventoryItemId].
  const generalStockMixCostCents = mixLines.reduce((sum, line) => {
    const stockItem = Object.values(generalStock).find(
      (item) => item.active !== false && item.flavorId === line.productId
    );
    const pricePerLiter =
      stockItem?.purchasePriceCents != null && stockItem.recipe.mixLitersPerBatch > 0
        ? stockItem.purchasePriceCents / stockItem.recipe.mixLitersPerBatch
        : null;
    return sum + (pricePerLiter !== null ? line.consumedLiters * pricePerLiter : 0);
  }, 0);
  const mixCostCents = legacyMixCostCents + Math.round(generalStockMixCostCents);
  const estimatedCostCents = lines.reduce((sum, line) => sum + (line.estimatedCostCents ?? 0), 0) + mixCostCents;

  return {
    lines,
    mixLines,
    estimatedCostCents,
    warnings: [
      ...warnings,
      ...mixLines
        .filter((line) => line.status !== "OK")
        .map((line) => `${line.name}: ${line.status}`)
    ]
  };
}

export function parseQuantityInput(value: string) {
  const normalized = value.replace(",", ".").trim();

  if (!normalized) {
    return null;
  }

  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function formatQuantity(value: number | null, unit: string) {
  if (value === null) {
    return "offen";
  }

  return `${new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: unit === "Stk." ? 0 : 3
  }).format(value)} ${unit}`;
}

function roundQuantity(value: number) {
  return Math.round(value * 1000) / 1000;
}

function buildMixStatus(remainingLiters: number, estimatedRemainingPortions: number | null, warningThresholdPortions: number) {
  const warningThreshold = Math.max(1, warningThresholdPortions || 20);

  if (remainingLiters <= 0) {
    return "Leer" as const;
  }

  if (estimatedRemainingPortions !== null && estimatedRemainingPortions < Math.ceil(warningThreshold / 2)) {
    return "Nachfüllen" as const;
  }

  if (estimatedRemainingPortions !== null && estimatedRemainingPortions < warningThreshold) {
    return "Bald leer" as const;
  }

  return "OK" as const;
}

function buildInventoryWarning(
  unit: string,
  expectedQuantity: number,
  actualQuantity: number | null,
  differenceQuantity: number | null
) {
  if (expectedQuantity === 0 && actualQuantity === null) {
    return null;
  }

  if (actualQuantity === null) {
    return "Endbestand fehlt";
  }

  if (actualQuantity < 0) {
    return "Restmenge groesser als Startbestand";
  }

  if (differenceQuantity === null) {
    return null;
  }

  const tolerance = unit === "Stk." ? 0 : 0.02;

  if (Math.abs(differenceQuantity) <= tolerance) {
    return null;
  }

  return differenceQuantity > 0 ? "Mehrverbrauch/Verlust pruefen" : "Ist-Verbrauch unter Soll pruefen";
}
