/**
 * POS Geräte-Layout – E2E Tests (localStorage + CSS-Variablen, kein Supabase-Sync)
 *
 * DL 1  – Verkäufer sieht keinen Layout-Button
 * DL 2  – Admin sieht "Layout bearbeiten"
 * DL 3  – Klick aktiviert Bearbeitungsmodus und zeigt Splitter
 * DL 4  – Splitter werden sichtbar (cart-width handle)
 * DL 5  – Warenkorbbreite kann per Drag verändert werden
 * DL 6  – Sortenhöhe kann per Drag verändert werden
 * DL 7  – Größenhöhe kann per Drag verändert werden
 * DL 8  – Werte bleiben nach Reload erhalten
 * DL 9  – Reset setzt Standardlayout wieder her
 * DL 10 – Layoutwerte werden NICHT in Supabase-Sync geschrieben
 * DL 11 – Kein horizontaler Scroll auf 1366×1024
 * DL 12 – Kein horizontaler Scroll auf 1194×834
 * DL 13 – Kein horizontaler Scroll auf 1024×768
 * DL 14 – Verkauf bleibt möglich im Edit-Modus
 * DL 15 – Snackbar erscheint nach Preset-Auswahl
 */

import { expect, test } from "@playwright/test";

const LS_LAYOUT_KEY = "primaq-pos-device-layout-v1";
const DL_DEFAULT_CART_WIDTH = 400;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function seedAdmin(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

async function seedLayout(page: import("@playwright/test").Page, layout: Record<string, number>) {
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: LS_LAYOUT_KEY, value: layout });
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForSelector('[data-testid="flavor-zone"]', { state: "visible", timeout: 12000 });
}

/** Simulate a pointer drag from (startX, startY) by (dx, dy) pixels */
async function simulateDrag(
  page: import("@playwright/test").Page,
  selector: string,
  dx: number,
  dy: number
) {
  const el = page.locator(selector);
  const box = await el.boundingBox();
  if (!box) throw new Error(`Element not found: ${selector}`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
  await page.mouse.up();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("DL 1 – Verkäufer sieht keinen Layout-Edit-Button", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("layout-edit-toggle")).not.toBeVisible();
  await expect(page.locator('[data-testid^="resize-handle-"]')).toHaveCount(0);
});

test("DL 2 – Admin sieht Layout-bearbeiten-Button", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("layout-edit-toggle")).toBeVisible();
});

test("DL 3 – Klick aktiviert Bearbeitungsmodus und zeigt Panel", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByTestId("layout-edit-toggle").click();

  await expect(page.getByTestId("layout-edit-panel")).toBeVisible();
  await expect(page.getByTestId("resize-handle-flavor-size")).toBeVisible();
  await expect(page.getByTestId("resize-handle-size-payment")).toBeVisible();
});

test("DL 4 – Splitter cart-width-handle erscheint im Edit-Modus", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByTestId("layout-edit-toggle").click();
  await expect(page.getByTestId("resize-handle-cart-width")).toBeVisible();
});

test("DL 5 – Warenkorbbreite ändert sich durch Drag", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const before = await page.getByTestId("cart-zone").boundingBox();
  const beforeWidth = before?.width ?? 0;

  await page.getByTestId("layout-edit-toggle").click();

  // Drag cart-width handle 50px to the left → cart should grow by ~50px
  await simulateDrag(page, '[data-testid="resize-handle-cart-width"]', -50, 0);

  const after = await page.getByTestId("cart-zone").boundingBox();
  const afterWidth = after?.width ?? 0;

  expect(afterWidth).toBeGreaterThan(beforeWidth + 20);
});

test("DL 6 – Sortenhöhe ändert sich durch Drag", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const before = await page.getByTestId("dl-flavor-wrapper").boundingBox();
  const beforeH = before?.height ?? 0;

  await page.getByTestId("layout-edit-toggle").click();

  // Drag flavor-size handle 50px down → flavor area grows
  await simulateDrag(page, '[data-testid="resize-handle-flavor-size"]', 0, 50);

  const after = await page.getByTestId("dl-flavor-wrapper").boundingBox();
  const afterH = after?.height ?? 0;

  expect(afterH).toBeGreaterThan(beforeH + 20);
});

