import { PageHeader } from "@/components/ui/page-header";
import { MonatsberichtClient } from "@/features/pos/monatsbericht-client";

export default function MonatsberichtPage() {
  return (
    <>
      <PageHeader
        title="Monatsbericht"
        description="Monatliche Umsatzübersicht mit Tagesauflösung – navigiere zwischen Monaten und exportiere als CSV."
      />
      <MonatsberichtClient />
    </>
  );
}
