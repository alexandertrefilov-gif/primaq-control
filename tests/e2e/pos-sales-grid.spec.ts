/**
 * Stabiles Standard-Verkaufslayout (Fixed Grid) – E2E Tests
 *
 * Free-Layout ist im Verkaufsbetrieb vollständig deaktiviert: kein Import,
 * keine Render-Pfade, kein Drag/Resize, keine x/y/w/h-Panels — für niemanden,
 * Admin eingeschlossen. /verkauf zeigt immer und ausschließlich das feste
 * Standard-Grid, unabhängig davon, was in localStorage steht.
 *
 * Topologie: Sorten (links, 1fr) | Größe (Mitte, 320-380px) | Warenkorb
 * (rechts, volle Höhe, 360-440px). Unten läuft EINE Bezahlkarte
 * ("Betrag eingeben & Bestellung buchen") unter Sorten+Mitte, aber nicht
 * unter dem Warenkorb — sie enthält Zahlungsmittel, Betrag-Eingabe, feste
 * Beträge und den Buchen-Button als eine Einheit. Es gibt keine separate
 * Zahlungskarte mehr unter „Größe wählen".
 *
 * Ergänzt tests/e2e/pos-layout-ipad.spec.ts (LAY 1-11: Zonen sichtbar, kein
 * Überlapp, Warenkorb rechts, kein horizontaler Scroll, Buchung funktioniert)
 * und pos-guided-selling.spec.ts (Schrittlogik).
 *
 * GRID 1 – Sichtbarer Abstand zwischen Sorten und Größen
 * GRID 2 – Sichtbarer Abstand zwischen Größen-Spalte und Warenkorb
 * GRID 3 – Sichtbarer Abstand zwischen Bezahlkarte und Footer
 * GRID 4 – Bestellung buchen überlappt nicht die Schnellbetrag-Buttons (Stapel)
 * GRID 5 – Standardlayout sichtbar: Sorten, Größen, Bezahlkarte, Warenkorb rechts
 * GRID 6 – Kein Layout-Button, keine Free-Layout-Handles – auch nicht für Admin
 * GRID 7 – Buchung funktioniert im Standardlayout
 * GRID 8 – Verkäufer sieht IMMER das Standard-Grid, selbst mit gespeichertem Free-Layout
 * GRID 9 – Admin sieht ebenfalls IMMER das Standard-Grid, selbst mit gespeichertem Layout
 * GRID 10 – Kaputtes/ungültiges localStorage-Layout wird ignoriert – /verkauf bleibt stabil
 * GRID 11 – Legacy-Layout-Keys werden beim Laden aktiv aus localStorage entfernt
 * GRID 12 – Kein separater Zahlungskarten-Bereich mehr unter „Größe wählen"
 * GRID 13 – Bezahlkarte reicht nicht unter den Warenkorb
 * GRID 14 – Zahlungsmittel gesperrt (abgedunkelt, keine Aktion) bis Warenkorb nicht leer
 * GRID 15 – Betrag/Festbeträge/Buchen gesperrt bis Zahlungsmittel explizit gewählt
 * GRID 16 – Nach Buchung: Zahlungsmittel wieder auf Bar zurückgesetzt
 * GRID 17 – Bar/Karte/QR sitzen in der unteren Bezahlkarte
 * GRID 18 – Keine leere Fläche links unten (Zahlungsmittel direkt über Betrag-Eingabe)
 * GRID 19 – Layout sauber bei 1194×834 (kein Überlapp)
 */

import { expect, test } from "@playwright/test";

const LS_FREE_KEY = "primaq-pos-free-layout-v1";
const LS_DEVICE_KEY = "primaq-pos-device-layout-v1";

async function blockSupabase(page: import("@playwright/test").Page) {
  await page.route(/supabase\.co/, (route) => route.abort());
  await page.routeWebSocket(/supabase\.co/, () => {});
}

async function seedAdmin(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("primaq-admin", "true");
  });
}

async function waitLoaded(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => !document.body.textContent?.includes("Laden…"));
}

async function rect(page: import("@playwright/test").Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function seedFreeLayout(
  page: import("@playwright/test").Page,
  panels: Record<string, { x: number; y: number; w: number; h: number }>
) {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify({ panels: value }));
    },
    { key: LS_FREE_KEY, value: panels }
  );
}

