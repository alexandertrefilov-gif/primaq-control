/**
 * VAT Settings – E2E Tests
 *
 * 1  – Standardwert = 7 %
 * 2  – Preset "19 %" übernimmt Wert und speichert in IDB
 * 3  – Eigener Wert 5,5 % wird gespeichert
 * 4  – Reload behält gespeicherten Wert (19 %)
 * 5  – Jahresabschluss KPI + Tabellenkopf: Standard 7 %
 * 5b – Jahresabschluss KPI + Tabellenkopf nach Änderung auf 19 %
 * 6  – Tagesabschluss zeigt MwSt-Label mit konfiguriertem Steuersatz
 * 7  – CSV-Export enthält konfigurierten Steuersatz im Header
 */

import * as fs from "fs";
import { expect, test } from "@playwright/test";

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

async function freshDb(page: import("@playwright/test").Page, tag: string) {
  await page.addInitScript((t) => {
    if (window.sessionStorage.getItem(`vat-seeded-${t}`) === "1") return;
    window.sessionStorage.setItem(`vat-seeded-${t}`, "1");
    indexedDB.deleteDatabase("primaq-pos");
  }, tag);
}

async function writeKvEntry(page: import("@playwright/test").Page, key: string, value: string): Promise<void> {
  await page.evaluate(({ k, v }) =>
    new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put({ key: k, value: v });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    })
  , { k: key, v: value });
}

async function readKvEntry(page: import("@playwright/test").Page, key: string): Promise<string | null> {
  return page.evaluate((k) =>
    new Promise<string | null>((resolve) => {
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) { db.close(); resolve(null); return; }
        const tx = db.transaction("kv", "readonly");
        const entry = tx.objectStore("kv").get(k);
        entry.onsuccess = () => {
          db.close();
          const val = (entry.result as { value: string } | undefined)?.value ?? null;
          resolve(val);
        };
        entry.onerror = () => { db.close(); resolve(null); };
      };
      req.onerror = () => resolve(null);
    })
  , key);
}

async function waitForVatInput(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="vat-rate-input"]') as HTMLInputElement | null;
    return el !== null && el.value !== "";
  }, undefined, { timeout: 6000 });
}

/** Navigate to /einstellungen and activate the Grundeinstellungen tab. */
async function gotoGrundeinstellungen(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/einstellungen");
  await page.getByRole("button", { name: "Grundeinstellungen" }).click();
  await waitForVatInput(page);
}

// Use current year (2026) so the Jahresabschluss year selector shows this data by default.
const TEST_YEAR_HISTORY = JSON.stringify([
  {
    date: "2026-06-01",
    totalCents: 10700,
    cashCents: 5000,
    cardCents: 5700,
    qrCents: 0,
    orderCount: 10,
    orders: [],
  },
]);

const TEST_DAILY = {
  date: new Date().toISOString().slice(0, 10),
  totalCents: 2140,
  cashCents: 2140,
  cardCents: 0,
  qrCents: 0,
  orderCount: 2,
  orders: [],
};

// ── Test 1: Standardwert = 7 % ───────────────────────────────────────────────

test("VAT 1: Standardwert auf Einstellungsseite = 7 %", async ({ page }) => {
  await freshDb(page, "vat1");
  await seedAdmin(page);
  await blockSupabase(page);

  await gotoGrundeinstellungen(page);

  await expect(page.getByTestId("vat-rate-input")).toHaveValue("7");
  await expect(page.getByTestId("vat-preset-7")).toHaveClass(/bg-primaq-500/);
});

// ── Test 2: Preset "19 %" übernimmt Wert und speichert in IDB ────────────────

test("VAT 2: Klick auf '19 %' setzt MwSt auf 19 und speichert in IDB", async ({ page }) => {
  await freshDb(page, "vat2");
  await seedAdmin(page);
  await blockSupabase(page);

  await gotoGrundeinstellungen(page);

  await page.getByTestId("vat-preset-19").click();
  await expect(page.getByTestId("vat-rate-input")).toHaveValue("19");

  const stored = await readKvEntry(page, "primaq-pos-vat-rate");
  expect(stored).toBe("19");
});

// ── Test 3: Eigener Wert 5,5 % wird gespeichert ──────────────────────────────

test("VAT 3: Eigener Wert 5,5 wird gespeichert und normalisiert angezeigt", async ({ page }) => {
  await freshDb(page, "vat3");
  await seedAdmin(page);
  await blockSupabase(page);

  await gotoGrundeinstellungen(page);

  const input = page.getByTestId("vat-rate-input");
  await input.fill("5,5");
  await input.blur();

  await expect(input).toHaveValue("5.5");

  const stored = await readKvEntry(page, "primaq-pos-vat-rate");
  expect(stored).toBe("5.5");
});

