/**
 * Phase 3.1 – Version / Build Info Tests
 *
 * Prüft:
 *   1 – /version gibt HTTP 200 zurück
 *   2 – /api/version gibt gültiges JSON mit erwartetem Shape zurück
 *   3 – commit und branch sind nicht null/leer (entweder echter SHA oder "unknown")
 */

import { expect, test } from "@playwright/test";

test("Version 1: /version gibt HTTP 200 zurück", async ({ page }) => {
  const response = await page.goto("/version");
  expect(response?.status()).toBe(200);
  await expect(page.getByText("Version / Build Info")).toBeVisible();
});

test("Version 2: /api/version gibt gültiges JSON mit erwartetem Shape zurück", async ({
  request,
}) => {
  const res = await request.get("/api/version");
  expect(res.status()).toBe(200);

  const contentType = res.headers()["content-type"] ?? "";
  expect(contentType).toContain("application/json");

  const json = (await res.json()) as Record<string, unknown>;
  expect(typeof json.app).toBe("string");
  expect(typeof json.environment).toBe("string");
  expect(typeof json.commit).toBe("string");
  expect(typeof json.branch).toBe("string");
  expect(typeof json.buildTime).toBe("string");
  expect(typeof json.nodeEnv).toBe("string");
});

test("Version 3: commit und branch sind Strings — niemals null oder leer", async ({
  request,
}) => {
  const res = await request.get("/api/version");
  const json = (await res.json()) as Record<string, unknown>;

  // Must be a non-empty string: either a real SHA/branch or the fallback "unknown"
  expect(json.commit).toBeTruthy();
  expect(json.branch).toBeTruthy();
  expect(json.commit).not.toBe("");
  expect(json.branch).not.toBe("");
});
