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
 * FL 21 – Ein überlappender Alt-Layout wird beim Laden automatisch korrigiert
 * FL 22 – Die automatische Korrektur wird in localStorage gespeichert
 * FL 23 – Reset erzeugt überlappungsfreies Layout
 * FL 24 – Panel-Header bleibt innerhalb der Panel-Breite
 * FL 25 – Nach Reset halten Panels 8 px Mindestabstand ein (PANEL_GAP)
 * FL 26 – Drag stoppt am PANEL_GAP-Rand (Kollisionsprävention)
 * FL 27 – Browser-Resize auf 1366×1024 schiebt außenliegende Panels rein
 * FL 28 – Browser-Resize auf 1194×834 schiebt außenliegende Panels rein
 * FL 29 – Browser-Resize auf 1024×768 lädt valides Layout
 * FL 30 – Resize (W-Kante) stoppt am PANEL_GAP-Rand (Kollisionsprävention)
 * FL 31 – Resize (S-Kante) stoppt am PANEL_GAP-Rand (Kollisionsprävention)
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
  // Seed a layout with a wide gap between the two columns so drag has room to move
  await seedFreeLayout(page, {
    flavors: { x: 8,   y: 8,   w: 520, h: 360 },
    sizes:   { x: 8,   y: 376, w: 520, h: 100 },
    payment: { x: 8,   y: 484, w: 520, h: 220 },
    cart:    { x: 800, y: 8,   w: 340, h: 580 },
  });
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Record position before
  const before = await page.locator('[data-panel="flavors"]').boundingBox();
  const beforeLeft = before?.x ?? 0;

  await enterEditMode(page);

  // Drag the flavors panel 80px to the right (gap to cart is 272 px – no collision)
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

// Layout with generous slack on every side of "flavors" — the bare default
// layout is now intentionally gap-tight (flavors sits exactly PANEL_GAP from
// cart, per the "perfect default spacing" fix), so E/S-edge growth tests need
// their own seeded headroom instead of relying on the tight default.
const spaciousLayout = {
  flavors: { x: 8,   y: 8,   w: 400, h: 300 },
  sizes:   { x: 8,   y: 500, w: 400, h: 100 },
  payment: { x: 8,   y: 608, w: 400, h: 220 },
  cart:    { x: 900, y: 8,   w: 340, h: 580 },
};

test("FL 6 – Panel-Resize E-Kante ändert nur die Breite", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, spaciousLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const before = await page.locator('[data-panel="flavors"]').boundingBox();
  const beforeW = before?.width  ?? 0;
  const beforeH = before?.height ?? 0;

  await enterEditMode(page);

  // Drag E edge of flavors panel 50px to the right (cart is 492px away — no collision)
  await drag(page, '[data-testid="fl-resize-e-flavors"]', 50, 0);

  const after = await page.locator('[data-panel="flavors"]').boundingBox();
  expect((after?.width ?? 0)).toBeGreaterThan(beforeW + 20);
  // Height should be roughly unchanged (within 10px tolerance)
  expect(Math.abs((after?.height ?? 0) - beforeH)).toBeLessThan(10);
});

test("FL 7 – Panel-Resize S-Kante ändert nur die Höhe", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, spaciousLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const before = await page.locator('[data-panel="flavors"]').boundingBox();
  const beforeH = before?.height ?? 0;
  const beforeW = before?.width  ?? 0;

  await enterEditMode(page);

  // Drag S edge of flavors panel 50px down ("sizes" is 192px below — no collision)
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

/** Compact layout: cart at (400, 70, 450, 400) – well inside the workspace.
 *  cart.w=450 leaves 130px above minW(320) so W-edge drag of 60px stays unclamped.
 *  cart.y=70/h=400 (bottom=470) keeps the panel's bottom edge safely within the
 *  real workspace height (~544px behind header/status bar), and y=70 leaves
 *  enough room above for a -60px upward move/resize without hitting the
 *  workspace's top-edge clamp (which would otherwise also shrink the panel). */
const compactLayout = {
  flavors: { x: 0,   y: 0,   w: 380, h: 360 },
  sizes:   { x: 0,   y: 360, w: 380, h: 100 },
  payment: { x: 0,   y: 460, w: 380, h: 220 },
  cart:    { x: 400, y: 70,  w: 450, h: 400 },
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

/** Non-overlapping seed: all panels at/above new FL_PANEL_MINS, properly spaced with PANEL_GAP. */
const overlapSeedBase = {
  flavors: { x: 8,   y: 8,   w: 520, h: 360 },
  sizes:   { x: 8,   y: 376, w: 520, h: 100 },
  payment: { x: 8,   y: 484, w: 520, h: 220 },
  cart:    { x: 600, y: 8,   w: 350, h: 500 },
};

/**
 * A directly-seeded (not drag/resize-produced) overlapping layout — cart's
 * x=300 sits well inside flavors' 8–528 span. Since both drag AND resize are
 * now collision-prevented (they can never CREATE an overlap through normal
 * use), the only way an overlap can still exist is a stale/corrupted saved
 * layout — e.g. from before this safeguard existed, or synced from another
 * device. That's exactly what this fixture simulates.
 */
const staleOverlappingSeed = {
  flavors: { x: 8,   y: 8,   w: 520, h: 360 },
  sizes:   { x: 8,   y: 376, w: 520, h: 100 },
  payment: { x: 8,   y: 484, w: 520, h: 220 },
  cart:    { x: 300, y: 8,   w: 350, h: 500 },
};

test("FL 21 – Ein überlappender Alt-Layout wird beim Laden automatisch korrigiert", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, staleOverlappingSeed);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // The stale overlap must never remain visible — it's corrected before paint.
  await expect(page.locator('[data-overlap="true"]')).toHaveCount(0);

  const flavorsBox = await page.locator('[data-panel="flavors"]').boundingBox();
  const cartBox    = await page.locator('[data-panel="cart"]').boundingBox();
  const gap = (cartBox?.x ?? 0) - ((flavorsBox?.x ?? 0) + (flavorsBox?.width ?? 0));
  expect(gap).toBeGreaterThanOrEqual(4);
});

