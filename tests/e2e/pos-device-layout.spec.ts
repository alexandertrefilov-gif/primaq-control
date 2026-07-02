/**
 * POS Freies Panel-Layout – E2E Tests (localStorage + absolute positioning, kein Supabase-Sync)
 *
 * FL 1  – Verkäufer sieht keinen Layout-Edit-Button
 * FL 2  – Admin sieht Layout-bearbeiten-Button
 * FL 3  – Klick aktiviert Bearbeitungsmodus und zeigt Drag-Handles
 * FL 4  – Panel-Drag verschiebt die Position
 * FL 5  – Panel-Resize SE-Ecke ändert Breite und Höhe
 * FL 6  – Panel-Resize E-Kante ändert nur die Breite
 * FL 7  – Panel-Resize S-Kante ändert nur die Höhe
 * FL 8  – Werte bleiben nach Reload erhalten
 * FL 9  – Reset setzt Standardlayout wieder her
 * FL 10 – Layoutwerte werden NICHT via Supabase synchronisiert
 * FL 11 – Kein horizontaler Scroll auf 1366×1024
 * FL 12 – Verkauf bleibt funktionsfähig im Edit-Modus
 * FL 13 – N-Kante nach unten verkleinert Höhe und erhöht Y
 * FL 14 – N-Kante nach oben vergrößert Höhe und verringert Y
 * FL 15 – W-Kante nach rechts verkleinert Breite und erhöht X
 * FL 16 – NE-Ecke erhöht Breite und verringert Y
 * FL 17 – Drag-Handle verschiebt Panel ohne Höhenänderung
 * FL 18 – N-Kante ändert Höhe, nicht Breite (Resize, kein Move)
 * FL 19 – minHeight wird beim N-Resize eingehalten
 * FL 20 – Normalmodus zeigt keine Resize-Handles
 * FL 21 – Überlappung zeigt roten Rahmen (data-overlap="true")
 * FL 22 – Überlappung blockiert localStorage-Speicherung
 * FL 23 – Reset erzeugt überlappungsfreies Layout
 * FL 24 – Panel-Header bleibt innerhalb der Panel-Breite
 */

import { expect, test } from "@playwright/test";

const LS_FREE_KEY = "primaq-pos-free-layout-v1";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function seedAdmin(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

async function seedFreeLayout(
  page: import("@playwright/test").Page,
  panels: Record<string, { x: number; y: number; w: number; h: number }>
) {
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify({ panels: value }));
  }, { key: LS_FREE_KEY, value: panels });
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForSelector('[data-testid="flavor-zone"]', { state: "visible", timeout: 12000 });
}

async function enterEditMode(page: import("@playwright/test").Page) {
  await page.getByTestId("layout-edit-toggle").click();
  await page.waitForSelector('[data-testid="layout-edit-panel"]', { state: "visible" });
}

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

// ── Tests ─────────────────────────────────────────────────────────────────────

test("FL 1 – Verkäufer sieht keinen Layout-Edit-Button", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("layout-edit-toggle")).not.toBeVisible();
});

test("FL 2 – Admin sieht Layout-bearbeiten-Button", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("layout-edit-toggle")).toBeVisible();
});

test("FL 3 – Klick aktiviert Bearbeitungsmodus und zeigt Drag-Handles", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await enterEditMode(page);

  await expect(page.getByTestId("fl-drag-flavors")).toBeVisible();
  await expect(page.getByTestId("fl-drag-sizes")).toBeVisible();
  await expect(page.getByTestId("fl-drag-payment")).toBeVisible();
  await expect(page.getByTestId("fl-drag-cart")).toBeVisible();
  await expect(page.getByTestId("fl-resize-se-cart")).toBeVisible();
});

test("FL 4 – Panel-Drag verschiebt die Position", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Record position before
  const before = await page.locator('[data-panel="flavors"]').boundingBox();
  const beforeLeft = before?.x ?? 0;

  await enterEditMode(page);

  // Drag the flavors panel 80px to the right
  await drag(page, '[data-testid="fl-drag-flavors"]', 80, 0);

  const after = await page.locator('[data-panel="flavors"]').boundingBox();
  const afterLeft = after?.x ?? 0;

  expect(afterLeft).toBeGreaterThan(beforeLeft + 40);
});

