"use client";

import Link from "next/link";
import { ArrowRight, IceCreamBowl, Warehouse } from "lucide-react";
import { formatCurrency } from "./calculations";
import { salesAreaLabels } from "./catalog";
import { TotalsSummary } from "./totals-summary";
import type {
  GeneralStockItem,
  InventoryReport,
  Machine,
  MaterialCategory,
  MaterialItem,
  MixInventoryLine,
  MvpTotals,
  ShiftMaterialAssignment,
} from "./types";
import { useMvpStore } from "./use-mvp-store";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtL(n: number) {
  const r = Math.round(n * 10) / 10;
  return r % 1 === 0 ? `${r}` : r.toFixed(1);
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

type TrafficLight = "green" | "yellow" | "red";

function dot(s: TrafficLight | "gray") {
  if (s === "red") return "🔴";
  if (s === "yellow") return "🟡";
  if (s === "green") return "🟢";
  return null;
}

// Berechnet Liter pro Maschine aus den Mix-Linien
function mixLitersByMachine(
  machines: Machine[],
  mixLines: MixInventoryLine[]
): { id: string; name: string; number: string; liters: number }[] {
  const byFlavor: Record<string, number> = {};
  for (const l of mixLines) byFlavor[l.productId] = l.remainingLiters;

  return machines
    .filter((m) => m.active !== false && m.visibleInSale !== false)
    .map((m) => {
      const flavorIds = new Set(
        m.products
          .filter((p) => p.slot === "A" || p.slot === "B")
          .flatMap((p) => p.stockLinks.map((l) => l.stockFlavorId))
      );
      const liters = [...flavorIds].reduce((sum, id) => sum + (byFlavor[id] ?? 0), 0);
      return { id: m.id, name: m.name, number: m.number, liters };
    })
    .filter((m) => m.liters > 0.01);
}

// ── Main Component ────────────────────────────────────────────────────────────

export function MvpDashboard() {
  const {
    activeShift,
    totals,
    dayReport,
    hydrated,
    generalStock,
    materialItems,
    materialCategories,
    inventoryReport,
    shiftMaterialAssignments,
    machines,
    dailySales,
    completedOrders,
  } = useMvpStore();

  const mixLines = inventoryReport.mixLines;

  // Anzahl abgeschlossener Verkäufe (kein Storno) im aktiven Einsatz
  const shiftSalesCount = activeShift
    ? completedOrders.filter(
        (o) => o.shiftId === activeShift.id && o.status === "completed"
      ).length
    : dailySales.orders.filter((o) => o.status === "completed").length;

  return (
    <div className="grid gap-4">
      {/* ── Einsatz-Header ────────────────────────────────────── */}
      <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-primaq-600">
              Aktueller Einsatz
            </p>
            <h2 className="mt-0.5 truncate text-xl font-black text-ink">
              {activeShift ? activeShift.eventName : "Kein Einsatz gestartet"}
            </h2>
            <p className="mt-1 text-sm text-black/55">
              {hydrated && activeShift
                ? `${activeShift.date} · ${salesAreaLabels[activeShift.salesArea]}`
                : "Starte zuerst einen Einsatz für den Wagen."}
            </p>
          </div>
          <IceCreamBowl className="h-7 w-7 shrink-0 text-primaq-600" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <QuickLink href="/einsatz" label="Einsatz" />
          <QuickLink href="/verkauf" label="Verkauf" />
          <QuickLink href="/tagesabschluss" label="Abschluss" />
        </div>
      </section>

      {/* ── Cockpit-Grid (4 kompakte Karten) ───────────────────── */}
      {hydrated ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <PulverCard generalStock={generalStock} mixLines={mixLines} />
          <VerpackungCard
            materialItems={materialItems}
            materialCategories={materialCategories}
            shiftMaterialAssignments={shiftMaterialAssignments}
            activeShiftId={activeShift?.id}
          />
          <EinsatzCard machines={machines} mixLines={mixLines} />
          <HeuteCard
            totals={totals}
            salesCount={shiftSalesCount}
          />
        </div>
      ) : (
        <div className="animate-pulse rounded-lg border border-black/10 bg-white p-6 text-center text-sm text-black/40">
          Laden…
        </div>
      )}

      {/* ── Lagerstatus Details (nur bei Problemen) ─────────────── */}
      {hydrated ? (
        <WarehouseDetailCard
          generalStock={generalStock}
          materialItems={materialItems}
          materialCategories={materialCategories}
          mixLines={mixLines}
          shiftMaterialAssignments={shiftMaterialAssignments}
          activeShiftId={activeShift?.id}
        />
      ) : null}

      {/* ── Finanzübersicht ─────────────────────────────────────── */}
      <TotalsSummary
        totals={totals}
        startingCashCents={activeShift?.startingCashCents ?? 0}
        endCashCents={dayReport?.endCashCents}
      />
    </div>
  );
}

