import { test } from "@playwright/test";

const machineId = "machine_layout_test";
const productId = `${machineId}_prod_1`;
const orderItemId = `${productId}_Becher`;

const machine = { id: machineId, number: "1", name: "Gelmatic Layout", manualName: false, location: "Wagen", active: true, visibleInSale: true, products: [{ id: productId, machineId, machineName: "Gelmatic Layout", slot: "A", name: "Vanille", priceCents: 350, vatRate: 7, aroma: "Vanille", packagingType: "Becher", packagingSize: "mittel", portionGrams: 120, spoonIncluded: true, toppingEnabled: false, toppingPriceCents: 0, toppingVatRate: 7, visibleInSale: true, nameManuallyEdited: true }] };
const activeShift = { id: "shift_layout_test", date: "2026-06-19", eventName: "Layout-Test", salesArea: "truck", employees: [], startingCashCents: 0, createdAt: "2026-06-19T08:00:00.000Z" };

function buildOrder(n: number) {
  const items = Array.from({ length: n }, (_, i) => ({ id: `${orderItemId}_${i}`, productId, machineId, name: "Vanille Becher mittel", packagingType: "Becher", packagingSize: "mittel", quantity: 1, unitPriceGrossCents: 350, vatRate: 7, lineTotalGrossCents: 350 }));
  return { id: "order_layout", title: "Bestellung 1", items, paymentMethod: "cash", cashReceivedCents: 0, totalGrossCents: items.length * 350, vatCents: 0, changeDueCents: 0 };
}

function seed(p: { machine: Record<string, unknown>; activeShift: Record<string, unknown>; order: Record<string, unknown> }) {
  window.localStorage.clear();
  window.localStorage.setItem("primaq-control-machines", JSON.stringify([p.machine]));
  window.localStorage.setItem("primaq-control-mvp-state", JSON.stringify({ productConfigVersion: 4, machines: [p.machine], activeShift: p.activeShift, mixStocks: {}, stockFlavors: {}, transactions: [], dailySales: { orders: [] }, completedOrders: [], consumptionEntries: [], generalStock: {}, generalStockMovements: {}, inventoryMovements: {}, materialCategories: [], materialItems: {}, shiftMaterialAssignments: [], emergencyMode: {}, emergencyModeLog: [], mixStockMovements: {}, recipeTemplates: [], sumupSettings: { enabled: false, paymentLink: "", hintText: "" }, favorites: [] }));
  window.localStorage.setItem("primaq-control-open-orders", JSON.stringify([p.order]));
  window.localStorage.setItem("primaq-control-active-order-id", JSON.stringify(p.order.id));
}

test.use({ viewport: { width: 1024, height: 834 } });

for (const count of [1, 10]) {
  test(`Screenshot ${count} Artikel – iPad 13"`, async ({ page }) => {
    const order = buildOrder(count);
    await page.route(/supabase\.co/, (route) => route.abort());
    await page.routeWebSocket(/supabase\.co/, () => {});
    await page.addInitScript(seed, { machine: machine as Record<string, unknown>, activeShift: activeShift as Record<string, unknown>, order: order as Record<string, unknown> });
    await page.goto("/verkauf");
    await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
    await page.waitForSelector('[data-testid="order-panel"]', { timeout: 8000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/tmp/screenshot-verkauf-${count}-artikel-ipad.png`, fullPage: false });
  });
}
