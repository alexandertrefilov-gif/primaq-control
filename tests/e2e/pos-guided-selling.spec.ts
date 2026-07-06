/**
 * Guided Selling UX – E2E Tests
 *
 * GUIDED 1 – GuidedStepsBar ist sichtbar wenn guidedMode aktiv
 * GUIDED 2 – Schritt 1 aktiv beim Start (Sorte wählen)
 * GUIDED 3 – FlavorColumn hat teal-Ring in Schritt 1
 * GUIDED 4 – Nach Sorte wählen → Schritt 2 aktiv (Größe wählen)
 * GUIDED 5 – Nach Größe wählen (Artikel im Warenkorb) → Schritt 3 (Betrag)
 * GUIDED 6 – Nach Betrag eingeben → Schritt 4 (Zahlungsmittel/Buchen)
 * GUIDED 7 – GuidedStepsBar verschwindet nach Abschalten des Modus
 * GUIDED 8 – Toggle in Einstellungen → Oberfläche vorhanden
 */

import { expect, test, type Page } from "@playwright/test";

const GUIDED_MODE_KEY = "primaq-guided-mode";

async function blockSupabase(page: Page) {
  await page.route(/supabase\.co/, (r) => r.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function seedAdmin(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

async function seedGuidedMode(page: Page, enabled: boolean) {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, value);
    },
    { key: GUIDED_MODE_KEY, value: String(enabled) }
  );
}

async function seedEmpty(page: Page, tag: string) {
  await page.addInitScript((t) => {
    if (window.sessionStorage.getItem(`guided-seeded-${t}`) === "1") return;
    window.sessionStorage.setItem(`guided-seeded-${t}`, "1");
    indexedDB.deleteDatabase("primaq-pos");
  }, tag);
}

async function waitLoaded(page: Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("GUIDED 1 – GuidedStepsBar ist sichtbar wenn guidedMode aktiv", async ({ page }) => {
  await seedEmpty(page, "g1");
  await blockSupabase(page);
  await seedAdmin(page);
  await seedGuidedMode(page, true);
  await page.goto("/");
  await waitLoaded(page);

  const bar = page.getByTestId("guided-steps-bar");
  await expect(bar).toBeVisible();
});

test("GUIDED 2 – Schritt 1 aktiv beim Start (Sorte wählen)", async ({ page }) => {
  await seedEmpty(page, "g2");
  await blockSupabase(page);
  await seedAdmin(page);
  await seedGuidedMode(page, true);
  await page.goto("/");
  await waitLoaded(page);

  const bar = page.getByTestId("guided-steps-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("data-active-step", "1");

  const step1 = page.getByTestId("guided-step-1");
  await expect(step1).toHaveAttribute("data-state", "active");
});

test("GUIDED 3 – FlavorColumn hat teal-Ring in Schritt 1", async ({ page }) => {
  await seedEmpty(page, "g3");
  await blockSupabase(page);
  await seedAdmin(page);
  await seedGuidedMode(page, true);
  await page.goto("/");
  await waitLoaded(page);

  // FlavorColumn has data-guided-active="true" in step 1
  const flavorCol = page.locator("[data-guided-active='true']").first();
  await expect(flavorCol).toBeVisible();
});

test("GUIDED 4 – Nach Sorte wählen wechselt zu Schritt 2", async ({ page }) => {
  await seedEmpty(page, "g4");
  await blockSupabase(page);
  await seedAdmin(page);
  await seedGuidedMode(page, true);
  await page.goto("/");
  await waitLoaded(page);

  // Click first flavor card (within flavor-zone)
  const flavorBtn = page.locator("[data-testid='flavor-zone'] button").first();
  await expect(flavorBtn).toBeVisible();
  await flavorBtn.click();

  const bar = page.getByTestId("guided-steps-bar");
  await expect(bar).toHaveAttribute("data-active-step", "2");

  const step2 = page.getByTestId("guided-step-2");
  await expect(step2).toHaveAttribute("data-state", "active");
});

test("GUIDED 5 – Nach Größe wählen wechselt zu Schritt 3 (Betrag)", async ({ page }) => {
  await seedEmpty(page, "g5");
  await blockSupabase(page);
  await seedAdmin(page);
  await seedGuidedMode(page, true);
  await page.goto("/");
  await waitLoaded(page);

  // Click first flavor, then first size
  const flavorBtn = page.locator("[data-testid='flavor-zone'] button").first();
  await expect(flavorBtn).toBeVisible();
  await flavorBtn.click();

  const sizeBtn = page.locator("[data-testid*='size-btn-']").first();
  await expect(sizeBtn).toBeVisible();
  await sizeBtn.click();

  const bar = page.getByTestId("guided-steps-bar");
  await expect(bar).toHaveAttribute("data-active-step", "3");
});

test("GUIDED 6 – Nach Betrag eingeben wechselt zu Schritt 4", async ({ page }) => {
  await seedEmpty(page, "g6");
  await blockSupabase(page);
  await seedAdmin(page);
  await seedGuidedMode(page, true);
  await page.goto("/");
  await waitLoaded(page);

  // Click flavor then size to get to step 3
  const flavorBtn = page.locator("[data-testid='flavor-zone'] button").first();
  await expect(flavorBtn).toBeVisible();
  await flavorBtn.click();

  const sizeBtn = page.locator("[data-testid*='size-btn-']").first();
  await expect(sizeBtn).toBeVisible();
  await sizeBtn.click();

  // Wait for step 3 (Betrag eingeben)
  const bar = page.getByTestId("guided-steps-bar");
  await expect(bar).toHaveAttribute("data-active-step", "3");

  // Betrag eingeben (Schnellbetrag) → Schritt 4 (Zahlungsmittel + Buchen)
  const quickAmount = page.locator("[data-testid*='quick-amount-']").first();
  await expect(quickAmount).toBeVisible();
  await quickAmount.click();
  await expect(bar).toHaveAttribute("data-active-step", "4");
});

test("GUIDED 7 – GuidedStepsBar unsichtbar wenn guidedMode deaktiviert", async ({ page }) => {
  await seedEmpty(page, "g7");
  await blockSupabase(page);
  await seedAdmin(page);
  await seedGuidedMode(page, false);
  await page.goto("/");
  await waitLoaded(page);

  const bar = page.getByTestId("guided-steps-bar");
  await expect(bar).not.toBeVisible();
});

test("GUIDED 8 – Toggle in Einstellungen → Oberfläche vorhanden", async ({ page }) => {
  await seedEmpty(page, "g8");
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/einstellungen");
  await waitLoaded(page);

  // Navigate to Oberfläche tab
  await page.getByRole("button", { name: /Verkaufsoberfläche/i }).click();

  const toggle = page.getByTestId("guided-mode-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("role", "switch");
});
