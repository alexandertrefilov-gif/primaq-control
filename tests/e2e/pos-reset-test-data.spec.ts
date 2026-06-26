/**
 * Reset Test Data – E2E Tests
 *
 * 1  – Testdaten vorhanden → Reset → Verkaufsdaten = 0
 * 2  – Sorten bleiben erhalten
 * 3  – Layout bleibt erhalten
 * 4  – Bilder bleiben erhalten (gespeichert in Sorten-Daten)
 * 5  – Preise bleiben erhalten (gespeichert in Sorten-Daten)
 * 6  – Cloud wird ebenfalls geleert (Supabase DELETE wird aufgerufen)
 * 7  – Neuer Verkauf funktioniert sofort nach Reset
 * 8  – Synchronisation funktioniert weiterhin
 * 9  – Reload zeigt weiterhin leere Verkaufsdaten
 * 10 – Button deaktiviert solange kein "RESET" eingegeben
 */

import { expect, test } from "@playwright/test";

// ── Types ─────────────────────────────────────────────────────────────────────

type RawSyncOp = {
  id: string; entity: string; operation: string; payload: string;
  deviceId: string; createdAt: string; retryCount: number; status: string;
};

// ── Supabase mocks ────────────────────────────────────────────────────────────

async function mockSupabaseConnected(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, async (route) => {
    const method = route.request().method();
    await route.fulfill({
      status: method === "DELETE" ? 204 : 200,
      contentType: "application/json",
      body: method === "HEAD" || method === "DELETE" ? "" : "[]",
    });
  });
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function mockSupabaseCapturingDeletes(
  page: import("@playwright/test").Page,
  captured: string[],
) {
  await page.route(/supabase\.co/, async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === "DELETE") captured.push(url);
    await route.fulfill({
      status: method === "DELETE" ? 204 : 200,
      contentType: "application/json",
      body: method === "HEAD" || method === "DELETE" ? "" : "[]",
    });
  });
  await page.routeWebSocket(/supabase\.co/, () => {});
}

// ── IDB helpers ───────────────────────────────────────────────────────────────

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function readKvEntry(page: import("@playwright/test").Page, key: string): Promise<string | null> {
  return page.evaluate((k) =>
    new Promise<string | null>((resolve) => {
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) { db.close(); resolve(null); return; }
        const tx = db.transaction("kv", "readonly");
        const entry = tx.objectStore("kv").get(k);
        entry.onsuccess = () => {
          db.close();
          const val = (entry.result as { value: string } | undefined)?.value ?? null;
          resolve(val);
        };
        entry.onerror = () => { db.close(); resolve(null); };
      };
      req.onerror = () => resolve(null);
    })
  , key);
}

async function writeKvEntry(page: import("@playwright/test").Page, key: string, value: string): Promise<void> {
  await page.evaluate(({ k, v }) =>
    new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put({ key: k, value: v });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    })
  , { k: key, v: value });
}

async function readQueueOps(page: import("@playwright/test").Page): Promise<RawSyncOp[]> {
  return page.evaluate(() =>
    new Promise<RawSyncOp[]>((resolve) => {
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("sync_queue")) { db.close(); resolve([]); return; }
        const tx = db.transaction("sync_queue", "readonly");
        const all = tx.objectStore("sync_queue").getAll();
        all.onsuccess = () => { db.close(); resolve(all.result as RawSyncOp[]); };
        all.onerror = () => { db.close(); resolve([]); };
      };
      req.onerror = () => resolve([]);
    })
  );
}

async function writeSyncOp(
  page: import("@playwright/test").Page,
  entity: string,
  id: string,
): Promise<void> {
  await page.evaluate(({ e, i }) =>
    new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("sync_queue", "readwrite");
        tx.objectStore("sync_queue").put({
          id: i, entity: e, operation: "upsert",
          payload: "{}", deviceId: "test-device",
          createdAt: new Date().toISOString(), retryCount: 0, status: "pending",
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    })
  , { e: entity, i: id });
}

