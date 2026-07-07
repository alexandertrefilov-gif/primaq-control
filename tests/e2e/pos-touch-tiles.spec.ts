/**
 * UX – Bereich 1 (Sorte) und Bereich 2 (Größe) als vollflächige Touch-Kacheln
 *
 * Statt großer Container mit kleinen, fest großen Buttons darin füllt jede
 * Sorten-/Größen-Kachel jetzt den kompletten verfügbaren Platz aus (3
 * Spalten Sorte, 3 volle Zeilen Größe) — keine feste Kartengröße-Einstellung
 * mehr, keine grauen Leerflächen. Karten wachsen automatisch mit dem
 * Bereich mit.
 *
 * TILES 1  – Sortenkacheln füllen die komplette Zeilenbreite (keine Restfläche)
 * TILES 2  – Größenkacheln füllen die komplette Bereichsbreite
 * TILES 3  – Größenkacheln füllen die komplette Bereichshöhe zu je einem Drittel
 * TILES 4  – Sortenkacheln wachsen mit größerem Viewport mit
 * TILES 5  – Tactile-Press-Klasse ist auf Sorten- und Größenkacheln vorhanden
 * TILES 6  – Ausgewählte Sorte zeigt Ring, Glow und Haken
 * TILES 7  – Maschine 1 / Maschine 2 Trennlinien bleiben erhalten
 * TILES 8  – Keine Überlappung bei 1366×1024 / 1194×834 / 1024×768
 * TILES 9  – Verkauf/Buchung funktioniert weiterhin
 */

import { expect, test, type Page } from "@playwright/test";

async function blockSupabase(page: Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function waitLoaded(page: Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function gotoSales(page: Page, viewport = { width: 1366, height: 1024 }) {
  await blockSupabase(page);
  await page.setViewportSize(viewport);
  await page.goto("/verkauf");
  await waitLoaded(page);
}

test("TILES 1 – Sortenkacheln füllen die komplette Zeilenbreite", async ({ page }) => {
  await gotoSales(page);

  const flavorZone = await page.getByTestId("flavor-zone").boundingBox();
  const vanille = await page.getByRole("button", { name: "Vanille", exact: true }).boundingBox();
  const mix = await page.getByRole("button", { name: "Mix Vanille/Schokolade", exact: true }).boundingBox();
  expect(flavorZone).not.toBeNull();
  expect(vanille).not.toBeNull();
  expect(mix).not.toBeNull();

  // First tile starts near the zone's left edge, last tile ends near its right edge —
  // no large leftover margin on either side (only the ~16px outer padding).
  expect(vanille!.x - flavorZone!.x).toBeLessThan(24);
  const rightGap = flavorZone!.x + flavorZone!.width - (mix!.x + mix!.width);
  expect(rightGap).toBeLessThan(24);
});

test("TILES 2 – Größenkacheln füllen die komplette Bereichsbreite", async ({ page }) => {
  await gotoSales(page);

  const sizeZone = await page.getByTestId("size-zone").boundingBox();
  const kleinBox = await page.getByTestId("size-btn-klein").boundingBox();
  expect(sizeZone).not.toBeNull();
  expect(kleinBox).not.toBeNull();

  expect(kleinBox!.x - sizeZone!.x).toBeLessThan(24);
  const rightGap = sizeZone!.x + sizeZone!.width - (kleinBox!.x + kleinBox!.width);
  expect(rightGap).toBeLessThan(24);
});

test("TILES 3 – Größenkacheln füllen die komplette Bereichshöhe zu je einem Drittel", async ({ page }) => {
  await gotoSales(page);

  const klein = await page.getByTestId("size-btn-klein").boundingBox();
  const mittel = await page.getByTestId("size-btn-mittel").boundingBox();
  const gross = await page.getByTestId("size-btn-gross").boundingBox();
  expect(klein).not.toBeNull();
  expect(mittel).not.toBeNull();
  expect(gross).not.toBeNull();

  // Roughly equal heights (within a few px of rounding/gap distribution).
  expect(Math.abs(klein!.height - mittel!.height)).toBeLessThan(4);
  expect(Math.abs(mittel!.height - gross!.height)).toBeLessThan(4);
  // Stacked directly below one another with only the 12px gap between.
  expect(mittel!.y - (klein!.y + klein!.height)).toBeLessThan(16);
  expect(gross!.y - (mittel!.y + mittel!.height)).toBeLessThan(16);
});

test("TILES 4 – Sortenkacheln wachsen mit größerem Viewport mit", async ({ page }) => {
  await gotoSales(page, { width: 1194, height: 834 });
  const narrow = await page.getByRole("button", { name: "Vanille", exact: true }).boundingBox();
  expect(narrow).not.toBeNull();

  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.waitForTimeout(200);
  const wide = await page.getByRole("button", { name: "Vanille", exact: true }).boundingBox();
  expect(wide).not.toBeNull();

  expect(wide!.width).toBeGreaterThan(narrow!.width + 10);
});

test("TILES 5 – Tactile-Press-Klasse ist auf Sorten- und Größenkacheln vorhanden", async ({ page }) => {
  await gotoSales(page);

  const flavorHasTactile = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('[data-testid="flavor-zone"] button')).find((b) =>
      b.textContent?.includes("Vanille")
    );
    return btn?.classList.contains("pos-touch-tile") ?? false;
  });
  expect(flavorHasTactile).toBe(true);

  const sizeHasTactile = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="size-btn-klein"]');
    return btn?.classList.contains("pos-touch-tile") ?? false;
  });
  expect(sizeHasTactile).toBe(true);
});

test("TILES 6 – Ausgewählte Sorte zeigt Ring, Glow und Haken", async ({ page }) => {
  await gotoSales(page);
  await page.getByRole("button", { name: "Vanille", exact: true }).click();

  const vanille = page.getByRole("button", { name: "Vanille", exact: true });
  await expect(vanille).toHaveClass(/ring-\[#22c55e\]/);
  await expect(vanille.getByText("✓")).toBeVisible();
});

test("TILES 7 – Maschine 1 / Maschine 2 Trennlinien bleiben erhalten", async ({ page }) => {
  await gotoSales(page);
  await expect(page.getByText("MASCHINE 1")).toBeVisible();
  await expect(page.getByText("MASCHINE 2")).toBeVisible();
});

for (const vp of [
  { width: 1366, height: 1024, label: "1366×1024" },
  { width: 1194, height: 834, label: "1194×834" },
  { width: 1024, height: 768, label: "1024×768" },
]) {
  test(`TILES 8 – Keine Überlappung bei ${vp.label}`, async ({ page }) => {
    await gotoSales(page, vp);

    const flavorR = await page.getByTestId("flavor-zone").boundingBox();
    const sizeR = await page.getByTestId("size-zone").boundingBox();
    const cartR = await page.getByTestId("cart-zone").boundingBox();
    expect(flavorR).not.toBeNull();
    expect(sizeR).not.toBeNull();
    expect(cartR).not.toBeNull();

    expect(sizeR!.x).toBeGreaterThanOrEqual(flavorR!.x + flavorR!.width - 4);
    expect(cartR!.x).toBeGreaterThanOrEqual(sizeR!.x + sizeR!.width - 4);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(vp.width + 4);
  });
}

test("TILES 9 – Verkauf/Buchung funktioniert weiterhin", async ({ page }) => {
  await gotoSales(page);
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("quick-amount-250").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await expect(page.getByText("Noch leer")).toBeVisible();
});