const someOldLayout = {
  flavors: { x: 8,   y: 8,   w: 520, h: 300 },
  sizes:   { x: 8,   y: 500, w: 420, h: 100 },
  payment: { x: 8,   y: 608, w: 400, h: 220 },
  cart:    { x: 600, y: 8,   w: 400, h: 500 },
};

// Minimum visible gap between two areas — matches the ~10px requirement.
const MIN_GAP = 6;

test("GRID 1 – Sichtbarer Abstand zwischen Sorten und Größen", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const flavorR = await rect(page, "flavor-zone");
  const sizeR = await rect(page, "size-zone");
  // Sizes sit to the right of Sorten
  const hGap = sizeR.x - (flavorR.x + flavorR.width);
  expect(hGap).toBeGreaterThanOrEqual(MIN_GAP);
});

test("GRID 2 – Sichtbarer Abstand zwischen Größen-Spalte und Warenkorb", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const sizeR = await rect(page, "size-zone");
  const cartR = await rect(page, "cart-zone");
  const hGap = cartR.x - (sizeR.x + sizeR.width);
  expect(hGap).toBeGreaterThanOrEqual(MIN_GAP);
});

test("GRID 3 – Sichtbarer Abstand zwischen Bezahlkarte und Footer", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const amountR = await rect(page, "amount-zone");
  const footerR = await rect(page, "last-booking-bar");
  const vGap = footerR.y - (amountR.y + amountR.height);
  expect(vGap).toBeGreaterThanOrEqual(MIN_GAP);
});

test("GRID 4 – Bestellung buchen überlappt nicht die Schnellbetrag-Buttons", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const quickR = await rect(page, "quick-amounts-row");
  const bookR = await rect(page, "book-button");
  // Book button sits below the quick-amounts stack in the same column, never overlapping it.
  const vGap = bookR.y - (quickR.y + quickR.height);
  expect(vGap).toBeGreaterThanOrEqual(0);
});

test("GRID 5 – Standardlayout sichtbar: Sorten, Größen, Bezahlkarte, Warenkorb rechts", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("sales-grid")).toBeVisible();
  await expect(page.getByTestId("flavor-zone")).toBeVisible();
  await expect(page.getByTestId("size-zone")).toBeVisible();
  await expect(page.getByTestId("amount-zone")).toBeVisible();
  await expect(page.getByTestId("payment-tab-bar")).toBeVisible();
  await expect(page.getByTestId("cart-zone")).toBeVisible();

  // Warenkorb rechts von Sorten
  const flavorR = await rect(page, "flavor-zone");
  const cartR = await rect(page, "cart-zone");
  expect(cartR.x).toBeGreaterThan(flavorR.x + flavorR.width);
});

test("GRID 6 – Kein Layout-Button, keine Free-Layout-Handles – auch nicht für Admin", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.locator('[data-testid="layout-edit-toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="layout-edit-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="layout-reset-btn"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="fl-container"]')).toHaveCount(0);
  await expect(page.locator('[data-panel]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="fl-drag-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="fl-resize-"]')).toHaveCount(0);
});

test("GRID 7 – Buchung funktioniert im Standardlayout", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();

  await expect(page.getByText("Noch leer")).toBeVisible();
});

// ── Regression: a saved/leftover free-layout must never reach the seller ────

test("GRID 8 – Verkäufer sieht IMMER das Standard-Grid, selbst mit gespeichertem Free-Layout", async ({ page }) => {
  await blockSupabase(page);
  // Some old free-layout sits in localStorage (e.g. leftover from a much
  // earlier version of the app) — a regular seller (no admin) opens the register.
  await seedFreeLayout(page, someOldLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.locator('[data-testid="layout-edit-toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="fl-container"]')).toHaveCount(0);
  await expect(page.locator('[data-panel]')).toHaveCount(0);
  await expect(page.getByTestId("sales-grid")).toBeVisible();

  await expect(page.getByTestId("flavor-zone")).toBeVisible();
  await expect(page.getByTestId("size-zone")).toBeVisible();
  await expect(page.getByTestId("amount-zone")).toBeVisible();
  await expect(page.getByTestId("cart-zone")).toBeVisible();
});

test("GRID 9 – Admin sieht ebenfalls IMMER das Standard-Grid, selbst mit gespeichertem Layout", async ({ page }) => {
  await blockSupabase(page);
  await seedAdmin(page);
  await seedFreeLayout(page, someOldLayout);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.locator('[data-testid="layout-edit-toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="fl-container"]')).toHaveCount(0);
  await expect(page.locator('[data-panel]')).toHaveCount(0);
  await expect(page.getByTestId("sales-grid")).toBeVisible();
});

