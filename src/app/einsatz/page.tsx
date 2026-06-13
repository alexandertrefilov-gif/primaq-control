import { PageHeader } from "@/components/ui/page-header";
import { EinsatzClient } from "@/features/mvp/einsatz-client";

export default function EinsatzPage() {
  return (
    <>
      <PageHeader
        title="Einsatz"
        description="Starte den Verkaufstag mit Standort, Verkaufsbereich, Team und Start-Bargeld."
      />
      <EinsatzClient />
    </>
  );
}
