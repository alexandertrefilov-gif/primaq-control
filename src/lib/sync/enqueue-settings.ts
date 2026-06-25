import { enqueue } from "./sync-queue";
import { getDeviceId } from "./device-registry";
import { dbSet } from "@/lib/db";

/**
 * Fire-and-forget: enqueue a full settings snapshot for Supabase sync.
 * Also persists an updated_at metadata entry used for pull conflict resolution.
 * Errors are silently swallowed so they can never disrupt the local POS flow.
 */
export async function enqueueSettingsSync(
  settingsKey: string,
  data: unknown,
): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    const updatedAt = new Date().toISOString();
    await dbSet(`${settingsKey}-meta`, JSON.stringify({ updatedAt, deviceId }));
    await enqueue({
      entity: "pos_settings",
      operation: "upsert",
      payload: JSON.stringify({
        businessId: "default",
        deviceId,
        settingsKey,
        data,
        updatedAt,
      }),
      deviceId,
    });
  } catch {
    // sync errors must never disrupt the local POS flow
  }
}
