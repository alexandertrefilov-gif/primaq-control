/**
 * FIX – Einsatz erscheint sofort in Wochen-/Monats-/Jahresbericht
 *
 * Ursache: Wochenbericht, Monatsbericht und Jahresabschluss lasen bisher
 * ausschließlich aus pos_year_history (IndexedDB), das erst beim expliziten
 * "Tagesdaten zurücksetzen" einen Eintrag für den aktuellen Tag bekommt.
 * Ein im Tagesabschluss gespeicherter Einsatzname + noch nicht abgeschlossene
 * Verkäufe waren dadurch nur im Tagesbericht sichtbar (liest den Live-Stand
 * direkt), nicht aber in den anderen drei Berichten.
 *
 * useReportData() (src/features/pos/use-report-data.ts) mergt jetzt den
 * laufenden Tag (usePosStore().daily, falls Bestellungen > 0 und noch nicht
 * abgeschlossen) in dieselbe Liste, die history liefert — alle drei Berichte
 * nutzen ausschließlich diesen einen Hook.
 *
 * MERGE 1 – Wochenbericht zeigt laufenden Einsatz ohne Tagesabschluss
 * MERGE 2 – Monatsbericht zeigt laufenden Einsatz ohne Tagesabschluss
 * MERGE 3 – Jahresabschluss-CSV enthält laufenden Einsatz ohne Tagesabschluss
 * MERGE 4 – Nach Tagesabschluss verschwindet der "läuft"-Badge, kein Doppel-Eintrag
 * MERGE 5 – Verkäufe ohne Einsatzname zeigen "Ohne Einsatz", nicht "—"
 * MERGE 6 – Debug-Panel zeigt korrekte Zähler
 * MERGE 7 – Verkauf/Navigation bleiben unverändert funktionsfähig
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
    if (window.sessionStorage.getItem(`merge-seeded-${t}`) === "1") return;
    window.sessionStorage.setItem(`merge-seeded-${t}`, "1");
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

  // usePosStore persists to IndexedDB asynchronously (a useEffect after the
  // state update) — wait for that write to actually land before navigating
  // away, otherwise the next page's rehydration can race a stale read.
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

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

test("MERGE 1 – Wochenbericht zeigt laufenden Einsatz ohne Tagesabschluss", async ({ page }) => {
  await seedEmpty(page, "merge1");
  await blockSupabase(page);
  await seedAdmin(page);

  await setEventName(page, "Stuttgart Lichterfest");
  await bookOneSale(page);

  await page.goto("/berichte?tab=wochenbericht");
  await waitLoaded(page);

  const row = page.getByTestId(`week-day-row-${todayStr()}`);
  await expect(row).toBeVisible();
  // Einsatzname und "läuft"-Badge stehen in der Gruppen-Kopfzeile (Ebene 1),
  // die Tageszeile selbst (Ebene 2) zeigt nur noch Datum/Zahlen.
  const group = page.getByTestId("week-event-group-Stuttgart Lichterfest");
  await expect(group).toContainText("Stuttgart Lichterfest");
  await expect(group).toContainText("läuft");
});

test("MERGE 2 – Monatsbericht zeigt laufenden Einsatz ohne Tagesabschluss", async ({ page }) => {
  await seedEmpty(page, "merge2");
  await blockSupabase(page);
  await seedAdmin(page);

  await setEventName(page, "Parkfest Esslingen");
  await bookOneSale(page);

  await page.goto("/berichte?tab=monatsbericht");
  await waitLoaded(page);

  const row = page.getByTestId(`month-day-row-${todayStr()}`);
  await expect(row).toBeVisible();
  // Einsatzname steht in der Gruppen-Kopfzeile (Ebene 1: Einsatz).
  await expect(page.getByTestId("month-event-group-Parkfest Esslingen")).toContainText("Parkfest Esslingen");
});

test("MERGE 3 – Jahresabschluss-CSV enthält laufenden Einsatz ohne Tagesabschluss", async ({ page }) => {
  await seedEmpty(page, "merge3");
  await blockSupabase(page);
  await seedAdmin(page);

  await setEventName(page, "Weindorf Heilbronn");
  await bookOneSale(page);

  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /CSV exportieren/ }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const content = Buffer.concat(chunks).toString("utf-8");

  expect(content).toContain("Weindorf Heilbronn");
});

test("MERGE 4 – Nach Tagesabschluss verschwindet läuft-Badge, kein Doppel-Eintrag", async ({ page }) => {
  await seedEmpty(page, "merge4");
  await blockSupabase(page);
  await seedAdmin(page);

  await setEventName(page, "Nachtmarkt Tübingen");
  await bookOneSale(page);

  // Close the day (two clicks: confirm, then execute).
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);
  await page.getByTestId("daily-reset-btn").click();
  await page.getByTestId("daily-reset-btn").click();

  // saveDay() (→ pos_year_history) and resetDaily() (→ primaq-pos-state)
  // both persist to IndexedDB asynchronously — wait for both writes to land
  // before navigating away, otherwise the next page can rehydrate a stale
  // pre-close state and re-merge the (already closed) day as still-live.
  const today = todayStr();
  await page.waitForFunction(
    (date) =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open("primaq-pos");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("kv", "readonly");
          const store = tx.objectStore("kv");
          const historyReq = store.get("primaq-pos-year-history");
          const stateReq = store.get("primaq-pos-state");
          tx.oncomplete = () => {
            db.close();
            try {
              const history = JSON.parse(historyReq.result?.value ?? "[]") as { date: string }[];
              const state = JSON.parse(stateReq.result?.value ?? "{}");
              resolve(history.some((d) => d.date === date) && state?.daily?.orderCount === 0);
            } catch {
              resolve(false);
            }
          };
        };
        req.onerror = () => resolve(false);
      }),
    today,
    { timeout: 5000 }
  );

  await page.goto("/berichte?tab=wochenbericht");
  await waitLoaded(page);

  const row = page.getByTestId(`week-day-row-${todayStr()}`);
  await expect(row).toBeVisible();
  // Einsatzname + "läuft"-Badge stehen in der Gruppen-Kopfzeile (Ebene 1).
  const group = page.getByTestId("week-event-group-Nachtmarkt Tübingen");
  await expect(group).toContainText("Nachtmarkt Tübingen");
  await expect(group).not.toContainText("läuft");

  // Exactly one row for today — not duplicated between history and live merge.
  await expect(page.getByTestId(`week-day-row-${todayStr()}`)).toHaveCount(1);
});

test("MERGE 5 – Verkäufe ohne Einsatzname zeigen Ohne Einsatz", async ({ page }) => {
  await seedEmpty(page, "merge5");
  await blockSupabase(page);
  await seedAdmin(page);

  await bookOneSale(page);

  await page.goto("/berichte?tab=wochenbericht");
  await waitLoaded(page);

  // Tage ohne Einsatzname werden unter der "Ohne Einsatz"-Gruppe (Ebene 1) geführt.
  await expect(page.getByTestId("week-event-group-ohne-einsatz")).toContainText("Ohne Einsatz");
  await expect(page.getByTestId(`week-day-row-${todayStr()}`)).toBeVisible();
});

test("MERGE 6 – Debug-Panel zeigt korrekte Zähler", async ({ page }) => {
  await seedEmpty(page, "merge6");
  await blockSupabase(page);
  await seedAdmin(page);

  await setEventName(page, "Adventsmarkt");
  await bookOneSale(page);

  await page.goto("/berichte?tab=wochenbericht");
  await waitLoaded(page);

  // Every report tab is mounted simultaneously (hidden via CSS, not
  // unmounted) — scope to the currently visible debug panel only.
  const debug = page.locator('[data-testid="report-event-debug"]:visible');
  await expect(debug).toBeVisible();
  await expect(debug).toContainText("Aktiver Einsatz:");
  await expect(debug).toContainText("Adventsmarkt");
  await expect(debug).toContainText("Verkäufe heute:");
  await expect(debug).toContainText("Ohne Einsatz:");
});

test("MERGE 7 – Verkauf/Navigation bleiben unverändert funktionsfähig", async ({ page }) => {
  await seedEmpty(page, "merge7");
  await blockSupabase(page);
  await seedAdmin(page);

  await setEventName(page, "Sommerfest");
  await bookOneSale(page);
  await expect(page.getByText("Noch leer")).toBeVisible();

  await page.goto("/berichte?tab=wochenbericht");
  await waitLoaded(page);
  await page.goto("/berichte?tab=monatsbericht");
  await waitLoaded(page);
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);
  await expect(page.getByRole("button", { name: "Übersicht" })).toBeVisible();
});
