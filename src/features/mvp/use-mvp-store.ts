"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSoftServeName,
  createBlankMachine,
  createBlankSoftServeProduct,
  createCustomMachineProduct,
  defaultAromas,
  defaultProductSettings,
  defaultSalesLayout,
  defaultPackagingSizes,
  defaultSoftServeRecipe,
  defaultPortionWeights,
  defaultToppings,
  isGenericSoftMixInventoryName,
  recipes,
  inventoryItems,
  softMixInventoryItemId,
  products,
  packagingConsumptionRules,
  LOESSEL_SALE_TAG,
  TOPPING_SALE_TAG,
} from "./catalog";
import {
  calculateTaxFromGross,
  calculateInventoryReport,
  calculateTaxReport,
  calculateTotals,
  formatMachineDisplayName,
  parsePriceToCents,
  withoutMachinePrefix
} from "./calculations";
import { loadSettingsFromCloud, subscribeToSettingsRealtime, syncSettingsToCloud } from "./settings-sync";
import type { CloudSettings } from "./settings-sync";
import { loadInventoryFromCloud, syncInventoryToCloud } from "./inventory-sync";
import { loadShiftStateFromCloud, syncShiftStateToCloud } from "./shift-sync";
import { loadSalesStateFromCloud, syncSalesStateToCloud } from "./sales-sync";
import type {
  DayReport,
  CurrentOrder,
  CurrentOrderItem,
  DailyOrder,
  ConsumptionEntry,
  EmergencyModeEntry,
  MixStockMovement,
  InventoryItemId,
  InventoryLine,
  Machine,
  MachineProductSlot,
  MaterialCategory,
  MaterialItem,
  MixStockInput,
  MvpState,
  PaymentKind,
  Product,
  ProductId,
  ProductSettings,
  PackagingType,
  SaleTransaction,
  Shift,
  ShiftFormData,
  ShiftMachineDeployment,
  ShiftMaterialAssignment,
  SoftServeProduct,
  SoftServeRecipeTemplate,
  StockFlavor,
  StockLink,
  Topping
} from "./types";

const storageKey = "primaq-control-mvp-state";
const machinesStorageKey = "primaq-control-machines";
const currentOrderStorageKey = "primaq-control-current-order";
const openOrdersStorageKey = "primaq-control-open-orders";
const activeOrderIdStorageKey = "primaq-control-active-order-id";
const dailySalesStorageKey = "primaq-control-daily-sales";
const completedOrdersStorageKey = "primaq-control-completed-orders";
// Wird nur von deleteMachine gesetzt. Schützt vor der Race Condition:
// Maschine löschen → Reload bevor Cloud-Sync abgeschlossen → loadSettingsFromCloud
// liefert alte Maschinenliste → Maschine erscheint wieder.
// Bewusst kein breiteres "settingsLocalAt": Verkäufe/Einsätze dürfen diesen Key
// nicht überschreiben, weil das den Cross-Device-Sync (Mac → iPad) blockieren würde.
const machinesLocalAtKey = "primaq-machines-local-at";

// Verhindert, dass persistState während eines Resets (factoryReset/resetSalesData)
// alten State in localStorage schreibt. Da mehrere Komponenten useMvpStore() aufrufen,
// haben sie jeweils eigene React-Instanzen. Ohne dieses Flag würde z. B.
// SumupSettingsSection (eigener useMvpStore-Aufruf) nach dem setState(nextState)
// im SettingsClient noch seinen alten State in localStorage schreiben.
// Nach window.location.reload() wird das Modul neu initialisiert und das Flag ist false.
let persistStateLocked = false;

// Zentrale Liste aller bekannten PrimaQ localStorage-Keys.
// Wird von clearAllPrimaqLocalStorage() und Tests verwendet.
export const ALL_PRIMAQ_STORAGE_KEYS = [
  storageKey,
  machinesStorageKey,
  currentOrderStorageKey,
  openOrdersStorageKey,
  activeOrderIdStorageKey,
  dailySalesStorageKey,
  completedOrdersStorageKey,
  machinesLocalAtKey
] as const;

// Löscht alle PrimaQ localStorage-Einträge (bekannte Keys + alle "primaq-"-Prefixed Keys).
// Muss vor persistResetState aufgerufen werden, damit kein useEffect-Trigger
// (via persistState) alte Daten nach dem Löschen zurückschreibt.
function clearAllPrimaqLocalStorage() {
  if (typeof window === "undefined") return;
  for (const key of ALL_PRIMAQ_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
  }
  // Legacy- oder zukünftige Keys mit "primaq-"-Prefix ebenfalls entfernen
  const extra: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k?.startsWith("primaq-")) extra.push(k);
  }
  for (const k of extra) window.localStorage.removeItem(k);
}

const createInitialInventory = () =>
  inventoryItems.reduce(
    (acc, item) => ({
      ...acc,
      [item.id]: {
        itemId: item.id,
        unit: item.unit,
        startQuantity: null,
        endQuantity: null,
        purchasePriceCents: null
      }
    }),
    {} as MvpState["inventory"]
  );

const emptyOrder: CurrentOrder = {
  id: "order_1",
  title: "Bestellung 1",
  items: [],
  paymentMethod: "cash",
  cashReceivedCents: 0,
  totalGrossCents: 0,
  vatCents: 0,
  changeDueCents: 0
};

const initialState: MvpState = {
  productConfigVersion: 4,
  activeShift: null,
  transactions: [],
  currentOrder: emptyOrder,
  openOrders: [emptyOrder],
  activeOrderId: emptyOrder.id ?? "order_1",
  dailySales: {
    orders: []
  },
  completedOrders: [],
  consumptionEntries: [],
  mixStocks: {},
  stockFlavors: {},
  portionWeights: defaultPortionWeights,
  inventory: createInitialInventory(),
  machines: [],
  softServeItems: [createBlankSoftServeProduct()],
  aromas: defaultAromas,
  packagingSizes: defaultPackagingSizes,
  productSettings: defaultProductSettings,
  salesLayout: defaultSalesLayout,
  toppings: defaultToppings,
  dayReport: null,
  reports: [],
  emergencyMode: {},
  emergencyModeLog: [],
  mixStockMovements: {},
  recipeTemplates: [],
  generalStock: {},
  generalStockMovements: {},
  inventoryMovements: {},
  materialCategories: [],
  materialItems: {},
  shiftMaterialAssignments: [],
  sumupSettings: { enabled: false, paymentLink: "", hintText: "" },
  favorites: []
};

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

type MaterialConsumptionResult = {
  assignments: ShiftMaterialAssignment[];
  materialItems: Record<string, MaterialItem>;
};

// Berechnet Materialverbrauch für eine Bestellliste und aktualisiert consumedQty.
// direction: +1 beim Checkout, -1 beim Storno/Undo.
//
// Für Artikel ohne manuelle Lager-Zuweisung (assignMaterialToShift) wird die
// Zuweisung automatisch erzeugt/fortgeschrieben (autoTracked: true, assignedQty
// === consumedQty, returnedQty/lossQty = 0) und quantityOnHand direkt verändert –
// so reduziert ein Verkauf den Materialbestand auch ohne manuelle Zuweisung.
function applyMaterialConsumptionForOrder(
  items: CurrentOrderItem[],
  assignments: ShiftMaterialAssignment[],
  materialItems: Record<string, MaterialItem>,
  materialCategories: MaterialCategory[],
  shiftId: string,
  direction: 1 | -1
): MaterialConsumptionResult {
  // Berechne saleTag → consumedQty-Delta aus der Bestellung
  const tagDeltas = new Map<string, number>();

  for (const item of items) {
    const qty = item.quantity;
    // Verpackungsartikel (Waffel, Becher, Waffelbecher)
    if (item.packagingType) {
      const rules = packagingConsumptionRules[item.packagingType] ?? [];
      for (const rule of rules) {
        tagDeltas.set(rule.saleTag, (tagDeltas.get(rule.saleTag) ?? 0) + rule.qty * qty);
      }
    }
    // Toppings
    if (item.productId === "topping" || item.toppingName) {
      tagDeltas.set(TOPPING_SALE_TAG, (tagDeltas.get(TOPPING_SALE_TAG) ?? 0) + qty);
    }
  }

  if (tagDeltas.size === 0) return { assignments, materialItems };

  // Erstelle eine Lookup-Map: saleTag → Assignment-Index (aktive Assignments dieses Einsatzes)
  const tagToAssignmentIdx = new Map<string, number>();
  assignments.forEach((a, idx) => {
    if (a.shiftId !== shiftId) return;
    const matItem = materialItems[a.itemId];
    if (matItem?.saleTag) {
      tagToAssignmentIdx.set(matItem.saleTag, idx);
    }
  });

  let updatedAssignments = assignments;
  let updatedMaterialItems = materialItems;
  const now = new Date().toISOString();

  for (const [tag, delta] of tagDeltas) {
    const idx = tagToAssignmentIdx.get(tag);

    if (idx !== undefined) {
      const a = updatedAssignments[idx];
      if (updatedAssignments === assignments) updatedAssignments = [...assignments];

      if (a.autoTracked) {
        // Auto-erfasst: assignedQty und consumedQty laufen synchron, Bestand direkt buchen
        const newConsumed = Math.max(0, (a.consumedQty ?? 0) + direction * delta);
        const newAssigned = Math.max(0, a.assignedQty + direction * delta);
        updatedAssignments[idx] = { ...a, assignedQty: newAssigned, consumedQty: newConsumed };

        const mi = updatedMaterialItems[a.itemId];
        if (mi) {
          if (updatedMaterialItems === materialItems) updatedMaterialItems = { ...materialItems };
          updatedMaterialItems[a.itemId] = { ...mi, quantityOnHand: Math.max(0, mi.quantityOnHand - direction * delta) };
        }
      } else {
        // Manuell zugewiesen: nur consumedQty fortschreiben (bestehende Logik)
        const newConsumed = Math.max(0, (a.consumedQty ?? 0) + direction * delta);
        updatedAssignments[idx] = { ...a, consumedQty: newConsumed };
      }
      continue;
    }

    // Keine Zuweisung vorhanden: bei Storno gibt es nichts rückzubuchen
    if (direction === -1) continue;

    // Passendes aktives MaterialItem per saleTag suchen und Zuweisung automatisch anlegen
    const matEntry = Object.entries(materialItems).find(([, i]) => i.saleTag === tag && i.active !== false);
    if (!matEntry) continue;
    const [itemId, item] = matEntry;

    const categoryId = materialCategories.find((c) => c.itemIds.includes(itemId))?.id ?? "";
    if (updatedAssignments === assignments) updatedAssignments = [...assignments];
    updatedAssignments.push({
      id: createId("sma"),
      shiftId,
      categoryId,
      itemId,
      itemName: item.name,
      unit: item.unit,
      assignedQty: delta,
      consumedQty: delta,
      returnedQty: 0,
      lossQty: 0,
      autoTracked: true,
      createdAt: now,
    });

    if (updatedMaterialItems === materialItems) updatedMaterialItems = { ...materialItems };
    updatedMaterialItems[itemId] = { ...item, quantityOnHand: Math.max(0, item.quantityOnHand - delta) };
  }

  return { assignments: updatedAssignments, materialItems: updatedMaterialItems };
}

function findGeneralStockItemForFlavor(generalStock: Record<string, import("./types").GeneralStockItem>, flavorId: string): import("./types").GeneralStockItem | undefined {
  return Object.values(generalStock).find((item) => item.active !== false && item.flavorId === flavorId)
    ?? generalStock[`${flavorId}_powder`];
}

function migrateGeneralStock(raw: unknown): Record<string, import("./types").GeneralStockItem> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, import("./types").GeneralStockItem> = {};
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const valueName = typeof (value as Record<string, unknown>).productName === "string"
      ? (value as Record<string, unknown>).productName as string
      : typeof (value as Record<string, unknown>).name === "string"
        ? (value as Record<string, unknown>).name as string
        : "";
    if (isGenericSoftMixInventoryName(valueName) || isGenericSoftMixInventoryName(
      typeof (value as Record<string, unknown>).flavorName === "string"
        ? (value as Record<string, unknown>).flavorName as string
        : undefined
    )) {
      continue;
    }
    const v = value as Record<string, unknown>;
    if (typeof v.productName === "string") {
      result[key] = v as unknown as import("./types").GeneralStockItem;
    } else if (typeof v.name === "string") {
      const flavorId = key.endsWith("_powder") ? key.slice(0, -"_powder".length) : undefined;
      const flavorName = typeof v.name === "string"
        ? (v.name as string).replace(/ Pulver$/i, "").trim()
        : "";
      result[key] = {
        id: key,
        productName: v.name as string,
        flavorName,
        flavorId,
        recipe: normalizeSoftServeRecipe(undefined),
        unit: (v.unit as "Pkg" | "kg" | "Stück") ?? "Pkg",
        quantityOnHand: typeof v.quantityOnHand === "number" ? v.quantityOnHand : 0,
        purchasePriceCents: typeof v.purchasePriceCents === "number" ? v.purchasePriceCents : null,
        active: true,
        createdAt: typeof v.lastUpdatedAt === "string" ? v.lastUpdatedAt : now,
        lastUpdatedAt: typeof v.lastUpdatedAt === "string" ? v.lastUpdatedAt : now,
      };
    }
  }
  return result;
}

function createOrderTitle(index: number) {
  return `Bestellung ${index + 1}`;
}

function createBlankOrder(id: string, title: string): CurrentOrder {
  return {
    ...emptyOrder,
    id,
    title
  };
}

function normalizeOrderId(orderId: unknown, fallbackPrefix: string) {
  return typeof orderId === "string" && orderId.trim() ? orderId : createId(fallbackPrefix);
}

function normalizeOpenOrder(order: Partial<CurrentOrder>, index: number): CurrentOrder {
  const normalized = calculateOrder(
    order.items ?? [],
    order.paymentMethod ?? "cash",
    order.cashReceivedCents ?? 0
  );

  return {
    ...normalized,
    id: normalizeOrderId(order.id, `order_${index + 1}`),
    title: typeof order.title === "string" && order.title.trim() ? order.title : createOrderTitle(index)
  };
}

function createInitialOpenOrders(
  currentOrder: CurrentOrder | null | undefined,
  legacyCurrentOrder: CurrentOrder | null | undefined,
  storedOpenOrders: Array<Partial<CurrentOrder>> | null | undefined
) {
  const normalizedStoredOpenOrders = storedOpenOrders?.length
    ? storedOpenOrders.map((order, index) => normalizeOpenOrder(order, index))
    : [];

  if (normalizedStoredOpenOrders.length) {
    return normalizedStoredOpenOrders;
  }

  const legacyOrder = currentOrder ?? legacyCurrentOrder;

  if (legacyOrder?.items?.length) {
    return [normalizeOpenOrder({ ...legacyOrder, id: "order_1", title: "Bestellung 1" }, 0)];
  }

  return [createBlankOrder("order_1", "Bestellung 1")];
}

function defaultSpoonIncluded(packagingType: SoftServeProduct["packagingType"]) {
  return packagingType === "Becher" || packagingType === "Waffelbecher";
}

function normalizeSoftServeItem(item: Partial<SoftServeProduct> & Product, stockFlavors: Record<string, StockFlavor> = {}): SoftServeProduct {
  const itemWithLegacyPrice = item as Partial<SoftServeProduct> & Product & { priceGross?: number | string };
  const aroma = item.aroma ?? "Vanille";
  const packagingType = item.packagingType ?? "Becher";
  const packagingSize = item.packagingSize ?? "120cc";
  const nameManuallyEdited = item.nameManuallyEdited ?? true;
  const priceCents =
    item.priceCents ??
    parsePriceToCents(itemWithLegacyPrice.priceGross);

  return {
    ...item,
    machineId: item.machineId,
    machineName: item.machineName,
    slot: item.slot,
    name: typeof item.name === "string" ? item.name : buildSoftServeName(aroma, packagingType, packagingSize),
    priceCents,
    vatRate: item.vatRate ?? 7,
    aroma,
    packagingType,
    packagingSize,
    portionGrams: item.portionGrams ?? 0,
    stockLinks: normalizeStockLinks(item, stockFlavors),
    recipe: normalizeSoftServeRecipe(item.recipe),
    spoonIncluded: item.spoonIncluded ?? defaultSpoonIncluded(packagingType),
    toppingEnabled: item.toppingEnabled ?? false,
    toppingPriceCents: item.toppingPriceCents ?? 0,
    toppingVatRate: item.toppingVatRate ?? 7,
    visibleInSale: item.visibleInSale ?? true,
    nameManuallyEdited
  };
}

function normalizeSoftServeRecipe(recipe: Partial<SoftServeProduct["recipe"]> | undefined): SoftServeProduct["recipe"] {
  return {
    powderKgPerBatch: normalizePositiveNumber(recipe?.powderKgPerBatch, defaultSoftServeRecipe.powderKgPerBatch),
    waterLitersPerBatch: normalizePositiveNumber(recipe?.waterLitersPerBatch, defaultSoftServeRecipe.waterLitersPerBatch),
    mixLitersPerBatch: normalizePositiveNumber(recipe?.mixLitersPerBatch, defaultSoftServeRecipe.mixLitersPerBatch),
    packageKg: typeof recipe?.packageKg === "number" && Number.isFinite(recipe.packageKg) && recipe.packageKg > 0
      ? recipe.packageKg
      : defaultSoftServeRecipe.packageKg,
    note: recipe?.note?.trim() || undefined
  };
}

function normalizePositiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeStockFlavorName(name: string) {
  return withoutMachinePrefix(name)
    .replace(/^mix\s+/i, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function createStockFlavorId(name: string) {
  return normalizeStockFlavorName(name).replace(/[^a-z0-9äöüß]+/gi, "-") || createId("stock");
}

function getProductStockFlavorName(product: Partial<SoftServeProduct>) {
  const baseName = product.name || product.aroma || "";
  return withoutMachinePrefix(baseName)
    .replace(/\s+(Waffelbecher|Waffel|Becher)\b.*$/i, "")
    .trim();
}

function normalizeStockLinks(product: Partial<SoftServeProduct>, stockFlavors: Record<string, StockFlavor>): StockLink[] {
  const isRealStockFlavorLink = (stockFlavorId: string) => {
    const flavor = stockFlavors[stockFlavorId];
    return Boolean(flavor) && stockFlavorId !== softMixInventoryItemId && !isGenericSoftMixInventoryName(flavor?.name);
  };

  if (product.slot === "MIX") {
    return [];
  }

  // For A/B products the product name is the canonical source of truth.
  // Check name-derived ID first so stale explicit links never win after a rename.
  const flavorName = getProductStockFlavorName(product);
  if (flavorName) {
    const nameId = createStockFlavorId(flavorName);
    if (nameId && isRealStockFlavorLink(nameId)) {
      return [{ stockFlavorId: nameId, ratio: 1 }];
    }
  }

  // Fall back to any valid explicit link (covers non-name-based flavor IDs).
  const explicitLinks = Array.isArray(product.stockLinks)
    ? product.stockLinks
        .filter((link) => link.stockFlavorId && isRealStockFlavorLink(link.stockFlavorId) && Number.isFinite(link.ratio) && link.ratio > 0)
        .map((link) => ({ stockFlavorId: link.stockFlavorId, ratio: link.ratio }))
    : [];

  return explicitLinks;
}

function normalizeMixProductLinks(products: SoftServeProduct[]) {
  const sourceProducts = getMixSourceProducts(products);
  const fallbackMixLinks = sourceProducts
    .map((product) => product.stockLinks[0])
    .filter((link): link is StockLink => Boolean(link?.stockFlavorId))
    .map((link) => ({ stockFlavorId: link.stockFlavorId, ratio: 0.5 }));

  return products.map((product) => {
    const isMix = isMixSaleProduct(product);

    if (!isMix) {
      return product;
    }

    if (fallbackMixLinks.length < 2) {
      return product;
    }

    return {
      ...product,
      stockLinks: fallbackMixLinks
    };
  });
}

function assignProductSlots(products: SoftServeProduct[]): SoftServeProduct[] {
  const AUTO_SLOTS: MachineProductSlot[] = ["A", "B"];
  let autoSlotIdx = 0;
  return products.map((product) => {
    if (product.isMixVariant === true) {
      return { ...product, slot: "MIX" as MachineProductSlot };
    }
    if (product.isMixVariant === false) {
      const assigned = AUTO_SLOTS[autoSlotIdx++];
      return assigned ? { ...product, slot: assigned } : { ...product, slot: undefined };
    }
    if (product.slot === "A" || product.slot === "B" || product.slot === "MIX") {
      if (product.slot !== "MIX") autoSlotIdx++;
      return product;
    }
    if (product.name.trim().toLowerCase().includes("mix")) {
      return { ...product, slot: "MIX" as MachineProductSlot };
    }
    const assigned = AUTO_SLOTS[autoSlotIdx++];
    return assigned ? { ...product, slot: assigned } : product;
  });
}

function normalizeMachine(machine: Partial<Machine> & { id: string }, stockFlavors: Record<string, StockFlavor> = {}): Machine {
  const machineWithLegacyProducts = machine as Partial<Machine> & {
    flavors?: Array<Partial<SoftServeProduct> & Product>;
    sorten?: Array<Partial<SoftServeProduct> & Product>;
  };
  const number = typeof machine.number === "string" && machine.number.trim() ? machine.number : "1";
  const manualName = false;
  const name = `Gelmatic ${number}`;
  const storedLocation = machine.location as Machine["location"] | "Verkaufswagen" | undefined;
  const storedProducts = machine.products?.length
    ? machine.products
    : machineWithLegacyProducts.flavors?.length
      ? machineWithLegacyProducts.flavors
      : machineWithLegacyProducts.sorten?.length
        ? machineWithLegacyProducts.sorten
        : undefined;
  const sourceProducts = storedProducts ?? [];
  const normalizedProducts = normalizeMixProductLinks(sourceProducts.map((product, index) =>
    normalizeSoftServeItem({
      ...createCustomMachineProduct(machine.id, name, `${machine.id}_sort_${index + 1}`),
      ...product,
      id: product.id
        ? product.id.startsWith(`${machine.id}_`) ? product.id : `${machine.id}_${product.id}`
        : `${machine.id}_sort_${index + 1}`,
      machineId: machine.id,
      machineName: name
    }, stockFlavors)
  ));

  // Auto-assign A/B/MIX slots to products that don't have one (or that have an explicit isMixVariant override)
  const products = assignProductSlots(normalizedProducts);

  return {
    id: machine.id,
    number,
    name,
    manualName,
    location: storedLocation === "Verkaufswagen" ? "Wagen" : storedLocation ?? "Wagen",
    colorHex: machine.colorHex,
    active: machine.active ?? true,
    visibleInSale: machine.visibleInSale ?? true,
    products
  };
}

function buildStockFlavorsFromMachines(rawMachines: Array<Partial<Machine> & { id: string }>, storedStockFlavors?: Record<string, StockFlavor>) {
  const stockFlavors = Object.fromEntries(
    Object.entries(storedStockFlavors ?? {}).filter(
      ([id, flavor]) => id !== softMixInventoryItemId && !isGenericSoftMixInventoryName(flavor.name)
    )
  ) as Record<string, StockFlavor>;

  for (const machine of rawMachines) {
    const sourceProducts = machine.products ?? [];

    for (const product of sourceProducts) {
      if (product.slot === "MIX") {
        continue;
      }

      const name = getProductStockFlavorName(product);

      if (!name) {
        continue;
      }

      const id = createStockFlavorId(name);

      stockFlavors[id] ??= {
        id,
        name,
        colorHex: product.colorHex,
        recipe: normalizeSoftServeRecipe(product.recipe),
        warningThresholdPortions: 20,
        active: true
      };
    }
  }

  return stockFlavors;
}

type InventoryFlavorInput = {
  name: string;
  colorHex?: string;
  recipe: SoftServeProduct["recipe"];
  warningThresholdPortions: number;
  stockInput: MixStockInput;
  savePermanent: boolean;
  portionWeights?: Partial<Record<PackagingType, number>>;
};

type DeleteInventoryFlavorResult =
  | { ok: true }
  | { ok: false; reason: "linked" | "movements" | "missing"; message: string };

function flattenMachineProducts(machines: Machine[]): SoftServeProduct[] {
  return machines.flatMap((machine) =>
    machine.products.map((product) => ({
      ...product,
      machineId: machine.id,
      machineName: machine.name
    }))
  );
}

function createMixStockLine(
  productId: ProductId,
  startLiters = 0,
  refilledLiters = 0,
  correctedLiters = 0,
  meta?: Partial<Pick<MvpState["mixStocks"][string], "name" | "recipe" | "portionGrams">>
) {
  return {
    productId,
    ...meta,
    startLiters: roundQuantity(startLiters),
    refilledLiters: roundQuantity(refilledLiters),
    correctedLiters: roundQuantity(correctedLiters)
  };
}

function calculateMixInputLiters(input: MixStockInput | undefined, recipeSource: Pick<SoftServeProduct, "recipe">) {
  if (!input || typeof input.value !== "number" || !Number.isFinite(input.value)) {
    return 0;
  }

  if (input.mode !== "correction" && input.value <= 0) {
    return 0;
  }

  if (input.mode === "batches") {
    return input.value * recipeSource.recipe.mixLitersPerBatch;
  }

  if (input.mode === "packages") {
    const recipe = recipeSource.recipe;
    const pkgKg = typeof recipe.packageKg === "number" && recipe.packageKg > 0
      ? recipe.packageKg
      : recipe.powderKgPerBatch;
    const batchesPerPkg = recipe.powderKgPerBatch > 0 ? pkgKg / recipe.powderKgPerBatch : 1;
    return input.value * batchesPerPkg * recipe.mixLitersPerBatch;
  }

  return input.value;
}

function roundQuantity(value: number) {
  return Math.round(value * 1000) / 1000;
}

function normalizeReport(report: DayReport): DayReport {
  return {
    ...report,
    totals: {
      ...report.totals,
      toppingCount: report.totals.toppingCount ?? report.totals.productTotals.topping.count,
      toppingTotals: report.totals.toppingTotals ?? [],
      softServeRevenueCents:
        report.totals.softServeRevenueCents ??
        Object.keys(report.totals.productTotals)
          .filter((productId) => productId !== "topping")
          .reduce((sum, productId) => sum + (report.totals.productTotals[productId]?.revenueCents ?? 0), 0),
      toppingRevenueCents:
        report.totals.toppingRevenueCents ?? report.totals.productTotals.topping?.revenueCents ?? 0
    },
    inventoryReport: {
      ...report.inventoryReport,
      mixLines: report.inventoryReport.mixLines ?? []
    },
    taxReport: {
      ...report.taxReport,
      softServeGrossCents:
        report.taxReport.softServeGrossCents ??
        products
          .filter((product) => product.id !== "topping")
          .reduce((sum, product) => {
            const line = report.taxReport.lines.find((item) => item.productId === product.id);
            return sum + (line?.grossCents ?? 0);
          }, 0),
      toppingGrossCents:
        report.taxReport.toppingGrossCents ??
        report.taxReport.lines
          .filter((line) => line.productId === "topping")
          .reduce((sum, line) => sum + line.grossCents, 0)
    }
  };
}

function dedupeReportsByShift(reports: DayReport[]) {
  const reportsByShift = new Map<string, DayReport>();

  for (const report of reports) {
    const shiftId = report.shift.id;
    const existing = reportsByShift.get(shiftId);

    if (!existing || report.createdAt.localeCompare(existing.createdAt) >= 0) {
      reportsByShift.set(shiftId, report);
    }
  }

  return Array.from(reportsByShift.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalizeDeploymentMachines(
  deploymentMachines: ShiftMachineDeployment[] | null | undefined,
  validMachineIds: Set<string>
): ShiftMachineDeployment[] | undefined {
  if (!deploymentMachines?.length) return deploymentMachines ?? undefined;

  const byMachineId = new Map<string, ShiftMachineDeployment>();
  const skipped: string[] = [];

  for (const dep of deploymentMachines) {
    if (!validMachineIds.has(dep.machineId)) {
      skipped.push(dep.machineId);
      continue;
    }
    const existing = byMachineId.get(dep.machineId);
    if (existing) {
      const mergedSlots = [...existing.slots];
      for (const slot of dep.slots) {
        if (!mergedSlots.some((s) => s.slot === slot.slot)) {
          mergedSlots.push(slot);
        }
      }
      byMachineId.set(dep.machineId, { ...existing, slots: mergedSlots });
    } else {
      byMachineId.set(dep.machineId, dep);
    }
  }

  if (process.env.NODE_ENV !== "production" && (skipped.length > 0 || byMachineId.size < deploymentMachines.length)) {
    console.warn(
      `[PrimaQ] deploymentMachines bereinigt: ${deploymentMachines.length} → ${byMachineId.size}.` +
        (skipped.length ? ` Unbekannte IDs: ${skipped.join(", ")}` : "")
    );
  }

  const result = Array.from(byMachineId.values());
  return result.length > 0 ? result : undefined;
}

// Updates deploymentMachines slot flavor IDs to match current machine product stockLinks.
// Called on readStoredState to heal stale deployment snapshots (e.g. after settings changes between reloads).
function syncDeploymentFromMachines(
  deploymentMachines: ShiftMachineDeployment[] | undefined,
  machines: Machine[]
): ShiftMachineDeployment[] | undefined {
  if (!deploymentMachines?.length) return deploymentMachines;
  const machineMap = new Map(machines.map((m) => [m.id, m]));
  return deploymentMachines.map((dep) => {
    const machine = machineMap.get(dep.machineId);
    if (!machine) return dep;
    const updatedSlots = dep.slots.map((s) => {
      const product = machine.products.find((p) => p.slot === s.slot);
      const currentFlavorId = product?.stockLinks[0]?.stockFlavorId;
      return currentFlavorId ? { ...s, stockFlavorId: currentFlavorId } : s;
    });
    return { ...dep, location: machine.location, slots: updatedSlots };
  });
}

function normalizeSoftServeList(items: Array<Partial<SoftServeProduct> & Product> | undefined) {
  const normalized = items?.length ? items.map((item) => normalizeSoftServeItem(item)) : [];
  return normalized.length ? normalized : [createBlankSoftServeProduct()];
}

function calculateOrder(items: CurrentOrderItem[], paymentMethod: CurrentOrder["paymentMethod"], cashReceivedCents: number): CurrentOrder {
  const normalizedItems = items.map((item) => ({
    ...item,
    quantity: Math.max(0, item.quantity),
    unitPriceGrossCents: item.unitPriceGrossCents ?? 0,
    vatRate: item.vatRate ?? 7,
    lineTotalGrossCents: Math.max(0, item.quantity) * (item.unitPriceGrossCents ?? 0)
  }));
  const totalGrossCents = normalizedItems.reduce((sum, item) => sum + item.lineTotalGrossCents, 0);
  const vatCents = normalizedItems.reduce((sum, item) => {
    const tax = calculateTaxFromGross(item.lineTotalGrossCents, item.vatRate);
    item.vatCents = tax.taxAmountCents;
    return sum + tax.taxAmountCents;
  }, 0);

  return {
    items: normalizedItems,
    paymentMethod,
    cashReceivedCents,
    totalGrossCents,
    vatCents,
    changeDueCents: paymentMethod === "cash" ? cashReceivedCents - totalGrossCents : 0
  };
}

function createCompletedOrder(
  order: CurrentOrder,
  shiftId: string,
  orderNumber: number,
  bookedAt: string,
  machineLookup: Map<string, Machine>
): DailyOrder {
  const orderId = createId("order");
  const items = order.items.map((item) =>
    snapshotBookedOrderItem(item, {
      shiftId,
      orderId,
      paymentMethod: order.paymentMethod,
      bookedAt,
      machineLookup
    })
  );

  return {
    id: orderId,
    shiftId,
    orderNumber,
    bookedAt,
    createdAt: bookedAt,
    status: "completed",
    items,
    paymentMethod: order.paymentMethod,
    cashReceivedCents: order.cashReceivedCents,
    changeDueCents: order.paymentMethod === "cash" ? order.cashReceivedCents - order.totalGrossCents : 0,
    paidAmountCents: order.paymentMethod === "cash" ? order.cashReceivedCents : order.totalGrossCents,
    totalGrossCents: order.totalGrossCents,
    totalVatCents: order.vatCents,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0)
  };
}

function createCorrectionOrder({
  originalOrder,
  items,
  orderNumber,
  correctedAt,
  correctionReason
}: {
  originalOrder: DailyOrder;
  items: Array<{ item: CurrentOrderItem; quantity: number }>;
  orderNumber: number;
  correctedAt: string;
  correctionReason?: string;
}): DailyOrder {
  const orderId = createId("correction");
  const correctionItems = items.map(({ item, quantity }) => {
    const unitGrossCents = item.unitGrossCents ?? item.grossPriceCents ?? item.unitPriceGrossCents;
    const correctionQuantity = -Math.abs(quantity);
    const grossTotalCents = correctionQuantity * unitGrossCents;
    const tax = calculateTaxFromGross(grossTotalCents, item.taxRateAtBooking ?? item.vatRate);
    const originalItemId = item.itemId ?? item.id;

    return {
      ...item,
      id: createId("correction_item"),
      shiftId: originalOrder.shiftId,
      orderId,
      itemId: createId("correction_item_ref"),
      originalOrderId: originalOrder.id,
      originalItemId,
      correctionReason,
      correctedAt,
      quantity: correctionQuantity,
      unitGrossCents,
      unitPriceGrossCents: unitGrossCents,
      grossPriceCents: unitGrossCents,
      lineTotalGrossCents: grossTotalCents,
      grossTotalCents,
      netTotalCents: tax.netCents,
      taxAmountCents: tax.taxAmountCents,
      vatCents: tax.taxAmountCents,
      paymentMethod: item.paymentMethod ?? originalOrder.paymentMethod,
      bookedAt: correctedAt
    };
  });
  const totalGrossCents = correctionItems.reduce((sum, item) => sum + item.lineTotalGrossCents, 0);
  const totalVatCents = correctionItems.reduce((sum, item) => sum + (item.taxAmountCents ?? item.vatCents ?? 0), 0);

  return {
    id: orderId,
    shiftId: originalOrder.shiftId,
    orderNumber,
    bookedAt: correctedAt,
    createdAt: correctedAt,
    status: "correction",
    originalOrderId: originalOrder.id,
    correctionReason,
    correctedAt,
    items: correctionItems,
    paymentMethod: originalOrder.paymentMethod,
    cashReceivedCents: 0,
    changeDueCents: 0,
    paidAmountCents: totalGrossCents,
    totalGrossCents,
    totalVatCents,
    totalQuantity: correctionItems.reduce((sum, item) => sum + item.quantity, 0)
  };
}

function snapshotBookedOrderItem(
  item: CurrentOrderItem,
  context: {
    shiftId: string;
    orderId: string;
    paymentMethod: CurrentOrder["paymentMethod"];
    bookedAt: string;
    machineLookup: Map<string, Machine>;
  }
): CurrentOrderItem {
  const { shiftId, orderId, paymentMethod, bookedAt, machineLookup } = context;
  const grossTotalCents = item.lineTotalGrossCents;
  const tax = calculateTaxFromGross(grossTotalCents, item.vatRate);
  const packageNameAtBooking = item.packageNameAtBooking ?? formatPackageNameAtBooking(item.portionType ?? item.packagingType ?? "Waffel", item.packagingSize ?? "");
  const itemNameAtBooking = item.itemNameAtBooking ?? item.name;
  const machine = item.machineId ? machineLookup.get(item.machineId) : undefined;
  const machineNameAtBooking =
    item.machineNameAtBooking ??
    machine?.name ??
    (item.machineNumber ? `MASCHINE ${item.machineNumber}` : "MASCHINE");
  const machineDisplayNameAtBooking =
    item.machineDisplayNameAtBooking ??
    (machine ? formatMachineDisplayName(machine.name, machine.number) : formatMachineDisplayName(machineNameAtBooking, item.machineNumber));
  const machineLocationAtBooking = item.machineLocationAtBooking ?? machine?.location;
  const unitGrossCents = item.unitGrossCents ?? item.grossPriceCents ?? item.unitPriceGrossCents;

  return {
    ...item,
    shiftId,
    orderId,
    itemId: item.itemId ?? item.id,
    itemNameAtBooking,
    machineNameAtBooking,
    machineDisplayNameAtBooking,
    machineLocationAtBooking,
    portionType: item.portionType ?? item.packagingType ?? "Waffel",
    packageNameAtBooking,
    unitGrossCents,
    recipeProductId: item.recipeProductId ?? resolveRecipeProductId(item) ?? undefined,
    portionGrams: item.portionGrams,
    unitPriceGrossCents: unitGrossCents,
    grossPriceCents: unitGrossCents,
    grossTotalCents,
    netTotalCents: tax.netCents,
    taxAmountCents: tax.taxAmountCents,
    taxRateAtBooking: item.taxRateAtBooking ?? item.vatRate,
    vatCents: tax.taxAmountCents,
    lineTotalGrossCents: grossTotalCents,
    paymentMethod,
    bookedAt
  };
}

function formatPackageNameAtBooking(packagingType: PackagingType, packagingSize: string) {
  const trimmedSize = packagingSize.trim();
  return trimmedSize ? `${packagingType} ${trimmedSize}` : packagingType;
}

function isMixSaleProduct(product: Pick<SoftServeProduct, "slot">) {
  return product.slot === "MIX";
}

function getEffectiveStockLinks(product: SoftServeProduct, siblingProducts: SoftServeProduct[]) {
  if (!isMixSaleProduct(product)) {
    return product.stockLinks;
  }

  const fallbackLinks = getMixSourceProducts(siblingProducts)
    .map((item) => item.stockLinks[0])
    .filter((link): link is StockLink => Boolean(link?.stockFlavorId))
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
    .filter((item) => !isMixSaleProduct(item))
    .filter((item, index, all) => all.findIndex((candidate) => candidate.stockLinks[0]?.stockFlavorId === item.stockLinks[0]?.stockFlavorId) === index)
    .slice(0, 2);
}

function buildConsumptionEntriesFromOrder(
  order: Pick<CurrentOrder, "items">,
  shiftId: string,
  orderId: string,
  createdAt: string,
  machines: Machine[] = [],
  portionWeights: Record<PackagingType, number> = defaultPortionWeights,
  stockFlavors: Record<string, import("./types").StockFlavor> = {}
): ConsumptionEntry[] {
  const productLookup = new Map(flattenMachineProducts(machines).map((product) => [product.id, product] as const));
  const siblingProductsLookup = new Map(machines.flatMap((machine) => machine.products.map((product) => [product.id, machine.products] as const)));

  return order.items.flatMap((item): ConsumptionEntry[] => {
    const sourceProductName = withoutMachinePrefix(
      item.productId === "topping" ? item.toppingName ?? item.itemNameAtBooking ?? item.name : item.itemNameAtBooking ?? item.name
    );
    const product = productLookup.get(item.productId);
    const stockLinks = product ? getEffectiveStockLinks(product, siblingProductsLookup.get(product.id) ?? [product]) : [];
    const packagingType = item.portionType ?? item.packagingType ?? product?.packagingType ?? "Waffel";
    const portionWeightGrams = item.portionGrams && item.portionGrams > 0
      ? item.portionGrams
      : (() => {
          if (stockLinks.length === 1) {
            const fw = stockFlavors[stockLinks[0].stockFlavorId]?.portionWeights?.[packagingType];
            if (fw && fw > 0) return fw;
          }
          return portionWeights[packagingType] ?? defaultPortionWeights[packagingType] ?? 160;
        })();

    if (item.productId !== "topping" && stockLinks.length && portionWeightGrams > 0) {
      return stockLinks.map((link) => ({
        id: createId("consumption"),
        shiftId,
        orderId,
        productId: link.stockFlavorId,
        productName: sourceProductName,
        sourceProductId: item.productId,
        sourceProductName,
        inventoryItemId: softMixInventoryItemId,
        inventoryItemName: "Softeis-Mix Liter",
        quantity: item.quantity * (portionWeightGrams * link.ratio) / 1000,
        packagingType,
        packagingSize: item.packagingSize ?? "",
        recipeProductId: link.stockFlavorId,
        portionGrams: portionWeightGrams,
        createdAt
      }));
    }

    const recipeProductId = resolveRecipeProductId(item);
    const recipe = recipeProductId ? recipes[recipeProductId] : undefined;
    const recipeEntries = Object.entries(recipe ?? {}) as [InventoryItemId, number][];

    if (!recipeEntries.length) {
      return [
        {
          id: createId("consumption"),
          shiftId,
          orderId,
          productId: item.productId,
          productName: sourceProductName,
          sourceProductId: item.productId,
          sourceProductName,
          quantity: item.quantity,
          packagingType: item.portionType ?? item.packagingType ?? "Waffel",
          packagingSize: item.packagingSize ?? "",
          recipeProductId: recipeProductId ?? undefined,
          portionGrams: item.portionGrams,
          createdAt
        }
      ];
    }

    return recipeEntries.map(([inventoryItemId, quantityPerItem]) => {
      const inventoryItemName = inventoryItems.find((entry) => entry.id === inventoryItemId)?.name ?? inventoryItemId;

      return {
        id: createId("consumption"),
        shiftId,
        orderId,
        productId: item.productId,
        productName: sourceProductName,
        sourceProductId: item.productId,
        sourceProductName,
        inventoryItemId,
        inventoryItemName,
        quantity: item.quantity * quantityPerItem,
        packagingType: item.portionType ?? item.packagingType ?? "Waffel",
        packagingSize: item.packagingSize ?? "",
        recipeProductId: recipeProductId ?? undefined,
        portionGrams: item.portionGrams,
        createdAt
      };
    });
  });
}

function getStockBlockReasonForOrder(
  order: Pick<CurrentOrder, "items">,
  machines: Machine[],
  mixStocks: MvpState["mixStocks"],
  stockFlavors: MvpState["stockFlavors"],
  portionWeights: MvpState["portionWeights"],
  consumptionEntries: ConsumptionEntry[],
  emergencyMode: MvpState["emergencyMode"]
) {
  const productLookup = new Map(flattenMachineProducts(machines).map((product) => [product.id, product] as const));
  const siblingProductsLookup = new Map(machines.flatMap((machine) => machine.products.map((product) => [product.id, machine.products] as const)));
  const requiredLitersByFlavor = new Map<string, number>();
  const consumedLitersByFlavor = consumptionEntries.reduce((acc, entry) => {
    if (entry.inventoryItemId === softMixInventoryItemId && entry.productId) {
      acc[entry.productId] = (acc[entry.productId] ?? 0) + entry.quantity;
    }

    return acc;
  }, {} as Record<ProductId, number>);

  for (const item of order.items) {
    const product = productLookup.get(item.productId);

    if (!product) {
      continue;
    }

    const stockLinks = getEffectiveStockLinks(product, siblingProductsLookup.get(product.id) ?? [product]);

    if (!stockLinks.length) {
      continue;
    }

    const packagingType = item.portionType ?? item.packagingType ?? product.packagingType ?? "Waffel";
    const portionWeightGrams = item.portionGrams && item.portionGrams > 0
      ? item.portionGrams
      : (() => {
          if (stockLinks.length === 1) {
            const fw = stockFlavors[stockLinks[0].stockFlavorId]?.portionWeights?.[packagingType];
            if (fw && fw > 0) return fw;
          }
          return portionWeights[packagingType] ?? defaultPortionWeights[packagingType] ?? 160;
        })();

    for (const link of stockLinks) {
      requiredLitersByFlavor.set(
        link.stockFlavorId,
        (requiredLitersByFlavor.get(link.stockFlavorId) ?? 0) + (item.quantity * portionWeightGrams * link.ratio) / 1000
      );
    }
  }

  const missingNames = [...requiredLitersByFlavor.entries()]
    .map(([stockFlavorId, requiredLiters]) => {
      if (emergencyMode[stockFlavorId] === true) {
        return null;
      }

      const stock = mixStocks[stockFlavorId];
      const flavor = stockFlavors[stockFlavorId];
      const remainingLiters = roundQuantity(
        (stock?.startLiters ?? 0) + (stock?.refilledLiters ?? 0) + (stock?.correctedLiters ?? 0) - (consumedLitersByFlavor[stockFlavorId] ?? 0)
      );

      return remainingLiters >= requiredLiters ? null : flavor?.name ?? stock?.name ?? stockFlavorId;
    })
    .filter((name): name is string => Boolean(name));

  const uniqueMissingNames = [...new Set(missingNames)];

  if (!uniqueMissingNames.length) {
    return "";
  }

  return `Buchung nicht möglich: ${formatNameList(uniqueMissingNames)} ${uniqueMissingNames.length === 1 ? "ist" : "sind"} leer oder nicht ausreichend gefüllt.`;
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

function resolveRecipeProductId(item: CurrentOrderItem): ProductId | null {
  if (item.recipeProductId && recipes[item.recipeProductId]) {
    return item.recipeProductId;
  }

  if (item.productId === "topping") {
    return "topping";
  }

  const structuredSize = resolveStructuredPortionSize(item);

  if (structuredSize) {
    return `soft_${structuredSize}`;
  }

  return resolveLegacyRecipeProductId(item);
}

function resolveStructuredPortionSize(item: CurrentOrderItem): "small" | "medium" | "large" | null {
  const portionGrams = item.portionGrams;

  if (typeof portionGrams === "number" && portionGrams > 0) {
    if (portionGrams <= 140) {
      return "small";
    }

    if (portionGrams <= 210) {
      return "medium";
    }

    return "large";
  }

  const sizeToken = normalizeSizeToken(item.packagingSize);

  if (!sizeToken) {
    return null;
  }

  if (sizeToken === "klein" || sizeToken === "small") {
    return "small";
  }

  if (sizeToken === "mittel" || sizeToken === "medium") {
    return "medium";
  }

  if (sizeToken === "gross" || sizeToken === "large") {
    return "large";
  }

  const numericSize = parsePackagingSizeNumber(sizeToken);

  if (numericSize === null) {
    return null;
  }

  if (numericSize <= 130) {
    return "small";
  }

  if (numericSize <= 180) {
    return "medium";
  }

  return "large";
}

function resolveLegacyRecipeProductId(item: CurrentOrderItem): ProductId | null {
  const descriptor = `${item.packageNameAtBooking ?? item.packagingSize ?? ""}`.trim().toLowerCase();

  if (descriptor.includes("120") || descriptor.includes("klein") || descriptor.includes("small")) {
    return "soft_small";
  }

  if (descriptor.includes("160") || descriptor.includes("mittel") || descriptor.includes("medium")) {
    return "soft_medium";
  }

  if (descriptor.includes("200") || descriptor.includes("gross") || descriptor.includes("groß") || descriptor.includes("large")) {
    return "soft_large";
  }

  return recipes[item.productId] ? item.productId : null;
}

function normalizeSizeToken(value: string | undefined) {
  return value
    ?.trim()
    .toLowerCase()
    .replace("ß", "ss")
    .replace(/\s+/g, " ") ?? "";
}

function parsePackagingSizeNumber(value: string) {
  const match = value.match(/\d+(?:[,.]\d+)?/);

  if (!match) {
    return null;
  }

  const parsed = Number(match[0].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function getNextMachineNumber(machines: Machine[]) {
  const usedNumbers = new Set(machines.map((machine) => Number(machine.number)).filter(Number.isFinite));
  let nextNumber = 1;

  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }

  return nextNumber;
}

function normalizeCompletedOrder(
  order: Partial<DailyOrder>,
  index: number,
  shiftIdFallback?: string,
  machineLookup?: Map<string, Machine>
): DailyOrder {
  const shiftId = typeof order.shiftId === "string" && order.shiftId.trim()
    ? order.shiftId
    : shiftIdFallback ?? "legacy-shift";
  const bookedAt = typeof order.bookedAt === "string" && order.bookedAt.trim()
    ? order.bookedAt
    : typeof order.createdAt === "string" && order.createdAt.trim()
      ? order.createdAt
      : new Date().toISOString();
  const orderId = normalizeOrderId(order.id, `completed_order_${index + 1}`);
  const paymentMethod = order.paymentMethod ?? "cash";
  const items = (order.items ?? []).map((item) =>
    normalizeBookedOrderItem(item, {
      shiftId,
      orderId,
      paymentMethod,
      bookedAt,
      machineLookup
    })
  );

  return {
    id: orderId,
    shiftId,
    orderNumber: typeof order.orderNumber === "number" ? order.orderNumber : index + 1,
    bookedAt,
    createdAt: typeof order.createdAt === "string" && order.createdAt.trim() ? order.createdAt : bookedAt,
    status: order.status === "correction" ? "correction" : "completed",
    originalOrderId: order.originalOrderId,
    originalItemId: order.originalItemId,
    correctionReason: order.correctionReason,
    correctedAt: order.correctedAt,
    items,
    paymentMethod,
    cashReceivedCents: order.cashReceivedCents ?? 0,
    changeDueCents:
      typeof order.changeDueCents === "number"
        ? order.changeDueCents
        : paymentMethod === "cash"
          ? (order.cashReceivedCents ?? 0) - items.reduce((sum, item) => sum + item.lineTotalGrossCents, 0)
          : 0,
    paidAmountCents:
      typeof order.paidAmountCents === "number"
        ? order.paidAmountCents
        : paymentMethod === "cash"
          ? (order.cashReceivedCents ?? 0)
          : items.reduce((sum, item) => sum + item.lineTotalGrossCents, 0),
    totalGrossCents: items.reduce((sum, item) => sum + item.lineTotalGrossCents, 0),
    totalVatCents: items.reduce((sum, item) => sum + (item.taxAmountCents ?? item.vatCents ?? 0), 0),
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0)
  };
}

function normalizeBookedOrderItem(
  item: Partial<CurrentOrderItem>,
  context?: {
    shiftId?: string;
    orderId?: string;
    paymentMethod?: CurrentOrder["paymentMethod"];
    bookedAt?: string;
    machineLookup?: Map<string, Machine>;
  }
): CurrentOrderItem {
  const quantity = item.quantity ?? 0;
  const unitGrossCents = item.unitGrossCents ?? item.grossPriceCents ?? item.unitPriceGrossCents ?? 0;
  const lineTotalGrossCents = item.grossTotalCents ?? item.lineTotalGrossCents ?? quantity * unitGrossCents;
  const vatRate = item.taxRateAtBooking ?? item.vatRate ?? 7;
  const tax = calculateTaxFromGross(lineTotalGrossCents, vatRate);
  const machineNumber = item.machineNumber ?? undefined;
  const machine = context?.machineLookup?.get(item.machineId ?? "");
  const machineNameAtBooking =
    item.machineNameAtBooking ??
    machine?.name ??
    (machineNumber ? `MASCHINE ${machineNumber}` : undefined);
  const machineDisplayNameAtBooking =
    item.machineDisplayNameAtBooking ??
    (machine ? formatMachineDisplayName(machine.name, machine.number) : machineNameAtBooking ? formatMachineDisplayName(machineNameAtBooking, machineNumber) : undefined);
  const machineLocationAtBooking = item.machineLocationAtBooking ?? machine?.location;
  const portionType = item.portionType ?? item.packagingType ?? "Waffel";
  const packagingSize = item.packagingSize ?? "";
  const packageNameAtBooking = item.packageNameAtBooking ?? formatPackageNameAtBooking(portionType, packagingSize);

  return {
    id: normalizeOrderId(item.id, "order_item"),
    shiftId: item.shiftId ?? context?.shiftId,
    orderId: item.orderId ?? context?.orderId,
    itemId: item.itemId ?? item.id ?? undefined,
    originalOrderId: item.originalOrderId,
    originalItemId: item.originalItemId,
    correctionReason: item.correctionReason,
    correctedAt: item.correctedAt,
    sortId: item.sortId ?? item.id ?? undefined,
    productId: item.productId ?? "unknown",
    machineId: item.machineId,
    machineNumber,
    machineNameAtBooking,
    machineDisplayNameAtBooking,
    machineLocationAtBooking,
    name: item.name ?? item.itemNameAtBooking ?? "",
    itemNameAtBooking: item.itemNameAtBooking ?? item.name ?? "",
    packagingType: item.packagingType ?? portionType,
    packagingSize,
    portionType,
    packageNameAtBooking,
    quantity,
    unitGrossCents,
    recipeProductId: item.recipeProductId ?? resolveRecipeProductId({
      id: item.id ?? "order_item",
      productId: item.productId ?? "unknown",
      name: item.name ?? item.itemNameAtBooking ?? "",
      packagingType: item.packagingType ?? portionType,
      packagingSize,
      portionType,
      quantity,
      unitPriceGrossCents: unitGrossCents,
      vatRate,
      lineTotalGrossCents
    }) ?? undefined,
    portionGrams: item.portionGrams,
    unitPriceGrossCents: unitGrossCents,
    grossPriceCents: unitGrossCents,
    vatRate,
    taxRateAtBooking: item.taxRateAtBooking ?? vatRate,
    parentProductId: item.parentProductId,
    toppingName: item.toppingName,
    lineTotalGrossCents,
    grossTotalCents: lineTotalGrossCents,
    netTotalCents: tax.netCents,
    taxAmountCents: tax.taxAmountCents,
    vatCents: tax.taxAmountCents,
    paymentMethod: item.paymentMethod ?? context?.paymentMethod,
    bookedAt: item.bookedAt ?? context?.bookedAt
  };
}

function transactionsFromOrders(orders: DailyOrder[]): SaleTransaction[] {
  return orders.flatMap((order) => {
    const paymentKind: PaymentKind = order.paymentMethod === "cash" ? "cash" : "card";

    return order.items.flatMap((item) => {
      const unitGrossCents = item.unitGrossCents ?? item.grossPriceCents ?? item.unitPriceGrossCents;
      const quantitySign = item.quantity < 0 ? -1 : 1;
      const signedUnitGrossCents = quantitySign * unitGrossCents;
      const unitTax = calculateTaxFromGross(signedUnitGrossCents, item.taxRateAtBooking ?? item.vatRate);

      return Array.from({ length: Math.abs(item.quantity) }, (_, index) => ({
        id: `${order.id}_${item.id}_${index}`,
        shiftId: item.shiftId ?? order.shiftId,
        orderId: item.orderId ?? order.id,
        itemId: item.itemId ?? item.id,
        originalOrderId: item.originalOrderId ?? order.originalOrderId,
        originalItemId: item.originalItemId ?? order.originalItemId,
        correctionReason: item.correctionReason ?? order.correctionReason,
        correctedAt: item.correctedAt ?? order.correctedAt,
        productId: item.productId,
        sortId: item.sortId ?? item.id,
        itemNameAtBooking: item.itemNameAtBooking ?? item.name,
        machineNameAtBooking: item.machineNameAtBooking,
        machineDisplayNameAtBooking: item.machineDisplayNameAtBooking,
        machineLocationAtBooking: item.machineLocationAtBooking,
        packageNameAtBooking: item.packageNameAtBooking,
        portionType: item.portionType ?? item.packagingType,
        unitGrossCents,
        recipeProductId: item.recipeProductId,
        portionGrams: item.portionGrams,
        grossPriceCents: unitGrossCents,
        grossTotalCents: signedUnitGrossCents,
        netTotalCents: unitTax.netCents,
        taxAmountCents: unitTax.taxAmountCents,
        taxRateAtBooking: item.taxRateAtBooking ?? item.vatRate,
        toppingId: item.productId === "topping" ? item.id : undefined,
        toppingName: item.toppingName,
        parentProductId: item.parentProductId,
        paymentKind,
        paymentMethod: item.paymentMethod ?? order.paymentMethod,
        quantity: quantitySign as 1 | -1,
        amountCents: unitGrossCents,
        vatRate: item.vatRate,
        bookedAt: item.bookedAt ?? order.bookedAt ?? order.createdAt,
        createdAt: item.bookedAt ?? order.bookedAt ?? order.createdAt
      }));
    });
  });
}

function getRemainingCorrectableQuantity(orders: DailyOrder[], originalOrderId: string, originalItemId: string) {
  const originalOrder = orders.find((order) => order.id === originalOrderId && order.status !== "correction");
  const originalItem = originalOrder?.items.find((item) => (item.itemId ?? item.id) === originalItemId);
  const originalQuantity = originalItem?.quantity ?? 0;
  const correctedQuantity = orders
    .filter((order) => order.status === "correction" && order.originalOrderId === originalOrderId)
    .flatMap((order) => order.items)
    .filter((item) => item.originalItemId === originalItemId)
    .reduce((sum, item) => sum + Math.abs(Math.min(0, item.quantity)), 0);

  return Math.max(0, originalQuantity - correctedQuantity);
}

function getActiveOrder(state: MvpState) {
  return state.openOrders.find((order) => order.id === state.activeOrderId) ?? state.currentOrder;
}

function syncActiveOrder(state: MvpState, nextOrder: CurrentOrder): MvpState {
  const activeOrderIndex = state.openOrders.findIndex((order) => order.id === state.activeOrderId);
  const normalized = normalizeOpenOrder(
    {
      ...nextOrder,
      id: nextOrder.id ?? state.activeOrderId,
      title: nextOrder.title ?? state.openOrders.find((order) => order.id === state.activeOrderId)?.title ?? "Bestellung 1"
    },
    activeOrderIndex >= 0 ? activeOrderIndex : 0
  );
  const nextOpenOrders =
    activeOrderIndex >= 0
      ? state.openOrders.map((order) => (order.id === state.activeOrderId ? normalized : order))
      : [...state.openOrders, normalized];

  return {
    ...state,
    currentOrder: normalized,
    openOrders: nextOpenOrders
  };
}

function replaceActiveOrder(state: MvpState, update: (order: CurrentOrder) => CurrentOrder): MvpState {
  const activeOrder = getActiveOrder(state);
  const nextOrder = update(activeOrder);
  return syncActiveOrder(state, nextOrder);
}

function updateOpenOrdersState(state: MvpState, openOrders: CurrentOrder[], activeOrderId?: string): MvpState {
  const nextActiveOrderId = activeOrderId && openOrders.some((order) => order.id === activeOrderId)
    ? activeOrderId
    : openOrders[0]?.id ?? "order_1";
  const nextActiveOrder = openOrders.find((order) => order.id === nextActiveOrderId) ?? openOrders[0];

  return {
    ...state,
    openOrders,
    activeOrderId: nextActiveOrderId,
    currentOrder: nextActiveOrder ?? createBlankOrder("order_1", "Bestellung 1")
  };
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function readStoredString(key: string, fallback: string) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);

  if (raw == null) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" && parsed.trim() ? parsed : fallback;
  } catch {
    return raw.trim() ? raw : fallback;
  }
}

function readStoredState(): MvpState {
  if (typeof window === "undefined") {
    return initialState;
  }

  try {
    const stored = readJson<Partial<MvpState>>(storageKey, {});
    const storedMachines = readJson<MvpState["machines"] | null>(machinesStorageKey, null);
    const rawMachines = (storedMachines?.length ? storedMachines : stored.machines ?? []) as Array<Partial<Machine> & { id: string }>;
    const stockFlavors = buildStockFlavorsFromMachines(rawMachines, (stored as Partial<MvpState>).stockFlavors);
    const normalizedMachines = rawMachines.map((machine) => normalizeMachine(machine, stockFlavors));
    const machineLookup = new Map(normalizedMachines.map((machine) => [machine.id, machine] as const));
    const validMachineIdSet = new Set(normalizedMachines.map((m) => m.id));
    const storedCurrentOrder = readJson<CurrentOrder | null>(currentOrderStorageKey, null);
    const storedOpenOrders = readJson<Array<Partial<CurrentOrder>> | null>(openOrdersStorageKey, null);
    const storedActiveOrderId = readStoredString(activeOrderIdStorageKey, "");
    const storedDailySales = readJson<MvpState["dailySales"] | null>(dailySalesStorageKey, null);
    const storedCompletedOrders = readJson<MvpState["completedOrders"] | null>(completedOrdersStorageKey, null);
    const rawActiveShift = stored.activeShift as Shift | null | undefined;
    const storedActiveShift: Shift | null | undefined = rawActiveShift
      ? {
          ...rawActiveShift,
          deploymentMachines: syncDeploymentFromMachines(
            normalizeDeploymentMachines(rawActiveShift.deploymentMachines, validMachineIdSet),
            normalizedMachines
          )
        }
      : rawActiveShift;
    const openOrders = createInitialOpenOrders(storedCurrentOrder, stored.currentOrder as CurrentOrder | null | undefined, storedOpenOrders);
    const activeOrderId = storedActiveOrderId && openOrders.some((order) => order.id === storedActiveOrderId)
      ? storedActiveOrderId
      : openOrders[0].id ?? "order_1";
    const activeOrder = openOrders.find((order) => order.id === activeOrderId) ?? openOrders[0];
    const completedOrdersSource = storedCompletedOrders
      ?? (stored.completedOrders as DailyOrder[] | undefined)
      ?? storedDailySales?.orders
      ?? stored.dailySales?.orders
      ?? [];
    const completedOrders = completedOrdersSource.map((order, index) =>
      normalizeCompletedOrder(order, index, storedActiveShift?.id, machineLookup)
    );
    const dailySalesOrders = (storedDailySales?.orders ?? stored.dailySales?.orders ?? []).map((order, index) =>
      normalizeCompletedOrder(order, index, storedActiveShift?.id, machineLookup)
    );

    const migratedState = {
      ...initialState,
      ...stored,
      productConfigVersion: 4,
      currentOrder: activeOrder,
      openOrders,
      activeOrderId,
      dailySales: {
        orders: dailySalesOrders
      },
      completedOrders,
      consumptionEntries: Array.isArray((stored as Partial<MvpState>).consumptionEntries)
        ? ((stored as Partial<MvpState>).consumptionEntries as ConsumptionEntry[])
        : completedOrders.flatMap((order) => buildConsumptionEntriesFromOrder(
            order,
            order.shiftId,
            order.id,
            order.bookedAt,
            normalizedMachines,
            {
              ...defaultPortionWeights,
              ...(stored as Partial<MvpState>).portionWeights
            },
            stockFlavors
          )),
      mixStocks: {
        ...(stored as Partial<MvpState>).mixStocks
      },
      stockFlavors,
      portionWeights: {
        ...defaultPortionWeights,
        ...(stored as Partial<MvpState>).portionWeights
      },
      inventory: {
        ...createInitialInventory(),
        ...stored.inventory
      },
      machines: normalizedMachines.length ? normalizedMachines : [],
      softServeItems: stored.softServeItems?.length
        ? normalizeSoftServeList(stored.softServeItems)
        : [createBlankSoftServeProduct()],
      aromas: stored.aromas?.length ? stored.aromas : defaultAromas,
      packagingSizes: {
        ...defaultPackagingSizes,
        ...stored.packagingSizes
      },
      productSettings: {
        ...defaultProductSettings,
        ...stored.productSettings
      },
      salesLayout: stored.salesLayout?.length ? stored.salesLayout : defaultSalesLayout,
      toppings: Array.isArray(stored.toppings) ? stored.toppings : defaultToppings,
      emergencyMode: stored.emergencyMode && typeof stored.emergencyMode === "object" && !Array.isArray(stored.emergencyMode)
        ? stored.emergencyMode as Record<string, boolean>
        : {},
      emergencyModeLog: Array.isArray(stored.emergencyModeLog)
        ? stored.emergencyModeLog as EmergencyModeEntry[]
        : [],
      mixStockMovements: stored.mixStockMovements && typeof stored.mixStockMovements === "object" && !Array.isArray(stored.mixStockMovements)
        ? stored.mixStockMovements as Record<string, MixStockMovement[]>
        : {},
      recipeTemplates: Array.isArray(stored.recipeTemplates)
        ? stored.recipeTemplates as SoftServeRecipeTemplate[]
        : [],
      generalStock: migrateGeneralStock((stored as Partial<MvpState>).generalStock),
      generalStockMovements: typeof (stored as Partial<MvpState>).generalStockMovements === "object" && (stored as Partial<MvpState>).generalStockMovements !== null
        ? (stored as Partial<MvpState>).generalStockMovements as Record<string, import("./types").GeneralStockMovement[]>
        : {},
      inventoryMovements: typeof (stored as Partial<MvpState>).inventoryMovements === "object" && (stored as Partial<MvpState>).inventoryMovements !== null
        ? (stored as Partial<MvpState>).inventoryMovements as Record<string, import("./types").InventoryMovement[]>
        : {},
      materialCategories: Array.isArray((stored as Partial<MvpState>).materialCategories)
        ? ((stored as Partial<MvpState>).materialCategories as unknown[]).filter(
            (c: unknown) => !["cat_becher", "cat_waffeln", "cat_zubehoer"].includes((c as { id: string }).id)
          ) as import("./types").MaterialCategory[]
        : [],
      materialItems: (() => {
        const raw = (stored as Partial<MvpState>).materialItems;
        if (typeof raw !== "object" || raw === null) return {};
        const LEGACY_IDS = new Set(["mi_cup_small", "mi_cup_medium", "mi_cup_large", "mi_spoon", "mi_napkin"]);
        const result: Record<string, import("./types").MaterialItem> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (!LEGACY_IDS.has(k)) result[k] = v as import("./types").MaterialItem;
        }
        return result;
      })(),
      shiftMaterialAssignments: Array.isArray((stored as Partial<MvpState>).shiftMaterialAssignments)
        ? (stored as Partial<MvpState>).shiftMaterialAssignments as import("./types").ShiftMaterialAssignment[]
        : [],
      sumupSettings: typeof (stored as Partial<MvpState>).sumupSettings === "object" && (stored as Partial<MvpState>).sumupSettings !== null
        ? { enabled: false, paymentLink: "", hintText: "", ...(stored as Partial<MvpState>).sumupSettings } as import("./types").SumupSettings
        : { enabled: false, paymentLink: "", hintText: "" },
      favorites: Array.isArray((stored as Partial<MvpState>).favorites)
        ? (stored as Partial<MvpState>).favorites as string[]
        : [],
      dayReport:
        stored.dayReport && "inventoryReport" in stored.dayReport && "taxReport" in stored.dayReport
          ? normalizeReport(stored.dayReport)
          : null,
      reports: dedupeReportsByShift((stored.reports ?? []).filter(
        (report) => "inventoryReport" in report && "taxReport" in report
      ).map((report) => {
        const normalized = normalizeReport(report);
        return {
          ...normalized,
          shift: {
            ...normalized.shift,
            deploymentMachines: normalizeDeploymentMachines(normalized.shift.deploymentMachines, validMachineIdSet)
          }
        };
      }))
    };

    return migratedState;
  } catch (e) {
    console.error("[readStoredState] CATCH:", e instanceof Error ? e.message : String(e));
    return initialState;
  }
}

function persistState(nextState: MvpState) {
  if (typeof window === "undefined") {
    return;
  }

  if (persistStateLocked) {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(nextState));
  window.localStorage.setItem(machinesStorageKey, JSON.stringify(nextState.machines));
  window.localStorage.setItem(currentOrderStorageKey, JSON.stringify(nextState.currentOrder));
  window.localStorage.setItem(openOrdersStorageKey, JSON.stringify(nextState.openOrders));
  window.localStorage.setItem(activeOrderIdStorageKey, JSON.stringify(nextState.activeOrderId));
  window.localStorage.setItem(dailySalesStorageKey, JSON.stringify(nextState.dailySales));
  window.localStorage.setItem(completedOrdersStorageKey, JSON.stringify(nextState.completedOrders));

  void syncSettingsToCloud(nextState);
  void syncInventoryToCloud(nextState);
  void syncShiftStateToCloud(nextState);
  void syncSalesStateToCloud(nextState);
}

// Wie persistState, aber für Resets: schreibt synchron ins localStorage und
// WARTET auf den Abschluss aller Cloud-Syncs (mit forceOverwrite, ohne Merge),
// damit ein anschließendes window.location.reload() keine alten Cloud-Daten
// mehr zurückholen kann.
async function persistResetState(nextState: MvpState) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(nextState));
  window.localStorage.setItem(machinesStorageKey, JSON.stringify(nextState.machines));
  window.localStorage.setItem(currentOrderStorageKey, JSON.stringify(nextState.currentOrder));
  window.localStorage.setItem(openOrdersStorageKey, JSON.stringify(nextState.openOrders));
  window.localStorage.setItem(activeOrderIdStorageKey, JSON.stringify(nextState.activeOrderId));
  window.localStorage.setItem(dailySalesStorageKey, JSON.stringify(nextState.dailySales));
  window.localStorage.setItem(completedOrdersStorageKey, JSON.stringify(nextState.completedOrders));

  await Promise.all([
    syncSettingsToCloud(nextState, { forceOverwrite: true }),
    syncInventoryToCloud(nextState, { forceOverwrite: true }),
    syncShiftStateToCloud(nextState),
    syncSalesStateToCloud(nextState)
  ]);
}

