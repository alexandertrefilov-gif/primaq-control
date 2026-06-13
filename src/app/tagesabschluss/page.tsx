import { PageHeader } from "@/components/ui/page-header";
import { TagesabschlussClient } from "@/features/mvp/tagesabschluss-client";

export default function TagesabschlussPage() {
  return (
    <>
      <PageHeader
        title="Tagesabschluss"
        description="Tagesbericht mit Umsatz, Zahlungsarten, Stueckzahlen, Teamdaten und Export."
      />
      <TagesabschlussClient />
    </>
  );
}
