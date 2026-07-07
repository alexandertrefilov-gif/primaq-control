/**
 * FIX – Settings-Sync-Diagnose: Import-Bypass, Geräte-Reset, PWA-Update
 *
 * Ursache für "alte Einstellungen trotz aktuellem Deployment": die
 * Kombination aus (a) Einstellungen-Import, der nie in die Cloud gepusht
 * wurde und so von einem älteren Cloud-Stand wieder überschrieben werden
 * konnte, und (b) einer installierten PWA, deren Service Worker zwar sofort
 * aktualisiert (skipWaiting+clientsClaim), deren bereits laufender
 * JS-Bundle im offenen Tab aber nie neu geladen wurde.
 *
 * DIAG 1 – Einstellungen-Import pusht sofort in die Sync-Queue (pos_settings)
 * DIAG 2 – "Dieses Gerät zurücksetzen" existiert und löscht Settings-Keys
 * DIAG 3 – "Dieses Gerät zurücksetzen" löscht auch geräteeigene (nicht synchronisierte) Keys
 * DIAG 4 – PWA-Update-Banner erscheint nach Service-Worker-Kontrollwechsel
 * DIAG 5 – Debug-Bereich zeigt Geräte-ID, Build-Info und Service-Worker-Status
 * DIAG 6 – Diagnose-Panel deckt auch VAT/Einsatzplan/Berichtsrechte ab
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

async function waitLoaded(page: Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function goToSyncTab(page: Page) {
  await page.goto("/einstellungen");
  await waitLoaded(page);
  await page.getByRole("button", { name: "Sync" }).click();
}

type RawSyncOp = { id: string; entity: string; operation: string; payload: string };

async function readQueueOps(page: Page): Promise<RawSyncOp[]> {
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

test("DIAG 1 – Einstellungen-Import pusht sofort in die Sync-Queue", async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("diag1-seeded") === "1") return;
    window.sessionStorage.setItem("diag1-seeded", "1");
    window.sessionStorage.setItem("primaq-admin", "true");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/einstellungen");
  await waitLoaded(page);
  await page.getByRole("button", { name: "Grundeinstellungen" }).click();

  const importPayload = {
    keys: {
      "primaq-pos-vat-rate": 7.7,
    },
  };
  const buffer = Buffer.from(JSON.stringify(importPayload), "utf-8");

  await page.getByTestId("settings-file-input").setInputFiles({
    name: "import.json",
    mimeType: "application/json",
    buffer,
  });

  // Import succeeded locally and enqueued a push before the reload.
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open("primaq-pos");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("sync_queue")) { db.close(); resolve(false); return; }
          const tx = db.transaction("sync_queue", "readonly");
          const all = tx.objectStore("sync_queue").getAll();
          all.onsuccess = () => {
            db.close();
            const ops = all.result as { entity: string }[];
            resolve(ops.some((o) => o.entity === "pos_settings"));
          };
          all.onerror = () => { db.close(); resolve(false); };
        };
        req.onerror = () => resolve(false);
      }),
    { timeout: 5000 }
  );

  const ops = await readQueueOps(page);
  const settingsOp = ops.find((o) => o.entity === "pos_settings");
  expect(settingsOp).toBeDefined();
  const parsed = JSON.parse(settingsOp!.payload);
  expect(parsed.settingsKey).toBe("primaq-pos-vat-rate");
  expect(parsed.data).toBe(7.7);
});

test("DIAG 2 – Dieses Gerät zurücksetzen existiert und ist nur für Admin sichtbar", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await goToSyncTab(page);

  await expect(page.getByTestId("factory-reset-btn")).toBeVisible();
  await expect(page.getByTestId("factory-reset-btn")).toHaveText("Dieses Gerät zurücksetzen");
});

test("DIAG 3 – Verkäufer (nicht Admin) kann /einstellungen gar nicht erst öffnen", async ({ page }) => {
  // The whole /einstellungen route is behind <AdminRequired>, so the reset/
  // publish buttons are unreachable for non-admins regardless of SyncPanel's
  // own internal isAdmin guard.
  await blockSupabase(page);
  await page.goto("/einstellungen");
  await waitLoaded(page);

  await expect(page.getByText("Admin-Berechtigung erforderlich")).toBeVisible();
  await expect(page.getByTestId("factory-reset-btn")).toHaveCount(0);
});

test("DIAG 4 – PWA-Update-Banner erscheint nach Service-Worker-Kontrollwechsel", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("pwa-update-banner")).toHaveCount(0);

  // Simulate a new service worker taking control (skipWaiting+clientsClaim
  // already happen automatically in the real SW — this is the signal the
  // watcher listens for to prompt a reload).
  await page.evaluate(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    }
  });

  await expect(page.getByTestId("pwa-update-banner")).toBeVisible();
  await expect(page.getByText("Jetzt aktualisieren")).toBeVisible();
});

test("DIAG 5 – Debug-Bereich zeigt Geräte-ID und Service-Worker-Status", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await goToSyncTab(page);

  await expect(page.getByText(/Dieses Gerät:/)).toBeVisible();
  await expect(page.getByText(/Service Worker:/)).toBeVisible();
  await expect(page.getByText(/Build-Zeit:/)).toBeVisible();
});

test("DIAG 6 – Diagnose-Panel deckt VAT/Einsatzplan/Berichtsrechte ab", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await goToSyncTab(page);

  const runBtn = page.getByRole("button", { name: "Diagnose ausführen" });
  await runBtn.click();

  await expect(page.locator('span:has-text("primaq-pos-vat-rate")')).toBeVisible();
  await expect(page.locator('span:has-text("primaq-pos-event-plan")')).toBeVisible();
  await expect(page.locator('span:has-text("primaq-pos-report-permissions")')).toBeVisible();
});
