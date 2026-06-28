/**
 * POS iPad Layout – stabiles 3-Zonen-Grid bei verschiedenen Viewports
 *
 * LAY 1 – 1366×1024: alle Zonen sichtbar, kein Überlapp
 * LAY 2 – 1194×834:  alle Zonen sichtbar, kein Überlapp
 * LAY 3 – 1024×768:  alle Zonen sichtbar, kein Überlapp
 * LAY 4 – Sortenbereich und Größenbereich schneiden sich nicht
 * LAY 5 – Größenbereich und Zahlungsbereich schneiden sich nicht
 * LAY 6 – Warenkorb bleibt rechts (links von Sorten-Zone)
 * LAY 7 – Schnellbeträge sichtbar
 * LAY 8 – Bestellung buchen sichtbar
 * LAY 9 – Debug Overlay ohne ?debug=1 nicht sichtbar
 * LAY 10 – Kein horizontaler Scroll bei 1024×768
 * LAY 11 – Buchung funktioniert end-to-end (1194×834)
 */

import { expect, test } from "@playwright/test";

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function freshDb(page: import("@playwright/test").Page, tag: string) {
  await page.addInitScript((t) => {
    if (window.sessionStorage.getItem(`lay-seeded-${t}`) === "1") return;
    window.sessionStorage.setItem(`lay-seeded-${t}`, "1");
    indexedDB.deleteDatabase("primaq-pos");
  }, tag);
}

async function seedAdmin(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

/** Returns bounding rect of an element, or null if not found. */
async function rect(page: import("@playwright/test").Page, testId: string) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  }, testId);
}

/** True when A ends before B starts (no vertical overlap). Tolerance: 4px. */
function noVertOverlap(
  a: { top: number; bottom: number } | null,
  b: { top: number; bottom: number } | null
): boolean {
  if (!a || !b) return false;
  return a.bottom <= b.top + 4 || b.bottom <= a.top + 4;
}

const VIEWPORTS = [
  { label: "1366×1024", width: 1366, height: 1024 },
  { label: "1194×834",  width: 1194, height: 834  },
  { label: "1024×768",  width: 1024, height: 768  },
];

// ── LAY 1-3: Alle Zonen sichtbar bei jedem iPad-Viewport ─────────────────────

