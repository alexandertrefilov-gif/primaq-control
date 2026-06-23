import { PageHeader } from "@/components/ui/page-header";
import { JahresabschlussClient } from "@/features/pos/jahresabschluss-client";

export default function JahresabschlussPage() {
  return (
    <>
      <PageHeader
        title="Jahresabschluss"
        description="Jahresübersicht für den Steuerberater – Umsatz, Zahlungsarten, Monatswerte und Artikel-Statistik mit Export."
      />
      <JahresabschlussClient />
    </>
  );
}
