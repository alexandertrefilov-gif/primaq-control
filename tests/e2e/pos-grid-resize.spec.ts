/**
 * POS-Layout – Alle 5 Verkaufsbereiche per Maus/Touch skalierbar
 *
 * Feste 4-Quadranten-Struktur bleibt erhalten (Sorte | Größe | Warenkorb /
 * Betrag | Zahlungsmittel+Buchen | Warenkorb), aber im Admin-Layoutmodus
 * lassen sich alle gemeinsamen Grenzen per Maus/Touch ziehen:
 *   A) grid-vsplit-1 – Sorte/Größe (obere Zeile)
 *   B/C) grid-vsplit-2 – Größe-Zahlungsmittel-Spalte / Warenkorb
 *   D) grid-hsplit – obere/untere Zeile
 *   E) grid-vsplit-3 – Betrag/Zahlungsmittel (untere Zeile, unabhängig von A)
 *
 * Speicherung: localStorage "primaq-pos-grid-layout-v1" (verschachteltes
 * Schema columns/rows/bottomSplit), pro Gerät, nicht synchronisiert.
 *
 * GRIDRESIZE 1  – Admin sieht "Layout anpassen"
 * GRIDRESIZE 2  – Verkäufer sieht "Layout anpassen" nicht
 * GRIDRESIZE 3  – Layoutmodus zeigt alle 4 Resize-Griffe
 * GRIDRESIZE 4  – Splitter A verändert Breite Sorte/Größe
 * GRIDRESIZE 5  – Splitter B/C verändert Warenkorbbreite
 * GRIDRESIZE 6  – Splitter D verändert obere/untere Row-Höhe
 * GRIDRESIZE 7  – Splitter E verändert Betrag/Zahlungsmittel unabhängig von A
 * GRIDRESIZE 8  – Werte bleiben nach Reload erhalten
 * GRIDRESIZE 9  – Reset stellt Standardlayout wieder her
 * GRIDRESIZE 10 – Alte Free-Layout-Keys beeinflussen Standardlayout nicht
 * GRIDRESIZE 11 – Keine Überlappung bei 1366×1024 / 1194×834 / 1024×768
 * GRIDRESIZE 12 – Verkauf/Buchung funktioniert nach Resize weiter
 */

import { expect, test, type Page } from "@playwright/test";

async function blockSupabase(page: Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function waitLoaded(page: Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function seedAdmin(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

async function gotoAsAdmin(page: Page, viewport = { width: 1366, height: 1024 }) {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.setViewportSize(viewport);
  await page.goto("/verkauf");
  await waitLoaded(page);
}

async function dragBy(page: Page, testId: string, dx: number, dy: number) {
  const handle = page.getByTestId(testId);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`${testId} not found`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 10 });
  await page.mouse.up();
}

test("GRIDRESIZE 1 – Admin sieht Layout anpassen-Button", async ({ page }) => {
  await gotoAsAdmin(page);
  await expect(page.getByTestId("grid-layout-toggle")).toBeVisible();
});

test("GRIDRESIZE 2 – Verkäufer sieht Layout anpassen-Button nicht", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);
  await expect(page.getByTestId("grid-layout-toggle")).toHaveCount(0);
});

test("GRIDRESIZE 3 – Layoutmodus zeigt alle 4 Resize-Griffe", async ({ page }) => {
  await gotoAsAdmin(page);
  await page.getByTestId("grid-layout-toggle").click();

  await expect(page.getByTestId("grid-layout-toggle")).toHaveText("Fertig");
  await expect(page.getByTestId("grid-layout-reset")).toBeVisible();
  await expect(page.getByTestId("grid-vsplit-1")).toBeVisible();
  await expect(page.getByTestId("grid-vsplit-2")).toBeVisible();
  await expect(page.getByTestId("grid-vsplit-3")).toBeVisible();
  await expect(page.getByTestId("grid-hsplit")).toBeVisible();
});

test("GRIDRESIZE 4 – Splitter A verändert Breite Sorte/Größe", async ({ page }) => {
  await gotoAsAdmin(page);
  const before = await page.getByTestId("flavor-zone").boundingBox();
  expect(before).not.toBeNull();

  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-vsplit-1", 100, 0);
  await page.getByTestId("grid-layout-toggle").click();

  const wider = await page.getByTestId("flavor-zone").boundingBox();
  expect(wider).not.toBeNull();
  expect(wider!.width).toBeGreaterThan(before!.width + 40);

  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-vsplit-1", -150, 0);
  await page.getByTestId("grid-layout-toggle").click();

  const narrower = await page.getByTestId("flavor-zone").boundingBox();
  expect(narrower).not.toBeNull();
  expect(narrower!.width).toBeLessThan(wider!.width - 60);
});