// ── Quick Link ────────────────────────────────────────────────────────────────

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center justify-between rounded-lg border border-black/10 bg-[#fbfcf8] px-3 text-sm font-bold text-ink"
    >
      {label}
      <ArrowRight className="h-4 w-4 text-primaq-600" />
    </Link>
  );
}

// ── Cockpit Card Shell ────────────────────────────────────────────────────────

function CockpitCard({
  label,
  status,
  children,
  href,
}: {
  label: string;
  status?: TrafficLight;
  children: React.ReactNode;
  href?: string;
}) {
  const borderCls =
    status === "red"
      ? "border-red-200 bg-red-50"
      : status === "yellow"
      ? "border-yellow-200 bg-yellow-50"
      : "border-black/10 bg-white";

  const content = (
    <section className={`rounded-lg border p-4 shadow-sm ${borderCls}`}>
      <p className="text-xs font-bold uppercase tracking-wide text-black/40">{label}</p>
      <div className="mt-2 space-y-1">{children}</div>
      {href ? (
        <div className="mt-3">
          <span className="text-xs font-semibold text-primaq-600 underline">Details →</span>
        </div>
      ) : null}
    </section>
  );

  return href ? (
    <Link href={href} className="block">
      {content}
    </Link>
  ) : (
    content
  );
}

// ── Pulverlager Cockpit ───────────────────────────────────────────────────────

function PulverCard({
  generalStock,
  mixLines,
}: {
  generalStock: Record<string, GeneralStockItem>;
  mixLines: MixInventoryLine[];
}) {
  const active = Object.values(generalStock).filter((i) => i.active !== false);

  if (active.length === 0) {
    return (
      <CockpitCard label="Pulverlager" href="/lager">
        <Row severity="gray" text="Nicht erfasst" />
      </CockpitCard>
    );
  }

  const empty = active.filter((i) => {
    if (i.quantityOnHand > 0) return false;
    const line = mixLines.find((l) => l.productId === i.flavorId);
    return !line || line.remainingLiters <= 0;
  });
  const refillBlocked = active.filter((i) => {
    if (i.quantityOnHand > 0) return false;
    if (!i.flavorId) return false;
    const line = mixLines.find((l) => l.productId === i.flavorId);
    return line !== undefined && line.remainingLiters > 0;
  });
  const low = active.filter(
    (i) =>
      i.quantityOnHand > 0 &&
      typeof i.minQuantity === "number" &&
      i.minQuantity > 0 &&
      i.quantityOnHand < i.minQuantity
  );
  const ok = active.filter(
    (i) =>
      !empty.includes(i) && !refillBlocked.includes(i) && !low.includes(i)
  );

  const status: TrafficLight =
    empty.length > 0
      ? "red"
      : refillBlocked.length > 0 || low.length > 0
      ? "yellow"
      : "green";

  return (
    <CockpitCard label="Pulverlager" status={status} href="/lager">
      {ok.length > 0 && (
        <Row severity="green" text={plural(ok.length, "Sorte ausreichend", "Sorten ausreichend")} />
      )}
      {low.length > 0 && (
        <Row severity="yellow" text={plural(low.length, "Sorte niedrig", "Sorten niedrig")} />
      )}
      {refillBlocked.length > 0 && (
        <Row severity="yellow" text={plural(refillBlocked.length, "nicht nachfüllbar", "nicht nachfüllbar")} />
      )}
      {empty.length > 0 && (
        <Row severity="red" text={plural(empty.length, "Sorte leer", "Sorten leer")} />
      )}
      {ok.length === 0 && low.length === 0 && refillBlocked.length === 0 && empty.length === 0 && (
        <Row severity="gray" text="Keine aktiven Sorten" />
      )}
    </CockpitCard>
  );
}

// ── Verpackung Cockpit ────────────────────────────────────────────────────────

