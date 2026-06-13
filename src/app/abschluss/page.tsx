import { PageHeader } from "@/components/ui/page-header";
import { TagesabschlussClient } from "@/features/mvp/tagesabschluss-client";

export default function AbschlussPage() {
  return (
    <>
      <PageHeader
        title="Abschluss"
        description="Tagesbericht mit Umsatz, Zahlungsarten, Stueckzahlen, Teamdaten und Export."
      />
      <TagesabschlussClient />
    </>
  );
}
