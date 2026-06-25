import type { MvpState } from "./types";

export const SETTINGS_ROW_KEY = "primaq-settings";

export type CloudSettings = Partial<MvpState> & {
  updatedAt?: string;
  machinesWrittenAt?: string;
  settingsWrittenAt?: string;
};

// Disabled: public.settings has an incompatible schema (key/value store).
// New POS sync uses public.pos_settings exclusively via src/lib/sync/.
// All three functions are intentional no-ops to prevent write errors.

export async function syncSettingsToCloud(
  _state: MvpState,
  _options?: { forceOverwrite?: boolean }
): Promise<void> {}

export async function loadSettingsFromCloud(): Promise<CloudSettings | null> {
  return null;
}

export function subscribeToSettingsRealtime(
  _onUpdate: (settings: CloudSettings) => void
): () => void {
  return () => {};
}
