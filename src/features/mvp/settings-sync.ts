import { supabase } from "@/lib/supabase";
import type { MvpState } from "./types";

const SETTINGS_ROW_KEY = "primaq-settings";

type CloudSettings = Partial<MvpState> & {
  updatedAt?: string;
};

function mergeSettings(next: CloudSettings, existing: CloudSettings | null): CloudSettings {
  if (!existing) return next;

  const keepMachines =
    Array.isArray(next.machines) &&
    next.machines.length === 0 &&
    Array.isArray(existing.machines) &&
    existing.machines.length > 0;

  return {
    ...existing,
    ...next,
    machines: keepMachines ? existing.machines : next.machines,
    updatedAt: new Date().toISOString()
  };
}

export async function syncSettingsToCloud(state: MvpState) {
  try {
    const nextValue: CloudSettings = {
      machines: state.machines,
      softServeItems: state.softServeItems,
      stockFlavors: state.stockFlavors,
      portionWeights: state.portionWeights,
      aromas: state.aromas,
      packagingSizes: state.packagingSizes,
      productSettings: state.productSettings,
      salesLayout: state.salesLayout,
      toppings: state.toppings,
      recipeTemplates: state.recipeTemplates,
      sumupSettings: state.sumupSettings,
      favorites: state.favorites,
      updatedAt: new Date().toISOString()
    };

    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", SETTINGS_ROW_KEY)
      .maybeSingle();

    const value = mergeSettings(nextValue, (data?.value as CloudSettings | null) ?? null);

    const { error } = await supabase
      .from("settings")
      .upsert(
        {
          key: SETTINGS_ROW_KEY,
          value
        },
        { onConflict: "key" }
      );

    if (error) {
      console.warn("Supabase settings sync failed", error);
    }
  } catch (error) {
    console.warn("Supabase settings sync unavailable", error);
  }
}

export async function loadSettingsFromCloud(): Promise<Partial<MvpState> | null> {
  try {
    const { data, error } = await supabase
      .from("settings")
      .select("value")
      .eq("key", SETTINGS_ROW_KEY)
      .maybeSingle();

    if (error) {
      console.warn("Supabase settings load failed", error);
      return null;
    }

    return (data?.value as Partial<MvpState>) ?? null;
  } catch (error) {
    console.warn("Supabase settings load unavailable", error);
    return null;
  }
}
