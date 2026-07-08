/**
 * FIX – Monats-/Wochen-/Jahresreset behandelt Live-Tag nicht als löschbare
 * History
 *
 * Ursache: useReportData() mergt den laufenden, noch nicht abgeschlossenen
 * Tag in dieselbe Liste, die auch der Wochen-/Monats-/Jahresbericht anzeigt.
 * Die Reset-Dialoge der drei Berichte berechneten die zu löschende Menge
 * bislang direkt aus dieser gemergten Liste:
 *  - Monats-/Jahresbericht filterten korrekt `!d.isLive`, zeigten aber immer
 *    den irreführenden Text "Alle Daten … werden gelöscht", auch wenn nur
 *    der Live-Tag vorhanden war (der Reset war dadurch ein stiller No-op,
 *    ohne dass die UI das kenntlich machte — das las sich wie "hängt und
 *    löscht nicht").
 *  - Wochenbericht filterte fehlerhaft: `weekDays` enthält für jede Woche
 *    immer 7 Slots (auch Tage ganz ohne Zusammenfassung); der Ausdruck
 *    `!d.summary?.isLive` war für Tage OHNE summary ebenfalls `true` und
 *    hat sie fälschlich in die zu löschende Menge aufgenommen — das löste
 *    unnötige Netzwerk-Aufrufe (checkConnection + delete) aus, selbst wenn
 *    in der Woche nur der Live-Tag existierte.
 *
 * Fix: historyDaysToDelete wird jetzt separat aus den tatsächlich
 * abgeschlossenen Tagen berechnet (Wochenbericht: nur Tage mit `summary`
 * UND `!summary.isLive`). ReportResetDialog zeigt je nach Zusammensetzung
 * einen von drei Texten und verlangt bei "nichts zu löschen" keine
 * RESET-Eingabe mehr, sondern nur einen "Schließen"-Button — der Reset
 * ruft `onConfirm()` (und damit resetHistoryDates) in diesem Fall gar
 * nicht erst auf.
 */

import { expect, test, type Page } from "@playwright/test";

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
    if (window.sessionStorage.getItem(`reset-live-seeded-${t}`) === "1") return;
    window.sessionStorage.setItem(`reset-live-seeded-${t}`, "1");
    indexedDB.deleteDatabase("primaq-pos");
  }, tag);
}

async function waitLoaded(page: Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function bookOneSale(page: Page) {
  await page.goto("/verkauf");
  await waitLoaded(page);
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("quick-amount-250").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();
}

async function setEventName(page: Page, name: string) {
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);
  await page.getByTestId("event-name-input").fill(name);
  await page.getByTestId("event-name-save").click();
  await expect(page.getByTestId("event-name-display")).toHaveText(name);
  await page.waitForFunction(
    (expected) =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open("primaq-pos");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("kv", "readonly");
          const getReq = tx.objectStore("kv").get("primaq-pos-state");
          getReq.onsuccess = () => {
            db.close();
            try {
              const parsed = JSON.parse(getReq.result?.value ?? "{}");
              resolve(parsed?.daily?.eventName === expected);
            } catch {
              resolve(false);
            }
          };
          getReq.onerror = () => { db.close(); resolve(false); };
        };
        req.onerror = () => resolve(false);
      }),
    name,
    { timeout: 5000 }
  );
}

/** Seeds one closed pos_year_history day directly into IndexedDB. */
async function seedHistoryDay(page: Page, date: string) {
  await page.evaluate((d) => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readwrite");
        const store = tx.objectStore("kv");
        const getReq = store.get("primaq-pos-year-history");
        getReq.onsuccess = () => {
          const existing = getReq.result?.value ? JSON.parse(getReq.result.value) : [];
          existing.push({
            date: d,
            eventName: null,
            totalCents: 500,
            cashCents: 0,
            cardCents: 500,
            qrCents: 0,
            orderCount: 1,
            orders: [],
          });
          store.put({ key: "primaq-pos-year-history", value: JSON.stringify(existing) });
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    });
  }, date);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A date within the current ISO week (Mon–Sun) that is not today. */
function historyDateThisWeek(): string {
  const now = new Date();
  const dow = (now.getUTCDay() + 6) % 7; // 0=Monday
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - dow);
  const candidate = monday.toISOString().slice(0, 10);
  if (candidate !== todayStr()) return candidate;
  const tuesday = new Date(monday);
  tuesday.setUTCDate(monday.getUTCDate() + 1);
  return tuesday.toISOString().slice(0, 10);
}

/** A date within the current year that is not today. */
function historyDateThisYear(): string {
  const year = new Date().getFullYear();
  const candidate = `${year}-01-15`;
  return candidate !== todayStr() ? candidate : `${year}-01-16`;
}

