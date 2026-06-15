import { supabase } from "@/lib/supabase";
import type { MvpState } from "./types";

const SALES_ROW_KEY = "primaq-sales-state";

export async function syncSalesStateToCloud(state: MvpState) {
  try {
    const value = {
      currentOrder: state.currentOrder,
      openOrders: state.openOrders,
      activeOrderId: state.activeOrderId,
      dailySales: state.dailySales,
      completedOrders: state.completedOrders,
      transactions: state.transactions,
      dayReport: state.dayReport,
      updatedAt: new Date().toISOString()
    };

    const { error } = await supabase
      .from("sales_state")
      .upsert({ key: SALES_ROW_KEY, value }, { onConflict: "key" });

    if (error) console.warn("Supabase sales sync failed", error);
  } catch (error) {
    console.warn("Supabase sales sync unavailable", error);
  }
}

export async function loadSalesStateFromCloud(): Promise<Partial<MvpState> | null> {
  try {
    const { data, error } = await supabase
      .from("sales_state")
      .select("value")
      .eq("key", SALES_ROW_KEY)
      .maybeSingle();

    if (error) {
      console.warn("Supabase sales load failed", error);
      return null;
    }

    return (data?.value as Partial<MvpState>) ?? null;
  } catch (error) {
    console.warn("Supabase sales load unavailable", error);
    return null;
  }
}