test("FL 5 – Panel-Resize SE-Ecke ändert Breite und Höhe", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  // Small cart in the center so SE handle stays well within the viewport
  await seedFreeLayout(page, {
    flavors: { x: 0, y: 0,   w: 500, h: 300 },
    sizes:   { x: 0, y: 300, w: 500, h: 100 },
    payment: { x: 0, y: 400, w: 500, h: 200 },
    cart:    { x: 510, y: 0, w: 300, h: 400 },
  });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const before = await page.locator('[data-panel="cart"]').boundingBox();
  const beforeW = before?.width  ?? 0;
  const beforeH = before?.height ?? 0;

  await enterEditMode(page);

  // Drag SE corner 60px right + 60px down
  await drag(page, '[data-testid="fl-resize-se-cart"]', 60, 60);

  const after = await page.locator('[data-panel="cart"]').boundingBox();
  expect((after?.width  ?? 0)).toBeGreaterThan(beforeW + 20);
  expect((after?.height ?? 0)).toBeGreaterThan(beforeH + 20);
});

test("FL 6 – Panel-Resize E-Kante ändert nur die Breite", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const before = await page.locator('[data-panel="flavors"]').boundingBox();
  const beforeW = before?.width  ?? 0;
  const beforeH = before?.height ?? 0;

  await enterEditMode(page);

  // Drag E edge of flavors panel 50px to the right
  await drag(page, '[data-testid="fl-resize-e-flavors"]', 50, 0);

  const after = await page.locator('[data-panel="flavors"]').boundingBox();
  expect((after?.width ?? 0)).toBeGreaterThan(beforeW + 20);
  // Height should be roughly unchanged (within 10px tolerance)
  expect(Math.abs((after?.height ?? 0) - beforeH)).toBeLessThan(10);
});

test("FL 7 – Panel-Resize S-Kante ändert nur die Höhe", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const before = await page.locator('[data-panel="flavors"]').boundingBox();
  const beforeH = before?.height ?? 0;
  const beforeW = before?.width  ?? 0;

  await enterEditMode(page);

  // Drag S edge of flavors panel 50px down
  await drag(page, '[data-testid="fl-resize-s-flavors"]', 0, 50);

  const after = await page.locator('[data-panel="flavors"]').boundingBox();
  expect((after?.height ?? 0)).toBeGreaterThan(beforeH + 20);
  // Width should be roughly unchanged
  expect(Math.abs((after?.width ?? 0) - beforeW)).toBeLessThan(10);
});

test("FL 8 – Werte bleiben nach Reload erhalten", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  // Seed a custom cart panel at x=900
  await seedFreeLayout(page, {
    flavors: { x: 0,   y: 0,   w: 600, h: 400 },
    sizes:   { x: 0,   y: 400, w: 600, h: 100 },
    payment: { x: 0,   y: 500, w: 600, h: 200 },
    cart:    { x: 900, y: 0,   w: 350, h: 700 },
  });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const cartBox = await page.locator('[data-panel="cart"]').boundingBox();
  // Cart should be near x=900 (allow for window offset)
  expect(cartBox?.x ?? 0).toBeGreaterThan(800);
});

test("FL 9 – Reset setzt Standardlayout wieder her", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, {
    flavors: { x: 0,   y: 0,   w: 600, h: 400 },
    sizes:   { x: 0,   y: 400, w: 600, h: 100 },
    payment: { x: 0,   y: 500, w: 600, h: 200 },
    cart:    { x: 900, y: 0,   w: 350, h: 700 },
  });
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Confirm cart is at seeded position
  const beforeBox = await page.locator('[data-panel="cart"]').boundingBox();
  expect(beforeBox?.x ?? 0).toBeGreaterThan(800);

  await enterEditMode(page);
  await page.getByTestId("layout-reset-btn").click();

  // After reset, LS key must be gone
  const lsVal = await page.evaluate((key) => localStorage.getItem(key), LS_FREE_KEY);
  expect(lsVal).toBeNull();

  // Cart panel must have moved from the seeded x=900 position
  const afterBox = await page.locator('[data-panel="cart"]').boundingBox();
  expect(afterBox?.x ?? 0).toBeLessThan((beforeBox?.x ?? 0) - 10);
});

test("FL 10 – Layoutwerte werden NICHT via Supabase synchronisiert", async ({ page }) => {
  const supabaseNonGetCalls: string[] = [];
  await page.route(/supabase\.co/, (route) => {
    if (route.request().method() !== "GET") supabaseNonGetCalls.push(route.request().url());
    return route.abort();
  });
  await page.routeWebSocket(/supabase\.co/, () => {});

  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await enterEditMode(page);
  await page.getByTestId("layout-reset-btn").click();
  await page.waitForTimeout(500);

  const hasLayoutSync = supabaseNonGetCalls.some((url) => url.includes("free-layout") || url.includes("device-layout"));
  expect(hasLayoutSync).toBe(false);

  // Layout should be saved to localStorage only
  const lsVal = await page.evaluate((key) => localStorage.getItem(key), LS_FREE_KEY);
  expect(lsVal).toBeNull(); // reset clears LS
});