test("DL 7 – Größenhöhe ändert sich durch Drag", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  // Small flavorsHeight so the size-payment handle stays within the default 720px viewport
  await seedLayout(page, { cartWidth: 400, flavorsHeight: 300, sizesHeight: 95, paymentHeight: 210 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const before = await page.getByTestId("dl-size-wrapper").boundingBox();
  const beforeH = before?.height ?? 0;

  await page.getByTestId("layout-edit-toggle").click();

  // Drag size-payment handle 40px down → size area grows, paymentHeight shrinks
  await simulateDrag(page, '[data-testid="resize-handle-size-payment"]', 0, 40);

  // Verify via CSS custom property (robust against layout-reflow timing)
  const cssVar = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--pos-sizes-height").trim()
  );
  expect(cssVar).not.toBe("95px");

  const after = await page.getByTestId("dl-size-wrapper").boundingBox();
  const afterH = after?.height ?? 0;
  expect(afterH).toBeGreaterThan(beforeH + 20);
});

test("DL 8 – Werte bleiben nach Reload erhalten", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedLayout(page, {
    cartWidth: 450,
    flavorsHeight: 500,
    sizesHeight: 120,
    paymentHeight: 250,
  });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const cartBox = await page.getByTestId("cart-zone").boundingBox();
  expect(Math.round(cartBox?.width ?? 0)).toBe(450);
});

test("DL 9 – Reset setzt Standardlayout wieder her", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedLayout(page, { cartWidth: 480, flavorsHeight: 550, sizesHeight: 140, paymentHeight: 280 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const beforeBox = await page.getByTestId("cart-zone").boundingBox();
  expect(Math.round(beforeBox?.width ?? 0)).toBe(480);

  await page.getByTestId("layout-edit-toggle").click();
  await page.getByTestId("layout-reset-btn").click();

  const afterBox = await page.getByTestId("cart-zone").boundingBox();
  expect(Math.round(afterBox?.width ?? 0)).toBe(DL_DEFAULT_CART_WIDTH);

  const lsVal = await page.evaluate((key) => localStorage.getItem(key), LS_LAYOUT_KEY);
  expect(lsVal).toBeNull();
});

test("DL 10 – Layoutwerte werden NICHT via Supabase synchronisiert", async ({ page }) => {
  const supabaseNonGetCalls: string[] = [];
  await page.route(/supabase\.co/, (route) => {
    if (route.request().method() !== "GET") supabaseNonGetCalls.push(route.request().url());
    return route.abort();
  });
  await page.routeWebSocket(/supabase\.co/, () => {});

  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByTestId("layout-edit-toggle").click();
  await page.getByTestId("layout-preset-ipad-12-9").click();
  await page.waitForTimeout(500);

  const hasDeviceSync = supabaseNonGetCalls.some((url) => url.includes("device-layout"));
  expect(hasDeviceSync).toBe(false);

  const lsVal = await page.evaluate((key) => localStorage.getItem(key), LS_LAYOUT_KEY);
  expect(lsVal).not.toBeNull();
});

test("DL 11 – Kein horizontaler Scroll auf 1366×1024", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
  const clientWidth = await page.evaluate(() => document.body.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2); // 2px tolerance for subpixel
});

test("DL 12 – Kein horizontaler Scroll auf 1194×834", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
  const clientWidth = await page.evaluate(() => document.body.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
});

test("DL 13 – Kein horizontaler Scroll auf 1024×768", async ({ page }) => {
  await blockSupabase(page);
  await seedLayout(page, { cartWidth: 300, flavorsHeight: 300, sizesHeight: 90, paymentHeight: 200 });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
  const clientWidth = await page.evaluate(() => document.body.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
});

test("DL 14 – Verkauf bleibt funktionsfähig im Edit-Modus", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByTestId("layout-edit-toggle").click();
  await expect(page.getByTestId("layout-edit-panel")).toBeVisible();

  // Alle Zonen müssen sichtbar und interaktiv bleiben
  await expect(page.getByTestId("flavor-zone")).toBeVisible();
  await expect(page.getByTestId("size-zone")).toBeVisible();
  await expect(page.getByTestId("payment-zone")).toBeVisible();
  await expect(page.getByTestId("cart-zone")).toBeVisible();

  // Edit-Modus verlassen
  await page.getByTestId("layout-edit-toggle").click();
  await expect(page.getByTestId("layout-edit-panel")).not.toBeVisible();
  await expect(page.locator('[data-testid^="resize-handle-"]')).toHaveCount(0);
});

test("DL 15 – Snackbar erscheint nach Preset-Auswahl im Edit-Panel", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByTestId("layout-edit-toggle").click();
  await page.getByTestId("layout-preset-ipad-12-9").click();

  await expect(page.getByText("Layout für dieses Gerät gespeichert")).toBeVisible();
});
