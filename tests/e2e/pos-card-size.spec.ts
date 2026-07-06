/**
 * Kartengröße – Sorten- und Größenkarten skalieren gemeinsam
 *
 * "Kartengröße" (Klein/Mittel/Groß) in Einstellungen → Verkaufsoberfläche
 * steuert Punkt 1 (Sorte wählen) und Punkt 2 (Größe wählen) über dieselben
 * CSS-Variablen (--pos-card-size, --pos-card-gap, --pos-card-radius,
 * --pos-size-card-height), damit beide Bereiche immer harmonisch skalieren.
 *
 * CARDSIZE 1 – Einstellung "Kartengröße" existiert in Verkaufsoberfläche
 * CARDSIZE 2 – Klein/Mittel/Groß ändern die Sortenkarten-Breite
 * CARDSIZE 3 – Klein/Mittel/Groß ändern die Größenkarten-Höhe
 * CARDSIZE 4 – Sorten- und Größenkarten skalieren proportional zusammen
 * CARDSIZE 5 – Keine Überlappung bei 1366×1024 (Preset Groß)
 * CARDSIZE 6 – Keine Überlappung bei 1194×834 (Preset Groß)
 * CARDSIZE 7 – Keine Überlappung bei 1024×768 (Preset Groß)
 * CARDSIZE 8 – Größenwahl funktioniert weiter (Artikel landet im Warenkorb)
 * CARDSIZE 9 – Verkauf/Buchung funktioniert weiter (Preset Groß, voller Ablauf)
 */

import { expect, test } from "@playwright/test";

type CardSizePreset = "klein" | "mittel" | "gross";

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

async function seedCardSize(page: import("@playwright/test").Page, preset: CardSizePreset) {
  await page.goto("/verkauf");
  await waitLoaded(page);
  await writeLayoutPatch(page, { cardSizePreset: preset });
  await page.reload();
  await waitLoaded(page);
}

async function rect(page: import("@playwright/test").Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test("CARDSIZE 1 – Einstellung \"Kartengröße\" existiert in Verkaufsoberfläche", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/einstellungen");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Verkaufsoberfläche" }).click();

  const setting = page.getByTestId("card-size-setting");
  await expect(setting).toBeVisible();
  await expect(setting.getByRole("button", { name: "Klein" })).toBeVisible();
  await expect(setting.getByRole("button", { name: "Mittel" })).toBeVisible();
  await expect(setting.getByRole("button", { name: "Groß" })).toBeVisible();
});

test("CARDSIZE 2 – Klein/Mittel/Groß ändern die Sortenkarten-Breite", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });

  const widths: Record<CardSizePreset, number> = { klein: 0, mittel: 0, gross: 0 };
  for (const preset of ["klein", "mittel", "gross"] as const) {
    await seedCardSize(page, preset);
    const r = await rect(page, "flavor-zone");
    const cardBox = await page.getByRole("button", { name: "Vanille", exact: true }).boundingBox();
    expect(cardBox).not.toBeNull();
    widths[preset] = cardBox!.width;
    expect(r).not.toBeNull();
  }

  expect(widths.klein).toBeLessThan(widths.mittel);
  expect(widths.mittel).toBeLessThan(widths.gross);
});

test("CARDSIZE 3 – Klein/Mittel/Groß ändern die Größenkarten-Höhe", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });

  const heights: Record<CardSizePreset, number> = { klein: 0, mittel: 0, gross: 0 };
  for (const preset of ["klein", "mittel", "gross"] as const) {
    await seedCardSize(page, preset);
    const box = await page.getByTestId("size-btn-klein").boundingBox();
    expect(box).not.toBeNull();
    heights[preset] = box!.height;
  }

  expect(heights.klein).toBeLessThan(heights.mittel);
  expect(heights.mittel).toBeLessThan(heights.gross);
});

test("CARDSIZE 4 – Sorten- und Größenkarten skalieren proportional zusammen", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });

  const measurements: Record<CardSizePreset, { flavorWidth: number; sizeHeight: number }> = {
    klein: { flavorWidth: 0, sizeHeight: 0 },
    mittel: { flavorWidth: 0, sizeHeight: 0 },
    gross: { flavorWidth: 0, sizeHeight: 0 },
  };

  for (const preset of ["klein", "mittel", "gross"] as const) {
    await seedCardSize(page, preset);
    const flavorBox = await page.getByRole("button", { name: "Vanille", exact: true }).boundingBox();
    const sizeBox = await page.getByTestId("size-btn-klein").boundingBox();
    expect(flavorBox).not.toBeNull();
    expect(sizeBox).not.toBeNull();
    measurements[preset] = { flavorWidth: flavorBox!.width, sizeHeight: sizeBox!.height };
  }

  // Beide Dimensionen wachsen gemeinsam von Klein → Mittel → Groß.
  expect(measurements.klein.flavorWidth).toBeLessThan(measurements.mittel.flavorWidth);
  expect(measurements.mittel.flavorWidth).toBeLessThan(measurements.gross.flavorWidth);
  expect(measurements.klein.sizeHeight).toBeLessThan(measurements.mittel.sizeHeight);
  expect(measurements.mittel.sizeHeight).toBeLessThan(measurements.gross.sizeHeight);
});

for (const vp of [
  { width: 1366, height: 1024, label: "1366×1024" },
  { width: 1194, height: 834, label: "1194×834" },
  { width: 1024, height: 768, label: "1024×768" },
]) {
  test(`CARDSIZE ${vp.width === 1366 ? 5 : vp.width === 1194 ? 6 : 7} – Keine Überlappung bei ${vp.label} (Preset Groß)`, async ({ page }) => {
    await blockSupabase(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await seedCardSize(page, "gross");

    await expect(page.getByTestId("flavor-zone")).toBeVisible();
    await expect(page.getByTestId("size-zone")).toBeVisible();
    await expect(page.getByTestId("amount-zone")).toBeVisible();
    await expect(page.getByTestId("payment-zone")).toBeVisible();
    await expect(page.getByTestId("cart-zone")).toBeVisible();

    const flavorR = await rect(page, "flavor-zone");
    const sizeR = await rect(page, "size-zone");
    const cartR = await rect(page, "cart-zone");

    // Sorten links von Größe, Größe links von Warenkorb – kein Überlapp.
    expect(sizeR.x).toBeGreaterThanOrEqual(flavorR.x + flavorR.width - 4);
    expect(cartR.x).toBeGreaterThanOrEqual(sizeR.x + sizeR.width - 4);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(vp.width + 4);
  });
}

test("CARDSIZE 8 – Größenwahl funktioniert weiter (Artikel landet im Warenkorb)", async ({ page }) => {
  await blockSupabase(page);
  await seedCardSize(page, "gross");

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();

  await expect(page.getByText("Klein Vanille")).toBeVisible();
  await expect(page.getByText(/Gesamt/).locator("..").getByText("2,50 €")).toBeVisible();
});

test("CARDSIZE 9 – Verkauf/Buchung funktioniert weiter (Preset Groß, voller Ablauf)", async ({ page }) => {
  await blockSupabase(page);
  await seedCardSize(page, "gross");

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("quick-amount-250").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await expect(page.getByText("Noch leer")).toBeVisible();
});
