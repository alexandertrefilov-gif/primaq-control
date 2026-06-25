/**
 * Phase 2.3 – Supabase Integration Foundation Tests
 *
 * Prüft:
 *   1 – Verbindung erfolgreich: mock HEAD 200 → "[Sync] Connected" im Console-Log
 *   2 – Verbindung fehlgeschlagen: blockSupabase → "[Sync] Offline" im Console-Log
 *   3 – HealthCheck schreiben: mock CONNECTED → "[Sync] HealthCheck geschrieben"
 *   4 – HealthCheck lesen: mock CONNECTED → "[Sync] HealthCheck gelesen"
 *   5 – Queue bleibt unverändert: OFFLINE + put op + online-Event → op bleibt in Queue
 *   6 – Offline verhält sich korrekt: blockSupabase → App läuft normal, kein Crash
 *
 * Console-Log-Erfassung: page.waitForEvent("console", ...) muss vor page.goto() registriert
 * sein, damit Events während des Ladens nicht verpasst werden.
 * Logs erscheinen nur in NODE_ENV=development (isDev-Guard in sync-service.ts).
 */

import { expect, test } from "@playwright/test";

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Aborts all Supabase requests → checkConnection returns OFFLINE. */
async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

/** Returns 200 for all Supabase requests → checkConnection returns CONNECTED. */
async function mockSupabaseConnected(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, async (route) => {
    const method = route.request().method();
    if (method === "HEAD") {
      await route.fulfill({ status: 200 });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    }
  });
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function readKvEntry(
  page: import("@playwright/test").Page,
  key: string
): Promise<string | null> {
  return page.evaluate(
    (k) =>
      new Promise<string | null>((resolve) => {
        const req = indexedDB.open("primaq-pos");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("kv")) { db.close(); resolve(null); return; }
          const tx = db.transaction("kv", "readonly");
          const get = tx.objectStore("kv").get(k);
          get.onsuccess = () => {
            db.close();
            resolve((get.result as { value: string } | undefined)?.value ?? null);
          };
          get.onerror = () => { db.close(); resolve(null); };
        };
        req.onerror = () => resolve(null);
      }),
    key
  );
}

type RawSyncOp = {
  id: string; entity: string; operation: string; payload: string;
  deviceId: string; createdAt: string; retryCount: number; status: string;
};

async function countSyncQueue(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(
    () =>
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

async function putSyncOp(
  page: import("@playwright/test").Page,
  op: RawSyncOp
): Promise<void> {
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

function makeSyncOp(id: string): RawSyncOp {
  return {
    id,
    entity: "pos_settings",
    operation: "upsert",
    payload: JSON.stringify({ test: id }),
    deviceId: "test-device",
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: "pending",
  };
}

// ── Test 1: Verbindung erfolgreich ────────────────────────────────────────────

test("Supabase 1: Verbindung erfolgreich − [Sync] Connected im Console-Log", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("sb1-seeded") === "1") return;
    window.sessionStorage.setItem("sb1-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);

  // Register listener BEFORE goto so events during page load are captured.
  const connectedLog = page.waitForEvent("console", {
    predicate: (msg) => msg.text().includes("[Sync] Connected"),
    timeout: 8000,
  });

  await page.goto("/verkauf");
  await waitLoaded(page);
  await connectedLog;
});

// ── Test 2: Verbindung fehlgeschlagen ─────────────────────────────────────────

test("Supabase 2: Verbindung fehlgeschlagen − [Sync] Offline im Console-Log", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("sb2-seeded") === "1") return;
    window.sessionStorage.setItem("sb2-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);

  const offlineLog = page.waitForEvent("console", {
    predicate: (msg) => msg.text().includes("[Sync] Offline"),
    timeout: 8000,
  });

  await page.goto("/verkauf");
  await waitLoaded(page);
  await offlineLog;
});

// ── Test 3: HealthCheck schreiben ─────────────────────────────────────────────

test("Supabase 3: HealthCheck schreiben − [Sync] HealthCheck geschrieben im Console-Log", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("sb3-seeded") === "1") return;
    window.sessionStorage.setItem("sb3-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);

  const writtenLog = page.waitForEvent("console", {
    predicate: (msg) => msg.text().includes("[Sync] HealthCheck geschrieben"),
    timeout: 8000,
  });

  await page.goto("/verkauf");
  await waitLoaded(page);
  await writtenLog;
});

// ── Test 4: HealthCheck lesen ─────────────────────────────────────────────────

test("Supabase 4: HealthCheck lesen − [Sync] HealthCheck gelesen im Console-Log", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("sb4-seeded") === "1") return;
    window.sessionStorage.setItem("sb4-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);

  const readLog = page.waitForEvent("console", {
    predicate: (msg) => msg.text().includes("[Sync] HealthCheck gelesen"),
    timeout: 8000,
  });

  await page.goto("/verkauf");
  await waitLoaded(page);
  await readLog;
});

// ── Test 5: Queue bleibt unverändert bei Offline ──────────────────────────────

test("Supabase 5: Queue bleibt unverändert − offline flush() überspringt Queue", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("sb5-seeded") === "1") return;
    window.sessionStorage.setItem("sb5-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await putSyncOp(page, makeSyncOp("sb5-op"));
  expect(await countSyncQueue(page)).toBe(1);

  // online event → flush() → checkConnection aborted → OFFLINE → skip.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(600);

  // Op must still be in queue (not acked).
  expect(await countSyncQueue(page)).toBe(1);
});

// ── Test 6: App läuft normal offline ─────────────────────────────────────────

test("Supabase 6: Offline − App läuft normal, kein Crash, deviceId in IDB", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("sb6-seeded") === "1") return;
    window.sessionStorage.setItem("sb6-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // deviceId is written before checkConnection() — must exist even when offline.
  const deviceId = await readKvEntry(page, "primaq-device-id");
  expect(deviceId).not.toBeNull();
  expect(deviceId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );

  // Reload must not crash — app remains stable.
  await page.reload();
  await waitLoaded(page);

  const deviceIdAfterReload = await readKvEntry(page, "primaq-device-id");
  expect(deviceIdAfterReload).toBe(deviceId);
});
