/**
 * Letzte Buchung – Read-only Modal für Verkäufer, Storno nur für Admin
 *
 * LBO 1  – Ohne Buchung zeigt Bar "noch keine"
 * LBO 2  – Nach Buchung zeigt Bar: Nummer, Betrag, Zahlungsart
 * LBO 3  – Verkäufer (nicht Admin) kann Modal öffnen
 * LBO 4  – Verkäufer sieht keinen Storno-Button im Modal
 * LBO 5  – Admin sieht Storno-Button im Modal
 * LBO 6  – Modal zeigt Artikel korrekt (Name, Menge, Einzelpreis, Summe)
 * LBO 7  – Modal schließen funktioniert (Button + Backdrop)
 * LBO 8  – Verkauf bleibt nach Buchung + Modal voll funktionsfähig
 * LBO 9  – Admin-Storno über Modal entfernt Buchung
 * LBO 10 – iPad-Layout: Status-Bar überlappt nicht (bleibt kompakt)
 */

import { expect, test, type Page } from "@playwright/test";

async function blockSupabase(page: Page) {
  await page.route(/supabase\.co/, (r) => r.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function seedEmptyPos(page: Page) {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("lbo-seeded") === "1") return;
    window.sessionStorage.setItem("lbo-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
}

async function seedAdmin(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

async function waitLoaded(page: Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

/** Books one Klein Vanille (Bar) via the POS UI. */
async function bookOneOrder(page: Page) {
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  // Size picker: click Klein (first size button visible)
  const kleinBtn = page.getByTestId("size-btn-klein");
  if (await kleinBtn.isVisible()) {
    await kleinBtn.click();
  } else {
    // Fallback: modal-style size picker
    await page.getByRole("button", { name: /Klein/ }).first().click();
  }
  await page.getByTestId("book-button").click();
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test("LBO 1 – Ohne Buchung zeigt die Bar 'noch keine'", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("last-booking-bar")).toContainText("noch keine");
  await expect(page.getByTestId("show-last-order")).not.toBeVisible();
});

test("LBO 2 – Nach Buchung zeigt Bar: Nummer, Betrag, Zahlungsart", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await bookOneOrder(page);

  const bar = page.getByTestId("last-booking-bar");
  await expect(bar).toContainText("#0001");
  // Betrag (Klein = 2,50 €)
  await expect(bar).toContainText("2,50");
  // Zahlungsart
  await expect(bar).toContainText("Bar");
  await expect(page.getByTestId("show-last-order")).toBeVisible();
});

test("LBO 3 – Verkäufer (nicht Admin) kann Modal öffnen", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  // No admin seed
  await page.goto("/verkauf");
  await waitLoaded(page);

  await bookOneOrder(page);

  await expect(page.getByTestId("show-last-order")).toBeVisible();
  await page.getByTestId("show-last-order").click();
  await expect(page.getByTestId("last-order-modal")).toBeVisible();
  await expect(page.getByTestId("last-order-modal")).toContainText("Letzte Buchung");
});

test("LBO 4 – Verkäufer sieht keinen Storno-Button im Modal", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  // No admin
  await page.goto("/verkauf");
  await waitLoaded(page);

  await bookOneOrder(page);
  await page.getByTestId("show-last-order").click();
  await expect(page.getByTestId("last-order-modal")).toBeVisible();

  // Storno button must NOT exist
  await expect(page.getByTestId("modal-void-btn")).not.toBeVisible();
});

test("LBO 5 – Admin sieht Storno-Button im Modal", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await bookOneOrder(page);
  await page.getByTestId("show-last-order").click();
  await expect(page.getByTestId("last-order-modal")).toBeVisible();
  await expect(page.getByTestId("modal-void-btn")).toBeVisible();
  await expect(page.getByTestId("modal-void-btn")).toContainText("Stornieren");
});

test("LBO 6 – Modal zeigt Artikel korrekt (Name, Menge, Preis)", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await bookOneOrder(page);
  await page.getByTestId("show-last-order").click();

  const modal = page.getByTestId("last-order-modal");
  await expect(modal).toBeVisible();

  // Article: Klein + Vanille
  await expect(modal).toContainText("Vanille");
  await expect(modal).toContainText("Klein");
  // Quantity prefix "1×"
  await expect(modal).toContainText("1×");
  // Einzelpreis (2,50 €)
  await expect(modal).toContainText("2,50");
  // Zahlungsart in meta section
  await expect(modal).toContainText("Bar");
});

test("LBO 7 – Modal schließen: Button und Backdrop-Klick", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await bookOneOrder(page);
  await page.getByTestId("show-last-order").click();
  await expect(page.getByTestId("last-order-modal")).toBeVisible();

  // Close via button
  await page.getByTestId("modal-close-btn").click();
  await expect(page.getByTestId("last-order-modal")).not.toBeVisible();

  // Open again, close via backdrop
  await page.getByTestId("show-last-order").click();
  await expect(page.getByTestId("last-order-modal")).toBeVisible();
  // Click backdrop (outside modal content)
  await page.mouse.click(10, 10);
  await expect(page.getByTestId("last-order-modal")).not.toBeVisible();
});

test("LBO 8 – Verkauf bleibt nach Buchung und Modal-Öffnen funktionsfähig", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Book first order
  await bookOneOrder(page);
  // Open and close modal
  await page.getByTestId("show-last-order").click();
  await expect(page.getByTestId("last-order-modal")).toBeVisible();
  await page.getByTestId("modal-close-btn").click();

  // Book second order
  await bookOneOrder(page);
  const bar = page.getByTestId("last-booking-bar");
  await expect(bar).toContainText("#0002");
  await expect(bar).toContainText("Bar");
});

test("LBO 9 – Admin-Storno über Modal entfernt die Buchung", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await bookOneOrder(page);
  await expect(page.getByTestId("last-booking-bar")).toContainText("#0001");

  // Open modal and storno (2-step: click once → confirm)
  await page.getByTestId("show-last-order").click();
  await page.getByTestId("modal-void-btn").click();
  // Confirm step
  await expect(page.getByTestId("modal-void-btn")).toContainText("Wirklich stornieren?");
  await page.getByTestId("modal-void-btn").click();

  // Modal should close, order should be removed
  await expect(page.getByTestId("last-order-modal")).not.toBeVisible();
  await expect(page.getByTestId("last-booking-bar")).toContainText("noch keine");
});

test("LBO 10 – iPad-Layout: Status-Bar bleibt kompakt und überlappt nicht", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await seedAdmin(page);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  await bookOneOrder(page);

  const bar = page.getByTestId("last-booking-bar");
  await expect(bar).toBeVisible();

  const barBox = await bar.boundingBox();
  expect(barBox).not.toBeNull();

  // Bar should not extend beyond viewport
  expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(1024 + 1);
  // Bar should be reasonably compact (under 80px tall)
  expect(barBox!.height).toBeLessThan(80);

  // Book button still usable
  await expect(page.getByTestId("book-button")).toBeVisible();
});
