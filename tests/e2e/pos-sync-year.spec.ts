/**
 * Phase 2.4 – Jahresabschluss-Sync Tests
 *
 * Prüft:
 *   1 – saveDay erzeugt lokalen Jahresabschluss in IDB (primaq-pos-year-history)
 *   2 – saveDay erzeugt SyncQueue-Eintrag mit entity "pos_year_history"
 *   3 – Offline: Queue bleibt pending nach online-Event
 *   4 – Online: flush() schreibt nach Supabase und leert Queue
 *   5 – Supabase-Fehler: markFailed erhöht retryCount, Queue bleibt
 *   6 – Zwei Geräte: getrennte Queue-Einträge werden beide geflushd
 *   7 – Bestehende Jahresabschlussanzeige zeigt IDB-Daten korrekt
 *
 * Seeding-Strategie:
 *   – addInitScript löscht DB + setzt Admin vor erstem Seitenaufruf.
 *   – Nach dem ersten Seitenaufruf schreibt page.evaluate in die bereits
 *     angelegte DB (IDB v2-Schema vorhanden), dann Reload damit Stores neu lesen.
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

/** Connected everywhere except POST to pos_year_history → 422. */
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

// ── Page helpers ──────────────────────────────────────────────────────────────

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

// ── IDB helpers ───────────────────────────────────────────────────────────────

type RawSyncOp = {
  id: string; entity: string; operation: string; payload: string;
  deviceId: string; createdAt: string; retryCount: number; status: string;
};

async function countSyncQueue(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() =>
    new Promise<number>((resolve) => {
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("sync_queue")) { db.close(); resolve(0); return; }
        const tx = db.transaction("sync_queue", "readonly");
        const cnt = tx.objectStore("sync_queue").count();
        cnt.onsuccess = () => { db.close(); resolve(cnt.result); };
        cnt.onerror = () => { db.close(); resolve(0); };
      };
      req.onerror = () => resolve(0);
    })
  );
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

async function waitForQueueCount(
  page: import("@playwright/test").Page,
  target: number,
  timeout = 4000
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

/** Write pos-state with one order for today to an already-open DB. */
async function writePosState(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() =>
    new Promise<void>((resolve, reject) => {
      const today = new Date().toISOString().slice(0, 10);
      const state = {
        cart: [],
        daily: {
          date: today,
          totalCents: 250,
          cashCents: 250,
          cardCents: 0,
          qrCents: 0,
          orderCount: 1,
          orders: [{
            id: "yr-test-order",
            createdAt: new Date().toISOString(),
            items: [{ id: "yr-item", size: "klein", flavor: "vanilla", quantity: 1, unitPriceCents: 250 }],
            totalCents: 250,
            paymentMethod: "bar",
            dailyNumber: 1,
          }],
        },
      };
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put({ key: "primaq-pos-state", value: JSON.stringify(state) });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(new Error("write failed")); };
      };
      req.onerror = () => reject(new Error("open failed"));
    })
  );
}

/** Write a year history entry (one day) to an already-open DB. */
async function writeYearHistory(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() =>
    new Promise<void>((resolve, reject) => {
      const today = new Date().toISOString().slice(0, 10);
      const history = [{
        date: today,
        totalCents: 250,
        cashCents: 250,
        cardCents: 0,
        qrCents: 0,
        orderCount: 1,
        orders: [],
      }];
      const req = indexedDB.open("primaq-pos");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put({ key: "primaq-pos-year-history", value: JSON.stringify(history) });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(new Error("write failed")); };
      };
      req.onerror = () => reject(new Error("open failed"));
    })
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

/** Poll IDB until primaq-pos-year-history contains at least one entry. */
async function waitForYearHistory(
  page: import("@playwright/test").Page,
  timeout = 5000
): Promise<void> {
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open("primaq-pos");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("kv")) { db.close(); resolve(false); return; }
          const tx = db.transaction("kv", "readonly");
          const get = tx.objectStore("kv").get("primaq-pos-year-history");
          get.onsuccess = () => {
            db.close();
            const row = get.result as { value: string } | undefined;
            if (!row?.value) { resolve(false); return; }
            try {
              const arr = JSON.parse(row.value) as unknown[];
              resolve(arr.length > 0);
            } catch { resolve(false); }
          };
          get.onerror = () => { db.close(); resolve(false); };
        };
        req.onerror = () => resolve(false);
      }),
    undefined,
    { timeout }
  );
}

// ── Helper: navigate to Tagesabschluss, trigger saveDay via UI ────────────────

async function triggerSaveDayViaUI(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/tagesabschluss");
  await waitLoaded(page);
  await page.getByRole("button", { name: /Tagesdaten zurücksetzen/ }).click();
  await page.getByRole("button", { name: /Wirklich zurücksetzen/ }).click();
}

// ── Test 1: saveDay → lokaler Jahresabschluss ────────────────────────────────

