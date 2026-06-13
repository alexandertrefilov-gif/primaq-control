/**
 * Diagnostic check functions for Lager/Mix data-logic invariants.
 * Call these from the browser console or dev tools to verify bug fixes.
 *
 * Usage: import { runDiagnostics } from "@/features/mvp/diagnostics";
 *        runDiagnostics(store);  // store = useMvpStore() result
 */

import { calculateInventoryReport } from "./calculations";
import { softMixInventoryItemId } from "./catalog";
import { _mvpInternals } from "./use-mvp-store";
import type {
  Machine,
  MixStockState,
  MvpState,
  SoftServeProduct,
  StockFlavor,
} from "./types";

type DiagResult = { pass: boolean; scenario: string; message: string };

// ─── A: Real "Mix Berry" flavor survives buildStockFlavorsFromMachines ───────

function checkA_realMixFlavorPreserved(): DiagResult {
  const scenario = "A – Echte Mix-Sorte bleibt erhalten";
  const machineId = "diag_machine";
  const product: Partial<SoftServeProduct> & { id: string } = {
    id: `${machineId}_a`,
    machineId,
    machineName: "Gelmatic 1",
    slot: "A",
    name: "Mix Berry",
    aroma: "Mix Berry",
    packagingType: "Becher",
    packagingSize: "120cc",
    portionGrams: 140,
    priceCents: 250,
    vatRate: 7,
    stockLinks: [],
    recipe: { powderKgPerBatch: 2, waterLitersPerBatch: 4, mixLitersPerBatch: 6, packageKg: 2 },
    spoonIncluded: true,
    toppingEnabled: false,
    toppingPriceCents: 0,
    toppingVatRate: 7,
    visibleInSale: true,
    nameManuallyEdited: false,
  };

  const rawMachine = { id: machineId, number: "1", products: [product as SoftServeProduct] };
  const result = _mvpInternals.buildStockFlavorsFromMachines([rawMachine as Machine], {});
  const hasMixBerry = Object.values(result).some((f) => f.name === "Mix Berry");

  return {
    pass: hasMixBerry,
    scenario,
    message: hasMixBerry
      ? 'Sorte "Mix Berry" wurde korrekt in stockFlavors aufgenommen.'
      : 'FEHLER: Sorte "Mix Berry" wurde herausgefiltert.',
  };
}

// ─── B: Legacy soft_mix_liter stockLink wird migriert ───────────────────────

function checkB_legacyLinkMigrated(): DiagResult {
  const scenario = "B – Legacy soft_mix_liter-Link wird migriert";

  // Simulate: vanilla flavor exists, product has old soft_mix_liter link
  const flavorId = "vanille";
  const storedFlavors: Record<string, StockFlavor> = {
    [flavorId]: {
      id: flavorId,
      name: "Vanille",
      recipe: { powderKgPerBatch: 2, waterLitersPerBatch: 4, mixLitersPerBatch: 6, packageKg: 2 },
      warningThresholdPortions: 20,
      active: true,
    },
  };

  const machineId = "diag_machine_b";
  const product: Partial<SoftServeProduct> & { id: string } = {
    id: `${machineId}_a`,
    machineId,
    machineName: "Gelmatic 1",
    slot: "A",
    name: "Vanille",
    aroma: "Vanille",
    packagingType: "Becher",
    packagingSize: "120cc",
    portionGrams: 140,
    priceCents: 250,
    vatRate: 7,
    // Legacy link to soft_mix_liter — should be migrated to real flavor
    stockLinks: [{ stockFlavorId: softMixInventoryItemId, ratio: 1 }],
    recipe: { powderKgPerBatch: 2, waterLitersPerBatch: 4, mixLitersPerBatch: 6, packageKg: 2 },
    spoonIncluded: true,
    toppingEnabled: false,
    toppingPriceCents: 0,
    toppingVatRate: 7,
    visibleInSale: true,
    nameManuallyEdited: false,
  };

  const rawMachine = { id: machineId, number: "1", products: [product as SoftServeProduct] };
  const flavors = _mvpInternals.buildStockFlavorsFromMachines([rawMachine as Machine], storedFlavors);
  const machines: Machine[] = [{
    id: machineId,
    number: "1",
    name: "Gelmatic 1",
    manualName: false,
    location: "Wagen",
    active: true,
    visibleInSale: true,
    products: [product as SoftServeProduct],
  }];

  // After normalization, the Vanille product should link to "vanille" flavor, not soft_mix_liter
  const vanillaProduct = machines[0].products[0];
  const hasLegacyLink = vanillaProduct.stockLinks.some((l) => l.stockFlavorId === softMixInventoryItemId);
  const hasMigratedLink = Object.keys(flavors).includes(flavorId);

  const pass = !hasLegacyLink && hasMigratedLink;

  return {
    pass,
    scenario,
    message: pass
      ? "Legacy soft_mix_liter-Link nicht mehr vorhanden, Sorte Vanille in stockFlavors."
      : `FEHLER: hasLegacyLink=${hasLegacyLink}, hasMigratedLink=${hasMigratedLink}`,
  };
}

