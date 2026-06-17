import { expect, test } from "@playwright/test";

const machineId = "machine_del_test";
const productId = `${machineId}_sort_1`;
const machineIdB = "machine_del_b";

const machine = {
  id: machineId,
  number: "1",
  name: "Del Testmaschine",
  manualName: false,
  location: "Wagen",
  active: true,
  visibleInSale: true,
  products: [
    {
      id: productId,
      machineId,
      machineName: "Del Testmaschine",
      name: "Vanille Del",
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

test.beforeEach(async ({ page }) => {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => { /* fake-open: Realtime denkt verbunden, empfängt keine Events */ });
  await page.addInitScript(
    ({ machine }) => {
      if (window.sessionStorage.getItem("primaq-del-seeded") === "true") return;

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
          generalStock: {},
          generalStockMovements: {},
          inventoryMovements: {},
          materialCategories: [],
          materialItems: {},
          shiftMaterialAssignments: [],
          sumupSettings: { enabled: false, paymentLink: "", hintText: "" },
          favorites: []
        })
      );
      window.localStorage.setItem(
        "primaq-control-open-orders",
        JSON.stringify([{ id: "order_del_1", title: "Bestellung 1", items: [], paymentMethod: "cash", cashReceivedCents: 0, totalGrossCents: 0, vatCents: 0, changeDueCents: 0 }])
      );
      window.localStorage.setItem("primaq-control-active-order-id", JSON.stringify("order_del_1"));
      window.localStorage.setItem("primaq-control-daily-sales", JSON.stringify({ orders: [] }));
      window.localStorage.setItem("primaq-control-completed-orders", JSON.stringify([]));
      window.sessionStorage.setItem("primaq-del-seeded", "true");
    },
    { machine }
  );
});

test("Maschine löschen entfernt sie sofort und nach Reload dauerhaft", async ({ page }) => {
  // 1. Vor dem Löschen: Maschine sichtbar
  await page.goto("/einstellungen");
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  // 2. Maschine löschen
  await page.getByRole("button", { name: "Maschine löschen" }).click();

  // 3. Sofort nach Klick: Maschine aus dem UI verschwunden
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).not.toBeVisible();

  // 4. localStorage muss bereits aktualisiert sein (ohne Reload)
  const machinesInStorage = await page.evaluate(() => {
    const raw = window.localStorage.getItem("primaq-control-machines");
    return raw ? (JSON.parse(raw) as unknown[]) : null;
  });
  expect(machinesInStorage).toHaveLength(0);

  const stateInStorage = await page.evaluate(() => {
    const raw = window.localStorage.getItem("primaq-control-mvp-state");
    return raw ? (JSON.parse(raw) as { machines: unknown[] }) : null;
  });
  expect(stateInStorage?.machines ?? []).toHaveLength(0);

  // 5. Nach Reload: Maschine darf nicht wiederkehren
  await page.reload();
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  await expect(page.getByTestId(`machine-number-input-${machineId}`)).not.toBeVisible();

  // localStorage auch nach Reload korrekt leer
  const machinesAfterReload = await page.evaluate(() => {
    const raw = window.localStorage.getItem("primaq-control-machines");
    return raw ? (JSON.parse(raw) as unknown[]) : [];
  });
  expect(machinesAfterReload).toHaveLength(0);

  // 6. /verkauf zeigt keine Maschinen-Kachel mehr
  await page.goto("/verkauf");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
  await expect(page.getByTestId(`sale-machine-${machineId}`)).not.toBeVisible();
});

// Zweite Maschine für die folgenden Tests
const machineB = {
  id: machineIdB,
  number: "2",
  name: "Gelmatic 2",
  manualName: false,
  location: "Wagen",
  active: true,
  visibleInSale: true,
  products: []
};

