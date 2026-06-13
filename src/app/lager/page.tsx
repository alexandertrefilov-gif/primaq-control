import { PageHeader } from "@/components/ui/page-header";
import { InventoryClient } from "@/features/mvp/inventory-client";

export default function LagerPage() {
  return (
    <>
      <PageHeader
        title="Lager"
        description="Lagerbestand und Nachfüllungen"
      />
      <InventoryClient />
    </>
  );
}
