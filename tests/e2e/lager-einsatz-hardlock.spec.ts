/**
 * Lager → Einsatz Hard Lock: Tests 1–6
 *
 * Verifiziert, dass kein Startbestand oder Nachfüllung gebucht werden kann
 * wenn kein Lager-Eintrag vorhanden ist oder der Bestand nicht ausreichend ist.
 * Prüft auch, dass bei ausreichendem Bestand der Lagerbestand korrekt sinkt.
 */

import { expect, test } from "@playwright/test";

// ── Stammdaten ────────────────────────────────────────────────────────────────

// Muss mit createStockFlavorId("Vanille HL-Test") übereinstimmen:
// normalizeStockFlavorName("Vanille HL-Test") = "vanille hl-test"
// .replace(/[^a-z0-9äöüß]+/gi, "-") = "vanille-hl-test"
const FLAVOR_ID = "vanille-hl-test";
const MACHINE_ID = "machine_hardlock";
const STOCK_ITEM_ID = "gs_van_hardlock";
const MIX_START_INPUT_TESTID = `shift-mix-start-input-${FLAVOR_ID}`;

const recipe = {
  powderKgPerBatch: 2,
  waterLitersPerBatch: 3,
  mixLitersPerBatch: 5,
  packageKg: 2
};
// 1 Pkg → 1 Batch → 5 L   (packageKg = powderKgPerBatch → 1 Batch/Pkg)

const flavor = {
  id: FLAVOR_ID,
  name: "Vanille HL-Test",
  recipe,
  warningThresholdPortions: 20,
  active: true
};

const machineProduct = {
  id: "prod_van_hardlock",
  machineId: MACHINE_ID,
  machineName: "Gelmatic 1",
  slot: "A",
  name: "Vanille HL-Test",
  priceCents: 250,
  vatRate: 7,
  aroma: "Vanille HL-Test",
  packagingType: "Becher",
  packagingSize: "120cc",
  portionGrams: 0,
  stockLinks: [{ stockFlavorId: FLAVOR_ID, ratio: 1 }],
  recipe,
  spoonIncluded: true,
  toppingEnabled: false,
  toppingPriceCents: 0,
  toppingVatRate: 7,
  visibleInSale: true,
  nameManuallyEdited: true
};

const machine = {
  id: MACHINE_ID,
  number: "1",
  name: "Gelmatic 1",
  manualName: false,
  location: "Wagen",
  active: true,
  visibleInSale: true,
  products: [machineProduct]
};

function stockEntry(qty: number) {
  return {
    id: STOCK_ITEM_ID,
    flavorId: FLAVOR_ID,
    productName: "Vanille HL-Test",
    flavorName: "Vanille HL-Test",
    manufacturer: "Test",
    recipe,
    unit: "Pkg",
    quantityOnHand: qty,
    purchasePriceCents: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUpdatedAt: "2026-01-01T00:00:00.000Z"
  };
}

const activeShift = {
  id: "shift_hardlock_test",
  date: "2026-06-10",
  eventName: "Hard-Lock-Test-Einsatz",
  salesArea: "truck",
  employees: [],
  startingCashCents: 15000,
  createdAt: "2026-06-10T08:00:00.000Z"
};

const mixStockLine = {
  productId: FLAVOR_ID,
  name: "Vanille HL-Test",
  recipe,
  startLiters: 5,
  refilledLiters: 0,
  correctedLiters: 0
};

