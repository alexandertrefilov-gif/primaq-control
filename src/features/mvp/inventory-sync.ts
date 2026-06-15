import { supabase } from "@/lib/supabase";
import type { MvpState } from "./types";

const INVENTORY_ROW_KEY = "primaq-inventory";

type CloudInventory = Partial<MvpState> & {
  updatedAt?: string;
};

function hasItems(value: unknown) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function hasArrayItems(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

function mergeInventory(next: CloudInventory, existing: CloudInventory | null): CloudInventory {
  if (!existing) return next;

  return {
    ...existing,
    ...next,
    inventory: hasItems(next.inventory) ? next.inventory : existing.inventory,
    generalStock: hasItems(next.generalStock) ? next.generalStock : existing.generalStock,
    generalStockMovements: hasItems(next.generalStockMovements) ? next.generalStockMovements : existing.generalStockMovements,
    inventoryMovements: hasItems(next.inventoryMovements) ? next.inventoryMovements : existing.inventoryMovements,
    materialCategories: hasArrayItems(next.materialCategories) ? next.materialCategories : existing.materialCategories,
    materialItems: hasItems(next.materialItems) ? next.materialItems : existing.materialItems,
    shiftMaterialAssignments: hasArrayItems(next.shiftMaterialAssignments)
      ? next.shiftMaterialAssignments
      : existing.shiftMaterialAssignments,
    updatedAt: new Date().toISOString()
  };
}

export async function syncInventoryToCloud(state: MvpState) {
  try {
    const nextValue: CloudInventory = {
      inventory: state.inventory,
      generalStock: state.generalStock,
      generalStockMovements: state.generalStockMovements,
      inventoryMovements: state.inventoryMovements,
      materialCategories: state.materialCategories,
      materialItems: state.materialItems,
      shiftMaterialAssignments: state.shiftMaterialAssignments,
      updatedAt: new Date().toISOString()
    };

    const { data } = await supabase
      .from("inventory")
      .select("value")
      .eq("key", INVENTORY_ROW_KEY)
      .maybeSingle();

    const value = mergeInventory(nextValue, (data?.value as CloudInventory | null) ?? null);

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
