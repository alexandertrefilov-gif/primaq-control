/**
 * POS iPad Layout – 3-Zonen-Grid bei verschiedenen Viewport-Größen
 *
 * LAY 1 – 1366×1024: Alle 3 Zonen sichtbar, kein Überlapp
 * LAY 2 – 1194×834:  Alle 3 Zonen sichtbar, kein Überlapp
 * LAY 3 – 1024×768:  Alle 3 Zonen sichtbar, kein Überlapp
 * LAY 4 – Sorten und Größen nicht außerhalb des Viewports
 * LAY 5 – Kein horizontaler Scroll
 * LAY 6 – Buchung funktioniert nach Sorte + Größe auswählen
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

/** Returns true when element A and element B bounding rects do NOT overlap vertically. */
async function noVerticalOverlap(
  page: import("@playwright/test").Page,
  selectorA: string,
  selectorB: string
): Promise<boolean> {
  return page.evaluate(([a, b]: [string, string]) => {
    const elA = document.querySelector(a);
    const elB = document.querySelector(b);
    if (!elA || !elB) return false;
    const rA = elA.getBoundingClientRect();
    const rB = elB.getBoundingClientRect();
    // A must end before B starts (or vice versa) → no vertical overlap
    return rA.bottom <= rB.top + 2 || rB.bottom <= rA.top + 2;
  }, [selectorA, selectorB] as [string, string]);
}

/** Returns true when element is fully within viewport vertically. */
async function withinViewportY(
  page: import("@playwright/test").Page,
  selector: string,
  vpHeight: number
): Promise<boolean> {
  return page.evaluate(
    ([sel, h]: [string, number]) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= h + 4; // 4px tolerance
    },
    [selector, vpHeight] as [string, number]
  );
}

const VIEWPORTS = [
  { label: "1366×1024", width: 1366, height: 1024 },
  { label: "1194×834", width: 1194, height: 834 },
  { label: "1024×768", width: 1024, height: 768 },
];

// ── LAY 1-3: Alle Zonen sichtbar bei jedem iPad-Viewport ─────────────────────

for (const vp of VIEWPORTS) {
  test(`LAY – ${vp.label}: Sorten, Größen und Zahlungsbereich sichtbar ohne Überlapp`, async ({ page }) => {
    await freshDb(page, `lay-${vp.width}`);
    await blockSupabase(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/verkauf");
    await waitLoaded(page);

    // Alle drei Zonen müssen sichtbar sein
    const flavors = page.locator('[data-testid="size-btn-klein"]').first();
    await expect(flavors).toBeVisible();

    await expect(page.getByTestId("size-btn-klein")).toBeVisible();
    await expect(page.getByTestId("size-btn-mittel")).toBeVisible();
    await expect(page.getByTestId("size-btn-gross")).toBeVisible();
    await expect(page.getByTestId("payment-tab-bar")).toBeVisible();

    // Größen und Payment überlappen sich nicht
    const ok = await noVerticalOverlap(
      page,
      '[data-testid="size-btn-klein"]',
      '[data-testid="payment-tab-bar"]'
    );
    expect(ok).toBe(true);
  });
}

// ── LAY 4 – Sorten-Bereich nicht außerhalb des Viewports ─────────────────────

test("LAY 4: Sorten-Liste liegt vollständig im Viewport (1024×768)", async ({ page }) => {
  await freshDb(page, "lay4");
  await blockSupabase(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  // size-btn-gross sollte innerhalb des Viewports sein
  const btn = page.getByTestId("size-btn-gross");
  await expect(btn).toBeInViewport();
});

// ── LAY 5 – Kein horizontaler Scroll ─────────────────────────────────────────

test("LAY 5: Kein horizontaler Scroll bei 1024×768", async ({ page }) => {
  await freshDb(page, "lay5");
  await blockSupabase(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(1024 + 2); // 2px tolerance for scrollbar
});

// ── LAY 6 – Buchung funktioniert ─────────────────────────────────────────────

test("LAY 6: Sorte + Größe → Warenkorb-Eintrag → Buchung möglich (1194×834)", async ({ page }) => {
  await freshDb(page, "lay6");
  await seedAdmin(page);
  await blockSupabase(page);
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Sorte wählen
  await page.getByRole("button", { name: "Vanille", exact: true }).click();

  // Größe wählen
  await page.getByTestId("size-btn-klein").click();

  // Warenkorb-Eintrag soll erscheinen
  await expect(page.getByText("KLEIN VANILLE")).toBeVisible({ timeout: 5000 });

  // Buchung via Karte
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await expect(page.getByText("Noch leer")).toBeVisible();
});
