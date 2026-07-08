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
  await page.locator('[data-testid="month-delete-event-Stuttgart Lichterfest"]:visible').click();

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
  await page.locator('[data-testid="month-delete-day-2026-07-08"]:visible').click();

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
  await expect(page.getByTestId(`month-delete-day-${today}`)).toHaveCount(0);

  // The "Ohne Einsatz" group containing only the live day has no delete button either.
  await expect(page.getByTestId("month-delete-event-ohne-einsatz")).toHaveCount(0);
});

// ── eventId-based grouping (PlannedEvent-Feature) ────────────────────────────

test("GROUP 6 – Zwei Veranstaltungen mit identischem Namen aber unterschiedlicher eventId bleiben getrennt", async ({ page }) => {
  // This is exactly the ambiguity eventId-based grouping is meant to resolve:
  // two genuinely different events that happen to share a name must NOT be
  // merged into one group once they carry distinct eventIds.
  const days = [
    makeSummary("2026-07-05", "Sommerfest", {
      eventId: "evt-alpha", eventStartDate: "2026-07-05", eventEndDate: "2026-07-05",
      eventDayIndex: 1, eventTotalDays: 1,
    }),
    makeSummary("2026-07-20", "Sommerfest", {
      eventId: "evt-beta", eventStartDate: "2026-07-20", eventEndDate: "2026-07-20",
      eventDayIndex: 1, eventTotalDays: 1,
    }),
  ];
  await seedHistoryDays(page, days, "group6");
  await blockSupabase(page);
  await seedAdmin(page);

  await page.goto("/berichte?tab=monatsbericht");
  await waitLoaded(page);
  for (let i = 0; i < 12; i++) {
    if (await page.getByTestId("month-delete-event-evt-alpha").isVisible().catch(() => false)) break;
    await page.getByTestId("prev-month").click();
  }

  // Two distinct groups, not merged into one "Sommerfest" group.
  await expect(page.getByTestId("month-delete-event-evt-alpha")).toBeVisible();
  await expect(page.getByTestId("month-delete-event-evt-beta")).toBeVisible();
  await expect(page.getByTestId("month-day-row-2026-07-05")).toBeVisible();
  await expect(page.getByTestId("month-day-row-2026-07-20")).toBeVisible();
});

test("GROUP 7 – Veranstaltung über eventId löschen entfernt nur deren Tage, nicht die gleichnamige andere", async ({ page }) => {
  const days = [
    makeSummary("2026-07-05", "Sommerfest", {
      eventId: "evt-alpha", eventStartDate: "2026-07-05", eventEndDate: "2026-07-05",
      eventDayIndex: 1, eventTotalDays: 1,
    }),
    makeSummary("2026-07-20", "Sommerfest", {
      eventId: "evt-beta", eventStartDate: "2026-07-20", eventEndDate: "2026-07-20",
      eventDayIndex: 1, eventTotalDays: 1,
    }),
  ];
  await seedHistoryDays(page, days, "group7");
  await blockSupabase(page);
  await seedAdmin(page);

  await page.goto("/berichte?tab=monatsbericht");
  await waitLoaded(page);
  for (let i = 0; i < 12; i++) {
    if (await page.getByTestId("month-delete-event-evt-alpha").isVisible().catch(() => false)) break;
    await page.getByTestId("prev-month").click();
  }

  await page.locator('[data-testid="month-delete-event-evt-alpha"]:visible').click();

  const dialog = page.getByTestId("report-reset-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("reset-affected-events")).toContainText("Sommerfest");

  await page.getByTestId("reset-input").fill("RESET");
  await page.getByTestId("reset-confirm").click();
  await expect(dialog).not.toBeVisible({ timeout: 10000 });

  // evt-alpha's day is gone, evt-beta's identically-named day survives untouched.
  await expect(page.getByTestId("month-day-row-2026-07-05")).toHaveCount(0);
  await expect(page.getByTestId("month-day-row-2026-07-20")).toBeVisible();
  await expect(page.getByTestId("month-delete-event-evt-beta")).toBeVisible();
});

test("GROUP 8 – Tagesabschluss speichert eventId/Zeitraum/Tag-Index dauerhaft in pos_year_history", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await blockSupabase(page);
  await seedAdmin(page);

  const start = new Date();
  const startDate = start.toISOString().slice(0, 10);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 2);
  const endDate = end.toISOString().slice(0, 10);

  await page.addInitScript(
    ({ startDate: sd, endDate: ed, t }) => {
      if (window.sessionStorage.getItem(`grp-plan-${t}`) === "1") return;
      window.sessionStorage.setItem(`grp-plan-${t}`, "1");
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
          const now = new Date().toISOString();
          tx.objectStore("kv").put({
            key: "primaq-pos-event-plan-v2",
            value: JSON.stringify([{
              eventId: "evt-multiday-test", eventName: "Lichterfest Stuttgart",
              startDate: sd, endDate: ed, status: "running", createdAt: now, updatedAt: now,
            }]),
          });
          tx.objectStore("kv").put({ key: "primaq-pos-event-plan-migrated", value: "1" });
        };
      };
    },
    { startDate, endDate, t: "group8" }
  );

  await page.goto("/verkauf");
  await waitLoaded(page);
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("quick-amount-250").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);
  await expect(page.getByTestId("event-name-display")).toHaveText("Lichterfest Stuttgart");

  await page.getByTestId("daily-reset-btn").click();
  await page.getByTestId("daily-reset-btn").click();

  await page.waitForFunction((date) => {
    return new Promise<boolean>((resolve) => {
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readonly");
        const getReq = tx.objectStore("kv").get("primaq-pos-year-history");
        getReq.onsuccess = () => {
          db.close();
          try {
            const history = JSON.parse(getReq.result?.value ?? "[]") as { date: string }[];
            resolve(history.some((d) => d.date === date));
          } catch {
            resolve(false);
          }
        };
      };
      req.onerror = () => resolve(false);
    });
  }, today, { timeout: 5000 });

  const historyEntry = await page.evaluate(() => {
    return new Promise((resolve) => {
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readonly");
        const getReq = tx.objectStore("kv").get("primaq-pos-year-history");
        getReq.onsuccess = () => {
          db.close();
          const history = JSON.parse(getReq.result?.value ?? "[]");
          resolve(history[0] ?? null);
        };
      };
      req.onerror = () => resolve(null);
    });
  }) as {
    eventId?: string; eventName?: string; eventStartDate?: string; eventEndDate?: string;
    eventDayIndex?: number; eventTotalDays?: number;
  } | null;

  expect(historyEntry?.eventId).toBe("evt-multiday-test");
  expect(historyEntry?.eventName).toBe("Lichterfest Stuttgart");
  expect(historyEntry?.eventStartDate).toBe(startDate);
  expect(historyEntry?.eventEndDate).toBe(endDate);
  expect(historyEntry?.eventDayIndex).toBe(1);
  expect(historyEntry?.eventTotalDays).toBe(3);
});