test("GRIDRESIZE 5 – Splitter B/C verändert Warenkorbbreite", async ({ page }) => {
  await gotoAsAdmin(page);
  const before = await page.getByTestId("cart-zone").boundingBox();
  expect(before).not.toBeNull();

  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-vsplit-2", -80, 0);

  const wider = await page.getByTestId("cart-zone").boundingBox();
  expect(wider).not.toBeNull();
  expect(wider!.width).toBeGreaterThan(before!.width + 40);

  await dragBy(page, "grid-vsplit-2", 120, 0);
  const narrower = await page.getByTestId("cart-zone").boundingBox();
  expect(narrower).not.toBeNull();
  expect(narrower!.width).toBeLessThan(wider!.width - 60);
});

test("GRIDRESIZE 6 – Splitter D verändert obere/untere Row-Höhe", async ({ page }) => {
  await gotoAsAdmin(page);
  const beforeTop = await page.getByTestId("flavor-zone").boundingBox();
  const beforeBottom = await page.getByTestId("amount-zone").boundingBox();
  expect(beforeTop).not.toBeNull();
  expect(beforeBottom).not.toBeNull();

  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-hsplit", 0, 60);

  const afterTop = await page.getByTestId("flavor-zone").boundingBox();
  const afterBottom = await page.getByTestId("amount-zone").boundingBox();
  expect(afterTop).not.toBeNull();
  expect(afterBottom).not.toBeNull();
  expect(afterTop!.height).toBeGreaterThan(beforeTop!.height + 30);
  expect(afterBottom!.height).toBeLessThan(beforeBottom!.height - 30);
});

test("GRIDRESIZE 7 – Splitter E verändert Betrag/Zahlungsmittel unabhängig von A", async ({ page }) => {
  await gotoAsAdmin(page);
  const beforeAmount = await page.getByTestId("amount-zone").boundingBox();
  const beforePayment = await page.getByTestId("payment-zone").boundingBox();
  const beforeFlavor = await page.getByTestId("flavor-zone").boundingBox();
  const beforeSize = await page.getByTestId("size-zone").boundingBox();
  expect(beforeAmount).not.toBeNull();
  expect(beforePayment).not.toBeNull();

  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-vsplit-3", 100, 0);
  await page.getByTestId("grid-layout-toggle").click();

  const afterAmount = await page.getByTestId("amount-zone").boundingBox();
  const afterPayment = await page.getByTestId("payment-zone").boundingBox();
  const afterFlavor = await page.getByTestId("flavor-zone").boundingBox();
  const afterSize = await page.getByTestId("size-zone").boundingBox();
  expect(afterAmount).not.toBeNull();
  expect(afterPayment).not.toBeNull();

  expect(afterAmount!.width).toBeGreaterThan(beforeAmount!.width + 20);
  expect(afterPayment!.width).toBeLessThan(beforePayment!.width - 20);

  // Die obere Reihe (Sorte/Größe) bleibt von Splitter E unberührt.
  expect(Math.abs(afterFlavor!.width - beforeFlavor!.width)).toBeLessThan(4);
  expect(Math.abs(afterSize!.width - beforeSize!.width)).toBeLessThan(4);
});

test("GRIDRESIZE 8 – Werte bleiben nach Reload erhalten", async ({ page }) => {
  await gotoAsAdmin(page);
  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-vsplit-1", 100, 0);
  await dragBy(page, "grid-vsplit-3", 80, 0);
  await page.getByTestId("grid-layout-toggle").click();

  const flavorBefore = await page.getByTestId("flavor-zone").boundingBox();
  const amountBefore = await page.getByTestId("amount-zone").boundingBox();
  expect(flavorBefore).not.toBeNull();
  expect(amountBefore).not.toBeNull();

  await page.reload();
  await waitLoaded(page);

  const flavorAfter = await page.getByTestId("flavor-zone").boundingBox();
  const amountAfter = await page.getByTestId("amount-zone").boundingBox();
  expect(flavorAfter).not.toBeNull();
  expect(amountAfter).not.toBeNull();
  expect(Math.abs(flavorAfter!.width - flavorBefore!.width)).toBeLessThan(4);
  expect(Math.abs(amountAfter!.width - amountBefore!.width)).toBeLessThan(4);

  // Layoutmodus selbst wird nicht persistiert — nur die Größen.
  await expect(page.getByTestId("grid-layout-toggle")).toHaveText("Layout anpassen");
});

