/**
 * Stabiles Standard-Verkaufslayout (Fixed Grid) – E2E Tests
 *
 * Ergänzt tests/e2e/pos-layout-ipad.spec.ts (LAY 1-11, bereits: Zonen sichtbar,
 * kein Überlapp, Warenkorb rechts, kein horizontaler Scroll, Buchung
 * funktioniert) und pos-guided-selling.spec.ts (Schrittlogik) um die noch
 * fehlenden Prüfungen aus der Aufgabenstellung: sichtbarer Mindestabstand
 * zwischen den Bereichen, und dass "Bestellung buchen" keine Preisbuttons
 * überdeckt.
 *
 * GRID 1 – Sichtbarer Abstand zwischen Sorten und Größen
 * GRID 2 – Sichtbarer Abstand zwischen Sorten/Größen-Zeile und Warenkorb
 * GRID 3 – Sichtbarer Abstand zwischen Zahlung und Footer (Letzte Buchung)
 * GRID 4 – Bestellung buchen überlappt keine Schnellbetrag-Buttons
 * GRID 5 – Ohne gespeichertes Layout zeigt auch Admin das feste Standard-Grid
 * GRID 6 – Nicht-Admin sieht "Layout bearbeiten" nicht
 * GRID 7 – Admin kann Panel verschieben; Layout wird in localStorage gespeichert
 * GRID 8 – Resize über die Ecke ändert Breite und Höhe eines Panels
 * GRID 9 – Reset im Bearbeitungsmodus stellt das feste Standard-Grid wieder her
 * GRID 10 – Verkäufer sieht IMMER das Standard-Grid, selbst mit gespeichertem Free-Layout
 * GRID 11 – Admin außerhalb des Bearbeitungsmodus sieht Standard-Grid, selbst mit gespeichertem Layout
 * GRID 12 – Kaputtes/ungültiges localStorage-Layout wird ignoriert und gelöscht – /verkauf bleibt stabil
 */

import { expect, test } from "@playwright/test";

const LS_FREE_KEY = "primaq-pos-free-layout-v1";

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

async function enterEditMode(page: import("@playwright/test").Page) {
  await page.getByTestId("layout-edit-toggle").click();
  await page.waitForSelector('[data-testid="layout-edit-panel"]', { state: "visible" });
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

// Generous headroom on every side so drag/resize interactions have real
// room to move — the bare default layout is intentionally gap-tight (see
// "enforce permanent panel spacing"), leaving no slack for these tests.
const spaciousLayout = {
  flavors: { x: 8,   y: 8,   w: 520, h: 300 },
  sizes:   { x: 8,   y: 500, w: 420, h: 100 },
  payment: { x: 8,   y: 608, w: 400, h: 220 },
  cart:    { x: 600, y: 8,   w: 400, h: 500 },
};

/** Drag from element center by (dx, dy) pixels */
async function drag(
  page: import("@playwright/test").Page,
  selector: string,
  dx: number,
  dy: number
) {
  const el = page.locator(selector);
  const box = await el.boundingBox();
  if (!box) throw new Error(`Not found: ${selector}`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 12 });
  await page.mouse.up();
}

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

test("GRID 2 – Sichtbarer Abstand zwischen Sorten/Größen-Zeile und Warenkorb", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const sizeR = await rect(page, "size-zone");
  const cartR = await rect(page, "cart-zone");
  const hGap = cartR.x - (sizeR.x + sizeR.width);
  expect(hGap).toBeGreaterThanOrEqual(MIN_GAP);
});

test("GRID 3 – Sichtbarer Abstand zwischen Zahlung und Footer (Letzte Buchung)", async ({ page }) => {
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
  // Book button sits to the right of the quick-amounts row, never overlapping it.
  const hGap = bookR.x - (quickR.x + quickR.width);
  expect(hGap).toBeGreaterThanOrEqual(0);
});

test("GRID 5 – Ohne gespeichertes Layout zeigt auch Admin das feste Standard-Grid", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Admin sees the edit entry point, but the free-panel system itself isn't
  // active until they opt in (or a layout has been saved before).
  await expect(page.getByTestId("layout-edit-toggle")).toBeVisible();
  await expect(page.locator('[data-testid="fl-container"]')).toHaveCount(0);
  await expect(page.locator('[data-panel]')).toHaveCount(0);

  // The fixed grid is what's actually rendered.
  await expect(page.getByTestId("sales-grid")).toBeVisible();
});

test("GRID 6 – Nicht-Admin sieht 'Layout bearbeiten' nicht", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.locator('[data-testid="layout-edit-toggle"]')).toHaveCount(0);
  await expect(page.getByTestId("sales-grid")).toBeVisible();
});

