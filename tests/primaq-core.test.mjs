import assert from "node:assert/strict";
import { describe, it } from "node:test";

const recipes = {
  soft_small: { soft_mix_liter: 0.12, cup_small: 1, spoon: 1 },
  soft_medium: { soft_mix_liter: 0.18, cup_medium: 1, spoon: 1 },
  soft_large: { soft_mix_liter: 0.25, cup_large: 1, spoon: 1 },
  topping: { topping_material: 0.03 }
};

function calculateTaxFromGross(grossCents, vatRate) {
  const netCents = Math.round(grossCents / (1 + vatRate / 100));
  return {
    grossCents,
    netCents,
    taxAmountCents: grossCents - netCents
  };
}

function createTransactions({ quantity, unitGrossCents = 500, vatRate = 7, paymentMethod = "cash", productId = "soft_large" }) {
  return Array.from({ length: Math.abs(quantity) }, () => {
    const signedGrossCents = quantity < 0 ? -unitGrossCents : unitGrossCents;
    const tax = calculateTaxFromGross(signedGrossCents, vatRate);

    return {
      productId,
      paymentKind: paymentMethod,
      quantity: quantity < 0 ? -1 : 1,
      amountCents: unitGrossCents,
      grossTotalCents: signedGrossCents,
      netTotalCents: tax.netCents,
      taxAmountCents: tax.taxAmountCents,
      vatRate,
      taxRateAtBooking: vatRate
    };
  });
}

function calculateTaxReport(transactions) {
  return transactions.reduce(
    (totals, transaction) => ({
      grossCents: totals.grossCents + transaction.grossTotalCents,
      netCents: totals.netCents + transaction.netTotalCents,
      vatCents: totals.vatCents + transaction.taxAmountCents
    }),
    { grossCents: 0, netCents: 0, vatCents: 0 }
  );
}

function calculateTotals(transactions) {
  return transactions.reduce(
    (totals, transaction) => {
      const sign = transaction.quantity < 0 ? -1 : 1;
      const amount = sign * transaction.amountCents;

      return {
        totalPieces: totals.totalPieces + sign,
        expectedRevenueCents: totals.expectedRevenueCents + amount,
        cashCents: totals.cashCents + (transaction.paymentKind === "cash" ? amount : 0),
        cardCents: totals.cardCents + (transaction.paymentKind === "card" ? amount : 0)
      };
    },
    { totalPieces: 0, expectedRevenueCents: 0, cashCents: 0, cardCents: 0 }
  );
}

