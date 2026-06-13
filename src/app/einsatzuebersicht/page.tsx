import { PageHeader } from "@/components/ui/page-header";
import { EinsatzOverviewClient } from "@/features/mvp/einsatz-overview-client";

export default function EinsatzuebersichtPage() {
  return (
    <>
      <PageHeader
        title="Einsatzuebersicht"
        description="Alle lokal gespeicherten Einsaetze eines Jahres mit Status, Umsatz, Team und Abschlussdaten."
      />
      <EinsatzOverviewClient />
    </>
  );
}