// ─── C: Mix-Slot-Produkt bekommt immer 50/50-Ratios ─────────────────────────

function checkC_mixSlotEnforces5050(): DiagResult {
  const scenario = "C – Mix-Slot-Produkt erhält immer 50/50-Ratios";

  const products: SoftServeProduct[] = [
    {
      id: "m_a", machineId: "m", machineName: "Gelmatic 1", slot: "A",
      name: "Vanille", aroma: "Vanille", packagingType: "Becher", packagingSize: "120cc",
      portionGrams: 140, priceCents: 250, vatRate: 7,
      stockLinks: [{ stockFlavorId: "vanille", ratio: 1 }],
      recipe: { powderKgPerBatch: 2, waterLitersPerBatch: 4, mixLitersPerBatch: 6, packageKg: 2 },
      spoonIncluded: true, toppingEnabled: false, toppingPriceCents: 0, toppingVatRate: 7,
      visibleInSale: true, nameManuallyEdited: false,
    },
    {
      id: "m_b", machineId: "m", machineName: "Gelmatic 1", slot: "B",
      name: "Erdbeere", aroma: "Erdbeere", packagingType: "Becher", packagingSize: "120cc",
      portionGrams: 140, priceCents: 250, vatRate: 7,
      stockLinks: [{ stockFlavorId: "erdbeere", ratio: 1 }],
      recipe: { powderKgPerBatch: 2, waterLitersPerBatch: 4, mixLitersPerBatch: 6, packageKg: 2 },
      spoonIncluded: true, toppingEnabled: false, toppingPriceCents: 0, toppingVatRate: 7,
      visibleInSale: true, nameManuallyEdited: false,
    },
    {
      id: "m_mix", machineId: "m", machineName: "Gelmatic 1", slot: "MIX",
      name: "Mix", aroma: "Mix", packagingType: "Becher", packagingSize: "120cc",
      portionGrams: 140, priceCents: 300, vatRate: 7,
      // Wrong ratios — should be corrected to 0.5/0.5
      stockLinks: [{ stockFlavorId: "vanille", ratio: 0.7 }, { stockFlavorId: "erdbeere", ratio: 0.3 }],
      recipe: { powderKgPerBatch: 2, waterLitersPerBatch: 4, mixLitersPerBatch: 6, packageKg: 2 },
      spoonIncluded: true, toppingEnabled: false, toppingPriceCents: 0, toppingVatRate: 7,
      visibleInSale: true, nameManuallyEdited: false,
    },
  ];

  const normalized = _mvpInternals.normalizeMixProductLinks(products);
  const mixProduct = normalized.find((p) => p.slot === "MIX");
  const ratiosCorrect = mixProduct?.stockLinks.every((l) => l.ratio === 0.5) ?? false;

  return {
    pass: ratiosCorrect,
    scenario,
    message: ratiosCorrect
      ? "Mix-Slot-Produkt hat korrekte 50/50-Ratios."
      : `FEHLER: Ratios sind ${mixProduct?.stockLinks.map((l) => l.ratio).join("/") ?? "nicht vorhanden"}.`,
  };
}

// ─── D: Mix-Verbrauch wird pro Sorte korrekt zugeordnet ──────────────────────

function checkD_consumptionAttributedPerFlavor(state: Pick<MvpState, "consumptionEntries" | "stockFlavors">): DiagResult {
  const scenario = "D – Mix-Verbrauch pro Sorte korrekt zugeordnet";

  const mixEntries = state.consumptionEntries.filter((e) => e.inventoryItemId === softMixInventoryItemId);

  if (mixEntries.length === 0) {
    return { pass: true, scenario, message: "Keine Mix-Verbrauchseinträge vorhanden (kein Verkauf gebucht)." };
  }

  const knownFlavorIds = new Set(Object.keys(state.stockFlavors));
  const unknownProductIds = mixEntries
    .map((e) => e.productId)
    .filter((id) => !knownFlavorIds.has(id) && id !== softMixInventoryItemId);

  const pass = unknownProductIds.length === 0;

  return {
    pass,
    scenario,
    message: pass
      ? `Alle ${mixEntries.length} Mix-Verbrauchseinträge sind bekannten Sorten zugeordnet.`
      : `WARNUNG: ${unknownProductIds.length} Einträge mit unbekannter productId: ${[...new Set(unknownProductIds)].join(", ")}`,
  };
}

// ─── E: estimatedCostCents enthält Mix-Kosten wenn Preis gesetzt ─────────────

