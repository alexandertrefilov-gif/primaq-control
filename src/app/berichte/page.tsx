import { PageHeader } from "@/components/ui/page-header";
import { ReportsClient } from "@/features/mvp/reports-client";

export default function BerichtePage() {
  return (
    <>
      <PageHeader
        title="Berichte"
        description="Tagesberichte, Monatsuebersicht, MwSt-Aufteilung und vorbereitender Steuerberater-Export."
      />
      <ReportsClient />
    </>
  );
}
