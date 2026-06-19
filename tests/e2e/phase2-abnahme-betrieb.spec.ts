import { expect, test } from "@playwright/test";
import fs from "fs";

// PHASE 2 Abnahme-Test: Vollbetrieb-Simulation eines Veranstaltungstags
// 2 Maschinen, 4 aktive Sorten + 1 Mix-Sorte (ohne "Mix" im Namen), 300 Verkaeufe
// (12 real ueber UI, 288 strukturgleich per State-Injection), Bar/Karte/QR,
// 1 Nachfuellung, Materialverbrauch, Restbestaende, Tagesabschluss, CSV.

const m1 = "m1_abnahme";
const m2 = "m2_abnahme";

const vanilleId = `${m1}_sort_1`;
const schokoId = `${m1}_sort_2`;
const mixId = `${m1}_sort_3`;
const erdbeerId = `${m2}_sort_1`;
const zitroneId = `${m2}_sort_2`;

const vanilleItem = `${vanilleId}_Becher`;
const schokoItem = `${schokoId}_Becher`;
const mixItem = `${mixId}_Becher`;
const erdbeerItem = `${erdbeerId}_Waffel`;
const zitroneItem = `${zitroneId}_Waffelbecher`;

function buildProduct(id: string, machineId: string, machineName: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    machineId,
    machineName,
    name,
    priceCents: 0,
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

const machine1 = {
  id: m1,
  number: "1",
  name: "Gelmatic Wagen 1",
  manualName: false,
  location: "Wagen",
  active: true,
  visibleInSale: true,
  products: [
    buildProduct(vanilleId, m1, "Gelmatic Wagen 1", "Vanille", { slot: "A", priceCents: 350 }),
    buildProduct(schokoId, m1, "Gelmatic Wagen 1", "Schoko", { slot: "B", priceCents: 350 }),
    // Mix-Sorte ohne "Mix" im Namen, per Feld als Mix markiert (PHASE 2 Punkt 2)
    buildProduct(mixId, m1, "Gelmatic Wagen 1", "Vanille-Schoko", {
      slot: "MIX",
      isMixVariant: true,
      aroma: "Vanille",
      priceCents: 400
    })
  ]
};

const machine2 = {
  id: m2,
  number: "2",
  name: "Gelmatic Wagen 2",
  manualName: false,
  location: "Wagen",
  active: true,
  visibleInSale: true,
  products: [
    buildProduct(erdbeerId, m2, "Gelmatic Wagen 2", "Erdbeer", {
      slot: "A",
      packagingType: "Waffel",
      portionGrams: 100,
      priceCents: 300,
      spoonIncluded: false
    }),
    buildProduct(zitroneId, m2, "Gelmatic Wagen 2", "Zitrone", {
      slot: "B",
      packagingType: "Waffelbecher",
      portionGrams: 110,
      priceCents: 450,
      spoonIncluded: false
    })
  ]
};

const materialCategory = {
  id: "cat_abnahme",
  name: "Verpackung Abnahme",
  itemIds: ["mat_becher", "mat_loeffel", "mat_waffel", "mat_waffelbecher"]
};

const materialItems = {
  mat_becher: {
    id: "mat_becher",
    name: "Becher",
    unit: "Stk.",
    quantityOnHand: 10,
    minQuantity: 5,
    purchasePriceCents: 8,
    active: true,
    createdAt: new Date().toISOString(),
    saleTag: "Becher"
  },
  mat_loeffel: {
    id: "mat_loeffel",
    name: "Löffel",
    unit: "Stk.",
    quantityOnHand: 50,
    minQuantity: 10,
    purchasePriceCents: 3,
    active: true,
    createdAt: new Date().toISOString(),
    saleTag: "Löffel"
  },
  mat_waffel: {
    id: "mat_waffel",
    name: "Waffel",
    unit: "Stk.",
    quantityOnHand: 50,
    minQuantity: 10,
    purchasePriceCents: 12,
    active: true,
    createdAt: new Date().toISOString(),
    saleTag: "Waffel"
  },
  mat_waffelbecher: {
    id: "mat_waffelbecher",
    name: "Waffelbecher",
    unit: "Stk.",
    quantityOnHand: 50,
    minQuantity: 10,
    purchasePriceCents: 15,
    active: true,
    createdAt: new Date().toISOString(),
    saleTag: "Waffelbecher"
  }
};

test.beforeEach(async ({ page }) => {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => { /* fake-open: Realtime denkt verbunden, empfängt keine Events */ });
  await page.addInitScript(
    ({ machine1, machine2, materialCategory, materialItems }) => {
      if (window.sessionStorage.getItem("primaq-p2-abnahme-seeded") === "true") {
        return;
      }

      window.localStorage.clear();
      window.localStorage.setItem("primaq-control-machines", JSON.stringify([machine1, machine2]));
      window.localStorage.setItem(
        "primaq-control-mvp-state",
        JSON.stringify({
          productConfigVersion: 4,
          activeShift: null,
          transactions: [],
          dailySales: { orders: [] },
          completedOrders: [],
          consumptionEntries: [],
          machines: [machine1, machine2],
          reports: [],
          dayReport: null,
          materialCategories: [materialCategory],
          materialItems,
          shiftMaterialAssignments: [],
          sumupSettings: { enabled: true, paymentLink: "https://pay.sumup.com/abnahme", hintText: "Bitte QR-Code mit SumUp scannen und bestaetigen" },
          generalStock: {
            gs_vanille: { id: "gs_vanille", flavorId: "vanille", productName: "Vanille", flavorName: "Vanille", recipe: { powderKgPerBatch: 2, waterLitersPerBatch: 4, mixLitersPerBatch: 6, packageKg: 2 }, unit: "Pkg", quantityOnHand: 100, purchasePriceCents: null, active: true, createdAt: "2026-01-01T00:00:00.000Z", lastUpdatedAt: "2026-01-01T00:00:00.000Z" },
            gs_schoko: { id: "gs_schoko", flavorId: "schoko", productName: "Schoko", flavorName: "Schoko", recipe: { powderKgPerBatch: 2, waterLitersPerBatch: 4, mixLitersPerBatch: 6, packageKg: 2 }, unit: "Pkg", quantityOnHand: 100, purchasePriceCents: null, active: true, createdAt: "2026-01-01T00:00:00.000Z", lastUpdatedAt: "2026-01-01T00:00:00.000Z" },
            gs_erdbeer: { id: "gs_erdbeer", flavorId: "erdbeer", productName: "Erdbeer", flavorName: "Erdbeer", recipe: { powderKgPerBatch: 2, waterLitersPerBatch: 4, mixLitersPerBatch: 6, packageKg: 2 }, unit: "Pkg", quantityOnHand: 100, purchasePriceCents: null, active: true, createdAt: "2026-01-01T00:00:00.000Z", lastUpdatedAt: "2026-01-01T00:00:00.000Z" },
            gs_zitrone: { id: "gs_zitrone", flavorId: "zitrone", productName: "Zitrone", flavorName: "Zitrone", recipe: { powderKgPerBatch: 2, waterLitersPerBatch: 4, mixLitersPerBatch: 6, packageKg: 2 }, unit: "Pkg", quantityOnHand: 100, purchasePriceCents: null, active: true, createdAt: "2026-01-01T00:00:00.000Z", lastUpdatedAt: "2026-01-01T00:00:00.000Z" }
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
      window.sessionStorage.setItem("primaq-p2-abnahme-seeded", "true");
    },
    { machine1, machine2, materialCategory, materialItems }
  );
});

async function sell(page: import("@playwright/test").Page, orderItemId: string, expectedName: string, method: "cash" | "card" | "qr") {
  await page.getByTestId(`sale-add-${orderItemId}`).click();
  await expect(page.getByTestId(`order-item-${orderItemId}`)).toContainText(expectedName);

  if (method === "cash") {
    await page.getByTestId("payment-cash-button").click();
    await page.getByTestId("cash-quick-add-1000").click();
    await expect(page.getByTestId("checkout-button")).toBeEnabled();
    await page.getByTestId("checkout-button").click();
  } else if (method === "card") {
    await page.getByTestId("payment-card-button").click();
    await expect(page.getByTestId("checkout-button")).toBeEnabled();
    await page.getByTestId("checkout-button").click();
  } else {
    await page.getByTestId("payment-qr-button").click();
    await expect(page.getByText("QR-Zahlung")).toBeVisible();
    const qrConfirm = page.getByRole("button", { name: "✓ Zahlung bestätigt" });
    await expect(qrConfirm).toBeEnabled();
    await qrConfirm.click();
  }
}

test("PHASE 2 Abnahme-Test: Vollbetrieb (2 Maschinen, 4 Sorten + Mix, 300 Verkaeufe, Bar/Karte/QR, Nachfuellung, Material, Abschluss, CSV)", async ({ page }) => {
  test.setTimeout(240_000);

  // 1. Lager: Ausgangsbestand vor Einsatzstart
  await page.goto("/lager");
  await expect(page.getByRole("heading", { name: "Pulver-Lager" })).toBeVisible();
  await page.getByRole("button", { name: /Verpackung Abnahme/ }).click();
  await expect(page.getByText("Becher", { exact: true })).toBeVisible();
  await expect(page.getByText(/^10\s*Stk\.$/)).toBeVisible();
  await expect(page.getByText(/Min:\s*5\s*Stk\./)).toBeVisible();
  await page.getByRole("button", { name: "✕" }).first().click();

  // 2. Einsatz starten: 2 Maschinen, 4 Sorten + Mix "Vanille-Schoko" (50% A + 50% B)
  await page.goto("/einsatzuebersicht");
  await page.getByTestId("new-shift-button").click();
  await page.getByTestId("shift-event-input").fill("Lichterfest Abnahme");
  await page.getByTestId("shift-employee-1").fill("Tester A");
  await page.getByTestId("shift-employee-2").fill("Tester B");
  await page.getByTestId("shift-starting-cash-input").fill("200,00");

  await expect(page.getByText("Mix: 50 % A + 50 % B")).toBeVisible();

  const pkgInputs = page.locator("div").filter({ hasText: /^Pkg$/ }).getByRole("textbox");
  await expect(pkgInputs).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await pkgInputs.nth(i).fill("1");
  }

  await page.getByTestId("shift-start-button").click();
  await expect(page.getByTestId("shift-overview-table")).toContainText("Lichterfest Abnahme");

  // 3. Nachfuellung waehrend des Einsatzes: Vanille +1 Pkg (= +6 L)
  await page.goto("/einsatz");
  const vanilleCard = page
    .locator("div")
    .filter({ hasText: "Vanille" })
    .filter({ hasText: "Startbestand" })
    .filter({ hasText: "Nachgefüllt" })
    .last();
  const refillPlusButton = vanilleCard.getByRole("button", { name: "+", exact: true }).nth(1);
  await refillPlusButton.click();

  // 4. Verkauf: 12 reale Verkaeufe ueber alle 5 Sorten, Bar/Karte/QR gemischt
  await page.goto("/verkauf");

  // Vanille x2 Bar
  await sell(page, vanilleItem, "Vanille", "cash");
  await sell(page, vanilleItem, "Vanille", "cash");

  // Schoko 1x Karte, 1x QR
  await sell(page, schokoItem, "Schoko", "card");
  await sell(page, schokoItem, "Schoko", "qr");

  // Mix "Vanille-Schoko" je 1x Bar/Karte/QR
  await sell(page, mixItem, "Vanille-Schoko", "cash");
  await sell(page, mixItem, "Vanille-Schoko", "card");
  await sell(page, mixItem, "Vanille-Schoko", "qr");

  // Erdbeer 1x Bar, 1x Karte
  await sell(page, erdbeerItem, "Erdbeer", "cash");
  await sell(page, erdbeerItem, "Erdbeer", "card");

  // Zitrone je 1x Bar/Karte/QR
  await sell(page, zitroneItem, "Zitrone", "cash");
  await sell(page, zitroneItem, "Zitrone", "card");
  await sell(page, zitroneItem, "Zitrone", "qr");

  // 5. Lager nach 12 Verkaeufen: Materialbestaende, Softeis-Restbestaende, Warnungen
  await page.goto("/lager");
  await page.getByRole("button", { name: /Verpackung Abnahme/ }).click();
  await expect(page.getByText(/Lagerbestand:\s*3\s*Stk\./)).toBeVisible(); // Becher 10 -> 3
  await expect(page.getByText(/Verbraucht:\s*−7\s*Stk\./).first()).toBeVisible(); // Becher & Loeffel je -7
  await expect(page.getByText(/Lagerbestand:\s*43\s*Stk\./)).toBeVisible(); // Loeffel 50 -> 43
  await expect(page.getByText(/Lagerbestand:\s*48\s*Stk\./)).toBeVisible(); // Waffel 50 -> 48
  await expect(page.getByText(/Verbraucht:\s*−2\s*Stk\./)).toBeVisible(); // Waffel -2
  await expect(page.getByText(/Lagerbestand:\s*47\s*Stk\./)).toBeVisible(); // Waffelbecher 50 -> 47
  await expect(page.getByText(/Verbraucht:\s*−3\s*Stk\./)).toBeVisible(); // Waffelbecher -3
  await page.getByRole("button", { name: "✕" }).first().click();

  // Softeis-Sorten (/einsatz): alle 4 mit Status "OK", kein "Bald leer"/"Nachfüllen"/"Leer"/"Notbetrieb"
  await page.goto("/einsatz");
  for (const flavorName of ["Vanille", "Schoko", "Erdbeer", "Zitrone"]) {
    const card = page
      .locator("div")
      .filter({ hasText: flavorName })
      .filter({ hasText: "Startbestand" })
      .filter({ hasText: "Nachgefüllt" })
      .last();
    const statusBadge = card.locator("span", { hasText: /^(OK|Bald leer|Nachfüllen|Leer|Notbetrieb)$/ });
    await expect(statusBadge).toHaveText("OK");
  }

  // Materialverbrauch / Softeis-Verbrauch / Restbestaende numerisch pruefen (keine negativen Bestaende)
  const stateAfter12 = await page.evaluate(() => JSON.parse(window.localStorage.getItem("primaq-control-mvp-state") || "{}"));
  expect(stateAfter12.materialItems.mat_becher.quantityOnHand).toBe(3);
  expect(stateAfter12.materialItems.mat_loeffel.quantityOnHand).toBe(43);
  expect(stateAfter12.materialItems.mat_waffel.quantityOnHand).toBe(48);
  expect(stateAfter12.materialItems.mat_waffelbecher.quantityOnHand).toBe(47);
  for (const item of Object.values(stateAfter12.materialItems) as Array<{ quantityOnHand: number }>) {
    expect(item.quantityOnHand).toBeGreaterThanOrEqual(0);
  }

  const mixConsumptionEntries = (stateAfter12.consumptionEntries as Array<{ inventoryItemId: string; productId: string; quantity: number }>).filter(
    (e) => e.inventoryItemId === "soft_mix_liter"
  );
  expect(mixConsumptionEntries).toHaveLength(15); // 2+2+(3x2)+2+3
  const consumedByFlavor: Record<string, number> = {};
  for (const e of mixConsumptionEntries) {
    consumedByFlavor[e.productId] = (consumedByFlavor[e.productId] ?? 0) + e.quantity;
  }
  // Verbrauch basiert auf defaultPortionWeights je Verpackungstyp (Becher=140g, Waffel=160g, Waffelbecher=170g),
  // NICHT auf dem im Produkt konfigurierten "portionGrams" (120/100/110g) - siehe Bericht.
  expect(consumedByFlavor["vanille"]).toBeCloseTo(0.49, 6); // 2x0,14 (direkt) + 3x0,07 (Mix-Anteil)
  expect(consumedByFlavor["schoko"]).toBeCloseTo(0.49, 6); // 2x0,14 (direkt) + 3x0,07 (Mix-Anteil)
  expect(consumedByFlavor["erdbeer"]).toBeCloseTo(0.32, 6); // 2x0,16
  expect(consumedByFlavor["zitrone"]).toBeCloseTo(0.51, 6); // 3x0,17

  const mixStocks = stateAfter12.mixStocks as Record<string, { startLiters?: number; refilledLiters?: number; correctedLiters?: number }>;
  const remainingByFlavor: Record<string, number> = {};
  for (const flavorId of ["vanille", "schoko", "erdbeer", "zitrone"]) {
    const stock = mixStocks[flavorId] ?? {};
    const start = (stock.startLiters ?? 0) + (stock.refilledLiters ?? 0) + (stock.correctedLiters ?? 0);
    remainingByFlavor[flavorId] = start - (consumedByFlavor[flavorId] ?? 0);
    expect(remainingByFlavor[flavorId]).toBeGreaterThan(0); // keine negativen Softeis-Bestaende
  }
  expect(remainingByFlavor["vanille"]).toBeCloseTo(11.51, 6); // 12 L Start (inkl. Nachfuellung) - 0.49 L
  expect(remainingByFlavor["schoko"]).toBeCloseTo(5.51, 6); // 6 L - 0.49 L
  expect(remainingByFlavor["erdbeer"]).toBeCloseTo(5.68, 6); // 6 L - 0.32 L
  expect(remainingByFlavor["zitrone"]).toBeCloseTo(5.49, 6); // 6 L - 0.51 L

  const assignmentsAfter12 = stateAfter12.shiftMaterialAssignments as Array<{ itemId: string; assignedQty: number; consumedQty: number; returnedQty: number; lossQty: number; autoTracked: boolean }>;
  const becherAssignment = assignmentsAfter12.find((a) => a.itemId === "mat_becher");
  expect(becherAssignment).toMatchObject({ assignedQty: 7, consumedQty: 7, returnedQty: 0, lossQty: 0, autoTracked: true });
  const loeffelAssignment = assignmentsAfter12.find((a) => a.itemId === "mat_loeffel");
  expect(loeffelAssignment).toMatchObject({ assignedQty: 7, consumedQty: 7 });
  const waffelAssignment = assignmentsAfter12.find((a) => a.itemId === "mat_waffel");
  expect(waffelAssignment).toMatchObject({ assignedQty: 2, consumedQty: 2 });
  const waffelbecherAssignment = assignmentsAfter12.find((a) => a.itemId === "mat_waffelbecher");
  expect(waffelbecherAssignment).toMatchObject({ assignedQty: 3, consumedQty: 3 });

  // 6. Einsatzuebersicht (12 Verkaeufe): Bar 18,50 / Karte 27,00 / Umsatz 45,50
  await page.goto("/einsatzuebersicht");
  const summaryRow = page.getByTestId("shift-overview-table").locator("tr", { hasText: "Einsatz-Summe" });
  await expect(summaryRow.locator("td:nth-last-child(5)")).toContainText("18,50"); // Bar
  await expect(summaryRow.locator("td:nth-last-child(4)")).toContainText("27,00"); // Karte (inkl. QR)
  await expect(summaryRow.locator("td:nth-last-child(3)")).toContainText("45,50"); // Umsatz brutto

  // 7. Dashboard: dieselben Zahlen wie Einsatzuebersicht
  await page.goto("/dashboard");
  const dashboardBar = page.locator("p", { hasText: /^Bar$/ }).locator("xpath=following-sibling::p[1]");
  const dashboardKarte = page.locator("p", { hasText: /^Karte$/ }).locator("xpath=following-sibling::p[1]");
  await expect(dashboardBar).toContainText("18,50");
  await expect(dashboardKarte).toContainText("27,00");

  // 8. Skalierung auf 300 Verkaeufe: 288 strukturgleiche Bestellungen injizieren (gleicher Einsatz)
  const seedResult = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("primaq-control-mvp-state") || "{}");
    const shiftId = state.activeShift?.id;
    const sample = (state.dailySales.orders as Array<Record<string, unknown>>).find(
      (o) => (o.items as Array<{ productId: string }>)?.[0]?.productId === "m1_abnahme_sort_1" && o.paymentMethod === "cash"
    );
    if (!sample || !shiftId) {
      return { ok: false as const };
    }

    const pattern = ["cash", "cash", "cash", "card", "card", "qr"];
    let nextOrderNumber = (state.dailySales.orders as unknown[]).length + 1;
    for (let i = 0; i < 288; i++) {
      const pm = pattern[i % pattern.length];
      const clone = JSON.parse(JSON.stringify(sample)) as Record<string, unknown>;
      clone.id = `seed_order_${i}`;
      clone.orderNumber = nextOrderNumber++;
      clone.paymentMethod = pm;
      if (pm === "cash") {
        clone.cashReceivedCents = sample.cashReceivedCents;
        clone.changeDueCents = sample.changeDueCents;
        clone.paidAmountCents = sample.totalGrossCents;
      } else {
        clone.cashReceivedCents = clone.totalGrossCents;
        clone.changeDueCents = 0;
        clone.paidAmountCents = clone.totalGrossCents;
      }
      // Im echten Checkout wird paymentMethod auf Order- UND Item-Ebene gleich gesetzt (use-mvp-store.ts:812) - hier nachbilden
      clone.items = (clone.items as Array<Record<string, unknown>>).map((it, idx) => ({ ...it, id: `seed_item_${i}_${idx}`, paymentMethod: pm }));
      (state.dailySales.orders as unknown[]).push(clone);
      (state.completedOrders as unknown[]).push(clone);
    }
    window.localStorage.setItem("primaq-control-mvp-state", JSON.stringify(state));
    // readStoredState() bevorzugt diese separaten Storage-Keys gegenueber mvp-state.dailySales/completedOrders
    window.localStorage.setItem("primaq-control-daily-sales", JSON.stringify(state.dailySales));
    window.localStorage.setItem("primaq-control-completed-orders", JSON.stringify(state.completedOrders));
    return { ok: true as const, ordersCount: (state.dailySales.orders as unknown[]).length };
  });
  expect(seedResult.ok).toBe(true);
  expect(seedResult.ordersCount).toBe(300);

  await page.reload();

  // 9. Dashboard nach 300 Verkaeufen: kombinierte Summen Bar 522,50 / Karte 531,00
  await page.goto("/dashboard");
  await expect(dashboardBar).toContainText("522,50");
  await expect(dashboardKarte).toContainText("531,00");

  // 10. Verkauf: Stueckzahl-Anzeige zeigt 300 (Portionen UND Verkaeufe)
  await page.goto("/verkauf");
  await expect(page.getByText("300", { exact: true })).toHaveCount(2);

  // 11. Einsatzuebersicht nach 300 Verkaeufen: gleiche Summen wie Dashboard
  await page.goto("/einsatzuebersicht");
  const summaryRowAfter = page.getByTestId("shift-overview-table").locator("tr", { hasText: "Einsatz-Summe" });
  await expect(summaryRowAfter.locator("td:nth-last-child(5)")).toContainText("522,50");
  await expect(summaryRowAfter.locator("td:nth-last-child(4)")).toContainText("531,00");
  await expect(summaryRowAfter.locator("td:nth-last-child(3)")).toContainText("1.053,50");

  // 12. Tagesabschluss: Bruttoumsatz, Bar/Karte/Differenz auf Basis der 300 Verkaeufe
  await page.goto("/abschluss");
  // Erwartetes Endgeld: Startgeld 200,00 + Bar-Umsatz 522,50 = 722,50
  await page.getByTestId("day-close-end-cash-input").fill("722,50");
  await page.getByTestId("day-close-create-report-button").click();

  await expect(page.getByTestId("tax-gross")).toContainText("1.053,50");
  const abschlussBar = page.locator("p", { hasText: /^Bar$/ }).locator("xpath=following-sibling::p[1]");
  const abschlussKarte = page.locator("p", { hasText: /^Karte$/ }).locator("xpath=following-sibling::p[1]");
  const abschlussDifferenz = page.locator("p", { hasText: /^Differenz$/ }).locator("xpath=following-sibling::p[1]");
  await expect(abschlussBar).toContainText("522,50");
  await expect(abschlussKarte).toContainText("531,00");
  await expect(abschlussDifferenz).toContainText("0,00");

  // Materialverbrauch im Abschluss sichtbar (nur die 12 realen Verkaeufe, siehe CSV-Pruefung unten fuer Mengen)
  await expect(page.getByText("Verpackung & Material")).toBeVisible();

  // 13. Reload nach Abschluss: Zahlen bleiben stabil
  await page.reload();
  await expect(page.getByTestId("tax-gross")).toContainText("1.053,50");
  await expect(abschlussBar).toContainText("522,50");
  await expect(abschlussKarte).toContainText("531,00");
  await expect(abschlussDifferenz).toContainText("0,00");

  // 14. CSV-Export: Umsatz-, Softeis- und Materialdaten konsistent
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Bericht als CSV exportieren/ }).click();
  const download = await downloadPromise;
  const csvPath = await download.path();
  expect(csvPath).toBeTruthy();
  const csvContent = await fs.promises.readFile(csvPath!, "utf-8");

  expect(csvContent).toMatch(/"Bar";"522,50\s*€"/);
  expect(csvContent).toMatch(/"Karte";"531,00\s*€"/);
  expect(csvContent).toMatch(/"Bruttoumsatz";"1\.053,50\s*€"/);

  function csvConsumption(name: string): number {
    const match = csvContent.match(new RegExp(`"Softeis ${name} Verbrauch";"([\\d.]+) L"`));
    expect(match).not.toBeNull();
    return Number(match![1]);
  }
  expect(csvConsumption("Vanille")).toBeCloseTo(0.49, 2);
  expect(csvConsumption("Schoko")).toBeCloseTo(0.49, 2);
  expect(csvConsumption("Erdbeer")).toBeCloseTo(0.32, 2);
  expect(csvConsumption("Zitrone")).toBeCloseTo(0.51, 2);

  expect(csvContent).toContain('"Material Becher Zugewiesen";"7 Stk."');
  expect(csvContent).toContain('"Material Löffel Zugewiesen";"7 Stk."');
  expect(csvContent).toContain('"Material Waffel Zugewiesen";"2 Stk."');
  expect(csvContent).toContain('"Material Waffelbecher Zugewiesen";"3 Stk."');

  // 15. Keine doppelte Verbuchung: Materialverbrauch & Softeis-Verbrauch nach Skalierung auf 300 unveraendert
  const stateFinal = await page.evaluate(() => JSON.parse(window.localStorage.getItem("primaq-control-mvp-state") || "{}"));
  expect(stateFinal.materialItems.mat_becher.quantityOnHand).toBe(3);
  expect(stateFinal.materialItems.mat_loeffel.quantityOnHand).toBe(43);
  expect(stateFinal.materialItems.mat_waffel.quantityOnHand).toBe(48);
  expect(stateFinal.materialItems.mat_waffelbecher.quantityOnHand).toBe(47);

  const finalAssignments = stateFinal.shiftMaterialAssignments as Array<{ itemId: string; consumedQty: number }>;
  expect(finalAssignments.find((a) => a.itemId === "mat_becher")?.consumedQty).toBe(7);
  expect(finalAssignments.find((a) => a.itemId === "mat_loeffel")?.consumedQty).toBe(7);
  expect(finalAssignments.find((a) => a.itemId === "mat_waffel")?.consumedQty).toBe(2);
  expect(finalAssignments.find((a) => a.itemId === "mat_waffelbecher")?.consumedQty).toBe(3);

  const finalMixConsumption = (stateFinal.consumptionEntries as Array<{ inventoryItemId: string }>).filter((e) => e.inventoryItemId === "soft_mix_liter");
  expect(finalMixConsumption).toHaveLength(15);
});
