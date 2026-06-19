import { supabase } from "@/lib/supabase";
import type { MvpState } from "./types";

const INVENTORY_ROW_KEY = "primaq-inventory";
const INVENTORY_LOCAL_AT_KEY = "primaq-inventory-local-at";

export type CloudInventory = Partial<MvpState> & {
  updatedAt?: string;
  // Zeitstempel des letzten lokalen Lager-Schreibvorgangs.
  // Identisch mit localStorage["primaq-inventory-local-at"] beim Aufruf von syncInventoryToCloud.
  // Wird von loadInventoryFromCloud genutzt, um zu entscheiden, ob lokale oder
  // Cloud-Lagerdaten neuer sind (skipInventory-Logik, analog zu machinesWrittenAt).
  inventoryWrittenAt?: string;
};

function mergeInventory(next: CloudInventory, existing: CloudInventory | null): CloudInventory {
  if (!existing) return next;

  const nextAt = next.inventoryWrittenAt;
  const existingAt = existing.inventoryWrittenAt;

  // Wenn lokale Daten neuer sind (oder Cloud-Eintrag hat keinen Timestamp),
  // gewinnt die lokale Version – auch bei leeren Objekten/Arrays (korrekte Lösch-Semantik).
  if (nextAt && (!existingAt || existingAt <= nextAt)) {
    return { ...existing, ...next, updatedAt: new Date().toISOString() };
  }

  // Cloud ist neuer (z. B. anderes Gerät hat zwischenzeitlich Lager geändert).
  // Beide Seiten mergen, damit keine Daten verloren gehen.
  return {
    ...existing,
    ...next,
    inventory: next.inventory ?? existing.inventory,
    generalStock: next.generalStock ?? existing.generalStock,
    generalStockMovements: next.generalStockMovements ?? existing.generalStockMovements,
    inventoryMovements: next.inventoryMovements ?? existing.inventoryMovements,
    materialCategories: next.materialCategories ?? existing.materialCategories,
    materialItems: next.materialItems ?? existing.materialItems,
    shiftMaterialAssignments: next.shiftMaterialAssignments ?? existing.shiftMaterialAssignments,
    updatedAt: new Date().toISOString()
  };
}

export async function syncInventoryToCloud(state: MvpState, options?: { forceOverwrite?: boolean }) {
  try {
    const inventoryWrittenAt = typeof window !== "undefined"
      ? (window.localStorage.getItem(INVENTORY_LOCAL_AT_KEY) ?? undefined)
      : undefined;

    const nextValue: CloudInventory = {
      inventory: state.inventory,
      generalStock: state.generalStock,
      generalStockMovements: state.generalStockMovements,
      inventoryMovements: state.inventoryMovements,
      materialCategories: state.materialCategories,
      materialItems: state.materialItems,
      shiftMaterialAssignments: state.shiftMaterialAssignments,
      inventoryWrittenAt,
      updatedAt: new Date().toISOString()
    };

    let value: CloudInventory;
    if (options?.forceOverwrite) {
      // Beim Reset direkt überschreiben, ohne mergeInventory – dadurch können
      // auch leere Objekte ({}) dauerhaft in der Cloud gesetzt werden.
      value = nextValue;
    } else {
      const { data } = await supabase
        .from("inventory")
        .select("value")
        .eq("key", INVENTORY_ROW_KEY)
        .maybeSingle();

      value = mergeInventory(nextValue, (data?.value as CloudInventory | null) ?? null);
    }

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

export async function loadInventoryFromCloud(): Promise<CloudInventory | null> {
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

    return (data?.value as CloudInventory) ?? null;
  } catch (error) {
    console.warn("Supabase inventory load unavailable", error);
    return null;
  }
}