test("FL 22 – Die automatische Korrektur wird in localStorage gespeichert", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, staleOverlappingSeed);
  await page.goto("/verkauf");
  await waitLoaded(page);
  await expect(page.locator('[data-overlap="true"]')).toHaveCount(0);

  // localStorage must hold the CORRECTED layout, not the original overlapping seed.
  const lsAfter = await page.evaluate((key) => localStorage.getItem(key), LS_FREE_KEY);
  const stored = JSON.parse(lsAfter ?? "{}");
  expect(stored.panels.cart.x).not.toBe(staleOverlappingSeed.cart.x);
});

test("FL 23 – Reset erzeugt überlappungsfreies Layout", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, staleOverlappingSeed);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await enterEditMode(page);
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

// ─── PANEL_GAP, Kollisionsprävention & Browser-Resize ────────────────────────

test("FL 25 – Nach Reset halten Panels 8 px Mindestabstand ein", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await enterEditMode(page);
  await page.getByTestId("layout-reset-btn").click();

  // Horizontal gap: flavors right edge ↔ cart left edge
  const flavorsBox = await page.locator('[data-panel="flavors"]').boundingBox();
  const cartBox    = await page.locator('[data-panel="cart"]').boundingBox();
  const hGap = (cartBox?.x ?? 0) - ((flavorsBox?.x ?? 0) + (flavorsBox?.width ?? 0));
  expect(hGap).toBeGreaterThanOrEqual(4); // PANEL_GAP, allowing 4 px for subpixel rounding

  // Vertical gap: flavors bottom ↔ sizes top
  const sizesBox = await page.locator('[data-panel="sizes"]').boundingBox();
  const vGap = (sizesBox?.y ?? 0) - ((flavorsBox?.y ?? 0) + (flavorsBox?.height ?? 0));
  expect(vGap).toBeGreaterThanOrEqual(4);
});

test("FL 26 – Drag stoppt am PANEL_GAP-Rand (Kollisionsprävention)", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  // Cart far right – 272 px gap to flavors, so a 1000 px drag is clearly blocked
  await seedFreeLayout(page, {
    flavors: { x: 8,   y: 8,   w: 520, h: 360 },
    sizes:   { x: 8,   y: 376, w: 520, h: 100 },
    payment: { x: 8,   y: 484, w: 520, h: 220 },
    cart:    { x: 900, y: 8,   w: 340, h: 580 },
  });
  await page.goto("/verkauf");
  await waitLoaded(page);

  await enterEditMode(page);
  // Drag cart 1000 px left – collision prevention must stop it before it enters flavors
  await drag(page, '[data-testid="fl-drag-cart"]', -1000, 0);

  const flavorsBox = await page.locator('[data-panel="flavors"]').boundingBox();
  const cartBox    = await page.locator('[data-panel="cart"]').boundingBox();

  // Gap must be maintained (≥ 4 px to allow subpixel)
  const gap = (cartBox?.x ?? 0) - ((flavorsBox?.x ?? 0) + (flavorsBox?.width ?? 0));
  expect(gap).toBeGreaterThanOrEqual(4);

  // No overlap indicator must appear
  await expect(page.locator('[data-overlap="true"]')).toHaveCount(0);
});

