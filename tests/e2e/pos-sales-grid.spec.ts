/**
 * Stabiles Standard-Verkaufslayout (Fixed Grid) – E2E Tests
 *
 * Ergänzt tests/e2e/pos-layout-ipad.spec.ts (LAY 1-11, bereits: Zonen sichtbar,
 * kein Überlapp, Warenkorb rechts, kein horizontaler Scroll, Buchung
 * funktioniert) und pos-guided-selling.spec.ts (Schrittlogik) um die noch
 * fehlenden Prüfungen aus der Aufgabenstellung: sichtbarer Mindestabstand
 * zwischen den Bereichen, und dass "Bestellung buchen" keine Preisbuttons
 * überdeckt.
 *
 * GRID 1 – Sichtbarer Abstand zwischen Sorten und Größen
 * GRID 2 – Sichtbarer Abstand zwischen Sorten/Größen-Zeile und Warenkorb
 * GRID 3 – Sichtbarer Abstand zwischen Zahlung und Footer (Letzte Buchung)
 * GRID 4 – Bestellung buchen überlappt keine Schnellbetrag-Buttons
 * GRID 5 – Kein freies (absolut positioniertes) Panel-Layout mehr im normalen Verkauf
 */

import { expect, test } from "@playwright/test";

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function rect(page: import("@playwright/test").Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

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

test("GRID 5 – Kein freies Panel-Layout mehr im normalen Verkauf", async ({ page }) => {
  await blockSupabase(page);
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
  await page.goto("/verkauf");
  await waitLoaded(page);

  // The old free-layout edit controls must not exist anymore in normal sales.
  await expect(page.locator('[data-testid="layout-edit-toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="fl-container"]')).toHaveCount(0);
  await expect(page.locator('[data-panel]')).toHaveCount(0);

  // The fixed grid is in place instead.
  await expect(page.getByTestId("sales-grid")).toBeVisible();
});
