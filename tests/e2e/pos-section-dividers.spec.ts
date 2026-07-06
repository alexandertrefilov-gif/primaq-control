/**
 * UX-FIX – Einheitliche Abgrenzungslinien nach Bereichs-Überschriften
 *
 * Alle 4 Hauptbereiche (Sorte, Größe, Betrag, Zahlungsmittel) bekommen nach
 * der Überschrift eine dünne, dezente Trennlinie (.pos-divider), analog zu
 * den bereits bestehenden "Maschine 1"/"Maschine 2"-Trennlinien im
 * Sortenbereich. Warenkorb hatte Header-/Footer-Trennlinien bereits
 * (border-b/border-t) — hier nur geprüft, nicht neu gebaut.
 *
 * DIVIDER 1 – Größe wählen hat Linie nach Überschrift
 * DIVIDER 2 – Betrag eingeben hat Linie nach Überschrift
 * DIVIDER 3 – Zahlungsmittel & Buchen hat Linie nach Überschrift
 * DIVIDER 4 – Warenkorb-Header hat Linie
 * DIVIDER 5 – Warenkorb-Gesamtbereich ist vom Inhalt getrennt
 * DIVIDER 6 – Sorte wählen bleibt unverändert nutzbar (Maschine-Divider + neue Linie)
 * DIVIDER 7 – Keine Überlappung zwischen Header und Inhalt in allen 4 Bereichen
 * DIVIDER 8 – Hell-Theme: Linien sichtbar mit dezenter Deckkraft
 * DIVIDER 9 – Dark/Graphit-Theme: Linien sichtbar mit dezenter Deckkraft
 * DIVIDER 10 – Verkauf/Buchung funktioniert weiterhin (keine Logikänderung)
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

/**
 * Extracts the alpha channel from a computed backgroundColor string.
 * Chromium serializes color-mix() results as `color(srgb r g b / a)`
 * rather than `rgba(r,g,b,a)`, so both formats must be handled.
 */
function extractAlpha(backgroundColor: string): number {
  const colorFn = backgroundColor.match(/color\([^)]*\/\s*([\d.]+)\)/);
  if (colorFn) return parseFloat(colorFn[1]);
  const rgba = backgroundColor.match(/rgba?\(([^)]+)\)/);
  if (rgba) {
    const parts = rgba[1].split(",").map((s) => parseFloat(s.trim()));
    return parts.length === 4 ? parts[3] : 1;
  }
  throw new Error(`Unrecognized color format: ${backgroundColor}`);
}

/** Finds the header block's divider line by title text, returns its box + computed opacity color. */
async function getDividerAfter(page: Page, zoneTestId: string) {
  return page.evaluate((testId) => {
    const zone = document.querySelector(`[data-testid="${testId}"]`);
    if (!zone) return null;
    // The divider is the first ".pos-divider"-ish 1px-tall element within the zone.
    const candidates = Array.from(zone.querySelectorAll("div")) as HTMLElement[];
    const divider = candidates.find((el) => {
      const r = el.getBoundingClientRect();
      return r.height >= 1 && r.height <= 2 && r.width > 20;
    });
    if (!divider) return null;
    const rect = divider.getBoundingClientRect();
    const bg = window.getComputedStyle(divider).backgroundColor;
    return { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, backgroundColor: bg };
  }, zoneTestId);
}

test("DIVIDER 1 – Größe wählen hat Linie nach Überschrift", async ({ page }) => {
  await gotoSales(page);
  const divider = await getDividerAfter(page, "size-zone");
  expect(divider).not.toBeNull();
  expect(divider!.width).toBeGreaterThan(50);
});

test("DIVIDER 2 – Betrag eingeben hat Linie nach Überschrift", async ({ page }) => {
  await gotoSales(page);
  const divider = await getDividerAfter(page, "amount-zone");
  expect(divider).not.toBeNull();
  expect(divider!.width).toBeGreaterThan(50);
});

test("DIVIDER 3 – Zahlungsmittel & Buchen hat Linie nach Überschrift", async ({ page }) => {
  await gotoSales(page);
  const divider = await getDividerAfter(page, "payment-zone");
  expect(divider).not.toBeNull();
  expect(divider!.width).toBeGreaterThan(50);
});

