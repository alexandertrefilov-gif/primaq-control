import { expect, test } from "@playwright/test";

const machineId = "machine_p2m3";
const productId = `${machineId}_sort_1`;
const orderItemId = `${productId}_Becher`;

const machine = {
  id: machineId,
  number: "1",
  name: "Gelmatic P2.3",
  manualName: false,
  location: "Wagen",
  active: true,
  visibleInSale: true,
  products: [
    {
      id: productId,
      machineId,
      machineName: "Gelmatic P2.3",
      name: "Erdbeer",
      priceCents: 500,
      vatRate: 7,
      aroma: "Erdbeer",
      packagingType: "Becher",
      packagingSize: "mittel",
      portionGrams: 120,
      spoonIncluded: true,
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
      if (window.sessionStorage.getItem("primaq-p2-punkt3-seeded") === "true") {
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
          shiftMaterialAssignments: [],
          sumupSettings: { enabled: true, paymentLink: "", hintText: "" },
          generalStock: {
            gs_erdbeer: { id: "gs_erdbeer", flavorId: "erdbeer", productName: "Erdbeer", flavorName: "Erdbeer", recipe: { powderKgPerBatch: 2, waterLitersPerBatch: 4, mixLitersPerBatch: 6, packageKg: 2 }, unit: "Pkg", quantityOnHand: 100, purchasePriceCents: null, active: true, createdAt: "2026-01-01T00:00:00.000Z", lastUpdatedAt: "2026-01-01T00:00:00.000Z" }
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
      window.sessionStorage.setItem("primaq-p2-punkt3-seeded", "true");
    },
    { machine }
  );
});

test("PHASE 2 Punkt 3 Betreiber-Test: Bar/Karte/QR konsistent in Einsatzuebersicht, Dashboard, Abschluss und CSV", async ({ page }) => {
  // 1. Lager: Seite ist erreichbar
  await page.goto("/lager");
  await expect(page.getByRole("heading", { name: "Pulver-Lager" })).toBeVisible();

  // 2. Einsatz starten
  await page.goto("/einsatzuebersicht");
  await page.getByTestId("new-shift-button").click();
  await page.getByTestId("shift-event-input").fill("P3 Kennzahlen-Test");
  await page.getByTestId("shift-employee-1").fill("Tester");
  await page.getByTestId("shift-starting-cash-input").fill("100,00");
  const pkgInput = page.locator("div").filter({ hasText: /^Pkg$/ }).getByRole("textbox");
  await pkgInput.fill("1");
  await page.getByTestId("shift-start-button").click();
  await expect(page.getByTestId("shift-overview-table")).toContainText("P3 Kennzahlen-Test");

  // 3. Verkauf: ein Bar-Verkauf und ein QR-Verkauf (je 5,00 EUR)
  await page.goto("/verkauf");

  // 3a. Bar-Verkauf
  await page.getByTestId(`sale-add-${orderItemId}`).click();
  await expect(page.getByTestId(`order-item-${orderItemId}`)).toContainText("Erdbeer");
  await page.getByTestId("payment-cash-button").click();
  await page.getByTestId("cash-quick-add-1000").click();
  await expect(page.getByTestId("checkout-button")).toBeEnabled();
  await page.getByTestId("checkout-button").click();

  // 3b. QR-Verkauf (SumUp) - bisher war "Zahlung bestaetigt" wegen Punkt 3 Befund 2 dauerhaft deaktiviert
  await page.getByTestId(`sale-add-${orderItemId}`).click();
  await expect(page.getByTestId(`order-item-${orderItemId}`)).toContainText("Erdbeer");
  await page.getByTestId("payment-qr-button").click();
  await expect(page.getByText("QR-Zahlung")).toBeVisible();
  const qrConfirmButton = page.getByRole("button", { name: "✓ Zahlung bestätigt" });
  await expect(qrConfirmButton).toBeEnabled();
  await qrConfirmButton.click();

  // 4. Einsatzuebersicht (aktiver Einsatz): Bar + Karte = Umsatz brutto, QR zaehlt als Karte
  await page.goto("/einsatzuebersicht");
  const summaryRow = page.getByTestId("shift-overview-table").locator("tr", { hasText: "Einsatz-Summe" });
  await expect(summaryRow.locator("td:nth-last-child(5)")).toContainText("5,00"); // Bar
  await expect(summaryRow.locator("td:nth-last-child(4)")).toContainText("5,00"); // Karte (inkl. QR)
  await expect(summaryRow.locator("td:nth-last-child(3)")).toContainText("10,00"); // Umsatz brutto

  // 5. Dashboard: dieselben Zahlen wie Einsatzuebersicht
  await page.goto("/dashboard");
  const dashboardBar = page.locator("p", { hasText: /^Bar$/ }).locator("xpath=following-sibling::p[1]");
  const dashboardKarte = page.locator("p", { hasText: /^Karte$/ }).locator("xpath=following-sibling::p[1]");
  await expect(dashboardBar).toContainText("5,00");
  await expect(dashboardKarte).toContainText("5,00");

  // 6. Abschluss: Bruttoumsatz, Bar/Karte und Differenz korrekt
  await page.goto("/abschluss");
  await page.getByTestId("day-close-end-cash-input").fill("105,00");
  await page.getByTestId("day-close-create-report-button").click();
  await expect(page.getByTestId("tax-gross")).toContainText("10,00");
  const abschlussBar = page.locator("p", { hasText: /^Bar$/ }).locator("xpath=following-sibling::p[1]");
  const abschlussKarte = page.locator("p", { hasText: /^Karte$/ }).locator("xpath=following-sibling::p[1]");
  const abschlussDifferenz = page.locator("p", { hasText: /^Differenz$/ }).locator("xpath=following-sibling::p[1]");
  await expect(abschlussBar).toContainText("5,00");
  await expect(abschlussKarte).toContainText("5,00");
  await expect(abschlussDifferenz).toContainText("0,00");

  // 7. Reload darf Umsatz/Verkaeufe nicht verfaelschen
  await page.reload();
  await expect(page.getByTestId("tax-gross")).toContainText("10,00");
  await expect(abschlussBar).toContainText("5,00");
  await expect(abschlussKarte).toContainText("5,00");

  // 8. CSV enthaelt konsistente Bar/Karte/Bruttoumsatz-Werte
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Bericht als CSV exportieren/ }).click();
  const download = await downloadPromise;
  const csvPath = await download.path();
  expect(csvPath).toBeTruthy();
  const fs = await import("fs");
  const csvContent = await fs.promises.readFile(csvPath!, "utf-8");
  expect(csvContent).toMatch(/"Bar";"5,00\s*€"/);
  expect(csvContent).toMatch(/"Karte";"5,00\s*€"/);
  expect(csvContent).toMatch(/"Bruttoumsatz";"10,00\s*€"/);
});
