/**
 * POS Payment Config – Zahlungsbereich Konfiguration
 *
 * 1  – +/- Buttons erhöhen und verringern den Gegeben-Betrag um 1 €
 * 2  – C-Button leert das Gegeben-Feld
 * 3  – showAsQuickAmount=false entfernt Preis aus Schnellbeträgen
 * 4  – Eigener Schnellbetrag erscheint in der Kasse
 * 5  – Bill-Toggle: 10 € deaktiviert entfernt quick-amount-1000
 * 6  – Duplikat-Schutz: Größenpreis = Schein → nur einmal sichtbar
 * 7  – Buchungslogik unverändert (Karte bucht korrekt)
 */

import { expect, test } from "@playwright/test";

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function freshDb(page: import("@playwright/test").Page, tag: string) {
  await page.addInitScript((t) => {
    if (window.sessionStorage.getItem(`pay-cfg-seeded-${t}`) === "1") return;
    window.sessionStorage.setItem(`pay-cfg-seeded-${t}`, "1");
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

/** Write layout directly to IDB after page load (reliable, no race condition). */
async function writeLayout(
  page: import("@playwright/test").Page,
  layout: Record<string, unknown>
): Promise<void> {
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
        tx.objectStore("kv").put({ key: "primaq-pos-layout-v1", value: JSON.stringify(data) });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    });
  }, layout);
}

function makeLayout(patch: Record<string, unknown>) {
  return {
    active: {
      panels: [
        { id: "groessen", size: "gross" },
        { id: "sorten", size: "gross" },
        { id: "warenkorb", size: "gross" },
      ],
      toggles: { zahlung: true, "live-monitor": true, verkaufszaehler: true, "letzte-bestellung": true },
      sizeVisibility: { klein: true, mittel: true, gross: true },
      salesSizes: {
        klein:  { label: "Klein",  priceCents: 250, order: 1, backgroundColor: "#F6F2E8", textColorMode: "auto", imageDataUrl: null, imageScale: 100, showAsQuickAmount: true },
        mittel: { label: "Mittel", priceCents: 350, order: 2, backgroundColor: "#F8E3A0", textColorMode: "auto", imageDataUrl: null, imageScale: 100, showAsQuickAmount: true },
        gross:  { label: "Groß",   priceCents: 500, order: 3, backgroundColor: "#F4C96D", textColorMode: "auto", imageDataUrl: null, imageScale: 100, showAsQuickAmount: true },
      },
      flavorCardSize: 140, sizeColumnWidth: 176, qtyButtonSize: 44, cartFontSize: "normal", cartWidth: 400,
      payment: { barColor: "#16a34a", karteColor: "#2563eb", qrColor: "#7c3aed", bookColor: "#16a34a", bills: [500, 1000, 2000, 5000], customAmounts: [] },
      ...patch,
    },
    profiles: [],
  };
}

// ── Test 1: +/- erhöhen / verringern ─────────────────────────────

test("CFG 1: + Button erhöht Gegeben um 1 €, − Button verringert", async ({ page }) => {
  await freshDb(page, "cfg1");
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByTestId("payment-tab-bar").click();

  // Start with 5 €
  await page.getByTestId("quick-amount-500").click();
  const input = page.locator('input[type="number"]');
  await expect(input).toHaveValue("5");

  // Plus → 6 €
  await page.getByTestId("cash-plus").click();
  await expect(input).toHaveValue("6");

  // Minus → 5 €
  await page.getByTestId("cash-minus").click();
  await expect(input).toHaveValue("5");
});

// ── Test 2: C-Button leert das Feld ──────────────────────────────

test("CFG 2: C-Button leert das Gegeben-Feld", async ({ page }) => {
  await freshDb(page, "cfg2");
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByTestId("payment-tab-bar").click();
  await page.getByTestId("quick-amount-500").click();
  const input = page.locator('input[type="number"]');
  await expect(input).toHaveValue("5");

  await page.getByTestId("cash-clear").click();
  await expect(input).toHaveValue("");
});