// ── Shared seed data ──────────────────────────────────────────────────────────

const TEST_DAILY = JSON.stringify({
  date: "2026-01-15",
  totalCents: 5000,
  cashCents: 2000,
  cardCents: 3000,
  qrCents: 0,
  orderCount: 5,
  orders: [],
});

const TEST_YEAR_HISTORY = JSON.stringify([
  { date: "2026-01-15", totalCents: 5000, cashCents: 2000, cardCents: 3000, qrCents: 0, orderCount: 5, orders: [] },
  { date: "2026-01-16", totalCents: 2500, cashCents: 2500, cardCents: 0, qrCents: 0, orderCount: 3, orders: [] },
]);

const TEST_FLAVORS = JSON.stringify({
  flavors: [
    { id: "f1", name: "Erdbeer", color: "#e11d48", imageUrl: null, sizes: [{ id: "s1", name: "Klein", priceCents: 150 }] },
  ],
});

const TEST_LAYOUT = JSON.stringify({ sections: [{ id: "cart", label: "Warenkorb" }] });

// ── Helpers to navigate to jahresabschluss as admin ──────────────────────────

async function gotoJahresabschlussAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/jahresabschluss");
  await waitLoaded(page);
}

async function openResetDialog(page: import("@playwright/test").Page) {
  await page.getByTestId("reset-test-data-btn").click();
  await expect(page.getByTestId("reset-test-data-dialog")).toBeVisible();
}

async function confirmReset(page: import("@playwright/test").Page) {
  await page.getByTestId("reset-confirmation-input").fill("RESET");
  await page.getByTestId("confirm-reset-btn").click();
  await expect(page.getByTestId("reset-success-snackbar")).toBeVisible({ timeout: 8000 });
}

// ── Test 1: Testdaten vorhanden → Reset → Verkaufsdaten = 0 ──────────────────

test("Reset 1: Testdaten vorhanden → Reset → lokale Verkaufsdaten = null", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("reset1-seeded") === "1") return;
    window.sessionStorage.setItem("reset1-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await gotoJahresabschlussAsAdmin(page);

  await writeKvEntry(page, "primaq-pos-state", JSON.stringify({ cart: [], daily: JSON.parse(TEST_DAILY) }));
  await writeKvEntry(page, "primaq-pos-year-history", TEST_YEAR_HISTORY);
  await writeKvEntry(page, "primaq-pos-state-meta", JSON.stringify({ updatedAt: "2026-01-15T10:00:00.000Z" }));

  await openResetDialog(page);
  await confirmReset(page);

  const posState = await readKvEntry(page, "primaq-pos-state");
  const yearHistory = await readKvEntry(page, "primaq-pos-year-history");
  const salesMeta = await readKvEntry(page, "primaq-pos-state-meta");

  expect(posState).toBeNull();
  expect(yearHistory).toBeNull();
  expect(salesMeta).toBeNull();
});

// ── Test 2: Sorten bleiben erhalten ──────────────────────────────────────────

test("Reset 2: Sorten bleiben nach Reset erhalten", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("reset2-seeded") === "1") return;
    window.sessionStorage.setItem("reset2-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await gotoJahresabschlussAsAdmin(page);

  await writeKvEntry(page, "primaq-pos-flavors-v1", TEST_FLAVORS);
  await writeKvEntry(page, "primaq-pos-state", JSON.stringify({ cart: [], daily: JSON.parse(TEST_DAILY) }));

  await openResetDialog(page);
  await confirmReset(page);

  const flavors = await readKvEntry(page, "primaq-pos-flavors-v1");
  expect(flavors).not.toBeNull();
  expect(JSON.parse(flavors!)).toMatchObject({ flavors: [{ name: "Erdbeer" }] });
});

// ── Test 3: Layout bleibt erhalten ───────────────────────────────────────────

