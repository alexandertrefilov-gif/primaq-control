import { getDb, type SyncOp } from "@/lib/db";

export type { SyncOp };

type EnqueueInput = Omit<SyncOp, "id" | "createdAt" | "retryCount" | "status">;

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Add a new operation to the sync queue with status "pending". */
export async function enqueue(input: EnqueueInput): Promise<string> {
  const op: SyncOp = {
    ...input,
    id: newId(),
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: "pending",
  };
  await getDb().sync_queue.put(op);
  return op.id;
}

/** Return all operations with status "pending" ordered by createdAt. */
export async function getPending(): Promise<SyncOp[]> {
  const ops = await getDb().sync_queue
    .where("status")
    .equals("pending")
    .toArray();
  return ops.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Remove successfully synced operations from the queue. */
export async function ack(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await getDb().sync_queue.bulkDelete(ids);
}

/** Return pending and permanently-failed operation counts. */
export async function getQueueStats(): Promise<{ pending: number; failed: number }> {
  const all = await getDb().sync_queue.toArray();
  return {
    pending: all.filter((o) => o.status === "pending").length,
    failed: all.filter((o) => o.status === "failed").length,
  };
}

/**
 * Increment retryCount for a failed operation.
 * If retryCount reaches 3, status is set to "failed" so it is excluded from
 * getPending() and won't be retried automatically.
 */
/** Delete all queue entries (any status) belonging to the given entity names. */
export async function removeByEntities(entities: string[]): Promise<void> {
  if (entities.length === 0) return;
  const all = await getDb().sync_queue.toArray();
  const ids = all.filter((op) => entities.includes(op.entity)).map((op) => op.id);
  if (ids.length > 0) await getDb().sync_queue.bulkDelete(ids);
}

export async function markFailed(id: string): Promise<void> {
  const op = await getDb().sync_queue.get(id);
  if (!op) return;
  await getDb().sync_queue.put({
    ...op,
    retryCount: op.retryCount + 1,
    status: op.retryCount + 1 >= 3 ? "failed" : "pending",
  });
}
