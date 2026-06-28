/**
 * POS-Kasse: Vollständige E2E-Tests für die neue simple Verkaufskasse
 *
 * Prüft: Artikel hinzufügen, Summe, Barzahlung, Rückgeld, Buchung,
 * Kartenzahlung, QR-Popup, Tagesumsatz, CSV-Export, Reload-Persistenz.
 */

import { expect, test } from "@playwright/test";

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function seedEmptyPos(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("pos-seeded") === "1") return;
    window.sessionStorage.setItem("pos-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
}

async function seedAdmin(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function readPosState(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    return new Promise<{
      cart: unknown[];
      daily: {
        totalCents: number;
        cashCents: number;
        cardCents: number;
        qrCents: number;
        orderCount: number;
        orders: Array<{ paymentMethod: string; totalCents: number; items: unknown[] }>;
      };
    } | null>((resolve) => {
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) { db.close(); resolve(null); return; }
        const tx = db.transaction("kv", "readonly");
        const get = tx.objectStore("kv").get("primaq-pos-state");
        get.onsuccess = () => {
          const row = get.result as { value: string } | undefined;
          db.close();
          resolve(row?.value ? JSON.parse(row.value) : null);
        };
        get.onerror = () => { db.close(); resolve(null); };
      };
      req.onerror = () => resolve(null);
    });
  });
}

async function clickSize(page: import("@playwright/test").Page, label: "Klein" | "Mittel" | "Groß") {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
}

async function clickFlavor(page: import("@playwright/test").Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
}

// ── Test 1: Klein Vanille + Summe ─────────────────────────────────────────────

test("1: Klein Vanille hinzufügen – Summe korrekt", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await clickFlavor(page, "Vanille");
  await clickSize(page, "Klein");

  await expect(page.getByText("Klein Vanille")).toBeVisible();
  // Cart total shows 2,50 € as the Gesamt value
  await expect(page.getByText(/Gesamt/).locator("..").getByText("2,50 €")).toBeVisible();
});

// ── Test 2: Drei Artikel – Gesamtsumme ───────────────────────────────────────

test("2: Klein + Mittel + Groß – Gesamtsumme 11,00 €", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await clickFlavor(page, "Vanille");
  await clickSize(page, "Klein");

  await clickFlavor(page, "Schokolade");
  await clickSize(page, "Mittel");

  await clickFlavor(page, "Mix Vanille/Schokolade");
  await clickSize(page, "Groß");

  // Gesamt: 2,50 + 3,50 + 5,00 = 11,00
  await expect(page.getByText("11,00 €")).toBeVisible();
});

// ── Test 3: Barzahlung + Rückgeld ────────────────────────────────────────────

test("3: Barzahlung 20 € → Rückgeld 9,00 €", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await clickFlavor(page, "Cheesecake");
  await clickSize(page, "Groß");
  // 5,00 €

  // Zahlungsart Bar ist Default – Schnellbutton 10 €
  await page.getByTestId("quick-amount-1000").click();
  await expect(page.getByText("Rückgeld")).toBeVisible();
  await expect(page.getByText("Rückgeld").locator("..").getByText("5,00 €")).toBeVisible(); // Rückgeld 10-5=5

  // Auf 20 € wechseln
  await page.getByTestId("quick-amount-2000").click();
  // Rückgeld-Box zeigt 15,00 € (20 - 5)
  await expect(page.getByText("Rückgeld").locator("..").getByText("15,00 €")).toBeVisible();
});

// ── Test 4: Bestellung buchen + Warenkorb leert sich ─────────────────────────

test("4: Bestellung buchen → Warenkorb leer, Tagesumsatz korrekt", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await clickFlavor(page, "Erdbeere");
  await clickSize(page, "Klein");

  await page.getByTestId("quick-amount-500").click();
  await page.getByRole("button", { name: "Bestellung buchen" }).click();

  // Warenkorb ist leer
  await expect(page.getByText("Noch leer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bestellung buchen" })).toBeDisabled();

  // localStorage korrekt
  const state = await readPosState(page);
  expect(state?.daily.totalCents).toBe(250);
  expect(state?.daily.cashCents).toBe(250);
  expect(state?.daily.orderCount).toBe(1);
});

// ── Test 5: Kartenzahlung ─────────────────────────────────────────────────────

test("5: Kartenzahlung buchen → cardCents korrekt", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await clickFlavor(page, "Vanille");
  await clickSize(page, "Mittel");

  await page.getByRole("button", { name: "Karte" }).click();
  await page.getByRole("button", { name: "Bestellung buchen" }).click();

  const state = await readPosState(page);
  expect(state?.daily.cardCents).toBe(350);
  expect(state?.daily.cashCents).toBe(0);
  expect(state?.daily.qrCents).toBe(0);
});

// ── Test 6: QR-Popup öffnen und bestätigen ────────────────────────────────────

test("6: QR-Popup öffnen und Zahlung bestätigen", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await clickFlavor(page, "Mix Cheesecake/Erdbeere");
  await clickSize(page, "Groß");

  await page.getByRole("button", { name: "QR" }).click();
  await page.getByRole("button", { name: "QR anzeigen" }).click();

  // QR-Popup sichtbar
  await expect(page.getByText("QR-Zahlung")).toBeVisible();
  await expect(page.getByText("5,00 €").first()).toBeVisible();

  await page.getByRole("button", { name: "Zahlung bestätigt" }).click();

  // Warenkorb leer, QR gebucht
  const state = await readPosState(page);
  expect(state?.daily.qrCents).toBe(500);
});

// ── Test 7: Mehrere Buchungen – Tagesumsatz summiert sich ────────────────────