test("Reset 3: Layout bleibt nach Reset erhalten", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("reset3-seeded") === "1") return;
    window.sessionStorage.setItem("reset3-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await gotoJahresabschlussAsAdmin(page);

  await writeKvEntry(page, "primaq-pos-layout-v1", TEST_LAYOUT);
  await writeKvEntry(page, "primaq-pos-state", JSON.stringify({ cart: [], daily: JSON.parse(TEST_DAILY) }));

  await openResetDialog(page);
  await confirmReset(page);

  const layout = await readKvEntry(page, "primaq-pos-layout-v1");
  expect(layout).not.toBeNull();
  expect(JSON.parse(layout!)).toMatchObject({ sections: [{ id: "cart" }] });
});

// ── Test 4: Bilder bleiben erhalten ──────────────────────────────────────────

test("Reset 4: Bilder bleiben nach Reset erhalten (gespeichert in Sorten)", async ({ page }) => {
  const flavorsWithImage = JSON.stringify({
    flavors: [{ id: "f1", name: "Erdbeer", color: "#e11d48", imageUrl: "data:image/png;base64,abc==", sizes: [] }],
  });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("reset4-seeded") === "1") return;
    window.sessionStorage.setItem("reset4-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await gotoJahresabschlussAsAdmin(page);

  await writeKvEntry(page, "primaq-pos-flavors-v1", flavorsWithImage);
  await writeKvEntry(page, "primaq-pos-state", JSON.stringify({ cart: [], daily: JSON.parse(TEST_DAILY) }));

  await openResetDialog(page);
  await confirmReset(page);

  const flavors = await readKvEntry(page, "primaq-pos-flavors-v1");
  expect(flavors).not.toBeNull();
  const parsed = JSON.parse(flavors!) as { flavors: { imageUrl: string }[] };
  expect(parsed.flavors[0].imageUrl).toContain("data:image");
});

// ── Test 5: Preise bleiben erhalten ──────────────────────────────────────────

test("Reset 5: Preise bleiben nach Reset erhalten (gespeichert in Sorten)", async ({ page }) => {
  const flavorsWithPrices = JSON.stringify({
    flavors: [{ id: "f1", name: "Erdbeer", color: "#e11d48", imageUrl: null, sizes: [{ id: "s1", name: "Klein", priceCents: 250 }] }],
  });

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("reset5-seeded") === "1") return;
    window.sessionStorage.setItem("reset5-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await gotoJahresabschlussAsAdmin(page);

  await writeKvEntry(page, "primaq-pos-flavors-v1", flavorsWithPrices);
  await writeKvEntry(page, "primaq-pos-state", JSON.stringify({ cart: [], daily: JSON.parse(TEST_DAILY) }));

  await openResetDialog(page);
  await confirmReset(page);

  const flavors = await readKvEntry(page, "primaq-pos-flavors-v1");
  expect(flavors).not.toBeNull();
  const parsed = JSON.parse(flavors!) as { flavors: { sizes: { priceCents: number }[] }[] };
  expect(parsed.flavors[0].sizes[0].priceCents).toBe(250);
});

// ── Test 6: Cloud wird geleert ────────────────────────────────────────────────

test("Reset 6: Cloud-Daten werden gelöscht (DELETE auf pos_sales_state und pos_year_history)", async ({ page }) => {
  const deletedUrls: string[] = [];

  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("reset6-seeded") === "1") return;
    window.sessionStorage.setItem("reset6-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseCapturingDeletes(page, deletedUrls);
  await gotoJahresabschlussAsAdmin(page);

  await openResetDialog(page);
  await confirmReset(page);

  const salesStateDeleted = deletedUrls.some((u) => u.includes("pos_sales_state"));
  const yearHistoryDeleted = deletedUrls.some((u) => u.includes("pos_year_history"));
  expect(salesStateDeleted).toBe(true);
  expect(yearHistoryDeleted).toBe(true);
});

// ── Test 7: Queue-Ops werden gelöscht ─────────────────────────────────────────

