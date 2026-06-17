import { expect, test } from "@playwright/test";
import fs from "fs";

const machineId = "machine_p2m1";
const productId = "machine_p2m1_sort_1";
const orderItemId = `${productId}_Waffel`;
const materialItemId = "material_p2m1_waffel";
const materialCategoryId = "cat_p2m1";
const materialItemName = "Waffeln Betreiber-Test";
const materialCategoryName = "P2 Verkaufsmaterial";

const machine = {
  id: machineId,
  number: "1",
  name: "Gelmatic P2",
  manualName: false,
  location: "Wagen",
  active: true,
  visibleInSale: true,
  products: [
    {
      id: productId,
      machineId,
      machineName: "Gelmatic P2",
      name: "Vanille P2",
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

const materialItem = {
  id: materialItemId,
  name: materialItemName,
  unit: "Stk.",
  quantityOnHand: 50,
  minQuantity: 5,
  purchasePriceCents: 10,
  active: true,
  createdAt: new Date().toISOString(),
  saleTag: "Waffel"
};

const materialCategory = {
  id: materialCategoryId,
  name: materialCategoryName,
  itemIds: [materialItemId]
};

test.beforeEach(async ({ page }) => {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => { /* fake-open: Realtime denkt verbunden, empfängt keine Events */ });
  await page.addInitScript(
    ({ machine, materialItem, materialCategory }) => {
      if (window.sessionStorage.getItem("primaq-p2-punkt1-seeded") === "true") {
        return;
      }

      window.localStorage.clear();
      window.localStorage.setItem("primaq-control-machines", JSON.stringify([machine]));
      window.localStorage.setItem(
        "primaq-control-mvp-state",
        JSON.stringify({
          productConfigVersion: 4,
          activeShift: null,
          transactions: [],
          dailySales: { orders: [] },
          completedOrders: [],
          consumptionEntries: [],
          machines: [machine],
          reports: [],
          dayReport: null,
          materialCategories: [materialCategory],
          materialItems: { [materialItem.id]: materialItem },
          shiftMaterialAssignments: []
        })
      );
      window.localStorage.setItem(
        "primaq-control-open-orders",
        JSON.stringify([
          {
            id: "order_1",
            title: "Bestellung 1",
            items: [],
            paymentMethod: "cash",
            cashReceivedCents: 0,
            totalGrossCents: 0,
            vatCents: 0,
            changeDueCents: 0
          }
        ])
      );
      window.localStorage.setItem("primaq-control-active-order-id", JSON.stringify("order_1"));
      window.localStorage.setItem("primaq-control-daily-sales", JSON.stringify({ orders: [] }));
      window.localStorage.setItem("primaq-control-completed-orders", JSON.stringify([]));
      window.sessionStorage.setItem("primaq-p2-punkt1-seeded", "true");
    },
    { machine, materialItem, materialCategory }
  );
});

test("PHASE 2 Punkt 1 Betreiber-Test: Lager -> Einsatz -> Verkauf -> Abschluss -> CSV (automatischer Materialverbrauch)", async ({ page }) => {
  // 1. Lager: Ausgangsbestand sichtbar, KEINE manuelle Zuweisung
  await page.goto("/lager");
  await page.getByRole("button", { name: new RegExp(materialCategoryName) }).click();
  await expect(page.getByText(materialItemName)).toBeVisible();
  await expect(page.getByText(/^50\s*Stk\.$/)).toBeVisible();
  await page.getByRole("button", { name: "✕" }).first().click();

  // 2. Einsatz starten (keine manuelle Materialzuweisung!) inkl. Pulver-Startbestand,
  // damit der Verkauf nicht wegen "Vanille P2 ist leer" blockiert wird.
  await page.goto("/einsatzuebersicht");
  await page.getByTestId("new-shift-button").click();
  await page.getByTestId("shift-event-input").fill("P2 Betreiber-Test");
  await page.getByTestId("shift-employee-1").fill("Tester");
  await page.getByTestId("shift-starting-cash-input").fill("100,00");
  const mixStartInput = page.locator("div").filter({ hasText: /^Pkg$/ }).getByRole("textbox");
  await mixStartInput.fill("1");
  await page.getByTestId("shift-start-button").click();
  await expect(page.getByTestId("shift-overview-table")).toContainText("P2 Betreiber-Test");

  // 3. Verkauf: 1 Waffel-Produkt verkaufen
  await page.goto("/verkauf");
  const saleProductButton = page.getByTestId(`sale-add-${orderItemId}`);
  await saleProductButton.click();
  await expect(page.getByTestId(`order-item-${orderItemId}`)).toContainText("Vanille P2");
  await page.getByTestId("payment-cash-button").click();
  await page.getByTestId("cash-quick-add-1000").click();
  await expect(page.getByTestId("checkout-button")).toBeEnabled();
  await page.getByTestId("checkout-button").click();

  // Waffelbestand muss automatisch um 1 reduziert sein (50 -> 49), ohne manuelle Zuweisung
  await expect.poll(async () =>
    page.evaluate((id) => {
      const state = JSON.parse(window.localStorage.getItem("primaq-control-mvp-state") || "{}");
      return state.materialItems?.[id]?.quantityOnHand;
    }, materialItemId)
  ).toBe(49);

  const assignmentsAfterSale = await page.evaluate(
    () => JSON.parse(window.localStorage.getItem("primaq-control-mvp-state") || "{}").shiftMaterialAssignments
  );
  expect(assignmentsAfterSale).toHaveLength(1);
  expect(assignmentsAfterSale[0]).toMatchObject({
    itemId: materialItemId,
    assignedQty: 1,
    consumedQty: 1,
    returnedQty: 0,
    lossQty: 0,
    autoTracked: true
  });

  // 4. Lager nach Verkauf: Verbrauch sichtbar, Restbestand korrekt
  await page.goto("/lager");
  await page.getByRole("button", { name: new RegExp(materialCategoryName) }).click();
  await expect(page.getByText(/Lagerbestand:\s*49\s*Stk\./)).toBeVisible();
  await expect(page.getByText(/Verbraucht:\s*−1\s*Stk\./)).toBeVisible();
  await page.getByRole("button", { name: "✕" }).first().click();

  // 5. Abschluss: Materialverbrauch sichtbar
  await page.goto("/abschluss");
  await page.getByTestId("day-close-end-cash-input").fill("100,00");
  await page.getByTestId("day-close-create-report-button").click();
  await expect(page.getByText("Verpackung & Material")).toBeVisible();
  await expect(page.getByText(materialItemName)).toBeVisible();
  await expect(page.getByText(/Verbraucht:\s*1\s*Stk\./)).toBeVisible();

  // 6. CSV-Export enthaelt Materialverbrauch
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Bericht als CSV exportieren/ }).click();
  const download = await downloadPromise;
  const csvPath = await download.path();
  expect(csvPath).toBeTruthy();
  const csvContent = await fs.promises.readFile(csvPath!, "utf-8");
  expect(csvContent).toContain(`Material ${materialItemName} Zugewiesen`);
  expect(csvContent).toContain(`Material ${materialItemName} Kosten`);
  expect(csvContent).toContain('"1 Stk."');
});
