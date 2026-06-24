"use client";

import { useState, useEffect, useRef } from "react";
import { AlertTriangle, GripVertical, Lock, Unlock, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { SIZES } from "./pos-config";
import {
  usePosLayoutStore,
  PANEL_LABELS,
  SIZE_LABELS,
  TOGGLE_LABELS,
  CART_FONT_LABELS,
  PRESETS,
  DEFAULT_LAYOUT,
  panelSizeToPixels,
} from "./use-pos-layout-store";
import type {
  CartFontSize,
  LayoutConfig,
  PanelConfig,
  PanelId,
  PanelSize,
  PresetId,
  SalesSizeOverride,
  TextColorMode,
  ToggleId,
} from "./use-pos-layout-store";
import { computeTextColor } from "./use-pos-layout-store";

// ── Helpers ────────────────────────────────────────────────────────

const PANEL_DOT: Record<PanelId, string> = {
  groessen: "bg-emerald-400",
  sorten: "bg-sky-400",
  warenkorb: "bg-violet-400",
};

const PANEL_BG: Record<PanelId, string> = {
  groessen: "bg-emerald-50 text-emerald-800",
  sorten: "bg-sky-50 text-sky-800",
  warenkorb: "bg-violet-50 text-violet-800",
};

const PREVIEW_FLEX: Record<PanelId, (cfg: LayoutConfig) => number> = {
  groessen: (c) => c.sizeColumnWidth / 100,
  sorten:   () => 2.5,
  warenkorb: (c) => c.cartWidth / 160,
};

// ── Sub-components ─────────────────────────────────────────────────

function LayoutPreview({ config }: { config: LayoutConfig }) {
  return (
    <div className="flex h-14 overflow-hidden rounded-xl border border-black/8">
      {config.panels.map((panel) => (
        <div
          key={panel.id}
          className={cn(
            "flex items-center justify-center px-1 text-[9px] font-bold leading-tight text-center",
            PANEL_BG[panel.id]
          )}
          style={{ flex: PREVIEW_FLEX[panel.id](config) }}
        >
          {PANEL_LABELS[panel.id]}
        </div>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        "relative h-6 w-11 rounded-full transition-colors duration-200",
        checked ? "bg-primaq-500" : "bg-black/15",
        disabled && "cursor-not-allowed opacity-40"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

function SizeSelector({
  value,
  onChange,
  disabled,
}: {
  value: PanelSize;
  onChange: (size: PanelSize) => void;
  disabled: boolean;
}) {
  const sizes: PanelSize[] = ["klein", "mittel", "gross", "xl"];
  return (
    <div className={cn("flex gap-1 transition-opacity", disabled && "opacity-40 pointer-events-none")}>
      {sizes.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={cn(
            "flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors",
            value === s ? "bg-primaq-500 text-white shadow-sm" : "bg-black/5 text-black/50 hover:bg-black/10"
          )}
        >
          {SIZE_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  unit = "px",
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div className={cn("space-y-1.5 transition-opacity", disabled && "opacity-40 pointer-events-none")}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span className="text-sm font-bold tabular-nums text-primaq-600">
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primaq-500"
        style={{ touchAction: "none" }}
      />
      <div className="flex justify-between text-[10px] text-black/35">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

function StepperControl({
  label,
  value,
  min,
  max,
  step,
  unit = "px",
  defaultValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  defaultValue: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-black/60">{label}</p>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange(Math.max(min, value - step))}
          disabled={value <= min}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-black/5 text-2xl font-bold text-ink transition-colors hover:bg-primaq-100 hover:text-primaq-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 select-none"
        >
          −
        </button>
        <span className="flex-1 text-center text-2xl font-black tabular-nums text-ink">
          {value}{unit}
        </span>
        <button
          onClick={() => onChange(Math.min(max, value + step))}
          disabled={value >= max}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-black/5 text-2xl font-bold text-ink transition-colors hover:bg-primaq-100 hover:text-primaq-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 select-none"
        >
          +
        </button>
      </div>
      {value !== defaultValue && (
        <button
          onClick={() => onChange(defaultValue)}
          className="w-full rounded-xl border border-black/10 py-2 text-xs font-semibold text-black/50 transition-colors hover:bg-black/5 hover:text-black/70 active:scale-[0.99]"
        >
          Standard wiederherstellen ({defaultValue}{unit})
        </button>
      )}
    </div>
  );
}

function SegmentControl<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <div className={cn("flex gap-1 transition-opacity", disabled && "opacity-40 pointer-events-none")}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex-1 rounded-lg py-2 text-xs font-bold transition-colors",
            value === o.id ? "bg-primaq-500 text-white shadow-sm" : "bg-black/5 text-black/50 hover:bg-black/10"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function fmtPrice(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

// ── Size card preview ──────────────────────────────────────────────

function SizePreview({ ov, defaultImageSrc }: { ov: SalesSizeOverride; defaultImageSrc: string }) {
  const textColor = computeTextColor(ov.textColorMode, ov.backgroundColor);
  const imgSrc = ov.imageDataUrl ?? defaultImageSrc;
  const scale = (ov.imageScale ?? 100) / 100;
  return (
    <div
      className="flex h-28 w-24 shrink-0 flex-col overflow-hidden rounded-2xl shadow-md"
      style={{ backgroundColor: ov.backgroundColor }}
    >
      {/* Image zone: 72 % of height; overflow-hidden clips zoom */}
      <div className="flex w-full items-center justify-center overflow-hidden" style={{ height: "72%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imgSrc}
          alt=""
          className="block h-[95%] w-[95%] object-contain drop-shadow"
          style={{ transform: `scale(${scale})`, transformOrigin: "center" }}
        />
      </div>
      {/* Text zone: 28 % of height */}
      <div className="flex flex-col items-center justify-center" style={{ height: "28%" }}>
        <span className="px-1 text-center text-sm font-black leading-none" style={{ color: textColor }}>
          {ov.label}
        </span>
        <span className="text-[10px] font-bold leading-none" style={{ color: textColor, opacity: 0.75 }}>
          {fmtPrice(ov.priceCents)} €
        </span>
      </div>
    </div>
  );
}

// ── Per-size config card ───────────────────────────────────────────

function SizeConfigCard({
  defaultImageSrc,
  ov,
  enabled,
  isLast,
  editMode,
  onUpdate,
  onToggle,
}: {
  defaultImageSrc: string;
  ov: SalesSizeOverride;
  enabled: boolean;
  isLast: boolean;
  editMode: boolean;
  onUpdate: (updates: Partial<SalesSizeOverride>) => void;
  onToggle: (v: boolean) => void;
}) {
  const [nameInput, setNameInput]   = useState(ov.label);
  const [priceInput, setPriceInput] = useState(fmtPrice(ov.priceCents));
  const [hexInput, setHexInput]     = useState(ov.backgroundColor);
  const [priceError, setPriceError] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setNameInput(ov.label); }, [ov.label]);
  useEffect(() => { setPriceInput(fmtPrice(ov.priceCents)); setPriceError(false); }, [ov.priceCents]);
  useEffect(() => { setHexInput(ov.backgroundColor); }, [ov.backgroundColor]);

  function handleNameBlur() {
    const t = nameInput.trim();
    if (!t) { setNameInput(ov.label); return; }
    if (t !== ov.label) onUpdate({ label: t });
  }

  function handlePriceBlur() {
    const euros = parseFloat(priceInput.replace(",", "."));
    if (isNaN(euros) || euros <= 0 || euros > 99.99) {
      setPriceError(true);
      setPriceInput(fmtPrice(ov.priceCents));
      return;
    }
    const cents = Math.round(euros * 100);
    setPriceError(false);
    if (cents !== ov.priceCents) onUpdate({ priceCents: cents });
  }

  function handleHexBlur() {
    const val = hexInput.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      if (val.toLowerCase() !== ov.backgroundColor.toLowerCase()) onUpdate({ backgroundColor: val });
    } else {
      setHexInput(ov.backgroundColor);
    }
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setUploadError("Bild ist zu groß. Maximal 2 MB.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = () => onUpdate({ imageDataUrl: reader.result as string });
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  const textModes: { id: TextColorMode; label: string }[] = [
    { id: "auto", label: "Auto" },
    { id: "light", label: "Hell" },
    { id: "dark", label: "Dunkel" },
  ];

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow">
      {/* Header */}
      <div className="flex min-w-0 items-center gap-3 border-b border-black/5 px-4 py-3">
        <span className="flex-1 text-sm font-bold text-ink">{ov.label}</span>
        {isLast && (
          <span className="shrink-0" title="Mindestens eine Größe muss aktiv bleiben">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </span>
        )}
        <Toggle checked={enabled} onChange={onToggle} disabled={!editMode || isLast} />
      </div>

      {/* Body: form left, preview right */}
      <div className="flex gap-4 p-4">

        <div className="min-w-0 flex-1 space-y-3">

          {/* Name + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-[11px] font-semibold text-black/40">Name</p>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={handleNameBlur}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                disabled={!editMode}
                className="w-full rounded-lg border border-black/10 bg-black/[0.03] px-2.5 py-1.5 text-sm font-bold text-ink outline-none focus:border-primaq-500 focus:ring-2 focus:ring-primaq-500/20 disabled:opacity-60"
              />
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold text-black/40">Preis</p>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={priceInput}
                  onChange={(e) => { setPriceInput(e.target.value); setPriceError(false); }}
                  onBlur={handlePriceBlur}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  disabled={!editMode}
                  className={cn(
                    "min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-right text-sm font-bold tabular-nums outline-none focus:ring-2 disabled:opacity-60",
                    priceError
                      ? "border-red-400 bg-red-50 text-red-600 focus:ring-red-400/20"
                      : "border-black/10 bg-black/[0.03] text-ink focus:border-primaq-500 focus:ring-primaq-500/20"
                  )}
                />
                <span className="shrink-0 text-sm font-bold text-black/40">€</span>
              </div>
            </div>
          </div>

          {/* Background color */}
          <div>
            <p className="mb-1 text-[11px] font-semibold text-black/40">Hintergrundfarbe</p>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "relative h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-black/20",
                  !editMode && "pointer-events-none opacity-60"
                )}
                style={{ backgroundColor: ov.backgroundColor }}
              >
                <input
                  type="color"
                  value={ov.backgroundColor}
                  onChange={(e) => { setHexInput(e.target.value); onUpdate({ backgroundColor: e.target.value }); }}
                  disabled={!editMode}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  title="Farbe wählen"
                />
              </div>
              <input
                type="text"
                value={hexInput}
                onChange={(e) => setHexInput(e.target.value.slice(0, 7))}
                onBlur={handleHexBlur}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                disabled={!editMode}
                placeholder="#F6F2E8"
                className="flex-1 rounded-lg border border-black/10 bg-black/[0.03] px-2.5 py-1.5 font-mono text-xs text-ink outline-none focus:border-primaq-500 focus:ring-2 focus:ring-primaq-500/20 disabled:opacity-60"
                maxLength={7}
              />
            </div>
          </div>

          {/* Text color mode */}
          <div>
            <p className="mb-1 text-[11px] font-semibold text-black/40">Textfarbe</p>
            <div className={cn("flex gap-1", !editMode && "pointer-events-none opacity-40")}>
              {textModes.map((m) => (
                <button
                  key={m.id}
                  onClick={() => onUpdate({ textColorMode: m.id })}
                  className={cn(
                    "flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors",
                    ov.textColorMode === m.id
                      ? "bg-primaq-500 text-white shadow-sm"
                      : "bg-black/5 text-black/50 hover:bg-black/10"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Image upload */}
          <div>
            <p className="mb-1 text-[11px] font-semibold text-black/40">Bild / Icon</p>
            <div className="flex flex-wrap gap-2">
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-xl border border-black/15 bg-white px-3 py-1.5 text-xs font-bold text-black/60 shadow-sm transition-colors hover:bg-black/5",
                  !editMode && "pointer-events-none opacity-50"
                )}
              >
                <Upload className="h-3.5 w-3.5" />
                Hochladen
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  disabled={!editMode}
                  onChange={handleImageUpload}
                />
              </label>
              {ov.imageDataUrl && (
                <button
                  onClick={() => { onUpdate({ imageDataUrl: null }); setUploadError(null); }}
                  disabled={!editMode}
                  className="flex items-center gap-1.5 rounded-xl border border-black/15 bg-white px-3 py-1.5 text-xs font-bold text-red-500 shadow-sm transition-colors hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Entfernen
                </button>
              )}
            </div>
            {uploadError && (
              <p className="mt-1 text-xs font-semibold text-red-500">{uploadError}</p>
            )}
          </div>

          {/* Image zoom */}
          <div>
            <p className="mb-1 text-[11px] font-semibold text-black/40">Bild-Zoom</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onUpdate({ imageScale: Math.max(50, (ov.imageScale ?? 100) - 10) })}
                disabled={!editMode || (ov.imageScale ?? 100) <= 50}
                className="grid h-7 w-7 place-items-center rounded-lg border border-black/15 bg-white text-base font-black text-black/60 shadow-sm hover:bg-black/5 disabled:opacity-30 transition-colors"
              >
                −
              </button>
              <span className="w-12 text-center text-sm font-bold tabular-nums text-black/70">
                {ov.imageScale ?? 100} %
              </span>
              <button
                onClick={() => onUpdate({ imageScale: Math.min(200, (ov.imageScale ?? 100) + 10) })}
                disabled={!editMode || (ov.imageScale ?? 100) >= 200}
                className="grid h-7 w-7 place-items-center rounded-lg border border-black/15 bg-white text-base font-black text-black/60 shadow-sm hover:bg-black/5 disabled:opacity-30 transition-colors"
              >
                +
              </button>
              {(ov.imageScale ?? 100) !== 100 && (
                <button
                  onClick={() => onUpdate({ imageScale: 100 })}
                  disabled={!editMode}
                  className="rounded-lg border border-black/15 bg-white px-2 py-1 text-[10px] font-semibold text-black/40 shadow-sm hover:bg-black/5 disabled:opacity-30 transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
            {ov.imageDataUrl && (ov.imageScale ?? 100) === 100 && (
              <p className="mt-1 text-[10px] text-black/35">
                Tipp: Wenn das Bild zu klein wirkt, Zoom erhöhen (→ 120–150 %).
              </p>
            )}
          </div>

        </div>

        {/* Preview */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <p className="text-[11px] font-semibold text-black/40">Vorschau</p>
          <SizePreview ov={ov} defaultImageSrc={defaultImageSrc} />
        </div>

      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────

export function PosLayoutSettings() {
  const { active, profiles, hydrated, update, saveProfile, loadProfile, deleteProfile, resetToDefault } =
    usePosLayoutStore();

  const [editMode, setEditMode] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [resetConfirm, setResetConfirm] = useState(false);
  const [draggingId, setDraggingId] = useState<PanelId | null>(null);

  const draggingIdRef = useRef<PanelId | null>(null);
  const panelsRef = useRef<PanelConfig[]>(active.panels);
  const activeRef = useRef<LayoutConfig>(active);
  panelsRef.current = active.panels;
  activeRef.current = active;

  const itemDivRefs = useRef<Map<PanelId, HTMLDivElement>>(new Map());

  function makeDragHandle(panelId: PanelId): React.HTMLAttributes<HTMLDivElement> {
    if (!editMode) return {};
    return {
      onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
        draggingIdRef.current = panelId;
        setDraggingId(panelId);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
      },
      onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (draggingIdRef.current !== panelId) return;
        const y = e.clientY;
        const panels = panelsRef.current;
        for (const [id, el] of itemDivRefs.current) {
          if (id === panelId) continue;
          const rect = el.getBoundingClientRect();
          if (y >= rect.top && y <= rect.bottom) {
            const fromIdx = panels.findIndex((p) => p.id === panelId);
            const toIdx = panels.findIndex((p) => p.id === id);
            if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
              const next = [...panels];
              next.splice(toIdx, 0, next.splice(fromIdx, 1)[0]);
              update({ ...activeRef.current, panels: next });
            }
            break;
          }
        }
      },
      onPointerUp() {
        draggingIdRef.current = null;
        setDraggingId(null);
      },
      style: { cursor: "grab", touchAction: "none" } as React.CSSProperties,
    };
  }

  function updatePanelSize(id: PanelId, size: PanelSize) {
    update({
      ...active,
      panels: active.panels.map((p) => (p.id === id ? { ...p, size } : p)),
      ...panelSizeToPixels(id, size),
    });
  }

  function applyPreset(id: PresetId) {
    if (!editMode) return;
    update(PRESETS[id].config);
  }

  function handleReset() {
    if (!resetConfirm) {
      setResetConfirm(true);
      setTimeout(() => setResetConfirm(false), 3000);
      return;
    }
    resetToDefault();
    setResetConfirm(false);
    setEditMode(false);
  }

  function handleSaveProfile() {
    const name = profileName.trim();
    if (!name) return;
    saveProfile(name);
    setProfileName("");
  }

  if (!hydrated) return null;

  const CART_WIDTH_STEPS = [320, 360, 400, 440, 480, 520];
  const cartFontOptions: { id: CartFontSize; label: string }[] = [
    { id: "normal", label: CART_FONT_LABELS.normal },
    { id: "gross", label: CART_FONT_LABELS.gross },
    { id: "xl", label: CART_FONT_LABELS.xl },
  ];

  return (
    <div className="max-w-xl space-y-4">

      {/* ── Lock / Edit toggle ──────────────────────────────────── */}
      <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow">
        <div className="flex-1">
          <p className="text-sm font-bold text-ink">Layout bearbeiten</p>
          <p className="text-xs text-black/50">
            {editMode ? "Bereiche und Größen können angepasst werden." : "Layout ist gesperrt – Normalbetrieb."}
          </p>
        </div>
        <button
          onClick={() => setEditMode((v) => !v)}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors select-none",
            editMode ? "bg-primaq-500 text-white shadow" : "bg-black/8 text-black/60 hover:bg-black/12"
          )}
        >
          {editMode ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          {editMode ? "Bearbeiten" : "Gesperrt"}
        </button>
      </div>

      {/* ── Verkaufsgrößen ─────────────────────────────────────── */}
      <div className="space-y-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">Verkaufsgrößen</p>
          <p className="mt-0.5 text-xs text-black/40">Name, Preis, Farbe und Bild pro Größe – Änderungen wirken sofort.</p>
        </div>
        {SIZES.map((size) => {
          const ov: SalesSizeOverride = {
            ...DEFAULT_LAYOUT.salesSizes[size.id],
            ...(active.salesSizes?.[size.id] ?? {}),
          };
          const enabled = active.sizeVisibility[size.id] !== false;
          const activeCount = SIZES.filter((s) => active.sizeVisibility[s.id] !== false).length;
          const isLast = enabled && activeCount === 1;
          return (
            <SizeConfigCard
              key={size.id}
              defaultImageSrc={size.imageSrc}
              ov={ov}
              enabled={enabled}
              isLast={isLast}
              editMode={editMode}
              onUpdate={(updates) =>
                update({
                  ...active,
                  salesSizes: {
                    ...active.salesSizes,
                    [size.id]: { ...ov, ...updates },
                  },
                })
              }
              onToggle={(v) =>
                update({
                  ...active,
                  sizeVisibility: { ...active.sizeVisibility, [size.id]: v },
                })
              }
            />
          );
        })}
      </div>

      {/* ── Sorten-Buttons Größe ────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-4 shadow">
        <div className="mb-4 border-b border-black/5 pb-3">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">Sorten-Buttons</p>
          <p className="mt-0.5 text-xs text-black/40">Größe der Sortenkarten im Bereich Sorten wählen</p>
        </div>
        <StepperControl
          label="Sorten-Buttons Größe"
          value={active.flavorCardSize}
          min={110}
          max={240}
          step={10}
          defaultValue={DEFAULT_LAYOUT.flavorCardSize}
          onChange={(v) => update({ ...active, flavorCardSize: v })}
        />
      </div>

      {/* ── Verkaufsmodus presets ───────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-white shadow">
        <div className="border-b border-black/5 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">Verkaufsmodus</p>
          <p className="mt-0.5 text-xs text-black/40">Passt alle Größen auf einmal an</p>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3">
          {(Object.entries(PRESETS) as [PresetId, typeof PRESETS[PresetId]][]).map(([id, preset]) => {
            const isActive =
              active.flavorCardSize === preset.config.flavorCardSize &&
              active.cartFontSize === preset.config.cartFontSize &&
              active.cartWidth === preset.config.cartWidth &&
              active.qtyButtonSize === preset.config.qtyButtonSize;
            return (
              <button
                key={id}
                onClick={() => applyPreset(id)}
                disabled={!editMode}
                className={cn(
                  "flex flex-col items-start rounded-xl px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed",
                  isActive
                    ? "bg-primaq-500 text-white shadow"
                    : editMode
                    ? "bg-black/5 text-ink hover:bg-primaq-50 hover:text-primaq-700"
                    : "bg-black/5 text-black/40"
                )}
              >
                <span className="text-sm font-black">{preset.label}</span>
                <span className={cn("mt-0.5 text-[11px] leading-tight", isActive ? "text-white/80" : "text-black/45")}>
                  {preset.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Live preview ────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-4 shadow">
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-black/40">Vorschau</p>
        <LayoutPreview config={active} />
      </div>

      {/* ── Feinjustierung ──────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-white shadow">
        <div className="border-b border-black/5 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">Feinjustierung</p>
        </div>
        <div className="divide-y divide-black/5">

          {/* Größenbereich */}
          <div className="px-4 py-4 space-y-3">
            <SliderControl
              label="Größenbereich (Klein/Mittel/Groß)"
              value={active.sizeColumnWidth}
              min={120}
              max={240}
              step={8}
              onChange={(v) => update({ ...active, sizeColumnWidth: v })}
              disabled={!editMode}
            />
          </div>

          {/* Mengenbuttons */}
          <div className="px-4 py-4 space-y-3">
            <SliderControl
              label="Mengenbuttons (− Menge +)"
              value={active.qtyButtonSize}
              min={40}
              max={80}
              step={2}
              onChange={(v) => update({ ...active, qtyButtonSize: v })}
              disabled={!editMode}
            />
          </div>

          {/* Warenkorb-Schrift */}
          <div className="px-4 py-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">Warenkorb-Schriftgröße</span>
              <span className="text-xs text-black/40">{CART_FONT_LABELS[active.cartFontSize]}</span>
            </div>
            <SegmentControl
              value={active.cartFontSize}
              options={cartFontOptions}
              onChange={(v) => update({ ...active, cartFontSize: v })}
              disabled={!editMode}
            />
          </div>

          {/* Warenkorb-Breite */}
          <div className="px-4 py-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">Warenkorb-Breite</span>
              <span className="text-sm font-bold tabular-nums text-primaq-600">{active.cartWidth}px</span>
            </div>
            <div className={cn("flex gap-1 transition-opacity", !editMode && "opacity-40 pointer-events-none")}>
              {CART_WIDTH_STEPS.map((w) => (
                <button
                  key={w}
                  onClick={() => update({ ...active, cartWidth: w })}
                  className={cn(
                    "flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors",
                    active.cartWidth === w
                      ? "bg-primaq-500 text-white shadow-sm"
                      : "bg-black/5 text-black/50 hover:bg-black/10"
                  )}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* ── Sortable panel list ──────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-white shadow">
        <div className="border-b border-black/5 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">Bereiche & Reihenfolge</p>
          {editMode && (
            <p className="mt-0.5 text-xs text-primaq-600">↕ Griff halten und verschieben</p>
          )}
        </div>
        <div className="divide-y divide-black/5">
          {active.panels.map((panel) => (
            <div
              key={panel.id}
              ref={(el) => {
                if (el) itemDivRefs.current.set(panel.id, el);
                else itemDivRefs.current.delete(panel.id);
              }}
              className={cn(
                "flex flex-col gap-3 px-4 py-3.5 transition-all duration-150",
                draggingId === panel.id && "scale-[0.99] bg-black/[0.02] opacity-50"
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  {...makeDragHandle(panel.id)}
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                    editMode
                      ? "cursor-grab bg-black/5 text-black/50 hover:bg-primaq-100 hover:text-primaq-700"
                      : "cursor-not-allowed text-black/20"
                  )}
                >
                  <GripVertical className="h-4 w-4" />
                </div>
                <div className={cn("h-2.5 w-2.5 shrink-0 rounded-full", PANEL_DOT[panel.id])} />
                <span className="flex-1 text-sm font-bold text-ink">{PANEL_LABELS[panel.id]}</span>
                <span className="text-xs font-semibold text-black/40">
                  {panel.id === "groessen"
                    ? `${active.sizeColumnWidth}px`
                    : panel.id === "warenkorb"
                    ? `${active.cartWidth}px`
                    : SIZE_LABELS[panel.size]}
                </span>
              </div>
              <div className="pl-12">
                <SizeSelector
                  value={panel.size}
                  onChange={(size) => updatePanelSize(panel.id, size)}
                  disabled={!editMode}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Visibility toggles ───────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-white shadow">
        <div className="border-b border-black/5 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">Sichtbarkeit</p>
        </div>
        <div className="divide-y divide-black/5">
          {(Object.entries(TOGGLE_LABELS) as [ToggleId, string][]).map(([id, label]) => (
            <div key={id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1 text-sm font-semibold text-ink">{label}</span>
              <Toggle
                checked={active.toggles[id]}
                onChange={(v) => update({ ...active, toggles: { ...active.toggles, [id]: v } })}
                disabled={!editMode}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Profile management ───────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-4 shadow">
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-black/40">Eigene Profile</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Name (z.B. Lichterfest, Morgen…)"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveProfile(); }}
            disabled={!editMode}
            className="flex-1 rounded-xl border border-black/15 bg-black/[0.03] px-3 py-2 text-sm font-semibold outline-none focus:border-primaq-500 focus:ring-2 focus:ring-primaq-500/20 disabled:opacity-50"
          />
          <button
            onClick={handleSaveProfile}
            disabled={!editMode || !profileName.trim()}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primaq-500 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-primaq-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className="h-4 w-4" />
            Speichern
          </button>
        </div>
        {profiles.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            {profiles.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-xl bg-black/[0.03] px-3 py-2.5">
                <span className="flex-1 truncate text-sm font-semibold text-ink">{p.name}</span>
                <button
                  onClick={() => loadProfile(p.id)}
                  className="shrink-0 rounded-lg bg-primaq-50 px-2.5 py-1.5 text-xs font-bold text-primaq-700 transition-colors hover:bg-primaq-100"
                >
                  Laden
                </button>
                <button
                  onClick={() => deleteProfile(p.id)}
                  disabled={!editMode}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-black/25 transition-colors hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-center text-xs text-black/35">Noch keine eigenen Profile</p>
        )}
      </div>

      {/* ── Reset ────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-4 shadow">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-ink">Standardlayout</p>
            <p className="text-xs text-black/50">Alle Anpassungen zurücksetzen</p>
          </div>
          <button
            onClick={handleReset}
            disabled={!editMode}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              resetConfirm ? "bg-red-500 text-white hover:bg-red-600" : "bg-black/8 text-black/60 hover:bg-black/12"
            )}
          >
            <RotateCcw className="h-4 w-4" />
            {resetConfirm ? "Wirklich?" : "Zurücksetzen"}
          </button>
        </div>
      </div>

    </div>
  );
}
