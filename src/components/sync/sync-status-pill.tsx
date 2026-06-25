"use client";

import { useSyncStatus } from "./use-sync-status";
import type { SyncStatus, SyncStats } from "@/lib/sync/sync-service";
import { cn } from "@/lib/utils";

type Display = {
  text: string;
  dot: string;
  bg: string;
  text_color: string;
  animate?: boolean;
};

function deriveDisplay(status: SyncStatus, stats: SyncStats): Display | null {
  switch (status) {
    case "offline":
      return {
        text: "Offline",
        dot: "bg-zinc-400",
        bg: "bg-zinc-100",
        text_color: "text-zinc-600",
      };
    case "syncing":
      return {
        text: "Synchronisiert…",
        dot: "bg-blue-500",
        bg: "bg-blue-50",
        text_color: "text-blue-700",
        animate: true,
      };
    case "error":
      return {
        text: "Fehler",
        dot: "bg-red-500",
        bg: "bg-red-50",
        text_color: "text-red-700",
      };
    case "pending":
      return {
        text: `${stats.pendingCount} ausstehend`,
        dot: "bg-amber-500",
        bg: "bg-amber-50",
        text_color: "text-amber-700",
      };
    case "idle":
      if (stats.lastSyncAt) {
        return {
          text: "Synchronisiert",
          dot: "bg-green-500",
          bg: "bg-green-50",
          text_color: "text-green-700",
        };
      }
      return null;
    default:
      return null;
  }
}

export function SyncStatusPill() {
  const { status, stats } = useSyncStatus();
  const display = deriveDisplay(status, stats);

  if (!display) return null;

  return (
    <div
      data-testid="sync-status-pill"
      data-sync-status={status}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        display.bg,
        display.text_color
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", display.dot, display.animate && "animate-pulse")}
      />
      {display.text}
    </div>
  );
}