test("FL 11 – Kein horizontaler Scroll auf 1366×1024", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
  const clientWidth = await page.evaluate(() => document.body.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
});

test("FL 12 – Verkauf bleibt funktionsfähig im Edit-Modus", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await enterEditMode(page);
  await expect(page.getByTestId("layout-edit-panel")).toBeVisible();

  // Alle Zonen müssen sichtbar bleiben
  await expect(page.getByTestId("flavor-zone")).toBeVisible();
  await expect(page.getByTestId("size-zone")).toBeVisible();
  await expect(page.getByTestId("payment-zone")).toBeVisible();
  await expect(page.getByTestId("cart-zone")).toBeVisible();

  // Edit-Modus verlassen
  await page.getByTestId("layout-edit-toggle").click();
  await expect(page.getByTestId("layout-edit-panel")).not.toBeVisible();
  // Drag handles must be gone after leaving edit mode
  await expect(page.locator('[data-testid^="fl-drag-"]')).toHaveCount(0);
});

// ─── 8-Richtungs-Resize Tests ─────────────────────────────────────────────────

/** Compact layout: cart at (400, 80, 450, 500) – well inside a 1280×800 viewport.
 *  cart.w=450 leaves 130px above minW(320) so W-edge drag of 60px stays unclamped. */
const compactLayout = {
  flavors: { x: 0,   y: 0,   w: 380, h: 360 },
  sizes:   { x: 0,   y: 360, w: 380, h: 100 },
  payment: { x: 0,   y: 460, w: 380, h: 220 },
  cart:    { x: 400, y: 80,  w: 450, h: 500 },
};

test("FL 13 – N-Kante nach unten verkleinert Höhe und erhöht Y", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, compactLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const before = await page.locator('[data-panel="cart"]').boundingBox();
  const beforeY = before?.y ?? 0;
  const beforeH = before?.height ?? 0;

  await enterEditMode(page);
  await drag(page, '[data-testid="fl-resize-n-cart"]', 0, 60);

  const after = await page.locator('[data-panel="cart"]').boundingBox();
  expect((after?.y ?? 0)).toBeGreaterThan(beforeY + 30);
  expect((after?.height ?? 0)).toBeLessThan(beforeH - 30);
});

test("FL 14 – N-Kante nach oben vergrößert Höhe und verringert Y", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, compactLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const before = await page.locator('[data-panel="cart"]').boundingBox();
  const beforeY = before?.y ?? 0;
  const beforeH = before?.height ?? 0;

  await enterEditMode(page);
  await drag(page, '[data-testid="fl-resize-n-cart"]', 0, -50);

  const after = await page.locator('[data-panel="cart"]').boundingBox();
  expect((after?.y ?? 0)).toBeLessThan(beforeY - 20);
  expect((after?.height ?? 0)).toBeGreaterThan(beforeH + 20);
});

test("FL 15 – W-Kante nach rechts verkleinert Breite und erhöht X", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, compactLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const before = await page.locator('[data-panel="cart"]').boundingBox();
  const beforeX = before?.x ?? 0;
  const beforeW = before?.width ?? 0;

  await enterEditMode(page);
  await drag(page, '[data-testid="fl-resize-w-cart"]', 60, 0);

  const after = await page.locator('[data-panel="cart"]').boundingBox();
  expect((after?.x ?? 0)).toBeGreaterThan(beforeX + 30);
  expect((after?.width ?? 0)).toBeLessThan(beforeW - 30);
});

test("FL 16 – NE-Ecke erhöht Breite und verringert Y", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, compactLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const before = await page.locator('[data-panel="cart"]').boundingBox();
  const beforeY = before?.y ?? 0;
  const beforeW = before?.width ?? 0;

  await enterEditMode(page);
  await drag(page, '[data-testid="fl-resize-ne-cart"]', 50, -50);

  const after = await page.locator('[data-panel="cart"]').boundingBox();
  expect((after?.width ?? 0)).toBeGreaterThan(beforeW + 20);
  expect((after?.y ?? 0)).toBeLessThan(beforeY - 20);
});

test("FL 17 – Drag-Handle verschiebt Panel ohne Höhenänderung", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, compactLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const before = await page.locator('[data-panel="cart"]').boundingBox();
  const beforeH = before?.height ?? 0;

  await enterEditMode(page);
  // Drag upward (avoids workspace-bottom clamp with a tall panel)
  await drag(page, '[data-testid="fl-drag-cart"]', 0, -60);

  const after = await page.locator('[data-panel="cart"]').boundingBox();
  // Position must have moved up
  expect((after?.y ?? 0)).toBeLessThan((before?.y ?? 0) - 20);
  // Height must be unchanged
  expect(Math.abs((after?.height ?? 0) - beforeH)).toBeLessThan(5);
});

