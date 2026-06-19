/**
 * Lager-Persistenz: Tests 1–5
 *
 * Prüft, dass Pulver- und Materialdaten nach Navigation, Reload und trotz
 * älterer Cloud-Daten erhalten bleiben sowie dass neuere Cloud-Daten übernommen werden.
 * Kein UI-Interaktions-Test — Persistenz wird direkt über localStorage verifiziert.
 */

import { expect, test } from "@playwright/test";

const pulverVanille = {
  id: "gs_vanille_lager_test",
  productName: "MAC Vanille",
  flavorName: "Vanille",
  manufacturer: "Test",
  recipe: { powderKgPerBatch: 2, waterLitersPerBatch: 3, mixLitersPerBatch: 5, packageKg: 2 },
  unit: "kg",
  quantityOnHand: 5,
  purchasePriceCents: null,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUpdatedAt: "2026-01-01T00:00:00.000Z"
};

const waffelKategorie = {
  id: "cat_waffel_lager_test",
  name: "Waffeln Test",
  itemIds: ["item_waffel_lager_test"]
};

const waffelItem = {
  id: "item_waffel_lager_test",
  name: "Waffel Standard Test",
  unit: "Stk.",
  quantityOnHand: 100,
  purchasePriceCents: null,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z"
};

const OLD_TS = "2025-01-01T00:00:00.000Z";
const NEW_TS = "2026-06-01T00:00:00.000Z";

function buildState(overrides: Record<string, unknown> = {}) {
  return {
    productConfigVersion: 4,
    machines: [],
    activeShift: null,
    transactions: [],
    dailySales: { orders: [] },
    completedOrders: [],
    consumptionEntries: [],
    mixStocks: {},
    stockFlavors: {},
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

function seedScript({
  state,
  inventoryLocalAt
}: {
  state: Record<string, unknown>;
  inventoryLocalAt?: string;
}) {
  if (window.sessionStorage.getItem("primaq-lager-seeded") === "true") return;
  window.sessionStorage.setItem("primaq-lager-seeded", "true");
  window.localStorage.clear();
  window.localStorage.setItem("primaq-control-machines", JSON.stringify([]));
  window.localStorage.setItem("primaq-control-mvp-state", JSON.stringify(state));
  window.localStorage.setItem("primaq-control-open-orders", JSON.stringify([]));
  window.localStorage.setItem("primaq-control-active-order-id", JSON.stringify(null));
  window.localStorage.setItem("primaq-control-daily-sales", JSON.stringify({ orders: [] }));
  window.localStorage.setItem("primaq-control-completed-orders", JSON.stringify([]));
  if (inventoryLocalAt) {
    window.localStorage.setItem("primaq-inventory-local-at", inventoryLocalAt);
  }
}

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => { /* deaktiviert */ });
}

async function readGeneralStock(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("primaq-control-mvp-state");
    if (!raw) return {};
    return (JSON.parse(raw) as { generalStock?: Record<string, unknown> }).generalStock ?? {};
  });
}

async function readMaterialCategories(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("primaq-control-mvp-state");
    if (!raw) return [];
    return (JSON.parse(raw) as { materialCategories?: unknown[] }).materialCategories ?? [];
  });
}

// ── Test 1: Pulver Vanille bleibt nach Seitenwechsel und Reload erhalten ──────

test("1: Pulver Vanille bleibt nach Seitenwechsel und Reload erhalten", async ({ page }) => {
  const state = buildState({
    generalStock: { [pulverVanille.id]: pulverVanille },
    generalStockMovements: { [pulverVanille.id]: [] }
  });

  await page.addInitScript(seedScript, { state });
  await blockSupabase(page);

  // Lager-Seite laden
  await page.goto("/lager");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  // Pulver-Artikel muss im localStorage vorhanden sein
  let gs = await readGeneralStock(page);
  expect(gs).toHaveProperty(pulverVanille.id);

  // Seitenwechsel zu /einstellungen und zurück
  await page.goto("/einstellungen");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
  await page.goto("/lager");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  gs = await readGeneralStock(page);
  expect(gs).toHaveProperty(pulverVanille.id);

  // Reload
  await page.reload();
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  gs = await readGeneralStock(page);
  expect(gs).toHaveProperty(pulverVanille.id);
  expect((gs as Record<string, { productName: string }>)[pulverVanille.id]?.productName).toBe("MAC Vanille");
});

// ── Test 2: Material Waffel bleibt nach Seitenwechsel und Reload erhalten ─────

test("2: Material Waffel bleibt nach Seitenwechsel und Reload erhalten", async ({ page }) => {
  const state = buildState({
    materialCategories: [waffelKategorie],
    materialItems: { [waffelItem.id]: waffelItem }
  });

  await page.addInitScript(seedScript, { state });
  await blockSupabase(page);

  await page.goto("/lager");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  let cats = await readMaterialCategories(page);
  expect(cats).toHaveLength(1);

  // Seitenwechsel und zurück
  await page.goto("/einstellungen");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
  await page.goto("/lager");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  cats = await readMaterialCategories(page);
  expect(cats).toHaveLength(1);
  expect((cats as Array<{ id: string }>)[0]?.id).toBe(waffelKategorie.id);

  // Reload
  await page.reload();
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  cats = await readMaterialCategories(page);
  expect(cats).toHaveLength(1);
  expect((cats as Array<{ name: string }>)[0]?.name).toBe("Waffeln Test");
});

