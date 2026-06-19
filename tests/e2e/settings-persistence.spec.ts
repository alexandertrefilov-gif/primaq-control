/**
 * Settings-Persistenz: Tests A-F
 *
 * Verifiziert, dass Maschinen und Sorten nach Navigation, Reload und im Cloud-Sync
 * erhalten bleiben. Kein Realtime, kein Merge – direkter POST, localStorage-First.
 */

import { expect, test } from "@playwright/test";

const machineId = "machine_pers_test";
const machineNumber = "1";

const baseMachine = {
  id: machineId,
  number: machineNumber,
  name: `Gelmatic ${machineNumber}`,
  manualName: false,
  location: "Wagen",
  active: true,
  visibleInSale: true,
  products: [] as unknown[]
};

function seedScript(machine: object) {
  if (window.sessionStorage.getItem("primaq-pers-seeded") === "true") return;
  window.sessionStorage.setItem("primaq-pers-seeded", "true");
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
  window.localStorage.setItem("primaq-control-open-orders", JSON.stringify([]));
  window.localStorage.setItem("primaq-control-active-order-id", JSON.stringify(null));
  window.localStorage.setItem("primaq-control-daily-sales", JSON.stringify({ orders: [] }));
  window.localStorage.setItem("primaq-control-completed-orders", JSON.stringify([]));
}

// Supabase-Mock: POST-Body wird als Cloud-Stand gespeichert, GET gibt ihn zurück.
async function setupSupabaseMock(page: import("@playwright/test").Page) {
  let cloudRow: Record<string, unknown> | null = null;

  await page.route(/supabase\.co/, async (route) => {
    const method = route.request().method();

    if (method === "GET") {
      if (!cloudRow) {
        await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ value: cloudRow })
        });
      }
      return;
    }

    if (method === "POST" || method === "PATCH") {
      try {
        const body = JSON.parse(route.request().postData() ?? "{}") as
          | { value?: Record<string, unknown> }
          | Array<{ value?: Record<string, unknown> }>;
        const bodyObj = Array.isArray(body) ? body[0] : body;
        if (bodyObj?.value && typeof bodyObj.value === "object") {
          cloudRow = bodyObj.value;
        }
      } catch { /* ignore */ }
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  });

  await page.routeWebSocket(/supabase\.co/, () => { /* Realtime deaktiviert */ });

  return {
    getCloudRow: () => cloudRow
  };
}

// Wartet, bis localStorage-Machines für die gegebene Maschine mindestens `count` Produkte enthält.
async function waitForProductCount(
  page: import("@playwright/test").Page,
  mid: string,
  count: number
) {
  await page.waitForFunction(
    ({ mid, count }) => {
      const raw = window.localStorage.getItem("primaq-control-machines");
      if (!raw) return false;
      const machines = JSON.parse(raw) as { id: string; products: unknown[] }[];
      const machine = machines.find((m) => m.id === mid);
      return (machine?.products.length ?? 0) >= count;
    },
    { mid, count },
    { timeout: 8000 }
  );
}

// ── Test A: Maschine bleibt nach Reload erhalten ──────────────────────────────

test("A: Maschine bleibt nach Reload erhalten", async ({ page }) => {
  await page.addInitScript(seedScript, baseMachine);
  await setupSupabaseMock(page);

  await page.goto("/einstellungen");
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  await page.reload();
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();
});

// ── Test B: Softeissorte bleibt nach Navigation zurück zu /einstellungen ──────

test("B: Softeissorte bleibt nach Navigation zurück zu /einstellungen erhalten", async ({ page }) => {
  await page.addInitScript(seedScript, baseMachine);
  await setupSupabaseMock(page);

  await page.goto("/einstellungen");
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  // Sorte anlegen
  await page.getByRole("button", { name: /Softeis-Sorte anlegen/ }).first().click();

  // Warten bis localStorage die Sorte enthält
  await waitForProductCount(page, machineId, 1);

  // Produkt-ID aus localStorage lesen
  const productId = await page.evaluate((mid) => {
    const raw = window.localStorage.getItem("primaq-control-machines");
    const machines = raw ? (JSON.parse(raw) as { id: string; products: { id: string }[] }[]) : [];
    return machines.find((m) => m.id === mid)?.products[0]?.id ?? null;
  }, machineId);
  expect(productId).toBeTruthy();

  // Navigation weg und zurück
  await page.goto("/lager");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
  await page.goto("/einstellungen");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  // Sorte muss noch in der UI sichtbar sein
  await expect(page.getByTestId(`machine-product-name-input-${productId}`)).toBeVisible();
});

