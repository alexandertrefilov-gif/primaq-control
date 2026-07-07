/**
 * FIX – Tote Einstellungen entfernt (Warenkorb-Breite / Geräte-Layout)
 *
 * "Warenkorb-Breite" (pos-layout-settings.tsx) und "Geräte-Layout"
 * (einstellungen-tabs.tsx) konnten seit der Umstellung auf das
 * Grid-Splitter-System nie wieder etwas auf /verkauf bewirken —
 * CartColumn's widthPx war fest auf 380 verdrahtet, active.cartWidth
 * und primaq-pos-device-layout-v1 wurden nie gelesen. Beide toten
 * Bedienelemente sind entfernt; ein Hinweis verweist stattdessen auf
 * "Layout anpassen" auf der Verkaufsseite.
 *
 * SETTINGS-EFFECTIVE 1 – Warenkorb-Breite-Regler existiert nicht mehr
 * SETTINGS-EFFECTIVE 2 – Geräte-Layout-Presets existieren nicht mehr
 * SETTINGS-EFFECTIVE 3 – Hinweistext auf "Layout anpassen" ist sichtbar (Verkaufsoberfläche-Tab)
 * SETTINGS-EFFECTIVE 4 – Hinweistext auf "Layout anpassen" ist sichtbar (Farben/Ansicht-Bereich)
 * SETTINGS-EFFECTIVE 5 – Kartengröße-Regler existiert nicht mehr (Touch-Tiles-Redesign)
 * SETTINGS-EFFECTIVE 6 – Verbleibende Einstellungen (Mengenbuttons) wirken weiterhin
 * SETTINGS-EFFECTIVE 7 – Verkaufsmodus-Presets funktionieren weiterhin ohne cartWidth/productCardSizePx
 */

import { expect, test, type Page } from "@playwright/test";

async function blockSupabase(page: Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function waitLoaded(page: Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function seedAdmin(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

async function gotoVerkaufsoberflaeche(page: Page) {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/einstellungen");
  await waitLoaded(page);
  await page.getByRole("button", { name: "Verkaufsoberfläche" }).click();
}

async function unlockEditMode(page: Page) {
  const lockBtn = page.getByRole("button", { name: "Gesperrt" });
  if (await lockBtn.isVisible().catch(() => false)) {
    await lockBtn.click();
  }
}

test("SETTINGS-EFFECTIVE 1 – Warenkorb-Breite-Regler existiert nicht mehr", async ({ page }) => {
  await gotoVerkaufsoberflaeche(page);
  await expect(page.getByText("Warenkorb-Breite")).toHaveCount(0);
  await expect(page.getByText("Bereiche & Reihenfolge")).toHaveCount(0);
  await expect(page.getByText("Größenbereich (Klein/Mittel/Groß)")).toHaveCount(0);
});

test("SETTINGS-EFFECTIVE 2 – Geräte-Layout-Presets existieren nicht mehr", async ({ page }) => {
  await gotoVerkaufsoberflaeche(page);
  await expect(page.getByText("Geräte-Layout")).toHaveCount(0);
  await expect(page.getByTestId(/settings-preset-/)).toHaveCount(0);
  await expect(page.getByTestId("settings-layout-reset")).toHaveCount(0);
});

test("SETTINGS-EFFECTIVE 3 – Hinweistext auf Layout anpassen (Feinjustierung-Bereich)", async ({ page }) => {
  await gotoVerkaufsoberflaeche(page);
  const hint = page.getByTestId("layout-resize-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("Layout anpassen");
  await expect(hint).toContainText("Warenkorb");
});

test("SETTINGS-EFFECTIVE 4 – Hinweistext auf Layout anpassen (Farben/Ansicht-Bereich)", async ({ page }) => {
  await gotoVerkaufsoberflaeche(page);
  const hint = page.getByTestId("device-layout-resize-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("Layout anpassen");
});

test("SETTINGS-EFFECTIVE 5 – Kartengröße-Regler existiert nicht mehr (Karten füllen den Bereich automatisch)", async ({ page }) => {
  await gotoVerkaufsoberflaeche(page);
  await expect(page.getByTestId("product-card-size-stepper")).toHaveCount(0);
  await expect(page.getByTestId("size-card-size-stepper")).toHaveCount(0);
  await expect(page.getByTestId("card-size-resize-hint")).toBeVisible();
});

test("SETTINGS-EFFECTIVE 6 – Mengenbuttons-Regler wirkt weiterhin", async ({ page }) => {
  await gotoVerkaufsoberflaeche(page);
  await unlockEditMode(page);

  await expect(page.getByText("Mengenbuttons (− Menge +)")).toBeVisible();
});

test("SETTINGS-EFFECTIVE 7 – Verkaufsmodus-Presets funktionieren weiterhin", async ({ page }) => {
  await gotoVerkaufsoberflaeche(page);
  await unlockEditMode(page);

  await expect(page.getByRole("button", { name: "Standard", exact: false })).toBeVisible();
  await page.getByRole("button", { name: "iPad", exact: false }).click();
  // No crash, preset applies without the dead cartWidth/productCardSizePx fields breaking anything.
  await expect(page.getByText("Mengenbuttons (− Menge +)")).toBeVisible();
});
