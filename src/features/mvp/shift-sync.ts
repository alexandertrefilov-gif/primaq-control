import { supabase } from "@/lib/supabase";
import type { MvpState } from "./types";

const SHIFT_ROW_KEY = "primaq-shift-state";

export async function syncShiftStateToCloud(state: MvpState) {
  try {
    const value = {
      activeShift: state.activeShift,
      consumptionEntries: state.consumptionEntries,
      mixStocks: state.mixStocks,
      mixStockMovements: state.mixStockMovements,
      dayReport: state.dayReport,
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

export async function loadShiftStateFromCloud(): Promise<Partial<MvpState> | null> {
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

    return (data?.value as Partial<MvpState>) ?? null;
  } catch (error) {
    console.warn("Supabase shift load unavailable", error);
    return null;
  }
}
