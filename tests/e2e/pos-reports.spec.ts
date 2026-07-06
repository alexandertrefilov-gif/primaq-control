/**
 * POS Wochenbericht / Monatsbericht / Jahresbericht – E2E Tests
 *
 * RPT 1  – Zwei Tagesabschlüsse in derselben Woche → Wochenbericht zeigt beide
 * RPT 2  – Abschlüsse in zwei verschiedenen Wochen → Filter trennt korrekt
 * RPT 3  – Mehrere Tage im Monat → Monatsbericht summiert korrekt
 * RPT 4  – Vergangener Monat bleibt nach Reload sichtbar
 * RPT 5  – Jahresbericht Summe = Summe Monatsberichte
 * RPT 6  – CSV Wochenbericht: Button aktiv, Dateiname enthält KW + Jahr
 * RPT 7  – CSV Monatsbericht: Button aktiv, Dateiname enthält Jahr-Monat
 * RPT 8  – IDB-geseedete Daten (simuliert Sync-Pull) erscheinen im Bericht
 * RPT 9  – Admin-Schutz: Wochenbericht + Monatsbericht ohne Login gesperrt
 * RPT 10 – Verkauf bleibt nach Berichten funktionsfähig
 */

import { expect, test, type Page } from "@playwright/test";
import type { DailySummary } from "../../src/features/pos/pos-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function blockSupabase(page: Page) {
  await page.route(/supabase\.co/, (r) => r.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function seedAdmin(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

/** Clears primaq-pos IDB and seeds pos_year_history with the given summaries. */
async function seedHistory(page: Page, summaries: DailySummary[], tag: string) {
  await page.addInitScript(
    ({ data, t }) => {
      if (sessionStorage.getItem(`rpt-seeded-${t}`) === "1") return;
      sessionStorage.setItem(`rpt-seeded-${t}`, "1");

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
            value: JSON.stringify(data),
          });
        };
      };
    },
    { data: summaries, t: tag }
  );
}

async function waitLoaded(page: Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

/** Builds a minimal DailySummary for testing. */
function makeDay(
  date: string,
  cashCents: number,
  cardCents: number,
  qrCents: number = 0,
  orderCount: number = 1
): DailySummary {
  return {
    date,
    totalCents: cashCents + cardCents + qrCents,
    cashCents,
    cardCents,
    qrCents,
    orderCount,
    orders: [],
  };
}

// ── Test data ─────────────────────────────────────────────────────────────────

// ISO week 26 of 2026: Mon 2026-06-22 … Sun 2026-06-28
// ISO week 27 of 2026: Mon 2026-06-29 … Sun 2026-07-05
const DAY_W26_MON = makeDay("2026-06-22", 1000, 500, 0, 3); // 15,00 €
const DAY_W26_WED = makeDay("2026-06-24", 2000, 0,  0, 2); // 20,00 €
const DAY_W27_MON = makeDay("2026-06-29", 0,    800, 0, 1); //  8,00 €

// ── RPT 1: Two closures in same week ─────────────────────────────────────────

test("RPT 1: Zwei Tagesabschlüsse derselben Woche im Wochenbericht sichtbar", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedHistory(page, [DAY_W26_MON, DAY_W26_WED], "rpt1");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/wochenbericht");
  await waitLoaded(page);

  // Navigate to KW26 2026 (may already be there or navigate back)
  // Navigate until we see KW26 2026 in the header
  for (let i = 0; i < 10; i++) {
    const txt = await page.locator("text=KW26 2026").count();
    if (txt > 0) break;
    await page.getByTestId("prev-week").click();
  }

  await expect(page.getByTestId(`week-day-row-2026-06-22`)).toBeVisible();
  await expect(page.getByTestId(`week-day-row-2026-06-24`)).toBeVisible();

  // Both days must show their totals
  await expect(page.getByTestId("week-day-row-2026-06-22")).toContainText("15,00");
  await expect(page.getByTestId("week-day-row-2026-06-24")).toContainText("20,00");

  // Week total = 15 + 20 = 35,00 €
  await expect(page.getByTestId("week-total")).toContainText("35,00");
});

// ── RPT 2: Closures in two different weeks are separated ─────────────────────

