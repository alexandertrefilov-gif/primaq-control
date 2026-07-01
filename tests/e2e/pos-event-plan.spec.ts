/**
 * Einsatzplanung (Jahreskalender) – E2E Tests
 *
 * EPLAN 1  – Jahresabschluss hat Tab "Planung"
 * EPLAN 2  – Planung-Tab zeigt Kalender mit aktuellem Monatsnamen
 * EPLAN 3  – Klick auf Tag öffnet Formular mit Datum
 * EPLAN 4  – Einsatz speichern → erscheint in der Liste
 * EPLAN 5  – Einsatz aus Liste löschen
 * EPLAN 6  – Gespeicherter Einsatz bleibt nach Reload
 * EPLAN 7  – Auto-Fill im Tagesabschluss für heute
 * EPLAN 8  – Kein Auto-Fill wenn Einsatzname bereits manuell gesetzt
 * EPLAN 9  – Bearbeiten via "Bearb."-Button
 * EPLAN 10 – Enter im Namensfeld speichert Einsatz
 */

import { expect, test, type Page } from "@playwright/test";
import type { EventPlan } from "../../src/features/pos/use-event-plan-store";

const EVENT_PLAN_KEY = "primaq-pos-event-plan";
const POS_STATE_KEY = "primaq-pos-state";

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
    if (window.sessionStorage.getItem(`eplan-seeded-${t}`) === "1") return;
    window.sessionStorage.setItem(`eplan-seeded-${t}`, "1");
    indexedDB.deleteDatabase("primaq-pos");
  }, tag);
}

async function waitLoaded(page: Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

/** Seeds the IDB with an event plan entry. */
async function seedEventPlan(page: Page, events: EventPlan[], tag: string) {
  await page.addInitScript(
    ({ evts, key, t }) => {
      if (window.sessionStorage.getItem(`eplan-plan-${t}`) === "1") return;
      window.sessionStorage.setItem(`eplan-plan-${t}`, "1");
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
          tx.objectStore("kv").put({ key, value: JSON.stringify(evts) });
        };
      };
    },
    { evts: events, key: EVENT_PLAN_KEY, t: tag }
  );
}

/** Seeds IDB with both an event plan AND a pos state that has today's date but no eventName. */
async function seedPlanAndPosState(page: Page, event: EventPlan, tag: string) {
  await page.addInitScript(
    ({ ev, planKey, posKey, t }) => {
      if (window.sessionStorage.getItem(`eplan-both-${t}`) === "1") return;
      window.sessionStorage.setItem(`eplan-both-${t}`, "1");
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
          tx.objectStore("kv").put({ key: planKey, value: JSON.stringify([ev]) });
          const today = new Date().toISOString().slice(0, 10);
          const posState = {
            cart: [],
            daily: {
              date: today,
              totalCents: 0, cashCents: 0, cardCents: 0, qrCents: 0,
              orderCount: 0, orders: [],
            },
          };
          tx.objectStore("kv").put({ key: posKey, value: JSON.stringify(posState) });
        };
      };
    },
    { ev: event, planKey: EVENT_PLAN_KEY, posKey: POS_STATE_KEY, t: tag }
  );
}

/** Seeds IDB with both an event plan AND pos state with an already-set eventName. */
async function seedPlanAndPosStateWithExistingName(
  page: Page,
  event: EventPlan,
  existingName: string,
  tag: string
) {
  await page.addInitScript(
    ({ ev, existName, planKey, posKey, t }) => {
      if (window.sessionStorage.getItem(`eplan-exist-${t}`) === "1") return;
      window.sessionStorage.setItem(`eplan-exist-${t}`, "1");
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
          tx.objectStore("kv").put({ key: planKey, value: JSON.stringify([ev]) });
          const today = new Date().toISOString().slice(0, 10);
          const posState = {
            cart: [],
            daily: {
              date: today,
              totalCents: 0, cashCents: 0, cardCents: 0, qrCents: 0,
              orderCount: 0, orders: [],
              eventName: existName,
            },
          };
          tx.objectStore("kv").put({ key: posKey, value: JSON.stringify(posState) });
        };
      };
    },
    { ev: event, existName: existingName, planKey: EVENT_PLAN_KEY, posKey: POS_STATE_KEY, t: tag }
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("EPLAN 1 – Jahresabschluss hat Tab Planung", async ({ page }) => {
  await seedEmpty(page, "ep1");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);

  await expect(page.getByTestId("jahresabschluss-tab-uebersicht")).toBeVisible();
  await expect(page.getByTestId("jahresabschluss-tab-planung")).toBeVisible();
});

test("EPLAN 2 – Planung-Tab zeigt Kalender mit Monatsnamen", async ({ page }) => {
  await seedEmpty(page, "ep2");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);

  await page.getByTestId("jahresabschluss-tab-planung").click();

  const monthLabel = page.getByTestId("plan-month-label");
  await expect(monthLabel).toBeVisible();
  // Should contain a German month name
  const text = await monthLabel.textContent();
  const germanMonths = ["Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember"];
  expect(germanMonths.some((m) => text?.includes(m))).toBe(true);
});

