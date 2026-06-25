/**
 * Phase 2.2 – SyncService Tests
 *
 * Prüft:
 *   1 – SyncService startet: start() initialisiert DeviceRegistry (deviceId in IDB).
 *   2 – SyncService stoppt sauber: stop()+start()-Zyklus (Reload) lässt Service korrekt neu starten.
 *   3 – flush() liest Queue: nach online-Event werden ausstehende Ops gelesen.
 *   4 – flush() leert Queue: Simulationsmodus ack()t alle Ops → Queue leer.
 *   5 – online-Event startet flush(): window.dispatchEvent("online") → Queue wird geflusht.
 *   6 – offline-Event startet keinen flush(): window.dispatchEvent("offline") → Queue bleibt.
 *
 * Alle Tests verwenden raw-IDB-Zugriff, kein direkter Import der Sync-Module.
 * SyncService läuft produktiv über SyncFoundation (im Root-Layout eingebunden).
 */

import { expect, test } from "@playwright/test";

// ── Shared helpers ────────────────────────────────────────────────────────────

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
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

async function deleteSyncOps(
  page: import("@playwright/test").Page,
  ids: string[]
): Promise<void> {
  await page.evaluate(
    (idsToDelete) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("primaq-pos");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("sync_queue", "readwrite");
          for (const id of idsToDelete) tx.objectStore("sync_queue").delete(id);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(new Error("delete failed")); };
        };
        req.onerror = () => reject(new Error("open failed"));
      }),
    ids
  );
}

/** Wait until sync_queue has exactly `target` ops (polls IDB). */
async function waitForQueueCount(
  page: import("@playwright/test").Page,
  target: number,
  timeout = 3000
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

// ── Test 1: SyncService startet ───────────────────────────────────────────────

test("SyncService 1: start() − DeviceId wird beim App-Start in IDB geschrieben", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("ss1-seeded") === "1") return;
    window.sessionStorage.setItem("ss1-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // SyncFoundation → getSyncService().start() → init() → getDeviceId() writes to IDB.
  const deviceId = await readKvEntry(page, "primaq-device-id");
  expect(deviceId).not.toBeNull();
  expect(deviceId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
});

// ── Test 2: SyncService stoppt sauber ─────────────────────────────────────────

test("SyncService 2: stop()+start()-Zyklus − Service arbeitet nach Reload korrekt", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("ss2-seeded") === "1") return;
    window.sessionStorage.setItem("ss2-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  const id1 = await readKvEntry(page, "primaq-device-id");
  expect(id1).not.toBeNull();

  // Reload triggers: SyncFoundation unmount (stop) + mount (start) fresh.
  await page.reload();
  await waitLoaded(page);

  // DeviceId must be stable after stop+start cycle.
  const id2 = await readKvEntry(page, "primaq-device-id");
  expect(id2).toBe(id1);

  // Service must accept a flush after restart (online event triggers it).
  await putSyncOp(page, makeSyncOp("ss2-op"));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitForQueueCount(page, 0);
});

// ── Test 3: flush() liest Queue ───────────────────────────────────────────────

test("SyncService 3: flush() − liest ausstehende Ops aus der Queue", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("ss3-seeded") === "1") return;
    window.sessionStorage.setItem("ss3-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Place 3 ops in the queue.
  await putSyncOp(page, makeSyncOp("ss3-op-a"));
  await putSyncOp(page, makeSyncOp("ss3-op-b"));
  await putSyncOp(page, makeSyncOp("ss3-op-c"));

  const countBefore = await countSyncQueue(page);
  expect(countBefore).toBe(3);

  // Trigger flush via online event (proves flush() reads the queue).
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  // Queue should be empty after flush() read and acked all ops.
  await waitForQueueCount(page, 0);
});

// ── Test 4: flush() leert Queue (Simulationsmodus) ───────────────────────────

test("SyncService 4: flush() − leert Queue vollständig im Simulationsmodus", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("ss4-seeded") === "1") return;
    window.sessionStorage.setItem("ss4-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await putSyncOp(page, makeSyncOp("ss4-op-1"));
  await putSyncOp(page, makeSyncOp("ss4-op-2"));

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitForQueueCount(page, 0);

  // A second flush on an already-empty queue must be a no-op (no crash).
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitForQueueCount(page, 0);
});

// ── Test 5: online-Event startet flush() ─────────────────────────────────────

test("SyncService 5: window.online-Event − startet flush() und leert Queue", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("ss5-seeded") === "1") return;
    window.sessionStorage.setItem("ss5-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await putSyncOp(page, makeSyncOp("ss5-op"));
  expect(await countSyncQueue(page)).toBe(1);

  // online event → NetworkMonitor fires listener → SyncService.flush() called.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitForQueueCount(page, 0);
});

// ── Test 6: offline-Event startet keinen flush() ─────────────────────────────

test("SyncService 6: window.offline-Event − startet keinen flush()", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("ss6-seeded") === "1") return;
    window.sessionStorage.setItem("ss6-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await putSyncOp(page, makeSyncOp("ss6-op"));
  expect(await countSyncQueue(page)).toBe(1);

  // offline event must NOT trigger flush.
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  // Wait longer than the flush would take to ensure nothing happened.
  await page.waitForTimeout(400);
  expect(await countSyncQueue(page)).toBe(1);

  // Cleanup: trigger flush via online event to leave queue clean.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitForQueueCount(page, 0);
});