function dedupeReportsByShift(reports) {
  const reportsByShift = new Map();

  for (const report of reports) {
    const existing = reportsByShift.get(report.shift.id);
    if (!existing || report.createdAt.localeCompare(existing.createdAt) >= 0) {
      reportsByShift.set(report.shift.id, report);
    }
  }

  return Array.from(reportsByShift.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function summarizeReports(reports) {
  return reports.reduce((sum, report) => sum + report.taxReport.grossCents, 0);
}

function formatMachineDisplayName(name, number) {
  const match = name?.match(/^Gelmatic\s+(\d+)$/i);
  if (match) return `MASCHINE ${match[1]}`;
  return name || (number ? `MASCHINE ${number}` : "MASCHINE");
}

function buildMachineSummaries(orders, machines = []) {
  const machineLookup = new Map(machines.map((machine) => [machine.id, machine]));
  const machineSummaries = new Map();

  for (const order of orders) {
    for (const item of order.items) {
      const machine = item.machineId ? machineLookup.get(item.machineId) : undefined;
      const machineName =
        item.machineNameAtBooking?.trim() ||
        item.machineDisplayNameAtBooking?.trim() ||
        (machine ? formatMachineDisplayName(machine.name, machine.number) : item.machineNumber ? `MASCHINE ${item.machineNumber}` : "MASCHINE");
      const location = item.machineLocationAtBooking?.trim() || machine?.location || "nicht erfasst";
      const key = item.machineId ? `shift:${order.shiftId}:machine:${item.machineId}` : `shift:${order.shiftId}:snapshot:${machineName}`;
      const sortLabel = `${item.itemNameAtBooking ?? item.name} / ${item.packageNameAtBooking ?? item.packagingSize ?? "Waffel"}`;
      const grossCents = item.grossTotalCents ?? item.lineTotalGrossCents;
      const summary =
        machineSummaries.get(key) ??
        { key, machineId: item.machineId, machineName, location, grossCents: 0, cashCents: 0, cardCents: 0, totalPieces: 0, sortCounts: {} };

      summary.grossCents += grossCents;
      summary.cashCents += (item.paymentMethod ?? order.paymentMethod) === "cash" ? grossCents : 0;
      summary.cardCents += (item.paymentMethod ?? order.paymentMethod) === "card" ? grossCents : 0;
      summary.totalPieces += item.quantity;
      summary.sortCounts[sortLabel] = (summary.sortCounts[sortLabel] ?? 0) + item.quantity;
      machineSummaries.set(key, summary);
    }
  }

  return Array.from(machineSummaries.values()).sort((a, b) => a.machineName.localeCompare(b.machineName, "de"));
}

function normalizeSizeToken(value) {
  return (value ?? "").trim().toLowerCase().replace("ß", "ss").replace(/\s+/g, " ");
}

function parsePackagingSizeNumber(value) {
  const match = value.match(/\d+(?:[,.]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : null;
}

function resolveRecipeProductId(item) {
  if (item.recipeProductId && recipes[item.recipeProductId]) return item.recipeProductId;
  if (item.productId === "topping") return "topping";

  if (item.portionGrams > 0) {
    if (item.portionGrams <= 140) return "soft_small";
    if (item.portionGrams <= 210) return "soft_medium";
    return "soft_large";
  }

  const sizeToken = normalizeSizeToken(item.packagingSize);
  if (sizeToken === "klein" || sizeToken === "small") return "soft_small";
  if (sizeToken === "mittel" || sizeToken === "medium") return "soft_medium";
  if (sizeToken === "gross" || sizeToken === "large") return "soft_large";

  const numericSize = parsePackagingSizeNumber(sizeToken);
  if (numericSize !== null) {
    if (numericSize <= 130) return "soft_small";
    if (numericSize <= 180) return "soft_medium";
    return "soft_large";
  }

  const legacy = normalizeSizeToken(`${item.packageNameAtBooking ?? ""} ${item.packagingSize ?? ""}`);
  if (legacy.includes("120") || legacy.includes("klein") || legacy.includes("small")) return "soft_small";
  if (legacy.includes("160") || legacy.includes("mittel") || legacy.includes("medium")) return "soft_medium";
  if (legacy.includes("200") || legacy.includes("gross") || legacy.includes("large")) return "soft_large";
  return null;
}

function buildConsumptionEntries(order) {
  return order.items.flatMap((item) => {
    const recipeProductId = resolveRecipeProductId(item);
    return Object.entries(recipes[recipeProductId] ?? {}).map(([inventoryItemId, quantityPerItem]) => ({
      inventoryItemId,
      recipeProductId,
      quantity: item.quantity * quantityPerItem
    }));
  });
}

function createCorrectionOrder(originalOrder, reason = "Bestellung storniert") {
  return {
    id: "correction_1",
    shiftId: originalOrder.shiftId,
    status: "correction",
    originalOrderId: originalOrder.id,
    correctionReason: reason,
    correctedAt: "2026-05-31T12:00:00.000Z",
    paymentMethod: originalOrder.paymentMethod,
    items: originalOrder.items.map((item) => ({
      ...item,
      id: `${item.id}_correction`,
      originalOrderId: originalOrder.id,
      originalItemId: item.itemId ?? item.id,
      correctionReason: reason,
      correctedAt: "2026-05-31T12:00:00.000Z",
      quantity: -Math.abs(item.quantity),
      grossTotalCents: -Math.abs(item.grossTotalCents),
      lineTotalGrossCents: -Math.abs(item.lineTotalGrossCents)
    }))
  };
}

describe("PrimaQ core checks", () => {
  it("calculates taxes for 1/2/3 unit sales without overcounting", () => {
    const scenarios = [
      { quantity: 1, expected: { grossCents: 500, netCents: 467, vatCents: 33 } },
      { quantity: 2, expected: { grossCents: 1000, netCents: 934, vatCents: 66 } },
      { quantity: 3, expected: { grossCents: 1500, netCents: 1401, vatCents: 99 } }
    ];

    for (const scenario of scenarios) {
      const report = calculateTaxReport(createTransactions({ quantity: scenario.quantity, unitGrossCents: 500, vatRate: 7 }));
      assert.deepEqual(report, scenario.expected);
    }
  });

  it("deduplicates day reports by shift id before monthly summaries", () => {
    const reports = dedupeReportsByShift([
      { id: "report_old", createdAt: "2026-05-31T10:00:00.000Z", shift: { id: "shift_1" }, taxReport: { grossCents: 500 } },
      { id: "report_new", createdAt: "2026-05-31T11:00:00.000Z", shift: { id: "shift_1" }, taxReport: { grossCents: 1000 } }
    ]);

    assert.equal(reports.length, 1);
    assert.equal(reports[0].id, "report_new");
    assert.equal(summarizeReports(reports), 1000);
  });

  it("keeps booked machine and product snapshot names after master data changes", () => {
    const orders = [{
      id: "order_1",
      shiftId: "shift_1",
      paymentMethod: "cash",
      items: [{
        id: "item_1",
        machineId: "machine_1",
        machineNameAtBooking: "Gelmatic Alter Name",
        machineDisplayNameAtBooking: "Maschine Alt",
        machineLocationAtBooking: "Wagen",
        itemNameAtBooking: "Vanille Alt",
        packageNameAtBooking: "Waffel klein",
        quantity: 1,
        grossTotalCents: 500,
        lineTotalGrossCents: 500
      }]
    }];
    const machines = [{ id: "machine_1", name: "Gelmatic Neuer Name", number: "99", location: "Zelt" }];
    const [summary] = buildMachineSummaries(orders, machines);

    assert.equal(summary.machineName, "Gelmatic Alter Name");
    assert.equal(summary.location, "Wagen");
    assert.deepEqual(summary.sortCounts, { "Vanille Alt / Waffel klein": 1 });
  });

  it("aggregates separate machines with correct pieces and totals", () => {
    const rows = buildMachineSummaries([{
      id: "order_1",
      shiftId: "shift_1",
      paymentMethod: "cash",
      items: [
        { id: "a", machineId: "m1", machineNameAtBooking: "Maschine 1", itemNameAtBooking: "Vanille", packageNameAtBooking: "Waffel klein", quantity: 2, grossTotalCents: 1000, lineTotalGrossCents: 1000 },
        { id: "b", machineId: "m2", machineNameAtBooking: "Maschine 2", itemNameAtBooking: "Schoko", packageNameAtBooking: "Becher 160cc", quantity: 1, grossTotalCents: 400, lineTotalGrossCents: 400 }
      ]
    }]);

    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.machineId === "m1").totalPieces, 2);
    assert.equal(rows.find((row) => row.machineId === "m1").grossCents, 1000);
    assert.equal(rows.find((row) => row.machineId === "m2").totalPieces, 1);
    assert.equal(rows.find((row) => row.machineId === "m2").grossCents, 400);
  });

  it("uses structured packaging fields for non-zero consumption", () => {
    const entries = buildConsumptionEntries({
      items: [
        { productId: "soft_custom", packagingType: "Waffel", packagingSize: "klein", quantity: 1 },
        { productId: "soft_custom", packagingType: "Becher", packagingSize: "160cc", quantity: 1 },
        { productId: "soft_custom", packagingType: "Becher", packagingSize: "Spezial", portionGrams: 180, quantity: 1 }
      ]
    });

    assert(entries.some((entry) => entry.recipeProductId === "soft_small" && entry.quantity > 0));
    assert(entries.some((entry) => entry.recipeProductId === "soft_medium" && entry.quantity > 0));
    assert(entries.reduce((sum, entry) => sum + entry.quantity, 0) > 0);
  });

  it("syncs stale deployment slot flavor IDs from current machine product stock links", () => {
    function syncDeploymentFromMachines(deploymentMachines, machines) {
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

    const machines = [
      {
        id: "machine_2",
        location: "Wagen",
        products: [
          { slot: "A", stockLinks: [{ stockFlavorId: "cheesecake", ratio: 1 }] },
          { slot: "B", stockLinks: [{ stockFlavorId: "erdbeere", ratio: 1 }] }
        ]
      }
    ];

    // Stale deployment still references old vanilla/schoko IDs
    const staleDeployment = [
      { machineId: "machine_2", location: "Zelt", slots: [{ slot: "A", stockFlavorId: "vanille" }, { slot: "B", stockFlavorId: "schoko" }] }
    ];

    const synced = syncDeploymentFromMachines(staleDeployment, machines);

    assert.equal(synced[0].slots.find((s) => s.slot === "A").stockFlavorId, "cheesecake");
    assert.equal(synced[0].slots.find((s) => s.slot === "B").stockFlavorId, "erdbeere");
    assert.equal(synced[0].location, "Wagen");

    // Machine without a product for a given slot keeps the old flavor ID
    const partialMachines = [{ id: "machine_2", location: "Wagen", products: [{ slot: "A", stockLinks: [{ stockFlavorId: "cheesecake", ratio: 1 }] }] }];
    const syncedPartial = syncDeploymentFromMachines(staleDeployment, partialMachines);
    assert.equal(syncedPartial[0].slots.find((s) => s.slot === "A").stockFlavorId, "cheesecake");
    assert.equal(syncedPartial[0].slots.find((s) => s.slot === "B").stockFlavorId, "schoko"); // kept
  });

  it("normalizeStockLinks uses product name over stale explicit links after rename", () => {
    function createStockFlavorId(name) {
      return name.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, "-").replace(/^-|-$/g, "") || "sorte";
    }

    function getProductStockFlavorName(product) {
      const baseName = product.name || product.aroma || "";
      return baseName.replace(/\s+(Waffelbecher|Waffel|Becher)\b.*$/i, "").trim();
    }

    function normalizeStockLinks(product, stockFlavors) {
      const isReal = (id) => {
        const f = stockFlavors[id];
        return Boolean(f) && id !== "soft_mix_liter";
      };

      if (product.slot === "MIX") return [];

      const flavorName = getProductStockFlavorName(product);
      if (flavorName) {
        const nameId = createStockFlavorId(flavorName);
        if (nameId && isReal(nameId)) return [{ stockFlavorId: nameId, ratio: 1 }];
      }

      const explicitLinks = Array.isArray(product.stockLinks)
        ? product.stockLinks.filter((l) => l.stockFlavorId && isReal(l.stockFlavorId) && l.ratio > 0)
        : [];
      return explicitLinks;
    }

    const stockFlavors = {
      vanille: { id: "vanille", name: "Vanille", active: true },
      cheesecake: { id: "cheesecake", name: "Cheesecake", active: true }
    };

    // Product was renamed from "Vanille" to "Cheesecake" but still has stale stockLink
    const renamedProduct = {
      slot: "A",
      name: "Cheesecake Waffel klein",
      aroma: "Cheesecake",
      stockLinks: [{ stockFlavorId: "vanille", ratio: 1 }]
    };

    const links = normalizeStockLinks(renamedProduct, stockFlavors);
    assert.equal(links.length, 1);
    assert.equal(links[0].stockFlavorId, "cheesecake", "Name-derived ID must win over stale explicit link");

    // When only the old flavor exists (new one not yet created), fall back to explicit link
    const onlyVanille = { vanille: stockFlavors.vanille };
    const fallback = normalizeStockLinks(renamedProduct, onlyVanille);
    assert.equal(fallback[0].stockFlavorId, "vanille", "Falls back to explicit link when name-derived ID not in stockFlavors");

    // MIX slot always returns empty
    const mixProduct = { slot: "MIX", name: "Cheesecake MIX", stockLinks: [{ stockFlavorId: "cheesecake", ratio: 1 }] };
    assert.deepEqual(normalizeStockLinks(mixProduct, stockFlavors), []);
  });

  it("stores auditable cancellation as a negative correction and reduces totals", () => {
    const originalOrder = {
      id: "order_1",
      shiftId: "shift_1",
      status: "completed",
      paymentMethod: "cash",
      items: [{ id: "item_1", itemId: "item_1", productId: "soft_large", quantity: 1, unitGrossCents: 500, grossTotalCents: 500, lineTotalGrossCents: 500, vatRate: 7 }]
    };
    const correctionOrder = createCorrectionOrder(originalOrder);
    const transactions = [
      ...createTransactions({ quantity: 1, unitGrossCents: 500, vatRate: 7 }),
      ...createTransactions({ quantity: -1, unitGrossCents: 500, vatRate: 7 })
    ];

    assert.equal(correctionOrder.status, "correction");
    assert.equal(correctionOrder.originalOrderId, "order_1");
    assert.equal(correctionOrder.items[0].originalItemId, "item_1");
    assert.equal(correctionOrder.items[0].quantity, -1);
    assert.equal(correctionOrder.items[0].correctionReason, "Bestellung storniert");
    assert.deepEqual(calculateTotals(transactions), { totalPieces: 0, expectedRevenueCents: 0, cashCents: 0, cardCents: 0 });
    assert.deepEqual(calculateTaxReport(transactions), { grossCents: 0, netCents: 0, vatCents: 0 });
  });
});