test("FL 27 – Browser-Resize auf 1366×1024 schiebt außenliegende Panels rein", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  // Cart placed beyond 1366 px – normalizeLayout must clamp it after resize
  await seedFreeLayout(page, {
    flavors: { x: 8,    y: 8,   w: 520, h: 400 },
    sizes:   { x: 8,    y: 416, w: 520, h: 100 },
    payment: { x: 8,    y: 524, w: 520, h: 250 },
    cart:    { x: 1400, y: 8,   w: 340, h: 750 },
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.waitForTimeout(300); // wait for debounced normalizeLayout

  await expect(page.locator('[data-overlap="true"]')).toHaveCount(0);
  const cartBox = await page.locator('[data-panel="cart"]').boundingBox();
  expect((cartBox?.x ?? 0) + (cartBox?.width ?? 0)).toBeLessThanOrEqual(1366 + 4);
});

test("FL 28 – Browser-Resize auf 1194×834 schiebt außenliegende Panels rein", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, {
    flavors: { x: 8,    y: 8,   w: 520, h: 400 },
    sizes:   { x: 8,    y: 416, w: 520, h: 100 },
    payment: { x: 8,    y: 524, w: 520, h: 250 },
    cart:    { x: 1300, y: 8,   w: 340, h: 650 },
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.setViewportSize({ width: 1194, height: 834 });
  await page.waitForTimeout(300);

  await expect(page.locator('[data-overlap="true"]')).toHaveCount(0);
  const cartBox = await page.locator('[data-panel="cart"]').boundingBox();
  expect((cartBox?.x ?? 0) + (cartBox?.width ?? 0)).toBeLessThanOrEqual(1194 + 4);
});

test("FL 29 – Browser-Resize auf 1024×768 lädt valides Layout", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, {
    flavors: { x: 8,    y: 8,   w: 520, h: 400 },
    sizes:   { x: 8,    y: 416, w: 520, h: 100 },
    payment: { x: 8,    y: 524, w: 520, h: 250 },
    cart:    { x: 1200, y: 8,   w: 340, h: 580 },
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(300);

  await expect(page.locator('[data-overlap="true"]')).toHaveCount(0);
  await expect(page.locator('[data-panel="flavors"]')).toBeVisible();
  await expect(page.locator('[data-panel="cart"]')).toBeVisible();
  const cartBox = await page.locator('[data-panel="cart"]').boundingBox();
  expect((cartBox?.x ?? 0) + (cartBox?.width ?? 0)).toBeLessThanOrEqual(1024 + 4);
});

// ─── Resize-Kollisionsprävention (neu: gilt jetzt wie beim Drag) ────────────

test("FL 30 – Resize (W-Kante) stoppt am PANEL_GAP-Rand statt zu überlappen", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  // Cart's left edge is 172px from flavors' right edge — plenty to attempt
  // a 1000px leftward grow, which collision-prevention must stop at the gap.
  await seedFreeLayout(page, {
    flavors: { x: 8,   y: 8,   w: 520, h: 360 },
    sizes:   { x: 8,   y: 376, w: 520, h: 100 },
    payment: { x: 8,   y: 484, w: 520, h: 220 },
    cart:    { x: 700, y: 8,   w: 340, h: 580 },
  });
  await page.goto("/verkauf");
  await waitLoaded(page);

  await enterEditMode(page);
  // Resize cart's W-handle 1000px left — would deeply overlap flavors if unclamped.
  await drag(page, '[data-testid="fl-resize-w-cart"]', -1000, 0);

  const flavorsBox = await page.locator('[data-panel="flavors"]').boundingBox();
  const cartBox    = await page.locator('[data-panel="cart"]').boundingBox();
  const gap = (cartBox?.x ?? 0) - ((flavorsBox?.x ?? 0) + (flavorsBox?.width ?? 0));
  expect(gap).toBeGreaterThanOrEqual(4);

  await expect(page.locator('[data-overlap="true"]')).toHaveCount(0);
});

test("FL 31 – Resize (S-Kante) stoppt am PANEL_GAP-Rand statt zu überlappen", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  // "sizes" bottom edge is 8px above "payment" top edge — growing sizes
  // downward by 1000px must stop right at the gap, never overlapping payment.
  await seedFreeLayout(page, {
    flavors: { x: 8,   y: 8,   w: 520, h: 360 },
    sizes:   { x: 8,   y: 376, w: 520, h: 100 },
    payment: { x: 8,   y: 484, w: 520, h: 220 },
    cart:    { x: 900, y: 8,   w: 340, h: 580 },
  });
  await page.goto("/verkauf");
  await waitLoaded(page);

  await enterEditMode(page);
  await drag(page, '[data-testid="fl-resize-s-sizes"]', 0, 1000);

  const sizesBox   = await page.locator('[data-panel="sizes"]').boundingBox();
  const paymentBox = await page.locator('[data-panel="payment"]').boundingBox();
  const gap = (paymentBox?.y ?? 0) - ((sizesBox?.y ?? 0) + (sizesBox?.height ?? 0));
  expect(gap).toBeGreaterThanOrEqual(4);

  await expect(page.locator('[data-overlap="true"]')).toHaveCount(0);
});
