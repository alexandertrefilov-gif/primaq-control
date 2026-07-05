/**
 * Stabiles Standard-Verkaufslayout (Fixed Grid) – E2E Tests
 *
 * Free-Layout ist im Verkaufsbetrieb vollständig deaktiviert: kein Import,
 * keine Render-Pfade, kein Drag/Resize, keine x/y/w/h-Panels — für niemanden,
 * Admin eingeschlossen. /verkauf zeigt immer und ausschließlich das feste
 * Standard-Grid, unabhängig davon, was in localStorage steht.
 *
 * Topologie (5 Bereiche): Sorten (links, 1fr) | Größe über Zahlungsmittel
 * (Mitte, 320-380px) | Warenkorb (rechts, volle Höhe, 360-440px). Der
 * Betrag+Buchen-Bereich läuft unten unter Sorten+Mitte, aber nicht unter
 * dem Warenkorb.
 *
 * Ergänzt tests/e2e/pos-layout-ipad.spec.ts (LAY 1-11: Zonen sichtbar, kein
 * Überlapp, Warenkorb rechts, kein horizontaler Scroll, Buchung funktioniert)
 * und pos-guided-selling.spec.ts (Schrittlogik).
 *
 * GRID 1 – Sichtbarer Abstand zwischen Sorten und Größen
 * GRID 2 – Sichtbarer Abstand zwischen Größen-Spalte und Warenkorb
 * GRID 3 – Sichtbarer Abstand zwischen Betrag/Buchen-Bereich und Footer
 * GRID 4 – Bestellung buchen überlappt nicht die Schnellbetrag-Buttons (Stapel)
 * GRID 5 – Standardlayout sichtbar: Sorten, Größen, Zahlung, Betrag, Warenkorb rechts
 * GRID 6 – Kein Layout-Button, keine Free-Layout-Handles – auch nicht für Admin
 * GRID 7 – Buchung funktioniert im Standardlayout
 * GRID 8 – Verkäufer sieht IMMER das Standard-Grid, selbst mit gespeichertem Free-Layout
 * GRID 9 – Admin sieht ebenfalls IMMER das Standard-Grid, selbst mit gespeichertem Layout
 * GRID 10 – Kaputtes/ungültiges localStorage-Layout wird ignoriert – /verkauf bleibt stabil
 * GRID 11 – Legacy-Layout-Keys werden beim Laden aktiv aus localStorage entfernt
 * GRID 12 – Größe steht direkt über Zahlungsmittel in derselben mittleren Spalte
 * GRID 13 – Betrag/Buchen-Bereich reicht nicht unter den Warenkorb
 * GRID 14 – Zahlungsmittel gesperrt (abgedunkelt, keine Aktion) bis Warenkorb nicht leer
 * GRID 15 – Betrag/Buchen gesperrt (abgedunkelt, keine Aktion) bis Zahlungsmittel gewählt
 * GRID 16 – Nach Buchung: Zahlungsmittel wieder auf Bar zurückgesetzt
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

test("GRID 2 – Sichtbarer Abstand zwischen Größen-Spalte und Warenkorb", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const sizeR = await rect(page, "size-zone");
  const cartR = await rect(page, "cart-zone");
  const hGap = cartR.x - (sizeR.x + sizeR.width);
  expect(hGap).toBeGreaterThanOrEqual(MIN_GAP);
});

test("GRID 3 – Sichtbarer Abstand zwischen Betrag/Buchen-Bereich und Footer", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const amountR = await rect(page, "amount-zone");
  const footerR = await rect(page, "last-booking-bar");
  const vGap = footerR.y - (amountR.y + amountR.height);
  expect(vGap).toBeGreaterThanOrEqual(MIN_GAP);
});

test("GRID 4 – Bestellung buchen überlappt nicht die Schnellbetrag-Buttons", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const quickR = await rect(page, "quick-amounts-row");
  const bookR = await rect(page, "book-button");
  // Book button sits below the quick-amounts stack in the same column, never overlapping it.
  const vGap = bookR.y - (quickR.y + quickR.height);
  expect(vGap).toBeGreaterThanOrEqual(0);
});

test("GRID 5 – Standardlayout sichtbar: Sorten, Größen, Zahlung, Betrag, Warenkorb rechts", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("sales-grid")).toBeVisible();
  await expect(page.getByTestId("flavor-zone")).toBeVisible();
  await expect(page.getByTestId("size-zone")).toBeVisible();
  await expect(page.getByTestId("payment-zone")).toBeVisible();
  await expect(page.getByTestId("amount-zone")).toBeVisible();
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

// ── Neue Topologie: Größe/Zahlungsmittel in der Mitte, Betrag nicht unter Warenkorb ──

test("GRID 12 – Größe steht direkt über Zahlungsmittel in derselben mittleren Spalte", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const sizeR = await rect(page, "size-zone");
  const paymentR = await rect(page, "payment-zone");

  // Zahlungsmittel liegt unterhalb von Größe, kein vertikaler Überlapp
  expect(paymentR.y).toBeGreaterThanOrEqual(sizeR.y + sizeR.height - 4);
  // Beide in derselben Spalte: annähernd gleiche linke Kante
  expect(Math.abs(paymentR.x - sizeR.x)).toBeLessThan(4);
});

test("GRID 13 – Betrag/Buchen-Bereich reicht nicht unter den Warenkorb", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const amountR = await rect(page, "amount-zone");
  const cartR = await rect(page, "cart-zone");
  expect(amountR.x + amountR.width).toBeLessThanOrEqual(cartR.x + 4);
});

// ── Strikte Schritt-Sperrung: sichtbar, abgedunkelt, keine Aktion ────────────

test("GRID 14 – Zahlungsmittel gesperrt bis Warenkorb nicht leer", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Noch nichts im Warenkorb: Zahlungsmittel-Tabs sichtbar, aber ohne Wirkung
  await expect(page.getByTestId("payment-zone")).toBeVisible();
  await expect(page.getByTestId("payment-tab-karte")).toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("payment-tab-karte").click({ force: true });
  // "Karte gewählt"-Indikator darf nicht erscheinen – Klick hatte keine Wirkung
  await expect(page.getByText("Kartenzahlung gewählt")).not.toBeVisible();

  // Nach Sorte+Größe (Warenkorb nicht leer) funktioniert die Auswahl
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await expect(page.getByTestId("payment-tab-karte")).toHaveAttribute("aria-disabled", "false");
  await page.getByTestId("payment-tab-karte").click();
  await expect(page.getByText("Kartenzahlung gewählt")).toBeVisible();
});

test("GRID 15 – Betrag/Buchen aktiv sobald Zahlungsmittel (Bar-Default) aktiv ist", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Vor jeder Auswahl (leerer Warenkorb): Betrag-Bereich gesperrt
  await expect(page.getByTestId("amount-zone")).toHaveCSS("pointer-events", "none");

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();

  // Bar ist bereits als Standard aktiv – Betrag-Bereich ist sofort nutzbar,
  // ohne dass der Bar-Tab erneut angetippt werden muss.
  await expect(page.getByTestId("amount-zone")).not.toHaveCSS("pointer-events", "none");
  await page.getByTestId("cash-plus").click();
  const inputValue = await page.locator('[data-testid="amount-zone"] input').inputValue();
  expect(inputValue).not.toBe("");
});

test("GRID 16 – Nach Buchung: Zahlungsmittel wieder auf Bar zurückgesetzt", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();
  await expect(page.getByText("Noch leer")).toBeVisible();

  // Nächste Bestellung: ohne erneuten Tab-Klick ist Bar bereits wieder aktiv
  // (quick-amounts-row existiert nur im Bar-Modus) – beweist den Reset direkt.
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await expect(page.getByTestId("quick-amounts-row")).toBeVisible();
});
