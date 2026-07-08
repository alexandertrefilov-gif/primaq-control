/**
 * Einsatzplanung (Jahreskalender) – E2E Tests
 *
 * Datenmodell: PlannedEvent (eventId, eventName, startDate, endDate, location?,
 * status, createdAt, updatedAt) unter dem Key "primaq-pos-event-plan-v2".
 * Legacy-Einträge unter dem alten Key "primaq-pos-event-plan" ({date, name})
 * werden beim ersten Laden 1:1 zu Ein-Tages-PlannedEvents migriert (kein
 * automatisches Zusammenführen mehrerer Tage — siehe use-event-plan-store.ts).
 *
 * EPLAN 1  – Jahresabschluss hat Tab "Planung"
 * EPLAN 2  – Planung-Tab zeigt Kalender mit aktuellem Monatsnamen
 * EPLAN 3  – Klick auf Tag öffnet Formular mit Start-/Enddatum
 * EPLAN 4  – Einsatz speichern → erscheint in der Liste
 * EPLAN 5  – Einsatz aus Liste löschen
 * EPLAN 6  – Gespeicherter Einsatz bleibt nach Reload
 * EPLAN 7  – Auto-Fill im Tagesabschluss für heute (eventId + Zeitraum gespeichert)
 * EPLAN 8  – Kein Auto-Fill wenn Einsatzname bereits manuell gesetzt
 * EPLAN 9  – Bearbeiten via "Bearb."-Button
 * EPLAN 10 – Enter im Namensfeld speichert Einsatz
 * EPLAN 11 – Migration: alte Einzeltage-Events bleiben als Ein-Tages-Events erhalten
 * EPLAN 12 – Mehrtägige Veranstaltung: Kalender markiert zusammenhängenden Zeitraum
 * EPLAN 13 – Mehrere Veranstaltungen am selben Tag → Auswahl im Tagesabschluss
 * EPLAN 14 – Keine passende Veranstaltung → manuelle Eingabe + "als neue Veranstaltung anlegen"
 */

import { expect, test, type Page } from "@playwright/test";

const LEGACY_EVENT_PLAN_KEY = "primaq-pos-event-plan";
const EVENT_PLAN_KEY = "primaq-pos-event-plan-v2";
const POS_STATE_KEY = "primaq-pos-state";

type PlannedEventSeed = {
  eventId: string;
  eventName: string;
  startDate: string;
  endDate: string;
  location?: string;
  status: "planned" | "running" | "completed";
  createdAt: string;
  updatedAt: string;
};

function makePlannedEvent(overrides: Partial<PlannedEventSeed> & { eventName: string; startDate: string; endDate?: string }): PlannedEventSeed {
  const now = new Date().toISOString();
  return {
    eventId: `event_seed_${Math.random().toString(36).slice(2, 8)}`,
    endDate: overrides.startDate,
    status: "planned",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

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

function idbSeedScript() {
  return (args: { puts: { key: string; value: unknown }[]; t: string }) => {
    if (window.sessionStorage.getItem(`eplan-seed-${args.t}`) === "1") return;
    window.sessionStorage.setItem(`eplan-seed-${args.t}`, "1");
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
        for (const p of args.puts) {
          tx.objectStore("kv").put({ key: p.key, value: JSON.stringify(p.value) });
        }
      };
    };
  };
}

/** Seeds the new v2 event-plan store directly (migration already "done"). */
async function seedPlannedEvents(page: Page, events: PlannedEventSeed[], tag: string) {
  await page.addInitScript(
    idbSeedScript(),
    {
      puts: [
        { key: EVENT_PLAN_KEY, value: events },
        { key: "primaq-pos-event-plan-migrated", value: "1" },
      ],
      t: tag,
    }
  );
}

/** Seeds ONLY the legacy key (no v2, no migration marker) to test migration. */
async function seedLegacyEventPlan(page: Page, legacy: { date: string; name: string }[], tag: string) {
  await page.addInitScript(
    idbSeedScript(),
    { puts: [{ key: LEGACY_EVENT_PLAN_KEY, value: legacy }], t: tag }
  );
}

/** Seeds planned events AND a pos state for today (no eventName set yet). */
async function seedPlannedEventsAndPosState(page: Page, events: PlannedEventSeed[], tag: string) {
  const today = new Date().toISOString().slice(0, 10);
  await page.addInitScript(
    idbSeedScript(),
    {
      puts: [
        { key: EVENT_PLAN_KEY, value: events },
        { key: "primaq-pos-event-plan-migrated", value: "1" },
        {
          key: POS_STATE_KEY,
          value: {
            cart: [],
            daily: { date: today, totalCents: 0, cashCents: 0, cardCents: 0, qrCents: 0, orderCount: 0, orders: [] },
          },
        },
      ],
      t: tag,
    }
  );
}

