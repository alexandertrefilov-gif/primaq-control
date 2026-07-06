/**
 * UX-FIX – "Bestellung buchen"-Button doppelt breit/ergonomischer
 *
 * Reine Darstellungsänderung, keine Logik: der Button in Bereich 4
 * (Zahlungsmittel wählen & Buchen) ist jetzt mindestens doppelt so breit
 * wie ein einzelner Zahlungsart-Button (Bar/Karte/QR) und mindestens 72px
 * hoch.
 *
 * 1 – Button ist sichtbar
 * 2 – Button überlappt keinen Zahlungsart-Button
 * 3 – Button ist mindestens doppelt so breit wie ein Zahlungsart-Button
 * 4 – Button ist mindestens 72px hoch
 * 5 – Buchung funktioniert weiterhin
 */

import { expect, test } from "@playwright/test";

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function seedAndActivatePayment(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("quick-amount-250").click();
}

test("BOOKBTN 1 – Button ist sichtbar", async ({ page }) => {
  await blockSupabase(page);
  await seedAndActivatePayment(page);
  await expect(page.getByTestId("book-button")).toBeVisible();
});

test("BOOKBTN 2 – Button überlappt keinen Zahlungsart-Button", async ({ page }) => {
  await blockSupabase(page);
  await seedAndActivatePayment(page);

  const bookBox = await page.getByTestId("book-button").boundingBox();
  const barBox = await page.getByTestId("payment-tab-bar").boundingBox();
  expect(bookBox).not.toBeNull();
  expect(barBox).not.toBeNull();
  expect(bookBox!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height - 4);
});

test("BOOKBTN 3 – Button ist mindestens doppelt so breit wie ein Zahlungsart-Button", async ({ page }) => {
  await blockSupabase(page);
  await seedAndActivatePayment(page);

  const bookBox = await page.getByTestId("book-button").boundingBox();
  const barBox = await page.getByTestId("payment-tab-bar").boundingBox();
  expect(bookBox).not.toBeNull();
  expect(barBox).not.toBeNull();
  expect(bookBox!.width).toBeGreaterThanOrEqual(barBox!.width * 2);
});

test("BOOKBTN 4 – Button ist mindestens 72px hoch", async ({ page }) => {
  await blockSupabase(page);
  await seedAndActivatePayment(page);

  const bookBox = await page.getByTestId("book-button").boundingBox();
  expect(bookBox).not.toBeNull();
  expect(bookBox!.height).toBeGreaterThanOrEqual(72);
});

test("BOOKBTN 5 – Buchung funktioniert weiterhin", async ({ page }) => {
  await blockSupabase(page);
  await seedAndActivatePayment(page);

  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await expect(page.getByText("Noch leer")).toBeVisible();
});