function buildState(overrides: Record<string, unknown> = {}) {
  return {
    productConfigVersion: 4,
    machines: [machine],
    activeShift: null,
    transactions: [],
    dailySales: { orders: [] },
    completedOrders: [],
    consumptionEntries: [],
    mixStocks: {},
    stockFlavors: { [FLAVOR_ID]: flavor },
    portionWeights: {},
    inventory: {},
    softServeItems: [],
    aromas: [],
    packagingSizes: {},
    productSettings: {},
    salesLayout: [],
    toppings: [],
    dayReport: null,
    reports: [],
    emergencyMode: {},
    emergencyModeLog: [],
    mixStockMovements: {},
    recipeTemplates: [],
    generalStock: {},
    generalStockMovements: {},
    inventoryMovements: {},
    materialCategories: [] as unknown[],
    materialItems: {},
    shiftMaterialAssignments: [],
    sumupSettings: { enabled: false, paymentLink: "", hintText: "" },
    favorites: [],
    ...overrides
  };
}

function seedScript({ state }: { state: Record<string, unknown> }) {
  if (window.sessionStorage.getItem("primaq-hl-seeded") === "true") return;
  window.sessionStorage.setItem("primaq-hl-seeded", "true");
  window.localStorage.clear();
  window.localStorage.setItem("primaq-control-machines", JSON.stringify([
    (state as { machines?: unknown[] }).machines?.[0] ?? []
  ]));
  window.localStorage.setItem("primaq-control-mvp-state", JSON.stringify(state));
  window.localStorage.setItem("primaq-control-open-orders", JSON.stringify([]));
  window.localStorage.setItem("primaq-control-active-order-id", JSON.stringify(null));
  window.localStorage.setItem("primaq-control-daily-sales", JSON.stringify({ orders: [] }));
  window.localStorage.setItem("primaq-control-completed-orders", JSON.stringify([]));
}

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => { /* deaktiviert */ });
}

async function readGeneralStockQty(page: import("@playwright/test").Page): Promise<number | null> {
  return page.evaluate(({ itemId }) => {
    const raw = window.localStorage.getItem("primaq-control-mvp-state");
    if (!raw) return null;
    const state = JSON.parse(raw) as { generalStock?: Record<string, { quantityOnHand: number }> };
    return state.generalStock?.[itemId]?.quantityOnHand ?? null;
  }, { itemId: STOCK_ITEM_ID });
}

// ── Test 1: Sorte nicht im Lager → Startbestand-Button gesperrt ───────────────

test("1: Sorte nicht im Lager erfasst → Start-Button gesperrt + Fehlermeldung", async ({ page }) => {
  const state = buildState({ generalStock: {} });

  await page.addInitScript(seedScript, { state });
  await blockSupabase(page);

  await page.goto("/einsatz");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  // Event-Name ausfüllen damit canStart nur noch am Lager scheitert
  await page.getByTestId("shift-event-input").fill("Test-Einsatz");

  // Menge eingeben (triggert missingLagerFlavors-Prüfung)
  await page.getByTestId(MIX_START_INPUT_TESTID).fill("1");

  // Start-Button muss gesperrt sein
  await expect(page.getByTestId("shift-start-button")).toBeDisabled();

  // Fehlermeldung "nicht im Pulver-Lager erfasst"
  await expect(page.getByText(/nicht im Pulver-Lager erfasst/i)).toBeVisible();
});

// ── Test 2: Lager leer (0 Pkg) → Startbestand gesperrt ───────────────────────

test("2: Lager 0 Pkg → Start-Button gesperrt + Fehlermeldung Bestand", async ({ page }) => {
  const state = buildState({
    generalStock: { [STOCK_ITEM_ID]: stockEntry(0) }
  });

  await page.addInitScript(seedScript, { state });
  await blockSupabase(page);

  await page.goto("/einsatz");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  await page.getByTestId("shift-event-input").fill("Test-Einsatz");
  await page.getByTestId(MIX_START_INPUT_TESTID).fill("1");

  await expect(page.getByTestId("shift-start-button")).toBeDisabled();
  await expect(page.getByText(/Nicht genügend Bestand im Lager/i)).toBeVisible();
});

// ── Test 3: Lager 2 Pkg, Bedarf 3 Pkg → blockiert ────────────────────────────