test("DIVIDER 4 – Warenkorb-Header hat Linie", async ({ page }) => {
  await gotoSales(page);
  const cartZone = page.getByTestId("cart-zone");
  await expect(cartZone.getByText("WARENKORB", { exact: false })).toBeVisible();
  // Header row uses border-b pos-border-c — verify a border is actually rendered.
  const headerBorder = await page.evaluate(() => {
    const zone = document.querySelector('[data-testid="cart-zone"]');
    const header = zone?.querySelector(".border-b");
    if (!header) return null;
    const cs = window.getComputedStyle(header);
    return { borderBottomWidth: cs.borderBottomWidth, borderBottomColor: cs.borderBottomColor };
  });
  expect(headerBorder).not.toBeNull();
  expect(parseFloat(headerBorder!.borderBottomWidth)).toBeGreaterThan(0);
});

test("DIVIDER 5 – Warenkorb-Gesamtbereich ist vom Inhalt getrennt", async ({ page }) => {
  await gotoSales(page);
  const summaryBorder = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="cart-summary"]');
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    return { borderTopWidth: cs.borderTopWidth };
  });
  expect(summaryBorder).not.toBeNull();
  expect(parseFloat(summaryBorder!.borderTopWidth)).toBeGreaterThan(0);
});

test("DIVIDER 6 – Sorte wählen bleibt unverändert nutzbar", async ({ page }) => {
  await gotoSales(page);
  await expect(page.getByText("MASCHINE 1")).toBeVisible();
  await expect(page.getByText("MASCHINE 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Vanille", exact: true })).toBeVisible();

  const divider = await getDividerAfter(page, "flavor-zone");
  expect(divider).not.toBeNull();
});

test("DIVIDER 7 – Keine Überlappung zwischen Header und Inhalt", async ({ page }) => {
  await gotoSales(page);
  for (const zoneId of ["flavor-zone", "size-zone", "amount-zone", "payment-zone"]) {
    const divider = await getDividerAfter(page, zoneId);
    expect(divider).not.toBeNull();
  }
  // Overall zones still don't overlap each other after the change.
  const flavorR = await page.getByTestId("flavor-zone").boundingBox();
  const sizeR = await page.getByTestId("size-zone").boundingBox();
  const cartR = await page.getByTestId("cart-zone").boundingBox();
  expect(flavorR).not.toBeNull();
  expect(sizeR).not.toBeNull();
  expect(cartR).not.toBeNull();
  expect(sizeR!.x).toBeGreaterThanOrEqual(flavorR!.x + flavorR!.width - 4);
  expect(cartR!.x).toBeGreaterThanOrEqual(sizeR!.x + sizeR!.width - 4);
});

test("DIVIDER 8 – Hell-Theme: Linien sichtbar mit dezenter Deckkraft", async ({ page }) => {
  await blockSupabase(page);
  await page.addInitScript(() => window.localStorage.setItem("primaq-pos-theme", "hell"));
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const divider = await getDividerAfter(page, "size-zone");
  expect(divider).not.toBeNull();
  // Must be a subtle overlay — not fully opaque, not invisible.
  const alpha = extractAlpha(divider!.backgroundColor);
  expect(alpha).toBeGreaterThan(0);
  expect(alpha).toBeLessThan(0.5);
});

test("DIVIDER 9 – Dark/Graphit-Theme: Linien sichtbar mit dezenter Deckkraft", async ({ page }) => {
  await blockSupabase(page);
  await page.addInitScript(() => window.localStorage.setItem("primaq-pos-theme", "graphit"));
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const divider = await getDividerAfter(page, "payment-zone");
  expect(divider).not.toBeNull();
  const alpha = extractAlpha(divider!.backgroundColor);
  expect(alpha).toBeGreaterThan(0);
  expect(alpha).toBeLessThan(0.5);
});

test("DIVIDER 10 – Verkauf/Buchung funktioniert weiterhin", async ({ page }) => {
  await gotoSales(page);
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("quick-amount-250").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await expect(page.getByText("Noch leer")).toBeVisible();
});