test("GRIDRESIZE 9 – Reset stellt Standardlayout wieder her", async ({ page }) => {
  await gotoAsAdmin(page);
  const defaultBox = await page.getByTestId("flavor-zone").boundingBox();
  expect(defaultBox).not.toBeNull();

  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-vsplit-1", 100, 0);

  const resizedBox = await page.getByTestId("flavor-zone").boundingBox();
  expect(resizedBox).not.toBeNull();
  expect(resizedBox!.width).toBeGreaterThan(defaultBox!.width + 40);

  await page.getByTestId("grid-layout-reset").click();

  const resetBox = await page.getByTestId("flavor-zone").boundingBox();
  expect(resetBox).not.toBeNull();
  expect(Math.abs(resetBox!.width - defaultBox!.width)).toBeLessThan(4);

  const stored = await page.evaluate(() => localStorage.getItem("primaq-pos-grid-layout-v1"));
  expect(stored).toBeNull();
});

test("GRIDRESIZE 10 – Alte Free-Layout-Keys beeinflussen Standardlayout nicht", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.addInitScript(() => {
    localStorage.setItem("primaq-pos-free-layout-v1", JSON.stringify({ panels: [{ id: "cart", x: 999, y: 999, w: 50, h: 50 }] }));
    localStorage.setItem("primaq-pos-device-layout-v1", JSON.stringify({ broken: true }));
  });
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Standardlayout wird verwendet, keine Panels an kaputten Koordinaten.
  const flavorBox = await page.getByTestId("flavor-zone").boundingBox();
  const cartBox = await page.getByTestId("cart-zone").boundingBox();
  expect(flavorBox).not.toBeNull();
  expect(cartBox).not.toBeNull();
  expect(flavorBox!.x).toBeGreaterThanOrEqual(0);
  expect(cartBox!.width).toBeGreaterThan(300);

  // Die kaputten Legacy-Keys werden aktiv entfernt.
  const legacy1 = await page.evaluate(() => localStorage.getItem("primaq-pos-free-layout-v1"));
  const legacy2 = await page.evaluate(() => localStorage.getItem("primaq-pos-device-layout-v1"));
  expect(legacy1).toBeNull();
  expect(legacy2).toBeNull();
});

for (const vp of [
  { width: 1366, height: 1024, label: "1366×1024" },
  { width: 1194, height: 834, label: "1194×834" },
  { width: 1024, height: 768, label: "1024×768" },
]) {
  test(`GRIDRESIZE 11 – Keine Überlappung bei ${vp.label}`, async ({ page }) => {
    await gotoAsAdmin(page, vp);

    await expect(page.getByTestId("flavor-zone")).toBeVisible();
    await expect(page.getByTestId("size-zone")).toBeVisible();
    await expect(page.getByTestId("amount-zone")).toBeVisible();
    await expect(page.getByTestId("payment-zone")).toBeVisible();
    await expect(page.getByTestId("cart-zone")).toBeVisible();

    const flavorR = await page.getByTestId("flavor-zone").boundingBox();
    const sizeR = await page.getByTestId("size-zone").boundingBox();
    const cartR = await page.getByTestId("cart-zone").boundingBox();
    const amountR = await page.getByTestId("amount-zone").boundingBox();
    const paymentR = await page.getByTestId("payment-zone").boundingBox();
    expect(flavorR).not.toBeNull();
    expect(sizeR).not.toBeNull();
    expect(cartR).not.toBeNull();
    expect(amountR).not.toBeNull();
    expect(paymentR).not.toBeNull();

    expect(sizeR!.x).toBeGreaterThanOrEqual(flavorR!.x + flavorR!.width - 4);
    expect(cartR!.x).toBeGreaterThanOrEqual(sizeR!.x + sizeR!.width - 4);
    expect(paymentR!.x).toBeGreaterThanOrEqual(amountR!.x + amountR!.width - 4);
    expect(cartR!.x).toBeGreaterThanOrEqual(paymentR!.x + paymentR!.width - 4);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(vp.width + 4);
  });
}

test("GRIDRESIZE 12 – Verkauf/Buchung funktioniert nach Resize weiter", async ({ page }) => {
  await gotoAsAdmin(page);
  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-vsplit-1", 80, 0);
  await dragBy(page, "grid-hsplit", 0, 50);
  await dragBy(page, "grid-vsplit-3", -60, 0);
  await page.getByTestId("grid-layout-toggle").click();

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("quick-amount-250").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await expect(page.getByText("Noch leer")).toBeVisible();
});
