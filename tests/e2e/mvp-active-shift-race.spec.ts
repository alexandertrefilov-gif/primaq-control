/**
 * FIX – Alter (bereits beendeter) Einsatz erscheint nach App-Neustart wieder als aktiv
 *
 * Ursache: resetCurrentShift()/deleteShift() setzen activeShift lokal sofort auf
 * null, synchronisieren das aber nur fire-and-forget in die Cloud (shift_state).
 * Wird die App vor Abschluss dieses Cloud-Syncs neu geladen, überschreibt der
 * unconditional Cloud-Load im Mount-Effect (loadShiftStateFromCloud) den korrekt
 * genullten lokalen Stand wieder mit dem alten, noch "aktiven" Einsatz aus der Cloud.
 *
 * Fix: shiftLocalAtKey ("primaq-shift-local-at"), analog zu machinesLocalAtKey/
 * inventoryLocalAtKey/settingsLocalAtKey — wird von startShift/resetCurrentShift/
 * deleteShift gesetzt und schützt den lokalen (neueren) Stand vor einem älteren
 * Cloud-Snapshot.
 *
 * RACE 1 – Beendeter Einsatz bleibt nach Reload trotz stale Cloud-Daten beendet
 * RACE 2 – Ohne lokalen Timestamp gewinnt ein echter, aktiver Cloud-Einsatz weiterhin
 * RACE 3 – Dashboard zeigt "Kein aktiver Einsatz" + Start-Button + Debug-Panel
 * RACE 4 – Zwei-Geräte-Konflikt: Gerät A beendet den Einsatz offline, Gerät B
 *          synced währenddessen (online, unwissend) seinen eigenen, weiterhin
 *          aktiven Stand ohne shiftWrittenAt in die Cloud zurück. Kommt Gerät A
 *          wieder online, darf der bereits beendete Einsatz NICHT erneut
 *          erscheinen — die Konfliktauflösung darf ausschließlich über
 *          shiftWrittenAt erfolgen, nicht über "wer zuletzt geschrieben hat".
 */

import { expect, test, type Page } from "@playwright/test";

const OLD_TS = "2025-01-01T00:00:00.000Z";
const NEW_TS = "2026-06-01T00:00:00.000Z";

const staleShift = {
  id: "shift_heilbronner_lichterfest",
  date: "2026-05-01",
  eventName: "Heilbronner Lichterfest",
  salesArea: "truck" as const,
  employees: ["Anna"],
  startingCashCents: 5000,
  createdAt: "2026-05-01T08:00:00.000Z"
};

function buildState(overrides: Record<string, unknown> = {}) {
  return {
    productConfigVersion: 4,
    machines: [],
    activeShift: null,
    transactions: [],
    dailySales: { orders: [] },
    completedOrders: [],
    consumptionEntries: [],
    mixStocks: {},
    stockFlavors: {},
    portionWeights: {},
    inventory: {},
    softServeItems: [],
    aromas: [],
    packagingSizes: {},
    productSettings: {},
    salesLayout: [],
    toppings: [],
    dayReport: null,
    reports: [],
    emergencyMode: {},
    emergencyModeLog: [],
    mixStockMovements: {},
    recipeTemplates: [],
    generalStock: {},
    generalStockMovements: {},
    inventoryMovements: {},
    materialCategories: [] as unknown[],
    materialItems: {},
    shiftMaterialAssignments: [],
    sumupSettings: { enabled: false, paymentLink: "", hintText: "" },
    favorites: [],
    ...overrides
  };
}

function seedScript({
  state,
  shiftLocalAt
}: {
  state: Record<string, unknown>;
  shiftLocalAt?: string;
}) {
  if (window.sessionStorage.getItem("primaq-shift-race-seeded") === "true") return;
  window.sessionStorage.setItem("primaq-shift-race-seeded", "true");
  window.localStorage.clear();
  window.localStorage.setItem("primaq-control-machines", JSON.stringify([]));
  window.localStorage.setItem("primaq-control-mvp-state", JSON.stringify(state));
  window.localStorage.setItem("primaq-control-open-orders", JSON.stringify([]));
  window.localStorage.setItem("primaq-control-active-order-id", JSON.stringify(null));
  window.localStorage.setItem("primaq-control-daily-sales", JSON.stringify({ orders: [] }));
  window.localStorage.setItem("primaq-control-completed-orders", JSON.stringify([]));
  if (shiftLocalAt) {
    window.localStorage.setItem("primaq-shift-local-at", shiftLocalAt);
  }
}