test("RPT 2: Abschlüsse in zwei Wochen werden korrekt getrennt", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedHistory(page, [DAY_W26_MON, DAY_W27_MON], "rpt2");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/wochenbericht");
  await waitLoaded(page);

  // Navigate to KW26
  for (let i = 0; i < 10; i++) {
    if (await page.locator("text=KW26 2026").count() > 0) break;
    await page.getByTestId("prev-week").click();
  }

  // KW26: only Monday visible (15,00 €), Monday of KW27 must NOT appear
  await expect(page.getByTestId("week-day-row-2026-06-22")).toBeVisible();
  await expect(page.getByTestId("week-total")).toContainText("15,00");

  // Navigate to KW27
  await page.getByTestId("next-week").click();
  await expect(page.locator("text=KW27 2026").first()).toBeVisible();

  // KW27: only Monday (8,00 €)
  await expect(page.getByTestId("week-day-row-2026-06-29")).toBeVisible();
  await expect(page.getByTestId("week-total")).toContainText("8,00");
  // Week total must NOT include KW26 data
  await expect(page.getByTestId("week-total")).not.toContainText("15,00");
});

// ── RPT 3: Multiple days in month sum correctly ───────────────────────────────

test("RPT 3: Mehrere Tage im Monat werden korrekt summiert", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  // June 2026: 15 + 20 + 8 = 43,00 € (even though 29. is also June)
  // Note: 2026-06-29 is still June, so all three days are June 2026
  await seedHistory(page, [DAY_W26_MON, DAY_W26_WED, DAY_W27_MON], "rpt3");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/monatsbericht");
  await waitLoaded(page);

  // Navigate to June 2026
  for (let i = 0; i < 20; i++) {
    if (await page.locator("text=Juni 2026").count() > 0) break;
    await page.getByTestId("prev-month").click();
  }

  // All three days visible
  await expect(page.getByTestId("month-day-row-2026-06-22")).toBeVisible();
  await expect(page.getByTestId("month-day-row-2026-06-24")).toBeVisible();
  await expect(page.getByTestId("month-day-row-2026-06-29")).toBeVisible();

  // Total: 1500+2000+800 = 4300 cents = 43,00 €
  await expect(page.getByTestId("month-total")).toContainText("43,00");
});

// ── RPT 4: Past month data survives reload ────────────────────────────────────

test("RPT 4: Vergangener Monat bleibt nach Reload sichtbar", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  // May 2026
  const dayMay = makeDay("2026-05-15", 3000, 1000, 0, 4);
  await seedHistory(page, [dayMay], "rpt4");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/monatsbericht");
  await waitLoaded(page);

  // Navigate to May 2026
  for (let i = 0; i < 24; i++) {
    if (await page.locator("text=Mai 2026").count() > 0) break;
    await page.getByTestId("prev-month").click();
  }
  await expect(page.getByTestId("month-day-row-2026-05-15")).toBeVisible();
  await expect(page.getByTestId("month-total")).toContainText("40,00");

  // Reload the page
  await page.reload();
  await waitLoaded(page);

  // Navigate again to May 2026
  for (let i = 0; i < 24; i++) {
    if (await page.locator("text=Mai 2026").count() > 0) break;
    await page.getByTestId("prev-month").click();
  }

  // Data must still be there
  await expect(page.getByTestId("month-day-row-2026-05-15")).toBeVisible();
  await expect(page.getByTestId("month-total")).toContainText("40,00");
});

// ── RPT 5: Jahresbericht sum = sum of Monatsberichte ─────────────────────────

test("RPT 5: Jahresbericht Gesamtsumme = Summe der Monatsberichte", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  const days = [
    makeDay("2026-03-10", 1000, 500, 0, 2),  // März:  15,00 €
    makeDay("2026-06-22", 1000, 500, 0, 3),  // Juni:  15,00 €
    makeDay("2026-06-24", 2000, 0,   0, 2),  // Juni: +20,00 €
    makeDay("2026-09-05", 0,    3000, 0, 1), // Sept:  30,00 €
  ];
  await seedHistory(page, days, "rpt5");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/jahresabschluss");
  await waitLoaded(page);

  // Select 2026
  const yearSelect = page.locator("select");
  await yearSelect.selectOption("2026");

  // Jahresbericht Gesamtsumme: 15+15+20+30 = 80,00 €
  // KPI card "Umsatz brutto" shows total
  const kpiTotal = page.getByTestId("kpi-total");
  await expect(kpiTotal).toContainText("80,00");

  // Verify monthly aggregation is consistent with per-month data
  // März: 15,00; Juni: 35,00; Sept: 30,00
  const rows = page.locator("tbody tr");
  // March = row index 2 (0-based: Jan=0, Feb=1, Mar=2)
  await expect(rows.nth(2)).toContainText("15,00");
  // June = row index 5
  await expect(rows.nth(5)).toContainText("35,00");
  // September = row index 8
  await expect(rows.nth(8)).toContainText("30,00");
});