// ── Test C: Softeissorte bleibt nach Reload erhalten ─────────────────────────

test("C: Softeissorte bleibt nach Reload erhalten", async ({ page }) => {
  await page.addInitScript(seedScript, baseMachine);
  await setupSupabaseMock(page);

  await page.goto("/einstellungen");
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  await page.getByRole("button", { name: /Softeis-Sorte anlegen/ }).first().click();
  await waitForProductCount(page, machineId, 1);

  const productId = await page.evaluate((mid) => {
    const raw = window.localStorage.getItem("primaq-control-machines");
    const machines = raw ? (JSON.parse(raw) as { id: string; products: { id: string }[] }[]) : [];
    return machines.find((m) => m.id === mid)?.products[0]?.id ?? null;
  }, machineId);
  expect(productId).toBeTruthy();

  await page.reload();
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  await expect(page.getByTestId(`machine-product-name-input-${productId}`)).toBeVisible();
});

// ── Test D: 5 Sorten bleiben nach Reload vollständig erhalten ─────────────────

test("D: 5 Sorten bleiben nach Reload vollständig erhalten", async ({ page }) => {
  await page.addInitScript(seedScript, baseMachine);
  await setupSupabaseMock(page);

  await page.goto("/einstellungen");
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  // 5 Sorten anlegen
  for (let i = 0; i < 5; i++) {
    await page.getByRole("button", { name: /Softeis-Sorte anlegen/ }).first().click();
    await waitForProductCount(page, machineId, i + 1);
  }

  // Alle 5 Produkt-IDs aus localStorage lesen
  const productIds = await page.evaluate((mid) => {
    const raw = window.localStorage.getItem("primaq-control-machines");
    const machines = raw ? (JSON.parse(raw) as { id: string; products: { id: string }[] }[]) : [];
    return (machines.find((m) => m.id === mid)?.products ?? []).map((p) => p.id);
  }, machineId);
  expect(productIds).toHaveLength(5);

  await page.reload();
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  // Alle 5 Sorten müssen nach Reload in der UI sichtbar sein
  for (const pid of productIds) {
    await expect(page.getByTestId(`machine-product-name-input-${pid}`)).toBeVisible();
  }
});

// ── Test E: Gelöschte Maschine bleibt nach Reload weg ────────────────────────

test("E: Gelöschte Maschine bleibt nach Reload gelöscht", async ({ page }) => {
  await page.addInitScript(seedScript, baseMachine);
  await setupSupabaseMock(page);

  await page.goto("/einstellungen");
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  await page.getByRole("button", { name: "Maschine löschen" }).click();
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).not.toBeVisible();

  await page.reload();
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  await expect(page.getByTestId(`machine-number-input-${machineId}`)).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Maschine anlegen" })).toBeVisible();
});

// ── Test F: Supabase enthält nach Sorte anlegen denselben Stand wie localStorage ──

test("F: Supabase-Cloud enthält nach Sorte anlegen denselben Stand wie localStorage", async ({ page }) => {
  await page.addInitScript(seedScript, baseMachine);
  const { getCloudRow } = await setupSupabaseMock(page);

  await page.goto("/einstellungen");
  await expect(page.getByTestId(`machine-number-input-${machineId}`)).toBeVisible();

  await page.getByRole("button", { name: /Softeis-Sorte anlegen/ }).first().click();
  await waitForProductCount(page, machineId, 1);

  // Warten bis Cloud synchronisiert ist (POST wurde vom App-Code gesendet)
  await expect
    .poll(
      () => {
        const row = getCloudRow();
        const machines = row?.machines as { id: string; products: unknown[] }[] | undefined;
        return machines?.find((m) => m.id === machineId)?.products.length ?? 0;
      },
      { timeout: 8000, intervals: [200, 500, 1000] }
    )
    .toBeGreaterThan(0);

  // Cloud-Produktanzahl muss mit localStorage übereinstimmen
  const localCount = await page.evaluate((mid) => {
    const raw = window.localStorage.getItem("primaq-control-machines");
    const machines = raw ? (JSON.parse(raw) as { id: string; products: unknown[] }[]) : [];
    return machines.find((m) => m.id === mid)?.products.length ?? 0;
  }, machineId);

  const cloudCount =
    (getCloudRow()?.machines as { id: string; products: unknown[] }[] | undefined)?.find(
      (m) => m.id === machineId
    )?.products.length ?? 0;

  expect(cloudCount).toBe(localCount);
});