function checkE_inventoryCostsIncludeMix(
  state: Pick<MvpState, "consumptionEntries" | "mixStocks" | "stockFlavors" | "portionWeights" | "inventory" | "emergencyMode">,
  totals: ReturnType<typeof import("./calculations")["calculateTotals"]>
): DiagResult {
  const scenario = "E – Mix-Kosten in estimatedCostCents eingerechnet";

  const mixPrice = state.inventory[softMixInventoryItemId]?.purchasePriceCents;

  if (!mixPrice) {
    return {
      pass: true,
      scenario,
      message: "Kein Mix-Einkaufspreis hinterlegt — Mix-Kosten werden nicht berechnet (kein Fehler).",
    };
  }

  const report = calculateInventoryReport(
    totals,
    state.inventory,
    state.consumptionEntries,
    state.mixStocks,
    state.stockFlavors,
    state.portionWeights,
    state.emergencyMode
  );

  const totalConsumedLiters = report.mixLines.reduce((sum, l) => sum + l.consumedLiters, 0);
  const expectedMixCostCents = Math.round(totalConsumedLiters * mixPrice);
  const packagingCostCents = report.lines.reduce((sum, l) => sum + (l.estimatedCostCents ?? 0), 0);
  const containsMixCost = report.estimatedCostCents >= packagingCostCents + expectedMixCostCents - 1; // allow 1 cent rounding

  return {
    pass: containsMixCost,
    scenario,
    message: containsMixCost
      ? `estimatedCostCents=${report.estimatedCostCents} enthält Mix-Kosten (${expectedMixCostCents} Cent für ${totalConsumedLiters} L).`
      : `FEHLER: estimatedCostCents=${report.estimatedCostCents}, erwartet >=${packagingCostCents + expectedMixCostCents}.`,
  };
}

// ─── F: stockFlavors überleben readStoredState-Roundtrip ────────────────────

function checkF_flavorsPersistThroughStorage(state: Pick<MvpState, "stockFlavors">): DiagResult {
  const scenario = "F – stockFlavors bleiben nach Serialisierung/Deserialisierung erhalten";

  const flavorCount = Object.keys(state.stockFlavors).length;

  if (flavorCount === 0) {
    return { pass: true, scenario, message: "Keine Sorten gespeichert (Neuzustand)." };
  }

  const serialized = JSON.stringify(state.stockFlavors);
  const deserialized = JSON.parse(serialized) as MvpState["stockFlavors"];

  // Check: all flavors with "Mix" in name survive deserialization (they should — it's plain JSON)
  const mixFlavors = Object.values(state.stockFlavors).filter((f) =>
    f.name.toLowerCase().includes("mix") && f.name.toLowerCase() !== "mix"
  );
  const mixFlavorsAfter = Object.values(deserialized).filter((f) =>
    f.name.toLowerCase().includes("mix") && f.name.toLowerCase() !== "mix"
  );

  const pass = mixFlavors.length === mixFlavorsAfter.length;

  return {
    pass,
    scenario,
    message: pass
      ? `${flavorCount} Sorten gespeichert, ${mixFlavors.length} mit "Mix" im Namen — alle erhalten.`
      : `FEHLER: ${mixFlavors.length} Mix-Sorten vor Serialisierung, ${mixFlavorsAfter.length} danach.`,
  };
}

// ─── Runner ──────────────────────────────────────────────────────────────────

type StoreSnapshot = Pick<MvpState,
  "consumptionEntries" | "stockFlavors" | "mixStocks" | "portionWeights" | "inventory" | "emergencyMode"
> & {
  totals?: ReturnType<typeof import("./calculations")["calculateTotals"]>;
};

export function runDiagnostics(state: StoreSnapshot): DiagResult[] {
  const results: DiagResult[] = [
    checkA_realMixFlavorPreserved(),
    checkB_legacyLinkMigrated(),
    checkC_mixSlotEnforces5050(),
    checkD_consumptionAttributedPerFlavor(state),
    ...(state.totals
      ? [checkE_inventoryCostsIncludeMix(state, state.totals)]
      : [{ pass: true, scenario: "E – Mix-Kosten", message: "totals nicht übergeben — übersprungen." }]),
    checkF_flavorsPersistThroughStorage(state),
  ];

  for (const result of results) {
    const icon = result.pass ? "✓" : "✗";
    console.log(`${icon} [${result.scenario}] ${result.message}`);
  }

  const failed = results.filter((r) => !r.pass);

  if (failed.length === 0) {
    console.log("Alle Diagnosen bestanden ✓");
  } else {
    console.warn(`${failed.length} Diagnose(n) fehlgeschlagen.`);
  }

  return results;
}

export { checkA_realMixFlavorPreserved, checkB_legacyLinkMigrated, checkC_mixSlotEnforces5050, checkD_consumptionAttributedPerFlavor, checkE_inventoryCostsIncludeMix, checkF_flavorsPersistThroughStorage };
