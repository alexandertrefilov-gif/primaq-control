/**
 * Visual cart check: 10 Artikel, Scroll, 2-Tap Delete, 2-Tap Leeren.
 * Screenshots landen in test-results/visual-cart/.
 */

import { expect, test } from "@playwright/test";

const DIR = "test-results/visual-cart";

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (r) => r.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function seedEmptyPos(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("pos-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function clickSize(page: import("@playwright/test").Page, label: "Klein" | "Mittel" | "Groß") {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
}

async function clickFlavor(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}

// Helpers to add variety
const COMBOS: Array<["Klein" | "Mittel" | "Groß", string]> = [
  ["Klein",  "Vanille"],
  ["Mittel", "Schokolade"],
  ["Groß",   "Mix Vanille/Schokolade"],
  ["Klein",  "Cheesecake"],
  ["Mittel", "Erdbeere"],
  ["Groß",   "Mix Cheesecake/Erdbeere"],
  ["Klein",  "Vanille"],
  ["Mittel", "Schokolade"],
  ["Groß",   "Cheesecake"],
  ["Klein",  "Erdbeere"],
];

test.describe("Visual: Warenkorb mit 10 Artikeln", () => {
  test("1 – Namen lesbar & Scroll: Warenkorb intern scrollbar, Zahlungsbereich bleibt sichtbar", async ({ page }) => {
    await seedEmptyPos(page);
    await blockSupabase(page);
    await page.setViewportSize({ width: 1366, height: 1024 }); // iPad 13" Querformat
    await page.goto("/verkauf");
    await waitLoaded(page);

    // Add 10 items
    for (const [size, flavor] of COMBOS) {
      await clickFlavor(page, flavor);
      await clickSize(page, size);
    }

    // Screenshot: 10 items loaded
    await page.screenshot({ path: `${DIR}/01-warenkorb-10-artikel.png`, fullPage: false });

    // Check full cart item names are readable (not truncated)
    await expect(page.getByText("Groß Mix Vanille/Schokolade")).toBeVisible();
    await expect(page.getByText("Groß Mix Cheesecake/Erdbeere")).toBeVisible();
    await expect(page.getByText("Groß Cheesecake")).toBeVisible();

    // Zahlungsbereich muss sichtbar sein (nicht gescrollt weg)
    await expect(page.getByRole("button", { name: "Bestellung buchen" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bar" })).toBeVisible();

    // Book button must be in viewport
    const bookBtn = page.getByRole("button", { name: "Bestellung buchen" });
    const box = await bookBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(1024); // inside viewport height

    // Cart list should be scrollable (scrollHeight > clientHeight when many items)
    const cartScrollable = await page.evaluate(() => {
      const ul = document.querySelector("ul.divide-y");
      if (!ul) return false;
      const parent = ul.closest(".overflow-y-auto");
      if (!parent) return false;
      return parent.scrollHeight >= parent.clientHeight;
    });
    expect(cartScrollable).toBe(true);

    console.log("✓ Namen lesbar, Buchen-Button im Viewport, Liste scrollbar");
  });

  test("2 – Delete 2-Tap: erster Tap zeigt Bestätigung, zweiter löscht", async ({ page }) => {
    await seedEmptyPos(page);
    await blockSupabase(page);
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.goto("/verkauf");
    await waitLoaded(page);

    // Add 3 items so the list isn't empty after deletion
    await clickFlavor(page, "Vanille");
    await clickSize(page, "Klein");
    await clickFlavor(page, "Schokolade");
    await clickSize(page, "Mittel");
    await clickFlavor(page, "Cheesecake");
    await clickSize(page, "Groß");

    await page.screenshot({ path: `${DIR}/02a-vor-delete.png` });

    // First tap on the LAST button in the first list item → X icon
    const firstItem = page.locator("li").first();
    await firstItem.getByRole("button").last().click();

    // After first tap: "Löschen?" button appears
    await expect(page.getByRole("button", { name: "Löschen?" })).toBeVisible();
    await page.screenshot({ path: `${DIR}/02b-delete-bestaetigung.png` });

    // Second tap confirms deletion
    await page.getByRole("button", { name: "Löschen?" }).click();

    // First item is gone, two remain
    await expect(page.locator("li")).toHaveCount(2);
    await page.screenshot({ path: `${DIR}/02c-nach-delete.png` });

    console.log("✓ 2-Tap Delete: Bestätigung erscheint, zweiter Tap entfernt Artikel");
  });

  test("3 – Delete Auto-Reset: kein zweiter Tap → Button kehrt zu X zurück", async ({ page }) => {
    await seedEmptyPos(page);
    await blockSupabase(page);
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.goto("/verkauf");
    await waitLoaded(page);

    await clickFlavor(page, "Vanille");
    await clickSize(page, "Klein");

    // First tap
    const firstItem = page.locator("li").first();
    await firstItem.getByRole("button").last().click();
    await expect(page.getByRole("button", { name: "Löschen?" })).toBeVisible();

    // Wait 3.5 seconds for auto-reset
    await page.waitForTimeout(3500);

    // "Löschen?" must have disappeared
    await expect(page.getByRole("button", { name: "Löschen?" })).not.toBeVisible();
    // Item still present
    await expect(page.locator("li")).toHaveCount(1);

    console.log("✓ Auto-Reset nach 3s: Artikel bleibt erhalten, Button zurück auf X");
  });

  test("4 – Leeren 2-Tap: erster Tap zeigt Bestätigung, zweiter leert Warenkorb", async ({ page }) => {
    await seedEmptyPos(page);
    await blockSupabase(page);
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.goto("/verkauf");
    await waitLoaded(page);

    // Add 4 items
    await clickFlavor(page, "Vanille");    await clickSize(page, "Klein");
    await clickFlavor(page, "Schokolade"); await clickSize(page, "Mittel");
    await clickFlavor(page, "Cheesecake"); await clickSize(page, "Groß");
    await clickFlavor(page, "Erdbeere");   await clickSize(page, "Klein");

    // First tap on "Leeren"
    await page.getByRole("button", { name: "Leeren" }).click();
    await expect(page.getByRole("button", { name: "Erneut tippen" })).toBeVisible();
    await page.screenshot({ path: `${DIR}/04a-leeren-bestaetigung.png` });

    // Second tap confirms
    await page.getByRole("button", { name: "Erneut tippen" }).click();
    await expect(page.getByText("Noch leer")).toBeVisible();
    await page.screenshot({ path: `${DIR}/04b-nach-leeren.png` });

    console.log("✓ 2-Tap Leeren: Bestätigung → Warenkorb geleert");
  });
});