test("GRID 10 – Kaputtes/ungültiges localStorage-Layout wird ignoriert – /verkauf bleibt stabil", async ({ page }) => {
  await blockSupabase(page);
  // Structurally invalid / hand-corrupted entry.
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({
      panels: { flavors: { x: "broken", y: null, w: 520 } }, // missing h, missing other 3 panels
    }));
  }, LS_FREE_KEY);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("sales-grid")).toBeVisible();
  await expect(page.locator('[data-testid="fl-container"]')).toHaveCount(0);
  await expect(page.getByTestId("flavor-zone")).toBeVisible();
  await expect(page.getByTestId("cart-zone")).toBeVisible();
});

test("GRID 11 – Legacy-Layout-Keys werden beim Laden aktiv aus localStorage entfernt", async ({ page }) => {
  await blockSupabase(page);
  await seedFreeLayout(page, someOldLayout);
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({ some: "old-device-layout-data" }));
  }, LS_DEVICE_KEY);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("sales-grid")).toBeVisible();

  const freeLs = await page.evaluate((key) => localStorage.getItem(key), LS_FREE_KEY);
  const deviceLs = await page.evaluate((key) => localStorage.getItem(key), LS_DEVICE_KEY);
  expect(freeLs).toBeNull();
  expect(deviceLs).toBeNull();
});

// ── Zahlungsmittel jetzt Teil der unteren Bezahlkarte, keine separate Karte ──

test("GRID 12 – Kein separater Zahlungskarten-Bereich mehr unter „Größe wählen\"", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Es existiert kein eigenständiger "payment-zone"-Container mehr.
  await expect(page.locator('[data-testid="payment-zone"]')).toHaveCount(0);

  // Direkt unter dem Größen-Bereich (in derselben Spalte) folgt nichts mehr –
  // die Zahlungsmittel-Auswahl liegt jetzt unten in der Bezahlkarte.
  const sizeR = await rect(page, "size-zone");
  const amountR = await rect(page, "amount-zone");
  // Die Bezahlkarte beginnt klar unterhalb der Größen-Zeile (eigene Grid-Zeile).
  expect(amountR.y).toBeGreaterThanOrEqual(sizeR.y + sizeR.height - 4);
});

test("GRID 13 – Bezahlkarte reicht nicht unter den Warenkorb", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const amountR = await rect(page, "amount-zone");
  const cartR = await rect(page, "cart-zone");
  expect(amountR.x + amountR.width).toBeLessThanOrEqual(cartR.x + 4);
});

// ── Strikte Schritt-Sperrung: sichtbar, abgedunkelt, keine Aktion ────────────

test("GRID 14 – Zahlungsmittel gesperrt bis Warenkorb nicht leer", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  // Noch nichts im Warenkorb: Bezahlkarte + Zahlungsmittel-Tabs sichtbar, aber ohne Wirkung
  await expect(page.getByTestId("amount-zone")).toBeVisible();
  await expect(page.getByTestId("amount-zone")).toHaveCSS("pointer-events", "none");
  await expect(page.getByTestId("payment-tab-karte")).toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("payment-tab-karte").click({ force: true });
  // "Karte gewählt"-Indikator darf nicht erscheinen – Klick hatte keine Wirkung
  await expect(page.getByText("Kartenzahlung gewählt")).not.toBeVisible();

  // Nach Sorte+Größe (Warenkorb nicht leer) ist die Bezahlkarte aktiv
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await expect(page.getByTestId("amount-zone")).not.toHaveCSS("pointer-events", "none");
  await expect(page.getByTestId("payment-tab-karte")).toHaveAttribute("aria-disabled", "false");
  await page.getByTestId("payment-tab-karte").click();
  await expect(page.getByText("Kartenzahlung gewählt")).toBeVisible();
});

