"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdmin } from "./admin-context";
import { useReportPermissionsStore } from "./use-report-permissions-store";
import { usePosVatStore } from "./use-pos-vat-store";
import { DailyClosePage } from "./daily-close-page";
import { WochenberichtClient } from "./wochenbericht-client";
import { MonatsberichtClient } from "./monatsbericht-client";
import { JahresabschlussClient } from "./jahresabschluss-client";

type Tab = "tagesabschluss" | "wochenbericht" | "monatsbericht" | "jahresabschluss";

const ALL_TABS: { id: Tab; label: string }[] = [
  { id: "tagesabschluss", label: "Tagesabschluss" },
  { id: "wochenbericht",  label: "Wochenbericht" },
  { id: "monatsbericht",  label: "Monatsbericht" },
  { id: "jahresabschluss", label: "Jahresabschluss" },
];

function LockScreen({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-6 py-20 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-black/5">
        <Lock className="h-8 w-8 text-black/25" />
      </div>
      <div>
        <p className="text-lg font-bold text-ink">Kein Zugriff auf {label}</p>
        <p className="mt-1 text-sm text-black/40">
          Ein Admin muss diesen Bereich für Sie freischalten.
        </p>
      </div>
    </div>
  );
}

function BerichteInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isAdmin, hydrated: adminHydrated } = useAdmin();
  const { permissions, hydrated: permHydrated } = useReportPermissionsStore();
  const { vatRate, setVatRate } = usePosVatStore();

  const initialTab = (searchParams.get("tab") as Tab) ?? "tagesabschluss";
  const [activeTab, setActiveTab] = useState<Tab>(
    ALL_TABS.some((t) => t.id === initialTab) ? initialTab : "tagesabschluss"
  );

  // Sync URL → state when search params change (e.g. back/forward)
  useEffect(() => {
    const tab = searchParams.get("tab") as Tab;
    if (tab && ALL_TABS.some((t) => t.id === tab)) setActiveTab(tab);
  }, [searchParams]);

  const selectTab = (tab: Tab) => {
    setActiveTab(tab);
    router.replace(`/berichte?tab=${tab}`, { scroll: false });
  };

  if (!adminHydrated || !permHydrated) {
    return <div className="flex h-40 items-center justify-center text-black/40">Laden…</div>;
  }

  // Tabs visible in the tab bar: admin sees all; others see only permitted ones
  const visibleTabs = ALL_TABS.filter((t) => isAdmin || permissions[t.id]);

  // If user has no permissions at all
  if (!isAdmin && visibleTabs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-6 py-20 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-black/5">
          <Lock className="h-8 w-8 text-black/25" />
        </div>
        <div>
          <p className="text-lg font-bold text-ink">Keine Berichte freigeschaltet</p>
          <p className="mt-1 text-sm text-black/40">
            Bitte einen Admin bitten, Ihnen Berichte freizuschalten.
          </p>
        </div>
      </div>
    );
  }

  // Access for the current active tab
  const canAccess = (tab: Tab) => isAdmin || permissions[tab];

  return (
    <div className="space-y-6">
      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 rounded-2xl bg-black/[0.04] p-1">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            data-testid={`tab-${tab.id}`}
            onClick={() => selectTab(tab.id)}
            className={cn(
              "flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
              activeTab === tab.id
                ? "bg-white text-primaq-700 shadow-sm ring-1 ring-black/5"
                : "text-black/55 hover:bg-white/70 hover:text-black"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── MwSt-Schalter ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-black/40">MwSt</span>
        <div className="flex gap-1">
          {([0, 7, 19] as const).map((v) => (
            <button
              key={v}
              data-testid={`vat-btn-${v}`}
              onClick={() => setVatRate(v)}
              className={cn(
                "rounded-lg px-3 py-1 text-sm font-bold transition-colors",
                vatRate === v
                  ? "bg-primaq-500 text-white shadow-sm"
                  : "border border-black/12 bg-white text-black/50 hover:bg-black/5"
              )}
            >
              {v} %
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content (all rendered, inactive ones hidden to preserve state) */}
      <div className={activeTab === "tagesabschluss" ? "block" : "hidden"}>
        {canAccess("tagesabschluss") ? (
          <DailyClosePage guestAccess={permissions.tagesabschluss} />
        ) : (
          <LockScreen label="Tagesabschluss" />
        )}
      </div>

      <div className={activeTab === "wochenbericht" ? "block" : "hidden"}>
        {canAccess("wochenbericht") ? (
          <WochenberichtClient guestAccess={permissions.wochenbericht} />
        ) : (
          <LockScreen label="Wochenbericht" />
        )}
      </div>

      <div className={activeTab === "monatsbericht" ? "block" : "hidden"}>
        {canAccess("monatsbericht") ? (
          <MonatsberichtClient guestAccess={permissions.monatsbericht} />
        ) : (
          <LockScreen label="Monatsbericht" />
        )}
      </div>

      <div className={activeTab === "jahresabschluss" ? "block" : "hidden"}>
        {canAccess("jahresabschluss") ? (
          <JahresabschlussClient guestAccess={permissions.jahresabschluss} />
        ) : (
          <LockScreen label="Jahresabschluss" />
        )}
      </div>
    </div>
  );
}

export function BerichteClient() {
  return (
    <Suspense fallback={<div className="flex h-40 items-center justify-center text-black/40">Laden…</div>}>
      <BerichteInner />
    </Suspense>
  );
}
