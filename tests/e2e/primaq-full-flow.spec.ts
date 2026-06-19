import { expect, test, type Page } from "@playwright/test";

const storageKey = "primaq-control-mvp-state";
const completedOrdersStorageKey = "primaq-control-completed-orders";

const machineId = "machine_e2e";
const productId = "machine_e2e_sort_1";
const orderItemId = `${productId}_Waffel`;

type StoredOrder = {
  id: string;
  status: "completed" | "correction";
  paymentMethod: "cash" | "card";
  originalOrderId?: string;
  correctionReason?: string;
  totalGrossCents: number;
  totalQuantity: number;
};

const e2eMachine = {
  id: machineId,
  number: "1",
  name: "Gelmatic 1",
  manualName: false,
  location: "Wagen",
  active: true,
  visibleInSale: true,
  products: [
    {
      id: productId,
      machineId,
      machineName: "Gelmatic 1",
      name: "Vanille",
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
  // Prevent Supabase cloud sync from overriding test-seeded localStorage state.
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => { /* fake-open: Realtime denkt verbunden, empfängt keine Events */ });
  await page.addInitScript(
    ({ machine }) => {
      if (window.sessionStorage.getItem("primaq-e2e-seeded") === "true") {
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
          generalStock: {
            gs_vanille: { id: "gs_vanille", flavorId: "vanille", productName: "Vanille", flavorName: "Vanille", recipe: { powderKgPerBatch: 2, waterLitersPerBatch: 4, mixLitersPerBatch: 6, packageKg: 2 }, unit: "Pkg", quantityOnHand: 100, purchasePriceCents: null, active: true, createdAt: "2026-01-01T00:00:00.000Z", lastUpdatedAt: "2026-01-01T00:00:00.000Z" }
          }
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
      window.sessionStorage.setItem("primaq-e2e-seeded", "true");
    },
    { machine: e2eMachine }
  );
});

test("PrimaQ full cash-system flow with tax, snapshots, overview and cancellation", async ({ page }) => {
  await page.goto("/verkauf");
  await expect(page.getByText("Kein aktiver Einsatz vorhanden.")).toHaveCount(0);
  await expect(page.getByTestId("checkout-shift-warning")).toContainText("Kein aktiver Einsatz");
  await expect(page.getByTestId("checkout-button")).toBeDisabled();

  await page.goto("/einsatzuebersicht");
  await expect(page.locator('link[rel="stylesheet"][href*="/_next/static/css/"]')).toHaveCount(1);
  await expect(page.locator("header")).toBeVisible();
  await expect(page.locator("nav")).toBeVisible();

  const headerBackground = await page.locator("header").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(headerBackground).not.toBe("rgba(0, 0, 0, 0)");

  await page.getByTestId("new-shift-button").click();
  await page.getByTestId("shift-event-input").fill("E2E Stadtfest");
  await page.getByTestId("shift-employee-1").fill("Ada");
  await page.getByTestId("shift-starting-cash-input").fill("150,00");
  await page.locator("div").filter({ hasText: /^Pkg$/ }).getByRole("textbox").fill("1");
  await page.getByTestId("shift-start-button").click();
  await expect(page.getByTestId("shift-overview-table")).toContainText("E2E Stadtfest");

  await page.goto("/verkauf");
  await expect(page.getByTestId(`sale-machine-${machineId}`)).toContainText("MASCHINE 1");
  await expect(page.getByTestId(`sale-machine-${machineId}`)).toContainText("Vanille");
  const saleProductButton = page.getByTestId(`sale-add-${orderItemId}`);

  await saleProductButton.click();
  await saleProductButton.click();
  await expect(page.getByTestId(`order-item-${orderItemId}`)).toContainText("Vanille");
  await expect(page.getByTestId("payment-panel")).toContainText(/10,00\s*€/);
  await page.getByTestId("payment-cash-button").click();
  await page.getByTestId("cash-quick-add-5000").click();
  await page.getByTestId("cash-quick-add-2000").click();
  await page.getByTestId("cash-quick-add-1000").click();
  await page.getByTestId("cash-quick-add-2000").click();
  await expect(page.getByTestId("cash-received-input")).toHaveValue("100");
  await expect(page.getByTestId("checkout-button")).toBeEnabled();
  await page.getByTestId("cash-received-reset-button").click();
  await expect(page.getByTestId("cash-received-input")).toHaveValue("");
  await expect(page.getByTestId("checkout-button")).toBeDisabled();
  await page.getByTestId("cash-quick-add-10000").click();
  await page.getByTestId("cash-quick-add-10000").click();
  await expect(page.getByTestId("cash-received-input")).toHaveValue("200");
  await expect(page.getByTestId("checkout-button")).toBeEnabled();
  await page.getByTestId("checkout-button").click();

  await expect.poll(() => completedOrders(page).then((orders) => orders.length)).toBe(1);

  await saleProductButton.click();
  await page.getByTestId("payment-card-button").click();
  await expect(page.getByTestId("payment-panel")).toContainText(/5,00\s*€/);
  await expect(page.getByTestId("checkout-button")).toBeEnabled();
  await page.getByTestId("checkout-button").click();

  await expect.poll(() => completedOrders(page).then((orders) => orders.length)).toBe(2);

  await page.goto("/abschluss");
  await page.getByTestId("day-close-end-cash-input").fill("160,00");
  await page.getByTestId("day-close-create-report-button").click();
  await expect(page.getByTestId("day-report-preview")).toContainText(/Umsatz gesamt:\s*15,00\s*€/);
  await expect(page.getByTestId("tax-gross")).toContainText(/15,00\s*€/);
  await expect(page.getByTestId("tax-net")).toContainText(/14,01\s*€/);
  await expect(page.getByTestId("tax-vat")).toContainText(/0,99\s*€/);

  await expect.poll(() => latestReport(page)).toMatchObject({
    totals: {
      expectedRevenueCents: 1500,
      cashCents: 1000,
      cardCents: 500,
      totalPieces: 3
    },
    taxReport: {
      grossCents: 1500,
      netCents: 1401,
      vatCents: 99
    }
  });

  await page.goto("/einsatzuebersicht");
  const overviewTable = page.getByTestId("shift-overview-table");
  const machineRow = page.getByTestId(`shift-overview-machine-row-${machineId}`);
  await expect(overviewTable).toContainText("Vanille");
  await expect(machineRow).toContainText("Gelmatic 1");
  await expect(page.getByTestId(`shift-overview-pieces-${machineId}`)).toHaveText("3");
  await expect(machineRow).toContainText(/15,00\s*€/);

  await page.goto("/einstellungen");
  await page.getByTestId(`machine-number-input-${machineId}`).fill("9");
  await page.getByTestId(`machine-product-name-input-${productId}`).fill("Schoko Neu");

  await page.goto("/einsatzuebersicht");
  await expect(page.getByTestId("shift-overview-table")).toContainText("Vanille");
  await expect(page.getByTestId(`shift-overview-machine-row-${machineId}`)).toContainText("Gelmatic 1");
  await expect(page.getByTestId("shift-overview-table")).not.toContainText("Schoko Neu");

  const cardOrder = (await completedOrders(page)).find((order) => order.paymentMethod === "card");
  expect(cardOrder, "card order must exist before cancellation").toBeTruthy();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Grund");
    await dialog.accept("E2E Storno Karte");
  });
  await page.goto("/bestellung");
  await page.getByTestId(`cancel-order-${cardOrder!.id}`).click();
  await expect(page.getByTestId("corrections-panel")).toContainText("E2E Storno Karte");

  await page.goto("/abschluss");
  await page.getByTestId("day-close-end-cash-input").fill("160,00");
  await page.getByTestId("day-close-create-report-button").click();
  await expect(page.getByTestId("day-report-preview")).toContainText(/Umsatz gesamt:\s*10,00\s*€/);

  const correctedReport = await latestReport(page);
  expect(correctedReport.totals.expectedRevenueCents).toBe(1000);
  expect(correctedReport.totals.cashCents).toBe(1000);
  expect(correctedReport.totals.cardCents).toBe(0);
  expect(correctedReport.totals.totalPieces).toBe(2);
  expect(correctedReport.taxReport.grossCents).toBe(1000);
  expect(correctedReport.taxReport.netCents).toBe(934);
  expect(correctedReport.taxReport.vatCents).toBe(66);
  expect((await persistedReports(page))).toHaveLength(1);

  const correctionOrder = (await completedOrders(page)).find((order) => order.status === "correction");
  expect(correctionOrder).toMatchObject({
    originalOrderId: cardOrder!.id,
    correctionReason: "E2E Storno Karte",
    totalGrossCents: -500,
    totalQuantity: -1
  });

  await page.goto("/einsatzuebersicht");
  await page.getByRole("button", { name: /Loeschen/ }).first().click();
  await expect(page.getByText("Dieser Einsatz enthält bereits Verkäufe. Wirklich löschen?")).toBeVisible();
  await page.getByTestId("confirm-delete-shift").click();
  await expect(page.getByTestId("shift-overview-table")).not.toContainText("E2E Stadtfest");
  await expect(page.getByText(`Keine Einsaetze fuer ${new Date().getFullYear()} vorhanden.`)).toBeVisible();

  await page.goto("/verkauf");
  await expect(page.getByTestId("checkout-shift-warning")).toContainText("Kein aktiver Einsatz");
  await expect(page.getByTestId("checkout-button")).toBeDisabled();
});

async function latestReport(page: Page) {
  await page.waitForFunction((key) => {
    const state = JSON.parse(window.localStorage.getItem(key) || "{}");
    return Boolean(state.dayReport?.taxReport);
  }, storageKey);

  return page.evaluate((key) => {
    const state = JSON.parse(window.localStorage.getItem(key) || "{}");
    return state.dayReport;
  }, storageKey);
}

async function persistedReports(page: Page) {
  await page.waitForFunction((key) => {
    const state = JSON.parse(window.localStorage.getItem(key) || "{}");
    return Array.isArray(state.reports) && state.reports.length > 0;
  }, storageKey);

  return page.evaluate((key) => {
    const state = JSON.parse(window.localStorage.getItem(key) || "{}");
    return state.reports ?? [];
  }, storageKey);
}

async function completedOrders(page: Page): Promise<StoredOrder[]> {
  await page.waitForFunction((key) => {
    const raw = window.localStorage.getItem(key);
    return raw !== null;
  }, completedOrdersStorageKey);

  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || "[]"), completedOrdersStorageKey);
}
