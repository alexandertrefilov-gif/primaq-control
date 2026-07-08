/**
 * Bericht-Logik: Gruppierung nach Einsatz + sichere Lösch-Logik
 *
 * Kontext: Wochen-/Monats-/Jahresbericht gruppieren Tage jetzt nach Einsatz
 * (eventName) statt nur als flache Tagesliste zu zeigen. Ein Reset einer
 * ganzen Woche/Monat/Jahr kann mehrere unterschiedliche Einsätze gleichzeitig
 * betreffen — das muss dem Admin explizit angezeigt werden, und bei mehr als
 * einem betroffenen Einsatz reicht die einfache "RESET"-Eingabe nicht mehr,
 * sondern ein einsatz-spezifisches, stärkeres Bestätigungswort ist nötig.
 * Zusätzlich müssen einzelne Einsätze und einzelne Tagesabschlüsse gezielt
 * gelöscht werden können, ohne den Rest des Zeitraums zu berühren.
 *
 * WICHTIG (Datenmodell-Limitierung, siehe use-report-data.ts/pos-types.ts):
 * Es gibt kein eventId — Gruppierung erfolgt über den eventName-String. Zwei
 * Tage mit demselben Namen werden immer derselben Gruppe zugeordnet.
 *
 * GROUP 1 – Zwei Einsätze im selben Monat werden getrennt gruppiert, Summe stimmt
 * GROUP 2 – Monatsreset mit zwei betroffenen Einsätzen verlangt "MONAT LÖSCHEN"
 * GROUP 3 – Einzelnen Einsatz löschen entfernt nur dessen Tage
 * GROUP 4 – Einzelnen Tagesabschluss löschen entfernt nur diesen einen Tag
 * GROUP 5 – Laufender (Live-)Tag hat keinen Lösch-Button
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

async function waitLoaded(page: Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

function makeSummary(date: string, eventName: string | null, overrides: Partial<DailySummary> = {}): DailySummary {
  return {
    date,
    totalCents: 15000,
    cashCents: 15000,
    cardCents: 0,
    qrCents: 0,
    orderCount: 3,
    orders: [],
    eventName: eventName ?? undefined,
    ...overrides,
  };
}

/** Seeds year history with the given days (no live/today entry). */
async function seedHistoryDays(page: Page, summaries: DailySummary[], tag: string) {
  await page.addInitScript(
    ({ data, t }) => {
      if (window.sessionStorage.getItem(`grp-hist-${t}`) === "1") return;
      window.sessionStorage.setItem(`grp-hist-${t}`, "1");

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

test("GROUP 1 – Zwei Einsätze im selben Monat werden getrennt gruppiert, Summe stimmt", async ({ page }) => {
  const days = [
    makeSummary("2026-07-08", "Stuttgart Lichterfest", { totalCents: 15000 }),
    makeSummary("2026-07-09", "Stuttgart Lichterfest", { totalCents: 22000 }),
    makeSummary("2026-07-12", "Heilbronner Lichterfest", { totalCents: 30000 }),
  ];
  await seedHistoryDays(page, days, "group1");
  await blockSupabase(page);
  await seedAdmin(page);

  await page.goto("/berichte?tab=monatsbericht");
  await waitLoaded(page);
  // Navigate to Juli 2026 if not already shown.
  for (let i = 0; i < 12; i++) {
    if (await page.getByTestId("month-event-group-Stuttgart Lichterfest").isVisible().catch(() => false)) break;
    await page.getByTestId("prev-month").click();
  }

  const groupA = page.getByTestId("month-event-group-Stuttgart Lichterfest");
  const groupB = page.getByTestId("month-event-group-Heilbronner Lichterfest");
  await expect(groupA).toBeVisible();
  await expect(groupB).toBeVisible();
  await expect(groupA).toContainText("370,00 €"); // 150 + 220
  await expect(groupB).toContainText("300,00 €");

  await expect(page.getByTestId("month-day-row-2026-07-08")).toBeVisible();
  await expect(page.getByTestId("month-day-row-2026-07-09")).toBeVisible();
  await expect(page.getByTestId("month-day-row-2026-07-12")).toBeVisible();

  // Gesamtsumme des Monats bleibt korrekt (370 + 300 = 670).
  await expect(page.getByTestId("month-total")).toContainText("670,00 €");
});

test("GROUP 2 – Monatsreset mit zwei betroffenen Einsätzen verlangt MONAT LÖSCHEN", async ({ page }) => {
  const days = [
    makeSummary("2026-07-08", "Stuttgart Lichterfest"),
    makeSummary("2026-07-12", "Heilbronner Lichterfest"),
  ];
  await seedHistoryDays(page, days, "group2");
  await blockSupabase(page);
  await seedAdmin(page);

  await page.goto("/berichte?tab=monatsbericht");
  await waitLoaded(page);
  for (let i = 0; i < 12; i++) {
    if (await page.getByTestId("reset-month-btn").isVisible().catch(() => false)) break;
    await page.getByTestId("prev-month").click();
  }

  await page.getByTestId("reset-month-btn").click();

  const dialog = page.getByTestId("report-reset-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("reset-multi-event-warning")).toBeVisible();
  const affected = page.getByTestId("reset-affected-events");
  await expect(affected).toContainText("Stuttgart Lichterfest");
  await expect(affected).toContainText("Heilbronner Lichterfest");

  // Plain "RESET" must NOT be enough when multiple events are affected.
  await page.getByTestId("reset-input").fill("RESET");
  await expect(page.getByTestId("reset-confirm")).toBeDisabled();

  await page.getByTestId("reset-input").fill("MONAT LÖSCHEN");
  await expect(page.getByTestId("reset-confirm")).toBeEnabled();
  await page.getByTestId("reset-confirm").click();
  await expect(dialog).not.toBeVisible({ timeout: 10000 });

  await expect(page.getByTestId("month-event-group-Stuttgart Lichterfest")).toHaveCount(0);
  await expect(page.getByTestId("month-event-group-Heilbronner Lichterfest")).toHaveCount(0);
});

test("GROUP 3 – Einzelnen Einsatz löschen entfernt nur dessen Tage", async ({ page }) => {
  const days = [
    makeSummary("2026-07-08", "Stuttgart Lichterfest"),
    makeSummary("2026-07-09", "Stuttgart Lichterfest"),
    makeSummary("2026-07-12", "Heilbronner Lichterfest"),
  ];
  await seedHistoryDays(page, days, "group3");
  await blockSupabase(page);
  await seedAdmin(page);

  await page.goto("/berichte?tab=monatsbericht");
  await waitLoaded(page);
  for (let i = 0; i < 12; i++) {
    if (await page.getByTestId("month-event-group-Stuttgart Lichterfest").isVisible().catch(() => false)) break;
    await page.getByTestId("prev-month").click();
  }

  // All 4 report tabs are mounted simultaneously (CSS-hidden, not unmounted) —
  // scope to the currently visible tab's button only.
  await page.locator('[data-testid="delete-event-Stuttgart Lichterfest"]:visible').click();

  const dialog = page.getByTestId("report-reset-dialog");
  await expect(dialog).toBeVisible();
  const affected = page.getByTestId("reset-affected-events");
  await expect(affected).toContainText("Stuttgart Lichterfest");
  await expect(affected).not.toContainText("Heilbronner Lichterfest");

  // Only one event is affected here, so plain RESET must suffice.
  await page.getByTestId("reset-input").fill("RESET");
  await page.getByTestId("reset-confirm").click();
  await expect(dialog).not.toBeVisible({ timeout: 10000 });

  await expect(page.getByTestId("month-event-group-Stuttgart Lichterfest")).toHaveCount(0);
  await expect(page.getByTestId("month-event-group-Heilbronner Lichterfest")).toBeVisible();
  await expect(page.getByTestId("month-day-row-2026-07-12")).toBeVisible();
});

test("GROUP 4 – Einzelnen Tagesabschluss löschen entfernt nur diesen einen Tag", async ({ page }) => {
  const days = [
    makeSummary("2026-07-08", "Stuttgart Lichterfest"),
    makeSummary("2026-07-09", "Stuttgart Lichterfest"),
  ];
  await seedHistoryDays(page, days, "group4");
  await blockSupabase(page);
  await seedAdmin(page);

  await page.goto("/berichte?tab=monatsbericht");
  await waitLoaded(page);
  for (let i = 0; i < 12; i++) {
    if (await page.getByTestId("month-day-row-2026-07-08").isVisible().catch(() => false)) break;
    await page.getByTestId("prev-month").click();
  }

  // All 4 report tabs are mounted simultaneously (CSS-hidden, not unmounted) —
  // scope to the currently visible tab's button only.
  await page.locator('[data-testid="delete-day-2026-07-08"]:visible').click();

  const dialog = page.getByTestId("report-reset-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("reset-affected-events")).toContainText("Stuttgart Lichterfest");

  await page.getByTestId("reset-input").fill("RESET");
  await page.getByTestId("reset-confirm").click();
  await expect(dialog).not.toBeVisible({ timeout: 10000 });

  await expect(page.getByTestId("month-day-row-2026-07-08")).toHaveCount(0);
  // The sibling day of the same event survives — event group itself remains.
  await expect(page.getByTestId("month-day-row-2026-07-09")).toBeVisible();
  await expect(page.getByTestId("month-event-group-Stuttgart Lichterfest")).toBeVisible();
});

test("GROUP 5 – Laufender (Live-)Tag hat keinen Lösch-Button", async ({ page }) => {
  await page.addInitScript((t) => {
    if (window.sessionStorage.getItem(`grp-seeded-${t}`) === "1") return;
    window.sessionStorage.setItem(`grp-seeded-${t}`, "1");
    indexedDB.deleteDatabase("primaq-pos");
  }, "group5");
  await blockSupabase(page);
  await seedAdmin(page);

  await page.goto("/verkauf");
  await waitLoaded(page);
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("quick-amount-250").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await page.goto("/berichte?tab=monatsbericht");
  await waitLoaded(page);

  const today = new Date().toISOString().slice(0, 10);
  const dayRow = page.getByTestId(`month-day-row-${today}`);
  await expect(dayRow).toBeVisible();
  await expect(page.getByTestId(`delete-day-${today}`)).toHaveCount(0);

  // The "Ohne Einsatz" group containing only the live day has no delete button either.
  await expect(page.getByTestId("delete-event-ohne-einsatz")).toHaveCount(0);
});