for (const vp of VIEWPORTS) {
  test(`LAY – ${vp.label}: alle Zonen sichtbar, kein Überlapp`, async ({ page }) => {
    await freshDb(page, `lay-vp-${vp.width}`);
    await blockSupabase(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/verkauf");
    await waitLoaded(page);

    // Alle vier Zonen müssen sichtbar sein
    await expect(page.getByTestId("flavor-zone")).toBeVisible();
    await expect(page.getByTestId("size-zone")).toBeVisible();
    await expect(page.getByTestId("payment-zone")).toBeVisible();
    await expect(page.getByTestId("cart-zone")).toBeVisible();

    // Größen-Buttons sichtbar
    await expect(page.getByTestId("size-btn-klein")).toBeVisible();
    await expect(page.getByTestId("payment-tab-bar")).toBeVisible();

    // Zahlungsbereich und Sortenbereich überlappen sich nicht
    const flavorR = await rect(page, "flavor-zone");
    const paymentR = await rect(page, "payment-zone");
    expect(noVertOverlap(flavorR, paymentR)).toBe(true);
  });
}

// ── LAY 4: Sortenbereich und Größenbereich schneiden sich nicht ───────────────

test("LAY 4: Sortenbereich und Größenbereich schneiden sich nicht (1024×768)", async ({ page }) => {
  await freshDb(page, "lay4");
  await blockSupabase(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const flavorR = await rect(page, "flavor-zone");
  const sizeR   = await rect(page, "size-zone");
  expect(noVertOverlap(flavorR, sizeR)).toBe(true);
});

// ── LAY 5: Größenbereich und Zahlungsbereich schneiden sich nicht ─────────────

test("LAY 5: Größenbereich und Zahlungsbereich schneiden sich nicht (1024×768)", async ({ page }) => {
  await freshDb(page, "lay5");
  await blockSupabase(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const sizeR    = await rect(page, "size-zone");
  const paymentR = await rect(page, "payment-zone");
  expect(noVertOverlap(sizeR, paymentR)).toBe(true);
});

// ── LAY 6: Warenkorb bleibt rechts ───────────────────────────────────────────

test("LAY 6: Warenkorb ist rechts von Sorten-/Zahlungsbereich (1194×834)", async ({ page }) => {
  await freshDb(page, "lay6");
  await blockSupabase(page);
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const flavorR = await rect(page, "flavor-zone");
  const cartR   = await rect(page, "cart-zone");
  expect(flavorR).not.toBeNull();
  expect(cartR).not.toBeNull();
  // Cart must start to the right of the flavor column
  expect(cartR!.left).toBeGreaterThan(flavorR!.right - 4);
});

// ── LAY 7: Schnellbeträge sichtbar + in einer Zeile mit Bestellung buchen ────

test("LAY 7: Schnellbeträge und Bestellung buchen in gemeinsamer Zeile (1024×768)", async ({ page }) => {
  await freshDb(page, "lay7");
  await blockSupabase(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Bar ist Standardmodus – Schnellbeträge direkt sichtbar
  await expect(page.getByTestId("quick-amount-250")).toBeVisible();
  await expect(page.getByTestId("quick-amounts-row")).toBeVisible();
  await expect(page.getByTestId("book-button")).toBeVisible();

  // Schnellbeträge und Bestellung buchen überlappen vertikal (gleiche Zeile)
  const quickR  = await rect(page, "quick-amounts-row");
  const bookR   = await rect(page, "book-button");
  expect(quickR).not.toBeNull();
  expect(bookR).not.toBeNull();
  // Gleiche Zeile = vertikale Überlappung vorhanden (center-to-center ≤ 20px)
  const quickCenter = (quickR!.top + quickR!.bottom) / 2;
  const bookCenter  = (bookR!.top  + bookR!.bottom)  / 2;
  expect(Math.abs(quickCenter - bookCenter)).toBeLessThan(20);
});

// ── LAY 8: Bestellung buchen sichtbar ────────────────────────────────────────

test("LAY 8: Bestellung-buchen-Button sichtbar auf allen Viewports", async ({ page }) => {
  await freshDb(page, "lay8");
  await blockSupabase(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("book-button")).toBeVisible();
  await expect(page.getByTestId("book-button")).toBeInViewport();
});

// ── LAY 9: Debug Overlay für Nicht-Admins niemals sichtbar ──────────────────

test("LAY 9: Debug Overlay für Nicht-Admins niemals sichtbar (ohne Admin-Login)", async ({ page }) => {
  await freshDb(page, "lay9");
  // Kein seedAdmin → isAdmin=false
  await blockSupabase(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  // Mit ?debug=1 – aber kein Admin, daher kein Overlay
  await page.goto("/verkauf?debug=1");
  await waitLoaded(page);

  // Sorte und Größe auswählen (geht auch ohne Admin), Buchung braucht Admin für Overlay
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();

  // Debug-Overlay niemals für Nicht-Admin sichtbar
  const debugOverlay = page.locator("text=POS Debug");
  await expect(debugOverlay).not.toBeVisible();
});

// ── LAY 10: Kein horizontaler Scroll ─────────────────────────────────────────

test("LAY 10: Kein horizontaler Scroll bei 1024×768", async ({ page }) => {
  await freshDb(page, "lay10");
  await blockSupabase(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(1024 + 4); // 4px tolerance
});

// ── LAY 11: Buchung funktioniert end-to-end ───────────────────────────────────

test("LAY 11: Sorte + Größe → Buchung möglich (1194×834)", async ({ page }) => {
  await freshDb(page, "lay11");
  await seedAdmin(page);
  await blockSupabase(page);
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await expect(page.getByText("KLEIN VANILLE")).toBeVisible({ timeout: 5000 });

  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await expect(page.getByText("Noch leer")).toBeVisible();
});
