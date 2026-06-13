import { PageHeader } from "@/components/ui/page-header";
import { MvpDashboard } from "@/features/mvp/mvp-dashboard";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live-Uebersicht fuer den aktuellen Softeis-Einsatz mit lokal gespeicherten Verkaufsdaten."
      />
      <MvpDashboard />
    </>
  );
}