test("EPLAN 3 – Klick auf Tag öffnet Formular", async ({ page }) => {
  await seedEmpty(page, "ep3");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);

  await page.getByTestId("jahresabschluss-tab-planung").click();

  // Find today's date and click it
  const today = new Date().toISOString().slice(0, 10);
  const dayBtn = page.getByTestId(`cal-day-${today}`);
  await expect(dayBtn).toBeVisible();
  await dayBtn.click();

  const form = page.getByTestId("event-plan-form");
  await expect(form).toBeVisible();
  await expect(form).toContainText(today);
  await expect(page.getByTestId("event-plan-name-input")).toBeVisible();
});

test("EPLAN 4 – Einsatz speichern erscheint in Liste", async ({ page }) => {
  await seedEmpty(page, "ep4");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);

  await page.getByTestId("jahresabschluss-tab-planung").click();

  const today = new Date().toISOString().slice(0, 10);
  await page.getByTestId(`cal-day-${today}`).click();
  await page.getByTestId("event-plan-name-input").fill("Sommerfest 2026");
  await page.getByTestId("event-plan-save").click();

  // Form closes and event appears in list
  await expect(page.getByTestId("event-plan-form")).not.toBeVisible();
  await expect(page.getByTestId(`event-plan-item-${today}`)).toBeVisible();
  await expect(page.getByTestId(`event-plan-item-${today}`)).toContainText("Sommerfest 2026");
  // Calendar dot appears
  await expect(page.getByTestId(`cal-day-${today}`)).toContainText(new Date().getDate().toString());
});

test("EPLAN 5 – Einsatz aus Liste löschen", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await seedEventPlan(page, [{ date: today, name: "Testfest" }], "ep5");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);

  await page.getByTestId("jahresabschluss-tab-planung").click();

  await expect(page.getByTestId(`event-plan-item-${today}`)).toBeVisible();
  await page.getByTestId(`event-plan-remove-${today}`).click();

  await expect(page.getByTestId(`event-plan-item-${today}`)).not.toBeVisible();
  await expect(page.getByText("Noch keine Einsätze")).toBeVisible();
});

test("EPLAN 6 – Gespeicherter Einsatz bleibt nach Reload", async ({ page }) => {
  await seedEmpty(page, "ep6");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);

  await page.getByTestId("jahresabschluss-tab-planung").click();

  const today = new Date().toISOString().slice(0, 10);
  await page.getByTestId(`cal-day-${today}`).click();
  await page.getByTestId("event-plan-name-input").fill("Stadtfest Backnang");
  await page.getByTestId("event-plan-save").click();
  await expect(page.getByTestId(`event-plan-item-${today}`)).toBeVisible();

  // Reload
  await page.reload();
  await waitLoaded(page);
  await page.getByTestId("jahresabschluss-tab-planung").click();

  await expect(page.getByTestId(`event-plan-item-${today}`)).toBeVisible();
  await expect(page.getByTestId(`event-plan-item-${today}`)).toContainText("Stadtfest Backnang");
});

test("EPLAN 7 – Auto-Fill Tagesabschluss wenn Einsatz für heute geplant", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await seedPlanAndPosState(page, { date: today, name: "Geplanter Einsatz" }, "ep7");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);

  await expect(page.getByTestId("event-name-input")).toHaveValue("Geplanter Einsatz");
  await expect(page.getByTestId("event-name-display")).toHaveText("Geplanter Einsatz");
});

test("EPLAN 8 – Kein Auto-Fill wenn Einsatzname bereits manuell gesetzt", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await seedPlanAndPosStateWithExistingName(
    page,
    { date: today, name: "Geplanter Einsatz" },
    "Manuell gesetzter Name",
    "ep8"
  );
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);

  // Manual name should win, not the planned name
  await expect(page.getByTestId("event-name-input")).toHaveValue("Manuell gesetzter Name");
  await expect(page.getByTestId("event-name-display")).toHaveText("Manuell gesetzter Name");
});

test("EPLAN 9 – Bearbeiten via Bearb.-Button öffnet Formular mit bestehendem Namen", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await seedEventPlan(page, [{ date: today, name: "Alter Name" }], "ep9");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);

  await page.getByTestId("jahresabschluss-tab-planung").click();
  await expect(page.getByTestId(`event-plan-item-${today}`)).toBeVisible();

  await page.getByTestId(`event-plan-edit-${today}`).click();

  const form = page.getByTestId("event-plan-form");
  await expect(form).toBeVisible();
  await expect(page.getByTestId("event-plan-name-input")).toHaveValue("Alter Name");

  // Update name
  await page.getByTestId("event-plan-name-input").fill("Neuer Name");
  await page.getByTestId("event-plan-save").click();

  await expect(page.getByTestId(`event-plan-item-${today}`)).toContainText("Neuer Name");
});

test("EPLAN 10 – Enter im Namensfeld speichert Einsatz", async ({ page }) => {
  await seedEmpty(page, "ep10");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);

  await page.getByTestId("jahresabschluss-tab-planung").click();

  const today = new Date().toISOString().slice(0, 10);
  await page.getByTestId(`cal-day-${today}`).click();
  await page.getByTestId("event-plan-name-input").fill("Keyboard Einsatz");
  await page.getByTestId("event-plan-name-input").press("Enter");

  await expect(page.getByTestId("event-plan-form")).not.toBeVisible();
  await expect(page.getByTestId(`event-plan-item-${today}`)).toContainText("Keyboard Einsatz");
});
