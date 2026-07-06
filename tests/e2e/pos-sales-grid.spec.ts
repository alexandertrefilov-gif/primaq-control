/**
 * Stabiles 4-Quadranten-Verkaufslayout – E2E Tests
 *
 * Free-Layout ist im Verkaufsbetrieb vollständig deaktiviert: kein Import,
 * keine Render-Pfade, kein Drag/Resize, keine x/y/w/h-Panels — für niemanden,
 * Admin eingeschlossen. /verkauf zeigt immer und ausschließlich das feste
 * Standard-Grid, unabhängig davon, was in localStorage steht.
 *
 * Topologie (2×2 Quadranten + Warenkorb, siehe pos-config Grid-Spezifikation):
 *   ┌───────────────┬──────────────┬───────────┐
 *   │ 1. Sorte      │ 2. Größe     │           │
 *   ├───────────────┼──────────────┤ Warenkorb │
 *   │ 3. Betrag     │ 4. Zahlung   │           │
 *   │    eingeben   │    + Buchen  │           │
 *   └───────────────┴──────────────┴───────────┘
 *
 * Reihenfolge: 1 Sorte → 2 Größe → 3 Betrag eingeben → 4 Zahlungsmittel +
 * Buchen. Betrag kommt VOR Zahlungsmittel.
 *
 * Ergänzt tests/e2e/pos-layout-ipad.spec.ts (Zonen sichtbar, kein Überlapp,
 * Warenkorb rechts, kein horizontaler Scroll, Buchung funktioniert) und
 * pos-guided-selling.spec.ts (Schrittlogik).
 *
 * GRID 1 – Sichtbarer Abstand zwischen Sorten und Größen
 * GRID 2 – Sichtbarer Abstand zwischen Größen-Quadrant und Warenkorb
 * GRID 3 – Sichtbarer Abstand zwischen Zahlung/Buchen-Quadrant und Footer
 * GRID 4 – Bestellung buchen überlappt keine Schnellbetrag-Buttons
 * GRID 5 – Standardlayout sichtbar: alle 4 Quadranten + Warenkorb rechts
 * GRID 6 – Kein Layout-Button, keine Free-Layout-Handles – auch nicht für Admin
 * GRID 7 – Buchung funktioniert im Standardlayout
 * GRID 8 – Verkäufer sieht IMMER das Standard-Grid, selbst mit gespeichertem Free-Layout
 * GRID 9 – Admin sieht ebenfalls IMMER das Standard-Grid, selbst mit gespeichertem Layout
 * GRID 10 – Kaputtes/ungültiges localStorage-Layout wird ignoriert – /verkauf bleibt stabil
 * GRID 11 – Legacy-Layout-Keys werden beim Laden aktiv aus localStorage entfernt
 * GRID 12 – Sorte (oben) und Betrag (unten) stehen in derselben linken Spalte
 * GRID 13 – Größe (oben) und Zahlung/Buchen (unten) stehen in derselben mittleren Spalte
 * GRID 14 – Warenkorb spannt beide Zeilen (volle Höhe)
 * GRID 15 – Start: nur Sorte aktiv, Größe/Betrag/Zahlung gesperrt
 * GRID 16 – Nach Sorte: Größe aktiv
 * GRID 17 – Nach Größe: Betrag aktiv, Zahlung noch gesperrt
 * GRID 18 – Nach Betrag > 0: Zahlungsmittel aktiv
 * GRID 19 – Rückgeld erscheint im Warenkorb unter Gesamt, mit "Gegeben"-Zeile
 * GRID 20 – 20 € gegeben, 8,50 € Warenkorb → Rückgeld 11,50 €
 * GRID 21 – Nach Buchung: kompletter Reset (Sorte, Größe, Betrag, Zahlungsmittel, Schritt 1)
 * GRID 22 – Layout sauber bei 1194×834 und 1024×768 (kein Überlapp)
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

// Minimum visible gap between two areas — matches the ~12px requirement.
const MIN_GAP = 6;

test("GRID 1 – Sichtbarer Abstand zwischen Sorten und Größen", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const flavorR = await rect(page, "flavor-zone");
  const sizeR = await rect(page, "size-zone");
  const hGap = sizeR.x - (flavorR.x + flavorR.width);
  expect(hGap).toBeGreaterThanOrEqual(MIN_GAP);
});

test("GRID 2 – Sichtbarer Abstand zwischen Größen-Quadrant und Warenkorb", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const sizeR = await rect(page, "size-zone");
  const cartR = await rect(page, "cart-zone");
  const hGap = cartR.x - (sizeR.x + sizeR.width);
  expect(hGap).toBeGreaterThanOrEqual(MIN_GAP);
});

test("GRID 3 – Sichtbarer Abstand zwischen Zahlung/Buchen-Quadrant und Footer", async ({ page }) => {
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
  // Book button (Bereich 4) und Schnellbeträge (Bereich 3) liegen in
  // unterschiedlichen Quadranten nebeneinander – kein Überlapp.
  const hGap = bookR.x - (quickR.x + quickR.width);
  expect(hGap).toBeGreaterThanOrEqual(0);
});

test("GRID 5 – Standardlayout sichtbar: alle 4 Quadranten + Warenkorb rechts", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("sales-grid")).toBeVisible();
  await expect(page.getByTestId("flavor-zone")).toBeVisible();
  await expect(page.getByTestId("size-zone")).toBeVisible();
  await expect(page.getByTestId("amount-zone")).toBeVisible();
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
  await page.getByTestId("quick-amount-250").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await expect(page.getByText("Noch leer")).toBeVisible();
});

// ── Regression: a saved/leftover free-layout must never reach the seller ────

test("GRID 8 – Verkäufer sieht IMMER das Standard-Grid, selbst mit gespeichertem Free-Layout", async ({ page }) => {
  await blockSupabase(page);
  await seedFreeLayout(page, someOldLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.locator('[data-testid="layout-edit-toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="fl-container"]')).toHaveCount(0);
  await expect(page.locator('[data-panel]')).toHaveCount(0);
  await expect(page.getByTestId("sales-grid")).toBeVisible();

  await expect(page.getByTestId("flavor-zone")).toBeVisible();
  await expect(page.getByTestId("size-zone")).toBeVisible();
  await expect(page.getByTestId("amount-zone")).toBeVisible();
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

// ── 2×2-Quadranten-Topologie ──────────────────────────────────────────────

test("GRID 12 – Sorte (oben) und Betrag (unten) stehen in derselben linken Spalte", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const flavorR = await rect(page, "flavor-zone");
  const amountR = await rect(page, "amount-zone");

  expect(Math.abs(amountR.x - flavorR.x)).toBeLessThan(4);
  expect(amountR.y).toBeGreaterThanOrEqual(flavorR.y + flavorR.height - 4);
});

test("GRID 13 – Größe (oben) und Zahlung/Buchen (unten) stehen in derselben mittleren Spalte", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const sizeR = await rect(page, "size-zone");
  const paymentR = await rect(page, "payment-zone");

  expect(Math.abs(paymentR.x - sizeR.x)).toBeLessThan(4);
  expect(paymentR.y).toBeGreaterThanOrEqual(sizeR.y + sizeR.height - 4);
});

test("GRID 14 – Warenkorb spannt beide Zeilen (volle Höhe)", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const flavorR = await rect(page, "flavor-zone");
  const amountR = await rect(page, "amount-zone");
  const cartR = await rect(page, "cart-zone");

  // Warenkorb beginnt oben (Höhe der Sorten-Zeile) und endet unten (Höhe der Betrag-Zeile)
  expect(Math.abs(cartR.y - flavorR.y)).toBeLessThan(4);
  expect(cartR.y + cartR.height).toBeGreaterThanOrEqual(amountR.y + amountR.height - 4);
});

// ── Strikte Schritt-Sperrung: sichtbar, abgedunkelt, keine Aktion ────────────

test("GRID 15 – Start: nur Sorte aktiv, Größe/Betrag/Zahlung gesperrt", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Größe: Container bleibt interaktiv, aber jeder Größen-Button ist gesperrt
  await expect(page.getByTestId("size-btn-klein")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("size-btn-klein")).toHaveCSS("pointer-events", "none");
  await expect(page.getByTestId("amount-zone")).toHaveCSS("pointer-events", "none");
  await expect(page.getByTestId("payment-zone")).toHaveCSS("pointer-events", "none");
  await expect(page.getByTestId("payment-tab-karte")).toHaveAttribute("aria-disabled", "true");
});

test("GRID 16 – Nach Sorte: Größe aktiv", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await expect(page.getByTestId("size-zone")).not.toHaveCSS("pointer-events", "none");
  await expect(page.getByTestId("size-btn-klein")).toHaveAttribute("aria-disabled", "false");
});

test("GRID 17 – Nach Größe: Betrag aktiv, Zahlung noch gesperrt", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();

  await expect(page.getByTestId("amount-zone")).not.toHaveCSS("pointer-events", "none");
  await expect(page.getByTestId("payment-zone")).toHaveCSS("pointer-events", "none");
  await expect(page.getByTestId("payment-tab-bar")).toHaveAttribute("aria-disabled", "true");

  // Klick auf gesperrtes Zahlungsmittel bleibt wirkungslos
  await page.getByTestId("payment-tab-karte").click({ force: true });
  await expect(page.getByText("Kartenzahlung gewählt")).not.toBeVisible();
});

test("GRID 18 – Nach Betrag > 0: Zahlungsmittel aktiv", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("quick-amount-250").click();

  await expect(page.getByTestId("payment-zone")).not.toHaveCSS("pointer-events", "none");
  await expect(page.getByTestId("payment-tab-karte")).toHaveAttribute("aria-disabled", "false");
  await page.getByTestId("payment-tab-karte").click();
  await expect(page.getByText("Kartenzahlung gewählt")).toBeVisible();
});

// ── Warenkorb: Rückgeld/Noch offen unter Gesamt ──────────────────────────────

test("GRID 19 – Rückgeld erscheint im Warenkorb unter Gesamt, mit \"Gegeben\"-Zeile", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click(); // 2,50 €
  await page.getByTestId("quick-amount-500").click(); // 5,00 €

  const changeRow = page.getByTestId("cart-change-row");
  await expect(changeRow).toBeVisible();
  await expect(changeRow.getByText("Rückgeld")).toBeVisible();
  await expect(changeRow.getByText("2,50 €")).toBeVisible();
  await expect(changeRow.getByText("Gegeben")).toBeVisible();
  await expect(changeRow.getByText("5,00 €")).toBeVisible();

  // Rückgeld steht unterhalb von Gesamt, innerhalb des Warenkorbs
  const summaryR = await rect(page, "cart-summary");
  const changeR = await rect(page, "cart-change-row");
  expect(changeR.y).toBeGreaterThan(summaryR.y);
});

test("GRID 20 – 20 € gegeben, 8,50 € Warenkorb → Rückgeld 11,50 €", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Klein (2,50) + Mittel (3,50) + Groß (2,50) wäre umständlich – stattdessen
  // Klein + Mittel + Klein = 2,50 + 3,50 + 2,50 = 8,50 €
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByRole("button", { name: "Schokolade", exact: true }).click();
  await page.getByTestId("size-btn-mittel").click();
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();

  await expect(page.getByTestId("cart-summary").getByText("8,50 €")).toBeVisible();

  await page.getByTestId("quick-amount-2000").click();

  const changeRow = page.getByTestId("cart-change-row");
  await expect(changeRow.getByText("11,50 €")).toBeVisible();
});

test("GRID 21 – Nach Buchung: kompletter Reset (Sorte, Größe, Betrag, Zahlungsmittel, Schritt 1)", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("quick-amount-500").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await expect(page.getByText("Noch leer")).toBeVisible();

  // Betrag zurück auf 0 (leeres Eingabefeld)
  await expect(page.locator('[data-testid="amount-zone"] input')).toHaveValue("");

  // Zahlungsmittel/Betrag/Größe wieder gesperrt, Sorte wieder Schritt 1
  await expect(page.getByTestId("amount-zone")).toHaveCSS("pointer-events", "none");
  await expect(page.getByTestId("payment-zone")).toHaveCSS("pointer-events", "none");

  // Zahlungsmittel wurde zurückgesetzt: die nächste Buchung erfordert einen
  // erneuten, expliziten Tap auf Bar (kein "Karte" mehr aktiv aus der letzten
  // Buchung) und bucht dann korrekt als Bar.
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("quick-amount-250").click();
  await page.getByTestId("payment-tab-bar").click();
  await page.getByTestId("book-button").click();

  const bar = page.getByTestId("last-booking-bar");
  await expect(bar.getByText("#0002")).toBeVisible();
  await expect(bar.getByText("Bar")).toBeVisible();
});

test("GRID 22 – Layout sauber bei 1194×834 und 1024×768 (kein Überlapp)", async ({ page }) => {
  await blockSupabase(page);

  for (const vp of [{ width: 1194, height: 834 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(vp);
    await page.goto("/verkauf");
    await waitLoaded(page);

    await expect(page.getByTestId("sales-grid")).toBeVisible();
    await expect(page.getByTestId("flavor-zone")).toBeVisible();
    await expect(page.getByTestId("size-zone")).toBeVisible();
    await expect(page.getByTestId("amount-zone")).toBeVisible();
    await expect(page.getByTestId("payment-zone")).toBeVisible();
    await expect(page.getByTestId("cart-zone")).toBeVisible();
    await expect(page.getByTestId("book-button")).toBeVisible();

    const flavorR = await rect(page, "flavor-zone");
    const sizeR = await rect(page, "size-zone");
    const cartR = await rect(page, "cart-zone");
    const amountR = await rect(page, "amount-zone");
    const paymentR = await rect(page, "payment-zone");

    expect(sizeR.x).toBeGreaterThanOrEqual(flavorR.x + flavorR.width - 4);
    expect(cartR.x).toBeGreaterThanOrEqual(sizeR.x + sizeR.width - 4);
    expect(amountR.y).toBeGreaterThanOrEqual(flavorR.y + flavorR.height - 4);
    expect(paymentR.y).toBeGreaterThanOrEqual(sizeR.y + sizeR.height - 4);
    expect(amountR.x + amountR.width).toBeLessThanOrEqual(paymentR.x + 4);
    expect(paymentR.x + paymentR.width).toBeLessThanOrEqual(cartR.x + 4);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(vp.width + 4);
  }
});
