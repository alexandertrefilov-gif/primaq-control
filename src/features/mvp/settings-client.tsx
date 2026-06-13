"use client";

import { AlertTriangle, Blend, ChevronDown, ChevronUp, Copy, CreditCard, Euro, Eye, EyeOff, Palette, Percent, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatMachineDisplayName, fromCentsInput, toCents } from "./calculations";
import type { Machine, MachineLocation, PackagingType, SoftServeRecipeTemplate, SoftServeProduct, VatRate } from "./types";
import { parseQuantityInput, formatQuantity } from "./calculations";
import { useMvpStore } from "./use-mvp-store";

const packagingTypes: PackagingType[] = ["Becher", "Waffel", "Waffelbecher"];
const machineLocations: MachineLocation[] = ["Wagen", "Zelt"];
const defaultMachineColors = ["#2563eb", "#16a34a", "#f97316", "#7c3aed"];
type ResetKind = "sales" | "factory";

const resetDetails: Record<ResetKind, {
  title: string;
  finalPrompt: string;
  requiredText: string;
  deletedData: string[];
}> = {
  sales: {
    title: "Nur Verkaufsdaten zurücksetzen",
    finalPrompt: "Geben Sie RESET ein, um Verkaufsdaten zu löschen.",
    requiredText: "RESET",
    deletedData: [
      "aktive Einsätze und offene Bestellungen",
      "gebuchte Verkäufe, Tagesverkäufe und Stornos",
      "Tagesabschlüsse, Berichte und Verbrauchsdaten",
      "aktuelle Kassen- und Inventurwerte"
    ]
  },
  factory: {
    title: "Kompletter Werksreset",
    finalPrompt: "Geben Sie WERKSRESET ein, um das komplette System zu löschen.",
    requiredText: "WERKSRESET",
    deletedData: [
      "alle Verkaufsdaten und Berichte",
      "alle Maschinen, Sorten, Preise und Toppings",
      "alle Produkt-, Layout- und Verpackungseinstellungen",
      "alle offenen Bestellungen und lokalen App-Daten"
    ]
  }
};

