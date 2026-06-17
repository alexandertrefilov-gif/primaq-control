import { expect, test } from "@playwright/test";

const machineId = "machine_p2m2";
const sort1Id = `${machineId}_sort_1`; // Vanille -> Sorte A
const sort2Id = `${machineId}_sort_2`; // Schoko -> Sorte B
const sort3Id = `${machineId}_sort_3`; // Beerentraum -> soll per Feld zur Mix-Sorte werden (kein "Mix" im Namen)
const sort4Id = `${machineId}_sort_4`; // Mixbecher Spezial -> Bestandslogik (Name enthaelt "Mix"), wird per Feld zurueckgesetzt

function buildProduct(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    machineId,
    machineName: "Gelmatic P2.2",
    name,
    priceCents: 450,
    vatRate: 7,
    aroma: name,
    packagingType: "Becher",
    packagingSize: "mittel",
    portionGrams: 120,
    spoonIncluded: true,
    toppingEnabled: false,
    toppingPriceCents: 0,
    toppingVatRate: 7,
    visibleInSale: true,
    nameManuallyEdited: true,
    ...extra
  };
}

const machine = {
  id: machineId,
  number: "1",
  name: "Gelmatic P2.2",
  manualName: false,
  location: "Wagen",
  active: true,
  visibleInSale: true,
  products: [
    buildProduct(sort1Id, "Vanille", { slot: "A" }),
    buildProduct(sort2Id, "Schoko", { slot: "B" }),
    buildProduct(sort3Id, "Beerentraum"),
    buildProduct(sort4Id, "Mixbecher Spezial")
  ]
};

test.beforeEach(async ({ page }) => {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => { /* fake-open: Realtime denkt verbunden, empfängt keine Events */ });
  await page.addInitScript(
    ({ machine }) => {
      if (window.sessionStorage.getItem("primaq-p2-punkt2-seeded") === "true") {
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
          materialCategories: [],
          materialItems: {},
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
      window.sessionStorage.setItem("primaq-p2-punkt2-seeded", "true");
    },
    { machine }
  );
});

test("PHASE 2 Punkt 2 Betreiber-Test: Mix-Sorte ohne Namenskonvention konfigurieren und verkaufen", async ({ page }) => {
  // 1. Einstellungen: "Mixbecher Spezial" ist per Namenskonvention (Bestandslogik) bereits Mix-Sorte
  await page.goto("/einstellungen");

  // Mix-Sorte-Toggle liegt jetzt unter "Erweiterte Einstellungen" (eingeklappt) - vorher oeffnen
  const sort3Card = page.getByTestId(`machine-product-card-${sort3Id}`);
  await sort3Card.getByRole("button", { name: /Erweiterte Einstellungen/ }).click();
  const sort3Toggle = sort3Card.getByTestId(`machine-product-mix-toggle-${sort3Id}`);

  const sort4Card = page.getByTestId(`machine-product-card-${sort4Id}`);
  await sort4Card.getByRole("button", { name: /Erweiterte Einstellungen/ }).click();
  const sort4Toggle = sort4Card.getByTestId(`machine-product-mix-toggle-${sort4Id}`);

  await expect(sort4Toggle).toBeChecked();

  // "Beerentraum" enthaelt kein "Mix" im Namen und ist bisher KEINE Mix-Sorte
  await expect(sort3Toggle).not.toBeChecked();

  // Betreiber markiert "Beerentraum" explizit als Mix-Sorte (50% A + 50% B) - ohne Namensaenderung
  await sort3Toggle.check();
  await expect(sort3Toggle).toBeChecked();
  await expect.poll(async () =>
    page.evaluate((id) => {
      const state = JSON.parse(window.localStorage.getItem("primaq-control-mvp-state") || "{}");
      return state.machines?.[0]?.products?.find((p: { id: string }) => p.id === id)?.slot;
    }, sort3Id)
  ).toBe("MIX");

  // Betreiber entfernt den Mix-Status von "Mixbecher Spezial" trotz "Mix" im Namen
  await sort4Toggle.uncheck();
  await expect(sort4Toggle).not.toBeChecked();
  await expect.poll(async () =>
    page.evaluate((id) => {
      const state = JSON.parse(window.localStorage.getItem("primaq-control-mvp-state") || "{}");
      return state.machines?.[0]?.products?.find((p: { id: string }) => p.id === id)?.slot;
    }, sort4Id)
  ).not.toBe("MIX");

  // 2. Einsatz starten: "Beerentraum" wird als Mix (50% A + 50% B) angezeigt
  await page.goto("/einsatzuebersicht");
  await page.getByTestId("new-shift-button").click();
  await page.getByTestId("shift-event-input").fill("P2 Mix-Test");
  await page.getByTestId("shift-employee-1").fill("Tester");
  await page.getByTestId("shift-starting-cash-input").fill("100,00");
  await expect(page.getByText("Mix: 50 % A + 50 % B")).toBeVisible();

  const pkgInputs = page.locator("div").filter({ hasText: /^Pkg$/ }).getByRole("textbox");
  await expect(pkgInputs).toHaveCount(2);
  await pkgInputs.nth(0).fill("1");
  await pkgInputs.nth(1).fill("1");

  await page.getByTestId("shift-start-button").click();
  await expect(page.getByTestId("shift-overview-table")).toContainText("P2 Mix-Test");

  // 3. Verkauf: "Beerentraum" (Mix-Sorte ohne "Mix" im Namen) ist verkaufbar
  await page.goto("/verkauf");
  const orderItemId = `${sort3Id}_Becher`;
  await page.getByTestId(`sale-add-${orderItemId}`).click();
  await expect(page.getByTestId(`order-item-${orderItemId}`)).toContainText("Beerentraum");
  await page.getByTestId("payment-cash-button").click();
  await page.getByTestId("cash-quick-add-1000").click();
  await expect(page.getByTestId("checkout-button")).toBeEnabled();
  await page.getByTestId("checkout-button").click();

  // Verkauf der Mix-Sorte verbraucht je 50% von Sorte A (Vanille) und Sorte B (Schoko)
  const mixConsumption = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("primaq-control-mvp-state") || "{}");
    return (state.consumptionEntries as Array<{ inventoryItemId: string; productId: string; quantity: number }>).filter(
      (entry) => entry.inventoryItemId === "soft_mix_liter"
    );
  });
  expect(mixConsumption).toHaveLength(2);
  const flavorIds = mixConsumption.map((entry) => entry.productId).sort();
  expect(flavorIds).toEqual(["schoko", "vanille"]);
  expect(mixConsumption[0].quantity).toBeGreaterThan(0);
  expect(mixConsumption[0].quantity).toBeCloseTo(mixConsumption[1].quantity, 6);

  // 4. Abschluss: Umsatz korrekt, CSV enthaelt Verbrauch fuer beide Quell-Sorten (Vanille & Schoko)
  await page.goto("/abschluss");
  await page.getByTestId("day-close-end-cash-input").fill("100,00");
  await page.getByTestId("day-close-create-report-button").click();
  await expect(page.getByTestId("tax-gross")).toContainText("4,50");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Bericht als CSV exportieren/ }).click();
  const download = await downloadPromise;
  const csvPath = await download.path();
  expect(csvPath).toBeTruthy();
  const fs = await import("fs");
  const csvContent = await fs.promises.readFile(csvPath!, "utf-8");
  expect(csvContent).toMatch(/"Softeis Vanille Verbrauch";"0?\.\d+ L"/);
  expect(csvContent).toMatch(/"Softeis Schoko Verbrauch";"0?\.\d+ L"/);
});
