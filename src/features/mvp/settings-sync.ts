import { supabase } from "@/lib/supabase";
import type { MvpState } from "./types";

export const SETTINGS_ROW_KEY = "primaq-settings";

export type CloudSettings = Partial<MvpState> & {
  updatedAt?: string;
};

// machinesLocalAtKey muss identisch mit dem Wert in use-mvp-store.ts sein.
// Kein Re-Export dort möglich (zirkuläre Abhängigkeit), daher hier hartcodiert.
const MACHINES_LOCAL_AT_KEY = "primaq-machines-local-at";

// machinesLocalAt wird als Snapshot von syncSettingsToCloud übergeben – gelesen VOR dem
// async Supabase-Read, damit parallel laufende Aufrufe nicht den Wert eines später
// gesetzten machinesLocalAtKey (z. B. durch deleteMachine) lesen und irrtümlich
// useLocalMachines = true mit veralteten Maschinen auslösen.
function mergeSettings(next: CloudSettings, existing: CloudSettings | null, machinesLocalAt: string | null): CloudSettings {
  if (!existing) return next;

  const cloudAt = existing.updatedAt;
  const useLocalMachines = !!(machinesLocalAt && (!cloudAt || machinesLocalAt >= cloudAt));

  return {
    ...existing,
    ...next,
    machines: useLocalMachines ? next.machines : (existing.machines ?? next.machines),
    updatedAt: new Date().toISOString()
  };
}

export async function syncSettingsToCloud(state: MvpState, options?: { forceOverwrite?: boolean }) {
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

    let value: CloudSettings;
    if (options?.forceOverwrite) {
      // Beim Reset direkt überschreiben, ohne mergeSettings – dadurch können
      // z. B. nach einem Werksreset auch leere Maschinenlisten ([]) dauerhaft
      // in der Cloud gesetzt werden.
      value = nextValue;
    } else {
      // Snapshot VOR dem async Supabase-Read: spätere Änderungen an machinesLocalAt
      // (z. B. durch deleteMachine während dieses Calls noch läuft) dürfen diesen
      // Aufruf nicht beeinflussen.
      const machinesLocalAt = typeof window !== "undefined" ? window.localStorage.getItem(MACHINES_LOCAL_AT_KEY) : null;

      const { data } = await supabase
        .from("settings")
        .select("value")
        .eq("key", SETTINGS_ROW_KEY)
        .maybeSingle();

      value = mergeSettings(nextValue, (data?.value as CloudSettings | null) ?? null, machinesLocalAt);
    }

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

// Abonniert Echtzeit-Änderungen der settings-Zeile in Supabase Realtime.
// Nur Einstellungsfelder werden synchronisiert – keine Verkaufs- oder Einsatzdaten.
// Gibt eine Cleanup-Funktion zurück (für React useEffect return).
export function subscribeToSettingsRealtime(
  onUpdate: (settings: CloudSettings) => void
): () => void {
  try {
    const channel = supabase
      .channel("primaq-settings-realtime")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "settings",
          filter: `key=eq.${SETTINGS_ROW_KEY}`
        },
        (payload) => {
          try {
            const row = payload.new as { value?: unknown };
            const settings = row.value as CloudSettings | null | undefined;
            if (settings) {
              onUpdate(settings);
            }
          } catch (err) {
            console.warn("[Realtime] Error processing settings update:", err);
          }
        }
      )
      .subscribe((status, err) => {
        if (err) {
          console.warn("[Realtime] Channel status:", status, err);
        }
      });

    return () => {
      void supabase.removeChannel(channel).catch(() => {});
    };
  } catch (err) {
    console.warn("[Realtime] Could not subscribe to settings:", err);
    return () => {};
  }
}