export function SettingsClient() {
  const {
    hydrated,
    machines,
    packagingSizes,
    recipeTemplates,
    addMachine,
    copyMachine,
    updateMachine,
    updateMachineProduct,
    addMachineProduct,
    deleteMachineProduct,
    showAllMachines,
    deleteMachine,
    resetSalesData,
    factoryReset,
    addPackagingSize,
  } = useMvpStore();
  const [activeReset, setActiveReset] = useState<ResetKind | null>(null);
  const [highlightedMachineId, setHighlightedMachineId] = useState<string | null>(null);
  const copyRequestedRef = useRef(false);
  const prevMachineCountRef = useRef(machines.length);

  useEffect(() => {
    if (copyRequestedRef.current && machines.length > prevMachineCountRef.current) {
      copyRequestedRef.current = false;
      const newMachine = machines[machines.length - 1];
      setHighlightedMachineId(newMachine.id);
      const timeout = setTimeout(() => setHighlightedMachineId(null), 2500);
      prevMachineCountRef.current = machines.length;
      return () => clearTimeout(timeout);
    }

    prevMachineCountRef.current = machines.length;
  }, [machines]);

  if (!hydrated) {
    return <div className="animate-pulse rounded-lg border border-black/10 bg-white p-8 text-center text-sm text-black/40">Laden…</div>;
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => document.getElementById("sumup-settings")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="flex min-h-10 items-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-sm font-bold text-black/65"
        >
          <CreditCard className="h-4 w-4" /> Zu SumUp QR-Einstellungen
        </button>
      </div>

      <section className="grid gap-3">
        <div className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-ink">Maschinen</h2>
              <p className="mt-1 text-sm leading-5 text-black/60">
                Maschinen anlegen und pro Maschine die verfügbaren Sorten definieren.
              </p>
            </div>
            {machines.length > 0 ? (
              <div className="grid w-full gap-2 sm:w-auto sm:grid-flow-col">
                <button
                  type="button"
                  onClick={showAllMachines}
                  className="flex min-h-14 items-center justify-center rounded-lg bg-primaq-50 px-4 text-sm font-bold text-primaq-700 ring-1 ring-primaq-200"
                >
                  Alle Maschinen sichtbar schalten
                </button>
                <button
                  type="button"
                  onClick={addMachine}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-primaq-500 px-4 text-base font-bold text-white"
                >
                  <Plus className="h-5 w-5" /> Maschine anlegen
                </button>
              </div>
            ) : (
              <div className="mt-2 w-full sm:mt-0">
                <p className="text-sm font-semibold text-black/50">Keine Maschine angelegt.</p>
                <button
                  type="button"
                  onClick={addMachine}
                  className="mt-3 flex min-h-12 items-center gap-2 rounded-lg bg-primaq-500 px-4 text-base font-bold text-white"
                >
                  <Plus className="h-5 w-5" /> Maschine anlegen
                </button>
              </div>
            )}
          </div>
        </div>

        {machines.length > 0 ? (
          <div className="grid grid-cols-1 items-start gap-6 min-[1024px]:grid-cols-2">
            {machines.map((machine, index) => (
              <MachineCard
                key={machine.id}
                machine={machine}
                index={index}
                packagingSizes={packagingSizes}
                isHighlighted={highlightedMachineId === machine.id}
                onChange={(patch) => updateMachine(machine.id, patch)}
                onDelete={() => deleteMachine(machine.id)}
                onCopy={() => {
                  copyRequestedRef.current = true;
                  return copyMachine(machine.id);
                }}
                onAddProduct={() => addMachineProduct(machine.id)}
                onDeleteProduct={(productId) => deleteMachineProduct(machine.id, productId)}
                onProductChange={(productId, patch) => updateMachineProduct(machine.id, productId, patch)}
                onAddPackagingSize={addPackagingSize}
              />
            ))}
          </div>
        ) : null}
      </section>

      <SumupSettingsSection />

      <section className="grid gap-3">
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 shadow-sm">
          <div className="flex flex-col gap-4 min-[900px]:flex-row min-[900px]:items-start min-[900px]:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-black uppercase text-red-800">
                <AlertTriangle className="h-5 w-5" /> Gefahrenbereich
              </p>
              <h2 className="mt-2 text-xl font-black text-red-950">Reset nur mit dreifacher Bestätigung</h2>
              <p className="mt-1 text-sm font-semibold leading-5 text-red-900">
                Diese Aktionen löschen lokale Daten dauerhaft. Abbrechen ist in jedem Schritt möglich.
              </p>
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-2 min-[900px]:w-auto">
              <button
                type="button"
                onClick={() => setActiveReset("sales")}
                className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-black text-red-800 ring-2 ring-red-300"
              >
                <Trash2 className="h-5 w-5" /> Verkaufsdaten zurücksetzen
              </button>
              <button
                type="button"
                onClick={() => setActiveReset("factory")}
                className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-red-700 px-4 text-sm font-black text-white ring-2 ring-red-900"
              >
                <AlertTriangle className="h-5 w-5" /> Werksreset
              </button>
            </div>
          </div>
        </div>
      </section>

      {activeReset ? (
        <ResetConfirmationDialog
          resetKind={activeReset}
          onCancel={() => setActiveReset(null)}
          onConfirm={() => {
            if (activeReset === "sales") {
              resetSalesData();
            } else {
              factoryReset();
            }
            window.location.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function ResetConfirmationDialog({
  resetKind,
  onCancel,
  onConfirm
}: {
  resetKind: ResetKind;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [confirmation, setConfirmation] = useState("");
  const details = resetDetails[resetKind];
  const canConfirm = confirmation === details.requiredText;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-dialog-title"
      className="fixed inset-0 z-50 grid min-h-dvh place-items-center bg-black/55 p-4"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-lg border-2 border-red-700 bg-white shadow-2xl">
        <div className="bg-red-700 px-5 py-4 text-white">
          <p className="flex items-center gap-2 text-sm font-black uppercase">
            <AlertTriangle className="h-5 w-5" /> Unwiderrufliche Löschung
          </p>
          <h2 id="reset-dialog-title" className="mt-1 text-2xl font-black leading-tight">
            {details.title}
          </h2>
        </div>

        <div className="grid gap-4 p-5">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-black text-red-950">Diese Daten werden gelöscht:</p>
            <ul className="mt-2 grid gap-1 text-sm font-semibold text-red-900">
              {details.deletedData.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          </div>

          {step === 1 ? (
            <ResetStep
              message="Möchten Sie wirklich fortfahren? Diese Aktion kann nicht rückgängig gemacht werden."
              onCancel={onCancel}
              onNext={() => setStep(2)}
            />
          ) : null}

          {step === 2 ? (
            <ResetStep
              message="Bitte bestätigen Sie erneut. Alle ausgewählten Daten werden dauerhaft gelöscht."
              onCancel={onCancel}
              onNext={() => setStep(3)}
            />
          ) : null}

          {step === 3 ? (
            <div className="grid gap-4">
              <p className="text-base font-black leading-6 text-red-950">{details.finalPrompt}</p>
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                  }
                }}
                autoComplete="off"
                spellCheck={false}
                aria-label={details.finalPrompt}
                className="h-14 rounded-lg border-2 border-red-300 bg-red-50 px-3 text-lg font-black tracking-wide text-red-950 outline-none focus:border-red-700"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={onCancel}
                  className="min-h-12 rounded-lg border border-black/15 bg-white px-4 text-sm font-black text-black/70"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={() => {
                    if (canConfirm) {
                      onConfirm();
                    }
                  }}
                  className="min-h-12 rounded-lg bg-red-700 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-red-200 disabled:text-red-500"
                >
                  Endgültig löschen
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ResetStep({
  message,
  onCancel,
  onNext
}: {
  message: string;
  onCancel: () => void;
  onNext: () => void;
}) {
  return (
    <div className="grid gap-4">
      <p className="text-base font-black leading-6 text-red-950">{message}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-12 rounded-lg border border-black/15 bg-white px-4 text-sm font-black text-black/70"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={onNext}
          className="min-h-12 rounded-lg bg-red-700 px-4 text-sm font-black text-white"
        >
          Weiter
        </button>
      </div>
    </div>
  );
}

function MachineCard({
  machine,
  index,
  packagingSizes,
  isHighlighted,
  onChange,
  onDelete,
  onCopy,
  onAddProduct,
  onDeleteProduct,
  onProductChange,
  onAddPackagingSize,
}: {
  machine: Machine;
  index: number;
  packagingSizes: Record<PackagingType, string[]>;
  isHighlighted: boolean;
  onChange: (patch: Partial<Machine>) => void;
  onDelete: () => void;
  onCopy: () => string | null;
  onAddProduct: () => void;
  onDeleteProduct: (productId: string) => void;
  onProductChange: (productId: string, patch: Partial<SoftServeProduct>) => void;
  onAddPackagingSize: (packagingType: PackagingType, size: string) => void;
}) {
  const machineName = formatMachineDisplayName(machine.name, machine.number || String(index + 1));
  const [copyConfirmation, setCopyConfirmation] = useState("");
  const machineColor = getMachineColor(machine, index);
  const machineTextColor = getReadableTextColor(machineColor);
  const machineSoftColor = hexToRgba(machineColor, 0.1);
  const machineBorderColor = hexToRgba(machineColor, 0.32);
  const articleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (isHighlighted) {
      articleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  return (
    <article
      ref={articleRef}
      className={`min-w-0 max-w-full overflow-hidden rounded-lg border bg-white shadow-sm transition-shadow duration-500 ${
        isHighlighted ? "ring-4 ring-amber-400 ring-offset-2" : ""
      }`}
      style={{ borderColor: machineBorderColor, borderLeftColor: machineColor, borderLeftWidth: 6 }}
    >
      <div
        className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        style={{ backgroundColor: machineColor, color: machineTextColor }}
      >
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide opacity-80">
            Maschine {index + 1}
            {isHighlighted ? (
              <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black tracking-wide text-amber-950">
                Gerade kopiert
              </span>
            ) : null}
          </p>
          <h2 className="truncate text-xl font-black leading-tight">{machineName}</h2>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold">
          Farbe
          <input
            type="color"
            value={machineColor}
            onChange={(event) => onChange({ colorHex: event.target.value })}
            className="h-9 w-11 cursor-pointer rounded-md border border-white/50 bg-transparent p-0"
            aria-label={`Farbe ${machineName}`}
          />
        </label>
      </div>

      <div className="grid gap-5 p-4">
        <div
          className="grid min-w-0 grid-cols-1 items-start gap-3 rounded-lg p-3 min-[560px]:grid-cols-2"
          style={{ backgroundColor: machineSoftColor }}
        >
          <label className="grid min-w-0 gap-2 text-sm font-semibold text-black/72">
            Maschine
            <input
              data-testid={`machine-number-input-${machine.id}`}
              value={machine.number}
              onChange={(event) => {
                const number = event.target.value;
                onChange({
                  number,
                  name: `Gelmatic ${number}`,
                  manualName: false
                });
              }}
              placeholder={`${index + 1}`}
              className="h-16 w-full rounded-lg border border-black/15 bg-white px-3 text-lg font-bold outline-none focus:border-primaq-500"
            />
            <span className="text-xs font-semibold text-black/50">{formatMachineDisplayName(machine.name, machine.number || String(index + 1))}</span>
          </label>

          <FieldGroup title="Standort">
            <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(90px,1fr))] gap-2">
              {machineLocations.map((location) => (
                <button
                  key={location}
                  type="button"
                  onClick={() => onChange({ location })}
                  className={`h-16 min-w-0 rounded-lg border px-3 text-sm font-bold ${
                    machine.location === location
                      ? "font-black"
                      : "border-black/10 bg-white text-black/65"
                  }`}
                  style={
                    machine.location === location
                      ? { borderColor: machineColor, backgroundColor: machineColor, color: machineTextColor }
                      : undefined
                  }
                >
                  {location}
                </button>
              ))}
            </div>
          </FieldGroup>

          <div className="grid min-w-0 gap-2 text-sm font-semibold text-black/72">
            <span>Aktiv</span>
            <ToggleButton
              active={machine.active !== false}
              label="Aktiv"
              onClick={() => onChange({ active: machine.active === false })}
              activeColor={machineColor}
              activeTextColor={machineTextColor}
              inactiveColor="#f3f4f6"
              inactiveTextColor="#6b7280"
              activeIcon={<Power className="h-5 w-5" />}
              inactiveIcon={<PowerOff className="h-5 w-5" />}
              activeLabel="Aktiv"
              inactiveLabel="Pausiert"
            />
          </div>
          <div className="grid min-w-0 gap-2 text-sm font-semibold text-black/72">
            <span>Im Verkauf</span>
            <ToggleButton
              active={machine.visibleInSale !== false}
              label="Im Verkauf"
              onClick={() => onChange({ visibleInSale: machine.visibleInSale === false })}
              activeColor="#19a983"
              activeTextColor="#ffffff"
              inactiveColor="#fef3c7"
              inactiveTextColor="#92400e"
              activeIcon={<Eye className="h-5 w-5" />}
              inactiveIcon={<EyeOff className="h-5 w-5" />}
              activeLabel="Sichtbar"
              inactiveLabel="Ausgeblendet"
            />
          </div>
          <div className="grid min-w-0 gap-2 text-sm font-semibold text-black/72 min-[560px]:col-span-2">
            <button
              type="button"
              onClick={() => {
                const copiedName = onCopy();
                setCopyConfirmation(copiedName ? `${copiedName} wurde aus ${machineName} kopiert.` : "");
              }}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold ring-1"
              style={{ backgroundColor: machineSoftColor, color: machineColor, boxShadow: `inset 0 0 0 1px ${machineBorderColor}` }}
            >
              <Copy className="h-5 w-5" /> Maschine kopieren
            </button>
          </div>
        </div>

        {copyConfirmation ? (
          <p
            className="rounded-lg px-3 py-2 text-sm font-bold"
            style={{ backgroundColor: machineSoftColor, color: machineColor }}
          >
            {copyConfirmation}
          </p>
        ) : null}

        <div className="border-t border-black/10 pt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-bold text-ink">Sorten</h3>
              <p className="mt-1 text-sm text-black/55">Lege pro Maschine die Sorten an, die diese Maschine ausgibt.</p>
            </div>
            <button
              type="button"
              onClick={onAddProduct}
              className="flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold"
              style={{ backgroundColor: machineColor, color: machineTextColor }}
            >
              <Plus className="h-4 w-4" /> + Softeis-Sorte anlegen
            </button>
          </div>

          <div className="mt-4 grid gap-4">
            {machine.products.length ? (
              sortMachineProducts(machine.products).map((product, productIndex) => (
                  <MachineProductCard
                    key={product.id}
                    product={product}
                    siblingProducts={machine.products}
                    productIndex={productIndex}
                  packagingSizes={packagingSizes}
                  onChange={(patch) => onProductChange(product.id, patch)}
                  onDelete={() => onDeleteProduct(product.id)}
                  onAddPackagingSize={onAddPackagingSize}
                />
              ))
            ) : (
              <p className="rounded-lg bg-[#fbfcf8] p-4 text-sm font-medium text-black/60">
                Diese Maschine hat noch keine Softeis-Sorte.
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-black uppercase tracking-wide text-red-700">Gefahrenzone</p>
          <button
            type="button"
            onClick={onDelete}
            className="flex h-12 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-bold text-white"
          >
            <Trash2 className="h-5 w-5" /> Maschine löschen
          </button>
        </div>
      </div>
    </article>
  );
}

function MachineProductCard({
  product,
  siblingProducts,
  productIndex,
  packagingSizes,
  onChange,
  onDelete,
  onAddPackagingSize,
}: {
  product: SoftServeProduct;
  siblingProducts: SoftServeProduct[];
  productIndex: number;
  packagingSizes: Record<PackagingType, string[]>;
  onChange: (patch: Partial<SoftServeProduct>) => void;
  onDelete: () => void;
  onAddPackagingSize: (packagingType: PackagingType, size: string) => void;
}) {
  const [newSize, setNewSize] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const slotLabel = product.slot === "A" ? "Sorte A" : product.slot === "B" ? "Sorte B" : product.slot === "MIX" ? "Mix" : `Sorte ${productIndex + 1}`;
  const displayName = product.name.trim() || slotLabel;
  const automaticName = `${displayName} · ${product.packagingType} ${product.packagingSize}`;
  const previewTone = getProductPreviewTone(product, displayName, siblingProducts);
  const isVisibleInSale = product.visibleInSale !== false;
  const isMixVariant = product.slot === "MIX";
  const advancedSummary = `Mix-Sorte ${isMixVariant ? "ja" : "nein"} · MwSt ${product.vatRate}% · Löffel ${product.spoonIncluded ? "ja" : "nein"} · Topping ${product.toppingEnabled ? "ja" : "nein"}`;
  const recipeSummary = `${formatDecimal(product.recipe.powderKgPerBatch)} kg Pulver + ${formatDecimal(product.recipe.waterLitersPerBatch)} L Wasser = ${formatDecimal(product.recipe.mixLitersPerBatch)} L Mix`;
  const updateRecipe = (patch: Partial<SoftServeProduct["recipe"]>) => {
    onChange({
      recipe: {
        ...product.recipe,
        ...patch
      }
    });
  };

  return (
    <section data-testid={`machine-product-card-${product.id}`} className="min-w-0 overflow-hidden rounded-lg border border-black/10 bg-[#fbfcf8] p-4">
      <div className="grid gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="mt-0.5 h-10 w-10 shrink-0 rounded-lg border border-black/10 shadow-sm"
              style={{ background: previewTone.background }}
              title={`${displayName} Farbe`}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold uppercase text-primaq-700">{slotLabel}</p>
                {isMixVariant ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-black uppercase text-purple-700 ring-1 ring-purple-300">
                    <Blend className="h-3.5 w-3.5" /> Mix-Sorte
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2 py-0.5 text-xs font-bold uppercase text-black/45 ring-1 ring-black/10">
                    Normale Sorte
                  </span>
                )}
              </div>
              <p className="mt-1 break-words text-sm font-semibold leading-5 text-black/55">{automaticName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-50 px-4 text-sm font-bold text-red-700 ring-1 ring-red-200"
          >
            <Trash2 className="h-4 w-4" /> Sorte löschen
          </button>
        </div>

        <div className="grid min-w-0 grid-cols-1 items-start gap-4 min-[560px]:grid-cols-2">
          <label className="grid min-w-0 content-start gap-2 text-sm font-semibold text-black/72">
            Name
            <input
              data-testid={`machine-product-name-input-${product.id}`}
              value={product.name}
              onChange={(event) => onChange({ name: event.target.value, aroma: event.target.value })}
              placeholder={slotLabel}
              className="h-16 w-full rounded-lg border border-black/15 bg-white px-3 text-lg outline-none focus:border-primaq-500"
            />
          </label>
          <MoneyField label="Preis brutto" value={product.priceCents} onChange={(priceCents) => onChange({ priceCents })} />
        </div>

        <button
          type="button"
          onClick={() => onChange({ visibleInSale: product.visibleInSale === false })}
          aria-pressed={isVisibleInSale}
          className={`flex h-16 w-full items-center justify-center gap-2 rounded-lg text-lg font-black transition ${
            isVisibleInSale
              ? "bg-primaq-500 text-white ring-2 ring-primaq-700"
              : "bg-amber-100 text-amber-900 ring-2 ring-amber-400"
          }`}
        >
          {isVisibleInSale ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
          Anzeigen im Verkauf: {isVisibleInSale ? "Ja" : "Nein"}
        </button>

        <CollapsibleSection
          title="Erweiterte Einstellungen"
          summary={advancedSummary}
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((value) => !value)}
          className="border border-black/10 bg-white"
        >
          <div className="grid min-w-0 grid-cols-1 items-start gap-4 min-[560px]:grid-cols-2">
            <VatField label="MwSt" value={product.vatRate} onChange={(vatRate) => onChange({ vatRate })} />
            <ColorField label="Farbe" value={product.colorHex} onChange={(colorHex) => onChange({ colorHex })} />
          </div>

          <label className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-3 py-3 text-sm font-semibold text-black/72">
            <input
              type="checkbox"
              data-testid={`machine-product-mix-toggle-${product.id}`}
              checked={product.slot === "MIX"}
              onChange={(event) => onChange({ isMixVariant: event.target.checked })}
              className="h-5 w-5 accent-primaq-500"
            />
            Mix-Sorte (50&nbsp;% Sorte&nbsp;A + 50&nbsp;% Sorte&nbsp;B)
          </label>

          <div className="grid min-w-0 grid-cols-1 gap-4 min-[560px]:grid-cols-2">
            <FieldGroup title="Verpackung">
              <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(90px,1fr))] gap-2">
                {packagingTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() =>
                      onChange({
                        packagingType: type,
                        packagingSize: packagingSizes[type][0] ?? product.packagingSize,
                        spoonIncluded: type === "Becher" || type === "Waffelbecher"
                      })
                    }
                    className={`min-h-14 min-w-0 rounded-lg border px-3 text-sm font-bold ${
                      product.packagingType === type
                        ? "border-primaq-500 bg-primaq-50 text-primaq-700"
                        : "border-black/10 bg-white text-black/65"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </FieldGroup>

            <FieldGroup title="Größe">
              <select
                value={product.packagingSize}
                onChange={(event) => onChange({ packagingSize: event.target.value })}
                className="min-h-14 w-full rounded-lg border border-black/15 bg-white px-3 text-lg outline-none focus:border-primaq-500"
              >
                {packagingSizes[product.packagingType].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  value={newSize}
                  onChange={(event) => setNewSize(event.target.value)}
                  placeholder="+ Größe hinzufügen"
                  className="min-h-12 w-full rounded-lg border border-black/15 bg-white px-3 text-base outline-none focus:border-primaq-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    onAddPackagingSize(product.packagingType, newSize);
                    if (newSize.trim()) {
                      onChange({ packagingSize: newSize.trim() });
                    }
                    setNewSize("");
                  }}
                  className="min-h-12 rounded-lg bg-primaq-500 px-4 text-sm font-bold text-white"
                >
                  Hinzufügen
                </button>
              </div>
            </FieldGroup>

            <label className="grid min-w-0 content-start gap-2 text-sm font-semibold text-black/72">
              Portion Gramm
              <input
                inputMode="numeric"
                value={product.portionGrams || ""}
                onChange={(event) => onChange({ portionGrams: Number(event.target.value || 0) })}
                placeholder="z. B. 120"
                className="min-h-14 w-full rounded-lg border border-black/15 bg-white px-3 text-lg outline-none focus:border-primaq-500"
              />
            </label>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-4 min-[560px]:grid-cols-2">
            <ToggleButton active={product.spoonIncluded} label="Löffel" onClick={() => onChange({ spoonIncluded: !product.spoonIncluded })} />
            <ToggleButton
              active={product.toppingEnabled}
              label="Topping möglich"
              onClick={() => onChange({ toppingEnabled: !product.toppingEnabled })}
            />
          </div>

          {product.toppingEnabled ? (
            <div className="grid min-w-0 grid-cols-1 gap-4 rounded-lg bg-white p-4 min-[560px]:grid-cols-2">
              <MoneyField
                label="Preis Topping"
                value={product.toppingPriceCents}
                onChange={(toppingPriceCents) => onChange({ toppingPriceCents })}
              />
              <VatField label="MwSt Topping" value={product.toppingVatRate} onChange={(toppingVatRate) => onChange({ toppingVatRate })} />
            </div>
          ) : null}
        </CollapsibleSection>

        <CollapsibleSection
          title="Rezept pro Mischung"
          summary={recipeSummary}
          open={recipeOpen}
          onToggle={() => setRecipeOpen((value) => !value)}
          className="border border-primaq-500/20 bg-primaq-50"
        >
          <div className="grid min-w-0 grid-cols-1 gap-4 min-[560px]:grid-cols-2">
            <DecimalField
              label="Pulver pro Mischung"
              value={product.recipe.powderKgPerBatch}
              suffix="kg"
              onChange={(powderKgPerBatch) => updateRecipe({ powderKgPerBatch: powderKgPerBatch ?? 0 })}
            />
            <DecimalField
              label="Wasser pro Mischung"
              value={product.recipe.waterLitersPerBatch}
              suffix="L"
              onChange={(waterLitersPerBatch) => updateRecipe({ waterLitersPerBatch: waterLitersPerBatch ?? 0 })}
            />
            <DecimalField
              label="Ergebnis Mixmenge"
              value={product.recipe.mixLitersPerBatch}
              suffix="L"
              onChange={(mixLitersPerBatch) => updateRecipe({ mixLitersPerBatch: mixLitersPerBatch ?? 0 })}
            />
            <DecimalField
              label="Packungsgröße"
              value={product.recipe.packageKg}
              suffix="kg"
              optional
              onChange={(packageKg) => updateRecipe({ packageKg })}
            />
          </div>
        </CollapsibleSection>
      </div>
    </section>
  );
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-2">
      <p className="text-sm font-semibold text-black/72">{title}</p>
      {children}
    </div>
  );
}

function CollapsibleSection({
  title,
  summary,
  open,
  onToggle,
  className = "",
  children
}: {
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`grid gap-4 rounded-lg p-4 ${className}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-12 w-full items-center justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block text-base font-black text-ink">{title}</span>
          {summary ? <span className="mt-1 block text-sm font-semibold text-black/60">{summary}</span> : null}
        </span>
        {open ? <ChevronUp className="h-5 w-5 shrink-0 text-black/50" /> : <ChevronDown className="h-5 w-5 shrink-0 text-black/50" />}
      </button>
      {open ? <div className="grid min-w-0 gap-4">{children}</div> : null}
    </div>
  );
}

function MoneyField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(fromCentsInput(value));

  useEffect(() => {
    setDraft(fromCentsInput(value));
  }, [value]);

  const commit = (nextValue: string) => {
    setDraft(nextValue);

    if (nextValue.trim()) {
      onChange(toCents(nextValue));
    }
  };

  return (
    <label className="grid min-w-0 content-start gap-2 text-sm font-semibold text-black/72">
      <span className="flex items-center gap-2">
        <Euro className="h-4 w-4 text-primaq-700" /> {label}
      </span>
      <input
        inputMode="decimal"
        value={draft}
        placeholder="0,00"
        onChange={(event) => commit(event.target.value)}
        onBlur={(event) => {
          const cents = toCents(event.target.value);
          onChange(cents);
          setDraft(fromCentsInput(cents));
        }}
        className="h-16 w-full rounded-lg border border-black/15 bg-white px-3 text-lg outline-none focus:border-primaq-500"
      />
    </label>
  );
}

function DecimalField({
  label,
  value,
  suffix,
  optional = false,
  onChange
}: {
  label: string;
  value: number | null;
  suffix: string;
  optional?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="grid min-w-0 content-start gap-2 text-sm font-semibold text-black/72">
      {label}
      <div className="flex min-h-14 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
        <input
          inputMode="decimal"
          value={value === null ? "" : formatDecimal(value)}
          onChange={(event) => {
            const parsed = parseDecimalInput(event.target.value);
            onChange(parsed ?? (optional ? null : 0));
          }}
          className="min-h-14 min-w-0 flex-1 rounded-lg bg-transparent px-3 text-lg outline-none"
        />
        <span className="pr-3 text-sm font-bold text-black/50">{suffix}</span>
      </div>
    </label>
  );
}

function parseDecimalInput(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatDecimal(value: number | null) {
  if (value === null) {
    return "";
  }

  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 3
  }).format(value);
}

function VatField({ label, value, onChange }: { label: string; value: VatRate; onChange: (value: VatRate) => void }) {
  return (
    <fieldset className="grid min-w-0 content-start gap-2">
      <legend className="flex items-center gap-2 text-sm font-semibold text-black/72">
        <Percent className="h-4 w-4 text-primaq-700" /> {label}
      </legend>
      <div className="flex flex-wrap gap-2">
        {([0, 7, 19] as VatRate[]).map((rate) => (
          <button
            key={rate}
            type="button"
            onClick={() => onChange(rate)}
            className={`min-h-[58px] min-w-[5.5rem] flex-1 basis-[5.5rem] whitespace-nowrap rounded-lg border px-3 text-lg font-bold ${
              value === rate ? "border-primaq-500 bg-primaq-50 text-primaq-700" : "border-black/10 bg-white text-black/65"
            }`}
          >
            {rate} %
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ColorField({ label, value, onChange }: { label: string; value?: string; onChange: (value: string) => void }) {
  const color = isValidHexColor(value) ? value : "#f6e9a6";

  return (
    <label className="grid min-w-0 content-start gap-2 text-sm font-semibold text-black/72">
      <span className="flex items-center gap-2">
        <Palette className="h-4 w-4 text-primaq-700" /> {label}
      </span>
      <span className="flex h-16 items-center gap-3 rounded-lg border border-black/15 bg-white px-3">
        <input
          type="color"
          value={color}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-12 cursor-pointer rounded-md border border-black/10 bg-transparent p-0"
          aria-label={label}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold uppercase text-black/60">{color}</span>
      </span>
    </label>
  );
}

function isValidHexColor(value: string | undefined) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function ToggleButton({
  active,
  label,
  onClick,
  activeColor = "#95c11f",
  activeTextColor = "#ffffff",
  inactiveColor,
  inactiveTextColor,
  activeIcon,
  inactiveIcon,
  activeLabel,
  inactiveLabel
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  activeColor?: string;
  activeTextColor?: string;
  inactiveColor?: string;
  inactiveTextColor?: string;
  activeIcon?: React.ReactNode;
  inactiveIcon?: React.ReactNode;
  activeLabel?: string;
  inactiveLabel?: string;
}) {
  const style = active
    ? { backgroundColor: activeColor, color: activeTextColor }
    : inactiveColor
      ? { backgroundColor: inactiveColor, color: inactiveTextColor }
      : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-16 w-full items-center justify-center gap-2 rounded-lg px-4 text-base font-bold ring-1 ring-black/10"
      style={style}
    >
      {active ? activeIcon : inactiveIcon}
      {active ? activeLabel ?? `${label}: Ja` : inactiveLabel ?? `${label}: Nein`}
    </button>
  );
}

function sortMachineProducts(products: SoftServeProduct[]) {
  return [...products];
}

function getProductDisplayName(product: SoftServeProduct) {
  const trimmedName = product.name.trim();

  if (trimmedName) {
    return trimmedName;
  }

  if (product.slot === "MIX") {
    return "Mix";
  }

  if (product.slot === "A") {
    return "Vanille";
  }

  if (product.slot === "B") {
    return "Schokolade";
  }

  if (product.aroma.trim()) {
    return product.aroma.trim();
  }

  return "";
}

function getProductPreviewTone(product: SoftServeProduct, displayName: string, siblingProducts: SoftServeProduct[]) {
  const mixColors = getMixComponentColors(product, displayName, siblingProducts);

  if (mixColors.length >= 2) {
    const [leftColor, rightColor] = mixColors;

    return {
      background: `linear-gradient(135deg, ${leftColor} 0%, ${leftColor} 50%, ${rightColor} 50%, ${rightColor} 100%)`
    };
  }

  if (mixColors.length === 1) {
    return { background: mixColors[0] };
  }

  return {
    background: product.colorHex && isValidHexColor(product.colorHex)
      ? product.colorHex
      : getDefaultProductColor(displayName)
  };
}

function getMixComponentColors(product: SoftServeProduct, displayName: string, siblingProducts: SoftServeProduct[]) {
  if (!isMixProduct(displayName) && product.slot !== "MIX") {
    return [];
  }

  const samePackagingProducts = siblingProducts.filter((item) => item.packagingType === product.packagingType);
  const samePackagingSlotProducts = [samePackagingProducts.find((item) => item.slot === "A"), samePackagingProducts.find((item) => item.slot === "B")]
    .filter(Boolean) as SoftServeProduct[];
  const samePackagingSourceProducts = samePackagingSlotProducts.length >= 2
    ? samePackagingSlotProducts
    : samePackagingProducts.filter((item) => item.id !== product.id && item.slot !== "MIX" && !isMixProduct(getProductDisplayName(item))).slice(0, 2);
  const fallbackSlotProducts = [siblingProducts.find((item) => item.slot === "A"), siblingProducts.find((item) => item.slot === "B")]
    .filter(Boolean) as SoftServeProduct[];
  const sourceProducts = samePackagingSourceProducts.length
    ? samePackagingSourceProducts
    : fallbackSlotProducts.length >= 2
      ? fallbackSlotProducts
      : siblingProducts.filter((item) => item.id !== product.id && item.slot !== "MIX" && !isMixProduct(getProductDisplayName(item))).slice(0, 2);

  return sourceProducts
    .map((item) => {
      const name = getProductDisplayName(item);
      return item.colorHex && isValidHexColor(item.colorHex) ? item.colorHex : getDefaultProductColor(name);
    })
    .slice(0, 2);
}

function isMixProduct(displayName: string) {
  return displayName.trim().toLowerCase().includes("mix");
}

function getDefaultProductColor(displayName: string) {
  const normalizedName = displayName.trim().toLowerCase();

  if (normalizedName.includes("schoko") || normalizedName.includes("choco")) {
    return "#8b5a3c";
  }

  if (normalizedName.includes("karamel") || normalizedName.includes("caramel")) {
    return "#d9903d";
  }

  if (normalizedName.includes("blu") || normalizedName.includes("blue") || normalizedName.includes("sky")) {
    return "#9fd7ff";
  }

  if (normalizedName.includes("erdbeer") || normalizedName.includes("straw")) {
    return "#f4a1ad";
  }

  if (normalizedName.includes("mix")) {
    return "#d8c7a3";
  }

  return "#f6e9a6";
}

function getMachineColor(machine: Machine, index: number) {
  if (machine.colorHex && isValidHexColor(machine.colorHex)) {
    return machine.colorHex;
  }

  return defaultMachineColors[index % defaultMachineColors.length] ?? defaultMachineColors[0];
}

function getReadableTextColor(hexColor: string) {
  const { r, g, b } = hexToRgb(hexColor);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  return luminance > 0.58 ? "#1f1a12" : "#ffffff";
}

function hexToRgba(hexColor: string, alpha: number) {
  const { r, g, b } = hexToRgb(hexColor);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToRgb(hexColor: string) {
  const value = hexColor.replace("#", "");

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  };
}

// ── Recipe Templates ─────────────────────────────────────────────────────────

function RecipeTemplatesSection({
  templates,
  onAdd,
  onUpdate,
  onDelete
}: {
  templates: SoftServeRecipeTemplate[];
  onAdd: (input: { name: string; powderKgPerBatch: number; waterLitersPerBatch: number; mixLitersPerBatch: number; note?: string }) => void;
  onUpdate: (id: string, patch: { name?: string; powderKgPerBatch?: number; waterLitersPerBatch?: number; mixLitersPerBatch?: number; note?: string }) => void;
  onDelete: (id: string) => { ok: true } | { ok: false; message: string };
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  return (
    <section className="grid gap-3">
      <div className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-ink">Softeis-Rezepte</h2>
            <p className="mt-1 text-sm leading-5 text-black/60">
              Mischverhältnisse definieren. Jede Lager-Sorte kann ein Rezept verwenden, um bei &bdquo;+ Mischung&ldquo; die Liter automatisch zu berechnen.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setShowAdd(true); setEditingId(null); }}
            className="flex shrink-0 min-h-11 items-center gap-2 rounded-lg bg-primaq-500 px-4 text-sm font-black text-white"
          >
            <Plus className="h-4 w-4" /> Neues Rezept
          </button>
        </div>

        {deleteError ? (
          <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{deleteError}</p>
        ) : null}

        {templates.length === 0 && !showAdd ? (
          <p className="mt-4 rounded-lg bg-[#fbfcf8] p-3 text-sm font-medium text-black/50">
            Noch keine Rezepte angelegt. Klicke auf &bdquo;Neues Rezept&ldquo;, um zu beginnen.
          </p>
        ) : (
          <div className="mt-4 grid gap-2">
            {templates.map((template) =>
              editingId === template.id ? (
                <RecipeTemplateForm
                  key={template.id}
                  initial={template}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(input) => {
                    onUpdate(template.id, input);
                    setEditingId(null);
                  }}
                />
              ) : (
                <RecipeTemplateRow
                  key={template.id}
                  template={template}
                  onEdit={() => { setEditingId(template.id); setShowAdd(false); }}
                  onDelete={() => {
                    const result = onDelete(template.id);

                    if (!result.ok) {
                      setDeleteError(result.message);
                      setTimeout(() => setDeleteError(null), 4000);
                    }
                  }}
                />
              )
            )}
          </div>
        )}

        {showAdd ? (
          <div className="mt-3">
            <RecipeTemplateForm
              onCancel={() => setShowAdd(false)}
              onSubmit={(input) => {
                onAdd(input);
                setShowAdd(false);
              }}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function RecipeTemplateRow({
  template,
  onEdit,
  onDelete
}: {
  template: SoftServeRecipeTemplate;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-black/8 bg-[#fbfcf8] px-3 py-2.5">
      <div className="min-w-0">
        <p className="font-black text-ink">{template.name}</p>
        <p className="mt-0.5 text-xs font-semibold text-black/50">
          {formatQuantity(template.powderKgPerBatch, "kg")} Pulver + {formatQuantity(template.waterLitersPerBatch, "L")} Wasser = <strong className="text-primaq-700">{formatQuantity(template.mixLitersPerBatch, "L")} Mix</strong> pro Mischung
        </p>
        {template.note ? <p className="mt-0.5 text-xs text-black/40">{template.note}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="min-h-9 rounded-lg border border-black/15 bg-white px-3 text-xs font-black text-black/60"
        >
          Bearbeiten
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="min-h-9 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-black text-red-700"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function RecipeTemplateForm({
  initial,
  onCancel,
  onSubmit
}: {
  initial?: SoftServeRecipeTemplate;
  onCancel: () => void;
  onSubmit: (input: { name: string; powderKgPerBatch: number; waterLitersPerBatch: number; mixLitersPerBatch: number; note?: string }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [powder, setPowder] = useState(initial ? String(initial.powderKgPerBatch).replace(".", ",") : "2");
  const [water, setWater] = useState(initial ? String(initial.waterLitersPerBatch).replace(".", ",") : "4");
  const [mix, setMix] = useState(initial ? String(initial.mixLitersPerBatch).replace(".", ",") : "6");
  const [note, setNote] = useState(initial?.note ?? "");

  const parsedPowder = parseQuantityInput(powder) ?? 0;
  const parsedWater = parseQuantityInput(water) ?? 0;
  const parsedMix = parseQuantityInput(mix) ?? 0;
  const canSubmit = name.trim().length > 0 && parsedMix > 0;

  return (
    <div className="grid gap-3 rounded-lg border border-primaq-200 bg-primaq-50 p-3">
      <label className="grid gap-1 text-sm font-semibold text-black/70">
        Rezeptname *
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z. B. Standard 2+4"
          className="min-h-11 rounded-lg border border-black/15 bg-white px-3 text-base font-bold outline-none focus:border-primaq-500"
        />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="grid gap-1 text-sm font-semibold text-black/70">
          Pulver (kg)
          <div className="flex min-h-11 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
            <input
              inputMode="decimal"
              value={powder}
              onChange={(e) => setPowder(e.target.value)}
              className="min-h-11 min-w-0 flex-1 bg-transparent px-3 text-base font-bold outline-none"
            />
            <span className="pr-2 text-xs text-black/40">kg</span>
          </div>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-black/70">
          Wasser (L)
          <div className="flex min-h-11 items-center rounded-lg border border-black/15 bg-white focus-within:border-primaq-500">
            <input
              inputMode="decimal"
              value={water}
              onChange={(e) => setWater(e.target.value)}
              className="min-h-11 min-w-0 flex-1 bg-transparent px-3 text-base font-bold outline-none"
            />
            <span className="pr-2 text-xs text-black/40">L</span>
          </div>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-black/70">
          Ergebnis (L) *
          <div className="flex min-h-11 items-center rounded-lg border border-primaq-300 bg-white focus-within:border-primaq-500">
            <input
              inputMode="decimal"
              value={mix}
              onChange={(e) => setMix(e.target.value)}
              className="min-h-11 min-w-0 flex-1 bg-transparent px-3 text-base font-bold outline-none"
            />
            <span className="pr-2 text-xs text-primaq-600">L Mix</span>
          </div>
        </label>
      </div>
      {parsedPowder > 0 && parsedWater > 0 && parsedMix > 0 ? (
        <p className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black/60">
          Vorschau: {formatQuantity(parsedPowder, "kg")} Pulver + {formatQuantity(parsedWater, "L")} Wasser = <strong className="text-primaq-700">{formatQuantity(parsedMix, "L")} Mix</strong> · 1 Mischung ergibt {formatQuantity(parsedMix, "L")}
        </p>
      ) : null}
      <label className="grid gap-1 text-sm font-semibold text-black/70">
        Notiz / Hersteller (optional)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="z. B. Hersteller XY, Charge 2024"
          className="min-h-10 rounded-lg border border-black/15 bg-white px-3 text-sm outline-none focus:border-primaq-500"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-lg border border-black/15 bg-white px-4 text-sm font-black text-black/65"
        >
          Abbrechen
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit({
            name: name.trim(),
            powderKgPerBatch: parsedPowder,
            waterLitersPerBatch: parsedWater,
            mixLitersPerBatch: parsedMix,
            note: note.trim() || undefined
          })}
          className="min-h-11 rounded-lg bg-primaq-500 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-black/25"
        >
          {initial ? "Speichern" : "Rezept anlegen"}
        </button>
      </div>
    </div>
  );
}

// ── SumUp QR-Einstellungen ────────────────────────────────────────────────────

function SumupSettingsSection() {
  const { sumupSettings, updateSumupSettings } = useMvpStore();
  const [link, setLink] = useState(sumupSettings.paymentLink);
  const [hint, setHint] = useState(sumupSettings.hintText);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    updateSumupSettings({ paymentLink: link.trim(), hintText: hint.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <section id="sumup-settings" className="grid scroll-mt-4 gap-3">
      <div className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
        <h2 className="text-xl font-bold text-ink">SumUp QR</h2>
        <p className="mt-1 text-sm text-black/60">
          QR-Zahlung für SumUp. Der Betrag wird automatisch an den Link angehängt.
        </p>

        <div className="mt-4 grid gap-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={sumupSettings.enabled}
              onChange={(e) => updateSumupSettings({ enabled: e.target.checked })}
              className="h-5 w-5 rounded border-black/20"
            />
            <span className="text-sm font-semibold text-ink">
              QR-Zahlung aktivieren
            </span>
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-black/70">
            SumUp Payment Link
            <input
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://pay.sumup.com/b2c/..."
              className="min-h-10 rounded-lg border border-black/15 bg-white px-3 text-sm font-normal outline-none focus:border-primaq-500"
            />
            <span className="text-xs font-normal text-black/45">
              Der Betrag (?amount=X.XX) wird automatisch angehängt.
            </span>
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-black/70">
            Hinweistext (optional)
            <input
              type="text"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="z. B. QR-Code scannen und Zahlung bestätigen"
              className="min-h-10 rounded-lg border border-black/15 bg-white px-3 text-sm font-normal outline-none focus:border-primaq-500"
            />
          </label>

          <button
            type="button"
            onClick={handleSave}
            className={`min-h-10 rounded-lg px-4 text-sm font-black text-white transition ${saved ? "bg-green-600" : "bg-primaq-500"}`}
          >
            {saved ? "✓ Gespeichert" : "Speichern"}
          </button>
        </div>
      </div>
    </section>
  );
}
