import { expect, test } from "@playwright/test";

// BroadcastChannel nutzt den gleichen Origin – deshalb müssen beide Seiten in
// DEMSELBEN BrowserContext liegen (gleiche context.newPage()), damit die Nachrichten
// ankommen. supabase HTTP + WebSocket werden in beiden Seiten geblockt.

const machineId = "machine_sync_test";

const machine = {
  id: machineId,
  number: "1",
  name: "Sync Testmaschine",
  manualName: false,
  location: "Wagen",
  active: true,
  visibleInSale: true,
  products: []
};

const baseState = {
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
};

const fakeOrder = {
  id: "order_sync_protect",
  title: "Bestellung 1",
  items: [{ id: "item_1", name: "Vanille", quantity: 2, priceCents: 500 }],
  paymentMethod: "cash",
  cashReceivedCents: 0,
  totalGrossCents: 1000,
  vatCents: 65,
  changeDueCents: 0
};

function seedFn({ machine, state, openOrder }: { machine: object; state: object; openOrder?: { id: string } | null }) {
  window.sessionStorage.setItem("primaq-admin", "true");
  window.localStorage.clear();
  window.localStorage.setItem("primaq-legacy-settings-open", "1");
  window.localStorage.setItem("primaq-control-machines", JSON.stringify([machine]));
  window.localStorage.setItem("primaq-control-mvp-state", JSON.stringify(state));
  window.localStorage.setItem("primaq-control-open-orders", JSON.stringify(openOrder ? [openOrder] : []));
  window.localStorage.setItem("primaq-control-active-order-id", JSON.stringify(openOrder ? openOrder.id : null));
  window.localStorage.setItem("primaq-control-daily-sales", JSON.stringify({ orders: [] }));
  window.localStorage.setItem("primaq-control-completed-orders", JSON.stringify([]));
}

test("Cross-Tab-Sync: Maschine anlegen in Tab 1 erscheint automatisch in Tab 2", async ({ page, context }) => {
  // ── Tab 1 vorbereiten ──────────────────────────────────────────────────────
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => { /* fake-open */ });
  await page.addInitScript(seedFn, { machine, state: baseState, openOrder: null });
  await page.goto("/einstellungen");
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  // ── Tab 2 in DEMSELBEN Context (gleicher BroadcastChannel) ────────────────
  const page2 = await context.newPage();
  await page2.route(/supabase\.co/, (route) => route.abort());
  await page2.routeWebSocket(/supabase\.co/, () => { /* fake-open */ });
  await page2.addInitScript(seedFn, { machine, state: baseState, openOrder: null });
  await page2.goto("/einstellungen");
  await expect(page2.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  // ── Tab 1: neue Maschine anlegen ──────────────────────────────────────────
  await page.bringToFront();
  await page.getByRole("button", { name: "Maschine anlegen" }).first().click();

  // Tab 1 zeigt sofort 2 Maschinen. formatMachineDisplayName("Gelmatic 2","2") → "MASCHINE 2"
  await expect(page.getByRole("heading", { name: "MASCHINE 2" })).toBeVisible();

  // ── Tab 2: Maschine muss automatisch erscheinen (ohne Reload) ─────────────
  await expect(page2.getByRole("heading", { name: "MASCHINE 2" })).toBeVisible({ timeout: 4000 });

  await page2.close();
});

test("Cross-Tab-Sync: Maschine löschen in Tab 1 verschwindet in Tab 2", async ({ page, context }) => {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => { /* fake-open */ });
  await page.addInitScript(seedFn, { machine, state: baseState, openOrder: null });
  await page.goto("/einstellungen");

  const page2 = await context.newPage();
  await page2.route(/supabase\.co/, (route) => route.abort());
  await page2.routeWebSocket(/supabase\.co/, () => { /* fake-open */ });
  await page2.addInitScript(seedFn, { machine, state: baseState, openOrder: null });
  await page2.goto("/einstellungen");

  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();
  await expect(page2.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  // Tab 1: Maschine löschen
  await page.bringToFront();
  await page.getByRole("button", { name: "Maschine löschen" }).click();
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).not.toBeVisible();

  // Tab 2: Maschine muss automatisch verschwinden
  await expect(page2.getByTestId(`machine-number-input-${machineId}`)).not.toBeVisible({ timeout: 4000 });

  await page2.close();
});