function VerpackungCard({
  materialItems,
  materialCategories,
  shiftMaterialAssignments,
  activeShiftId,
}: {
  materialItems: Record<string, MaterialItem>;
  materialCategories: MaterialCategory[];
  shiftMaterialAssignments: ShiftMaterialAssignment[];
  activeShiftId: string | undefined;
}) {
  const validIds = new Set<string>();
  for (const cat of materialCategories) for (const id of cat.itemIds) validIds.add(id);

  const active = Object.values(materialItems).filter(
    (i) => i.active !== false && validIds.has(i.id)
  );

  if (active.length === 0) {
    return (
      <CockpitCard label="Verpackung" href="/lager">
        <Row severity="gray" text="Nicht erfasst" />
      </CockpitCard>
    );
  }

  const shiftAssignments = activeShiftId
    ? shiftMaterialAssignments.filter((a) => a.shiftId === activeShiftId)
    : [];
  const einsatzById: Record<string, number> = Object.fromEntries(
    shiftAssignments.map((a) => [
      a.itemId,
      Math.max(0, a.assignedQty - (a.consumedQty ?? 0) - a.returnedQty - a.lossQty),
    ])
  );

  const empty = active.filter(
    (i) => i.quantityOnHand === 0 && (einsatzById[i.id] ?? 0) === 0
  );
  const low = active.filter(
    (i) =>
      (i.quantityOnHand > 0 || (einsatzById[i.id] ?? 0) > 0) &&
      typeof i.minQuantity === "number" &&
      i.minQuantity > 0 &&
      i.quantityOnHand < i.minQuantity
  );
  const ok = active.filter((i) => !empty.includes(i) && !low.includes(i));

  const status: TrafficLight =
    empty.length > 0 ? "red" : low.length > 0 ? "yellow" : "green";

  return (
    <CockpitCard label="Verpackung" status={status} href="/lager">
      {ok.length > 0 && (
        <Row severity="green" text={plural(ok.length, "Artikel ausreichend", "Artikel ausreichend")} />
      )}
      {low.length > 0 && (
        <Row severity="yellow" text={plural(low.length, "Artikel niedrig", "Artikel niedrig")} />
      )}
      {empty.length > 0 && (
        <Row severity="red" text={plural(empty.length, "Artikel leer", "Artikel leer")} />
      )}
    </CockpitCard>
  );
}

// ── Aktiver Einsatz Cockpit ───────────────────────────────────────────────────

function EinsatzCard({
  machines,
  mixLines,
}: {
  machines: Machine[];
  mixLines: MixInventoryLine[];
}) {
  const byMachine = mixLitersByMachine(machines, mixLines);
  const totalLiters = byMachine.reduce((s, m) => s + m.liters, 0);

  return (
    <CockpitCard label="Aktiver Einsatz" href="/einsatz">
      {byMachine.length === 0 ? (
        <Row severity="gray" text="Kein Mix im Einsatz" />
      ) : (
        <>
          {byMachine.map((m) => (
            <div key={m.id} className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-black/60 truncate">
                Maschine {m.number}
              </span>
              <span className="shrink-0 text-sm font-black text-ink tabular-nums">
                {fmtL(m.liters)} L
              </span>
            </div>
          ))}
          {byMachine.length > 1 && (
            <div className="flex items-baseline justify-between gap-2 border-t border-black/10 pt-1">
              <span className="text-sm font-bold text-black/70">Gesamt</span>
              <span className="text-sm font-black text-primaq-700 tabular-nums">
                {fmtL(totalLiters)} L
              </span>
            </div>
          )}
        </>
      )}
    </CockpitCard>
  );
}

// ── Heute Cockpit ─────────────────────────────────────────────────────────────

function HeuteCard({
  totals,
  salesCount,
}: {
  totals: MvpTotals;
  salesCount: number;
}) {
  return (
    <CockpitCard label="Heute">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-black/60">Verkäufe</span>
        <span className="text-sm font-black text-ink tabular-nums">{salesCount}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-black/60">Portionen</span>
        <span className="text-sm font-black text-ink tabular-nums">{totals.totalPieces}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2 border-t border-black/10 pt-1">
        <span className="text-sm font-bold text-black/70">Umsatz</span>
        <span className="text-sm font-black text-primaq-700 tabular-nums">
          {formatCurrency(totals.expectedRevenueCents)}
        </span>
      </div>
    </CockpitCard>
  );
}