test("RESET-LIVE 1 – Monatsreset mit nur Live-Tag zeigt Info-Dialog ohne RESET-Zwang", async ({ page }) => {
  await seedEmpty(page, "reset1");
  await blockSupabase(page);
  await seedAdmin(page);

  await bookOneSale(page);
  await bookOneSale(page);

  await page.goto("/berichte?tab=monatsbericht");
  await waitLoaded(page);

  await expect(page.getByTestId("reset-month-btn")).toBeVisible();
  await page.getByTestId("reset-month-btn").click();

  const dialog = page.getByTestId("report-reset-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("reset-dialog-message")).toContainText("keine abgeschlossenen");
  await expect(page.getByTestId("reset-dialog-message")).toContainText("laufende Tag wird nicht gelöscht");

  // No destructive RESET flow should even be offered when there's nothing to delete.
  await expect(page.getByTestId("reset-input")).toHaveCount(0);
  await expect(page.getByTestId("reset-confirm")).toHaveCount(0);

  await page.getByTestId("reset-close-info").click();
  await expect(dialog).not.toBeVisible();

  // The live day must still be there, untouched.
  await expect(page.getByTestId(`month-day-row-${todayStr()}`)).toBeVisible();
});

test("RESET-LIVE 2 – Monatsreset mit History + Live löscht nur History, Live bleibt", async ({ page }) => {
  await seedEmpty(page, "reset2");
  await blockSupabase(page);
  await seedAdmin(page);

  // A day in the current month that isn't today (day 1, or day 2 if today is the 1st).
  const monthPrefix = todayStr().slice(0, 8); // "YYYY-MM-"
  const historyDate = `${monthPrefix}01` === todayStr() ? `${monthPrefix}02` : `${monthPrefix}01`;

  await page.goto("/verkauf");
  await waitLoaded(page);
  await seedHistoryDay(page, historyDate);
  await bookOneSale(page);

  await page.goto("/berichte?tab=monatsbericht");
  await waitLoaded(page);

  await expect(page.getByTestId("reset-month-btn")).toBeVisible();
  await page.getByTestId("reset-month-btn").click();

  await expect(page.getByTestId("reset-dialog-message")).toContainText("nur abgeschlossene");
  await expect(page.getByTestId("reset-dialog-message")).toContainText("laufende Tag bleibt erhalten");

  await page.getByTestId("reset-input").fill("RESET");
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByTestId("report-reset-dialog")).not.toBeVisible({ timeout: 10000 });

  await expect(page.getByTestId(`month-day-row-${todayStr()}`)).toBeVisible();
  await expect(page.getByTestId(`month-day-row-${todayStr()}`)).toHaveCount(1);
});

test("RESET-LIVE 3 – Wochenreset mit nur Live-Tag zeigt Info-Dialog statt Netzwerkaufruf", async ({ page }) => {
  await seedEmpty(page, "reset3");
  await blockSupabase(page);
  await seedAdmin(page);

  await setEventName(page, "Sommerfest Reset-Test");
  await bookOneSale(page);

  await page.goto("/berichte?tab=wochenbericht");
  await waitLoaded(page);

  await expect(page.getByTestId("reset-week-btn")).toBeVisible();
  await page.getByTestId("reset-week-btn").click();

  await expect(page.getByTestId("reset-dialog-message")).toContainText("keine abgeschlossenen");
  await expect(page.getByTestId("reset-input")).toHaveCount(0);

  await page.getByTestId("reset-close-info").click();
  await expect(page.getByTestId("report-reset-dialog")).not.toBeVisible();

  await expect(page.getByTestId("week-event-group-Sommerfest Reset-Test")).toContainText("läuft");
});

test("RESET-LIVE 4 – Wochenreset mit History + Live löscht nur History, Live bleibt", async ({ page }) => {
  await seedEmpty(page, "reset4");
  await blockSupabase(page);
  await seedAdmin(page);

  const historyDate = historyDateThisWeek();

  await page.goto("/verkauf");
  await waitLoaded(page);
  await seedHistoryDay(page, historyDate);
  await setEventName(page, "Nachtmarkt Reset-Test");
  await bookOneSale(page);

  await page.goto("/berichte?tab=wochenbericht");
  await waitLoaded(page);

  await page.getByTestId("reset-week-btn").click();
  await expect(page.getByTestId("reset-dialog-message")).toContainText("nur abgeschlossene");
  await expect(page.getByTestId("reset-dialog-message")).toContainText("laufende Tag bleibt erhalten");

  await page.getByTestId("reset-input").fill("RESET");
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByTestId("report-reset-dialog")).not.toBeVisible({ timeout: 10000 });

  await expect(page.getByTestId("week-event-group-Nachtmarkt Reset-Test")).toContainText("läuft");
  // Deleted history day is gone entirely — empty days are no longer rendered
  // in the grouped-by-Einsatz table (nothing to show or delete).
  await expect(page.getByTestId(`week-day-row-${historyDate}`)).toHaveCount(0);
});

test("RESET-LIVE 5 – Jahresreset mit nur Live-Tag zeigt Info-Dialog", async ({ page }) => {
  await seedEmpty(page, "reset5");
  await blockSupabase(page);
  await seedAdmin(page);

  await bookOneSale(page);

  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);

  await expect(page.getByTestId("reset-year-btn")).toBeVisible();
  await page.getByTestId("reset-year-btn").click();

  await expect(page.getByTestId("reset-dialog-message")).toContainText("keine abgeschlossenen");
  await expect(page.getByTestId("reset-input")).toHaveCount(0);

  await page.getByTestId("reset-close-info").click();
  await expect(page.getByTestId("report-reset-dialog")).not.toBeVisible();
});

test("RESET-LIVE 6 – Jahresreset mit History + Live löscht nur History, Live bleibt", async ({ page }) => {
  await seedEmpty(page, "reset6");
  await blockSupabase(page);
  await seedAdmin(page);

  const historyDate = historyDateThisYear();

  await page.goto("/verkauf");
  await waitLoaded(page);
  await seedHistoryDay(page, historyDate);
  await bookOneSale(page);

  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);

  await page.getByTestId("reset-year-btn").click();
  await expect(page.getByTestId("reset-dialog-message")).toContainText("nur abgeschlossene");
  await expect(page.getByTestId("reset-dialog-message")).toContainText("laufende Tag bleibt erhalten");

  await page.getByTestId("reset-input").fill("RESET");
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByTestId("report-reset-dialog")).not.toBeVisible({ timeout: 10000 });
});