// ── Test 4: Reload behält gespeicherten Wert ─────────────────────────────────

test("VAT 4: Gespeicherter Wert (19 %) bleibt nach Seiten-Reload erhalten", async ({ page }) => {
  await freshDb(page, "vat4");
  await seedAdmin(page);
  await blockSupabase(page);

  await gotoGrundeinstellungen(page);

  await page.getByTestId("vat-preset-19").click();
  await expect(page.getByTestId("vat-rate-input")).toHaveValue("19");

  // Confirm IDB write completed before reloading (dbSet is fire-and-forget in the store)
  const storedBeforeReload = await readKvEntry(page, "primaq-pos-vat-rate");
  expect(storedBeforeReload).toBe("19");

  await page.reload();
  // Tab state resets on reload — navigate to Grundeinstellungen again
  await page.getByRole("button", { name: "Grundeinstellungen" }).click();
  await waitForVatInput(page);

  await expect(page.getByTestId("vat-rate-input")).toHaveValue("19");
  await expect(page.getByTestId("vat-preset-19")).toHaveClass(/bg-primaq-500/);
});

// ── Test 5: Jahresabschluss zeigt Standard 7 % ───────────────────────────────

test("VAT 5: Jahresabschluss zeigt Standard 7 % in KPI und Tabellenkopf", async ({ page }) => {
  await freshDb(page, "vat5");
  await seedAdmin(page);
  await blockSupabase(page);

  // Navigate to einstellungen first so IDB is accessible, then seed year data
  await page.goto("/einstellungen");
  await writeKvEntry(page, "primaq-pos-year-history", TEST_YEAR_HISTORY);

  await page.goto("/jahresabschluss");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  await expect(page.getByText("MwSt 7 %").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /MwSt 7/ })).toBeVisible();
});

// ── Test 5b: Jahresabschluss zeigt konfigurierten 19 % Steuersatz ────────────

test("VAT 5b: Jahresabschluss zeigt konfigurierten 19 % Steuersatz", async ({ page }) => {
  await freshDb(page, "vat5b");
  await seedAdmin(page);
  await blockSupabase(page);

  await gotoGrundeinstellungen(page);

  // Set to 19% and seed year history data
  await page.getByTestId("vat-preset-19").click();
  await expect(page.getByTestId("vat-rate-input")).toHaveValue("19");
  // Wait for IDB write to complete before navigating away
  const stored = await readKvEntry(page, "primaq-pos-vat-rate");
  expect(stored).toBe("19");
  await writeKvEntry(page, "primaq-pos-year-history", TEST_YEAR_HISTORY);

  await page.goto("/jahresabschluss");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  await expect(page.getByText("MwSt 19 %").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /MwSt 19/ })).toBeVisible();
});

// ── Test 6: Tagesabschluss zeigt korrektes MwSt-Label ────────────────────────

test("VAT 6: Tagesabschluss zeigt MwSt-Label mit konfiguriertem Steuersatz", async ({ page }) => {
  await freshDb(page, "vat6");
  await seedAdmin(page);
  await blockSupabase(page);

  // Navigate first so IDB is accessible, then seed daily data
  await page.goto("/tagesabschluss");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
  await writeKvEntry(page, "primaq-pos-state", JSON.stringify({ cart: [], daily: TEST_DAILY }));

  await page.reload();
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  // Default 7%
  await expect(page.getByText("MwSt 7 %")).toBeVisible();
});

// ── Test 7: CSV-Export enthält konfigurierten Steuersatz im Header ────────────

test("VAT 7: CSV-Export Jahresabschluss enthält konfigurierten Steuersatz", async ({ page }) => {
  await freshDb(page, "vat7");
  await seedAdmin(page);
  await blockSupabase(page);

  await gotoGrundeinstellungen(page);

  await page.getByTestId("vat-preset-19").click();
  await expect(page.getByTestId("vat-rate-input")).toHaveValue("19");
  // Wait for IDB write before navigating
  const stored = await readKvEntry(page, "primaq-pos-vat-rate");
  expect(stored).toBe("19");
  await writeKvEntry(page, "primaq-pos-year-history", TEST_YEAR_HISTORY);

  await page.goto("/jahresabschluss");
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /CSV exportieren/ }).click(),
  ]);

  const filePath = await download.path();
  expect(filePath).toBeTruthy();

  const content = fs.readFileSync(filePath!, "utf-8");
  expect(content).toContain("Netto 19 %");
  expect(content).toContain("MwSt 19 %");
});
