/**
 * Phase 2.5 – Sync Hardening Tests
 *
 * Prüft:
 *   1 – Offline: SyncStatus-Pill zeigt "Offline"
 *   2 – Retry: markFailed erhöht retryCount nach fehlgeschlagenem Flush
 *   3 – Failed: retryCount ≥ 3 → status "failed"
 *   4 – Manual Sync Button: flush() leert Queue
 *   5 – SyncPanel: zeigt pendingCount korrekt
 *   6 – Pull: ergänzt fehlende Jahresdaten aus Supabase (lokale Daten nicht überschreiben)
 *   7 – POS-Funktionen: Verkauf und Navigation unverändert
 */

import { expect, test } from "@playwright/test";

// ── Supabase-Mocks ────────────────────────────────────────────────────────────

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function mockSupabaseConnected(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: route.request().method() === "HEAD" ? "" : "[]",
    });
  });
  await page.routeWebSocket(/supabase\.co/, () => {});
}

/** Connected, but upsert to pos_year_history fails with 422. */
async function mockSupabaseYearError(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === "HEAD") {
      await route.fulfill({ status: 200 });
    } else if (method === "POST" && url.includes("pos_year_history")) {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ code: "PGRST116", message: "Test-Fehler", details: null }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
  });
  await page.routeWebSocket(/supabase\.co/, () => {});
}

/**
 * Connected, but GET to pos_year_history (pull) returns one remote row.
 * Differentiates checkTables (limit=0) from pullYearHistory (no limit=0).
 */
async function mockSupabaseWithRemoteYearData(
  page: import("@playwright/test").Page
) {
  const remoteRow = {
    id: "default:remote-device:2026-06-01",
    business_id: "default",
    device_id: "remote-device",
    date: "2026-06-01",
    summary: {
      date: "2026-06-01",
      totalCents: 1500,
      cashCents: 1500,
      cardCents: 0,
      qrCents: 0,
      orderCount: 3,
      orders: [],
    },
  };

  await page.route(/supabase\.co/, async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === "HEAD") {
      await route.fulfill({ status: 200 });
    } else if (url.includes("pos_year_history") && !url.includes("limit=0")) {
      // pullYearHistory: return one remote row
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([remoteRow]),
      });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
  });
  await page.routeWebSocket(/supabase\.co/, () => {});
}

// ── Page helpers ──────────────────────────────────────────────────────────────

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

// ── IDB helpers ───────────────────────────────────────────────────────────────

type RawSyncOp = {
  id: string; entity: string; operation: string; payload: string;
  deviceId: string; createdAt: string; retryCount: number; status: string;
};

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

async function putSyncOp(page: import("@playwright/test").Page, op: RawSyncOp): Promise<void> {
  await page.evaluate(
    (o) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("primaq-pos");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("sync_queue", "readwrite");
          tx.objectStore("sync_queue").put(o);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(new Error("put failed")); };
        };
        req.onerror = () => reject(new Error("open failed"));
      }),
    op
  );
}

async function waitForQueueCount(
  page: import("@playwright/test").Page,
  target: number,
  timeout = 5000
): Promise<void> {
  await page.waitForFunction(
    (t) =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open("primaq-pos");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("sync_queue")) { db.close(); resolve(t === 0); return; }
          const tx = db.transaction("sync_queue", "readonly");
          const cnt = tx.objectStore("sync_queue").count();
          cnt.onsuccess = () => { db.close(); resolve(cnt.result === t); };
          cnt.onerror = () => { db.close(); resolve(false); };
        };
        req.onerror = () => resolve(false);
      }),
    target,
    { timeout }
  );
}

type YearEntry = { date: string; totalCents: number };

async function readYearHistory(page: import("@playwright/test").Page): Promise<YearEntry[] | null> {
  return page.evaluate(() =>
    new Promise<YearEntry[] | null>((resolve) => {
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) { db.close(); resolve(null); return; }
        const tx = db.transaction("kv", "readonly");
        const get = tx.objectStore("kv").get("primaq-pos-year-history");
        get.onsuccess = () => {
          db.close();
          const row = get.result as { value: string } | undefined;
          resolve(row?.value ? (JSON.parse(row.value) as YearEntry[]) : null);
        };
        get.onerror = () => { db.close(); resolve(null); };
      };
      req.onerror = () => resolve(null);
    })
  );
}

function makeYearOp(id: string, deviceId = "test-device"): RawSyncOp {
  return {
    id,
    entity: "pos_year_history",
    operation: "upsert",
    payload: JSON.stringify({
      businessId: "default",
      deviceId,
      date: new Date().toISOString().slice(0, 10),
      summary: {
        date: new Date().toISOString().slice(0, 10),
        totalCents: 250,
        cashCents: 250,
        cardCents: 0,
        qrCents: 0,
        orderCount: 1,
        orders: [],
      },
    }),
    deviceId,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: "pending",
  };
}

// ── Test 1: SyncStatus zeigt "Offline" ───────────────────────────────────────

test("Hard 1: SyncStatus-Pill zeigt 'Offline' wenn Supabase nicht erreichbar", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("hard1-seeded") === "1") return;
    window.sessionStorage.setItem("hard1-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const pill = page.getByTestId("sync-status-pill");
  await expect(pill).toBeVisible({ timeout: 3000 });
  await expect(pill).toHaveText("Offline");
});

// ── Test 2: Retry-Zähler steigt nach fehlgeschlagenem Flush ──────────────────