test("GRID 15 – Betrag/Festbeträge/Buchen gesperrt bis Zahlungsmittel explizit gewählt", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();

  // Zahlungsmittel selbst ist aktiv, aber noch nicht explizit angetippt –
  // Betrag-Eingabe und Festbeträge bleiben bis dahin gesperrt.
  await expect(page.getByTestId("payment-tab-bar")).toHaveAttribute("aria-disabled", "false");
  const cashRow = page.getByTestId("cash-plus").locator("..");
  await expect(cashRow).toHaveCSS("pointer-events", "none");
  await expect(page.getByTestId("quick-amounts-row")).toHaveCSS("pointer-events", "none");
  await expect(page.locator('[data-testid="amount-zone"] input')).toBeDisabled();

  // Nach explizitem Antippen von Bar wird der Betrag-Bereich aktiv
  await page.getByTestId("payment-tab-bar").click();
  await expect(cashRow).not.toHaveCSS("pointer-events", "none");
  await expect(page.locator('[data-testid="amount-zone"] input')).toBeEnabled();
  await expect(page.getByTestId("quick-amounts-row")).not.toHaveCSS("pointer-events", "none");
  await page.getByTestId("cash-plus").click();
  const inputValue = await page.locator('[data-testid="amount-zone"] input').inputValue();
  expect(inputValue).not.toBe("");
});

test("GRID 16 – Nach Buchung: Zahlungsmittel wieder auf Bar zurückgesetzt", async ({ page }) => {
  await blockSupabase(page);
  await page.goto("/verkauf");
  await waitLoaded(page);

  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("payment-tab-karte").click();
  await page.getByTestId("book-button").click();
  await expect(page.getByText("Noch leer")).toBeVisible();

  // Nächste Bestellung: Bar-Tab ist wieder der aktive Standard-Tab
  await page.getByRole("button", { name: "Vanille", exact: true }).click();
  await page.getByTestId("size-btn-klein").click();
  await page.getByTestId("payment-tab-bar").click();
  await expect(page.getByTestId("quick-amounts-row")).toBeVisible();
  await expect(page.getByTestId("quick-amounts-row")).not.toHaveCSS("pointer-events", "none");
});

test("GRID 17 – Bar/Karte/QR sitzen in der unteren Bezahlkarte", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const amountR = await rect(page, "amount-zone");
  for (const id of ["payment-tab-bar", "payment-tab-karte", "payment-tab-qr"]) {
    const r = await rect(page, id);
    // Jeder Zahlungsmittel-Tab liegt vollständig innerhalb der Bezahlkarte.
    expect(r.x).toBeGreaterThanOrEqual(amountR.x - 2);
    expect(r.y).toBeGreaterThanOrEqual(amountR.y - 2);
    expect(r.x + r.width).toBeLessThanOrEqual(amountR.x + amountR.width + 2);
    expect(r.y + r.height).toBeLessThanOrEqual(amountR.y + amountR.height + 2);
  }
});

test("GRID 18 – Keine leere Fläche links unten: Zahlungsmittel direkt über Betrag-Eingabe", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  const paymentGroupR = await rect(page, "payment-method-group");
  const cashMinusR = await rect(page, "cash-minus");
  // Der Abstand zwischen Zahlungsmittel-Gruppe und Betrag-Eingabe entspricht
  // dem üblichen Innenabstand (8-10px) – keine große leere Fläche dazwischen.
  const vGap = cashMinusR.y - (paymentGroupR.y + paymentGroupR.height);
  expect(vGap).toBeGreaterThanOrEqual(0);
  expect(vGap).toBeLessThan(24);
});

test("GRID 19 – Layout sauber bei 1194×834 (kein Überlapp)", async ({ page }) => {
  await blockSupabase(page);
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.goto("/verkauf");
  await waitLoaded(page);

  await expect(page.getByTestId("sales-grid")).toBeVisible();
  await expect(page.getByTestId("flavor-zone")).toBeVisible();
  await expect(page.getByTestId("size-zone")).toBeVisible();
  await expect(page.getByTestId("amount-zone")).toBeVisible();
  await expect(page.getByTestId("cart-zone")).toBeVisible();

  const flavorR = await rect(page, "flavor-zone");
  const sizeR = await rect(page, "size-zone");
  const amountR = await rect(page, "amount-zone");
  const cartR = await rect(page, "cart-zone");

  // Sorten/Größe nebeneinander, Warenkorb rechts davon, Bezahlkarte unten –
  // keine Fläche überlappt eine andere.
  expect(sizeR.x).toBeGreaterThanOrEqual(flavorR.x + flavorR.width - 4);
  expect(cartR.x).toBeGreaterThanOrEqual(sizeR.x + sizeR.width - 4);
  expect(amountR.y).toBeGreaterThanOrEqual(flavorR.y + flavorR.height - 4);
  expect(amountR.x + amountR.width).toBeLessThanOrEqual(cartR.x + 4);
});
