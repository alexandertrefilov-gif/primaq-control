import { PageHeader } from "@/components/ui/page-header";
import { WochenberichtClient } from "@/features/pos/wochenbericht-client";

export default function WochenberichtPage() {
  return (
    <>
      <PageHeader
        title="Wochenbericht"
        description="Wöchentliche Umsatzübersicht mit Tagesauflösung – navigiere zwischen Kalenderwochen und exportiere als CSV."
      />
      <WochenberichtClient />
    </>
  );
}
