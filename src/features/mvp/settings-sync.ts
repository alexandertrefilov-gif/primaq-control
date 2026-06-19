import { supabase } from "@/lib/supabase";
import type { MvpState } from "./types";

export const SETTINGS_ROW_KEY = "primaq-settings";

export type CloudSettings = Partial<MvpState> & {
  updatedAt?: string;
  // Zeitstempel des letzten lokalen Maschinen-Schreibvorgangs zum Zeitpunkt des Uploads.
  // Identisch mit localStorage["primaq-machines-local-at"] beim Aufruf von syncSettingsToCloud.
  // Wird von loadSettingsFromCloud und den BroadcastChannel-Empfängern genutzt, um zu
  // entscheiden, ob lokale oder Cloud-Maschinen neuer sind (skipMachines-Logik).
  machinesWrittenAt?: string;
};

const MACHINES_LOCAL_AT_KEY = "primaq-machines-local-at";

// Schreibt den kompletten Settings-Block direkt in Supabase – kein GET, kein Merge.
// Lokale Daten sind immer autoritativ; die Queue (settingsSyncQueue) stellt sicher,
// dass parallele Aufrufe sequenziell ausgeführt werden.
// forceOverwrite=true (Werksreset): führt zusätzlich eine Lese-Verifikation durch.
export async function syncSettingsToCloud(state: MvpState, options?: { forceOverwrite?: boolean }) {
  try {
    const machinesWrittenAt = typeof window !== "undefined"
      ? (window.localStorage.getItem(MACHINES_LOCAL_AT_KEY) ?? undefined)
      : undefined;

    const value: CloudSettings = {
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
      machinesWrittenAt,
      updatedAt: new Date().toISOString()
    };

    const { error } = await supabase
      .from("settings")
      .upsert({ key: SETTINGS_ROW_KEY, value }, { onConflict: "key" });

    if (error) {
      console.warn("Supabase settings sync failed", error);
    }

    if (options?.forceOverwrite) {
      const { data, error: verifyError } = await supabase
        .from("settings")
        .select("value")
        .eq("key", SETTINGS_ROW_KEY)
        .maybeSingle();

      if (verifyError) throw verifyError;

      const persistedMachines = (data?.value as CloudSettings | null)?.machines;
      if (JSON.stringify(persistedMachines ?? null) !== JSON.stringify(value.machines ?? null)) {
        throw new Error("Supabase settings reset verification failed");
      }
    }
  } catch (error) {
    console.warn("Supabase settings sync unavailable", error);
    if (options?.forceOverwrite) throw error;
  }
}

export async function loadSettingsFromCloud(): Promise<CloudSettings | null> {
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

    return (data?.value as CloudSettings) ?? null;
  } catch (error) {
    console.warn("Supabase settings load unavailable", error);
    return null;
  }
}

// Realtime für Settings deaktiviert – verhindert Echo-Loop und Auto-Overwrite während
// der Bearbeitung. Settings werden beim Mount einmalig aus der Cloud geladen
// (loadSettingsFromCloud) und bei Tab-Wechsel nachgeladen (visibilitychange-Handler).
export function subscribeToSettingsRealtime(
  _onUpdate: (settings: CloudSettings) => void
): () => void {
  return () => {};
}