async function mockSupabase(page: Page, cloudShift: Record<string, unknown> | null) {
  await page.route(/supabase\.co/, async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes("/shift_state")) {
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ value: cloudShift })
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    // Alle anderen Tabellen (settings, inventory, sales_state …): leer.
    await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  });
  await page.routeWebSocket(/supabase\.co/, () => { /* deaktiviert */ });
}

async function waitLoaded(page: Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function readActiveShift(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("primaq-control-mvp-state");
    if (!raw) return null;
    return (JSON.parse(raw) as { activeShift?: unknown }).activeShift ?? null;
  });
}

test("RACE 1 – Beendeter Einsatz bleibt nach Reload trotz stale Cloud-Daten beendet", async ({ page }) => {
  // Lokal: Einsatz wurde bereits beendet (activeShift null), frischer Zeitstempel
  // — genau der Zustand, den resetCurrentShift()/deleteShift() jetzt erzeugen.
  const state = buildState({ activeShift: null });
  await page.addInitScript(seedScript, { state, shiftLocalAt: NEW_TS });

  // Cloud: hat den alten Einsatz noch als "aktiv", mit ÄLTEREM shiftWrittenAt
  // (Cloud-Sync von resetCurrentShift war beim simulierten Reload noch nicht fertig).
  await mockSupabase(page, {
    activeShift: staleShift,
    consumptionEntries: [],
    mixStocks: {},
    mixStockMovements: {},
    dayReport: null,
    shiftWrittenAt: OLD_TS
  });

  await page.goto("/dashboard");
  await waitLoaded(page);
  await page.waitForTimeout(1000); // genug Zeit für den Cloud-Load-Callback

  const activeShift = await readActiveShift(page);
  expect(activeShift).toBeNull();

  await expect(page.getByText("Kein aktiver Einsatz")).toBeVisible();
  await expect(page.getByText("Heilbronner Lichterfest")).not.toBeVisible();
});

test("RACE 2 – Ohne lokalen Zeitstempel gewinnt ein echter aktiver Cloud-Einsatz weiterhin", async ({ page }) => {
  // Kein shiftLocalAt gesetzt → das ist der Normalfall "noch nie lokal geändert"
  // (z. B. zweites Gerät, das den von Gerät 1 gestarteten Einsatz übernehmen soll).
  const state = buildState({ activeShift: null });
  await page.addInitScript(seedScript, { state });

  await mockSupabase(page, {
    activeShift: staleShift,
    consumptionEntries: [],
    mixStocks: {},
    mixStockMovements: {},
    dayReport: null,
    shiftWrittenAt: NEW_TS
  });

  await page.goto("/dashboard");
  await waitLoaded(page);
  await page.waitForTimeout(1000);

  const activeShift = await readActiveShift(page);
  expect((activeShift as { id?: string } | null)?.id).toBe(staleShift.id);
  await expect(page.getByText("Heilbronner Lichterfest")).toBeVisible();
});

test("RACE 3 – Dashboard zeigt Kein-aktiver-Einsatz-CTA und Debug-Panel korrekt", async ({ page }) => {
  const state = buildState({ activeShift: null });
  await page.addInitScript(seedScript, { state, shiftLocalAt: NEW_TS });
  await mockSupabase(page, null);

  await page.goto("/dashboard");
  await waitLoaded(page);

  await expect(page.getByTestId("start-new-shift-button")).toBeVisible();
  await expect(page.getByTestId("start-new-shift-button")).toHaveText(/Neuen Einsatz starten/);

  const debug = page.getByTestId("active-shift-debug");
  await expect(debug).toBeVisible();
  await expect(debug).toContainText("currentEventId:");
  await expect(debug).toContainText("currentEventStatus:");
  await expect(debug).toContainText("none");
  await expect(debug).toContainText("currentEventSource:");
});

// ── RACE 4 – Zwei-Geräte-Konflikt ────────────────────────────────────────────

/**
 * Simuliert eine gemeinsame Supabase-"Datenbank" (shift_state) über zwei
 * getrennte BrowserContexts hinweg: beide Mock-Handler lesen/schreiben
 * dasselbe cloudRowRef-Objekt. `opts.offline` simuliert ein Gerät ohne
 * Netzwerk (jeder Request schlägt fehl, wie im echten Offline-Fall).
 */
