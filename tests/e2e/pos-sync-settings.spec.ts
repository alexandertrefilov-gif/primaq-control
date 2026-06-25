/**
 * Phase 3.0 – POS Settings Sync Tests
 *
 * Prüft:
 *   1 – Layout-Änderung (Preset) → pos_settings-Queue-Eintrag
 *   2 – Flush schreibt pos_settings nach Supabase
 *   3 – Pull übernimmt neuere Remote-Einstellungen (Last Write Wins)
 *   4 – Pull überschreibt keine lokal neueren Einstellungen
 *   5 – Offline: Settings-Queue-Eintrag bleibt erhalten
 *   6 – Manual Sync sendet Einstellungen (Einstellungen → Sync-Tab)
 *   7 – Bestehende POS-Funktionen unverändert
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

/**
 * Returns a settings row for primaq-pos-layout-v1 with the given updated_at.
 * Differentiates checkTables (limit=0) from pullSettings (no limit=0).
 */
async function mockSupabaseWithRemoteSettings(
  page: import("@playwright/test").Page,
  updatedAt: string,
  settingsData: unknown = { __testRemote: true },
  settingsKey = "primaq-pos-layout-v1",
) {
  const row = {
    id: `default:${settingsKey}`,
    business_id: "default",
    settings_key: settingsKey,
    data: settingsData,
    updated_at: updatedAt,
  };

  await page.route(/supabase\.co/, async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === "HEAD") {
      await route.fulfill({ status: 200 });
    } else if (url.includes("pos_settings") && !url.includes("limit=0")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([row]),
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

/** Read the raw value of an IDB kv entry. */
async function readKvEntry(page: import("@playwright/test").Page, key: string): Promise<unknown> {
  return page.evaluate(
    (k) =>
      new Promise<unknown>((resolve) => {
        const req = indexedDB.open("primaq-pos");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("kv")) { db.close(); resolve(null); return; }
          const tx = db.transaction("kv", "readonly");
          const get = tx.objectStore("kv").get(k);
          get.onsuccess = () => {
            db.close();
            const row = get.result as { value: string } | undefined;
            resolve(row?.value ? JSON.parse(row.value) as unknown : null);
          };
          get.onerror = () => { db.close(); resolve(null); };
        };
        req.onerror = () => resolve(null);
      }),
    key
  );
}

/** Write a kv entry directly to IDB (for seeding metadata). */
async function writeKvEntry(
  page: import("@playwright/test").Page,
  key: string,
  value: unknown
): Promise<void> {
  await page.evaluate(
    ([k, v]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("primaq-pos");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").put({ key: k, value: JSON.stringify(v) });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(new Error("write failed")); };
        };
        req.onerror = () => reject(new Error("open failed"));
      }),
    [key, value] as [string, unknown]
  );
}

function makeSettingsOp(id: string, settingsKey = "primaq-pos-layout-v1"): RawSyncOp {
  return {
    id,
    entity: "pos_settings",
    operation: "upsert",
    payload: JSON.stringify({
      businessId: "default",
      deviceId: "test-device",
      settingsKey,
      data: { __testData: true },
      updatedAt: new Date().toISOString(),
    }),
    deviceId: "test-device",
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: "pending",
  };
}

// ── Test 1: Layout-Änderung → Queue ──────────────────────────────────────────

test("Settings 1: Layout-Preset-Änderung erzeugt pos_settings-Queue-Eintrag", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("set1-seeded") === "1") return;
    window.sessionStorage.setItem("set1-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Navigate to Einstellungen → Verkaufsoberfläche tab → enable edit mode → apply preset
  await page.goto("/einstellungen");
  await waitLoaded(page);
  await page.getByRole("button", { name: "Verkaufsoberfläche" }).click();

  // Layout bearbeiten is locked by default — enable edit mode first
  await page.getByRole("button", { name: "Gesperrt" }).click();

  // Apply the iPad preset (triggers layout store update → enqueueSettingsSync)
  await expect(page.getByRole("button", { name: "iPad" })).toBeEnabled({ timeout: 3000 });
  await page.getByRole("button", { name: "iPad" }).click();

  // Wait for the async enqueue to land in the queue
  await waitForQueueCount(page, 1, 4000);

  const ops = await readQueueOps(page);
  const settingsOps = ops.filter((o) => o.entity === "pos_settings");
  expect(settingsOps.length).toBeGreaterThanOrEqual(1);

  const op = settingsOps[0];
  expect(op.operation).toBe("upsert");
  const payload = JSON.parse(op.payload) as {
    settingsKey: string;
    businessId: string;
    updatedAt: string;
  };
  expect(payload.settingsKey).toBe("primaq-pos-layout-v1");
  expect(payload.businessId).toBe("default");
  expect(payload.updatedAt).toBeTruthy();
});

