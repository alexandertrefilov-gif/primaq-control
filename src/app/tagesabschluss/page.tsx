import { PageHeader } from "@/components/ui/page-header";
import { DailyClosePage } from "@/features/pos/daily-close-page";

export default function TagesabschlussPage() {
  return (
    <>
      <PageHeader
        title="Tagesabschluss"
        description="Tagesumsatz, Zahlungsarten und CSV-Export."
      />
      <DailyClosePage />
    </>
  );
}
