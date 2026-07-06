/**
 * Kartengröße – Sortenkarten und Größenkarten getrennt einstellbar
 *
 * Zwei unabhängige +/- Regler in Einstellungen → Verkaufsoberfläche
 * ("Sortenkarten" / "Größenkarten") steuern productCardSizePx und
 * sizeCardSizePx getrennt. Beide Kartentypen sind quadratisch
 * (width = height = <feld>Px, responsiv per clamp()), Standard 180px.
 *
 * CARDSIZE 1 – Einstellungen zeigen Sortenkarten-Größe-Regler
 * CARDSIZE 2 – Einstellungen zeigen Größenkarten-Größe-Regler
 * CARDSIZE 3 – +/- verändert nur die Sortenkarten
 * CARDSIZE 4 – +/- verändert nur die Größenkarten
 * CARDSIZE 5 – Standard: beide 180 px
 * CARDSIZE 6 – Standard: Größenkarten wirken quadratisch wie Sortenkarten
 * CARDSIZE 7 – Werte bleiben nach Reload erhalten
 * CARDSIZE 8 – Keine Überlappung bei 1366×1024 und 1194×834
 * CARDSIZE 9 – Buchung funktioniert weiter
 */

import { expect, test } from "@playwright/test";

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function seedAdmin(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

/** Seeds a partial layout patch directly into IndexedDB (merged over defaults on load). */
async function writeLayoutPatch(page: import("@playwright/test").Page, patch: Record<string, unknown>) {
  await page.evaluate(async (data) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("primaq-pos");
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readwrite");
        const getReq = tx.objectStore("kv").get("primaq-pos-layout-v1");
        getReq.onsuccess = () => {
          const existing = getReq.result?.value ? JSON.parse(getReq.result.value) : { active: {}, profiles: [] };
          const next = { ...existing, active: { ...existing.active, ...data } };
          tx.objectStore("kv").put({ key: "primaq-pos-layout-v1", value: JSON.stringify(next) });
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    });
  }, patch);
}

async function seedCardSizes(page: import("@playwright/test").Page, productPx: number, sizePx: number) {
  await page.goto("/verkauf");
  await waitLoaded(page);
  await writeLayoutPatch(page, { productCardSizePx: productPx, sizeCardSizePx: sizePx });
  await page.reload();
  await waitLoaded(page);
}

async function goToVerkaufsoberflaeche(page: import("@playwright/test").Page) {
  await seedAdmin(page);
  await page.goto("/einstellungen");
  await waitLoaded(page);
  await page.getByRole("button", { name: "Verkaufsoberfläche" }).click();
}

async function unlockEditMode(page: import("@playwright/test").Page) {
  const lockBtn = page.getByRole("button", { name: "Gesperrt" });
  if (await lockBtn.isVisible().catch(() => false)) {
    await lockBtn.click();
  }
}

test("CARDSIZE 1 – Einstellungen zeigen Sortenkarten-Größe-Regler", async ({ page }) => {
  await blockSupabase(page);
  await goToVerkaufsoberflaeche(page);

  const stepper = page.getByTestId("product-card-size-stepper");
  await expect(stepper).toBeVisible();
  await expect(stepper.getByText("180px")).toBeVisible();
});

test("CARDSIZE 2 – Einstellungen zeigen Größenkarten-Größe-Regler", async ({ page }) => {
  await blockSupabase(page);
  await goToVerkaufsoberflaeche(page);

  const stepper = page.getByTestId("size-card-size-stepper");
  await expect(stepper).toBeVisible();
  await expect(stepper.getByText("180px")).toBeVisible();
});

test("CARDSIZE 3 – +/- verändert nur die Sortenkarten", async ({ page }) => {
  await blockSupabase(page);
  await goToVerkaufsoberflaeche(page);
  await unlockEditMode(page);

  const stepper = page.getByTestId("product-card-size-stepper");
  await stepper.getByRole("button", { name: "erhöhen" }).click();
  await stepper.getByRole("button", { name: "erhöhen" }).click();
  await expect(stepper.getByText("200px")).toBeVisible();

  // Größenkarten-Regler bleibt unverändert
  await expect(page.getByTestId("size-card-size-stepper").getByText("180px")).toBeVisible();

  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const flavorBox = await page.getByRole("button", { name: "Vanille", exact: true }).boundingBox();
  const sizeBox = await page.getByTestId("size-btn-klein").boundingBox();
  expect(flavorBox).not.toBeNull();
  expect(sizeBox).not.toBeNull();
  expect(flavorBox!.width).toBeGreaterThan(190);
  expect(sizeBox!.width).toBeLessThan(190);
});