// ── Test 2: Flush schreibt pos_settings ──────────────────────────────────────

test("Settings 2: Flush schreibt pos_settings-Op nach Supabase", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("set2-seeded") === "1") return;
    window.sessionStorage.setItem("set2-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await putSyncOp(page, makeSettingsOp("set2-op"));
  await waitForQueueCount(page, 1);

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitForQueueCount(page, 0, 5000);
});

// ── Test 3: Pull übernimmt neuere Remote-Einstellungen ────────────────────────

test("Settings 3: Pull übernimmt neuere Remote-Einstellungen (Last Write Wins)", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("set3-seeded") === "1") return;
    window.sessionStorage.setItem("set3-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });

  const remoteUpdatedAt = "2099-01-01T00:00:00.000Z";
  const remoteData = { active: { __remoteLayout: true, panels: [] }, profiles: [] };
  await mockSupabaseWithRemoteSettings(page, remoteUpdatedAt, remoteData);

  // Register init listener BEFORE goto
  const initDone = page.waitForEvent("console", {
    predicate: (msg) => msg.text().includes("[Sync] Init abgeschlossen"),
    timeout: 10000,
  });

  await page.goto("/verkauf");
  await waitLoaded(page);
  await initDone;

  const localLayout = await readKvEntry(page, "primaq-pos-layout-v1");
  expect(localLayout).not.toBeNull();
  expect((localLayout as { active?: { __remoteLayout?: boolean } }).active?.__remoteLayout).toBe(true);
});

// ── Test 4: Pull überschreibt keine lokal neueren Einstellungen ───────────────

test("Settings 4: Pull überschreibt keine lokal neueren Einstellungen", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("set4-seeded") === "1") return;
    window.sessionStorage.setItem("set4-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });

  const remoteUpdatedAt = "2020-01-01T00:00:00.000Z";
  const remoteData = { active: { __remoteLayout: true }, profiles: [] };
  await mockSupabaseWithRemoteSettings(page, remoteUpdatedAt, remoteData);

  const initDone = page.waitForEvent("console", {
    predicate: (msg) => msg.text().includes("[Sync] Init abgeschlossen"),
    timeout: 10000,
  });

  await page.goto("/verkauf");
  await waitLoaded(page);

  // Seed local metadata with a newer timestamp AFTER page load but BEFORE initDone
  // (IDB is bootstrapped, so we can write to it now)
  await writeKvEntry(page, "primaq-pos-layout-v1-meta", {
    updatedAt: "2099-12-31T23:59:59.000Z",
    deviceId: "local-device",
  });
  await writeKvEntry(page, "primaq-pos-layout-v1", { active: { __localLayout: true }, profiles: [] });

  await initDone;

  // Local data is newer than remote — pull must NOT overwrite
  const localLayout = await readKvEntry(page, "primaq-pos-layout-v1");
  expect((localLayout as { active?: { __localLayout?: boolean } }).active?.__localLayout).toBe(true);
});

// ── Test 5: Offline − Settings-Queue-Eintrag bleibt erhalten ──────────────────

test("Settings 5: Offline − pos_settings-Queue-Eintrag bleibt nach online-Event erhalten", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("set5-seeded") === "1") return;
    window.sessionStorage.setItem("set5-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await putSyncOp(page, makeSettingsOp("set5-op"));
  await waitForQueueCount(page, 1);

  // flush() → OFFLINE → skips, queue preserved
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(600);

  await waitForQueueCount(page, 1);
  const ops = await readQueueOps(page);
  expect(ops.find((o) => o.id === "set5-op")).toBeDefined();
});

// ── Test 6: Manual Sync sendet Einstellungen ──────────────────────────────────

test("Settings 6: Manual Sync (Einstellungen Sync-Tab) sendet Settings-Op", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("set6-seeded") === "1") return;
    window.sessionStorage.setItem("set6-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await putSyncOp(page, makeSettingsOp("set6-op"));
  await waitForQueueCount(page, 1);

  await page.goto("/einstellungen");
  await waitLoaded(page);
  await page.getByRole("button", { name: "Sync" }).click();
  await expect(page.getByTestId("manual-sync-btn")).toBeVisible();

  await page.getByTestId("manual-sync-btn").click();
  await waitForQueueCount(page, 0, 5000);
});

// ── Test 7: POS-Funktionen unverändert ────────────────────────────────────────

test("Settings 7: Bestehende POS-Funktionen bleiben unverändert", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("set7-seeded") === "1") return;
    window.sessionStorage.setItem("set7-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await mockSupabaseConnected(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByText("PrimaQ Control")).toBeVisible();

  await page.goto("/tagesabschluss");
  await waitLoaded(page);
  await expect(page.getByText(/Tagesabschluss/i).first()).toBeVisible();

  await expect(page.locator("body")).not.toContainText("Application error");
});