// ── RPT 6: CSV Wochenbericht ──────────────────────────────────────────────────

test("RPT 6: CSV Wochenbericht – Button aktiv und Download enthält korrekten Dateinamen", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedHistory(page, [DAY_W26_MON], "rpt6");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/wochenbericht");
  await waitLoaded(page);

  // Navigate to KW26 2026
  for (let i = 0; i < 10; i++) {
    if (await page.locator("text=KW26 2026").count() > 0) break;
    await page.getByTestId("prev-week").click();
  }

  // Button must be enabled
  const csvBtn = page.getByTestId("csv-export-week");
  await expect(csvBtn).toBeEnabled();

  // Click and capture download
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    csvBtn.click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/primaq-wochenbericht-KW26-2026\.csv/);
});

// ── RPT 7: CSV Monatsbericht ──────────────────────────────────────────────────

test("RPT 7: CSV Monatsbericht – Button aktiv und Download enthält korrekten Dateinamen", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedHistory(page, [DAY_W26_MON, DAY_W26_WED], "rpt7");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/monatsbericht");
  await waitLoaded(page);

  // Navigate to June 2026
  for (let i = 0; i < 20; i++) {
    if (await page.locator("text=Juni 2026").count() > 0) break;
    await page.getByTestId("prev-month").click();
  }

  // Button must be enabled
  const csvBtn = page.getByTestId("csv-export-month");
  await expect(csvBtn).toBeEnabled();

  // Click and capture download
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    csvBtn.click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/primaq-monatsbericht-2026-06\.csv/);
});

// ── RPT 8: Seeded IDB data (simulates sync pull) is visible ──────────────────

test("RPT 8: IDB-geseedete Daten (simulierter Sync-Pull) erscheinen im Monatsbericht", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  // Simulate data that would have come from a pos_year_history pull
  const syncedDay = makeDay("2026-04-15", 5000, 2500, 500, 7);
  await seedHistory(page, [syncedDay], "rpt8");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/monatsbericht");
  await waitLoaded(page);

  // Navigate to April 2026
  for (let i = 0; i < 24; i++) {
    if (await page.locator("text=April 2026").count() > 0) break;
    await page.getByTestId("prev-month").click();
  }

  await expect(page.getByTestId("month-day-row-2026-04-15")).toBeVisible();
  // 5000+2500+500 = 8000 cents = 80,00 €
  await expect(page.getByTestId("month-total")).toContainText("80,00");
  // 7 Bestellungen visible in the row
  await expect(page.getByTestId("month-day-row-2026-04-15")).toContainText("7");
});

// ── RPT 9: Admin guard ────────────────────────────────────────────────────────

test("RPT 9: Wochenbericht und Monatsbericht ohne Admin-Login gesperrt", async ({ page }) => {
  await blockSupabase(page);
  // No seedAdmin → isAdmin = false
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto("/wochenbericht");
  await waitLoaded(page);
  await expect(page.locator("text=Admin-Berechtigung erforderlich")).toBeVisible();
  await expect(page.getByTestId("week-table")).not.toBeVisible();

  await page.goto("/monatsbericht");
  await waitLoaded(page);
  await expect(page.locator("text=Admin-Berechtigung erforderlich")).toBeVisible();
  await expect(page.getByTestId("month-table")).not.toBeVisible();
});

// ── RPT 10: Verkauf still functional ─────────────────────────────────────────

test("RPT 10: Verkauf bleibt nach Bericht-Besuchen voll funktionsfähig", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedHistory(page, [DAY_W26_MON], "rpt10");
  await page.setViewportSize({ width: 1280, height: 800 });

  // Visit both report pages
  await page.goto("/wochenbericht");
  await waitLoaded(page);
  await page.goto("/monatsbericht");
  await waitLoaded(page);

  // Go to Verkauf
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Core elements must be present
  await expect(page.getByTestId("flavor-zone")).toBeVisible();
  await expect(page.getByTestId("size-zone")).toBeVisible();
  await expect(page.getByTestId("amount-zone")).toBeVisible();
  await expect(page.getByTestId("cart-zone")).toBeVisible();

  // Select a flavor and size → cart should update
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await expect(page.getByText("KLEIN VANILLE")).toBeVisible({ timeout: 5000 });
});