test("CARDSIZE 4 – +/- verändert nur die Größenkarten", async ({ page }) => {
  await blockSupabase(page);
  await goToVerkaufsoberflaeche(page);
  await unlockEditMode(page);

  const stepper = page.getByTestId("size-card-size-stepper");
  await stepper.getByRole("button", { name: "erhöhen" }).click();
  await stepper.getByRole("button", { name: "erhöhen" }).click();
  await expect(stepper.getByText("200px")).toBeVisible();

  // Sortenkarten-Regler bleibt unverändert
  await expect(page.getByTestId("product-card-size-stepper").getByText("180px")).toBeVisible();

  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const flavorBox = await page.getByRole("button", { name: "Vanille", exact: true }).boundingBox();
  const sizeBox = await page.getByTestId("size-btn-klein").boundingBox();
  expect(flavorBox).not.toBeNull();
  expect(sizeBox).not.toBeNull();
  expect(flavorBox!.width).toBeLessThan(190);
  expect(sizeBox!.width).toBeGreaterThan(190);
});

test("CARDSIZE 5 – Standard: beide 180 px", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const flavorBox = await page.getByRole("button", { name: "Vanille", exact: true }).boundingBox();
  const sizeBox = await page.getByTestId("size-btn-klein").boundingBox();
  expect(flavorBox).not.toBeNull();
  expect(sizeBox).not.toBeNull();
  expect(flavorBox!.width).toBeGreaterThanOrEqual(175);
  expect(flavorBox!.width).toBeLessThanOrEqual(184);
  expect(sizeBox!.width).toBeGreaterThanOrEqual(175);
  expect(sizeBox!.width).toBeLessThanOrEqual(184);
});

test("CARDSIZE 6 – Standard: Größenkarten wirken quadratisch wie Sortenkarten", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const flavorBox = await page.getByRole("button", { name: "Vanille", exact: true }).boundingBox();
  const sizeBox = await page.getByTestId("size-btn-klein").boundingBox();
  expect(flavorBox).not.toBeNull();
  expect(sizeBox).not.toBeNull();

  // Sortenkarte ist quadratisch (aspect-square)
  expect(Math.abs(flavorBox!.width - flavorBox!.height)).toBeLessThan(2);
  // Größenkarte ist ebenfalls quadratisch
  expect(Math.abs(sizeBox!.width - sizeBox!.height)).toBeLessThan(2);
  // Beide etwa gleich groß im Standard
  expect(Math.abs(flavorBox!.width - sizeBox!.width)).toBeLessThan(6);
});

test("CARDSIZE 7 – Werte bleiben nach Reload erhalten", async ({ page }) => {
  await blockSupabase(page);
  await goToVerkaufsoberflaeche(page);
  await unlockEditMode(page);

  await page.getByTestId("product-card-size-stepper").getByRole("button", { name: "erhöhen" }).click();
  await page.getByTestId("size-card-size-stepper").getByRole("button", { name: "verringern" }).click();

  await expect(page.getByTestId("product-card-size-stepper").getByText("190px")).toBeVisible();
  await expect(page.getByTestId("size-card-size-stepper").getByText("170px")).toBeVisible();

  await page.reload();
  await waitLoaded(page);
  await page.getByRole("button", { name: "Verkaufsoberfläche" }).click();

  await expect(page.getByTestId("product-card-size-stepper").getByText("190px")).toBeVisible();
  await expect(page.getByTestId("size-card-size-stepper").getByText("170px")).toBeVisible();
});

for (const vp of [
  { width: 1366, height: 1024, label: "1366×1024" },
  { width: 1194, height: 834, label: "1194×834" },
]) {
  test(`CARDSIZE 8 – Keine Überlappung bei ${vp.label}`, async ({ page }) => {
    await blockSupabase(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await seedCardSizes(page, 220, 220);

    await expect(page.getByTestId("flavor-zone")).toBeVisible();
    await expect(page.getByTestId("size-zone")).toBeVisible();
    await expect(page.getByTestId("amount-zone")).toBeVisible();
    await expect(page.getByTestId("payment-zone")).toBeVisible();
    await expect(page.getByTestId("cart-zone")).toBeVisible();

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

test("CARDSIZE 9 – Buchung funktioniert weiter", async ({ page }) => {
  await blockSupabase(page);
  await seedCardSizes(page, 220, 220);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("quick-amount-250").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await expect(page.getByText("Noch leer")).toBeVisible();
});
