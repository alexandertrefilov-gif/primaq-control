import { PageHeader } from "@/components/ui/page-header";
import { SettingsClient } from "@/features/mvp/settings-client";

export default function EinstellungenPage() {
  return (
    <>
      <PageHeader
        title="Einstellungen"
        description="Produktpreise, MwSt-Sätze und aktive Produkte für Verkauf und Berichte."
      />
      <SettingsClient />
    </>
  );
}
