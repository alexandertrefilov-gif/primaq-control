/**
 * POS Inline Sizes – Größenauswahl direkt im Verkaufsbereich (kein Popup)
 *
 * 1 – Sortenbuttons und Größenbuttons sind beim Laden sichtbar
 * 2 – Klick auf Sorte allein fügt nichts zum Warenkorb hinzu
 * 3 – Klick Sorte + Größe → korrekter Warenkorb-Eintrag
 * 4 – Größenname im Warenkorb ist korrekt (sizeName)
 * 5 – Preis im Warenkorb ist korrekt
 * 6 – Kein Größen-Popup erscheint
 * 7 – Auswahl einer anderen Sorte wechselt Markierung
 * 8 – Debug-Overlay ohne ?debug=1 nicht sichtbar
 */

import { expect, test } from "@playwright/test";

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function freshDb(page: import("@playwright/test").Page, tag: string) {
  await page.addInitScript((t) => {
    if (window.sessionStorage.getItem(`inline-sizes-seeded-${t}`) === "1") return;
    window.sessionStorage.setItem(`inline-sizes-seeded-${t}`, "1");
    indexedDB.deleteDatabase("primaq-pos");
  }, tag);
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

// ── Test 1: Sorten und Größen beim Laden sichtbar ─────────────────────────────

test("INL 1: Sortenbuttons und Größenbuttons sind beim Laden sichtbar", async ({ page }) => {
  await freshDb(page, "inl1");
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Sorten sichtbar
  await expect(page.getByRole("button", { name: "Vanille", exact: true })).toBeVisible();

  // Größenbuttons sichtbar (immer, nicht erst nach Sortenklick)
  await expect(page.getByTestId("size-btn-klein")).toBeVisible();
  await expect(page.getByTestId("size-btn-gross")).toBeVisible();
});

// ── Test 2: Klick auf Sorte allein → kein Warenkorb-Eintrag ──────────────────

test("INL 2: Klick auf Sorte allein fügt nichts zum Warenkorb hinzu", async ({ page }) => {
  await freshDb(page, "inl2");
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();

  // Warenkorb noch leer
  await expect(page.getByText("Noch leer")).toBeVisible();
});

// ── Test 3: Sorte + Größe → korrekter Eintrag ─────────────────────────────────

test("INL 3: Sorte + Größe → Warenkorb-Eintrag erscheint", async ({ page }) => {
  await freshDb(page, "inl3");
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();

  // Warenkorb nicht mehr leer
  await expect(page.getByText("Noch leer")).not.toBeVisible();
});

// ── Test 4: Größenname im Warenkorb korrekt ───────────────────────────────────

test("INL 4: Größenname im Warenkorb ist 'Klein'", async ({ page }) => {
  await freshDb(page, "inl4");
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();

  await expect(page.getByText(/KLEIN VANILLE/i)).toBeVisible();
});

// ── Test 5: Preis im Warenkorb korrekt ────────────────────────────────────────

test("INL 5: Preis im Warenkorb ist 2,50 € für Klein", async ({ page }) => {
  await freshDb(page, "inl5");
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();

  // Preis im Warenkorb-Listeneintrag (nicht im Größen-Button oder Quick-Amount)
  await expect(
    page.locator("li").filter({ hasText: /KLEIN VANILLE/i }).getByText("2,50 €").first()
  ).toBeVisible();
});

// ── Test 6: Kein Popup-Overlay erscheint ─────────────────────────────────────

test("INL 6: Kein Größen-Popup-Overlay nach Sortenklick", async ({ page }) => {
  await freshDb(page, "inl6");
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();

  // Kein Overlay/Modal sichtbar (kein fixed inset-0 dialog)
  await expect(page.locator(".fixed.inset-0.z-50").filter({ hasText: "Gewählte Sorte" })).not.toBeVisible();
  // Kein "Abbrechen" Button des alten Popups
  await expect(page.getByRole("button", { name: "Abbrechen", exact: true })).not.toBeVisible();
});

// ── Test 7: Andere Sorte wechselt Auswahl ─────────────────────────────────────

test("INL 7: Wechsel Sorte – zweite Sorte wird gewählt, Warenkorb bleibt leer", async ({ page }) => {
  await freshDb(page, "inl7");
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Erste Sorte wählen
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  // Zweite Sorte wählen (ohne Größe)
  await page.getByRole("button", { name: "Schokolade", exact: true }).click();
  // Warenkorb noch leer
  await expect(page.getByText("Noch leer")).toBeVisible();

  // Jetzt Größe wählen → Schokolade kommt in Warenkorb
  await page.getByTestId("size-btn-klein").click();
  await expect(page.getByText(/KLEIN SCHOKOLADE/i)).toBeVisible();
});

// ── Test 8: Debug-Overlay ohne ?debug=1 unsichtbar ────────────────────────────

test("INL 8: Debug-Overlay ist ohne ?debug=1 in Produktion nicht sichtbar", async ({ page }) => {
  await freshDb(page, "inl8");
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Debug panel darf nicht sichtbar sein
  await expect(page.locator('[class*="font-mono"]').filter({ hasText: "POS Debug" })).not.toBeVisible();
});
