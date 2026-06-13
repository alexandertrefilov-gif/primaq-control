import { formatCurrency } from "./calculations";
import type { MvpTotals } from "./types";

type TotalsSummaryProps = {
  totals: MvpTotals;
  startingCashCents?: number;
  endCashCents?: number;
};

export function TotalsSummary({ totals, startingCashCents = 0, endCashCents }: TotalsSummaryProps) {
  const expectedCashInDrawer = startingCashCents + totals.cashCents;
  const difference = typeof endCashCents === "number" ? endCashCents - expectedCashInDrawer : 0;

  return (
    <section className="grid gap-3 rounded-lg border border-black/10 bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-3">
      <Metric label="Gesamtstuecke" value={`${totals.totalPieces}`} />
      <Metric label="Erwarteter Umsatz" value={formatCurrency(totals.expectedRevenueCents)} />
      <Metric label="Bar" value={formatCurrency(totals.cashCents)} />
      <Metric label="Karte" value={formatCurrency(totals.cardCents)} />
      <Metric label="Gratis" value={formatCurrency(totals.freeCents)} />
      <Metric label="Storno" value={formatCurrency(totals.cancelCents)} />
      <Metric label="Startgeld" value={formatCurrency(startingCashCents)} />
      <Metric label="Endgeld" value={typeof endCashCents === "number" ? formatCurrency(endCashCents) : "offen"} />
      <Metric label="Differenz" value={typeof endCashCents === "number" ? formatCurrency(difference) : "offen"} highlight />
    </section>
  );
}

function Metric({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${highlight ? "bg-primaq-50" : "bg-[#fbfcf8]"}`}>
      <p className="text-xs font-semibold uppercase text-black/50">{label}</p>
      <p className="mt-1 text-xl font-bold text-ink">{value}</p>
    </div>
  );
}