test("FL 18 – N-Kante ändert Höhe, nicht Breite (Resize, kein Move)", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, compactLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const before = await page.locator('[data-panel="cart"]').boundingBox();
  const beforeW = before?.width ?? 0;
  const beforeH = before?.height ?? 0;

  await enterEditMode(page);
  await drag(page, '[data-testid="fl-resize-n-cart"]', 0, 60);

  const after = await page.locator('[data-panel="cart"]').boundingBox();
  // Width must be unchanged (it's a resize, not a move)
  expect(Math.abs((after?.width ?? 0) - beforeW)).toBeLessThan(5);
  // Height must have changed
  expect(Math.abs((after?.height ?? 0) - beforeH)).toBeGreaterThan(20);
});

test("FL 19 – minHeight wird beim N-Resize eingehalten", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  // Cart starts at y=80, h=500; minHeight for cart = 360
  await seedFreeLayout(page, compactLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await enterEditMode(page);
  // Drag N handle down 250px — would make h=250, below minHeight 360
  await drag(page, '[data-testid="fl-resize-n-cart"]', 0, 250);

  const after = await page.locator('[data-panel="cart"]').boundingBox();
  // Height must be clamped to at least minHeight for cart (320)
  expect((after?.height ?? 0)).toBeGreaterThanOrEqual(315);
});

test("FL 20 – Normalmodus zeigt keine Resize-Handles", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Not entering edit mode – handles must not exist
  await expect(page.locator('[data-testid^="fl-resize-"]')).toHaveCount(0);
});

// ─── Überlappungs-Tests ────────────────────────────────────────────────────────

/** Non-overlapping seed: flavors at 0-500, cart at 510+ */
const overlapSeedBase = {
  flavors: { x: 0,   y: 0,   w: 500, h: 360 },
  sizes:   { x: 0,   y: 360, w: 500, h: 100 },
  payment: { x: 0,   y: 460, w: 500, h: 200 },
  cart:    { x: 510, y: 0,   w: 350, h: 400 },
};

test("FL 21 – Überlappung zeigt roten Rahmen (data-overlap='true')", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, overlapSeedBase);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Confirm no overlap initially
  await expect(page.locator('[data-overlap="true"]')).toHaveCount(0);

  await enterEditMode(page);
  // Drag cart 120px left – cart moves from x=510 to ~x=390, overlapping flavors (0-500)
  await drag(page, '[data-testid="fl-drag-cart"]', -120, 0);

  // Cart and flavors should both show overlap indicator
  await expect(page.locator('[data-panel="cart"][data-overlap="true"]')).toBeVisible();
});

test("FL 22 – Überlappung blockiert localStorage-Speicherung", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, overlapSeedBase);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Capture LS value before dragging
  const lsBefore = await page.evaluate((key) => localStorage.getItem(key), LS_FREE_KEY);

  await enterEditMode(page);
  // Drag cart to cause overlap
  await drag(page, '[data-testid="fl-drag-cart"]', -120, 0);

  // LS must still have the original (pre-drag) value
  const lsAfter = await page.evaluate((key) => localStorage.getItem(key), LS_FREE_KEY);
  expect(lsAfter).toBe(lsBefore);
});

test("FL 23 – Reset erzeugt überlappungsfreies Layout", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, overlapSeedBase);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await enterEditMode(page);
  // Create overlap first
  await drag(page, '[data-testid="fl-drag-cart"]', -120, 0);
  await expect(page.locator('[data-overlap="true"]')).not.toHaveCount(0);

  // Reset
  await page.getByTestId("layout-reset-btn").click();

  // After reset, no panels should have overlap indicator
  await expect(page.locator('[data-overlap="true"]')).toHaveCount(0);
});

test("FL 24 – Panel-Header bleibt innerhalb der Panel-Breite", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await enterEditMode(page);

  // Check all four panels: header width must not exceed panel width
  for (const panelId of ["flavors", "sizes", "payment", "cart"]) {
    const panelBox  = await page.locator(`[data-panel="${panelId}"]`).boundingBox();
    const headerBox = await page.locator(`[data-testid="fl-drag-${panelId}"]`).boundingBox();
    // header should be inside the panel width (allow 2px tolerance for borders/subpixel)
    expect(headerBox?.width ?? 0).toBeLessThanOrEqual((panelBox?.width ?? 0) + 2);
    expect(headerBox?.x ?? 0).toBeGreaterThanOrEqual((panelBox?.x ?? 0) - 2);
  }
});