function createSalesResetState(current: MvpState): MvpState {
  const cleanOrder = createBlankOrder("order_1", "Bestellung 1");

  return {
    ...initialState,
    productConfigVersion: current.productConfigVersion,
    machines: current.machines,
    softServeItems: current.softServeItems,
    stockFlavors: current.stockFlavors,
    portionWeights: current.portionWeights,
    aromas: current.aromas,
    packagingSizes: current.packagingSizes,
    productSettings: current.productSettings,
    salesLayout: current.salesLayout,
    toppings: current.toppings,
    recipeTemplates: current.recipeTemplates,
    inventory: createInitialInventory(),
    currentOrder: cleanOrder,
    openOrders: [cleanOrder],
    activeOrderId: cleanOrder.id ?? "order_1"
  };
}

export function useMvpStore() {
  const [state, setState] = useState<MvpState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const lastBroadcastHashRef = useRef<string | null>(null);

  useEffect(() => {
    const localState = readStoredState();
    setState(localState);
    setHydrated(true);

    void loadSettingsFromCloud().then((cloudSettings) => {
      if (!cloudSettings) {
        return;
      }

      // Nur den machines-Eintrag aus der Cloud übernehmen, wenn er neuer ist als
      // unser letztes lokales Maschinen-Löschen. Schützt vor der Race Condition:
      // Maschine löschen → Reload vor Cloud-Sync-Ende → alte Maschinenliste kommt zurück.
      // Absichtlich auf "machines" beschränkt – andere Settings (softServeItems, Aromen …)
      // sollen immer vom Mac / der Cloud übernommen werden können.
      const machinesLocalAt = window.localStorage.getItem(machinesLocalAtKey);
      const cloudMachinesAt = cloudSettings.machinesWrittenAt;
      const skipMachines = !!(machinesLocalAt && (!cloudMachinesAt || cloudMachinesAt <= machinesLocalAt));

      setState((current) => ({
        ...current,
        machines: skipMachines ? current.machines : (cloudSettings.machines ?? current.machines),
        softServeItems: cloudSettings.softServeItems ?? current.softServeItems,
        stockFlavors: cloudSettings.stockFlavors ?? current.stockFlavors,
        portionWeights: cloudSettings.portionWeights ?? current.portionWeights,
        aromas: cloudSettings.aromas ?? current.aromas,
        packagingSizes: cloudSettings.packagingSizes ?? current.packagingSizes,
        productSettings: cloudSettings.productSettings ?? current.productSettings,
        salesLayout: cloudSettings.salesLayout ?? current.salesLayout,
        toppings: cloudSettings.toppings ?? current.toppings,
        recipeTemplates: cloudSettings.recipeTemplates ?? current.recipeTemplates,
        sumupSettings: cloudSettings.sumupSettings ?? current.sumupSettings,
        favorites: cloudSettings.favorites ?? current.favorites
      }));
    });

    void loadInventoryFromCloud().then((cloudInventory) => {
      if (!cloudInventory) {
        return;
      }

      setState((current) => ({
        ...current,
        inventory: cloudInventory.inventory ?? current.inventory,
        generalStock: cloudInventory.generalStock ?? current.generalStock,
        generalStockMovements: cloudInventory.generalStockMovements ?? current.generalStockMovements,
        inventoryMovements: cloudInventory.inventoryMovements ?? current.inventoryMovements,
        materialCategories: cloudInventory.materialCategories ?? current.materialCategories,
        materialItems: cloudInventory.materialItems ?? current.materialItems,
        shiftMaterialAssignments: cloudInventory.shiftMaterialAssignments ?? current.shiftMaterialAssignments
      }));
    });

    void loadShiftStateFromCloud().then((cloudShift) => {
      if (!cloudShift) {
        return;
      }

      setState((current) => ({
        ...current,
        activeShift: cloudShift.activeShift ?? current.activeShift,
        consumptionEntries: cloudShift.consumptionEntries ?? current.consumptionEntries,
        mixStocks: cloudShift.mixStocks ?? current.mixStocks,
        mixStockMovements: cloudShift.mixStockMovements ?? current.mixStockMovements,
        dayReport: cloudShift.dayReport ?? current.dayReport
      }));
    });

    void loadSalesStateFromCloud().then((cloudSales) => {
      if (!cloudSales) {
        return;
      }

      setState((current) => ({
        ...current,
        currentOrder: cloudSales.currentOrder ?? current.currentOrder,
        openOrders: cloudSales.openOrders ?? current.openOrders,
        activeOrderId: cloudSales.activeOrderId ?? current.activeOrderId,
        dailySales: cloudSales.dailySales ?? current.dailySales,
        completedOrders: cloudSales.completedOrders ?? current.completedOrders,
        transactions: cloudSales.transactions ?? current.transactions,
        dayReport: cloudSales.dayReport ?? current.dayReport
      }));
    });
  }, []);

  // Supabase Realtime: Einstellungen automatisch übernehmen, wenn ein anderes Gerät
  // (z. B. Mac) die Cloud-Settings ändert – ohne Reload des iPad.
  // Scope: nur CloudSettings-Felder (machines, softServeItems, Aromen …).
  // Bewusst ausgeschlossen: activeShift, currentOrder, openOrders, dailySales,
  // completedOrders, transactions – Verkaufs- und Einsatzdaten bleiben lokal.
  useEffect(() => {
    if (!hydrated) return;

    return subscribeToSettingsRealtime((cloudSettings: CloudSettings) => {
      const machinesLocalAt = window.localStorage.getItem(machinesLocalAtKey);
      const cloudMachinesAt = cloudSettings.machinesWrittenAt;
      const skipMachines = !!(machinesLocalAt && (!cloudMachinesAt || cloudMachinesAt <= machinesLocalAt));
      const current = stateRef.current;
      const effectiveMachines = skipMachines ? current.machines : (cloudSettings.machines ?? current.machines);
      const noChange =
        JSON.stringify(effectiveMachines) === JSON.stringify(current.machines) &&
        JSON.stringify(cloudSettings.softServeItems ?? current.softServeItems) === JSON.stringify(current.softServeItems) &&
        JSON.stringify(cloudSettings.stockFlavors ?? current.stockFlavors) === JSON.stringify(current.stockFlavors) &&
        JSON.stringify(cloudSettings.portionWeights ?? current.portionWeights) === JSON.stringify(current.portionWeights) &&
        JSON.stringify(cloudSettings.aromas ?? current.aromas) === JSON.stringify(current.aromas) &&
        JSON.stringify(cloudSettings.packagingSizes ?? current.packagingSizes) === JSON.stringify(current.packagingSizes) &&
        JSON.stringify(cloudSettings.productSettings ?? current.productSettings) === JSON.stringify(current.productSettings) &&
        JSON.stringify(cloudSettings.salesLayout ?? current.salesLayout) === JSON.stringify(current.salesLayout) &&
        JSON.stringify(cloudSettings.toppings ?? current.toppings) === JSON.stringify(current.toppings) &&
        JSON.stringify(cloudSettings.recipeTemplates ?? current.recipeTemplates) === JSON.stringify(current.recipeTemplates) &&
        JSON.stringify(cloudSettings.sumupSettings ?? current.sumupSettings) === JSON.stringify(current.sumupSettings) &&
        JSON.stringify(cloudSettings.favorites ?? current.favorites) === JSON.stringify(current.favorites);
      if (noChange) return;

      setState((c) => ({
        ...c,
        machines: skipMachines ? c.machines : (cloudSettings.machines ?? c.machines),
        softServeItems: cloudSettings.softServeItems ?? c.softServeItems,
        stockFlavors: cloudSettings.stockFlavors ?? c.stockFlavors,
        portionWeights: cloudSettings.portionWeights ?? c.portionWeights,
        aromas: cloudSettings.aromas ?? c.aromas,
        packagingSizes: cloudSettings.packagingSizes ?? c.packagingSizes,
        productSettings: cloudSettings.productSettings ?? c.productSettings,
        salesLayout: cloudSettings.salesLayout ?? c.salesLayout,
        toppings: cloudSettings.toppings ?? c.toppings,
        recipeTemplates: cloudSettings.recipeTemplates ?? c.recipeTemplates,
        sumupSettings: cloudSettings.sumupSettings ?? c.sumupSettings,
        favorites: cloudSettings.favorites ?? c.favorites
      }));
    });
  }, [hydrated]);

  // ── BroadcastChannel: Settings-Updates anderer Tabs/Fenster im selben Browser empfangen ──
  // Kein Reload nötig – Maschinen, Sorten, Preise usw. erscheinen sofort im anderen Tab.
  // Nicht synchronisiert: activeShift, currentOrder, dailySales, completedOrders (Verkaufsdaten).
  useEffect(() => {
    if (!hydrated) return;

    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel("primaq-settings");
      broadcastChannelRef.current = channel;
    } catch {
      return; // BroadcastChannel in manchen Umgebungen nicht verfügbar
    }

    channel.onmessage = (event: MessageEvent<unknown>) => {
      const settings = event.data as CloudSettings;
      if (!settings || typeof settings !== "object") return;

      const machinesLocalAt = window.localStorage.getItem(machinesLocalAtKey);
      const cloudAt = settings.updatedAt;
      const skipMachines = !!(machinesLocalAt && cloudAt && cloudAt <= machinesLocalAt);

      // Vor dem setState prüfen, ob sich tatsächlich etwas ändert (verhindert unnötige
      // persistState-Aufrufe durch Echo-Broadcasts, die identische Daten tragen).
      const current = stateRef.current;
      const effectiveMachines = skipMachines ? current.machines : (settings.machines ?? current.machines);
      const noChange =
        JSON.stringify(effectiveMachines) === JSON.stringify(current.machines) &&
        JSON.stringify(settings.softServeItems ?? current.softServeItems) === JSON.stringify(current.softServeItems) &&
        JSON.stringify(settings.sumupSettings ?? current.sumupSettings) === JSON.stringify(current.sumupSettings) &&
        JSON.stringify(settings.stockFlavors ?? current.stockFlavors) === JSON.stringify(current.stockFlavors);
      if (noChange) return;

      setState((c) => ({
        ...c,
        machines: skipMachines ? c.machines : (settings.machines ?? c.machines),
        softServeItems: settings.softServeItems ?? c.softServeItems,
        stockFlavors: settings.stockFlavors ?? c.stockFlavors,
        portionWeights: settings.portionWeights ?? c.portionWeights,
        aromas: settings.aromas ?? c.aromas,
        packagingSizes: settings.packagingSizes ?? c.packagingSizes,
        productSettings: settings.productSettings ?? c.productSettings,
        salesLayout: settings.salesLayout ?? c.salesLayout,
        toppings: settings.toppings ?? c.toppings,
        recipeTemplates: settings.recipeTemplates ?? c.recipeTemplates,
        sumupSettings: settings.sumupSettings ?? c.sumupSettings,
        favorites: settings.favorites ?? c.favorites
      }));
    };

    return () => {
      channel.close();
      broadcastChannelRef.current = null;
    };
  }, [hydrated]);

  // ── BroadcastChannel: eigene Settings-Änderungen an andere Tabs senden ──
  // Nur senden, wenn sich tatsächlich etwas geändert hat (Hash-Vergleich), damit
  // Verkaufsänderungen (dailySales, completedOrders) keinen unnötigen Broadcast auslösen.
  useEffect(() => {
    if (!hydrated) return;

    const hash = JSON.stringify({
      machines: state.machines,
      softServeItems: state.softServeItems,
      stockFlavors: state.stockFlavors,
      portionWeights: state.portionWeights,
      aromas: state.aromas,
      packagingSizes: state.packagingSizes,
      productSettings: state.productSettings,
      salesLayout: state.salesLayout,
      toppings: state.toppings,
      recipeTemplates: state.recipeTemplates,
      sumupSettings: state.sumupSettings,
      favorites: state.favorites
    });

    if (hash === lastBroadcastHashRef.current) return;
    lastBroadcastHashRef.current = hash;

    const msg: CloudSettings = {
      ...(JSON.parse(hash) as CloudSettings),
      updatedAt: new Date().toISOString()
    };
    broadcastChannelRef.current?.postMessage(msg);
  }, [hydrated, state]);

  // ── visibilitychange: Supabase-Daten beim Tab-Wechsel nachladen ──
  // Sicherheitsnetz für cross-device (Mac → iPad), falls die Realtime-Verbindung
  // kurz unterbrochen war (z. B. Gerät gesperrt / aus dem Standby).
  useEffect(() => {
    if (!hydrated) return;

    const handleVisibilityChange = () => {
      if (document.hidden) return;

      void loadSettingsFromCloud().then((cloudSettings) => {
        if (!cloudSettings) return;

        const machinesLocalAt = window.localStorage.getItem(machinesLocalAtKey);
        const cloudMachinesAt = cloudSettings.machinesWrittenAt;
        const skipMachines = !!(machinesLocalAt && (!cloudMachinesAt || cloudMachinesAt <= machinesLocalAt));

        const current = stateRef.current;
        const effectiveMachines = skipMachines ? current.machines : (cloudSettings.machines ?? current.machines);
        const noChange =
          JSON.stringify(effectiveMachines) === JSON.stringify(current.machines) &&
          JSON.stringify(cloudSettings.softServeItems ?? current.softServeItems) === JSON.stringify(current.softServeItems) &&
          JSON.stringify(cloudSettings.sumupSettings ?? current.sumupSettings) === JSON.stringify(current.sumupSettings);
        if (noChange) return;

        setState((c) => ({
          ...c,
          machines: skipMachines ? c.machines : (cloudSettings.machines ?? c.machines),
          softServeItems: cloudSettings.softServeItems ?? c.softServeItems,
          stockFlavors: cloudSettings.stockFlavors ?? c.stockFlavors,
          portionWeights: cloudSettings.portionWeights ?? c.portionWeights,
          aromas: cloudSettings.aromas ?? c.aromas,
          packagingSizes: cloudSettings.packagingSizes ?? c.packagingSizes,
          productSettings: cloudSettings.productSettings ?? c.productSettings,
          salesLayout: cloudSettings.salesLayout ?? c.salesLayout,
          toppings: cloudSettings.toppings ?? c.toppings,
          recipeTemplates: cloudSettings.recipeTemplates ?? c.recipeTemplates,
          sumupSettings: cloudSettings.sumupSettings ?? c.sumupSettings,
          favorites: cloudSettings.favorites ?? c.favorites
        }));
      });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    try {
      persistState(state);
    } catch {
      // Local storage can fail in private mode or when quota is exceeded. The UI should remain usable.
    }
  }, [hydrated, state]);

  const salesTransactions = useMemo(
    () => state.dailySales.orders.length ? transactionsFromOrders(state.dailySales.orders) : state.transactions,
    [state.dailySales.orders, state.transactions]
  );
  const totals = useMemo(
    () => calculateTotals(salesTransactions, flattenMachineProducts(state.machines)),
    [salesTransactions, state.machines]
  );
  const inventoryReport = useMemo(() => {
    // Only count consumption from the current active shift — old shifts must not bleed into the live stock display.
    const activeShiftId = state.activeShift?.id;
    const shiftConsumptionEntries = activeShiftId
      ? state.consumptionEntries.filter((e) => e.shiftId === activeShiftId)
      : state.consumptionEntries;
    return calculateInventoryReport(totals, state.inventory, shiftConsumptionEntries, state.mixStocks, state.stockFlavors, state.portionWeights, state.emergencyMode, state.machines, state.generalStock);
  }, [state.activeShift?.id, state.consumptionEntries, state.emergencyMode, state.generalStock, state.inventory, state.machines, state.mixStocks, state.portionWeights, state.stockFlavors, totals]);
  const taxReport = useMemo(
    () => calculateTaxReport(salesTransactions, state.productSettings, state.toppings, flattenMachineProducts(state.machines)),
    [salesTransactions, state.machines, state.productSettings, state.toppings]
  );
  const materialCostReport = useMemo((): import("./types").MaterialCostReport => {
    if (!state.activeShift) return { lines: [], totalCostCents: 0 };
    const assignments = state.shiftMaterialAssignments.filter((a) => a.shiftId === state.activeShift!.id);
    const lines: import("./types").MaterialCostLine[] = assignments.map((a) => {
      const item = state.materialItems[a.itemId];
      const consumedQty = a.assignedQty - a.returnedQty - a.lossQty;
      const deductedQty = a.assignedQty - a.returnedQty;
      const purchasePriceCents = item?.purchasePriceCents ?? null;
      const costCents = purchasePriceCents != null ? Math.round(deductedQty * purchasePriceCents) : null;
      return { itemId: a.itemId, itemName: a.itemName, unit: a.unit, assignedQty: a.assignedQty, returnedQty: a.returnedQty, lossQty: a.lossQty, consumedQty, purchasePriceCents, costCents };
    });
    const totalCostCents = lines.reduce((sum, l) => sum + (l.costCents ?? 0), 0);
    return { lines, totalCostCents };
  }, [state.activeShift, state.materialItems, state.shiftMaterialAssignments]);
  const undoInfo = useMemo(() => {
    if (!state.activeShift) return null;
    const shiftOrders = state.completedOrders.filter(
      (order) => order.shiftId === state.activeShift!.id && order.status === "completed"
    );
    if (!shiftOrders.length) return null;
    const lastOrder = shiftOrders.reduce((latest, order) =>
      order.bookedAt > latest.bookedAt ? order : latest
    );
    return {
      order: lastOrder,
      canUndo: !state.dayReport,
      isFinalized: state.dayReport !== null
    };
  }, [state.activeShift, state.completedOrders, state.dayReport]);

  const startShift = useCallback((formData: ShiftFormData) => {
    const shift: Shift = {
      ...formData,
      id: createId("shift"),
      employees: formData.employees.map((employee) => employee.trim()).filter(Boolean).slice(0, 4),
      createdAt: new Date().toISOString()
    };

    setState((current) => {
      const mixStocks = Object.values(current.stockFlavors).filter((flavor) => flavor.active !== false).reduce((acc, flavor) => {
        const startLiters = calculateMixInputLiters(formData.mixStartInputs?.[flavor.id], flavor);

        if (startLiters > 0) {
          const currentLine = acc[flavor.id] ?? createMixStockLine(flavor.id);
          acc[flavor.id] = createMixStockLine(flavor.id, currentLine.startLiters + startLiters, 0, 0, {
            name: flavor.name,
            recipe: flavor.recipe
          });
        }

        return acc;
      }, {} as MvpState["mixStocks"]);

      const now = new Date().toISOString();
      const nextGeneralStock = { ...current.generalStock };
      Object.values(current.stockFlavors)
        .filter((flavor) => flavor.active !== false)
        .forEach((flavor) => {
          const input = formData.mixStartInputs?.[flavor.id];
          if (!input?.value || input.value <= 0) return;

          let packagesNeeded = 0;
          if (input.mode === "packages") {
            packagesNeeded = Math.ceil(input.value);
          } else {
            const batches = input.mode === "batches"
              ? input.value
              : input.value / (flavor.recipe.mixLitersPerBatch || 1);
            const packageKgVal = typeof flavor.recipe.packageKg === "number" && flavor.recipe.packageKg > 0
              ? flavor.recipe.packageKg
              : flavor.recipe.powderKgPerBatch;
            packagesNeeded = batches > 0 ? Math.ceil(batches * (flavor.recipe.powderKgPerBatch / packageKgVal)) : 0;
          }

          if (packagesNeeded <= 0) return;

          const existing = findGeneralStockItemForFlavor(current.generalStock, flavor.id);
          if (existing) {
            nextGeneralStock[existing.id] = {
              ...existing,
              quantityOnHand: Math.max(0, existing.quantityOnHand - packagesNeeded),
              lastUpdatedAt: now
            };
          }
        });

      // Apply slot assignments to machine products so Verkauf reads the correct flavors.
      // Filter deployments to only those that match an existing machine (prevents synthetic machines).
      const validMachineIds = new Set(current.machines.map((m) => m.id));
      const validDeployments = (formData.deploymentMachines ?? []).filter((d) => validMachineIds.has(d.machineId));
      if (process.env.NODE_ENV !== "production") {
        const extra = (formData.deploymentMachines ?? []).filter((d) => !validMachineIds.has(d.machineId));
        if (extra.length > 0) {
          console.warn("[PrimaQ] startShift: Unbekannte deploymentMachines-IDs ignoriert:", extra.map((d) => d.machineId));
        }
      }

      let nextMachines = current.machines;
      if (validDeployments.length) {
        nextMachines = current.machines.map((machine) => {
          const deployment = validDeployments.find((d) => d.machineId === machine.id);
          if (!deployment?.slots.length) return machine;

          const updatedProducts = machine.products.map((product) => {
            if (product.slot === "MIX") return product;
            const assignment = deployment.slots.find((s) => s.slot === product.slot);
            if (!assignment) return product;
            const flavor = current.stockFlavors[assignment.stockFlavorId];
            return {
              ...product,
              name: flavor?.name || product.name,
              aroma: flavor?.name || product.aroma,
              colorHex: product.colorHex ?? flavor?.colorHex,
              stockLinks: [{ stockFlavorId: assignment.stockFlavorId, ratio: 1 }]
            };
          });

          const location = deployment.location ?? machine.location;
          return normalizeMachine({ ...machine, location, products: updatedProducts }, current.stockFlavors);
        });
      }

      return {
        ...current,
        machines: nextMachines,
        activeShift: shift,
        transactions: [],
        currentOrder: createBlankOrder("order_1", "Bestellung 1"),
        openOrders: [createBlankOrder("order_1", "Bestellung 1")],
        activeOrderId: "order_1",
        dailySales: {
          orders: []
        },
        consumptionEntries: current.consumptionEntries,
        mixStocks,
        mixStockMovements: {},
        inventory: createInitialInventory(),
        generalStock: nextGeneralStock,
        dayReport: null
      };
    });
  }, []);

  const addOrderItem = useCallback((item: Omit<CurrentOrderItem, "quantity" | "lineTotalGrossCents">) => {
    setState((current) => {
      return replaceActiveOrder(current, (order) => {
        const existingItem = order.items.find((orderItem) => orderItem.id === item.id);
        const nextItems = existingItem
          ? order.items.map((orderItem) =>
              orderItem.id === item.id ? { ...orderItem, quantity: orderItem.quantity + 1 } : orderItem
            )
          : [...order.items, { ...item, quantity: 1, lineTotalGrossCents: item.unitPriceGrossCents }];

        return calculateOrder(
          nextItems,
          order.paymentMethod,
          order.cashReceivedCents
        );
      });
    });
  }, []);

  const decrementItemInActiveOpenOrder = useCallback((itemId: string) => {
    setState((current) => {
      return replaceActiveOrder(current, (order) => {
        const nextItems = order.items.flatMap((item) => {
          if (item.id !== itemId) {
            return [item];
          }

          return item.quantity > 1 ? [{ ...item, quantity: item.quantity - 1 }] : [];
        });

        return calculateOrder(
          nextItems,
          order.paymentMethod,
          order.cashReceivedCents
        );
      });
    });
  }, []);

  const incrementItemInActiveOpenOrder = useCallback((itemId: string) => {
    setState((current) =>
      replaceActiveOrder(current, (order) => {
        const existingItem = order.items.find((item) => item.id === itemId);

        if (!existingItem) {
          return order;
        }

        return calculateOrder(
          order.items.map((item) =>
            item.id === itemId ? { ...item, quantity: item.quantity + 1 } : item
          ),
          order.paymentMethod,
          order.cashReceivedCents
        );
      })
    );
  }, []);

  const removeItemFromActiveOpenOrder = useCallback((itemId: string) => {
    setState((current) =>
      replaceActiveOrder(current, (order) =>
        calculateOrder(
          order.items.filter((item) => item.id !== itemId),
          order.paymentMethod,
          order.cashReceivedCents
        )
      )
    );
  }, []);

  const clearActiveOpenOrder = useCallback(() => {
    setState((current) => replaceActiveOrder(current, (order) => calculateOrder([], order.paymentMethod, 0)));
  }, []);

  const deleteActiveOpenOrder = useCallback(() => {
    setState((current) => {
      const activeOrder = getActiveOrder(current);
      const activeIndex = current.openOrders.findIndex((order) => order.id === activeOrder.id);

      if (!activeOrder.id) {
        return current;
      }

      const remainingOrders = current.openOrders.filter((order) => order.id !== activeOrder.id);
      const nextOpenOrders = remainingOrders.length
        ? remainingOrders
        : [createBlankOrder("order_1", "Bestellung 1")];
      const nextActiveOrder =
        remainingOrders[activeIndex] ??
        remainingOrders[activeIndex - 1] ??
        remainingOrders[0] ??
        nextOpenOrders[0];

      return updateOpenOrdersState(
        current,
        nextOpenOrders,
        nextActiveOrder?.id
      );
    });
  }, []);

  const decrementOrderItem = decrementItemInActiveOpenOrder;
  const removeOrderItem = removeItemFromActiveOpenOrder;
  const clearCurrentOrder = clearActiveOpenOrder;

  const setOrderPaymentMethod = useCallback((paymentMethod: CurrentOrder["paymentMethod"]) => {
    setState((current) =>
      replaceActiveOrder(current, (order) =>
        calculateOrder(
          order.items,
          paymentMethod,
          paymentMethod === "cash" ? order.cashReceivedCents : 0
        )
      )
    );
  }, []);

  const setOrderCashReceived = useCallback((cashReceivedCents: number) => {
    setState((current) =>
      replaceActiveOrder(current, (order) => calculateOrder(order.items, order.paymentMethod, cashReceivedCents))
    );
  }, []);

  const addOpenOrder = useCallback(() => {
    setState((current) => {
      const maxOrderNumber = current.openOrders.reduce((max, order) => {
        const match = order.title?.match(/(\d+)$/);
        const number = match ? Number(match[1]) : NaN;
        return Number.isFinite(number) ? Math.max(max, number) : max;
      }, 0);
      const nextOrder = createBlankOrder(createId("order"), createOrderTitle(maxOrderNumber));

      return {
        ...current,
        openOrders: [...current.openOrders, nextOrder],
        activeOrderId: nextOrder.id ?? current.activeOrderId,
        currentOrder: nextOrder
      };
    });
  }, []);

  const setActiveOrder = useCallback((orderId: string) => {
    setState((current) => {
      const nextOrder = current.openOrders.find((order) => order.id === orderId);

      if (!nextOrder) {
        return current;
      }

      return {
        ...current,
        activeOrderId: orderId,
        currentOrder: nextOrder
      };
    });
  }, []);

  const checkoutCurrentOrder = useCallback(() => {
    setState((current) => {
      const activeOrder = getActiveOrder(current);

      if (!current.activeShift || !activeOrder.items.length) {
        return current;
      }

      if (activeOrder.paymentMethod === "cash" && activeOrder.cashReceivedCents < activeOrder.totalGrossCents) {
        return current;
      }

      const currentShiftEntries = current.activeShift?.id
        ? current.consumptionEntries.filter((e) => e.shiftId === current.activeShift!.id)
        : current.consumptionEntries;
      const stockBlockReason = getStockBlockReasonForOrder(
        activeOrder,
        current.machines,
        current.mixStocks,
        current.stockFlavors,
        current.portionWeights,
        currentShiftEntries,
        current.emergencyMode
      );

      if (stockBlockReason) {
        return current;
      }

      const paymentKind: PaymentKind = activeOrder.paymentMethod === "cash" ? "cash" : "card"; // "qr" → "card" for reporting
      const createdAt = new Date().toISOString();
      const orderNumber = current.completedOrders.filter((order) => order.shiftId === current.activeShift?.id).length + 1;
      const machineLookup = new Map(current.machines.map((machine) => [machine.id, machine] as const));
      const order = createCompletedOrder(activeOrder, current.activeShift.id, orderNumber, createdAt, machineLookup);
      const transactions = transactionsFromOrders([order]).map((transaction) => ({
        ...transaction,
        id: createId("sale"),
        paymentKind
      }));
      const nextConsumptionEntries = buildConsumptionEntriesFromOrder(
        order,
        current.activeShift.id,
        order.id,
        createdAt,
        current.machines,
        current.portionWeights,
        current.stockFlavors
      );
      const remainingOrders = current.openOrders.filter((item) => item.id !== activeOrder.id);
      const nextActiveOrder = remainingOrders[0] ?? createBlankOrder(createId("order"), "Bestellung 1");

      // ── Verpackungsmaterial-Verbrauch buchen ───────────────────────────────
      const materialConsumption = applyMaterialConsumptionForOrder(
        activeOrder.items,
        current.shiftMaterialAssignments,
        current.materialItems,
        current.materialCategories,
        current.activeShift.id,
        1
      );

      return {
        ...current,
        transactions: [...current.transactions, ...transactions],
        dailySales: {
          orders: [order, ...current.dailySales.orders]
        },
        completedOrders: [order, ...current.completedOrders],
        consumptionEntries: [...nextConsumptionEntries, ...current.consumptionEntries],
        shiftMaterialAssignments: materialConsumption.assignments,
        materialItems: materialConsumption.materialItems,
        openOrders: remainingOrders.length ? remainingOrders : [nextActiveOrder],
        activeOrderId: nextActiveOrder.id ?? current.activeOrderId,
        currentOrder: nextActiveOrder,
        dayReport: null
      };
    });
  }, []);

  const undoLastOrder = useCallback(() => {
    setState((current) => {
      if (!current.activeShift || current.dayReport) return current;

      const shiftCompletedOrders = current.completedOrders.filter(
        (order) => order.shiftId === current.activeShift!.id && order.status === "completed"
      );

      if (!shiftCompletedOrders.length) return current;

      const lastOrder = shiftCompletedOrders.reduce((latest, order) =>
        order.bookedAt > latest.bookedAt ? order : latest
      );

      const nextCompletedOrders = current.completedOrders.filter(
        (order) => order.id !== lastOrder.id
      );
      const nextDailySalesOrders = current.dailySales.orders.filter(
        (order) => order.id !== lastOrder.id
      );
      const nextTransactions = current.transactions.filter(
        (t) => t.orderId !== lastOrder.id
      );
      const nextConsumptionEntries = current.consumptionEntries.filter(
        (e) => e.orderId !== lastOrder.id
      );

      const restoredItems: CurrentOrderItem[] = lastOrder.items
        .filter((item) => item.quantity > 0)
        .map((item) => ({
          ...item,
          id: createId("order_item"),
          shiftId: undefined,
          orderId: undefined,
          itemId: undefined,
          originalOrderId: undefined,
          originalItemId: undefined,
          correctionReason: undefined,
          correctedAt: undefined,
          grossTotalCents: undefined,
          netTotalCents: undefined,
          taxAmountCents: undefined,
          vatCents: undefined,
          bookedAt: undefined
        }));

      const restoredOrder = calculateOrder(
        restoredItems,
        lastOrder.paymentMethod,
        lastOrder.cashReceivedCents
      );

      // Verpackungsmaterial-Verbrauch der stornierten Bestellung rückgängig machen
      const undoneMaterialConsumption = applyMaterialConsumptionForOrder(
        lastOrder.items,
        current.shiftMaterialAssignments,
        current.materialItems,
        current.materialCategories,
        current.activeShift.id,
        -1
      );

      const baseState: MvpState = {
        ...current,
        completedOrders: nextCompletedOrders,
        dailySales: { orders: nextDailySalesOrders },
        transactions: nextTransactions,
        consumptionEntries: nextConsumptionEntries,
        shiftMaterialAssignments: undoneMaterialConsumption.assignments,
        materialItems: undoneMaterialConsumption.materialItems,
        dayReport: null
      };

      const activeOrder = getActiveOrder(baseState);

      if (!activeOrder.items.length) {
        return syncActiveOrder(baseState, {
          ...restoredOrder,
          id: activeOrder.id,
          title: activeOrder.title
        });
      }

      const newOrderId = createId("order");
      const newOrderTitle = createOrderTitle(baseState.openOrders.length);
      const newOrder: CurrentOrder = { ...restoredOrder, id: newOrderId, title: newOrderTitle };

      return updateOpenOrdersState(baseState, [...baseState.openOrders, newOrder], newOrderId);
    });
  }, []);

  const activateEmergencyMode = useCallback((stockFlavorId: string, flavorName: string, remainingLiters: number) => {
    setState((current) => ({
      ...current,
      emergencyMode: { ...current.emergencyMode, [stockFlavorId]: true },
      emergencyModeLog: [
        ...current.emergencyModeLog,
        {
          id: createId("emergency"),
          stockFlavorId,
          flavorName,
          remainingLiters,
          activatedAt: new Date().toISOString(),
          shiftId: current.activeShift?.id
        } satisfies EmergencyModeEntry
      ]
    }));
  }, []);

  const addStockCorrection = useCallback((productId: ProductId, liters: number, reason?: string) => {
    if (liters === 0) return;
    setState((current) => {
      const flavor = current.stockFlavors[productId];
      if (!flavor) return current;
      const currentLine = current.mixStocks[flavor.id] ?? createMixStockLine(flavor.id, 0, 0, 0, {
        name: flavor.name, recipe: flavor.recipe
      });
      const movement: MixStockMovement = {
        id: createId("stock_mov"), productId: flavor.id, type: "correction", liters,
        reason, createdAt: new Date().toISOString(), shiftId: current.activeShift?.id
      };
      return {
        ...current,
        mixStocks: {
          ...current.mixStocks,
          [flavor.id]: createMixStockLine(flavor.id, currentLine.startLiters, currentLine.refilledLiters,
            (currentLine.correctedLiters ?? 0) + liters, { name: flavor.name, recipe: flavor.recipe })
        },
        mixStockMovements: {
          ...current.mixStockMovements,
          [flavor.id]: [...(current.mixStockMovements[flavor.id] ?? []), movement]
        },
        dayReport: null
      };
    });
  }, []);

  const setActualStock = useCallback((productId: ProductId, actualLiters: number, reason?: string) => {
    if (actualLiters < 0) return;
    setState((current) => {
      const flavor = current.stockFlavors[productId];
      if (!flavor) return current;
      const stock = current.mixStocks[flavor.id];
      const activeShiftId = current.activeShift?.id;
      const consumedLiters = current.consumptionEntries
        .filter((e) => e.inventoryItemId === softMixInventoryItemId && e.productId === flavor.id && (!activeShiftId || e.shiftId === activeShiftId))
        .reduce((sum, e) => sum + e.quantity, 0);
      const currentRemaining = roundQuantity(
        (stock?.startLiters ?? 0) + (stock?.refilledLiters ?? 0) + (stock?.correctedLiters ?? 0) - consumedLiters
      );
      const delta = roundQuantity(actualLiters - currentRemaining);
      if (delta === 0) return current;
      const currentLine = stock ?? createMixStockLine(flavor.id, 0, 0, 0, {
        name: flavor.name, recipe: flavor.recipe
      });
      const movement: MixStockMovement = {
        id: createId("stock_mov"), productId: flavor.id, type: "correction", liters: delta,
        reason: reason ?? `Ist-Bestand neu gesetzt: ${actualLiters} L`,
        createdAt: new Date().toISOString(), shiftId: current.activeShift?.id
      };
      return {
        ...current,
        mixStocks: {
          ...current.mixStocks,
          [flavor.id]: createMixStockLine(flavor.id, currentLine.startLiters, currentLine.refilledLiters,
            (currentLine.correctedLiters ?? 0) + delta, { name: flavor.name, recipe: flavor.recipe })
        },
        mixStockMovements: {
          ...current.mixStockMovements,
          [flavor.id]: [...(current.mixStockMovements[flavor.id] ?? []), movement]
        },
        dayReport: null
      };
    });
  }, []);

  const undoLastStockMovement = useCallback((productId: ProductId) => {
    setState((current) => {
      const flavor = current.stockFlavors[productId];
      if (!flavor) return current;
      const movements = current.mixStockMovements[flavor.id] ?? [];
      if (!movements.length) return current;
      const last = movements[movements.length - 1];
      if (last.type === "start") {
        const activeShiftId = current.activeShift?.id;
        const consumed = current.consumptionEntries
          .filter((e) => e.inventoryItemId === softMixInventoryItemId && e.productId === flavor.id && (!activeShiftId || e.shiftId === activeShiftId))
          .reduce((sum, e) => sum + e.quantity, 0);
        if (consumed > 0) return current;
      }
      const nextMovements = movements.slice(0, -1);
      const line = current.mixStocks[flavor.id] ?? createMixStockLine(flavor.id, 0, 0, 0);
      let nextStart = line.startLiters;
      let nextRefill = line.refilledLiters;
      let nextCorrection = line.correctedLiters ?? 0;
      if (last.type === "start") {
        const prevStart = [...nextMovements].reverse().find((m) => m.type === "start");
        nextStart = prevStart ? prevStart.liters : 0;
      } else if (last.type === "initial" || last.type === "initial_plus" || last.type === "correction_initial") {
        nextStart = roundQuantity(nextStart - last.liters);
      } else if (last.type === "initial_minus") {
        nextStart = roundQuantity(nextStart + last.liters);
      } else if (last.type === "refill" || last.type === "refill_plus" || last.type === "correction_refill") {
        nextRefill = roundQuantity(nextRefill - last.liters);
      } else if (last.type === "refill_minus") {
        nextRefill = roundQuantity(nextRefill + last.liters);
      } else {
        nextCorrection = roundQuantity(nextCorrection - last.liters);
      }
      return {
        ...current,
        mixStocks: {
          ...current.mixStocks,
          [flavor.id]: createMixStockLine(flavor.id, nextStart, nextRefill, nextCorrection, {
            name: line.name, recipe: line.recipe
          })
        },
        mixStockMovements: {
          ...current.mixStockMovements,
          [flavor.id]: nextMovements
        },
        dayReport: null
      };
    });
  }, []);

  const resetStockFlavor = useCallback((productId: ProductId) => {
    setState((current) => {
      const flavor = current.stockFlavors[productId];

      if (!flavor) return current;

      const activeShiftId = current.activeShift?.id;
      const nextMixStocks = { ...current.mixStocks };
      const nextMixStockMovements = { ...current.mixStockMovements };
      const nextEmergencyMode = { ...current.emergencyMode };

      delete nextMixStocks[flavor.id];
      delete nextMixStockMovements[flavor.id];
      delete nextEmergencyMode[flavor.id];

      return {
        ...current,
        mixStocks: nextMixStocks,
        mixStockMovements: nextMixStockMovements,
        emergencyMode: nextEmergencyMode,
        consumptionEntries: current.consumptionEntries.filter((entry) => {
          if (entry.productId !== flavor.id) {
            return true;
          }

          return activeShiftId ? entry.shiftId !== activeShiftId : false;
        }),
        dayReport: null
      };
    });
  }, []);

  const cancelCompletedOrder = useCallback((orderId: string, correctionReason?: string) => {
    setState((current) => {
      const originalOrder = current.completedOrders.find((order) => order.id === orderId && order.status !== "correction");

      if (!originalOrder) {
        return current;
      }

      const correctionItems = originalOrder.items
        .map((item) => ({
          item,
          quantity: getRemainingCorrectableQuantity(current.completedOrders, originalOrder.id, item.itemId ?? item.id)
        }))
        .filter(({ quantity }) => quantity > 0);

      if (!correctionItems.length) {
        return current;
      }

      const correctedAt = new Date().toISOString();
      const orderNumber = current.completedOrders.filter((order) => order.shiftId === originalOrder.shiftId).length + 1;
      const correctionOrder = createCorrectionOrder({
        originalOrder,
        items: correctionItems,
        orderNumber,
        correctedAt,
        correctionReason: correctionReason?.trim() || "Bestellung storniert"
      });
      const correctionTransactions = transactionsFromOrders([correctionOrder]).map((transaction) => ({
        ...transaction,
        id: createId("sale")
      }));
      const correctionConsumptionEntries = buildConsumptionEntriesFromOrder(
        correctionOrder,
        correctionOrder.shiftId,
        correctionOrder.id,
        correctedAt,
        current.machines,
        current.portionWeights,
        current.stockFlavors
      );
      const isActiveShiftCorrection = current.activeShift?.id === correctionOrder.shiftId;

      const materialConsumption = isActiveShiftCorrection
        ? applyMaterialConsumptionForOrder(
            originalOrder.items.flatMap((item) => {
              const corrItem = correctionItems.find(
                (c) => (c.item.itemId ?? c.item.id) === (item.itemId ?? item.id)
              );
              return corrItem ? [{ ...item, quantity: corrItem.quantity }] : [];
            }),
            current.shiftMaterialAssignments,
            current.materialItems,
            current.materialCategories,
            current.activeShift!.id,
            -1
          )
        : null;

      return {
        ...current,
        transactions: [...current.transactions, ...correctionTransactions],
        dailySales: isActiveShiftCorrection
          ? {
              orders: [correctionOrder, ...current.dailySales.orders]
            }
          : current.dailySales,
        completedOrders: [correctionOrder, ...current.completedOrders],
        consumptionEntries: [...correctionConsumptionEntries, ...current.consumptionEntries],
        shiftMaterialAssignments: materialConsumption?.assignments ?? current.shiftMaterialAssignments,
        materialItems: materialConsumption?.materialItems ?? current.materialItems,
        dayReport: isActiveShiftCorrection ? null : current.dayReport
      };
    });
  }, []);

  const cancelCompletedOrderItem = useCallback((orderId: string, itemId: string, correctionReason?: string) => {
    setState((current) => {
      const originalOrder = current.completedOrders.find((order) => order.id === orderId && order.status !== "correction");
      const originalItem = originalOrder?.items.find((item) => (item.itemId ?? item.id) === itemId);

      if (!originalOrder || !originalItem) {
        return current;
      }

      const quantity = getRemainingCorrectableQuantity(current.completedOrders, originalOrder.id, itemId);

      if (quantity <= 0) {
        return current;
      }

      const correctedAt = new Date().toISOString();
      const orderNumber = current.completedOrders.filter((order) => order.shiftId === originalOrder.shiftId).length + 1;
      const correctionOrder = createCorrectionOrder({
        originalOrder,
        items: [{ item: originalItem, quantity }],
        orderNumber,
        correctedAt,
        correctionReason: correctionReason?.trim() || "Position storniert"
      });
      const correctionTransactions = transactionsFromOrders([correctionOrder]).map((transaction) => ({
        ...transaction,
        id: createId("sale")
      }));
      const correctionConsumptionEntries = buildConsumptionEntriesFromOrder(
        correctionOrder,
        correctionOrder.shiftId,
        correctionOrder.id,
        correctedAt,
        current.machines,
        current.portionWeights,
        current.stockFlavors
      );
      const isActiveShiftCorrection = current.activeShift?.id === correctionOrder.shiftId;

      const materialConsumption = isActiveShiftCorrection
        ? applyMaterialConsumptionForOrder(
            [{ ...originalItem, quantity }],
            current.shiftMaterialAssignments,
            current.materialItems,
            current.materialCategories,
            current.activeShift!.id,
            -1
          )
        : null;

      return {
        ...current,
        transactions: [...current.transactions, ...correctionTransactions],
        dailySales: isActiveShiftCorrection
          ? {
              orders: [correctionOrder, ...current.dailySales.orders]
            }
          : current.dailySales,
        completedOrders: [correctionOrder, ...current.completedOrders],
        consumptionEntries: [...correctionConsumptionEntries, ...current.consumptionEntries],
        shiftMaterialAssignments: materialConsumption?.assignments ?? current.shiftMaterialAssignments,
        materialItems: materialConsumption?.materialItems ?? current.materialItems,
        dayReport: isActiveShiftCorrection ? null : current.dayReport
      };
    });
  }, []);

  const addTransaction = useCallback((productId: ProductId, paymentKind: PaymentKind) => {
    const product = flattenMachineProducts(state.machines).find((item) => item.id === productId);

    if (!product || product.visibleInSale === false) {
      return;
    }

    setState((current) => {
      if (!current.activeShift) {
        return current;
      }

      const transaction: SaleTransaction = {
        id: createId("sale"),
        productId,
        paymentKind,
        quantity: paymentKind === "cancel" ? -1 : 1,
        amountCents: product.priceCents,
        vatRate: product.vatRate,
        createdAt: new Date().toISOString()
      };

      return {
        ...current,
        transactions: [...current.transactions, transaction],
        dayReport: null
      };
    });
  }, [state.machines]);

  const addToppingTransaction = useCallback(
    (parentProductId: ProductId, toppingId: string, paymentKind: PaymentKind) => {
      const parentProduct = flattenMachineProducts(state.machines).find((item) => item.id === parentProductId);
      const topping = state.toppings.find((item) => item.id === toppingId);
      const toppingName = topping?.name ?? `Topping ${parentProduct?.name ?? ""}`.trim();
      const toppingPriceCents = topping?.priceCents ?? parentProduct?.toppingPriceCents ?? 0;
      const toppingVatRate = topping?.vatRate ?? parentProduct?.toppingVatRate ?? 0;

      if (!parentProduct?.toppingEnabled && !topping?.active) {
        return;
      }

      setState((current) => {
        if (!current.activeShift) {
          return current;
        }

        const transaction: SaleTransaction = {
          id: createId("sale"),
          productId: "topping",
          toppingId,
          toppingName,
          parentProductId,
          paymentKind,
          quantity: paymentKind === "cancel" ? -1 : 1,
          amountCents: toppingPriceCents,
          vatRate: toppingVatRate,
          createdAt: new Date().toISOString()
        };

        return {
          ...current,
          transactions: [...current.transactions, transaction],
          dayReport: null
        };
      });
    },
    [state.machines, state.toppings]
  );

  const removeLastProductTransaction = useCallback((productId: ProductId) => {
    setState((current) => {
      const index = [...current.transactions]
        .reverse()
        .findIndex((transaction) => transaction.productId === productId);

      if (index === -1) {
        return current;
      }

      const transactionIndex = current.transactions.length - 1 - index;

      return {
        ...current,
        transactions: current.transactions.filter((_, itemIndex) => itemIndex !== transactionIndex),
        dayReport: null
      };
    });
  }, []);

  const createDayReport = useCallback(
    (endCashCents: number) => {
      if (!state.activeShift) {
        return null;
      }

      const report: DayReport = {
        id: createId("report"),
        createdAt: new Date().toISOString(),
        shift: state.activeShift,
        endCashCents,
        cashDifferenceCents: endCashCents - (state.activeShift.startingCashCents + totals.cashCents),
        totals,
        inventoryReport,
        taxReport,
        materialCostReport,
      };

      setState((current) => ({
        ...current,
        dayReport: report,
        reports: dedupeReportsByShift([report, ...current.reports.filter((item) => item.shift.id !== report.shift.id)])
      }));

      return report;
    },
    [inventoryReport, materialCostReport, state.activeShift, taxReport, totals]
  );

  const updateInventoryLine = useCallback((itemId: InventoryItemId, patch: Partial<InventoryLine>) => {
    setState((current) => ({
      ...current,
      inventory: {
        ...current.inventory,
        [itemId]: {
          ...current.inventory[itemId],
          ...patch
        }
      },
      dayReport: null
    }));
  }, []);

  const addInventoryMovement = useCallback((itemId: InventoryItemId, input: {
    type: "receipt" | "deduction";
    quantity: number;
    reason?: string;
    note?: string;
  }) => {
    const now = new Date().toISOString();
    const movId = createId("ivm");
    setState((current) => {
      const existing = current.inventory[itemId];
      if (!existing) return current;
      const currentQty = existing.quantityOnHand ?? 0;
      const isDeduction = input.type === "deduction";
      const actualQty = isDeduction ? Math.min(input.quantity, currentQty) : input.quantity;
      if (actualQty <= 0) return current;
      const movement: import("./types").InventoryMovement = {
        id: movId,
        itemId,
        type: input.type,
        quantity: actualQty,
        date: now.slice(0, 10),
        reason: input.reason,
        note: input.note,
        createdAt: now,
      };
      return {
        ...current,
        inventory: {
          ...current.inventory,
          [itemId]: {
            ...existing,
            quantityOnHand: isDeduction ? currentQty - actualQty : currentQty + actualQty,
          },
        },
        inventoryMovements: {
          ...current.inventoryMovements,
          [itemId]: [...(current.inventoryMovements[itemId] ?? []), movement],
        },
        dayReport: null,
      };
    });
  }, []);

  const addMaterialCategory = useCallback((input: { name: string } | { name: string; type: import("./types").MaterialCategoryType; defaultUnit: string }) => {
    const id = createId("mcat");
    const extra = "type" in input ? { type: input.type, defaultUnit: input.defaultUnit } : {};
    setState((current) => ({
      ...current,
      materialCategories: [...current.materialCategories, { id, name: input.name.trim(), itemIds: [], ...extra }],
    }));
  }, []);

  const renameMaterialCategory = useCallback((catId: string, name: string) => {
    setState((current) => ({
      ...current,
      materialCategories: current.materialCategories.map((c) => c.id === catId ? { ...c, name: name.trim() } : c),
    }));
  }, []);

  const deleteMaterialCategory = useCallback((catId: string) => {
    setState((current) => ({
      ...current,
      materialCategories: current.materialCategories.filter((c) => c.id !== catId),
    }));
  }, []);

  const purgeOrphanedMaterialItems = useCallback(() => {
    setState((current) => {
      const validIds = new Set<string>();
      for (const cat of current.materialCategories) {
        for (const id of cat.itemIds) validIds.add(id);
      }
      const orphanIds = Object.keys(current.materialItems).filter((id) => !validIds.has(id));
      if (orphanIds.length === 0) return current;
      const updatedItems = { ...current.materialItems };
      const updatedMovements = { ...current.inventoryMovements };
      for (const id of orphanIds) {
        delete updatedItems[id];
        delete updatedMovements[id];
      }
      return { ...current, materialItems: updatedItems, inventoryMovements: updatedMovements };
    });
  }, []);

  const addMaterialItem = useCallback((categoryId: string, input: { name: string; description?: string | null; unit: string; purchasePriceCents?: number | null; minQuantity?: number | null; note?: string | null; startQuantity?: number; saleTag?: string; purchaseUnit?: string; itemsPerPurchaseUnit?: number }) => {
    const id = createId("mi");
    const now = new Date().toISOString();
    const startQty = typeof input.startQuantity === "number" && input.startQuantity > 0 ? input.startQuantity : 0;
    const item: import("./types").MaterialItem = {
      id,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      unit: input.unit.trim() || "Stk.",
      quantityOnHand: startQty,
      minQuantity: input.minQuantity ?? null,
      purchasePriceCents: input.purchasePriceCents ?? null,
      note: input.note ?? null,
      active: true,
      createdAt: now,
      saleTag: input.saleTag?.trim() || undefined,
      purchaseUnit: input.purchaseUnit?.trim() || undefined,
      itemsPerPurchaseUnit: input.itemsPerPurchaseUnit && input.itemsPerPurchaseUnit > 0 ? input.itemsPerPurchaseUnit : undefined,
    };
    const movements: import("./types").InventoryMovement[] = startQty > 0 ? [{
      id: createId("mvm"),
      itemId: id,
      type: "receipt",
      quantity: startQty,
      date: now.slice(0, 10),
      reason: "Startbestand",
      createdAt: now,
    }] : [];
    setState((current) => ({
      ...current,
      materialItems: { ...current.materialItems, [id]: item },
      materialCategories: current.materialCategories.map((c) =>
        c.id === categoryId ? { ...c, itemIds: [...c.itemIds, id] } : c
      ),
      ...(movements.length > 0 ? { inventoryMovements: { ...current.inventoryMovements, [id]: movements } } : {}),
    }));
  }, []);

  const updateMaterialItem = useCallback((itemId: string, patch: Partial<import("./types").MaterialItem>) => {
    setState((current) => {
      const item = current.materialItems[itemId];
      if (!item) return current;
      return {
        ...current,
        materialItems: { ...current.materialItems, [itemId]: { ...item, ...patch } },
      };
    });
  }, []);

  const addMaterialItemWithMovement = useCallback((
    categoryId: string,
    itemInput: { name: string; description?: string | null; unit: string; purchasePriceCents?: number | null; minQuantity?: number | null; note?: string | null },
    movementInput: { type: "receipt" | "deduction"; quantity: number; reason?: string; note?: string }
  ) => {
    const id = createId("mi");
    const now = new Date().toISOString();
    const qty = movementInput.type === "receipt" ? movementInput.quantity : 0;
    const item: import("./types").MaterialItem = {
      id,
      name: itemInput.name.trim(),
      description: itemInput.description?.trim() || null,
      unit: itemInput.unit.trim() || "Stk.",
      quantityOnHand: qty,
      minQuantity: itemInput.minQuantity ?? null,
      purchasePriceCents: itemInput.purchasePriceCents ?? null,
      note: itemInput.note ?? null,
      active: true,
      createdAt: now,
    };
    const movement: import("./types").InventoryMovement = {
      id: createId("mvm"),
      itemId: id,
      type: movementInput.type,
      quantity: movementInput.quantity,
      date: now.slice(0, 10),
      reason: movementInput.reason,
      note: movementInput.note,
      createdAt: now,
    };
    setState((current) => ({
      ...current,
      materialItems: { ...current.materialItems, [id]: item },
      materialCategories: current.materialCategories.map((c) =>
        c.id === categoryId ? { ...c, itemIds: [...c.itemIds, id] } : c
      ),
      inventoryMovements: {
        ...current.inventoryMovements,
        [id]: [movement],
      },
    }));
  }, []);

  const addMaterialMovement = useCallback((itemId: string, input: {
    type: "receipt" | "deduction";
    quantity: number;
    reason?: string;
    note?: string;
  }) => {
    const now = new Date().toISOString();
    const movId = createId("mvm");
    setState((current) => {
      const item = current.materialItems[itemId];
      if (!item) return current;
      const currentQty = item.quantityOnHand;
      const isDeduction = input.type === "deduction";
      const actualQty = isDeduction ? Math.min(input.quantity, currentQty) : input.quantity;
      if (actualQty <= 0 && isDeduction) return current;
      if (actualQty <= 0) return current;
      const movement: import("./types").InventoryMovement = {
        id: movId,
        itemId,
        type: input.type,
        quantity: actualQty,
        date: now.slice(0, 10),
        reason: input.reason,
        note: input.note,
        createdAt: now,
      };
      return {
        ...current,
        materialItems: {
          ...current.materialItems,
          [itemId]: { ...item, quantityOnHand: isDeduction ? currentQty - actualQty : currentQty + actualQty },
        },
        inventoryMovements: {
          ...current.inventoryMovements,
          [itemId]: [...(current.inventoryMovements[itemId] ?? []), movement],
        },
      };
    });
  }, []);

  const assignMaterialToShift = useCallback((itemId: string, categoryId: string, qty: number) => {
    setState((current) => {
      if (!current.activeShift) return current;
      const item = current.materialItems[itemId];
      if (!item || qty <= 0) return current;
      if (item.quantityOnHand < qty) return current;
      const shiftId = current.activeShift.id;
      const shiftName = current.activeShift.eventName;
      const now = new Date().toISOString();
      const existingIdx = current.shiftMaterialAssignments.findIndex(
        (a) => a.shiftId === shiftId && a.itemId === itemId
      );
      const isRefill = existingIdx >= 0;
      const updatedAssignments = [...current.shiftMaterialAssignments];
      if (isRefill) {
        updatedAssignments[existingIdx] = {
          ...updatedAssignments[existingIdx],
          assignedQty: updatedAssignments[existingIdx].assignedQty + qty,
        };
      } else {
        updatedAssignments.push({
          id: createId("sma"),
          shiftId,
          categoryId,
          itemId,
          itemName: item.name,
          unit: item.unit,
          assignedQty: qty,
          consumedQty: 0,
          returnedQty: 0,
          lossQty: 0,
          createdAt: now,
        });
      }
      const movement: import("./types").InventoryMovement = {
        id: createId("mvm"),
        itemId,
        type: "assigned_to_shift",
        quantity: qty,
        date: now.slice(0, 10),
        reason: isRefill ? "Nachfüllung (Einsatz)" : "Einsatzzuweisung",
        shiftId,
        shiftName,
        createdAt: now,
      };
      return {
        ...current,
        materialItems: {
          ...current.materialItems,
          [itemId]: { ...item, quantityOnHand: item.quantityOnHand - qty },
        },
        shiftMaterialAssignments: updatedAssignments,
        inventoryMovements: {
          ...current.inventoryMovements,
          [itemId]: [...(current.inventoryMovements[itemId] ?? []), movement],
        },
      };
    });
  }, []);

  const returnMaterialFromShift = useCallback((
    itemId: string,
    returnQty: number,
    lossQty: number,
    lossReason?: string
  ) => {
    setState((current) => {
      if (!current.activeShift) return current;
      const shiftId = current.activeShift.id;
      const shiftName = current.activeShift.eventName;
      const assignmentIdx = current.shiftMaterialAssignments.findIndex(
        (a) => a.shiftId === shiftId && a.itemId === itemId
      );
      if (assignmentIdx < 0) return current;
      const item = current.materialItems[itemId];
      if (!item) return current;
      const now = new Date().toISOString();
      const updatedAssignments = [...current.shiftMaterialAssignments];
      updatedAssignments[assignmentIdx] = {
        ...updatedAssignments[assignmentIdx],
        returnedQty: updatedAssignments[assignmentIdx].returnedQty + returnQty,
        lossQty: updatedAssignments[assignmentIdx].lossQty + lossQty,
        lossReason: lossReason || updatedAssignments[assignmentIdx].lossReason,
      };
      const newMovements: import("./types").InventoryMovement[] = [];
      if (returnQty > 0) {
        newMovements.push({
          id: createId("mvm"),
          itemId,
          type: "returned_from_shift",
          quantity: returnQty,
          date: now.slice(0, 10),
          reason: "Rückgabe aus Einsatz",
          shiftId,
          shiftName,
          createdAt: now,
        });
      }
      if (lossQty > 0) {
        newMovements.push({
          id: createId("mvm"),
          itemId,
          type: "loss",
          quantity: lossQty,
          date: now.slice(0, 10),
          reason: lossReason ?? "Verlust",
          shiftId,
          shiftName,
          createdAt: now,
        });
      }
      return {
        ...current,
        materialItems: {
          ...current.materialItems,
          [itemId]: { ...item, quantityOnHand: item.quantityOnHand + returnQty },
        },
        shiftMaterialAssignments: updatedAssignments,
        inventoryMovements: {
          ...current.inventoryMovements,
          [itemId]: [...(current.inventoryMovements[itemId] ?? []), ...newMovements],
        },
      };
    });
  }, []);

  const updatePortionWeight = useCallback((packagingType: PackagingType, grams: number) => {
    setState((current) => ({
      ...current,
      portionWeights: {
        ...current.portionWeights,
        [packagingType]: Math.max(0, grams)
      },
      dayReport: null
    }));
  }, []);

  const updateSumupSettings = useCallback((patch: Partial<import("./types").SumupSettings>) => {
    setState((current) => ({
      ...current,
      sumupSettings: { ...current.sumupSettings, ...patch }
    }));
  }, []);

  const toggleFavorite = useCallback((productId: string) => {
    setState((current) => ({
      ...current,
      favorites: current.favorites.includes(productId)
        ? current.favorites.filter((id) => id !== productId)
        : [...current.favorites, productId]
    }));
  }, []);

  const setMixStartStock = useCallback((productId: ProductId, input: MixStockInput, reason?: string) => {
    setState((current) => {
      const flavor = current.stockFlavors[productId];

      if (!flavor) return current;

      const liters = calculateMixInputLiters(input, flavor);

      if (liters < 0) return current;

      const currentLine = current.mixStocks[flavor.id] ?? createMixStockLine(flavor.id, 0, 0, 0, {
        name: flavor.name,
        recipe: flavor.recipe
      });
      const movement: MixStockMovement = {
        id: createId("stock_mov"),
        productId: flavor.id,
        type: "start",
        liters,
        reason,
        createdAt: new Date().toISOString(),
        shiftId: current.activeShift?.id
      };

      return {
        ...current,
        mixStocks: {
          ...current.mixStocks,
          [flavor.id]: createMixStockLine(flavor.id, liters, currentLine.refilledLiters, currentLine.correctedLiters ?? 0, {
            name: flavor.name,
            recipe: flavor.recipe
          })
        },
        mixStockMovements: {
          ...current.mixStockMovements,
          [flavor.id]: [...(current.mixStockMovements[flavor.id] ?? []), movement]
        },
        dayReport: null
      };
    });
  }, []);

  const returnPowderToStock = useCallback((flavorId: string, returnPkgs: number) => {
    setState((current) => {
      // Clearing the mix stock entry prevents resetCurrentShift from double-returning
      const { [flavorId]: _cleared, ...restMixStocks } = current.mixStocks;
      const stockItem = returnPkgs > 0 ? findGeneralStockItemForFlavor(current.generalStock, flavorId) : undefined;
      return {
        ...current,
        mixStocks: restMixStocks,
        generalStock: stockItem ? {
          ...current.generalStock,
          [stockItem.id]: {
            ...stockItem,
            quantityOnHand: stockItem.quantityOnHand + returnPkgs,
            lastUpdatedAt: new Date().toISOString()
          }
        } : current.generalStock
      };
    });
  }, []);

  const stepMixStock = useCallback((
    productId: ProductId,
    type: "initial_plus" | "initial_minus" | "refill_plus" | "refill_minus",
    input: MixStockInput
  ) => {
    setState((current) => {
      const flavor = current.stockFlavors[productId];
      if (!flavor) return current;

      const requestedLiters = calculateMixInputLiters(input, flavor);
      if (requestedLiters <= 0) return current;

      const currentLine = current.mixStocks[flavor.id] ?? createMixStockLine(flavor.id, 0, 0, 0, { name: flavor.name, recipe: flavor.recipe });
      const isPlus = type === "initial_plus" || type === "refill_plus";
      const isInitial = type === "initial_plus" || type === "initial_minus";

      // For minus ops store the ACTUAL delta (capped at 0), so undo is always clean.
      const currentBase = isInitial ? currentLine.startLiters : currentLine.refilledLiters;
      const actualLiters = isPlus ? requestedLiters : Math.min(requestedLiters, currentBase);
      if (actualLiters === 0) return current;

      const packageCount = input.mode === "packages" && typeof input.value === "number" && input.value > 0 ? input.value : undefined;
      const movement: MixStockMovement = {
        id: createId("stock_mov"), productId: flavor.id, type,
        liters: actualLiters, packages: isPlus ? packageCount : undefined,
        createdAt: new Date().toISOString(), shiftId: current.activeShift?.id
      };

      let nextStart = currentLine.startLiters;
      let nextRefill = currentLine.refilledLiters;
      let nextGeneralStock = current.generalStock;

      if (type === "initial_plus") {
        const recipe = flavor.recipe;
        const packageKg = typeof recipe.packageKg === "number" && recipe.packageKg > 0 ? recipe.packageKg : recipe.powderKgPerBatch;
        const batches = recipe.mixLitersPerBatch > 0 ? actualLiters / recipe.mixLitersPerBatch : 0;
        const packagesNeeded = batches > 0 ? Math.ceil(batches * (recipe.powderKgPerBatch / packageKg)) : 0;
        if (packagesNeeded > 0) {
          const existing = findGeneralStockItemForFlavor(current.generalStock, flavor.id);
          // Hard block: never allow stock to go negative
          if (existing && existing.quantityOnHand < packagesNeeded) return current;
          if (existing) {
            nextGeneralStock = { ...current.generalStock, [existing.id]: { ...existing, quantityOnHand: Math.max(0, existing.quantityOnHand - packagesNeeded), lastUpdatedAt: new Date().toISOString() } };
          }
        }
        nextStart = roundQuantity(nextStart + actualLiters);
      } else if (type === "initial_minus") {
        nextStart = roundQuantity(nextStart - actualLiters);
      } else if (type === "refill_plus") {
        const recipe = flavor.recipe;
        const packageKg = typeof recipe.packageKg === "number" && recipe.packageKg > 0 ? recipe.packageKg : recipe.powderKgPerBatch;
        const batches = recipe.mixLitersPerBatch > 0 ? actualLiters / recipe.mixLitersPerBatch : 0;
        const packagesNeeded = batches > 0 ? Math.ceil(batches * (recipe.powderKgPerBatch / packageKg)) : 0;
        if (packagesNeeded > 0) {
          const existing = findGeneralStockItemForFlavor(current.generalStock, flavor.id);
          // Hard block: never allow stock to go negative
          if (existing && existing.quantityOnHand < packagesNeeded) return current;
          if (existing) {
            nextGeneralStock = { ...current.generalStock, [existing.id]: { ...existing, quantityOnHand: Math.max(0, existing.quantityOnHand - packagesNeeded), lastUpdatedAt: new Date().toISOString() } };
          }
        }
        nextRefill = roundQuantity(nextRefill + actualLiters);
      } else if (type === "refill_minus") {
        nextRefill = roundQuantity(nextRefill - actualLiters);
      }

      return {
        ...current,
        mixStocks: {
          ...current.mixStocks,
          [flavor.id]: createMixStockLine(flavor.id, nextStart, nextRefill, currentLine.correctedLiters ?? 0, { name: flavor.name, recipe: flavor.recipe })
        },
        mixStockMovements: { ...current.mixStockMovements, [flavor.id]: [...(current.mixStockMovements[flavor.id] ?? []), movement] },
        generalStock: nextGeneralStock,
        dayReport: null
      };
    });
  }, []);


  const addInventoryFlavor = useCallback((flavorInput: InventoryFlavorInput) => {
    const trimmedName = flavorInput.name.trim();

    if (!trimmedName) {
      return;
    }

    setState((current) => {
      const stockKey = createStockFlavorId(trimmedName);
      const existingFlavor = current.stockFlavors[stockKey];
      const recipe = normalizeSoftServeRecipe(flavorInput.recipe);
      const stockProduct = {
        ...createBlankSoftServeProduct(stockKey),
        id: stockKey,
        name: trimmedName,
        aroma: trimmedName,
        recipe
      };
      const addedLiters = calculateMixInputLiters(flavorInput.stockInput, stockProduct);
      const currentLine = current.mixStocks[stockKey] ?? createMixStockLine(stockKey, 0, 0, 0, {
        name: trimmedName,
        recipe
      });
      const newPortionWeights = flavorInput.portionWeights && Object.values(flavorInput.portionWeights).some((v) => v && v > 0)
        ? flavorInput.portionWeights as Record<PackagingType, number>
        : existingFlavor?.portionWeights;

      const baseState = {
        ...current,
        stockFlavors: {
          ...current.stockFlavors,
          [stockKey]: {
            ...existingFlavor,
            id: stockKey,
            name: trimmedName,
            colorHex: flavorInput.colorHex || existingFlavor?.colorHex,
            recipe,
            warningThresholdPortions: Math.max(1, flavorInput.warningThresholdPortions || existingFlavor?.warningThresholdPortions || 20),
            portionWeights: newPortionWeights,
            active: true
          }
        },
        mixStocks: {
          ...current.mixStocks,
          [stockKey]: createMixStockLine(stockKey, currentLine.startLiters + addedLiters, currentLine.refilledLiters, currentLine.correctedLiters ?? 0, {
            name: trimmedName,
            recipe
          })
        },
        dayReport: null
      };

      if (!flavorInput.savePermanent) {
        return baseState;
      }

      const productId = createId("sort");
      const nextProduct = {
        ...createCustomMachineProduct("", "", productId),
        id: productId,
        name: trimmedName,
        aroma: trimmedName,
        stockLinks: [{ stockFlavorId: stockKey, ratio: 1 }],
        recipe,
        colorHex: flavorInput.colorHex,
        visibleInSale: true
      };

      if (baseState.machines.length) {
        const [firstMachine, ...otherMachines] = baseState.machines;
        return {
          ...baseState,
          machines: [
            {
              ...firstMachine,
              products: [
                ...firstMachine.products,
                {
                  ...nextProduct,
                  machineId: firstMachine.id,
                  machineName: firstMachine.name
                }
              ]
            },
            ...otherMachines
          ],
          productConfigVersion: 4
        };
      }

      const machine = createBlankMachine(createId("machine"), "Gelmatic 1", "1");

      return {
        ...baseState,
        machines: [
          {
            ...machine,
            products: [
              {
                ...nextProduct,
                machineId: machine.id,
                machineName: machine.name
              }
            ]
          }
        ],
        productConfigVersion: 4
      };
    });
  }, []);

  const deleteInventoryFlavor = useCallback((flavorId: ProductId, force = false): DeleteInventoryFlavorResult => {
    const flavor = state.stockFlavors[flavorId];

    if (!flavor) {
      return {
        ok: false,
        reason: "missing",
        message: "Diese Lager-Sorte wurde nicht gefunden."
      };
    }

    const isLinkedInSales = state.machines.some((machine) =>
      machine.products.some((product) => product.stockLinks.some((link) => link.stockFlavorId === flavorId))
    );

    if (isLinkedInSales) {
      return {
        ok: false,
        reason: "linked",
        message: "Diese Sorte wird noch im Verkauf verwendet. Bitte zuerst Verkaufsartikel ändern oder deaktivieren."
      };
    }

    const stock = state.mixStocks[flavorId];
    const hasStockMovements =
      Boolean(stock && (stock.startLiters !== 0 || stock.refilledLiters !== 0)) ||
      state.consumptionEntries.some((entry) => entry.productId === flavorId && entry.quantity !== 0);

    if (hasStockMovements && !force) {
      return {
        ok: false,
        reason: "movements",
        message: "Diese Sorte enthält Lagerbewegungen oder Bestand. Wirklich löschen?"
      };
    }

    setState((current) => {
      const currentFlavor = current.stockFlavors[flavorId];

      if (!currentFlavor) {
        return current;
      }

      const currentStock = current.mixStocks[flavorId];
      const currentHasMovements =
        Boolean(currentStock && (currentStock.startLiters !== 0 || currentStock.refilledLiters !== 0)) ||
        current.consumptionEntries.some((entry) => entry.productId === flavorId && entry.quantity !== 0);

      if (currentHasMovements) {
        return {
          ...current,
          stockFlavors: {
            ...current.stockFlavors,
            [flavorId]: {
              ...currentFlavor,
              active: false
            }
          },
          dayReport: null
        };
      }

      const nextStockFlavors = { ...current.stockFlavors };
      const nextMixStocks = { ...current.mixStocks };
      delete nextStockFlavors[flavorId];
      delete nextMixStocks[flavorId];

      return {
        ...current,
        stockFlavors: nextStockFlavors,
        mixStocks: nextMixStocks,
        dayReport: null
      };
    });

    return { ok: true };
  }, [state.consumptionEntries, state.machines, state.mixStocks, state.stockFlavors]);

  const resetCurrentShift = useCallback(() => {
    setState((current) => {
      const now = new Date().toISOString();
      const nextGeneralStock = { ...current.generalStock };

      if (current.activeShift?.id) {
        const shiftEntries = current.consumptionEntries.filter(
          (e) => e.shiftId === current.activeShift!.id
        );

        for (const [flavorId, stock] of Object.entries(current.mixStocks)) {
          const consumedLiters = shiftEntries.reduce((sum, e) => {
            if (e.inventoryItemId !== softMixInventoryItemId || e.productId !== flavorId) return sum;
            return sum + e.quantity;
          }, 0);

          const remainingLiters = Math.max(
            0,
            (stock.startLiters ?? 0) + (stock.refilledLiters ?? 0) + (stock.correctedLiters ?? 0) - consumedLiters
          );

          if (remainingLiters <= 0) continue;

          const recipe = stock.recipe ?? current.stockFlavors[flavorId]?.recipe;
          if (!recipe?.mixLitersPerBatch || recipe.mixLitersPerBatch <= 0) continue;

          const packageKg = typeof recipe.packageKg === "number" && recipe.packageKg > 0
            ? recipe.packageKg
            : recipe.powderKgPerBatch;
          const batches = remainingLiters / recipe.mixLitersPerBatch;
          const packagesToReturn = Math.floor(batches * (recipe.powderKgPerBatch / packageKg));

          if (packagesToReturn <= 0) continue;

          const existing = findGeneralStockItemForFlavor(nextGeneralStock, flavorId);
          if (existing) {
            nextGeneralStock[existing.id] = {
              ...existing,
              quantityOnHand: existing.quantityOnHand + packagesToReturn,
              lastUpdatedAt: now
            };
          }
        }
      }

      // Auto-return any unaccounted material assignments for this shift
      const updatedMaterialItems = { ...current.materialItems };
      const currentShiftId = current.activeShift?.id;
      if (currentShiftId) {
        for (const a of current.shiftMaterialAssignments) {
          if (a.shiftId !== currentShiftId) continue;
          const remaining = a.assignedQty - (a.consumedQty ?? 0) - a.returnedQty - a.lossQty;
          if (remaining > 0) {
            const mi = updatedMaterialItems[a.itemId];
            if (mi) {
              updatedMaterialItems[a.itemId] = {
                ...mi,
                quantityOnHand: mi.quantityOnHand + remaining,
              };
            }
          }
        }
      }

      return {
        ...initialState,
        productConfigVersion: current.productConfigVersion,
        machines: current.machines,
        softServeItems: current.softServeItems,
        stockFlavors: current.stockFlavors,
        portionWeights: current.portionWeights,
        aromas: current.aromas,
        packagingSizes: current.packagingSizes,
        productSettings: current.productSettings,
        salesLayout: current.salesLayout,
        toppings: current.toppings,
        reports: current.reports,
        completedOrders: current.activeShift?.id
          ? current.completedOrders.filter((order) => order.shiftId !== current.activeShift?.id)
          : current.completedOrders,
        consumptionEntries: current.activeShift?.id
          ? current.consumptionEntries.filter((entry) => entry.shiftId !== current.activeShift?.id)
          : current.consumptionEntries,
        mixStocks: {},
        openOrders: [createBlankOrder("order_1", "Bestellung 1")],
        activeOrderId: "order_1",
        currentOrder: createBlankOrder("order_1", "Bestellung 1"),
        generalStock: nextGeneralStock,
        materialCategories: current.materialCategories,
        materialItems: updatedMaterialItems,
        inventoryMovements: current.inventoryMovements,
        shiftMaterialAssignments: current.shiftMaterialAssignments.filter(
          (a) => a.shiftId !== currentShiftId
        ),
      };
    });
  }, []);

  const updateShiftDetails = useCallback((shiftId: string, patch: Partial<ShiftFormData>) => {
    const normalizeShift = (shift: Shift): Shift => ({
      ...shift,
      ...patch,
      employees: patch.employees
        ? patch.employees.map((employee) => employee.trim()).filter(Boolean).slice(0, 4)
        : shift.employees
    });

    setState((current) => ({
      ...current,
      activeShift: current.activeShift?.id === shiftId ? normalizeShift(current.activeShift) : current.activeShift,
      dayReport: current.dayReport?.shift.id === shiftId
        ? {
            ...current.dayReport,
            shift: normalizeShift(current.dayReport.shift)
          }
        : current.dayReport,
      reports: current.reports.map((report) =>
        report.shift.id === shiftId
          ? {
              ...report,
              shift: normalizeShift(report.shift)
            }
          : report
      )
    }));
  }, []);

  const deleteShift = useCallback((shiftId: string) => {
    setState((current) => {
      const activeDeleted = current.activeShift?.id === shiftId;

      return {
        ...current,
        activeShift: activeDeleted ? null : current.activeShift,
        transactions: current.transactions.filter((transaction) => transaction.shiftId !== shiftId),
        currentOrder: activeDeleted ? createBlankOrder("order_1", "Bestellung 1") : current.currentOrder,
        openOrders: activeDeleted ? [createBlankOrder("order_1", "Bestellung 1")] : current.openOrders,
        activeOrderId: activeDeleted ? "order_1" : current.activeOrderId,
        dailySales: {
          orders: current.dailySales.orders.filter((order) => order.shiftId !== shiftId)
        },
        completedOrders: current.completedOrders.filter((order) => order.shiftId !== shiftId),
        consumptionEntries: current.consumptionEntries.filter((entry) => entry.shiftId !== shiftId),
        dayReport: current.dayReport?.shift.id === shiftId ? null : current.dayReport,
        reports: current.reports.filter((report) => report.shift.id !== shiftId)
      };
    });
  }, []);

  const updateProductSettings = useCallback((productId: ProductId, patch: Partial<ProductSettings[ProductId]>) => {
    setState((current) => ({
      ...current,
      productConfigVersion: 4,
      productSettings: {
        ...current.productSettings,
        [productId]: {
          ...current.productSettings[productId],
          ...patch
        }
      },
      dayReport: null
    }));
  }, []);

  const updateSalesLayout = useCallback((salesLayout: ProductId[]) => {
    setState((current) => ({
      ...current,
      productConfigVersion: 4,
      salesLayout
    }));
  }, []);

  const upsertSoftServe = useCallback((product: SoftServeProduct) => {
    setState((current) => ({
      ...current,
      productConfigVersion: 4,
      softServeItems: current.softServeItems.some((item) => item.id === product.id)
        ? current.softServeItems.map((item) => (item.id === product.id ? product : item))
        : [...current.softServeItems, product],
      productSettings: {
        ...current.productSettings,
        [product.id]: current.productSettings[product.id] ?? {
          priceCents: product.priceCents,
          vatRate: 7,
          active: true
        }
      },
      dayReport: null
    }));
  }, []);

  const updateSoftServe = useCallback((productId: ProductId, patch: Partial<SoftServeProduct>) => {
    setState((current) => ({
      ...current,
      productConfigVersion: 4,
      softServeItems: current.softServeItems.map((item) =>
        item.id === productId ? normalizeSoftServeItem({ ...item, ...patch }) : item
      ),
      dayReport: null
    }));
  }, []);

  const deleteSoftServe = useCallback((productId: ProductId) => {
    setState((current) => ({
      ...current,
      softServeItems: (() => {
        const nextItems = current.softServeItems.filter((item) => item.id !== productId);
        return nextItems.length ? nextItems : [createBlankSoftServeProduct()];
      })(),
      dayReport: null
    }));
  }, []);

  const resetProducts = useCallback(() => {
    setState((current) => ({
      ...current,
      productConfigVersion: 4,
      machines: [],
      softServeItems: [createBlankSoftServeProduct()],
      toppings: [],
      dayReport: null
    }));
  }, []);

  // Setzt Verkaufs-/Einsatz-/Lagerdaten zurück (Einstellungen wie Maschinen/Sorten
  // bleiben erhalten). Wartet auf den vollständigen Cloud-Sync, damit ein direkt
  // anschließender Reload (window.location.reload()) keine alten Cloud-Daten
  // (z. B. mixStocks/generalStock) zurückholt.
  const resetSalesData = useCallback(async () => {
    const nextState = createSalesResetState(stateRef.current);
    setState(nextState);
    persistStateLocked = true;

    try {
      await persistResetState(nextState);
    } catch {
      // persistence failure is non-fatal — in-memory reset still follows
    }
    // Lock is intentionally NOT released here.
    // The caller (settings-client) calls window.location.reload() immediately
    // after, which reinitializes the module and resets persistStateLocked to false.
  }, []);

  // Kompletter Werksreset: alle Daten inkl. Einstellungen, Maschinen, Sorten,
  // Mix-/Pulverlagerbestände werden gelöscht. Wartet auf den vollständigen
  // Cloud-Sync (forceOverwrite), bevor der Aufrufer reload() ausführen darf.
  //
  // Reihenfolge ist kritisch:
  // 1. setState(nextState)          — zuerst, damit persistState (useEffect) den
  //    sauberen State schreibt, falls es während des await auslöst.
  // 2. clearAllPrimaqLocalStorage() — entfernt alle Keys sofort
  // 3. await persistResetState()   — schreibt Reset-State in LS + Cloud (forceOverwrite)
  //    Cloud-Datum zurückschreibt (Race Condition verhindert).
  const factoryReset = useCallback(async () => {
    const cleanOrder = createBlankOrder("order_1", "Bestellung 1");
    const nextState: MvpState = {
      ...initialState,
      inventory: createInitialInventory(),
      currentOrder: cleanOrder,
      openOrders: [cleanOrder],
      activeOrderId: cleanOrder.id ?? "order_1",
      softServeItems: [createBlankSoftServeProduct()]
    };

    setState(nextState);
    persistStateLocked = true;
    clearAllPrimaqLocalStorage();

    try {
      await persistResetState(nextState);
    } catch {
      // persistence failure is non-fatal — in-memory reset still follows
    }
    // Lock intentionally NOT released — reload follows immediately and resets the module.
  }, []);

  const addMachine = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(machinesLocalAtKey, new Date().toISOString());
    }
    setState((current) => {
      const nextNumber = getNextMachineNumber(current.machines);

      return {
        ...current,
        productConfigVersion: 4,
        machines: [
          ...current.machines,
          createBlankMachine(createId("machine"), `Gelmatic ${nextNumber}`, String(nextNumber))
        ],
        dayReport: null
      };
    });
  }, []);

  const copyMachine = useCallback((machineId: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(machinesLocalAtKey, new Date().toISOString());
    }
    let copiedMachineName: string | null = null;

    setState((current) => {
      const sourceMachine = current.machines.find((machine) => machine.id === machineId);

      if (!sourceMachine) {
        return current;
      }

      const nextNumber = getNextMachineNumber(current.machines);
      const nextMachineId = createId("machine");
      const nextMachineName = `Gelmatic ${nextNumber}`;
      copiedMachineName = formatMachineDisplayName(nextMachineName, String(nextNumber));
      const copiedMachine: Machine = {
        ...sourceMachine,
        id: nextMachineId,
        number: String(nextNumber),
        name: nextMachineName,
        manualName: false,
        products: sourceMachine.products.map((product) =>
          normalizeSoftServeItem({
            ...product,
            id: createId(`${nextMachineId}_sort`),
            machineId: nextMachineId,
            machineName: nextMachineName
          }, current.stockFlavors)
        )
      };

      return {
        ...current,
        productConfigVersion: 4,
        machines: [...current.machines, copiedMachine],
        dayReport: null
      };
    });

    return copiedMachineName;
  }, []);

  const updateMachine = useCallback((machineId: string, patch: Partial<Machine>) => {
    setState((current) => ({
      ...current,
      productConfigVersion: 4,
      machines: current.machines.map((machine) => {
        if (machine.id !== machineId) {
          return machine;
        }

        const nextMachine = normalizeMachine({ ...machine, ...patch, id: machine.id }, current.stockFlavors);

        return {
          ...nextMachine,
          products: nextMachine.products.map((product) => ({
            ...product,
            machineId: nextMachine.id,
            machineName: nextMachine.name
          }))
        };
      }),
      dayReport: null
    }));
  }, []);

  const updateMachineProduct = useCallback((machineId: string, productId: ProductId, patch: Partial<SoftServeProduct>) => {
    setState((current) => {
      let nextStockFlavors = current.stockFlavors;
      if ("name" in patch || "aroma" in patch) {
        const machine = current.machines.find((m) => m.id === machineId);
        const product = machine?.products.find((p) => p.id === productId);
        if (product && product.slot !== "MIX") {
          const flavorName = getProductStockFlavorName({ ...product, ...patch } as SoftServeProduct);
          if (flavorName) {
            const flavorId = createStockFlavorId(flavorName);
            if (flavorId && !nextStockFlavors[flavorId]) {
              nextStockFlavors = {
                ...current.stockFlavors,
                [flavorId]: {
                  id: flavorId,
                  name: flavorName,
                  colorHex: (patch.colorHex ?? product.colorHex) as string | undefined,
                  recipe: normalizeSoftServeRecipe(product.recipe),
                  warningThresholdPortions: 20,
                  active: true
                }
              };
            }
          }
        }
      }
      return {
        ...current,
        stockFlavors: nextStockFlavors,
        productConfigVersion: 4,
        machines: current.machines.map((machine) =>
          machine.id === machineId
            ? {
                ...machine,
                products: assignProductSlots(machine.products.map((product) =>
                  product.id === productId
                    ? normalizeSoftServeItem({
                        ...product,
                        ...patch,
                        id: product.id,
                        machineId: machine.id,
                        machineName: machine.name,
                        slot: "isMixVariant" in patch ? undefined : product.slot
                      }, nextStockFlavors)
                    : product
                ))
              }
            : machine
        ),
        dayReport: null
      };
    });
  }, []);

  const addMachineProduct = useCallback((machineId: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(machinesLocalAtKey, new Date().toISOString());
    }
    setState((current) => ({
      ...current,
      productConfigVersion: 4,
      machines: current.machines.map((machine) =>
        machine.id === machineId
          ? {
              ...machine,
              products: [
                ...machine.products,
                createCustomMachineProduct(machine.id, machine.name, createId(`${machine.id}_sort`))
              ]
            }
          : machine
      ),
      dayReport: null
    }));
  }, []);

  const showAllMachines = useCallback(() => {
    setState((current) => {
      if (!current.machines.length) return current;
      return {
        ...current,
        machines: current.machines.map((machine) =>
          normalizeMachine(
            {
              ...machine,
              active: true,
              visibleInSale: true,
              products: machine.products.map((product) => ({ ...product, visibleInSale: true }))
            },
            current.stockFlavors
          )
        ),
        dayReport: null
      };
    });
  }, []);

  const deleteMachineProduct = useCallback((machineId: string, productId: ProductId) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(machinesLocalAtKey, new Date().toISOString());
    }
    setState((current) => ({
      ...current,
      productConfigVersion: 4,
      machines: current.machines.map((machine) =>
        machine.id === machineId
          ? {
              ...machine,
              products: machine.products.filter((product) => product.id !== productId)
            }
          : machine
      ),
      dayReport: null
    }));
  }, []);

  const deleteMachine = useCallback((machineId: string) => {
    // Timestamp VOR setState setzen, damit loadSettingsFromCloud() beim nächsten Reload
    // die nun veralteten Cloud-Daten (Maschine noch vorhanden) ignoriert.
    if (typeof window !== "undefined") {
      window.localStorage.setItem(machinesLocalAtKey, new Date().toISOString());
    }
    setState((current) => {
      const nextMachines = current.machines.filter((machine) => machine.id !== machineId);

      return {
        ...current,
        productConfigVersion: 4,
        machines: nextMachines,
        dayReport: null
      };
    });
  }, []);

  const addAroma = useCallback((aroma: string) => {
    const trimmed = aroma.trim();

    if (!trimmed) {
      return;
    }

    setState((current) => ({
      ...current,
      aromas: current.aromas.includes(trimmed) ? current.aromas : [...current.aromas, trimmed]
    }));
  }, []);

  const addPackagingSize = useCallback((packagingType: SoftServeProduct["packagingType"], size: string) => {
    const trimmed = size.trim();

    if (!trimmed) {
      return;
    }

    setState((current) => ({
      ...current,
      packagingSizes: {
        ...current.packagingSizes,
        [packagingType]: current.packagingSizes[packagingType].includes(trimmed)
          ? current.packagingSizes[packagingType]
          : [...current.packagingSizes[packagingType], trimmed]
      }
    }));
  }, []);

  const upsertTopping = useCallback((topping: Topping) => {
    setState((current) => ({
      ...current,
      toppings: current.toppings.some((item) => item.id === topping.id)
        ? current.toppings.map((item) => (item.id === topping.id ? topping : item))
        : [...current.toppings, topping],
      dayReport: null
    }));
  }, []);

  const updateTopping = useCallback((toppingId: string, patch: Partial<Topping>) => {
    setState((current) => ({
      ...current,
      toppings: current.toppings.map((item) => (item.id === toppingId ? { ...item, ...patch } : item)),
      dayReport: null
    }));
  }, []);

  const deleteTopping = useCallback((toppingId: string) => {
    setState((current) => ({
      ...current,
      toppings: current.toppings.filter((item) => item.id !== toppingId),
      dayReport: null
    }));
  }, []);

  const addRecipeTemplate = useCallback((input: {
    name: string;
    powderKgPerBatch: number;
    waterLitersPerBatch: number;
    mixLitersPerBatch: number;
    note?: string;
  }) => {
    const trimmedName = input.name.trim();

    if (!trimmedName || input.mixLitersPerBatch <= 0) {
      return;
    }

    setState((current) => ({
      ...current,
      recipeTemplates: [
        ...current.recipeTemplates,
        {
          id: createId("recipe"),
          name: trimmedName,
          powderKgPerBatch: input.powderKgPerBatch,
          waterLitersPerBatch: input.waterLitersPerBatch,
          mixLitersPerBatch: input.mixLitersPerBatch,
          note: input.note?.trim() || undefined,
          createdAt: new Date().toISOString()
        }
      ]
    }));
  }, []);

  const updateRecipeTemplate = useCallback((id: string, patch: {
    name?: string;
    powderKgPerBatch?: number;
    waterLitersPerBatch?: number;
    mixLitersPerBatch?: number;
    note?: string;
  }) => {
    setState((current) => {
      const template = current.recipeTemplates.find((t) => t.id === id);

      if (!template) {
        return current;
      }

      const updated: SoftServeRecipeTemplate = {
        ...template,
        ...patch,
        name: (patch.name ?? template.name).trim(),
        note: (patch.note ?? template.note)?.trim() || undefined
      };

      const updatedFlavors = { ...current.stockFlavors };
      const updatedMixStocks = { ...current.mixStocks };

      for (const flavorId of Object.keys(updatedFlavors)) {
        const flavor = updatedFlavors[flavorId];

        if (flavor.recipeTemplateId === id) {
          const newRecipe = {
            powderKgPerBatch: updated.powderKgPerBatch,
            waterLitersPerBatch: updated.waterLitersPerBatch,
            mixLitersPerBatch: updated.mixLitersPerBatch,
            packageKg: flavor.recipe.packageKg
          };

          updatedFlavors[flavorId] = { ...flavor, recipe: newRecipe };

          if (updatedMixStocks[flavorId]) {
            updatedMixStocks[flavorId] = { ...updatedMixStocks[flavorId], recipe: newRecipe };
          }
        }
      }

      return {
        ...current,
        recipeTemplates: current.recipeTemplates.map((t) => t.id === id ? updated : t),
        stockFlavors: updatedFlavors,
        mixStocks: updatedMixStocks
      };
    });
  }, []);

  const deleteRecipeTemplate = useCallback((id: string): { ok: true } | { ok: false; message: string } => {
    const usedBy = Object.values(state.stockFlavors).find((f) => f.recipeTemplateId === id);

    if (usedBy) {
      return {
        ok: false,
        message: `Das Rezept wird von der Sorte „${usedBy.name}" verwendet und kann nicht gelöscht werden.`
      };
    }

    setState((current) => ({
      ...current,
      recipeTemplates: current.recipeTemplates.filter((t) => t.id !== id)
    }));

    return { ok: true };
  }, [state.stockFlavors]);

  const assignRecipeTemplateToFlavor = useCallback((flavorId: string, templateId: string | null) => {
    setState((current) => {
      const flavor = current.stockFlavors[flavorId];

      if (!flavor) {
        return current;
      }

      if (templateId === null) {
        return {
          ...current,
          stockFlavors: {
            ...current.stockFlavors,
            [flavorId]: { ...flavor, recipeTemplateId: undefined }
          }
        };
      }

      const template = current.recipeTemplates.find((t) => t.id === templateId);

      if (!template) {
        return current;
      }

      const newRecipe = {
        powderKgPerBatch: template.powderKgPerBatch,
        waterLitersPerBatch: template.waterLitersPerBatch,
        mixLitersPerBatch: template.mixLitersPerBatch,
        packageKg: flavor.recipe.packageKg
      };

      const updatedFlavor = { ...flavor, recipeTemplateId: templateId, recipe: newRecipe };
      const existingLine = current.mixStocks[flavorId];

      return {
        ...current,
        stockFlavors: {
          ...current.stockFlavors,
          [flavorId]: updatedFlavor
        },
        mixStocks: existingLine
          ? { ...current.mixStocks, [flavorId]: { ...existingLine, recipe: newRecipe } }
          : current.mixStocks
      };
    });
  }, []);

  const addGeneralStockItem = useCallback((input: {
    productName: string;
    flavorName: string;
    flavorId?: string;
    manufacturer?: string;
    recipe: import("./types").SoftServeRecipe;
    unit: "Pkg" | "kg" | "Stück";
    initialQuantity?: number;
    minQuantity?: number | null;
    purchasePriceCents?: number | null;
    note?: string;
  }) => {
    const now = new Date().toISOString();
    if (isGenericSoftMixInventoryName(input.flavorName) || isGenericSoftMixInventoryName(input.productName)) {
      return;
    }
    const id = createId("gsi");
    setState((current) => {
      const item: import("./types").GeneralStockItem = {
        id,
        productName: input.productName.trim(),
        flavorName: input.flavorName.trim(),
        flavorId: input.flavorId?.trim() || createStockFlavorId(input.flavorName.trim()),
        manufacturer: input.manufacturer?.trim() || undefined,
        recipe: normalizeSoftServeRecipe(input.recipe),
        unit: input.unit,
        quantityOnHand: Math.max(0, input.initialQuantity ?? 0),
        minQuantity: input.minQuantity ?? null,
        purchasePriceCents: input.purchasePriceCents ?? null,
        note: input.note?.trim() || undefined,
        active: true,
        createdAt: now,
        lastUpdatedAt: now,
      };
      const movements: import("./types").GeneralStockMovement[] = item.quantityOnHand > 0 ? [{
        id: createId("gsm"),
        itemId: id,
        type: "receipt",
        quantity: item.quantityOnHand,
        date: now.slice(0, 10),
        priceCents: input.purchasePriceCents ?? null,
        createdAt: now,
      }] : [];
      return {
        ...current,
        generalStock: { ...current.generalStock, [id]: item },
        generalStockMovements: {
          ...current.generalStockMovements,
          [id]: movements,
        },
      };
    });
  }, []);

  const updateGeneralStockItem = useCallback((id: string, patch: {
    productName?: string;
    flavorName?: string;
    manufacturer?: string;
    recipe?: import("./types").SoftServeRecipe;
    unit?: "Pkg" | "kg" | "Stück";
    minQuantity?: number | null;
    purchasePriceCents?: number | null;
    note?: string;
  }) => {
    const now = new Date().toISOString();
    setState((current) => {
      const existing = current.generalStock[id];
      if (!existing) return current;
      const flavorName = patch.flavorName?.trim() ?? existing.flavorName;
      return {
        ...current,
        generalStock: {
          ...current.generalStock,
          [id]: {
            ...existing,
            productName: patch.productName?.trim() ?? existing.productName,
            flavorName,
            flavorId: patch.flavorName ? createStockFlavorId(flavorName) : existing.flavorId,
            manufacturer: patch.manufacturer !== undefined ? (patch.manufacturer?.trim() || undefined) : existing.manufacturer,
            recipe: patch.recipe ? normalizeSoftServeRecipe(patch.recipe) : existing.recipe,
            unit: patch.unit ?? existing.unit,
            minQuantity: patch.minQuantity !== undefined ? patch.minQuantity : existing.minQuantity,
            purchasePriceCents: patch.purchasePriceCents !== undefined ? patch.purchasePriceCents : existing.purchasePriceCents,
            note: patch.note !== undefined ? (patch.note?.trim() || undefined) : existing.note,
            lastUpdatedAt: now,
          },
        },
      };
    });
  }, []);

  const deactivateGeneralStockItem = useCallback((id: string) => {
    const now = new Date().toISOString();
    setState((current) => {
      const existing = current.generalStock[id];
      if (!existing) return current;
      const hasMovements = (current.generalStockMovements[id]?.length ?? 0) > 0;
      if (!hasMovements) {
        const { [id]: _, ...rest } = current.generalStock;
        return { ...current, generalStock: rest };
      }
      return {
        ...current,
        generalStock: { ...current.generalStock, [id]: { ...existing, active: false, lastUpdatedAt: now } },
      };
    });
  }, []);

  const addGeneralStockReceipt = useCallback((itemId: string, input: {
    quantity: number;
    date: string;
    priceCents?: number | null;
    note?: string;
  }) => {
    const now = new Date().toISOString();
    const movId = createId("gsm");
    setState((current) => {
      const existing = current.generalStock[itemId];
      if (!existing) return current;
      const movement: import("./types").GeneralStockMovement = {
        id: movId,
        itemId,
        type: "receipt",
        quantity: input.quantity,
        date: input.date,
        priceCents: input.priceCents ?? null,
        note: input.note?.trim() || undefined,
        createdAt: now,
      };
      return {
        ...current,
        generalStock: {
          ...current.generalStock,
          [itemId]: {
            ...existing,
            quantityOnHand: existing.quantityOnHand + input.quantity,
            purchasePriceCents: input.priceCents ?? existing.purchasePriceCents,
            lastUpdatedAt: now,
          },
        },
        generalStockMovements: {
          ...current.generalStockMovements,
          [itemId]: [...(current.generalStockMovements[itemId] ?? []), movement],
        },
      };
    });
  }, []);

  const addGeneralStockDeduction = useCallback((itemId: string, input: {
    quantity: number;
    reason?: string;
    note?: string;
  }) => {
    const now = new Date().toISOString();
    const movId = createId("gsm");
    setState((current) => {
      const existing = current.generalStock[itemId];
      if (!existing) return current;
      const actualQty = Math.min(input.quantity, existing.quantityOnHand);
      if (actualQty <= 0) return current;
      const noteText = [input.reason, input.note].filter(Boolean).join(" · ") || undefined;
      const movement: import("./types").GeneralStockMovement = {
        id: movId,
        itemId,
        type: "deduction",
        quantity: actualQty,
        date: now.slice(0, 10),
        note: noteText,
        createdAt: now,
      };
      return {
        ...current,
        generalStock: {
          ...current.generalStock,
          [itemId]: {
            ...existing,
            quantityOnHand: existing.quantityOnHand - actualQty,
            lastUpdatedAt: now,
          },
        },
        generalStockMovements: {
          ...current.generalStockMovements,
          [itemId]: [...(current.generalStockMovements[itemId] ?? []), movement],
        },
      };
    });
  }, []);

  const resetMachineStock = useCallback((machineId: string, withSalesData = false) => {
    setState((current) => {
      const machine = current.machines.find((m) => m.id === machineId);
      if (!machine) return current;

      const flavorIds = new Set<string>();
      const productIds = new Set<string>();
      for (const product of machine.products) {
        if (product.slot === "A" || product.slot === "B") {
          for (const link of product.stockLinks) {
            if (link.stockFlavorId) flavorIds.add(link.stockFlavorId);
          }
        }
        productIds.add(product.id);
      }
      if (!flavorIds.size) return current;

      const activeShiftId = current.activeShift?.id;
      const nextMixStocks = { ...current.mixStocks };
      const nextMixStockMovements = { ...current.mixStockMovements };
      const nextEmergencyMode = { ...current.emergencyMode };

      for (const flavorId of flavorIds) {
        delete nextMixStocks[flavorId];
        delete nextMixStockMovements[flavorId];
        delete nextEmergencyMode[flavorId];
      }

      const base = {
        ...current,
        mixStocks: nextMixStocks,
        mixStockMovements: nextMixStockMovements,
        emergencyMode: nextEmergencyMode,
        consumptionEntries: current.consumptionEntries.filter((entry) => {
          if (!flavorIds.has(entry.productId)) return true;
          return activeShiftId ? entry.shiftId !== activeShiftId : false;
        }),
        dayReport: null,
      };

      if (!withSalesData || !activeShiftId) return base;

      const filteredCompletedOrders = base.completedOrders
        .map((order) => {
          if (order.shiftId !== activeShiftId) return order;
          const remainingItems = order.items.filter((item) => item.machineId !== machineId);
          if (remainingItems.length === order.items.length) return order;
          if (remainingItems.length === 0) return null;
          return {
            ...order,
            items: remainingItems,
            totalQuantity: remainingItems.reduce((s, i) => s + i.quantity, 0),
          };
        })
        .filter((o): o is NonNullable<typeof o> => o !== null);

      const filteredDailySalesOrders = base.dailySales.orders
        .map((order) => {
          if (order.shiftId !== activeShiftId) return order;
          const remainingItems = order.items.filter((item) => item.machineId !== machineId);
          if (remainingItems.length === order.items.length) return order;
          if (remainingItems.length === 0) return null;
          return {
            ...order,
            items: remainingItems,
            totalQuantity: remainingItems.reduce((s, i) => s + i.quantity, 0),
          };
        })
        .filter((o): o is NonNullable<typeof o> => o !== null);

      return {
        ...base,
        transactions: base.transactions.filter(
          (t) => !(productIds.has(t.productId) && t.shiftId === activeShiftId)
        ),
        completedOrders: filteredCompletedOrders,
        dailySales: { ...base.dailySales, orders: filteredDailySalesOrders },
      };
    });
  }, []);

  const reactivateGeneralStockItem = useCallback((id: string) => {
    const now = new Date().toISOString();
    setState((current) => {
      const existing = current.generalStock[id];
      if (!existing) return current;
      return {
        ...current,
        generalStock: { ...current.generalStock, [id]: { ...existing, active: true, lastUpdatedAt: now } },
      };
    });
  }, []);

  const resetFlavorStockOnly = useCallback((productId: ProductId, withConsumption = false) => {
    setState((current) => {
      const flavor = current.stockFlavors[productId];
      if (!flavor) return current;
      const nextMixStocks = { ...current.mixStocks };
      const nextMixStockMovements = { ...current.mixStockMovements };
      const nextEmergencyMode = { ...current.emergencyMode };
      delete nextMixStocks[flavor.id];
      delete nextMixStockMovements[flavor.id];
      delete nextEmergencyMode[flavor.id];
      const activeShiftId = current.activeShift?.id;
      const nextConsumptionEntries = withConsumption && activeShiftId
        ? current.consumptionEntries.filter(
            (e) => !(e.productId === flavor.id && e.shiftId === activeShiftId)
          )
        : current.consumptionEntries;
      return {
        ...current,
        mixStocks: nextMixStocks,
        mixStockMovements: nextMixStockMovements,
        emergencyMode: nextEmergencyMode,
        consumptionEntries: nextConsumptionEntries,
        dayReport: null,
      };
    });
  }, []);

  const updateStockFlavorRecipe = useCallback((flavorId: string, recipe: import("./types").SoftServeRecipe) => {
    setState((current) => {
      const existing = current.stockFlavors[flavorId];
      if (!existing) return current;
      const normalized = normalizeSoftServeRecipe(recipe);
      return {
        ...current,
        stockFlavors: {
          ...current.stockFlavors,
          [flavorId]: { ...existing, recipe: normalized }
        },
        mixStocks: current.mixStocks[flavorId]
          ? { ...current.mixStocks, [flavorId]: { ...current.mixStocks[flavorId], recipe: normalized } }
          : current.mixStocks,
        dayReport: null
      };
    });
  }, []);

  const updateStockFlavorPortionWeights = useCallback((flavorId: string, weights: Partial<Record<PackagingType, number>>) => {
    setState((current) => {
      const existing = current.stockFlavors[flavorId];
      if (!existing) return current;
      return {
        ...current,
        stockFlavors: {
          ...current.stockFlavors,
          [flavorId]: { ...existing, portionWeights: weights as Record<PackagingType, number> }
        }
      };
    });
  }, []);

  return {
    ...state,
    hydrated,
    totals,
    inventoryReport,
    taxReport,
    materialCostReport,
    startShift,
    addOrderItem,
    decrementOrderItem,
    incrementItemInActiveOpenOrder,
    decrementItemInActiveOpenOrder,
    removeOrderItem,
    removeItemFromActiveOpenOrder,
    clearCurrentOrder,
    clearActiveOpenOrder,
    deleteActiveOpenOrder,
    setOrderPaymentMethod,
    setOrderCashReceived,
    addOpenOrder,
    setActiveOrder,
    checkoutCurrentOrder,
    undoLastOrder,
    undoInfo,
    activateEmergencyMode,
    addStockCorrection,
    setActualStock,
    undoLastStockMovement,
    resetStockFlavor,
    cancelCompletedOrder,
    cancelCompletedOrderItem,
    addTransaction,
    addToppingTransaction,
    removeLastProductTransaction,
    createDayReport,
    updateInventoryLine,
    addInventoryMovement,
    addMaterialCategory,
    renameMaterialCategory,
    deleteMaterialCategory,
    purgeOrphanedMaterialItems,
    addMaterialItem,
    addMaterialItemWithMovement,
    updateMaterialItem,
    addMaterialMovement,
    updatePortionWeight,
    updateSumupSettings,
    toggleFavorite,
    setMixStartStock,
    stepMixStock,
    addInventoryFlavor,
    deleteInventoryFlavor,
    upsertSoftServe,
    updateSoftServe,
    deleteSoftServe,
    resetProducts,
    resetSalesData,
    factoryReset,
    addMachine,
    copyMachine,
    updateMachine,
    updateMachineProduct,
    addMachineProduct,
    deleteMachineProduct,
    showAllMachines,
    deleteMachine,
    updateProductSettings,
    updateSalesLayout,
    addAroma,
    addPackagingSize,
    upsertTopping,
    updateTopping,
    deleteTopping,
    addRecipeTemplate,
    updateRecipeTemplate,
    deleteRecipeTemplate,
    assignRecipeTemplateToFlavor,
    resetCurrentShift,
    updateShiftDetails,
    deleteShift,
    addGeneralStockItem,
    updateGeneralStockItem,
    deactivateGeneralStockItem,
    addGeneralStockReceipt,
    addGeneralStockDeduction,
    resetMachineStock,
    reactivateGeneralStockItem,
    resetFlavorStockOnly,
    updateStockFlavorRecipe,
    updateStockFlavorPortionWeights,
    assignMaterialToShift,
    returnMaterialFromShift,
    returnPowderToStock,
  };
}

export const _mvpInternals = {
  buildStockFlavorsFromMachines,
  normalizeMixProductLinks,
  createStockFlavorId,
  findGeneralStockItemForFlavor,
};