test("Hard 2: Retry − retryCount steigt nach fehlgeschlagenem Flush", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("hard2-seeded") === "1") return;
    window.sessionStorage.setItem("hard2-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseYearError(page);

  const initDone = page.waitForEvent("console", {
    predicate: (msg) => msg.text().includes("[Sync] Init abgeschlossen"),
    timeout: 8000,
  });

  await page.goto("/verkauf");
  await waitLoaded(page);
  await initDone;

  await putSyncOp(page, makeYearOp("hard2-op"));

  const flushDone = page.waitForEvent("console", {
    predicate: (msg) => msg.text().includes("[Sync] Flush beendet"),
    timeout: 5000,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await flushDone;

  const ops = await readQueueOps(page);
  const op = ops.find((o) => o.id === "hard2-op");
  expect(op).toBeDefined();
  expect(op!.retryCount).toBe(1);
  expect(op!.status).toBe("pending");
});

// ── Test 3: Failed-Status nach 3 fehlgeschlagenen Versuchen ──────────────────

test("Hard 3: Failed − op.status wird 'failed' nach 3 fehlgeschlagenen Flushes", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("hard3-seeded") === "1") return;
    window.sessionStorage.setItem("hard3-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseYearError(page);

  const initDone = page.waitForEvent("console", {
    predicate: (msg) => msg.text().includes("[Sync] Init abgeschlossen"),
    timeout: 8000,
  });

  await page.goto("/verkauf");
  await waitLoaded(page);
  await initDone;

  await putSyncOp(page, makeYearOp("hard3-op"));

  // 3 flush attempts — each one calls markFailed once.
  for (let i = 0; i < 3; i++) {
    const flushDone = page.waitForEvent("console", {
      predicate: (msg) => msg.text().includes("[Sync] Flush beendet"),
      timeout: 5000,
    });
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await flushDone;
  }

  const ops = await readQueueOps(page);
  const op = ops.find((o) => o.id === "hard3-op");
  expect(op).toBeDefined();
  expect(op!.retryCount).toBe(3);
  expect(op!.status).toBe("failed");
});

// ── Test 4: Manual Sync Button leert Queue ────────────────────────────────────

test("Hard 4: Manual Sync − 'Jetzt synchronisieren' leert die Queue", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("hard4-seeded") === "1") return;
    window.sessionStorage.setItem("hard4-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await putSyncOp(page, makeYearOp("hard4-op"));
  await waitForQueueCount(page, 1);

  await page.goto("/einstellungen");
  await waitLoaded(page);

  // Open Sync tab
  await page.getByRole("button", { name: "Sync" }).click();
  await expect(page.getByTestId("manual-sync-btn")).toBeVisible();

  // Click manual sync
  await page.getByTestId("manual-sync-btn").click();

  // Queue must empty after flush
  await waitForQueueCount(page, 0);
});

// ── Test 5: SyncPanel zeigt pendingCount ─────────────────────────────────────

test("Hard 5: SyncPanel − zeigt pending-Anzahl korrekt", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("hard5-seeded") === "1") return;
    window.sessionStorage.setItem("hard5-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Put 2 pending ops
  await putSyncOp(page, makeYearOp("hard5-op-a"));
  await putSyncOp(page, makeYearOp("hard5-op-b"));

  await page.goto("/einstellungen");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Sync" }).click();

  // The sync panel is rendered; flush() on open reads stats.
  // Manual sync is blocked by offline, but panel stats should reflect queue.
  const manualBtn = page.getByTestId("manual-sync-btn");
  await expect(manualBtn).toBeVisible();

  // Click to trigger a flush (which refreshes stats even if offline)
  await manualBtn.click();
  await page.waitForTimeout(600);

  // After offline flush attempt, panel shows pending count = 2
  await expect(page.getByTestId("pending-count-value")).toHaveText("2");
});

// ── Test 6: Pull ergänzt fehlende Jahresdaten ────────────────────────────────

test("Hard 6: Pull − ergänzt fehlende Jahresdaten aus Supabase", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("hard6-seeded") === "1") return;
    window.sessionStorage.setItem("hard6-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseWithRemoteYearData(page);

  // Register listener BEFORE goto so the init log is not missed.
  const initDone = page.waitForEvent("console", {
    predicate: (msg) => msg.text().includes("[Sync] Init abgeschlossen"),
    timeout: 10000,
  });

  await page.goto("/verkauf");
  await waitLoaded(page);
  await initDone;

  // pull() should have written the remote row to local IDB.
  const history = await readYearHistory(page);
  expect(history).not.toBeNull();
  const pulled = history!.find((d) => d.date === "2026-06-01");
  expect(pulled).toBeDefined();
  expect(pulled!.totalCents).toBe(1500);
});

// ── Test 7: POS-Funktionen unverändert ───────────────────────────────────────

test("Hard 7: POS-Funktionen − Verkauf und Navigation sind unverändert", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("hard7-seeded") === "1") return;
    window.sessionStorage.setItem("hard7-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Header and brand name must be visible
  await expect(page.getByText("PrimaQ Control")).toBeVisible();

  // Navigate to Tagesabschluss
  await page.goto("/tagesabschluss");
  await waitLoaded(page);
  await expect(page.getByText(/Tagesabschluss/i).first()).toBeVisible();

  // App is stable (no crash / error page)
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).not.toContainText("TypeError");
});
