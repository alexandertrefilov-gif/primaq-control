import { PageHeader } from "@/components/ui/page-header";
import { SettingsClient } from "@/features/mvp/settings-client";
import { AdminRequired } from "@/features/pos/admin-context";
import { PosFlavorSettings } from "@/features/pos/pos-flavor-settings";

export default function EinstellungenPage() {
  return (
    <AdminRequired>
      <PageHeader
        title="Sorten"
        description="Verkaufssorten konfigurieren – Name, Farbe, Bild und Maschinen-Zuordnung."
      />
      <PosFlavorSettings legacySettings={<SettingsClient />} />
    </AdminRequired>
  );
}
