/**
 * Stabiles Standard-Verkaufslayout (Fixed Grid) – E2E Tests
 *
 * Free-Layout ist im Verkaufsbetrieb vollständig deaktiviert: kein Import,
 * keine Render-Pfade, kein Drag/Resize, keine x/y/w/h-Panels — für niemanden,
 * Admin eingeschlossen. /verkauf zeigt immer und ausschließlich das feste
 * Standard-Grid, unabhängig davon, was in localStorage steht.
 *
 * Ergänzt tests/e2e/pos-layout-ipad.spec.ts (LAY 1-11: Zonen sichtbar, kein
 * Überlapp, Warenkorb rechts, kein horizontaler Scroll, Buchung funktioniert)
 * und pos-guided-selling.spec.ts (Schrittlogik).
 *
 * GRID 1 – Sichtbarer Abstand zwischen Sorten und Größen
 * GRID 2 – Sichtbarer Abstand zwischen Sorten/Größen-Zeile und Warenkorb
 * GRID 3 – Sichtbarer Abstand zwischen Zahlung und Footer (Letzte Buchung)
 * GRID 4 – Bestellung buchen überlappt keine Schnellbetrag-Buttons
 * GRID 5 – Standardlayout sichtbar: Sorten, Größen, Zahlung, Warenkorb rechts
 * GRID 6 – Kein Layout-Button, keine Free-Layout-Handles – auch nicht für Admin
 * GRID 7 – Buchung funktioniert im Standardlayout
 * GRID 8 – Verkäufer sieht IMMER das Standard-Grid, selbst mit gespeichertem Free-Layout
 * GRID 9 – Admin sieht ebenfalls IMMER das Standard-Grid, selbst mit gespeichertem Layout
 * GRID 10 – Kaputtes/ungültiges localStorage-Layout wird ignoriert – /verkauf bleibt stabil
 * GRID 11 – Legacy-Layout-Keys werden beim Laden aktiv aus localStorage entfernt
 */

import { expect, test } from "@playwright/test";

const LS_FREE_KEY = "primaq-pos-free-layout-v1";
const LS_DEVICE_KEY = "primaq-pos-device-layout-v1";

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function seedAdmin(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function rect(page: import("@playwright/test").Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function seedFreeLayout(
  page: import("@playwright/test").Page,
  panels: Record<string, { x: number; y: number; w: number; h: number }>
) {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify({ panels: value }));
    },
    { key: LS_FREE_KEY, value: panels }
  );
}

const someOldLayout = {
  flavors: { x: 8,   y: 8,   w: 520, h: 300 },
  sizes:   { x: 8,   y: 500, w: 420, h: 100 },
  payment: { x: 8,   y: 608, w: 400, h: 220 },
  cart:    { x: 600, y: 8,   w: 400, h: 500 },
};

// Minimum visible gap between two areas — matches the ~10px requirement.
const MIN_GAP = 6;

test("GRID 1 – Sichtbarer Abstand zwischen Sorten und Größen", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const flavorR = await rect(page, "flavor-zone");
  const sizeR = await rect(page, "size-zone");
  // Sizes sit to the right of Sorten
  const hGap = sizeR.x - (flavorR.x + flavorR.width);
  expect(hGap).toBeGreaterThanOrEqual(MIN_GAP);
});

test("GRID 2 – Sichtbarer Abstand zwischen Sorten/Größen-Zeile und Warenkorb", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const sizeR = await rect(page, "size-zone");
  const cartR = await rect(page, "cart-zone");
  const hGap = cartR.x - (sizeR.x + sizeR.width);
  expect(hGap).toBeGreaterThanOrEqual(MIN_GAP);
});

test("GRID 3 – Sichtbarer Abstand zwischen Zahlung und Footer (Letzte Buchung)", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const paymentR = await rect(page, "payment-zone");
  const footerR = await rect(page, "last-booking-bar");
  const vGap = footerR.y - (paymentR.y + paymentR.height);
  expect(vGap).toBeGreaterThanOrEqual(MIN_GAP);
});

