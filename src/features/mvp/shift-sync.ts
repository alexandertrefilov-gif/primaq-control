import { supabase } from "@/lib/supabase";
import type { MvpState } from "./types";

const SHIFT_ROW_KEY = "primaq-shift-state";
// Identisch mit localStorage["primaq-shift-local-at"] beim Aufruf von syncShiftStateToCloud.
// Wird von loadShiftStateFromCloud genutzt, um zu entscheiden, ob lokale oder Cloud-Shift-Daten
// neuer sind (analog zu inventoryWrittenAt/machinesWrittenAt) — verhindert, dass ein gerade
// lokal beendeter/gelöschter Einsatz durch einen noch nicht synchronisierten Cloud-Stand
// nach einem Reload wieder als aktiv erscheint.
const SHIFT_LOCAL_AT_KEY = "primaq-shift-local-at";

export type CloudShiftState = Partial<MvpState> & {
  updatedAt?: string;
  shiftWrittenAt?: string;
};

export async function syncShiftStateToCloud(state: MvpState) {
  try {
    const shiftWrittenAt = typeof window !== "undefined"
      ? (window.localStorage.getItem(SHIFT_LOCAL_AT_KEY) ?? undefined)
      : undefined;

    const value: CloudShiftState = {
      activeShift: state.activeShift,
      consumptionEntries: state.consumptionEntries,
      mixStocks: state.mixStocks,
      mixStockMovements: state.mixStockMovements,
      dayReport: state.dayReport,
      shiftWrittenAt,
      updatedAt: new Date().toISOString()
    };

    const { error } = await supabase
      .from("shift_state")
      .upsert({ key: SHIFT_ROW_KEY, value }, { onConflict: "key" });

    if (error) console.warn("Supabase shift sync failed", error);
  } catch (error) {
    console.warn("Supabase shift sync unavailable", error);
  }
}

export async function loadShiftStateFromCloud(): Promise<CloudShiftState | null> {
  try {
    const { data, error } = await supabase
      .from("shift_state")
      .select("value")
      .eq("key", SHIFT_ROW_KEY)
      .maybeSingle();

    if (error) {
      console.warn("Supabase shift load failed", error);
      return null;
    }

    return (data?.value as CloudShiftState) ?? null;
  } catch (error) {
    console.warn("Supabase shift load unavailable", error);
    return null;
  }
}
