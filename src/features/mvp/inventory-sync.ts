import { supabase } from "@/lib/supabase";
import type { MvpState } from "./types";

const INVENTORY_ROW_KEY = "primaq-inventory";

export async function syncInventoryToCloud(state: MvpState) {
  try {
    const value = {
      inventory: state.inventory,
      generalStock: state.generalStock,
      generalStockMovements: state.generalStockMovements,
      inventoryMovements: state.inventoryMovements,
      materialCategories: state.materialCategories,
      materialItems: state.materialItems,
      shiftMaterialAssignments: state.shiftMaterialAssignments,
      updatedAt: new Date().toISOString()
    };

    const { error } = await supabase
      .from("inventory")
      .upsert(
        {
          key: INVENTORY_ROW_KEY,
          value
        },
        { onConflict: "key" }
      );

    if (error) {
      console.warn("Supabase inventory sync failed", error);
    }
  } catch (error) {
    console.warn("Supabase inventory sync unavailable", error);
  }
}

export async function loadInventoryFromCloud(): Promise<Partial<MvpState> | null> {
  try {
    const { data, error } = await supabase
      .from("inventory")
      .select("value")
      .eq("key", INVENTORY_ROW_KEY)
      .maybeSingle();

    if (error) {
      console.warn("Supabase inventory load failed", error);
      return null;
    }

    return (data?.value as Partial<MvpState>) ?? null;
  } catch (error) {
    console.warn("Supabase inventory load unavailable", error);
    return null;
  }
}
