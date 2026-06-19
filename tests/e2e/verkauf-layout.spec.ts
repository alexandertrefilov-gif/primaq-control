/**
 * Verkauf-Layout: Kalkulator scrollt intern, Zahlungsbereich bleibt stationär.
 *
 * Testet auf iPad-13"-Viewport (1024×834 px), wo der 2-Spalten-Layout greift.
 * Der Warenkorb wird direkt in localStorage vorbelegt (kein Klick auf Produkte),
 * damit Lager-/Einsatz-State die Prüfung nicht beeinflussen.
 */

import { expect, test } from "@playwright/test";

// ── Konstanten ────────────────────────────────────────────────────────────────

const machineId = "machine_layout_test";
const productId = `${machineId}_prod_1`;
const orderItemId = `${productId}_Becher`;

const machine = {
  id: machineId,
  number: "1",
  name: "Gelmatic Layout",
  manualName: false,
  location: "Wagen",
  active: true,
  visibleInSale: true,
  products: [
    {
      id: productId,
      machineId,
      machineName: "Gelmatic Layout",
      slot: "A",
      name: "Vanille",
      priceCents: 350,
      vatRate: 7,
      aroma: "Vanille",
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

const activeShift = {
  id: "shift_layout_test",
  date: "2026-06-19",
  eventName: "Layout-Test",
  salesArea: "truck",
  employees: [],
  startingCashCents: 0,
  createdAt: "2026-06-19T08:00:00.000Z"
};

// Baut N identische Warenkorb-Zeilen (1× je Artikel, damit die Liste lang wird)
function buildOrderItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${orderItemId}_${i}`,
    productId,
    machineId,
    name: `Vanille Becher mittel`,
    packagingType: "Becher",
    packagingSize: "mittel",
    quantity: 1,
    unitPriceGrossCents: 350,
    vatRate: 7,
    lineTotalGrossCents: 350
  }));
}

function buildOrder(items: ReturnType<typeof buildOrderItems>) {
  const total = items.reduce((s, i) => s + i.lineTotalGrossCents, 0);
  return {
    id: "order_layout",
    title: "Bestellung 1",
    items,
    paymentMethod: "cash",
    cashReceivedCents: 0,
    totalGrossCents: total,
    vatCents: 0,
    changeDueCents: 0
  };
}

function seedScript(params: {
  machine: Record<string, unknown>;
  activeShift: Record<string, unknown>;
  order: Record<string, unknown>;
}) {
  window.localStorage.clear();
  window.localStorage.setItem("primaq-control-machines", JSON.stringify([params.machine]));
  window.localStorage.setItem(
    "primaq-control-mvp-state",
    JSON.stringify({
      productConfigVersion: 4,
      machines: [params.machine],
      activeShift: params.activeShift,
      mixStocks: {},
      stockFlavors: {},
      transactions: [],
      dailySales: { orders: [] },
      completedOrders: [],
      consumptionEntries: [],
      generalStock: {},
      generalStockMovements: {},
      inventoryMovements: {},
      materialCategories: [],
      materialItems: {},
      shiftMaterialAssignments: [],
      emergencyMode: {},
      emergencyModeLog: [],
      mixStockMovements: {},
      recipeTemplates: [],
      sumupSettings: { enabled: false, paymentLink: "", hintText: "" },
      favorites: []
    })
  );
  window.localStorage.setItem("primaq-control-open-orders", JSON.stringify([params.order]));
  window.localStorage.setItem("primaq-control-active-order-id", JSON.stringify(params.order.id));
  window.localStorage.setItem("primaq-control-daily-sales", JSON.stringify({ orders: [] }));
  window.localStorage.setItem("primaq-control-completed-orders", JSON.stringify([]));
}

// Gibt true zurück wenn das Element vollständig im sichtbaren Viewport liegt
async function isFullyInViewport(
  page: import("@playwright/test").Page,
  locator: import("@playwright/test").Locator
): Promise<boolean> {
  const box = await locator.boundingBox();
  if (!box) return false;
  const viewport = page.viewportSize();
  if (!viewport) return false;
  return box.y >= 0 && box.y + box.height <= viewport.height;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1024, height: 834 } });

for (const count of [1, 5, 10]) {
  test(`Layout ${count} Artikel: Zahlungsart + Bestellung buchen bleiben im Viewport`, async ({
    page
  }) => {
    const items = buildOrderItems(count);
    const order = buildOrder(items);

    await page.route(/supabase\.co/, (route) => route.abort());
    await page.routeWebSocket(/supabase\.co/, () => {});
    await page.addInitScript(seedScript, {
      machine: machine as Record<string, unknown>,
      activeShift: activeShift as Record<string, unknown>,
      order: order as Record<string, unknown>
    });

    await page.goto("/verkauf");
    await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

    // Rechte Spalte: Kalkulator muss Artikel enthalten
    await expect(page.getByTestId("order-panel")).toBeVisible({ timeout: 8000 });

    // PaymentPanel + Buttons müssen sichtbar und vollständig im Viewport sein
    await expect(page.getByTestId("payment-panel")).toBeVisible();
    await expect(page.getByTestId("payment-cash-button")).toBeVisible();
    await expect(page.getByTestId("payment-card-button")).toBeVisible();
    await expect(page.getByTestId("checkout-button")).toBeVisible();

    expect(await isFullyInViewport(page, page.getByTestId("payment-panel"))).toBe(true);
    expect(await isFullyInViewport(page, page.getByTestId("checkout-button"))).toBe(true);

    // Kein Seiten-Scroll: Warenkorb scrollt intern, nicht der Viewport
    const hasNoPageScroll = await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight + 2
    );
    expect(hasNoPageScroll).toBe(true);
  });
}
