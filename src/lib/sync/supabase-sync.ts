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
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`,
      {
        method: "HEAD",
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" },
        signal: controller.signal,
      }
    );
    clearTimeout(timerId);
    console.log("[SalesSync] checkConnection: HTTP", res.status, "→ CONNECTED");
    return res.status < 600 ? "CONNECTED" : "OFFLINE";
  } catch (err) {
    clearTimeout(timerId);
    console.warn("[SalesSync] checkConnection: catch →", err instanceof Error ? err.message : String(err), "→ OFFLINE");
    return "OFFLINE";
  }
}

/**
 * Checks whether the required POS tables exist in the connected database.
 * Logs a warning for each missing table; does not throw.
 * Must only be called when checkConnection() returned "CONNECTED".
 */
export async function checkTables(): Promise<void> {
  const required = ["pos_settings", "pos_year_history", "pos_sales_state"] as const;
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
  data: unknown;
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
    data: payload.data,
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

// ── POS Sales State ───────────────────────────────────────────────────────────

export interface SalesStatePayload {
  businessId: string;
  businessDate: string;
  daily: unknown; // DailySummary — opaque to the sync layer
  updatedAt: string;
}

export interface SalesStateRow {
  id: string;
  business_id: string;
  business_date: string;
  data: unknown; // DailySummary
  updated_at: string;
}

/**
 * Upserts the live daily sales snapshot into pos_sales_state.
 * id = "businessId:businessDate" — one row per day, idempotent.
 * Throws on error so the caller can call markFailed().
 */
export async function upsertSalesState(payload: SalesStatePayload): Promise<void> {
  const row = {
    id: `${payload.businessId}:${payload.businessDate}`,
    business_id: payload.businessId,
    business_date: payload.businessDate,
    data: payload.daily,
    updated_at: payload.updatedAt,
  };
  console.log("[SalesSync 7] Supabase response — sending upsert →", JSON.stringify(row).slice(0, 200));
  const { error } = await supabase.from("pos_sales_state").upsert(row);
  if (error) {
    console.error("[SalesSync 7] Supabase ERROR:", error.code, error.message, error.details);
    throw error;
  }
  console.log("[SalesSync 7] Supabase OK — row written:", row.id);
}

/**
 * Deletes all pos_sales_state and pos_year_history rows for a given businessId.
 * Used by the "Testdaten zurücksetzen" admin function to wipe cloud sales data.
 * Throws on any Supabase error so the caller can abort the local reset.
 */
export async function clearSalesDataCloud(businessId: string): Promise<void> {
  const { error: e1 } = await supabase
    .from("pos_sales_state")
    .delete()
    .eq("business_id", businessId);
  if (e1) throw e1;

  const { error: e2 } = await supabase
    .from("pos_year_history")
    .delete()
    .eq("business_id", businessId);
  if (e2) throw e2;
}

/**
 * Fetches the pos_sales_state row for a specific business day.
 * Returns null if no row exists yet.
 * Throws on error so the caller can catch and log.
 */
export async function pullSalesState(
  businessId: string,
  businessDate: string,
): Promise<SalesStateRow | null> {
  const { data, error } = await supabase
    .from("pos_sales_state")
    .select("*")
    .eq("business_id", businessId)
    .eq("business_date", businessDate)
    .limit(1);
  if (error) throw error;
  return (data?.[0] as SalesStateRow) ?? null;
}