// Seed-Funktion für zwei Maschinen mit sessionStorage-Guard (reload-safe)
function seedTwoMachinesFn({ mA, mB, guardKey }: { mA: object; mB: object; guardKey: string }) {
  if (window.sessionStorage.getItem(guardKey) === "true") return;
  window.localStorage.clear();
  window.localStorage.setItem("primaq-control-machines", JSON.stringify([mA, mB]));
  window.localStorage.setItem(
    "primaq-control-mvp-state",
    JSON.stringify({
      productConfigVersion: 4,
      machines: [mA, mB],
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
      materialCategories: [],
      materialItems: {},
      shiftMaterialAssignments: [],
      sumupSettings: { enabled: false, paymentLink: "", hintText: "" },
      favorites: []
    })
  );
  window.localStorage.setItem("primaq-control-open-orders", JSON.stringify([]));
  window.localStorage.setItem("primaq-control-active-order-id", JSON.stringify(null));
  window.localStorage.setItem("primaq-control-daily-sales", JSON.stringify({ orders: [] }));
  window.localStorage.setItem("primaq-control-completed-orders", JSON.stringify([]));
  window.sessionStorage.setItem(guardKey, "true");
}

test("Maschine löschen: BroadcastChannel-Update in Tab 2 bleibt nach dessen Reload stabil", async ({ page, context }) => {
  // Tab 1 (Mac): Override des beforeEach-Seeds auf zwei Maschinen
  await page.addInitScript(seedTwoMachinesFn, { mA: machine, mB: machineB, guardKey: "primaq-del-twotab-p1" });
  await page.goto("/einstellungen");
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();
  await expect(page.getByTestId(`machine-number-input-${machineIdB}`)).toBeVisible();

  // Tab 2 (iPad): eigener Seed mit beiden Maschinen + eigenem Guard
  const page2 = await context.newPage();
  await page2.route(/supabase\.co/, (route) => route.abort());
  await page2.routeWebSocket(/supabase\.co/, () => { /* fake-open */ });
  await page2.addInitScript(seedTwoMachinesFn, { mA: machine, mB: machineB, guardKey: "primaq-del-twotab-p2" });
  await page2.goto("/einstellungen");
  await expect(page2.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();
  await expect(page2.getByTestId(`machine-number-input-${machineIdB}`)).toBeVisible();

  // Tab 1: Maschine B löschen (zweiter "Maschine löschen"-Button = index 1)
  await page.bringToFront();
  await page.getByRole("button", { name: "Maschine löschen" }).nth(1).click();
  await expect(page.getByTestId(`machine-number-input-${machineIdB}`)).not.toBeVisible();
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  // Tab 2: muss via BroadcastChannel aktualisieren – OHNE Reload
  await expect(page2.getByTestId(`machine-number-input-${machineIdB}`)).not.toBeVisible({ timeout: 4000 });
  await expect(page2.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  // Tab 2 reload: gelöschte Maschine darf nicht wiederkehren
  await page2.reload();
  await page2.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
  await expect(page2.getByTestId(`machine-number-input-${machineIdB}`)).not.toBeVisible();
  await expect(page2.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  // localStorage in Tab 2 korrekt leer (kein machine_del_b)
  const machinesAfterReload = await page2.evaluate(() => {
    const raw = window.localStorage.getItem("primaq-control-machines");
    return raw ? (JSON.parse(raw) as { id: string }[]) : [];
  });
  expect(machinesAfterReload.some((m) => m.id === "machine_del_b")).toBe(false);
  expect(machinesAfterReload.some((m) => m.id === "machine_del_test")).toBe(true);

  await page2.close();
});

test("Alle Maschinen löschen: kein automatisches Wiederherstellen nach Reload", async ({ page }) => {
  await page.goto("/einstellungen");
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  // Einzige Maschine löschen
  await page.getByRole("button", { name: "Maschine löschen" }).click();
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).not.toBeVisible();

  // localStorage: keine Maschinen
  const machinesAfterDelete = await page.evaluate(() => {
    const raw = window.localStorage.getItem("primaq-control-machines");
    return raw ? (JSON.parse(raw) as unknown[]) : null;
  });
  expect(machinesAfterDelete).toHaveLength(0);

  // Reload: keine Maschinen, kein Auto-Generate
  await page.reload();
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  // Keine machine-number-input sichtbar (keine Maschine existiert)
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).not.toBeVisible();

  // "Maschine anlegen"-Button muss sichtbar sein (Seite geladen, kein Crash)
  await expect(page.getByRole("button", { name: "Maschine anlegen" })).toBeVisible();

  // localStorage auch nach Reload korrekt leer
  const machinesAfterReload = await page.evaluate(() => {
    const raw = window.localStorage.getItem("primaq-control-machines");
    return raw ? (JSON.parse(raw) as unknown[]) : [];
  });
  expect(machinesAfterReload).toHaveLength(0);
});
