"use client";

import { DayClose } from "./day-close";
import { useMvpStore } from "./use-mvp-store";

export function TagesabschlussClient() {
  const { activeShift, hydrated, totals, inventoryReport, taxReport, materialCostReport, dayReport, createDayReport } = useMvpStore();

  return (
    <DayClose
      activeShift={activeShift}
      totals={totals}
      inventoryReport={inventoryReport}
      taxReport={taxReport}
      materialCostReport={materialCostReport}
      dayReport={dayReport}
      onCreateReport={createDayReport}
    />
  );
}
