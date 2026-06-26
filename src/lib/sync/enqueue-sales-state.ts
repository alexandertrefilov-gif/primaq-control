import { enqueue } from "./sync-queue";
import { getDeviceId } from "./device-registry";
import { dbSet } from "@/lib/db";
import type { DailySummary } from "@/features/pos/pos-types";

export const SALES_STATE_META_KEY = "primaq-pos-state-meta";

export async function enqueueSalesStateSync(daily: DailySummary): Promise<void> {
  console.log("[SalesSync 2] enqueueSalesStateSync called", `| date=${daily.date}`, `| orderCount=${daily.orderCount}`, `| totalCents=${daily.totalCents}`);

  try {
    const deviceId = await getDeviceId();
    console.log("[Sync:2] deviceId ermittelt:", deviceId.slice(0, 8));

    const updatedAt = new Date().toISOString();
    await dbSet(SALES_STATE_META_KEY, JSON.stringify({ updatedAt, date: daily.date }));
    console.log("[Sync:3] Meta-Key geschrieben:", SALES_STATE_META_KEY, updatedAt);

    const opId = await enqueue({
      entity: "pos_sales_state",
      operation: "upsert",
      payload: JSON.stringify({
        businessId: "default",
        businessDate: daily.date,
        daily,
        updatedAt,
      }),
      deviceId,
    });
    console.log("[SalesSync 3] SyncOp created", `| opId=${opId}`, "| entity=pos_sales_state");

    // SCHRITT 5 – Auto-Flush triggern
    if (typeof window !== "undefined") {
      console.log("[Sync:5] Dispatche primaq-sales-state-enqueued");
      window.dispatchEvent(new CustomEvent("primaq-sales-state-enqueued"));
    }
  } catch (err) {
    // Fehler explizit loggen – niemals den POS-Fluss stören
    console.error("[Sync] enqueueSalesStateSync FEHLER:", err);
  }
}
