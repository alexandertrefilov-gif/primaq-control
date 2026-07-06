/**
 * POS-Layout – Stabile Rasterlinien statt isolierter Panel-Größen
 *
 * Nur GEMEINSAME Grid-Linien sind ziehbar, nie ein einzelnes Panel isoliert:
 *   Spalte A = Sorte (1) + Betrag (3)
 *   Spalte B = Größe (2) + Zahlungsmittel (4)
 *   Spalte C = Warenkorb (volle Höhe, beide Zeilen)
 *   Top-Row  = Sorte + Größe
 *   Bottom-Row = Betrag + Zahlungsmittel
 *
 * Genau 3 Splitter: grid-vsplit-1 (A/B), grid-vsplit-2 (B/C), grid-hsplit
 * (oben/unten). Speicherung: localStorage "primaq-pos-grid-layout-v1" als
 * Fraktionen (colA+colB+colC=1, topRow+bottomRow=1), pro Gerät, nicht
 * synchronisiert.
 *
 * GRIDRESIZE 1  – Layoutmodus zeigt genau 3 Splitter, keine Panel-Eckgriffe
 * GRIDRESIZE 2  – Admin sieht "Layout anpassen"
 * GRIDRESIZE 3  – Verkäufer sieht "Layout anpassen" nicht
 * GRIDRESIZE 4  – Ziehen A/B verändert Spalte A und B (nicht isolierte Panels)
 * GRIDRESIZE 5  – Ziehen B/C verändert Spalte B und Warenkorb
 * GRIDRESIZE 6  – Ziehen Top/Bottom verändert obere und untere Reihe
 * GRIDRESIZE 7  – Bereich 1 und Bereich 3 behalten gleiche Breite
 * GRIDRESIZE 8  – Bereich 2 und Bereich 4 behalten gleiche Breite
 * GRIDRESIZE 9  – Warenkorb bleibt rechts über beide Reihen
 * GRIDRESIZE 10 – Keine Überlappung nach Resize
 * GRIDRESIZE 11 – Reset stellt stabile Defaults wieder her
 * GRIDRESIZE 12 – Alte Free-Layout-Keys werden ignoriert
 * GRIDRESIZE 13 – Layout sauber bei 1366×1024 / 1194×834 / 1024×768
 * GRIDRESIZE 14 – Verkauf/Buchung funktioniert nach Resize weiter
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

test("GRIDRESIZE 1 – Layoutmodus zeigt genau 3 Splitter, keine Panel-Eckgriffe", async ({ page }) => {
  await gotoAsAdmin(page);
  await page.getByTestId("grid-layout-toggle").click();

  await expect(page.getByTestId("grid-layout-toggle")).toHaveText("Fertig");
  await expect(page.getByTestId("grid-layout-reset")).toBeVisible();
  await expect(page.getByTestId("grid-vsplit-1")).toBeVisible();
  await expect(page.getByTestId("grid-vsplit-2")).toBeVisible();
  await expect(page.getByTestId("grid-hsplit")).toBeVisible();

  // Kein vierter/weiterer Splitter und keine Panel-Eckgriffe.
  await expect(page.getByTestId("grid-vsplit-3")).toHaveCount(0);
  await expect(page.locator('[data-testid^="panel-handle"]')).toHaveCount(0);
});

test("GRIDRESIZE 2 – Admin sieht Layout anpassen-Button", async ({ page }) => {
  await gotoAsAdmin(page);
  await expect(page.getByTestId("grid-layout-toggle")).toBeVisible();
});

test("GRIDRESIZE 3 – Verkäufer sieht Layout anpassen-Button nicht", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);
  await expect(page.getByTestId("grid-layout-toggle")).toHaveCount(0);
});

test("GRIDRESIZE 4 – Ziehen A/B verändert Spalte A und B, nicht isolierte Panels", async ({ page }) => {
  await gotoAsAdmin(page);
  const beforeFlavor = await page.getByTestId("flavor-zone").boundingBox();
  const beforeSize = await page.getByTestId("size-zone").boundingBox();
  const beforeCart = await page.getByTestId("cart-zone").boundingBox();
  expect(beforeFlavor).not.toBeNull();
  expect(beforeSize).not.toBeNull();
  expect(beforeCart).not.toBeNull();

  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-vsplit-1", 100, 0);
  await page.getByTestId("grid-layout-toggle").click();

  const afterFlavor = await page.getByTestId("flavor-zone").boundingBox();
  const afterSize = await page.getByTestId("size-zone").boundingBox();
  const afterCart = await page.getByTestId("cart-zone").boundingBox();
  expect(afterFlavor).not.toBeNull();
  expect(afterSize).not.toBeNull();
  expect(afterCart).not.toBeNull();

  expect(afterFlavor!.width).toBeGreaterThan(beforeFlavor!.width + 20);
  expect(afterSize!.width).toBeLessThan(beforeSize!.width - 20);
  // Warenkorb (Spalte C) bleibt von der A/B-Grenze unberührt.
  expect(Math.abs(afterCart!.width - beforeCart!.width)).toBeLessThan(4);
});

test("GRIDRESIZE 5 – Ziehen B/C verändert Spalte B und Warenkorb", async ({ page }) => {
  await gotoAsAdmin(page);
  const beforeSize = await page.getByTestId("size-zone").boundingBox();
  const beforeCart = await page.getByTestId("cart-zone").boundingBox();
  const beforeFlavor = await page.getByTestId("flavor-zone").boundingBox();
  expect(beforeSize).not.toBeNull();
  expect(beforeCart).not.toBeNull();

  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-vsplit-2", 80, 0);
  await page.getByTestId("grid-layout-toggle").click();

  const afterSize = await page.getByTestId("size-zone").boundingBox();
  const afterCart = await page.getByTestId("cart-zone").boundingBox();
  const afterFlavor = await page.getByTestId("flavor-zone").boundingBox();
  expect(afterSize).not.toBeNull();
  expect(afterCart).not.toBeNull();

  expect(afterSize!.width).toBeGreaterThan(beforeSize!.width + 20);
  expect(afterCart!.width).toBeLessThan(beforeCart!.width - 20);
  // Spalte A (Sorte/Betrag) bleibt von der B/C-Grenze unberührt.
  expect(Math.abs(afterFlavor!.width - beforeFlavor!.width)).toBeLessThan(4);
});

test("GRIDRESIZE 6 – Ziehen Top/Bottom verändert obere und untere Reihe", async ({ page }) => {
  await gotoAsAdmin(page);
  const beforeTop = await page.getByTestId("flavor-zone").boundingBox();
  const beforeBottom = await page.getByTestId("amount-zone").boundingBox();
  expect(beforeTop).not.toBeNull();
  expect(beforeBottom).not.toBeNull();

  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-hsplit", 0, 50);

  const afterTop = await page.getByTestId("flavor-zone").boundingBox();
  const afterBottom = await page.getByTestId("amount-zone").boundingBox();
  expect(afterTop).not.toBeNull();
  expect(afterBottom).not.toBeNull();
  expect(afterTop!.height).toBeGreaterThan(beforeTop!.height + 25);
  expect(afterBottom!.height).toBeLessThan(beforeBottom!.height - 25);
});

test("GRIDRESIZE 7 – Bereich 1 und Bereich 3 behalten gleiche Breite", async ({ page }) => {
  await gotoAsAdmin(page);
  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-vsplit-1", 60, 0);
  await dragBy(page, "grid-vsplit-2", -40, 0);
  await page.getByTestId("grid-layout-toggle").click();

  const flavorR = await page.getByTestId("flavor-zone").boundingBox();
  const amountR = await page.getByTestId("amount-zone").boundingBox();
  expect(flavorR).not.toBeNull();
  expect(amountR).not.toBeNull();
  expect(Math.abs(flavorR!.width - amountR!.width)).toBeLessThan(2);
  expect(Math.abs(flavorR!.x - amountR!.x)).toBeLessThan(2);
});

test("GRIDRESIZE 8 – Bereich 2 und Bereich 4 behalten gleiche Breite", async ({ page }) => {
  await gotoAsAdmin(page);
  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-vsplit-1", 60, 0);
  await dragBy(page, "grid-vsplit-2", -40, 0);
  await page.getByTestId("grid-layout-toggle").click();

  const sizeR = await page.getByTestId("size-zone").boundingBox();
  const paymentR = await page.getByTestId("payment-zone").boundingBox();
  expect(sizeR).not.toBeNull();
  expect(paymentR).not.toBeNull();
  expect(Math.abs(sizeR!.width - paymentR!.width)).toBeLessThan(2);
  expect(Math.abs(sizeR!.x - paymentR!.x)).toBeLessThan(2);
});

test("GRIDRESIZE 9 – Warenkorb bleibt rechts über beide Reihen", async ({ page }) => {
  await gotoAsAdmin(page);
  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-hsplit", 0, 40);
  await page.getByTestId("grid-layout-toggle").click();

  const flavorR = await page.getByTestId("flavor-zone").boundingBox();
  const amountR = await page.getByTestId("amount-zone").boundingBox();
  const cartR = await page.getByTestId("cart-zone").boundingBox();
  expect(flavorR).not.toBeNull();
  expect(amountR).not.toBeNull();
  expect(cartR).not.toBeNull();

  expect(cartR!.x).toBeGreaterThan(flavorR!.x);
  expect(Math.abs(cartR!.y - flavorR!.y)).toBeLessThan(4);
  expect(cartR!.y + cartR!.height).toBeGreaterThanOrEqual(amountR!.y + amountR!.height - 4);
});

test("GRIDRESIZE 10 – Keine Überlappung nach Resize", async ({ page }) => {
  await gotoAsAdmin(page);
  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-vsplit-1", 80, 0);
  await dragBy(page, "grid-vsplit-2", -60, 0);
  await dragBy(page, "grid-hsplit", 0, 50);
  await page.getByTestId("grid-layout-toggle").click();

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
  expect(amountR!.y).toBeGreaterThanOrEqual(flavorR!.y + flavorR!.height - 4);
});

test("GRIDRESIZE 11 – Reset stellt stabile Defaults wieder her", async ({ page }) => {
  await gotoAsAdmin(page);
  const defaultBox = await page.getByTestId("flavor-zone").boundingBox();
  expect(defaultBox).not.toBeNull();

  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-vsplit-1", 100, 0);

  const resizedBox = await page.getByTestId("flavor-zone").boundingBox();
  expect(resizedBox).not.toBeNull();
  expect(resizedBox!.width).toBeGreaterThan(defaultBox!.width + 20);

  await page.getByTestId("grid-layout-reset").click();

  const resetBox = await page.getByTestId("flavor-zone").boundingBox();
  expect(resetBox).not.toBeNull();
  expect(Math.abs(resetBox!.width - defaultBox!.width)).toBeLessThan(4);

  const stored = await page.evaluate(() => localStorage.getItem("primaq-pos-grid-layout-v1"));
  expect(stored).toBeNull();
});

test("GRIDRESIZE 12 – Alte Free-Layout-Keys werden ignoriert", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.addInitScript(() => {
    localStorage.setItem("primaq-pos-free-layout-v1", JSON.stringify({ panels: [{ id: "cart", x: 999, y: 999, w: 50, h: 50 }] }));
    localStorage.setItem("primaq-pos-device-layout-v1", JSON.stringify({ broken: true }));
  });
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const flavorBox = await page.getByTestId("flavor-zone").boundingBox();
  const cartBox = await page.getByTestId("cart-zone").boundingBox();
  expect(flavorBox).not.toBeNull();
  expect(cartBox).not.toBeNull();
  expect(flavorBox!.x).toBeGreaterThanOrEqual(0);
  expect(cartBox!.width).toBeGreaterThan(300);

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
  test(`GRIDRESIZE 13 – Layout sauber bei ${vp.label}`, async ({ page }) => {
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
    expect(amountR!.y).toBeGreaterThanOrEqual(flavorR!.y + flavorR!.height - 4);

    await expect(page.getByTestId("book-button")).toBeInViewport();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(vp.width + 4);
  });
}

test("GRIDRESIZE 14 – Verkauf/Buchung funktioniert nach Resize weiter", async ({ page }) => {
  await gotoAsAdmin(page);
  await page.getByTestId("grid-layout-toggle").click();
  await dragBy(page, "grid-vsplit-1", 60, 0);
  await dragBy(page, "grid-vsplit-2", -40, 0);
  await dragBy(page, "grid-hsplit", 0, 40);
  await page.getByTestId("grid-layout-toggle").click();

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("quick-amount-250").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await expect(page.getByText("Noch leer")).toBeVisible();
});
