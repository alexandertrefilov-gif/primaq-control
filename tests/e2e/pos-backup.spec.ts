/**
 * Backup / Restore + Einstellungs-Export / Import
 *
 * Prüft:
 *   A – Settings-Export-Button und Backup-Export-Button sind auf /einstellungen sichtbar.
 *   B – Backup-Import stellt pos-state inkl. Tagesumsatz korrekt wieder her.
 *   C – Settings-Import (Einstellungen ohne pos-state) lässt pos-state unberührt.
 *
 * Wichtig: addInitScript läuft auf JEDEM Reload, auch dem nach Import.
 * → DB-Löschung mit sessionStorage-Guard absichern, damit importierte Daten
 *   den Reload überleben.
 */

import { expect, test } from "@playwright/test";

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function readPosState(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    return new Promise<{ daily: { totalCents: number; cashCents: number; orderCount: number } } | null>(
      (resolve) => {
        const req = indexedDB.open("primaq-pos");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("kv")) { db.close(); resolve(null); return; }
          const tx = db.transaction("kv", "readonly");
          const get = tx.objectStore("kv").get("primaq-pos-state");
          get.onsuccess = () => {
            const row = get.result as { value: string } | undefined;
            db.close();
            resolve(row?.value ? JSON.parse(row.value) : null);
          };
          get.onerror = () => { db.close(); resolve(null); };
        };
        req.onerror = () => resolve(null);
      }
    );
  });
}

// ── Test A: Transfer-Panel ist sichtbar ──────────────────────────────────────

test("Backup A: Export- und Backup-Buttons sind auf /einstellungen sichtbar", async ({ page }) => {
  // /einstellungen is behind AdminRequired.
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
  await blockSupabase(page);
  await page.goto("/einstellungen");
  await waitLoaded(page);

  await expect(page.getByRole("button", { name: /Einstellungen exportieren/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Komplettes Backup exportieren/i })).toBeVisible();
  await expect(page.getByText(/Einstellungen importieren/i).first()).toBeVisible();
  await expect(page.getByText(/Backup importieren/i)).toBeVisible();
});

// ── Test B: Backup-Import stellt Tagesumsatz wieder her ──────────────────────

test("Backup B: Backup-Import stellt pos-state inkl. Tagesumsatz wieder her", async ({ page }) => {
  await page.addInitScript(() => {
    // Admin is always set (sessionStorage survives reload).
    window.sessionStorage.setItem("primaq-admin", "true");
    // Only delete DB on the FIRST load — not on the post-import reload.
    if (window.sessionStorage.getItem("backup-b-seeded") === "1") return;
    window.sessionStorage.setItem("backup-b-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
  });
  await blockSupabase(page);
  await page.goto("/einstellungen");
  await waitLoaded(page);

  const today = new Date().toISOString().slice(0, 10);
  const backupPayload = JSON.stringify({
    version: 1,
    type: "backup",
    exportedAt: new Date().toISOString(),
    keys: {
      "primaq-pos-state": {
        cart: [],
        daily: {
          date: today,
          totalCents: 990,
          cashCents: 990,
          cardCents: 0,
          qrCents: 0,
          orderCount: 3,
          orders: [],
        },
      },
      "primaq-pos-flavors-v1": null,
      "primaq-pos-layout-v1": null,
      "primaq-pos-year-history": null,
    },
  });

  // Register dialog handler and start watching for the post-import reload.
  page.once("dialog", (dialog) => dialog.accept());
  const loadPromise = page.waitForEvent("load", { timeout: 6000 });

  await page.locator('[data-testid="backup-file-input"]').setInputFiles({
    name: "primaq-backup-test.json",
    mimeType: "application/json",
    buffer: Buffer.from(backupPayload),
  });

  // Wait for the reload triggered after 900 ms inside the component.
  await loadPromise;
  await waitLoaded(page);

  // Navigate to Tagesabschluss and verify the restored total.
  await page.goto("/tagesabschluss");
  await waitLoaded(page);
  await expect(page.getByText("9,90 €").first()).toBeVisible();

  // Also verify directly in IndexedDB.
  const state = await readPosState(page);
  expect(state?.daily.totalCents).toBe(990);
  expect(state?.daily.orderCount).toBe(3);
});

// ── Test C: Settings-Import lässt pos-state unberührt ────────────────────────

test("Backup C: Settings-Import überschreibt nicht die heutigen Buchungen", async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
    // Only delete DB and set LS data once.
    if (window.sessionStorage.getItem("backup-c-seeded") === "1") return;
    window.sessionStorage.setItem("backup-c-seeded", "1");
    indexedDB.deleteDatabase("primaq-pos");
    const today = new Date().toISOString().slice(0, 10);
    window.localStorage.setItem("primaq-pos-state", JSON.stringify({
      cart: [],
      daily: {
        date: today,
        totalCents: 500,
        cashCents: 500,
        cardCents: 0,
        qrCents: 0,
        orderCount: 1,
        orders: [],
      },
    }));
  });
  await blockSupabase(page);
  await page.goto("/einstellungen");
  await waitLoaded(page);

  // A settings file with a non-null flavors entry so the import succeeds and
  // triggers a reload — confirming pos-state is NOT among the imported keys.
  const settingsPayload = JSON.stringify({
    version: 1,
    type: "settings",
    exportedAt: new Date().toISOString(),
    keys: {
      "primaq-pos-flavors-v1": [
        { id: "vanilla-test", name: "Vanille", group: "maschine1",
          backgroundColor: "#F5E6C8", textColor: "#000000", isActive: true, imageScale: 100 },
      ],
      "primaq-pos-layout-v1": null,
      "primaq-pos-year-history": null,
    },
  });

  const loadPromise = page.waitForEvent("load", { timeout: 6000 });

  await page.locator('[data-testid="settings-file-input"]').setInputFiles({
    name: "primaq-einstellungen-test.json",
    mimeType: "application/json",
    buffer: Buffer.from(settingsPayload),
  });

  await loadPromise;
  await waitLoaded(page);

  // Tagesumsatz must still be 5,00 € (pos-state was not in the settings file).
  await page.goto("/tagesabschluss");
  await waitLoaded(page);
  await expect(page.getByText("5,00 €").first()).toBeVisible();

  const state = await readPosState(page);
  expect(state?.daily.totalCents).toBe(500);
});