test("Year 1: saveDay − lokaler Jahresabschluss in IDB geschrieben", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("yr1-seeded") === "1") return;
    window.sessionStorage.setItem("yr1-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);
  await writePosState(page);

  await triggerSaveDayViaUI(page);
  await waitForYearHistory(page);

  const history = await readYearHistory(page);
  expect(history).not.toBeNull();
  expect(history!.length).toBe(1);
  expect(history![0].totalCents).toBe(250);
  expect(history![0].date).toBe(new Date().toISOString().slice(0, 10));
});

// ── Test 2: saveDay → SyncQueue-Eintrag ──────────────────────────────────────

test("Year 2: saveDay − SyncQueue-Eintrag mit entity pos_year_history", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("yr2-seeded") === "1") return;
    window.sessionStorage.setItem("yr2-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);
  await writePosState(page);

  await triggerSaveDayViaUI(page);
  await waitForYearHistory(page);

  // Wait for the async enqueue to finish.
  await waitForQueueCount(page, 1);

  const ops = await readQueueOps(page);
  const yearOps = ops.filter((o) => o.entity === "pos_year_history");
  expect(yearOps).toHaveLength(1);
  expect(yearOps[0].operation).toBe("upsert");
  expect(yearOps[0].status).toBe("pending");
  expect(yearOps[0].retryCount).toBe(0);

  const payload = JSON.parse(yearOps[0].payload) as {
    businessId: string; date: string; summary: { totalCents: number };
  };
  expect(payload.businessId).toBe("default");
  expect(payload.date).toBe(new Date().toISOString().slice(0, 10));
  expect(payload.summary.totalCents).toBe(250);
});

// ── Test 3: Offline → Queue bleibt pending ───────────────────────────────────

test("Year 3: Offline − Queue bleibt nach online-Event erhalten", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("yr3-seeded") === "1") return;
    window.sessionStorage.setItem("yr3-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await putSyncOp(page, makeYearOp("yr3-op"));
  expect(await countSyncQueue(page)).toBe(1);

  // online event → flush() → OFFLINE (Supabase blocked) → skip
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(600);
  expect(await countSyncQueue(page)).toBe(1);
});

// ── Test 4: Online → flush schreibt pos_year_history ─────────────────────────

test("Year 4: Online − flush() schreibt nach Supabase und leert Queue", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("yr4-seeded") === "1") return;
    window.sessionStorage.setItem("yr4-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await page.goto("/verkauf");
  await waitLoaded(page);
  await writePosState(page);

  await triggerSaveDayViaUI(page);

  // Wait for enqueue to finish before flushing.
  await waitForQueueCount(page, 1);

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitForQueueCount(page, 0);
});

// ── Test 5: Supabase-Fehler → markFailed ─────────────────────────────────────

test("Year 5: Supabase-Fehler − markFailed erhöht retryCount", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("yr5-seeded") === "1") return;
    window.sessionStorage.setItem("yr5-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseYearError(page);

  // Register listener BEFORE goto so the log is not missed.
  // "[Sync] HealthCheck gelesen" fires at the end of init() — ensures the
  // NetworkMonitor subscription is active before we dispatch the online event.
  const initDone = page.waitForEvent("console", {
    predicate: (msg) => msg.text().includes("[Sync] HealthCheck gelesen"),
    timeout: 8000,
  });

  await page.goto("/verkauf");
  await waitLoaded(page);
  await initDone; // subscription is guaranteed to be active after this point

  // Put a queue op with a known id.
  await putSyncOp(page, makeYearOp("yr5-op"));
  expect(await countSyncQueue(page)).toBe(1);

  // flush() → CONNECTED → upsertYearHistory fails (422) → markFailed
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(800);

  // Op must still be in queue with retryCount incremented.
  const ops = await readQueueOps(page);
  const op = ops.find((o) => o.id === "yr5-op");
  expect(op).toBeDefined();
  expect(op!.retryCount).toBe(1);
  expect(op!.status).toBe("pending");
});

// ── Test 6: Zwei Geräte → beide geflushd ─────────────────────────────────────

test("Year 6: Zwei Geräte − getrennte Queue-Einträge werden beide geflusht", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("yr6-seeded") === "1") return;
    window.sessionStorage.setItem("yr6-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Two ops: same date, different device_ids.
  await putSyncOp(page, makeYearOp("yr6-op-a", "device-alpha"));
  await putSyncOp(page, makeYearOp("yr6-op-b", "device-beta"));
  expect(await countSyncQueue(page)).toBe(2);

  // flush() must process each op independently (no merge).
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitForQueueCount(page, 0);
});

// ── Test 7: Jahresabschlussanzeige unverändert ────────────────────────────────

test("Year 7: Jahresabschlussanzeige zeigt IDB-Daten korrekt", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("yr7-seeded") === "1") return;
    window.sessionStorage.setItem("yr7-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await page.goto("/verkauf");
  await waitLoaded(page);
  await writeYearHistory(page);

  await page.goto("/jahresabschluss");
  await waitLoaded(page);

  // Total for seeded day: 250 cents = 2,50 €
  await expect(page.getByText("2,50 €").first()).toBeVisible();
});