// ── Test 3: showAsQuickAmount=false entfernt Preis ───────────────

test("CFG 3: showAsQuickAmount=false für Klein entfernt 2,50 € Button", async ({ page }) => {
  await freshDb(page, "cfg3");
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Write layout with Klein.showAsQuickAmount=false, then reload
  await writeLayout(page, makeLayout({
    salesSizes: {
      klein:  { label: "Klein",  priceCents: 250, order: 1, backgroundColor: "#F6F2E8", textColorMode: "auto", imageDataUrl: null, imageScale: 100, showAsQuickAmount: false },
      mittel: { label: "Mittel", priceCents: 350, order: 2, backgroundColor: "#F8E3A0", textColorMode: "auto", imageDataUrl: null, imageScale: 100, showAsQuickAmount: true },
      gross:  { label: "Groß",   priceCents: 500, order: 3, backgroundColor: "#F4C96D", textColorMode: "auto", imageDataUrl: null, imageScale: 100, showAsQuickAmount: true },
    },
  }));
  await page.reload();
  await waitLoaded(page);

  await page.getByTestId("payment-tab-bar").click();

  // Klein (250ct) must NOT appear: showAsQuickAmount=false AND 250 not in bills
  await expect(page.getByTestId("quick-amount-250")).not.toBeAttached();
  // Mittel (350ct) still appears
  await expect(page.getByTestId("quick-amount-350")).toBeVisible();
});

// ── Test 4: Eigener Schnellbetrag erscheint in der Kasse ──────────

test("CFG 4: Eigener Schnellbetrag 1500ct erscheint als 15,00 € Button", async ({ page }) => {
  await freshDb(page, "cfg4");
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await writeLayout(page, makeLayout({
    payment: { barColor: "#16a34a", karteColor: "#2563eb", qrColor: "#7c3aed", bookColor: "#16a34a", bills: [500, 1000, 2000, 5000], customAmounts: [1500] },
  }));
  await page.reload();
  await waitLoaded(page);

  await page.getByTestId("payment-tab-bar").click();
  await expect(page.getByTestId("quick-amount-1500")).toBeVisible();

  // Click it – sets input to 15
  await page.getByTestId("quick-amount-1500").click();
  await expect(page.locator('input[type="number"]')).toHaveValue("15");
});

// ── Test 5: Bill-Toggle – 10 € deaktiviert ────────────────────────

test("CFG 5: 10 € Schein deaktiviert entfernt quick-amount-1000", async ({ page }) => {
  await freshDb(page, "cfg5");
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await writeLayout(page, makeLayout({
    payment: { barColor: "#16a34a", karteColor: "#2563eb", qrColor: "#7c3aed", bookColor: "#16a34a", bills: [500, 2000, 5000], customAmounts: [] }, // 1000 removed
  }));
  await page.reload();
  await waitLoaded(page);

  await page.getByTestId("payment-tab-bar").click();

  // 1000 not in bills AND no size has priceCents=1000 → must not appear
  await expect(page.getByTestId("quick-amount-1000")).not.toBeAttached();
  // 500 still in bills (and Groß=500) → appears exactly once
  await expect(page.getByTestId("quick-amount-500")).toHaveCount(1);
});

// ── Test 6: Duplikat-Schutz ───────────────────────────────────────

test("CFG 6: Groß=5,00 € und Schein 5 € ergeben nur einen Button", async ({ page }) => {
  await freshDb(page, "cfg6");
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByTestId("payment-tab-bar").click();
  // Default: Groß=500ct, bills includes 500 → only one quick-amount-500
  await expect(page.getByTestId("quick-amount-500")).toHaveCount(1);
});

// ── Test 7: Buchungslogik unverändert ─────────────────────────────

test("CFG 7: Nach Redesign bucht Karte korrekt ohne Gegeben-Eingabe", async ({ page }) => {
  await freshDb(page, "cfg7");
  await seedAdmin(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByRole("button", { name: /^Klein/ }).click();

  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await expect(page.getByText("Noch leer")).toBeVisible();
});
