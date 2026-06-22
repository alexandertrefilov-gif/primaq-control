"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { PosFlavorSettings } from "./pos-flavor-settings";
import { PosLayoutSettings } from "./pos-layout-settings";

type Tab = "sorten" | "oberflaeche";

const TABS: { id: Tab; label: string }[] = [
  { id: "sorten", label: "Sorten" },
  { id: "oberflaeche", label: "Verkaufsoberfläche" },
];

export function EinstellungenTabs({ legacySettings }: { legacySettings: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>("sorten");

  return (
    <div>
      <div className="mb-5 flex gap-1 rounded-2xl bg-black/5 p-1">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex-1 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors",
              tab === id ? "bg-white text-ink shadow-sm" : "text-black/50 hover:text-black/70"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "sorten" && (
        <>
          <PageHeader
            title="Sorten"
            description="Verkaufssorten konfigurieren – Name, Farbe, Bild und Maschinen-Zuordnung."
          />
          <PosFlavorSettings legacySettings={legacySettings} />
        </>
      )}

      {tab === "oberflaeche" && (
        <>
          <PageHeader
            title="Verkaufsoberfläche"
            description="Reihenfolge und Größe der Kassenbereiche anpassen – ohne Programmierung."
          />
          <PosLayoutSettings />
        </>
      )}
    </div>
  );
}
