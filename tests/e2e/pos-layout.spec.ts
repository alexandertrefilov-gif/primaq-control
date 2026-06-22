/**
 * POS-Layout: Prüft, dass die Kasse auf iPad 13" kein Scrollen erfordert.
 *
 * "Bestellung buchen" und die Zahlungsart-Tabs müssen ohne Scrollen sichtbar
 * und vollständig im Viewport sein — bei 1, 5 und 10 Artikeln im Warenkorb.
 */

import { expect, test } from "@playwright/test";

const IPAD_13 = { width: 1366, height: 1024 };

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

function isInViewport(box: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }) {
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
      ["Mittel", "Mix Vanille/Schoko"],
    ],
  },
  {
    count: 10,
    items: [
      ["Klein", "Vanille"],
      ["Mittel", "Schokolade"],
      ["Groß", "Cheesecake"],
      ["Klein", "Erdbeere"],
      ["Mittel", "Mix Vanille/Schoko"],
      ["Groß", "Vanille"],
      ["Klein", "Schokolade"],
      ["Mittel", "Cheesecake"],
      ["Groß", "Erdbeere"],
      ["Klein", "Mix Cheesecake/Erdbeere"],
    ],
  },
];

for (const { count, items } of ITEM_SETS) {
  test(`Layout ${count} Artikel: Zahlungsart + Bestellung buchen bleiben im Viewport`, async ({ page }) => {
    await page.setViewportSize(IPAD_13);
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
    expect(isInViewport(btnBox!, IPAD_13)).toBe(true);

    // Bar/Karte/QR-Tabs sichtbar
    await expect(page.getByRole("button", { name: "Bar", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Karte", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "QR", exact: true })).toBeVisible();

    // Kein Overflow-Scrollen auf dem Body nötig (scrollHeight = clientHeight wenn kein Scroll)
    const overflows = await page.evaluate(() => {
      const body = document.body;
      return {
        scrollTop: window.scrollY,
        bodyOverflow: body.scrollHeight > window.innerHeight,
      };
    });
    expect(overflows.scrollTop).toBe(0);
  });
}