test("GRID 4 – Bestellung buchen überlappt keine Schnellbetrag-Buttons", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const quickR = await rect(page, "quick-amounts-row");
  const bookR = await rect(page, "book-button");
  // Book button sits to the right of the quick-amounts row, never overlapping it.
  const hGap = bookR.x - (quickR.x + quickR.width);
  expect(hGap).toBeGreaterThanOrEqual(0);
});

test("GRID 5 – Standardlayout sichtbar: Sorten, Größen, Zahlung, Warenkorb rechts", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("sales-grid")).toBeVisible();
  await expect(page.getByTestId("flavor-zone")).toBeVisible();
  await expect(page.getByTestId("size-zone")).toBeVisible();
  await expect(page.getByTestId("payment-zone")).toBeVisible();
  await expect(page.getByTestId("cart-zone")).toBeVisible();

  // Warenkorb rechts von Sorten
  const flavorR = await rect(page, "flavor-zone");
  const cartR = await rect(page, "cart-zone");
  expect(cartR.x).toBeGreaterThan(flavorR.x + flavorR.width);
});

test("GRID 6 – Kein Layout-Button, keine Free-Layout-Handles – auch nicht für Admin", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.locator('[data-testid="layout-edit-toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="layout-edit-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="layout-reset-btn"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="fl-container"]')).toHaveCount(0);
  await expect(page.locator('[data-panel]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="fl-drag-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="fl-resize-"]')).toHaveCount(0);
});

test("GRID 7 – Buchung funktioniert im Standardlayout", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await expect(page.getByText("Noch leer")).toBeVisible();
});

// ── Regression: a saved/leftover free-layout must never reach the seller ────

test("GRID 8 – Verkäufer sieht IMMER das Standard-Grid, selbst mit gespeichertem Free-Layout", async ({ page }) => {
  await blockSupabase(page);
  // Some old free-layout sits in localStorage (e.g. leftover from a much
  // earlier version of the app) — a regular seller (no admin) opens the register.
  await seedFreeLayout(page, someOldLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.locator('[data-testid="layout-edit-toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="fl-container"]')).toHaveCount(0);
  await expect(page.locator('[data-panel]')).toHaveCount(0);
  await expect(page.getByTestId("sales-grid")).toBeVisible();

  await expect(page.getByTestId("flavor-zone")).toBeVisible();
  await expect(page.getByTestId("size-zone")).toBeVisible();
  await expect(page.getByTestId("payment-zone")).toBeVisible();
  await expect(page.getByTestId("cart-zone")).toBeVisible();
});

test("GRID 9 – Admin sieht ebenfalls IMMER das Standard-Grid, selbst mit gespeichertem Layout", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, someOldLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.locator('[data-testid="layout-edit-toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="fl-container"]')).toHaveCount(0);
  await expect(page.locator('[data-panel]')).toHaveCount(0);
  await expect(page.getByTestId("sales-grid")).toBeVisible();
});

test("GRID 10 – Kaputtes/ungültiges localStorage-Layout wird ignoriert – /verkauf bleibt stabil", async ({ page }) => {
  await blockSupabase(page);
  // Structurally invalid / hand-corrupted entry.
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({
      panels: { flavors: { x: "broken", y: null, w: 520 } }, // missing h, missing other 3 panels
    }));
  }, LS_FREE_KEY);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("sales-grid")).toBeVisible();
  await expect(page.locator('[data-testid="fl-container"]')).toHaveCount(0);
  await expect(page.getByTestId("flavor-zone")).toBeVisible();
  await expect(page.getByTestId("cart-zone")).toBeVisible();
});

test("GRID 11 – Legacy-Layout-Keys werden beim Laden aktiv aus localStorage entfernt", async ({ page }) => {
  await blockSupabase(page);
  await seedFreeLayout(page, someOldLayout);
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({ some: "old-device-layout-data" }));
  }, LS_DEVICE_KEY);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("sales-grid")).toBeVisible();

  const freeLs = await page.evaluate((key) => localStorage.getItem(key), LS_FREE_KEY);
  const deviceLs = await page.evaluate((key) => localStorage.getItem(key), LS_DEVICE_KEY);
  expect(freeLs).toBeNull();
  expect(deviceLs).toBeNull();
});
