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
