import { PageHeader } from "@/components/ui/page-header";
import { YearCloseClient } from "@/features/mvp/year-close-client";

export default function JahresabschlussPage() {
  return (
    <>
      <PageHeader
        title="Jahresabschluss"
        description="Jahresuebersicht fuer Steuerberater-Export, Einsaetze, Verkaeufe, Lager und MwSt-Auswertung."
      />
      <YearCloseClient />
    </>
  );
}