async function setupSharedShiftMock(
  page: Page,
  cloudRowRef: { current: Record<string, unknown> | null },
  opts: { offline: boolean }
) {
  await page.route(/supabase\.co/, async (route) => {
    if (opts.offline) {
      await route.abort();
      return;
    }

    const url = route.request().url();
    const method = route.request().method();

    if (!url.includes("/shift_state")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
      return;
    }

    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ value: cloudRowRef.current })
      });
      return;
    }

    if (method === "POST" || method === "PATCH") {
      try {
        const body = JSON.parse(route.request().postData() ?? "{}") as
          | { value?: Record<string, unknown> }
          | Array<{ value?: Record<string, unknown> }>;
        const bodyObj = Array.isArray(body) ? body[0] : body;
        if (bodyObj?.value && typeof bodyObj.value === "object") {
          cloudRowRef.current = bodyObj.value;
        }
      } catch { /* ignore */ }
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  });
  await page.routeWebSocket(/supabase\.co/, () => { /* deaktiviert */ });
}

test("RACE 4 – Gerät A beendet Einsatz offline, Gerät B synced weiter, Gerät A online → Einsatz bleibt beendet", async ({ browser }) => {
  // Gemeinsamer, mutierbarer "Cloud-Stand" — beide Geräte lasen/schrieben zuletzt
  // denselben aktiven Einsatz (shiftWrittenAt = OLD_TS).
  const cloudRowRef: { current: Record<string, unknown> | null } = {
    current: {
      activeShift: staleShift,
      consumptionEntries: [],
      mixStocks: {},
      mixStockMovements: {},
      dayReport: null,
      shiftWrittenAt: OLD_TS
    }
  };

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();

  // Beide Geräte kennen zu Beginn denselben aktiven Einsatz; keines hat bisher
  // selbst start/reset/delete lokal ausgeführt (kein shiftLocalAtKey gesetzt).
  const sharedInitialState = buildState({ activeShift: staleShift });
  await pageA.addInitScript(seedScript, { state: sharedInitialState });
  await pageB.addInitScript(seedScript, { state: sharedInitialState });

  // ── Schritt 1: Gerät A ist offline und beendet den Einsatz ─────────────────
  const offlineFlagA = { offline: true };
  await setupSharedShiftMock(pageA, cloudRowRef, offlineFlagA);
  await pageA.goto("/dashboard");
  await waitLoaded(pageA);

  // Entspricht exakt dem, was resetCurrentShift() bewirkt: activeShift -> null,
  // shiftLocalAtKey gesetzt. Der Cloud-Sync dazu schlägt fehl (Gerät A offline).
  const closedAt = new Date().toISOString();
  await pageA.evaluate((ts) => {
    const raw = window.localStorage.getItem("primaq-control-mvp-state");
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.activeShift = null;
    window.localStorage.setItem("primaq-control-mvp-state", JSON.stringify(parsed));
    window.localStorage.setItem("primaq-shift-local-at", ts);
  }, closedAt);

  expect(await readActiveShift(pageA)).toBeNull();
  // Cloud-Stand ist unverändert (weiterhin "aktiv"), weil Gerät A offline war.
  expect((cloudRowRef.current as { activeShift?: unknown } | null)?.activeShift).not.toBeNull();

  // ── Schritt 2: Gerät B ist online und arbeitet weiter, ohne von der ────────
  // Beendigung zu wissen. Schon das normale Laden von /dashboard löst über den
  // Hydration-Persist-Effekt (persistState → syncShiftStateToCloud) einen Sync
  // von B's – aus B's Sicht weiterhin aktivem – Stand aus, OHNE shiftWrittenAt
  // (B selbst hat nie start/reset/delete aufgerufen).
  await setupSharedShiftMock(pageB, cloudRowRef, { offline: false });
  await pageB.goto("/dashboard");
  await waitLoaded(pageB);
  await pageB.waitForTimeout(1000);

  expect((cloudRowRef.current as { activeShift?: { id?: string } } | null)?.activeShift?.id)
    .toBe(staleShift.id);
  expect((cloudRowRef.current as { shiftWrittenAt?: string } | null)?.shiftWrittenAt).toBeUndefined();

  // ── Schritt 3: Gerät A kommt wieder online (Reload) ────────────────────────
  offlineFlagA.offline = false;
  await pageA.reload();
  await waitLoaded(pageA);
  await pageA.waitForTimeout(1000);

  // Der zurückgekehrte, von B versehentlich reaktivierte Cloud-Stand (ohne
  // shiftWrittenAt) darf den bereits beendeten Einsatz auf Gerät A NICHT wieder
  // aufleben lassen — Gerät A's eigener shiftLocalAtKey ist weiterhin gesetzt
  // und gewinnt gegen einen Cloud-Stand ganz ohne Zeitstempel.
  expect(await readActiveShift(pageA)).toBeNull();
  await expect(pageA.getByText("Kein aktiver Einsatz")).toBeVisible();
  await expect(pageA.getByText("Heilbronner Lichterfest")).not.toBeVisible();

  await contextA.close();
  await contextB.close();
});