// ── Test 3: Pulver gelöscht – ältere Cloud-Daten überschreiben Löschung NICHT ─

test("3: Pulver-Löschung bleibt trotz älterer Cloud-Daten erhalten", async ({ page }) => {
  // Lokaler State: generalStock leer (Artikel wurde gelöscht), Timestamp frisch
  const state = buildState({ generalStock: {}, generalStockMovements: {} });

  await page.addInitScript(seedScript, {
    state,
    inventoryLocalAt: NEW_TS
  });

  // Cloud: hat noch den alten Artikel mit ÄLTEREM inventoryWrittenAt
  const cloudInventory = {
    generalStock: { [pulverVanille.id]: pulverVanille },
    generalStockMovements: { [pulverVanille.id]: [] },
    materialCategories: [],
    materialItems: {},
    inventoryMovements: {},
    shiftMaterialAssignments: [],
    inventoryWrittenAt: OLD_TS
  };

  await page.route(/supabase\.co/, async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes("/inventory")) {
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ value: cloudInventory })
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    // Settings und andere: leer
    await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  });
  await page.routeWebSocket(/supabase\.co/, () => { /* deaktiviert */ });

  await page.goto("/lager");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  // Genug Zeit für den Cloud-Load-Callback
  await page.waitForTimeout(1500);

  // Artikel darf NICHT zurückgekehrt sein – lokale Löschung gewinnt
  const gs = await readGeneralStock(page);
  expect(Object.keys(gs)).toHaveLength(0);
});

// ── Test 4: Material gelöscht – ältere Cloud-Daten überschreiben Löschung NICHT

test("4: Material-Löschung bleibt trotz älterer Cloud-Daten erhalten", async ({ page }) => {
  // Lokaler State: materialCategories leer (Kategorie gelöscht), Timestamp frisch
  const state = buildState({ materialCategories: [], materialItems: {} });

  await page.addInitScript(seedScript, {
    state,
    inventoryLocalAt: NEW_TS
  });

  // Cloud: hat noch die alte Kategorie mit ÄLTEREM inventoryWrittenAt
  const cloudInventory = {
    generalStock: {},
    generalStockMovements: {},
    materialCategories: [waffelKategorie],
    materialItems: { [waffelItem.id]: waffelItem },
    inventoryMovements: {},
    shiftMaterialAssignments: [],
    inventoryWrittenAt: OLD_TS
  };

  await page.route(/supabase\.co/, async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes("/inventory")) {
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ value: cloudInventory })
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  });
  await page.routeWebSocket(/supabase\.co/, () => { /* deaktiviert */ });

  await page.goto("/lager");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  await page.waitForTimeout(1500);

  // Kategorie darf NICHT zurückgekehrt sein – lokale Löschung gewinnt
  const cats = await readMaterialCategories(page);
  expect(cats).toHaveLength(0);
});

// ── Test 5: Neuere Cloud-Daten werden beim Reload übernommen (Cross-Device) ───

test("5: Neuere Cloud-Daten (anderes Gerät) werden beim Reload übernommen", async ({ page }) => {
  // Lokaler State: altes Lager ohne Vanille-Artikel + ALTER Timestamp
  const state = buildState({ generalStock: {}, generalStockMovements: {} });

  await page.addInitScript(seedScript, {
    state,
    inventoryLocalAt: OLD_TS
  });

  // Cloud (anderes Gerät): hat Vanille-Artikel mit NEUEREM inventoryWrittenAt
  const cloudInventory = {
    generalStock: { [pulverVanille.id]: pulverVanille },
    generalStockMovements: { [pulverVanille.id]: [] },
    materialCategories: [],
    materialItems: {},
    inventoryMovements: {},
    shiftMaterialAssignments: [],
    inventoryWrittenAt: NEW_TS
  };

  await page.route(/supabase\.co/, async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes("/inventory")) {
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ value: cloudInventory })
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  });
  await page.routeWebSocket(/supabase\.co/, () => { /* deaktiviert */ });

  await page.goto("/lager");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  // Warten bis Cloud-Daten via setState in localStorage geschrieben wurden
  await expect
    .poll(
      async () => {
        const gs = await readGeneralStock(page);
        return Object.keys(gs).includes(pulverVanille.id);
      },
      { timeout: 8000, intervals: [200, 500, 1000] }
    )
    .toBe(true);

  // Cloud-Artikel muss jetzt in localStorage vorhanden sein
  const gs = await readGeneralStock(page);
  expect(gs).toHaveProperty(pulverVanille.id);
  expect((gs as Record<string, { productName: string }>)[pulverVanille.id]?.productName).toBe("MAC Vanille");
});
