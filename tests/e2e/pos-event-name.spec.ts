/**
 * Einsatz- / Veranstaltungsname – E2E Tests
 *
 * EVT 1  – Tagesabschluss zeigt Feld "Einsatz / Veranstaltung"
 * EVT 2  – Einsatzname kann gespeichert werden (Snackbar erscheint)
 * EVT 3  – Reload behält Einsatzname
 * EVT 4  – Leeres Feld zeigt "Einsatzname entfernt" und "—"
 * EVT 5  – Wochenbericht zeigt Einsatzname in der Tabelle
 * EVT 6  – Monatsbericht zeigt Einsatzname in der Tabelle
 * EVT 7  – Tagesabschluss CSV enthält Einsatzname
 * EVT 8  – Verkauf (Buchung) bleibt unverändert funktionsfähig
 * EVT 9  – Nicht gesetzter Name zeigt "—" im Tagesabschluss
 * EVT 10 – Enter im Eingabefeld speichert den Namen
 */

import { expect, test, type Page } from "@playwright/test";
import type { DailySummary } from "../../src/features/pos/pos-types";

async function blockSupabase(page: Page) {
  await page.route(/supabase\.co/, (r) => r.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function seedAdmin(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

async function seedEmpty(page: Page, tag: string) {
  await page.addInitScript((t) => {
    if (window.sessionStorage.getItem(`evt-seeded-${t}`) === "1") return;
    window.sessionStorage.setItem(`evt-seeded-${t}`, "1");
    indexedDB.deleteDatabase("primaq-pos");
  }, tag);
}

async function waitLoaded(page: Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

/** Seeds year history with one day that has an eventName. */
async function seedHistoryWithEvent(page: Page, summary: DailySummary, tag: string) {
  await page.addInitScript(
    ({ data, t }) => {
      if (window.sessionStorage.getItem(`evt-hist-${t}`) === "1") return;
      window.sessionStorage.setItem(`evt-hist-${t}`, "1");

      const del = indexedDB.deleteDatabase("primaq-pos");
      del.onsuccess = () => {
        const req = indexedDB.open("primaq-pos", 2);
        req.onupgradeneeded = (e: Event) => {
          const db = (e.target as IDBOpenDBRequest).result;
          db.createObjectStore("kv", { keyPath: "key" });
          const sq = db.createObjectStore("sync_queue", { keyPath: "id" });
          sq.createIndex("status", "status");
        };
        req.onsuccess = (e: Event) => {
          const db = (e.target as IDBOpenDBRequest).result;
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").put({
            key: "primaq-pos-year-history",
            value: JSON.stringify([data]),
          });
        };
      };
    },
    { data: summary, t: tag }
  );
}

function makeSummary(date: string, eventName: string | null): DailySummary {
  return {
    date,
    totalCents: 3500,
    cashCents: 3500,
    cardCents: 0,
    qrCents: 0,
    orderCount: 2,
    orders: [],
    eventName: eventName ?? undefined,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test("EVT 1 – Tagesabschluss zeigt Feld Einsatz / Veranstaltung", async ({ page }) => {
  await seedEmpty(page, "evt1");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);

  await expect(page.getByTestId("event-name-input")).toBeVisible();
  await expect(page.getByText("Einsatz / Veranstaltung")).toBeVisible();
});

test("EVT 2 – Einsatzname speichern zeigt Snackbar", async ({ page }) => {
  await seedEmpty(page, "evt2");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);

  await page.getByTestId("event-name-input").fill("Backnanger Straßenfest");
  await page.getByTestId("event-name-save").click();

  await expect(page.getByText("Einsatzname gespeichert")).toBeVisible();
  await expect(page.getByTestId("event-name-display")).toHaveText("Backnanger Straßenfest");
});

test("EVT 3 – Reload behält Einsatzname", async ({ page }) => {
  await seedEmpty(page, "evt3");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);

  await page.getByTestId("event-name-input").fill("Heilbronner Lichterfest");
  await page.getByTestId("event-name-save").click();
  await expect(page.getByText("Einsatzname gespeichert")).toBeVisible();

  // Reload page
  await page.reload();
  await waitLoaded(page);

  await expect(page.getByTestId("event-name-input")).toHaveValue("Heilbronner Lichterfest");
  await expect(page.getByTestId("event-name-display")).toHaveText("Heilbronner Lichterfest");
});

test("EVT 4 – Leeres Feld zeigt 'Einsatzname entfernt' und —", async ({ page }) => {
  await seedEmpty(page, "evt4");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);

  // Save a name first
  await page.getByTestId("event-name-input").fill("Stadtfest");
  await page.getByTestId("event-name-save").click();
  await expect(page.getByText("Einsatzname gespeichert")).toBeVisible();

  // Clear and save empty
  await page.getByTestId("event-name-input").fill("");
  await page.getByTestId("event-name-save").click();
  await expect(page.getByText("Einsatzname entfernt")).toBeVisible();
  await expect(page.getByTestId("event-name-display")).toHaveText("—");
});