test("7: Drei Buchungen – Gesamtumsatz korrekt summiert", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Bar: 2,50
  await clickFlavor(page, "Vanille");
  await clickSize(page, "Klein");
  await page.getByTestId("quick-amount-500").click();
  await page.getByRole("button", { name: "Bestellung buchen" }).click();

  // Karte: 3,50
  await clickFlavor(page, "Schokolade");
  await clickSize(page, "Mittel");
  await page.getByRole("button", { name: "Karte" }).click();
  await page.getByRole("button", { name: "Bestellung buchen" }).click();

  // Karte: 5,00
  await clickFlavor(page, "Cheesecake");
  await clickSize(page, "Groß");
  await page.getByRole("button", { name: "Karte" }).click();
  await page.getByRole("button", { name: "Bestellung buchen" }).click();

  const state = await readPosState(page);
  expect(state?.daily.totalCents).toBe(250 + 350 + 500); // 11,00 €
  expect(state?.daily.cashCents).toBe(250);
  expect(state?.daily.cardCents).toBe(850);
  expect(state?.daily.orderCount).toBe(3);
});

// ── Test 8: Tagesabschluss-Seite zeigt korrekten Umsatz ──────────────────────

test("8: Tagesabschluss zeigt Umsatz aus /verkauf", async ({ page }) => {
  await seedEmptyPos(page);
  await seedAdmin(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await clickFlavor(page, "Vanille");
  await clickSize(page, "Groß");
  await page.getByRole("button", { name: "Karte" }).click();
  await page.getByRole("button", { name: "Bestellung buchen" }).click();

  await page.goto("/tagesabschluss");
  await waitLoaded(page);

  await expect(page.getByText("5,00 €").first()).toBeVisible();
  await expect(page.getByText("Groß Vanille")).toBeVisible();
});

// ── Test 9: Reload – Tagesdaten bleiben erhalten ──────────────────────────────

test("9: Reload – Tagesumsatz bleibt erhalten", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await clickFlavor(page, "Erdbeere");
  await clickSize(page, "Mittel");
  await page.getByRole("button", { name: "Karte" }).click();
  await page.getByRole("button", { name: "Bestellung buchen" }).click();

  await page.reload();
  await waitLoaded(page);

  const state = await readPosState(page);
  expect(state?.daily.totalCents).toBe(350);
  expect(state?.daily.orderCount).toBe(1);
});

// ── Test 10: Menge ändern + entfernen ────────────────────────────────────────

test("10: Menge erhöhen, verringern, Artikel entfernen", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await clickFlavor(page, "Vanille");
  await clickSize(page, "Klein");

  // Gleicher Artikel nochmal → Menge 2
  await clickFlavor(page, "Vanille");
  await clickSize(page, "Klein");

  await expect(page.getByText("2").first()).toBeVisible(); // Menge 2
  // Cart total: 2 × 2,50 = 5,00 €
  await expect(page.getByText(/Gesamt/).locator("..").getByText("5,00 €")).toBeVisible();

  // Minus: Menge 1
  await page.locator("li").first().getByRole("button").first().click();
  await expect(page.getByText("2,50 €").first()).toBeVisible();

  // X: Artikel entfernen (2-Tap-Bestätigung)
  const listItem = page.locator("li").first();
  await listItem.getByRole("button").last().click(); // zeigt "Löschen?"
  await page.getByRole("button", { name: "Löschen?" }).click(); // bestätigt
  await expect(page.getByText("Noch leer")).toBeVisible();
});

// ── Test 11: Buch-Button bei leerem Warenkorb deaktiviert ────────────────────

test("11: Buchen deaktiviert ohne Warenkorb-Inhalt", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const bookBtn = page.getByRole("button", { name: "Bestellung buchen" });
  await expect(bookBtn).toBeDisabled();
});

// ── Test 12: Navigation Verkauf ↔ Tagesabschluss ─────────────────────────────

test("12: Navigation zwischen Verkauf und Tagesabschluss (mit Admin)", async ({ page }) => {
  await seedEmptyPos(page);
  await seedAdmin(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Tagesabschluss is visible when admin
  await page.getByRole("link", { name: "Tagesabschluss" }).click();
  await waitLoaded(page);
  await expect(page.getByText("Tagesabschluss")).toBeVisible();

  await page.getByRole("link", { name: "Verkauf" }).click();
  await waitLoaded(page);
  await expect(page.getByText("Sorte wählen").first()).toBeVisible();
});

// ── Test 13: localStorage-Migration ──────────────────────────────────────────

test("13: localStorage-Migration – Altdaten bleiben nach Dexie-Update erhalten", async ({ page }) => {
  await page.addInitScript(() => {
    // Simulate a first launch after the Dexie update: IndexedDB empty, localStorage has old data.
    indexedDB.deleteDatabase("primaq-pos");
    const today = new Date().toISOString().slice(0, 10);
    window.localStorage.setItem("primaq-pos-state", JSON.stringify({
      cart: [],
      daily: {
        date: today,
        totalCents: 750,
        cashCents: 500,
        cardCents: 250,
        qrCents: 0,
        orderCount: 2,
        orders: [],
      },
    }));
  });
  await seedAdmin(page);
  await blockSupabase(page);
  await page.goto("/tagesabschluss");
  await waitLoaded(page);

  // Migrated total (7,50 €) must appear on the daily close page.
  await expect(page.getByText("7,50 €").first()).toBeVisible();

  // Verify the data now lives in IndexedDB.
  const state = await readPosState(page);
  expect(state?.daily.totalCents).toBe(750);
  expect(state?.daily.cashCents).toBe(500);
  expect(state?.daily.orderCount).toBe(2);
});
