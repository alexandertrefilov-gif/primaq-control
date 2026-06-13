import { PageHeader } from "@/components/ui/page-header";
import { VerkaufClient } from "@/features/mvp/verkauf-client";

export default function VerkaufPage() {
  return (
    <>
      <PageHeader
        title="Verkauf"
        description="Live-Zaehler fuer Softeis, Toppings und Zahlungsarten mit lokaler Speicherung."
      />
      <VerkaufClient />
    </>
  );
}
