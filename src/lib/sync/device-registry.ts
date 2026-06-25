import { dbGet, dbSet } from "@/lib/db";

const DEVICE_ID_KEY = "primaq-device-id";

function generateUuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let _deviceId: string | null = null;

/**
 * Returns a stable UUID for this device/browser.
 * Generated once and persisted in IndexedDB under "primaq-device-id".
 * Survives page reloads; resets if IndexedDB is cleared.
 */
export async function getDeviceId(): Promise<string> {
  if (_deviceId) return _deviceId;
  if (typeof window === "undefined") return "ssr";

  const existing = await dbGet(DEVICE_ID_KEY);
  if (existing) {
    _deviceId = existing;
    return _deviceId;
  }

  const id = generateUuid();
  await dbSet(DEVICE_ID_KEY, id);
  _deviceId = id;
  return _deviceId;
}

/** Clears the in-memory cache (for tests only). */
export function _resetDeviceIdCache(): void {
  _deviceId = null;
}
