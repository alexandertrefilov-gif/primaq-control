/**
 * POS Payment UX – Zahlungsbereich Nachtbetrieb
 *
 * 1  – Zahlungsart-Buttons (Bar/Karte/QR) sind sichtbar und schaltbar
 * 2  – 100 € Button ist nicht vorhanden
 * 3  – Größenpreise erscheinen als Schnellgeld-Buttons (Klein 2,50 €, Mittel 3,50 €)
 * 4  – Preis 5,00 € (Groß-Größe = Schein) erscheint nur einmal
 * 5  – Klick auf 3,50 € setzt Gegeben-Feld auf 3,5
 * 6  – Klick auf 5,00 € setzt Gegeben-Feld auf 5
 * 7  – Rückgeld wird korrekt berechnet
 * 8  – Karte-Tab zeigt Kartenzahlung-Indikator
 */

import { expect, test } from "@playwright/test";

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function freshDb(page: import("@playwright/test").Page, tag: string) {
  await page.addInitScript((t) => {
    if (window.sessionStorage.getItem(`payment-ux-seeded-${t}`) === "1") return;
    window.sessionStorage.setItem(`payment-ux-seeded-${t}`, "1");
    indexedDB.deleteDatabase("primaq-pos");
  }, tag);
}

async function seedAdmin(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function gotoVerkauf(page: import("@playwright/test").Page) {
  await page.goto("/verkauf");
  await waitLoaded(page);
}

// Add one item to the cart so the payment block becomes interactive
async function addKleinVanille(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByRole("button", { name: /Klein/ }).click();
}

// ── Test 1: Zahlungsart-Tabs sichtbar und größer ──────────────────────────────

test("PAY 1: Bar/Karte/QR Tabs sind sichtbar", async ({ page }) => {
  await freshDb(page, "pay1");
  await blockSupabase(page);
  await gotoVerkauf(page);

  await expect(page.getByTestId("payment-tab-bar")).toBeVisible();
  await expect(page.getByTestId("payment-tab-karte")).toBeVisible();
  await expect(page.getByTestId("payment-tab-qr")).toBeVisible();
});

// ── Test 2: Kein 100 € Button ────────────────────────────────────────────────

test("PAY 2: 100 € Button ist nicht vorhanden", async ({ page }) => {
  await freshDb(page, "pay2");
  await blockSupabase(page);
  await gotoVerkauf(page);

  // data-testid="quick-amount-10000" should not exist
  await expect(page.getByTestId("quick-amount-10000")).not.toBeAttached();
});

// ── Test 3: Größenpreise erscheinen als Schnellgeld-Buttons ──────────────────
// Default: Klein 250ct, Mittel 350ct – beide NICHT in BILL_CENTS, also extra Buttons

test("PAY 3: Größenpreise Klein (2,50 €) und Mittel (3,50 €) erscheinen als Buttons", async ({ page }) => {
  await freshDb(page, "pay3");
  await blockSupabase(page);
  await gotoVerkauf(page);

  // Bar tab muss aktiv sein (Standard)
  await page.getByTestId("payment-tab-bar").click();

  await expect(page.getByTestId("quick-amount-250")).toBeVisible();
  await expect(page.getByTestId("quick-amount-350")).toBeVisible();
});

// ── Test 4: 5,00 € (Groß-Preis = Schein 5 €) erscheint nur einmal ────────────

test("PAY 4: Groß-Preis 5,00 € und Schein 5 € erscheinen nur als ein Button", async ({ page }) => {
  await freshDb(page, "pay4");
  await blockSupabase(page);
  await gotoVerkauf(page);

  await page.getByTestId("payment-tab-bar").click();

  // Exactly one quick-amount button for 500ct
  await expect(page.getByTestId("quick-amount-500")).toHaveCount(1);
});

// ── Test 5: Klick auf 3,50 € addiert – erster Klick von 0 ───────────────────

test("PAY 5: Klick auf 3,50 € addiert zu 3,50 (von 0)", async ({ page }) => {
  await freshDb(page, "pay5");
  await blockSupabase(page);
  await gotoVerkauf(page);

  await page.getByTestId("payment-tab-bar").click();
  await page.getByTestId("quick-amount-350").click();

  const input = page.locator('input[type="number"]');
  await expect(input).toHaveValue("3.50");
});

// ── Test 6: Klick auf 5,00 € addiert – erster Klick von 0 ───────────────────

test("PAY 6: Klick auf 5,00 € addiert zu 5,00 (von 0)", async ({ page }) => {
  await freshDb(page, "pay6");
  await blockSupabase(page);
  await gotoVerkauf(page);

  await page.getByTestId("payment-tab-bar").click();
  await page.getByTestId("quick-amount-500").click();

  const input = page.locator('input[type="number"]');
  await expect(input).toHaveValue("5.00");
});

// ── Test 7: Rückgeld-Berechnung nach Schnellgeld-Button ──────────────────────

test("PAY 7: Rückgeld korrekt nach Schnellgeld-Klick", async ({ page }) => {
  await freshDb(page, "pay7");
  await seedAdmin(page);
  await blockSupabase(page);
  await gotoVerkauf(page);

  // Add Klein Vanille (2,50 €), then give 5 € → Rückgeld 2,50 €
  await addKleinVanille(page);

  await page.getByTestId("payment-tab-bar").click();
  await page.getByTestId("quick-amount-500").click();

  const changeRow = page.locator("div").filter({ hasText: /^Rückgeld/ }).last();
  await expect(changeRow).toBeVisible();
  await expect(changeRow.getByText("2,50 €")).toBeVisible();
});

// ── Test 8: Karte-Tab zeigt Kartenzahlung-Indikator ─────────────────────────

test("PAY 8: Karte-Tab zeigt Kartenzahlung-Indikator", async ({ page }) => {
  await freshDb(page, "pay8");
  await blockSupabase(page);
  await gotoVerkauf(page);

  await page.getByTestId("payment-tab-karte").click();

  await expect(page.getByText("Kartenzahlung gewählt")).toBeVisible();
  // Cash input should not be visible
  await expect(page.locator('input[type="number"]')).not.toBeVisible();
});

// ── Kalkulator-Tests: Addieren, +/−, Clear ───────────────────────────────────

test("PAY 9: Zweiter Klick 3,50 € addiert → 7,00 €", async ({ page }) => {
  await freshDb(page, "pay9");
  await blockSupabase(page);
  await gotoVerkauf(page);

  await page.getByTestId("payment-tab-bar").click();
  await page.getByTestId("quick-amount-350").click();
  await page.getByTestId("quick-amount-350").click();

  const input = page.locator('input[type="number"]');
  await expect(input).toHaveValue("7.00");
});

test("PAY 10: Schnellbetrag 5,00 € addiert sich zu bestehendem Betrag", async ({ page }) => {
  await freshDb(page, "pay10");
  await blockSupabase(page);
  await gotoVerkauf(page);

  await page.getByTestId("payment-tab-bar").click();
  await page.getByTestId("quick-amount-350").click(); // 3,50
  await page.getByTestId("quick-amount-500").click(); // + 5,00 = 8,50

  const input = page.locator('input[type="number"]');
  await expect(input).toHaveValue("8.50");
});

test("PAY 11: Plus-Button erhöht um 0,50 €", async ({ page }) => {
  await freshDb(page, "pay11");
  await blockSupabase(page);
  await gotoVerkauf(page);

  await page.getByTestId("payment-tab-bar").click();
  await page.getByTestId("quick-amount-350").click(); // 3,50

  await page.getByTestId("cash-plus").click(); // 4,00
  const input = page.locator('input[type="number"]');
  await expect(input).toHaveValue("4.00");

  await page.getByTestId("cash-plus").click(); // 4,50
  await expect(input).toHaveValue("4.50");
});

test("PAY 12: Minus-Button reduziert um 0,50 €", async ({ page }) => {
  await freshDb(page, "pay12");
  await blockSupabase(page);
  await gotoVerkauf(page);

  await page.getByTestId("payment-tab-bar").click();
  await page.getByTestId("quick-amount-500").click(); // 5,00

  await page.getByTestId("cash-minus").click(); // 4,50
  const input = page.locator('input[type="number"]');
  await expect(input).toHaveValue("4.50");
});

test("PAY 13: Minus unter 0 € bleibt bei 0,00 €", async ({ page }) => {
  await freshDb(page, "pay13");
  await blockSupabase(page);
  await gotoVerkauf(page);

  await page.getByTestId("payment-tab-bar").click();
  // Start at 0, press minus several times
  await page.getByTestId("cash-minus").click();
  await page.getByTestId("cash-minus").click();

  const input = page.locator('input[type="number"]');
  await expect(input).toHaveValue("0.00");
});

test("PAY 14: Clear setzt Gegeben auf 0,00 €", async ({ page }) => {
  await freshDb(page, "pay14");
  await blockSupabase(page);
  await gotoVerkauf(page);

  await page.getByTestId("payment-tab-bar").click();
  await page.getByTestId("quick-amount-500").click(); // 5,00
  await page.getByTestId("cash-clear").click();

  const input = page.locator('input[type="number"]');
  await expect(input).toHaveValue("");
});

test("PAY 15: Bestellung buchen funktioniert nach Kalkulator-Nutzung", async ({ page }) => {
  await freshDb(page, "pay15");
  await blockSupabase(page);
  await gotoVerkauf(page);

  await addKleinVanille(page); // 2,50 €

  await page.getByTestId("payment-tab-bar").click();
  await page.getByTestId("quick-amount-250").click(); // exakt 2,50 €
  await page.getByTestId("book-button").click();

  // Cart should be empty after booking
  await expect(page.getByText("Noch leer")).toBeVisible();
});