test("3: Lager 2 Pkg, Start 3 Pkg → Start-Button gesperrt", async ({ page }) => {
  const state = buildState({
    generalStock: { [STOCK_ITEM_ID]: stockEntry(2) }
  });

  await page.addInitScript(seedScript, { state });
  await blockSupabase(page);

  await page.goto("/einsatz");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  await page.getByTestId("shift-event-input").fill("Test-Einsatz");
  await page.getByTestId(MIX_START_INPUT_TESTID).fill("3");

  await expect(page.getByTestId("shift-start-button")).toBeDisabled();
  await expect(page.getByText(/zu wenig/i)).toBeVisible();
});

// ── Test 4: Lager 5 Pkg, Start 3 Pkg → erlaubt, Lager sinkt auf 2 Pkg ────────

test("4: Lager 5 Pkg, Start 3 Pkg → erlaubt, Lager sinkt auf 2 Pkg", async ({ page }) => {
  const state = buildState({
    generalStock: { [STOCK_ITEM_ID]: stockEntry(5) }
  });

  await page.addInitScript(seedScript, { state });
  await blockSupabase(page);

  await page.goto("/einsatz");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  await page.getByTestId("shift-event-input").fill("Test-Einsatz");
  await page.getByTestId(MIX_START_INPUT_TESTID).fill("3");

  // Start-Button muss aktiv sein
  await expect(page.getByTestId("shift-start-button")).toBeEnabled();

  // Einsatz starten
  await page.getByTestId("shift-start-button").click();

  // Nach Start: Einsatz läuft (aktiver Einsatz Heading sichtbar)
  await expect(page.getByText("Test-Einsatz")).toBeVisible();

  // Lagerbestand muss von 5 auf 2 gesunken sein (5 - 3 = 2)
  await expect
    .poll(() => readGeneralStockQty(page), { timeout: 4000 })
    .toBe(2);
});

// ── Test 5: Nachfüllung +1 Pkg während aktivem Einsatz → Lager sinkt ─────────

test("5: Nachfüllung +1 Pkg → Lager sinkt von 4 auf 3 Pkg", async ({ page }) => {
  const state = buildState({
    activeShift,
    mixStocks: { [FLAVOR_ID]: mixStockLine },
    mixStockMovements: {},
    generalStock: { [STOCK_ITEM_ID]: stockEntry(4) }
  });

  await page.addInitScript(seedScript, { state });
  await blockSupabase(page);

  await page.goto("/einsatz");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  // Aktiver Einsatz: Maschinenbestand-Panel zeigt + Buttons
  // Zweiter + Button = Nachfüllung (refill_plus)
  const plusButtons = page.getByRole("button", { name: "+" });
  await expect(plusButtons).toHaveCount(2, { timeout: 5000 });

  const qty_before = await readGeneralStockQty(page);
  expect(qty_before).toBe(4);

  // Klick auf Nachfüllung + (zweiter + Button)
  await plusButtons.nth(1).click();

  // Lager muss von 4 auf 3 sinken
  await expect
    .poll(() => readGeneralStockQty(page), { timeout: 4000 })
    .toBe(3);
});

// ── Test 6: Nachfüllung blockiert wenn Lager = 0 Pkg ─────────────────────────

test("6: Lager 0 Pkg im aktiven Einsatz → + Button gesperrt, kein Abzug", async ({ page }) => {
  const state = buildState({
    activeShift,
    mixStocks: { [FLAVOR_ID]: mixStockLine },
    mixStockMovements: {},
    generalStock: { [STOCK_ITEM_ID]: stockEntry(0) }
  });

  await page.addInitScript(seedScript, { state });
  await blockSupabase(page);

  await page.goto("/einsatz");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  // + Buttons müssen gesperrt (disabled) sein wegen warehouseBlocked
  const plusButtons = page.getByRole("button", { name: "+" });
  // Wenn disabled, sind es disabled buttons — prüfe dass Lager nicht verändert wird
  const qty_before = await readGeneralStockQty(page);
  expect(qty_before).toBe(0);

  // Warte kurz, dann prüfe erneut (kein spontaner Abzug)
  await page.waitForTimeout(500);
  const qty_after = await readGeneralStockQty(page);
  expect(qty_after).toBe(0);

  // Fehlermeldung "0 Pkg im Lager" oder "Nicht im Lager erfasst" sichtbar
  await expect(page.getByText(/0 Pkg im Lager|Nicht im Lager erfasst/)).toBeVisible();

  // Disabled-Attribut auf + Buttons prüfen
  const count = await plusButtons.count();
  if (count > 0) {
    await expect(plusButtons.first()).toBeDisabled();
  }
});

