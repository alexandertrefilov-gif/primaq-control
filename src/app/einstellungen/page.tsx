import { SettingsClient } from "@/features/mvp/settings-client";
import { AdminRequired } from "@/features/pos/admin-context";
import { EinstellungenTabs } from "@/features/pos/einstellungen-tabs";

export default function EinstellungenPage() {
  return (
    <AdminRequired>
      <EinstellungenTabs legacySettings={<SettingsClient />} />
    </AdminRequired>
  );
}