test("EVT 5 – Wochenbericht zeigt Einsatzname in Tabellenspalte", async ({ page }) => {
  const date = "2026-06-29"; // Monday in KW27
  await seedHistoryWithEvent(page, makeSummary(date, "Firmenfeier Bosch"), "evt5");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=wochenbericht");
  await waitLoaded(page);

  // Navigate to KW27 2026 (may need several prev-week clicks)
  for (let i = 0; i < 8; i++) {
    const row = page.getByTestId(`week-day-row-${date}`);
    if (await row.isVisible()) break;
    await page.getByTestId("prev-week").click();
  }

  const row = page.getByTestId(`week-day-row-${date}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Firmenfeier Bosch");
});

test("EVT 6 – Monatsbericht zeigt Einsatzname in Tabellenspalte", async ({ page }) => {
  const date = "2026-06-15";
  await seedHistoryWithEvent(page, makeSummary(date, "Parkplatz Verkauf"), "evt6");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=monatsbericht");
  await waitLoaded(page);

  // Navigate to Juni 2026
  for (let i = 0; i < 6; i++) {
    const row = page.getByTestId(`month-day-row-${date}`);
    if (await row.isVisible()) break;
    await page.getByTestId("prev-month").click();
  }

  const row = page.getByTestId(`month-day-row-${date}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Parkplatz Verkauf");
});

test("EVT 7 – CSV-Download enthält Einsatzname (Tagesabschluss)", async ({ page }) => {
  await seedEmpty(page, "evt7");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);

  await page.getByTestId("event-name-input").fill("Stadtfest Ludwigsburg");
  await page.getByTestId("event-name-save").click();

  // Trigger download and check the file content
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /CSV exportieren/ }).click(),
  ]);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const content = Buffer.concat(chunks).toString("utf-8");

  expect(content).toContain("Stadtfest Ludwigsburg");
  expect(content).toContain("Einsatz");
});

test("EVT 8 – Verkauf bleibt nach Eingabe des Einsatznamens funktionsfähig", async ({ page }) => {
  await seedEmpty(page, "evt8");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);

  await page.getByTestId("event-name-input").fill("Testeinsatz");
  await page.getByTestId("event-name-save").click();

  // Navigate to Verkauf and book an order
  await page.goto("/verkauf");
  await waitLoaded(page);
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  const kleinBtn = page.getByTestId("size-btn-klein");
  if (await kleinBtn.isVisible()) {
    await kleinBtn.click();
  } else {
    await page.getByRole("button", { name: /Klein/ }).first().click();
  }
  await page.getByTestId("quick-amount-250").click();
  await page.getByTestId("payment-tab-bar").click();
  await page.getByTestId("book-button").click();
  await expect(page.getByTestId("last-booking-bar")).toContainText("#0001");
});

test("EVT 9 – Nicht gesetzter Name zeigt — im Display", async ({ page }) => {
  await seedEmpty(page, "evt9");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);

  // No name set
  await expect(page.getByTestId("event-name-display")).toHaveText("—");
  await expect(page.getByTestId("event-name-input")).toHaveValue("");
});

test("EVT 10 – Enter im Eingabefeld speichert den Namen", async ({ page }) => {
  await seedEmpty(page, "evt10");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);

  await page.getByTestId("event-name-input").fill("Sommerfest");
  await page.getByTestId("event-name-input").press("Enter");

  await expect(page.getByText("Einsatzname gespeichert")).toBeVisible();
  await expect(page.getByTestId("event-name-display")).toHaveText("Sommerfest");
});
