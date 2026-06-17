import { expect, test } from "@playwright/test";

const machineId = "machine_fr_test";
const productId = `${machineId}_sort_1`;
const orderItemId = `${productId}_Waffel`;
const materialCategoryId = "cat_fr_test";
const materialItemId = "material_fr_test";
const generalStockItemId = "gs_fr_test";

const machine = {
  id: machineId,
  number: "1",
  name: "FR Testmaschine",
  manualName: false,
  location: "Wagen",
  active: true,
  visibleInSale: true,
  products: [
    {
      id: productId,
      machineId,
      machineName: "FR Testmaschine",
      name: "Vanille FR",
      priceCents: 500,
      vatRate: 7,
      aroma: "Vanille",
      packagingType: "Waffel",
      packagingSize: "mittel",
      portionGrams: 120,
      spoonIncluded: false,
      toppingEnabled: false,
      toppingPriceCents: 0,
      toppingVatRate: 7,
      visibleInSale: true,
      nameManuallyEdited: true
    }
  ]
};

const materialCategory = { id: materialCategoryId, name: "FR Kategorie", itemIds: [materialItemId] };
const materialItem = {
  id: materialItemId,
  name: "FR Material",
  unit: "Stk.",
  quantityOnHand: 99,
  minQuantity: 5,
  purchasePriceCents: 50,
  active: true,
  createdAt: new Date().toISOString()
};
const generalStockItem = {
  id: generalStockItemId,
  productName: "Vanille FR Pulver",
  flavorName: "Vanille FR",
  flavorId: "vanille-fr",
  recipe: { powderKgPerBatch: 1, mixLitersPerBatch: 5, packageKg: 1, waterLitersPerBatch: 4 },
  unit: "Pkg",
  quantityOnHand: 12,
  purchasePriceCents: null,
  active: true,
  createdAt: new Date().toISOString()
};

test.beforeEach(async ({ page }) => {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => { /* fake-open: Realtime denkt verbunden, empfängt keine Events */ });
  await page.addInitScript(
    ({ machine, materialCategory, materialItem, generalStockItem }) => {
      if (window.sessionStorage.getItem("primaq-fr-seeded") === "true") return;

      window.localStorage.clear();
      window.localStorage.setItem("primaq-control-machines", JSON.stringify([machine]));
      window.localStorage.setItem(
        "primaq-control-mvp-state",
        JSON.stringify({
          productConfigVersion: 4,
          machines: [machine],
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
          generalStock: { [generalStockItem.id]: generalStockItem },
          generalStockMovements: {},
          inventoryMovements: {},
          materialCategories: [materialCategory],
          materialItems: { [materialItem.id]: materialItem },
          shiftMaterialAssignments: [],
          sumupSettings: { enabled: true, paymentLink: "https://pay.example.com", hintText: "Bitte zahlen" },
          favorites: ["fav_1"]
        })
      );
      window.localStorage.setItem(
        "primaq-control-open-orders",
        JSON.stringify([{ id: "order_fr_1", title: "Bestellung 1", items: [], paymentMethod: "cash", cashReceivedCents: 0, totalGrossCents: 0, vatCents: 0, changeDueCents: 0 }])
      );
      window.localStorage.setItem("primaq-control-active-order-id", JSON.stringify("order_fr_1"));
      window.localStorage.setItem("primaq-control-daily-sales", JSON.stringify({ orders: [] }));
      window.localStorage.setItem("primaq-control-completed-orders", JSON.stringify([]));
      window.sessionStorage.setItem("primaq-fr-seeded", "true");
    },
    { machine, materialCategory, materialItem, generalStockItem }
  );
});

test("Werksreset löscht alle PrimaQ-Daten vollständig", async ({ page }) => {
  // 1. Vor Reset: Daten überall sichtbar prüfen

  await page.goto("/einstellungen");
  // Maschine sichtbar via testid (das MachineCard rendert data-testid auf dem Input)
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  await page.goto("/lager");
  await expect(page.getByText("Vanille FR Pulver")).toBeVisible();
  await expect(page.getByText("FR Kategorie")).toBeVisible();

  await page.goto("/verkauf");
  await expect(page.getByTestId(`sale-machine-${machineId}`)).toBeVisible();

  // 2. Werksreset ausführen

  await page.goto("/einstellungen");
  await page.getByRole("button", { name: /Werksreset/ }).click();

  // Der Dialog liegt bei fixed inset-0 – alle Klicks innerhalb des Dialogs
  // benötigen force:true, da Playwright andernfalls die Dialog-Backdrop als
  // "intercepts pointer events" meldet.
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Weiter" }).click({ force: true });
  await dialog.getByRole("button", { name: "Weiter" }).click({ force: true });
  await dialog.getByLabel("Geben Sie WERKSRESET ein, um das komplette System zu löschen.").fill("WERKSRESET");

  // window.location.reload() wird von der App nach dem Reset ausgeführt
  await Promise.all([
    page.waitForEvent("load"),
    dialog.getByRole("button", { name: "Endgültig löschen" }).click({ force: true })
  ]);

  // Store muss vollständig hydriert sein (kein "Laden…" mehr)
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  // 3. Nach Reset: localStorage-Zustand muss leer sein

  const state = await page.evaluate(() => {
    const raw = window.localStorage.getItem("primaq-control-mvp-state");
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  });

  // Maschinen müssen leer sein
  expect(Array.isArray(state?.machines) ? (state.machines as unknown[]).length : 0).toBe(0);
  // generalStock muss leer sein
  expect(Object.keys((state?.generalStock as Record<string, unknown>) ?? {})).toHaveLength(0);
  // materialCategories muss leer sein
  expect(Array.isArray(state?.materialCategories) ? (state.materialCategories as unknown[]).length : 0).toBe(0);
  // materialItems muss leer sein
  expect(Object.keys((state?.materialItems as Record<string, unknown>) ?? {})).toHaveLength(0);
  // activeShift muss null sein
  expect(state?.activeShift ?? null).toBeNull();

  // 4. Alle Seiten müssen leeren Zustand zeigen

  // /einstellungen – keine Maschinen
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).not.toBeVisible();

  // /lager – keine Lagerkarten
  await page.goto("/lager");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
  await expect(page.getByText("Vanille FR Pulver")).not.toBeVisible();
  await expect(page.getByText("FR Kategorie")).not.toBeVisible();

  // /verkauf – keine Verkaufskacheln, kein aktiver Einsatz
  await page.goto("/verkauf");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
  await expect(page.getByTestId(`sale-machine-${machineId}`)).not.toBeVisible();
  await expect(page.getByTestId("checkout-shift-warning")).toContainText("Kein aktiver Einsatz");

  // /einsatzuebersicht – Neue-Einsatz-Button sichtbar, kein alter Einsatz
  await page.goto("/einsatzuebersicht");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
  await expect(page.getByTestId("new-shift-button")).toBeVisible();
});
