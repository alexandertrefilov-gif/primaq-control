import { enqueue } from "./sync-queue";
import { getDeviceId } from "./device-registry";
import { dbSet } from "@/lib/db";
import type { DailySummary } from "@/features/pos/pos-types";

export const SALES_STATE_META_KEY = "primaq-pos-state-meta";

/**
 * Fire-and-forget: enqueue the current daily sales snapshot for Supabase sync.
 * Writes a metadata entry used for pull conflict resolution (Last Write Wins).
 * Errors are silently swallowed so they can never disrupt the local POS flow.
 */
export async function enqueueSalesStateSync(daily: DailySummary): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    const updatedAt = new Date().toISOString();
    await dbSet(SALES_STATE_META_KEY, JSON.stringify({ updatedAt, date: daily.date }));
    await enqueue({
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
    console.log(
      `[Sync] enqueueSalesStateSync OK`,
      `| date=${daily.date}`,
      `| orderCount=${daily.orderCount}`,
      `| totalCents=${daily.totalCents}`,
    );
    // Signal SyncFoundation to flush immediately — without this, the op would
    // stay in the queue until the user clicks "Jetzt synchronisieren" manually.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("primaq-sales-state-enqueued"));
    }
  } catch {
    // sync errors must never disrupt the local POS flow
  }
}
