/**
 * Admin-Schutz: 6 Tests für PIN-Login, Tagesabschluss-Zugang, letzte Buchung.
 */

import { expect, test } from "@playwright/test";

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function seedEmptyPos(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("pos-seeded") === "1") return;
    window.sessionStorage.setItem("pos-seeded", "1");
    window.localStorage.removeItem("primaq-pos-state");
  });
}

async function seedAdmin(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.getByTestId("admin-login").click();
  await page.getByTestId("pin-input").fill("1234");
  await page.getByTestId("pin-submit").click();
}

// ── Test 1: Bediener sieht keine Tagesumsätze ────────────────────────────────

test("Admin 1: Bediener sieht keine Tagesumsätze und kein Tagesabschluss-Tab", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Tagesabschluss tab must not appear without admin
  await expect(page.getByRole("link", { name: "Tagesabschluss" })).not.toBeVisible();

  // No aggregate totals in bottom bar
  await expect(page.getByText("Umsatz gesamt")).not.toBeVisible();
  await expect(page.getByText("Bestellungen")).not.toBeVisible();

  // Last-booking bar IS present
  await expect(page.getByTestId("last-booking-bar")).toBeVisible();
  await expect(page.getByText("Letzte Buchung")).toBeVisible();
});

// ── Test 2: Letzte Buchung erscheint nach Bestellung ─────────────────────────

test("Admin 2: Bottom-Bar zeigt letzte Buchung nach Bestellung", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Book Klein Vanille (Bar, 5 €)
  await page.getByRole("button", { name: /^Klein/ }).click();
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByRole("button", { name: "5€" }).click();
  await page.getByRole("button", { name: "Bestellung buchen" }).click();

  const bar = page.getByTestId("last-booking-bar");
  await expect(bar.getByText("2,50 €")).toBeVisible();
  await expect(bar.getByText("Bar")).toBeVisible();
});

// ── Test 3: /tagesabschluss ohne Admin zeigt Sperre ──────────────────────────

test("Admin 3: /tagesabschluss ohne Admin-Login zeigt Sperrseite", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/tagesabschluss");
  await waitLoaded(page);

  await expect(page.getByText("Admin-Berechtigung erforderlich")).toBeVisible();
  // No financial data visible
  await expect(page.getByText("Gesamtumsatz")).not.toBeVisible();
});

// ── Test 4: Falscher PIN bleibt gesperrt ─────────────────────────────────────

test("Admin 4: Falscher PIN zeigt Fehlermeldung und gibt keinen Zugang", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Open modal and enter wrong PIN
  await page.getByTestId("admin-login").click();
  await page.getByTestId("pin-input").fill("9999");
  await page.getByTestId("pin-submit").click();

  // Error shown, modal still open
  await expect(page.getByText("Falscher PIN")).toBeVisible();

  // Tagesabschluss still not in nav
  await expect(page.getByRole("link", { name: "Tagesabschluss" })).not.toBeVisible();
});

// ── Test 5: Richtiger PIN gibt vollen Admin-Zugang ───────────────────────────

test("Admin 5: PIN 1234 gibt Admin-Zugang zu Tagesabschluss", async ({ page }) => {
  await seedEmptyPos(page);
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await loginAsAdmin(page);

  // Tagesabschluss nav item appears
  await expect(page.getByRole("link", { name: "Tagesabschluss" })).toBeVisible();

  // Navigate to Tagesabschluss and see data
  await page.goto("/tagesabschluss");
  await waitLoaded(page);
  await expect(page.getByText("Gesamtumsatz")).toBeVisible();
  await expect(page.getByText("Admin-Berechtigung erforderlich")).not.toBeVisible();
});

// ── Test 6: Admin verlassen sperrt Tagesabschluss wieder ─────────────────────

test("Admin 6: Admin verlassen sperrt Tagesabschluss", async ({ page }) => {
  await seedEmptyPos(page);
  await seedAdmin(page);
  await blockSupabase(page);
  await page.goto("/tagesabschluss");
  await waitLoaded(page);

  // Admin can see content
  await expect(page.getByText("Gesamtumsatz")).toBeVisible();

  // Click Admin logout button in header
  await page.getByTestId("admin-logout").click();

  // Tagesabschluss is locked again
  await expect(page.getByText("Admin-Berechtigung erforderlich")).toBeVisible();
  await expect(page.getByText("Gesamtumsatz")).not.toBeVisible();
});