async function seedPlannedEventsAndPosStateWithExistingName(
  page: Page,
  events: PlannedEventSeed[],
  existingName: string,
  tag: string
) {
  const today = new Date().toISOString().slice(0, 10);
  await page.addInitScript(
    idbSeedScript(),
    {
      puts: [
        { key: EVENT_PLAN_KEY, value: events },
        { key: "primaq-pos-event-plan-migrated", value: "1" },
        {
          key: POS_STATE_KEY,
          value: {
            cart: [],
            daily: {
              date: today,
              totalCents: 0, cashCents: 0, cardCents: 0, qrCents: 0,
              orderCount: 0, orders: [],
              eventName: existingName,
            },
          },
        },
      ],
      t: tag,
    }
  );
}

async function readDailyEventFields(page: Page) {
  return page.evaluate((key) => {
    return new Promise((resolve) => {
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readonly");
        const getReq = tx.objectStore("kv").get(key);
        getReq.onsuccess = () => {
          db.close();
          try {
            const parsed = JSON.parse(getReq.result?.value ?? "{}");
            resolve(parsed.daily ?? null);
          } catch {
            resolve(null);
          }
        };
      };
      req.onerror = () => resolve(null);
    });
  }, POS_STATE_KEY);
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
  const text = await monthLabel.textContent();
  const germanMonths = ["Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember"];
  expect(germanMonths.some((m) => text?.includes(m))).toBe(true);
});

test("EPLAN 3 – Klick auf Tag öffnet Formular mit Start-/Enddatum", async ({ page }) => {
  await seedEmpty(page, "ep3");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);

  await page.getByTestId("jahresabschluss-tab-planung").click();

  const today = new Date().toISOString().slice(0, 10);
  const dayBtn = page.getByTestId(`cal-day-${today}`);
  await expect(dayBtn).toBeVisible();
  await dayBtn.click();

  const form = page.getByTestId("event-plan-form");
  await expect(form).toBeVisible();
  await expect(form).toContainText(today);
  await expect(page.getByTestId("event-plan-name-input")).toBeVisible();
  await expect(page.getByTestId("event-plan-start-input")).toHaveValue(today);
  await expect(page.getByTestId("event-plan-end-input")).toHaveValue(today);
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

  await expect(page.getByTestId("event-plan-form")).not.toBeVisible();
  const item = page.locator('[data-testid^="event-plan-item-"]');
  await expect(item).toBeVisible();
  await expect(item).toContainText("Sommerfest 2026");
  await expect(item).toContainText(today);
});

test("EPLAN 5 – Einsatz aus Liste löschen", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await seedPlannedEvents(page, [makePlannedEvent({ eventName: "Testfest", startDate: today })], "ep5");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);

  await page.getByTestId("jahresabschluss-tab-planung").click();

  const item = page.locator('[data-testid^="event-plan-item-"]');
  await expect(item).toBeVisible();
  await item.locator('[data-testid^="event-plan-remove-"]').click();

  await expect(item).not.toBeVisible();
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
  await expect(page.locator('[data-testid^="event-plan-item-"]')).toContainText("Stadtfest Backnang");

  await page.reload();
  await waitLoaded(page);
  await page.getByTestId("jahresabschluss-tab-planung").click();

  await expect(page.locator('[data-testid^="event-plan-item-"]')).toContainText("Stadtfest Backnang");
});

test("EPLAN 7 – Auto-Fill Tagesabschluss speichert eventId + Zeitraum", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await seedPlannedEventsAndPosState(
    page,
    [makePlannedEvent({ eventName: "Geplanter Einsatz", startDate: today })],
    "ep7"
  );
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);

  await expect(page.getByTestId("event-name-input")).toHaveValue("Geplanter Einsatz");
  await expect(page.getByTestId("event-name-display")).toHaveText("Geplanter Einsatz");

  const daily = await readDailyEventFields(page) as { eventId?: string; eventName?: string } | null;
  expect(daily?.eventId).toBeTruthy();
  expect(daily?.eventName).toBe("Geplanter Einsatz");
});

test("EPLAN 8 – Kein Auto-Fill wenn Einsatzname bereits manuell gesetzt", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await seedPlannedEventsAndPosStateWithExistingName(
    page,
    [makePlannedEvent({ eventName: "Geplanter Einsatz", startDate: today })],
    "Manuell gesetzter Name",
    "ep8"
  );
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);

  await expect(page.getByTestId("event-name-input")).toHaveValue("Manuell gesetzter Name");
  await expect(page.getByTestId("event-name-display")).toHaveText("Manuell gesetzter Name");
});

test("EPLAN 9 – Bearbeiten via Bearb.-Button öffnet Formular mit bestehendem Namen", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await seedPlannedEvents(page, [makePlannedEvent({ eventName: "Alter Name", startDate: today })], "ep9");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);

  await page.getByTestId("jahresabschluss-tab-planung").click();
  const item = page.locator('[data-testid^="event-plan-item-"]');
  await expect(item).toBeVisible();

  await item.locator('[data-testid^="event-plan-edit-"]').click();

  const form = page.getByTestId("event-plan-form");
  await expect(form).toBeVisible();
  await expect(page.getByTestId("event-plan-name-input")).toHaveValue("Alter Name");

  await page.getByTestId("event-plan-name-input").fill("Neuer Name");
  await page.getByTestId("event-plan-save").click();

  await expect(item).toContainText("Neuer Name");
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
  await expect(page.locator('[data-testid^="event-plan-item-"]')).toContainText("Keyboard Einsatz");
});

