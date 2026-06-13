import { PageHeader } from "@/components/ui/page-header";
import { BestellungClient } from "@/features/mvp/bestellung-client";

export default function BestellungPage() {
  return (
    <>
      <PageHeader
        title="Bestellung"
        description="Aktuelle Bestellung prüfen, Zahlungsart wählen und Abschluss buchen."
      />
      <BestellungClient />
    </>
  );
}
