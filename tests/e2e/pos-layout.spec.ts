/**
 * POS-Layout: Prüft, dass die Kasse auf iPad 13" kein Scrollen erfordert.
 *
 * Getestet auf:
 *  – 1366×1024  (iPad Pro 13" Landscape, standalone PWA / fullscreen)
 *  – 1366×954   (iPad Pro 13" Landscape, Safari mit sichtbarer Toolbar)
 *
 * "Bestellung buchen" und die Zahlungsart-Tabs müssen ohne Scrollen sichtbar
 * und vollständig im Viewport sein — bei 1, 5 und 10 Artikeln im Warenkorb.
 */

import { expect, test } from "@playwright/test";

// iPad Pro 13" Landscape: PWA-Vollbild und Safari-Modus
const VIEWPORTS = [
  { width: 1366, height: 1024, label: "PWA 1366×1024" },
  { width: 1366, height: 954,  label: "Safari 1366×954" },
];

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function seedEmpty(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("pos-layout-seeded") === "1") return;
    window.sessionStorage.setItem("pos-layout-seeded", "1");
    window.localStorage.removeItem("primaq-pos-state");
  });
}

async function addItem(page: import("@playwright/test").Page, size: string, flavor: string) {
  await page.getByRole("button", { name: new RegExp(`^${size}`) }).click();
  await page.getByRole("button", { name: flavor, exact: true }).click();
}

function isInViewport(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number }
) {
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height
  );
}

const ITEM_SETS = [
  { count: 1, items: [["Klein", "Vanille"]] },
  {
    count: 5,
    items: [
      ["Klein", "Vanille"],
      ["Mittel", "Schokolade"],
      ["Groß", "Cheesecake"],
      ["Klein", "Erdbeere"],
      ["Mittel", "Mix Vanille/Schokolade"],
    ],
  },
  {
    count: 10,
    items: [
      ["Klein", "Vanille"],
      ["Mittel", "Schokolade"],
      ["Groß", "Cheesecake"],
      ["Klein", "Erdbeere"],
      ["Mittel", "Mix Vanille/Schokolade"],
      ["Groß", "Vanille"],
      ["Klein", "Schokolade"],
      ["Mittel", "Cheesecake"],
      ["Groß", "Erdbeere"],
      ["Klein", "Mix Cheesecake/Erdbeere"],
    ],
  },
];

for (const { width, height, label } of VIEWPORTS) {
  for (const { count, items } of ITEM_SETS) {
    test(`Layout ${label} – ${count} Artikel: kein Scroll, Buchen sichtbar`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await seedEmpty(page);
      await blockSupabase(page);
      await page.goto("/verkauf");
      await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

      for (const [size, flavor] of items) {
        await addItem(page, size, flavor);
      }

      // Buch-Button muss sichtbar und vollständig im Viewport sein
      const bookBtn = page.getByRole("button", { name: "Bestellung buchen" });
      await expect(bookBtn).toBeVisible();
      const btnBox = await bookBtn.boundingBox();
      expect(btnBox).not.toBeNull();
      expect(isInViewport(btnBox!, { width, height })).toBe(true);

      // Letzte-Bestellung-Bar muss sichtbar sein
      const statusBar = page.getByTestId("last-booking-bar");
      await expect(statusBar).toBeVisible();
      const barBox = await statusBar.boundingBox();
      expect(barBox).not.toBeNull();
      expect(isInViewport(barBox!, { width, height })).toBe(true);

      // Bar/Karte/QR-Tabs sichtbar
      await expect(page.getByRole("button", { name: "Bar", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Karte", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "QR", exact: true })).toBeVisible();

      // Kein Seiten-Scroll
      const scrollPos = await page.evaluate(() => window.scrollY);
      expect(scrollPos).toBe(0);

      // Größen-Buttons sichtbar
      await expect(page.getByRole("button", { name: /^Klein/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Mittel/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Groß/ })).toBeVisible();
    });
  }
}