// ── Row Helper ────────────────────────────────────────────────────────────────

function Row({
  severity,
  text,
}: {
  severity: TrafficLight | "gray";
  text: string;
}) {
  const cls =
    severity === "red"
      ? "text-red-700"
      : severity === "yellow"
      ? "text-yellow-700"
      : severity === "green"
      ? "text-green-700"
      : "text-black/35";
  const d = dot(severity);
  return (
    <p className={`text-sm font-bold ${cls}`}>
      {d ? `${d} ` : ""}{text}
    </p>
  );
}

// ── Lagerstatus Detail (nur bei Problemen) ────────────────────────────────────

function WarehouseDetailCard({
  generalStock,
  materialItems,
  materialCategories,
  mixLines,
  shiftMaterialAssignments,
  activeShiftId,
}: {
  generalStock: Record<string, GeneralStockItem>;
  materialItems: Record<string, MaterialItem>;
  materialCategories: MaterialCategory[];
  mixLines: InventoryReport["mixLines"];
  shiftMaterialAssignments: ShiftMaterialAssignment[];
  activeShiftId: string | undefined;
}) {
  const validItemIds = new Set<string>();
  const categoryByItemId: Record<string, string> = {};
  for (const cat of materialCategories) {
    for (const id of cat.itemIds) {
      validItemIds.add(id);
      categoryByItemId[id] = cat.name;
    }
  }

  const shiftAssignments = activeShiftId
    ? shiftMaterialAssignments.filter((a) => a.shiftId === activeShiftId)
    : [];
  const materialEinsatzById: Record<string, number> = Object.fromEntries(
    shiftAssignments.map((a) => [
      a.itemId,
      Math.max(0, a.assignedQty - (a.consumedQty ?? 0) - a.returnedQty - a.lossQty),
    ])
  );

  const activePowder = Object.values(generalStock).filter((i) => i.active !== false);
  const activeMaterial = Object.values(materialItems).filter(
    (i) => i.active !== false && validItemIds.has(i.id)
  );

  function getPowderEinsatz(item: GeneralStockItem) {
    if (!item.flavorId) return 0;
    const line = mixLines.find((l) => l.productId === item.flavorId);
    if (!line || line.remainingLiters <= 0) return 0;
    const r = item.recipe;
    if (r.mixLitersPerBatch <= 0) return 0;
    const pkgKg = typeof r.packageKg === "number" && r.packageKg > 0 ? r.packageKg : r.powderKgPerBatch;
    return (line.remainingLiters / r.mixLitersPerBatch) * (r.powderKgPerBatch / pkgKg);
  }

  const emptyPowder = activePowder.filter((i) => {
    if (i.quantityOnHand > 0) return false;
    const line = mixLines.find((l) => l.productId === i.flavorId);
    return !line || line.remainingLiters <= 0;
  });
  const refillBlockedPowder = activePowder.filter((i) => {
    if (i.quantityOnHand > 0) return false;
    if (!i.flavorId) return false;
    const line = mixLines.find((l) => l.productId === i.flavorId);
    return line !== undefined && line.remainingLiters > 0;
  });
  const lowPowder = activePowder.filter(
    (i) =>
      i.quantityOnHand > 0 &&
      typeof i.minQuantity === "number" &&
      i.minQuantity > 0 &&
      i.quantityOnHand < i.minQuantity
  );
  const emptyMaterial = activeMaterial.filter((i) => i.quantityOnHand === 0);
  const lowMaterial = activeMaterial.filter(
    (i) =>
      i.quantityOnHand > 0 &&
      typeof i.minQuantity === "number" &&
      i.minQuantity > 0 &&
      i.quantityOnHand < i.minQuantity
  );

  const hasProblems =
    emptyPowder.length > 0 ||
    refillBlockedPowder.length > 0 ||
    lowPowder.length > 0 ||
    emptyMaterial.length > 0 ||
    lowMaterial.length > 0;

  if (!hasProblems) return null;

  function fmtN(n: number, dec = 1) {
    const r = Math.round(n * Math.pow(10, dec)) / Math.pow(10, dec);
    return r % 1 === 0 ? String(r) : r.toFixed(dec);
  }

  return (
    <section className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Warehouse className="h-4 w-4 shrink-0 text-black/40" />
        <p className="text-xs font-bold uppercase tracking-wide text-black/40">
          Handlungsbedarf
        </p>
      </div>

      <div className="mt-3 divide-y divide-black/8 overflow-hidden rounded-lg border border-black/8 bg-white/70">
        {emptyPowder.map((item) => {
          const pkgs = getPowderEinsatz(item);
          return (
            <ProblemCard
              key={item.id}
              href="/lager"
              severity="red"
              name={item.flavorName || item.productName}
              rows={[
                { label: "Lager", value: `${fmtN(item.quantityOnHand, 0)} ${item.unit}` },
                { label: "Im Einsatz", value: pkgs > 0 ? `≈ ${fmtN(pkgs)} ${item.unit}` : `0 ${item.unit}` },
              ]}
              aktion={pkgs === 0 ? "Kein Verkauf mehr möglich" : "Nachfüllung blockiert"}
            />
          );
        })}
        {refillBlockedPowder.map((item) => {
          const pkgs = getPowderEinsatz(item);
          return (
            <ProblemCard
              key={item.id}
              href="/lager"
              severity="yellow"
              name={item.flavorName || item.productName}
              rows={[
                { label: "Lager", value: `0 ${item.unit}` },
                { label: "Im Einsatz", value: pkgs > 0 ? `≈ ${fmtN(pkgs)} ${item.unit}` : "–" },
              ]}
              aktion="Nachfüllung nicht möglich — Lager auffüllen"
            />
          );
        })}
        {lowPowder.map((item) => (
          <ProblemCard
            key={item.id}
            href="/lager"
            severity="yellow"
            name={item.flavorName || item.productName}
            rows={[
              { label: "Lager", value: `${fmtN(item.quantityOnHand, 0)} ${item.unit}` },
              ...(item.minQuantity != null
                ? [{ label: "Minimum", value: `${fmtN(item.minQuantity, 0)} ${item.unit}` }]
                : []),
            ]}
            aktion="Nachbestellen empfohlen"
          />
        ))}
        {emptyMaterial.map((item) => {
          const einsatz = materialEinsatzById[item.id] ?? 0;
          return (
            <ProblemCard
              key={`mat_${item.id}`}
              href="/lager"
              severity="red"
              name={item.name}
              rows={[
                { label: "Lager", value: `0 ${item.unit}` },
                ...(activeShiftId && einsatz > 0
                  ? [{ label: "Im Einsatz", value: `${fmtN(einsatz, 0)} ${item.unit}` }]
                  : []),
              ]}
              aktion={einsatz === 0 ? "Sofort nachbestellen" : "Nachbestellen — Im Einsatz vorhanden"}
            />
          );
        })}
        {lowMaterial.map((item) => (
          <ProblemCard
            key={`mat_${item.id}`}
            href="/lager"
            severity="yellow"
            name={item.name}
            rows={[
              { label: "Lager", value: `${fmtN(item.quantityOnHand, 0)} ${item.unit}` },
              ...(item.minQuantity != null
                ? [{ label: "Minimum", value: `${fmtN(item.minQuantity, 0)} ${item.unit}` }]
                : []),
            ]}
            aktion="Nachbestellen empfohlen"
          />
        ))}
      </div>

      <div className="mt-3">
        <Link
          href="/lager"
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-sm font-bold text-ink"
        >
          Lager öffnen
          <ArrowRight className="h-4 w-4 text-primaq-600" />
        </Link>
      </div>
    </section>
  );
}

function ProblemCard({
  href,
  severity,
  name,
  rows,
  aktion,
}: {
  href: string;
  severity: "red" | "yellow";
  name: string;
  rows: { label: string; value: string }[];
  aktion: string;
}) {
  const aktionCls = severity === "red" ? "text-red-700" : "text-yellow-700";
  const emoji = severity === "red" ? "🔴" : "🟡";
  return (
    <Link
      href={href}
      className="flex items-start gap-2.5 px-3 py-3 transition-colors hover:bg-black/[0.03]"
    >
      <span className="mt-0.5 shrink-0 text-sm">{emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink">{name}</p>
        <div className="mt-1 space-y-0.5">
          {rows.map((r) => (
            <p key={r.label} className="text-xs">
              <span className="text-black/45">{r.label}:</span>{" "}
              <span className="font-semibold text-black/70">{r.value}</span>
            </p>
          ))}
        </div>
        <p className={`mt-1.5 text-xs font-bold ${aktionCls}`}>→ {aktion}</p>
      </div>
    </Link>
  );
}
