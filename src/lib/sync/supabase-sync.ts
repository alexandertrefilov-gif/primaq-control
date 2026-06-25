import { supabase } from "@/lib/supabase";

export type ConnectionStatus = "CONNECTED" | "OFFLINE";

const isDev = process.env.NODE_ENV === "development";

function log(...args: unknown[]): void {
  if (isDev) console.log("[Sync]", ...args);
}

/**
 * Checks Supabase reachability via a lightweight HEAD request to the REST root.
 * Returns "CONNECTED" on any HTTP response (even 4xx = server is reachable).
 * Returns "OFFLINE" on network errors (DNS failure, connection refused, abort).
 */
export async function checkConnection(): Promise<ConnectionStatus> {
  if (typeof window === "undefined") return "OFFLINE";
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`,
      {
        method: "HEAD",
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" },
        signal: AbortSignal.timeout(5000),
      }
    );
    return res.status < 600 ? "CONNECTED" : "OFFLINE";
  } catch {
    return "OFFLINE";
  }
}

/**
 * Checks whether the required POS tables exist in the connected database.
 * Logs a warning for each missing table; does not throw.
 * Must only be called when checkConnection() returned "CONNECTED".
 */
export async function checkTables(): Promise<void> {
  const required = ["pos_settings", "pos_year_history"] as const;
  for (const table of required) {
    const { error } = await supabase.from(table as string).select("id").limit(0);
    if (error) {
      log(`Tabelle "${table}" nicht gefunden:`, error.message);
    } else {
      log(`Tabelle "${table}" OK`);
    }
  }
}

export interface HealthCheckRecord {
  id: string;
  device_id: string;
  status: string;
  created_at: string;
}

/**
 * Upserts a health-check record into the sync_health table.
 * Throws on Supabase write error so the caller can detect connectivity problems.
 */
export async function writeHealthCheck(deviceId: string): Promise<void> {
  const record: HealthCheckRecord = {
    id: `hc-${deviceId}`,
    device_id: deviceId,
    status: "ok",
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("sync_health").upsert(record);
  if (error) throw error;
}

/**
 * Reads the health-check record previously written by writeHealthCheck.
 * Returns null if the record does not yet exist.
 * Throws on Supabase read error.
 */
export async function readHealthCheck(deviceId: string): Promise<HealthCheckRecord | null> {
  const { data, error } = await supabase
    .from("sync_health")
    .select("*")
    .eq("id", `hc-${deviceId}`)
    .limit(1);
  if (error) throw error;
  return (data?.[0] as HealthCheckRecord) ?? null;
}

export interface YearHistoryPayload {
  businessId: string;
  deviceId: string;
  date: string;
  summary: unknown; // DailySummary — opaque to the sync layer
}

/**
 * Upserts one daily summary row into pos_year_history.
 * id is derived as "businessId:deviceId:date" so repeated calls are idempotent.
 * Throws on Supabase write error so the caller can call markFailed().
 */
export async function upsertYearHistory(payload: YearHistoryPayload): Promise<void> {
  const { error } = await supabase.from("pos_year_history").upsert({
    id: `${payload.businessId}:${payload.deviceId}:${payload.date}`,
    business_id: payload.businessId,
    device_id: payload.deviceId,
    date: payload.date,
    summary: payload.summary,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export interface YearHistoryRow {
  id: string;
  business_id: string;
  device_id: string;
  date: string;
  summary: unknown;
}

/**
 * Fetches all pos_year_history rows for a given businessId.
 * Throws on Supabase read error so the caller can catch and log.
 */
export async function pullYearHistory(businessId: string): Promise<YearHistoryRow[]> {
  const { data, error } = await supabase
    .from("pos_year_history")
    .select("*")
    .eq("business_id", businessId);
  if (error) throw error;
  return (data ?? []) as YearHistoryRow[];
}

// ── POS Settings ──────────────────────────────────────────────────────────────

export interface SettingsPayload {
  businessId: string;
  deviceId: string;
  settingsKey: string;
  data: unknown;
  updatedAt: string;
}

export interface SettingsRow {
  id: string;
  business_id: string;
  settings_key: string;
  /** Full payload including data + timestamps, stored as jsonb. */
  payload: SettingsPayload;
  device_id: string;
  updated_at: string;
}

/**
 * Upserts one settings snapshot into pos_settings.
 * id = "businessId:settingsKey" so repeated upserts are idempotent.
 * Throws on error so the caller can call markFailed().
 */
export async function upsertSettings(payload: SettingsPayload): Promise<void> {
  const { error } = await supabase.from("pos_settings").upsert({
    id: `${payload.businessId}:${payload.settingsKey}`,
    business_id: payload.businessId,
    settings_key: payload.settingsKey,
    payload: payload,
    device_id: payload.deviceId,
    updated_at: payload.updatedAt,
  });
  if (error) throw error;
}

/**
 * Fetches all pos_settings rows for a given businessId.
 * Throws on error so the caller can catch and log.
 */
export async function pullSettings(businessId: string): Promise<SettingsRow[]> {
  const { data, error } = await supabase
    .from("pos_settings")
    .select("*")
    .eq("business_id", businessId);
  if (error) throw error;
  return (data ?? []) as SettingsRow[];
}