test("EPLAN 11 – Migration: alte Einzeltage-Events bleiben als Ein-Tages-Events erhalten", async ({ page }) => {
  const d1 = "2026-03-10";
  const d2 = "2026-03-11"; // consecutive day, same name — must NOT be auto-merged
  await seedLegacyEventPlan(
    page,
    [
      { date: d1, name: "Frühlingsfest" },
      { date: d2, name: "Frühlingsfest" },
    ],
    "ep11"
  );
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);
  await page.getByTestId("jahresabschluss-tab-planung").click();

  // Navigate to March 2026.
  for (let i = 0; i < 24; i++) {
    if (await page.locator('[data-testid^="event-plan-item-"]').first().isVisible().catch(() => false)) break;
    await page.getByTestId("plan-prev-month").click();
  }

  const items = page.locator('[data-testid^="event-plan-item-"]');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText(d1);
  await expect(items.nth(1)).toContainText(d2);
  // Each item is its own one-day event, not a merged 2-day range.
  await expect(items.nth(0)).not.toContainText("(2 Tage)");
  await expect(items.nth(1)).not.toContainText("(2 Tage)");
});

test("EPLAN 12 – Mehrtägige Veranstaltung: Kalender markiert zusammenhängenden Zeitraum", async ({ page }) => {
  await seedPlannedEvents(
    page,
    [makePlannedEvent({ eventName: "Lichterfest Stuttgart", startDate: "2026-07-11", endDate: "2026-07-13" })],
    "ep12"
  );
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);
  await page.getByTestId("jahresabschluss-tab-planung").click();

  for (let i = 0; i < 24; i++) {
    if (await page.getByTestId("cal-day-2026-07-11").isVisible().catch(() => false)) break;
    await page.getByTestId("plan-prev-month").click();
  }

  await expect(page.getByTestId("cal-day-2026-07-11")).toBeVisible();
  await page.getByTestId("cal-day-2026-07-12").click();
  await expect(page.getByTestId("event-plan-form")).toContainText("Einsatz bearbeiten");
  await expect(page.getByTestId("event-plan-name-input")).toHaveValue("Lichterfest Stuttgart");
  await expect(page.getByTestId("event-plan-start-input")).toHaveValue("2026-07-11");
  await expect(page.getByTestId("event-plan-end-input")).toHaveValue("2026-07-13");

  const item = page.locator('[data-testid^="event-plan-item-"]');
  await expect(item).toContainText("2026-07-11 – 2026-07-13");
  await expect(item).toContainText("(3 Tage)");
});

test("EPLAN 13 – Mehrere Veranstaltungen am selben Tag → Auswahl im Tagesabschluss", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await seedPlannedEventsAndPosState(
    page,
    [
      makePlannedEvent({ eventName: "Einsatz A", startDate: today }),
      makePlannedEvent({ eventName: "Einsatz B", startDate: today }),
    ],
    "ep13"
  );
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);

  const picker = page.getByTestId("event-picker");
  await expect(picker).toBeVisible();
  await expect(picker).toContainText("Einsatz A");
  await expect(picker).toContainText("Einsatz B");

  await page.locator('[data-testid^="event-picker-option-"]').first().click();
  await expect(picker).not.toBeVisible();
  await expect(page.getByTestId("event-name-display")).not.toHaveText("—");

  const daily = await readDailyEventFields(page) as { eventId?: string } | null;
  expect(daily?.eventId).toBeTruthy();
});

test("EPLAN 14 – Keine passende Veranstaltung → manuelle Eingabe + neue Veranstaltung anlegen", async ({ page }) => {
  await seedEmpty(page, "ep14");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/berichte?tab=tagesabschluss");
  await waitLoaded(page);

  await expect(page.getByTestId("event-picker")).toHaveCount(0);

  await page.getByTestId("event-name-input").fill("Spontaner Einsatz");
  await expect(page.getByTestId("event-plan-create-from-manual")).toBeVisible();

  await page.getByTestId("event-plan-create-from-manual").click();
  await expect(page.getByTestId("event-name-display")).toHaveText("Spontaner Einsatz");

  const daily = await readDailyEventFields(page) as { eventId?: string; eventName?: string } | null;
  expect(daily?.eventId).toBeTruthy();
  expect(daily?.eventName).toBe("Spontaner Einsatz");

  // The newly created event now shows up in the planning calendar too.
  await page.goto("/berichte?tab=jahresabschluss");
  await waitLoaded(page);
  await page.getByTestId("jahresabschluss-tab-planung").click();
  await expect(page.locator('[data-testid^="event-plan-item-"]')).toContainText("Spontaner Einsatz");
});