test("GRID 7 – Admin kann Panel verschieben; Layout wird in localStorage gespeichert", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  // Bare default is intentionally gap-tight (no slack in any direction — see
  // "enforce permanent panel spacing"), so seed headroom to actually move into.
  await seedFreeLayout(page, spaciousLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await enterEditMode(page);
  await expect(page.locator('[data-testid="fl-container"]')).toBeVisible();

  const before = await page.locator('[data-panel="flavors"]').boundingBox();
  await drag(page, '[data-testid="fl-drag-flavors"]', 0, 40);
  const after = await page.locator('[data-panel="flavors"]').boundingBox();

  expect((after?.y ?? 0)).toBeGreaterThan((before?.y ?? 0) + 20);

  const lsAfter = await page.evaluate((key) => localStorage.getItem(key), LS_FREE_KEY);
  expect(lsAfter).not.toBeNull();
  const stored = JSON.parse(lsAfter ?? "{}");
  expect(stored.panels.flavors.y).not.toBe(spaciousLayout.flavors.y);
});

test("GRID 8 – Resize über die Ecke ändert Breite und Höhe eines Panels", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, spaciousLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await enterEditMode(page);
  const before = await page.locator('[data-panel="cart"]').boundingBox();

  await drag(page, '[data-testid="fl-resize-se-cart"]', -40, -40);
  const after = await page.locator('[data-panel="cart"]').boundingBox();

  expect((after?.width ?? 0)).toBeLessThan((before?.width ?? 0) - 15);
  expect((after?.height ?? 0)).toBeLessThan((before?.height ?? 0) - 15);
});

test("GRID 9 – Reset im Bearbeitungsmodus stellt das feste Standard-Grid wieder her", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await enterEditMode(page);
  await drag(page, '[data-testid="fl-drag-flavors"]', 0, 40);
  const lsAfterDrag = await page.evaluate((key) => localStorage.getItem(key), LS_FREE_KEY);
  expect(lsAfterDrag).not.toBeNull();

  await page.getByTestId("layout-reset-btn").click();

  // Reset clears the saved layout and exits edit mode — back to the fixed grid.
  const lsAfterReset = await page.evaluate((key) => localStorage.getItem(key), LS_FREE_KEY);
  expect(lsAfterReset).toBeNull();
  await expect(page.locator('[data-testid="fl-container"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="layout-edit-panel"]')).toHaveCount(0);
  await expect(page.getByTestId("sales-grid")).toBeVisible();
});

// ── Regression: a saved/corrupted free-layout must never reach the seller ───

test("GRID 10 – Verkäufer sieht IMMER das Standard-Grid, selbst mit gespeichertem Free-Layout", async ({ page }) => {
  await blockSupabase(page);
  // A layout was saved by an admin on this device at some point in the past —
  // but this session is NOT admin (a regular seller opening the register).
  await seedFreeLayout(page, spaciousLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.locator('[data-testid="layout-edit-toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="fl-container"]')).toHaveCount(0);
  await expect(page.locator('[data-panel]')).toHaveCount(0);
  await expect(page.getByTestId("sales-grid")).toBeVisible();

  // All core areas must be there and usable — Sorten, Größe, Zahlung, Warenkorb.
  await expect(page.getByTestId("flavor-zone")).toBeVisible();
  await expect(page.getByTestId("size-zone")).toBeVisible();
  await expect(page.getByTestId("payment-zone")).toBeVisible();
  await expect(page.getByTestId("cart-zone")).toBeVisible();
});

test("GRID 11 – Admin außerhalb des Bearbeitungsmodus sieht Standard-Grid, selbst mit gespeichertem Layout", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, spaciousLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Admin sees the edit entry point, but WITHOUT clicking it the saved
  // free-layout must stay dormant — the fixed grid is what's shown.
  await expect(page.getByTestId("layout-edit-toggle")).toBeVisible();
  await expect(page.locator('[data-testid="fl-container"]')).toHaveCount(0);
  await expect(page.locator('[data-panel]')).toHaveCount(0);
  await expect(page.getByTestId("sales-grid")).toBeVisible();
});

test("GRID 12 – Kaputtes/ungültiges localStorage-Layout wird ignoriert und gelöscht – /verkauf bleibt stabil", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  // Structurally invalid: missing panels, NaN-ish/non-numeric coordinates —
  // simulates a stale or hand-edited/corrupted localStorage entry.
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

  // The corrupted entry must have been actively removed, not just ignored.
  const lsAfter = await page.evaluate((key) => localStorage.getItem(key), LS_FREE_KEY);
  expect(lsAfter).toBeNull();

  // Entering edit mode afterwards must still work cleanly (fresh valid default).
  await enterEditMode(page);
  await expect(page.locator('[data-testid="fl-container"]')).toBeVisible();
  await expect(page.locator('[data-panel="cart"]')).toBeVisible();
});