// ── Test D: Pulver zurückbuchen erhöht Lagerbestand ───────────────────────────

test("D: Pulver zurückbuchen → Lagerbestand steigt", async ({ page }) => {
  // 1 Pkg entspricht 1 Batch × 5 L laut Rezept (packageKg = powderKgPerBatch = 2)
  const state = buildState({
    activeShift,
    mixStocks: { [FLAVOR_ID]: mixStockLine }, // startLiters = 5 L
    mixStockMovements: {},
    generalStock: { [STOCK_ITEM_ID]: stockEntry(0) } // Lager leer, aber Eintrag vorhanden
  });

  await page.addInitScript(seedScript, { state });
  await blockSupabase(page);

  await page.goto("/einsatz");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  // Einsatz zurücksetzen → PowderReturnDialog öffnet sich (5 L restbestand)
  await page.getByText("Einsatz zuruecksetzen").click();

  // Dialog: "Pulver zurückbuchen" sichtbar
  await expect(page.getByText("Pulver zurückbuchen")).toBeVisible();

  // Rückgabe: alle 1 Pkg zurück (5 L = 1 Pkg laut Rezept)
  await page.getByPlaceholder("1").fill("1");

  // Weiter → onReturn(FLAVOR_ID, 1) wird aufgerufen, Lager soll auf 1 steigen
  await page.getByRole("button", { name: "Weiter" }).click();

  // Lagerbestand muss von 0 auf 1 gestiegen sein
  await expect
    .poll(() => readGeneralStockQty(page), { timeout: 4000 })
    .toBe(1);
});

// ── Test E: Einsatz beenden – mixStocks geleert, Abschlussdata korrekt ────────

test("E: Einsatz vollständig beenden → activeShift null, Lager korrekt", async ({ page }) => {
  // Einsatz mit 5 L Startbestand, Lager 0 Pkg (komplett aufgebraucht)
  const state = buildState({
    activeShift,
    mixStocks: { [FLAVOR_ID]: { ...mixStockLine, startLiters: 0, refilledLiters: 0 } }, // 0 L restbestand
    mixStockMovements: {},
    generalStock: { [STOCK_ITEM_ID]: stockEntry(0) }
  });

  await page.addInitScript(seedScript, { state });
  await blockSupabase(page);

  await page.goto("/einsatz");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  // Kein Pulver-Restbestand → direkt Abschluss-Dialog
  await page.getByText("Einsatz zuruecksetzen").click();

  // Abschluss-Dialog öffnet sich
  await expect(page.getByText("Einsatz beenden")).toBeVisible({ timeout: 3000 });

  // Einsatz bestätigen
  await page.getByRole("button", { name: "Einsatz jetzt beenden" }).click();

  // activeShift muss null sein
  const activeShiftAfter = await page.evaluate(() => {
    const raw = window.localStorage.getItem("primaq-control-mvp-state");
    if (!raw) return "NOT_FOUND";
    const s = JSON.parse(raw) as { activeShift?: unknown };
    return s.activeShift ?? null;
  });
  expect(activeShiftAfter).toBeNull();

  // Lager bleibt unverändert bei 0 Pkg (kein Pulver zurückgebucht)
  await expect
    .poll(() => readGeneralStockQty(page), { timeout: 4000 })
    .toBe(0);
});
