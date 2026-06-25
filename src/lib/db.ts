import Dexie, { type Table } from "dexie";

export const DB_NAME = "primaq-pos";

interface KvEntry {
  key: string;
  value: string;
}

class PrimaqPosDb extends Dexie {
  kv!: Table<KvEntry, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({ kv: "key" });
  }
}

// Lazy singleton — only instantiated in browser (useEffect never runs on server).
let _db: PrimaqPosDb | undefined;
function getDb(): PrimaqPosDb {
  if (!_db) _db = new PrimaqPosDb();
  return _db;
}

/**
 * Read a value from IndexedDB.
 * On first access for a key, automatically migrates data from localStorage so
 * existing data survives the upgrade from the old localStorage-based stores.
 */
export async function dbGet(key: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const entry = await getDb().kv.get(key);
    if (entry !== undefined) return entry.value;

    // One-time migration: copy from localStorage if present (no IndexedDB entry yet).
    const local = window.localStorage.getItem(key);
    if (local !== null) {
      await getDb().kv.put({ key, value: local }).catch(() => {});
      return local;
    }
    return null;
  } catch {
    // IndexedDB unavailable (e.g. storage blocked) — transparent fallback.
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
}

/**
 * Write a value to IndexedDB.
 * Re-throws on failure so callers (quota-error handling in stores) can react.
 */
export async function dbSet(key: string, value: string): Promise<void> {
  if (typeof window === "undefined") return;
  await getDb().kv.put({ key, value });
}

/**
 * Delete a value from IndexedDB. Failures are silently ignored.
 */
export async function dbRemove(key: string): Promise<void> {
  if (typeof window === "undefined") return;
  try { await getDb().kv.delete(key); } catch { /* ignore */ }
}
