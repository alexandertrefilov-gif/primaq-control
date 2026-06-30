import { BerichteClient } from "@/features/pos/berichte-client";
import { PageHeader } from "@/components/ui/page-header";

export default function BerichtePage() {
  return (
    <>
      <PageHeader
        title="Berichte"
        description="Tagesabschluss, Wochen-, Monats- und Jahresabschluss auf einen Blick."
      />
      <BerichteClient />
    </>
  );
}