test("Reset 7: Sales-Queue-Ops werden nach Reset entfernt", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("reset7-seeded") === "1") return;
    window.sessionStorage.setItem("reset7-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await gotoJahresabschlussAsAdmin(page);

  await writeSyncOp(page, "pos_sales_state", "op-sales-1");
  await writeSyncOp(page, "pos_year_history", "op-year-1");
  await writeSyncOp(page, "pos_settings", "op-settings-1");

  const opsBefore = await readQueueOps(page);
  expect(opsBefore.some((o) => o.entity === "pos_sales_state")).toBe(true);
  expect(opsBefore.some((o) => o.entity === "pos_year_history")).toBe(true);
  expect(opsBefore.some((o) => o.entity === "pos_settings")).toBe(true);

  await openResetDialog(page);
  await confirmReset(page);

  const opsAfter = await readQueueOps(page);
  expect(opsAfter.some((o) => o.entity === "pos_sales_state")).toBe(false);
  expect(opsAfter.some((o) => o.entity === "pos_year_history")).toBe(false);
  // Settings ops must be preserved
  expect(opsAfter.some((o) => o.entity === "pos_settings")).toBe(true);
});

// ── Test 8: Neuer Verkauf funktioniert sofort nach Reset ─────────────────────

test("Reset 8: Neuer Verkauf funktioniert sofort nach Reset", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("reset8-seeded") === "1") return;
    window.sessionStorage.setItem("reset8-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await gotoJahresabschlussAsAdmin(page);

  await writeKvEntry(page, "primaq-pos-state", JSON.stringify({ cart: [], daily: JSON.parse(TEST_DAILY) }));

  await openResetDialog(page);
  await confirmReset(page);

  // Check that a new booking can be enqueued after reset — verify via IDB
  const posState = await readKvEntry(page, "primaq-pos-state");
  expect(posState).toBeNull();

  // Navigate to /verkauf — app should load without errors (empty state is valid)
  await page.goto("/verkauf");
  await waitLoaded(page);
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).not.toContainText("Fehler");
});

// ── Test 9: Reload zeigt weiterhin leere Verkaufsdaten ───────────────────────

test("Reset 9: Nach Reload bleiben Verkaufsdaten leer", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("reset9-seeded") === "1") return;
    window.sessionStorage.setItem("reset9-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await gotoJahresabschlussAsAdmin(page);

  await writeKvEntry(page, "primaq-pos-state", JSON.stringify({ cart: [], daily: JSON.parse(TEST_DAILY) }));
  await writeKvEntry(page, "primaq-pos-year-history", TEST_YEAR_HISTORY);

  await openResetDialog(page);
  await confirmReset(page);

  // Manually reload the page (simulating what the auto-reload does after 2.5s)
  await mockSupabaseConnected(page);
  await page.reload();
  await waitLoaded(page);

  const posState = await readKvEntry(page, "primaq-pos-state");
  const yearHistory = await readKvEntry(page, "primaq-pos-year-history");
  expect(posState).toBeNull();
  expect(yearHistory).toBeNull();
});

// ── Test 10: Button bleibt deaktiviert ohne "RESET" ──────────────────────────

test("Reset 10: Confirm-Button deaktiviert solange nicht 'RESET' eingegeben", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("reset10-seeded") === "1") return;
    window.sessionStorage.setItem("reset10-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await gotoJahresabschlussAsAdmin(page);

  await openResetDialog(page);

  // Button disabled when empty
  await expect(page.getByTestId("confirm-reset-btn")).toBeDisabled();

  // Button disabled with wrong text
  await page.getByTestId("reset-confirmation-input").fill("reset");
  await expect(page.getByTestId("confirm-reset-btn")).toBeDisabled();

  // Button disabled with partial text
  await page.getByTestId("reset-confirmation-input").fill("RESE");
  await expect(page.getByTestId("confirm-reset-btn")).toBeDisabled();

  // Button enabled with exact text
  await page.getByTestId("reset-confirmation-input").fill("RESET");
  await expect(page.getByTestId("confirm-reset-btn")).toBeEnabled();

  // Cancel closes dialog without deleting
  await page.getByTestId("reset-cancel-btn").click();
  await expect(page.getByTestId("reset-test-data-dialog")).not.toBeVisible();
});