test("Cross-Tab-Sync: offene Bestellung in Tab 2 bleibt bei Settings-Änderung in Tab 1 erhalten", async ({ page, context }) => {
  // Tab 2 hat eine offene Bestellung im localStorage – simuliert aktiven Verkauf.
  // BroadcastChannel darf currentOrder/openOrders NIEMALS überschreiben.
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => { /* fake-open */ });
  await page.addInitScript(seedFn, { machine, state: baseState, openOrder: null });
  await page.goto("/einstellungen");
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  const page2 = await context.newPage();
  await page2.route(/supabase\.co/, (route) => route.abort());
  await page2.routeWebSocket(/supabase\.co/, () => { /* fake-open */ });

  // Interceptor VOR dem Seed-Script registrieren (addInitScript läuft in FIFO-Reihenfolge).
  // Zeichnet alle Tab-2-eigenen Schreibvorgänge auf "primaq-control-open-orders" auf,
  // unabhängig davon wann die React-Effects feuern oder wie Tab 1 localStorage überschreibt.
  // Tab 1-Writes gehen durch Tab 1's window.localStorage.setItem – eine andere Funktion.
  await page2.addInitScript(() => {
    const history: { id: string }[][] = [];
    (window as unknown as Record<string, unknown>).__openOrdersWriteHistory = history;
    const origSetItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = (key: string, value: string) => {
      if (key === "primaq-control-open-orders") {
        try { history.push(JSON.parse(value) as { id: string }[]); } catch { /* ignore */ }
      }
      origSetItem(key, value);
    };
  });

  // Tab 2 mit seeded Bestellung
  await page2.addInitScript(seedFn, { machine, state: baseState, openOrder: fakeOrder });
  await page2.goto("/einstellungen");
  await expect(page2.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  // Prüfen: offene Bestellung ist in Tab 2 localStorage vorhanden
  const orderBefore = await page2.evaluate(() => {
    const raw = window.localStorage.getItem("primaq-control-open-orders");
    return raw ? (JSON.parse(raw) as { id: string }[]) : [];
  });
  expect(orderBefore).toHaveLength(1);
  expect(orderBefore[0].id).toBe("order_sync_protect");

  // Tab 1: Maschine anlegen (Settings-Änderung, die via BroadcastChannel zu Tab 2 geht)
  await page.bringToFront();
  await page.getByRole("button", { name: "Maschine anlegen" }).first().click();
  await expect(page.getByRole("heading", { name: "MASCHINE 2" })).toBeVisible();

  // Tab 2 soll die neue Maschine empfangen haben (BC-Update ohne Reload)
  await expect(page2.getByRole("heading", { name: "MASCHINE 2" })).toBeVisible({ timeout: 4000 });

  // Invariante: Tab 2 hat openOrders NIEMALS mit einer Blank-Bestellung überschrieben.
  // Zu diesem Zeitpunkt hat Tab 2 mindestens eine Schreiboperation ausgeführt (Seed + Mount).
  // Der BC-Receive-Handler darf openOrders nicht modifizieren – keiner von Tab 2's eigenen
  // Schreibvorgängen darf eine Bestellung mit id "order_1" (Blank-Default) enthalten.
  const tab2Writes = await page2.evaluate(
    () => (window as unknown as Record<string, unknown>).__openOrdersWriteHistory as { id: string }[][]
  );
  expect(tab2Writes.length).toBeGreaterThan(0);
  for (const orders of tab2Writes) {
    for (const order of orders) {
      expect(order.id).not.toBe("order_1");
    }
  }

  await page2.close();
});
