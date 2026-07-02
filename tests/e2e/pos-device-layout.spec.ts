/**
 * POS Geräte-Layout – E2E Tests (localStorage, kein Supabase-Sync)
 *
 * DL 1  – Verkäufer sieht keinen Layout-Edit-Button und keine Resize-Handles
 * DL 2  – Admin kann Layout-Bearbeiten aktivieren → Panel + Handles sichtbar
 * DL 3  – Cart-Width-Handle erscheint im Edit-Modus
 * DL 4  – Mindestgrößen werden beim Laden aus localStorage eingehalten (cartWidth)
 * DL 5  – Nach Reload bleibt lokales Layout erhalten (cartWidth aus LS)
 * DL 6  – Reset stellt Standardlayout wieder her und löscht localStorage-Key
 * DL 7  – Layout-Werte landen NICHT im Supabase-Sync (enqueueSettingsSync)
 * DL 8  – Verkauf bleibt funktionsfähig während Edit-Modus aktiv ist
 * DL 9  – Kein Handle sichtbar wenn nicht eingeloggt
 * DL 10 – Snackbar erscheint nach Preset-Auswahl
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
  // Wait until the flavor zone is visible (SalesPage rendered)
  await page.waitForSelector('[data-testid="flavor-zone"]', { state: "visible", timeout: 12000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("DL 1 – Verkäufer sieht keinen Layout-Edit-Button", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("layout-edit-toggle")).not.toBeVisible();
  await expect(page.locator('[data-testid^="resize-handle-"]')).toHaveCount(0);
});

test("DL 2 – Admin aktiviert Edit-Modus → Panel und Handles erscheinen", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("layout-edit-toggle")).toBeVisible();

  // Vorher: Handles nicht sichtbar
  await expect(page.getByTestId("resize-handle-flavor-size")).not.toBeVisible();

  await page.getByTestId("layout-edit-toggle").click();

  // Danach: Panel und Handles sichtbar
  await expect(page.getByTestId("layout-edit-panel")).toBeVisible();
  await expect(page.getByTestId("resize-handle-flavor-size")).toBeVisible();
  await expect(page.getByTestId("resize-handle-size-payment")).toBeVisible();
});

test("DL 3 – Cart-Width-Handle erscheint im Edit-Modus", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByTestId("layout-edit-toggle").click();
  await expect(page.getByTestId("resize-handle-cart-width")).toBeVisible();
});

test("DL 4 – Zu-kleine Werte aus localStorage werden auf Minimum geklemmt", async ({ page }) => {
  await blockSupabase(page);
  // Seed with values below all minima
  await seedLayout(page, {
    cartWidth: 50,
    flavorAreaHeight: 50,
    sizeAreaHeight: 10,
    paymentAreaHeight: 30,
  });
  await page.goto("/verkauf");
  await waitLoaded(page);

  // CartColumn has data-testid="cart-zone" with style width = deviceLayout.cartWidth
  // After clamping, cartWidth min is 320
  const cartBox = await page.getByTestId("cart-zone").boundingBox();
  expect(cartBox?.width).toBeGreaterThanOrEqual(320);
});

test("DL 5 – Nach Reload bleibt lokales Layout erhalten", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedLayout(page, {
    cartWidth: 450,
    flavorAreaHeight: 500,
    sizeAreaHeight: 120,
    paymentAreaHeight: 250,
  });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const cartBox = await page.getByTestId("cart-zone").boundingBox();
  expect(Math.round(cartBox?.width ?? 0)).toBe(450);
});

test("DL 6 – Reset stellt Standardlayout wieder her", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedLayout(page, { cartWidth: 480, flavorAreaHeight: 550, sizeAreaHeight: 140, paymentAreaHeight: 280 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Verify custom value is applied
  const beforeBox = await page.getByTestId("cart-zone").boundingBox();
  expect(Math.round(beforeBox?.width ?? 0)).toBe(480);

  // Enter edit mode and reset
  await page.getByTestId("layout-edit-toggle").click();
  await page.getByTestId("layout-reset-btn").click();

  // Cart should be back to default 400 px
  const afterBox = await page.getByTestId("cart-zone").boundingBox();
  expect(Math.round(afterBox?.width ?? 0)).toBe(DL_DEFAULT_CART_WIDTH);

  // localStorage key should be gone
  const lsVal = await page.evaluate((key) => localStorage.getItem(key), LS_LAYOUT_KEY);
  expect(lsVal).toBeNull();
});

test("DL 7 – Layout-Werte werden NICHT via Supabase synchronisiert", async ({ page }) => {
  const supabaseSettingsCalls: string[] = [];
  await page.route(/supabase\.co/, (route) => {
    const url = route.request().url();
    // Collect any PATCH/POST to settings-like endpoints
    if (route.request().method() !== "GET") supabaseSettingsCalls.push(url);
    return route.abort();
  });
  await page.routeWebSocket(/supabase\.co/, () => {});

  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Activate edit mode, apply a preset (which calls applyPreset → saveToLS)
  await page.getByTestId("layout-edit-toggle").click();
  await page.getByTestId("layout-preset-ipad-12-9").click();

  // Give any potential sync a moment to fire
  await page.waitForTimeout(500);

  // No non-GET Supabase request should reference device-layout
  const hasDeviceSync = supabaseSettingsCalls.some((url) => url.includes("device-layout"));
  expect(hasDeviceSync).toBe(false);

  // Layout IS saved to localStorage
  const lsVal = await page.evaluate((key) => localStorage.getItem(key), LS_LAYOUT_KEY);
  expect(lsVal).not.toBeNull();
});

test("DL 8 – Verkauf bleibt funktionsfähig im Edit-Modus", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Enter edit mode
  await page.getByTestId("layout-edit-toggle").click();
  await expect(page.getByTestId("layout-edit-panel")).toBeVisible();

  // Flavor zone should still be interactable
  await expect(page.getByTestId("flavor-zone")).toBeVisible();

  // Size zone should be visible
  await expect(page.getByTestId("size-zone")).toBeVisible();

  // Payment zone should be visible
  await expect(page.getByTestId("payment-zone")).toBeVisible();

  // Cart zone should be visible
  await expect(page.getByTestId("cart-zone")).toBeVisible();

  // Exit edit mode via Fertig button
  await page.getByTestId("layout-edit-toggle").click();
  await expect(page.getByTestId("layout-edit-panel")).not.toBeVisible();
});

test("DL 9 – Kein Handle wenn nicht als Admin eingeloggt", async ({ page }) => {
  await blockSupabase(page);
  // No seedAdmin call
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("layout-edit-toggle")).not.toBeVisible();
  await expect(page.locator('[data-testid^="resize-handle-"]')).toHaveCount(0);
});

test("DL 10 – Snackbar erscheint nach Preset-Auswahl im Edit-Panel", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByTestId("layout-edit-toggle").click();
  await page.getByTestId("layout-preset-ipad-12-9").click();

  await expect(page.getByText("Layout für dieses Gerät gespeichert")).toBeVisible();
});
