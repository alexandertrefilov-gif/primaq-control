"use client";

import { useCallback, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MACHINE_GROUP_LABELS } from "./pos-config";
import { usePosFlavorStore } from "./use-pos-flavor-store";
import type { MutableFlavor } from "./use-pos-flavor-store";

// ── Image compression ─────────────────────────────────────────────────────────

const MAX_IMG_PX = 512;       // longest edge after resize
const IMG_QUALITY = 0.85;
const MAX_BYTES = 500 * 1024; // 500 KB hard cap (actual bytes)
// base64 chars for MAX_BYTES: each 3 bytes → 4 chars
const MAX_B64_CHARS = Math.ceil(MAX_BYTES * (4 / 3));

type CompressResult = { dataUrl: string; error?: string };

async function compressImage(file: File): Promise<CompressResult> {
  // SVG: store as-is, but reject if too large
  if (file.type === "image/svg+xml") {
    if (file.size > 100 * 1024) {
      return { dataUrl: "", error: "SVG ist zu groß (max. 100 KB). Bitte als PNG oder WebP exportieren." };
    }
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve({ dataUrl: "", error: "Bild konnte nicht gelesen werden." });
      reader.onload = (e) => resolve({ dataUrl: e.target?.result as string });
      reader.readAsDataURL(file);
    });
  }

  // Raster: resize via canvas → WebP (or JPEG fallback)
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve({ dataUrl: "", error: "Bild konnte nicht gelesen werden." });
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => resolve({ dataUrl: "", error: "Bild konnte nicht geladen werden." });
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMG_PX || height > MAX_IMG_PX) {
          if (width >= height) {
            height = Math.round((height / width) * MAX_IMG_PX);
            width = MAX_IMG_PX;
          } else {
            width = Math.round((width / height) * MAX_IMG_PX);
            height = MAX_IMG_PX;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve({ dataUrl: "", error: "Canvas nicht verfügbar." });
        ctx.drawImage(img, 0, 0, width, height);

        // WebP preferred; PNG as fallback (preserves transparency, unlike JPEG)
        let dataUrl = canvas.toDataURL("image/webp", IMG_QUALITY);
        if (!dataUrl.startsWith("data:image/webp")) {
          dataUrl = canvas.toDataURL("image/png");
        }

        if (dataUrl.length > MAX_B64_CHARS) {
          return resolve({ dataUrl: "", error: "Bild ist zu groß. Bitte ein kleineres Bild verwenden." });
        }
        resolve({ dataUrl });
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const linearize = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function autoTextColor(hex: string): string {
  return luminance(hex) > 0.35 ? "#1a1a1a" : "#ffffff";
}

const PRESET_COLORS = [
  "#FFF3B0", "#FFE5A0", "#FFD080", "#FFAB40",
  "#E8204A", "#C62828", "#3D1800", "#5C3800",
  "#2196F3", "#0D47A1", "#1B5E20", "#4CAF50",
  "#9C27B0", "#6A1B9A", "#455A64", "#212121",
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Mini preview card ─────────────────────────────────────────────────────────

function FlavorPreviewCard({ flavor }: { flavor: MutableFlavor }) {
  const scale = (flavor.imageScale ?? 100) / 100;
  return (
    <div
      className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full shadow-md"
      style={{ background: flavor.backgroundColor }}
    >
      {flavor.imageSrc && (
        <div className="absolute inset-[10%] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={flavor.imageSrc}
            alt=""
            draggable={false}
            className="block h-full w-full object-contain drop-shadow"
            style={scale !== 1 ? { transform: `scale(${scale})`, transformOrigin: "center" } : undefined}
          />
        </div>
      )}
    </div>
  );
}

// ── Auto-generated mix preview ────────────────────────────────────────────────

function MixPreview({ a, b }: { a: MutableFlavor; b: MutableFlavor }) {
  const nameA = a.displayName?.trim() || a.name;
  const nameB = b.displayName?.trim() || b.name;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-black/5 px-3 py-2.5">
      <div
        className="relative h-12 w-12 overflow-hidden rounded-lg shadow-sm"
        aria-hidden
      >
        <div
          className="absolute inset-0"
          style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)", background: a.backgroundColor }}
        />
        <div
          className="absolute inset-0"
          style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)", background: b.backgroundColor }}
        />
      </div>
      <div>
        <p className="text-sm font-bold text-black/80">Mix {nameA}/{nameB}</p>
        <p className="text-[11px] text-black/40">Automatisch generiert</p>
      </div>
    </div>
  );
}

// ── Single flavor edit form ───────────────────────────────────────────────────

function FlavorEditForm({
  flavor,
  onUpdate,
  onRemove,
}: {
  flavor: MutableFlavor;
  onUpdate: (id: string, patch: Partial<MutableFlavor>) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formId = useId();

  const set = useCallback(
    (patch: Partial<MutableFlavor>) => onUpdate(flavor.id, patch),
    [flavor.id, onUpdate]
  );

  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setUploadWarning(null);
      const result = await compressImage(file);
      if (result.error) {
        setUploadWarning(result.error);
        return;
      }
      set({ imageSrc: result.dataUrl });
    },
    [set]
  );

  const handleColorChange = useCallback(
    (hex: string) => {
      set({ backgroundColor: hex, textColor: autoTextColor(hex) });
    },
    [set]
  );

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white shadow-sm transition-all",
        flavor.isActive ? "border-black/10" : "border-black/5 opacity-60"
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <GripVertical className="h-4 w-4 shrink-0 text-black/20" />
        <FlavorPreviewCard flavor={flavor} />
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-black text-black/80">
            {flavor.displayName?.trim() || flavor.name || <span className="italic text-black/30">Kein Name</span>}
          </p>
          <p className="text-[11px] text-black/40">{MACHINE_GROUP_LABELS[flavor.group] ?? flavor.group}</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 select-none shrink-0">
          <span className="text-xs font-semibold text-black/50">{flavor.isActive ? "Aktiv" : "Inaktiv"}</span>
          <div
            className={cn(
              "relative h-6 w-11 rounded-full transition-colors",
              flavor.isActive ? "bg-primaq-500" : "bg-black/20"
            )}
            onClick={() => set({ isActive: !flavor.isActive })}
            role="switch"
            aria-checked={flavor.isActive}
            tabIndex={0}
            onKeyDown={(e) => e.key === " " && set({ isActive: !flavor.isActive })}
          >
            <div
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                flavor.isActive ? "translate-x-5" : "translate-x-0.5"
              )}
            />
          </div>
        </label>
        <button
          onClick={() => setOpen((o) => !o)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-black/5 transition-colors"
          aria-label={open ? "Einklappen" : "Bearbeiten"}
        >
          {open ? <ChevronUp className="h-4 w-4 text-black/50" /> : <ChevronDown className="h-4 w-4 text-black/50" />}
        </button>
      </div>

      {/* Edit fields */}
      {open && (
        <div className="border-t border-black/5 px-4 py-4 space-y-4">
          {/* Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${formId}-name`} className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-black/40">
                Sortenname
              </label>
              <input
                id={`${formId}-name`}
                type="text"
                value={flavor.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="z. B. Vanille"
                className="w-full rounded-xl border border-black/15 bg-black/[0.03] px-3 py-2 text-sm font-semibold outline-none focus:border-primaq-500 focus:ring-2 focus:ring-primaq-500/20"
              />
            </div>
            <div>
              <label htmlFor={`${formId}-displayName`} className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-black/40">
                Verkaufsname <span className="normal-case font-normal">(optional)</span>
              </label>
              <input
                id={`${formId}-displayName`}
                type="text"
                value={flavor.displayName ?? ""}
                onChange={(e) => set({ displayName: e.target.value || undefined })}
                placeholder={flavor.name || "Wie Sortenname"}
                className="w-full rounded-xl border border-black/15 bg-black/[0.03] px-3 py-2 text-sm outline-none focus:border-primaq-500 focus:ring-2 focus:ring-primaq-500/20"
              />
            </div>
          </div>

          {/* Color */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-black/40">Kartenfarbe</p>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => handleColorChange(c)}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-transform active:scale-90",
                    flavor.backgroundColor === c ? "border-primaq-500 scale-110" : "border-white shadow"
                  )}
                  style={{ background: c }}
                  title={c}
                />
              ))}
              <label
                className="grid h-7 w-7 cursor-pointer place-items-center rounded-full border-2 border-dashed border-black/20 bg-white text-[10px] font-bold text-black/40 hover:border-primaq-400 transition-colors"
                title="Eigene Farbe"
              >
                +
                <input
                  type="color"
                  className="sr-only"
                  value={flavor.backgroundColor}
                  onChange={(e) => handleColorChange(e.target.value)}
                />
              </label>
            </div>
          </div>

          {/* Text color */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-black/40">Textfarbe</p>
            <div className="flex gap-2">
              {(["#ffffff", "#1a1a1a", "auto"] as const).map((tc) => {
                const resolved = tc === "auto" ? autoTextColor(flavor.backgroundColor) : tc;
                const active =
                  tc === "auto"
                    ? flavor.textColor === autoTextColor(flavor.backgroundColor)
                    : flavor.textColor === tc;
                return (
                  <button
                    key={tc}
                    onClick={() => set({ textColor: resolved })}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-bold transition-all",
                      active
                        ? "border-primaq-500 bg-primaq-50 text-primaq-700"
                        : "border-black/10 bg-white text-black/50 hover:border-black/20"
                    )}
                  >
                    {tc === "#ffffff" ? "Hell" : tc === "#1a1a1a" ? "Dunkel" : "Auto"}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Image upload */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-black/40">Bild / Icon</p>
            <div className="flex items-center gap-3">
              {flavor.imageSrc ? (
                <>
                  <div
                    className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl shadow-sm"
                    style={{ background: flavor.backgroundColor }}
                  >
                    <div className="absolute inset-[8%]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={flavor.imageSrc} alt="" draggable={false} className="block h-full w-full object-contain" />
                    </div>
                  </div>
                  <button
                    onClick={() => set({ imageSrc: undefined })}
                    className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-black/50 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                  >
                    Entfernen
                  </button>
                </>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl border-2 border-dashed border-black/15 px-4 py-2.5 text-xs font-semibold text-black/40 hover:border-primaq-400 hover:text-primaq-600 transition-colors"
                >
                  Bild hochladen (PNG, SVG, JPG)
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleImageUpload}
              />
            </div>
            {uploadWarning && (
              <p className="mt-2 text-xs font-semibold text-red-600">{uploadWarning}</p>
            )}
          </div>

          {/* Image zoom */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-black/40">Bild-Zoom</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => set({ imageScale: Math.max(50, (flavor.imageScale ?? 100) - 10) })}
                disabled={(flavor.imageScale ?? 100) <= 50}
                className="grid h-7 w-7 place-items-center rounded-lg border border-black/15 bg-white text-base font-black text-black/60 shadow-sm hover:bg-black/5 disabled:opacity-30 transition-colors"
              >
                −
              </button>
              <span className="w-14 text-center text-sm font-bold tabular-nums text-black/70">
                {flavor.imageScale ?? 100} %
              </span>
              <button
                onClick={() => set({ imageScale: Math.min(250, (flavor.imageScale ?? 100) + 10) })}
                disabled={(flavor.imageScale ?? 100) >= 250}
                className="grid h-7 w-7 place-items-center rounded-lg border border-black/15 bg-white text-base font-black text-black/60 shadow-sm hover:bg-black/5 disabled:opacity-30 transition-colors"
              >
                +
              </button>
              {(flavor.imageScale ?? 100) !== 100 && (
                <button
                  onClick={() => set({ imageScale: 100 })}
                  className="rounded-lg border border-black/15 bg-white px-2 py-1 text-[10px] font-semibold text-black/40 shadow-sm hover:bg-black/5 transition-colors"
                >
                  Standard
                </button>
              )}
            </div>
            {flavor.imageSrc && (flavor.imageScale ?? 100) === 100 && (
              <p className="mt-1 text-[10px] text-black/35">Für Bilder mit transparentem Rand: Zoom erhöhen.</p>
            )}
          </div>

          {/* Machine assignment */}
          <div>
            <label htmlFor={`${formId}-group`} className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-black/40">
              Maschine / Slot
            </label>
            <select
              id={`${formId}-group`}
              value={flavor.group}
              onChange={(e) => set({ group: e.target.value })}
              className="w-full rounded-xl border border-black/15 bg-black/[0.03] px-3 py-2 text-sm font-semibold outline-none focus:border-primaq-500 focus:ring-2 focus:ring-primaq-500/20"
            >
              {Object.entries(MACHINE_GROUP_LABELS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>

          {/* Delete */}
          <div className="flex justify-end pt-2 border-t border-black/5">
            <button
              onClick={() => onRemove(flavor.id)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Sorte löschen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Machine group section ─────────────────────────────────────────────────────

function MachineGroupSection({
  groupId,
  groupLabel,
  flavors,
  allFlavors,
  onUpdate,
  onRemove,
  onAdd,
}: {
  groupId: string;
  groupLabel: string;
  flavors: MutableFlavor[];
  allFlavors: MutableFlavor[];
  onUpdate: (id: string, patch: Partial<MutableFlavor>) => void;
  onRemove: (id: string) => void;
  onAdd: (f: MutableFlavor) => void;
}) {
  const active = flavors.filter((f) => f.isActive);
  const hasMix = active.length >= 2;

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <p className="text-sm font-black text-black/70 uppercase tracking-widest">{groupLabel}</p>
        <div className="flex-1 h-px bg-black/10" />
        <button
          onClick={() =>
            onAdd({
              id: uid(),
              name: "",
              group: groupId,
              backgroundColor: "#FFF3B0",
              textColor: "#5C4200",
              isActive: true,
              imageScale: 100,
            })
          }
          className="flex items-center gap-1 rounded-lg border border-black/15 px-2.5 py-1 text-xs font-semibold text-black/50 hover:border-primaq-400 hover:text-primaq-700 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Neue Sorte
        </button>
      </div>

      <div className="space-y-2">
        {flavors.map((f) => (
          <FlavorEditForm
            key={f.id}
            flavor={f}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
        {flavors.length === 0 && (
          <p className="py-4 text-center text-sm text-black/30">Noch keine Sorten für diese Maschine.</p>
        )}
      </div>

      {hasMix && (
        <div className="mt-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-black/35">Auto-Mix</p>
          <MixPreview a={active[0]} b={active[1]} />
        </div>
      )}
    </section>
  );
}

// ── Main settings component ───────────────────────────────────────────────────

export function PosFlavorSettings({
  legacySettings,
}: {
  legacySettings?: React.ReactNode;
}) {
  const { base, hydrated, update, add, remove, storageError, clearStorageError } = usePosFlavorStore();
  const [legacyOpen, setLegacyOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("primaq-legacy-settings-open") === "1";
    }
    return false;
  });

  const toggleLegacy = useCallback((open: boolean) => {
    setLegacyOpen(open);
    if (typeof window !== "undefined") {
      localStorage.setItem("primaq-legacy-settings-open", open ? "1" : "0");
    }
  }, []);

  if (!hydrated) {
    return <div className="flex h-40 items-center justify-center text-black/40">Laden…</div>;
  }

  const groups = Object.entries(MACHINE_GROUP_LABELS);

  // Base64 chars that correspond to MAX_BYTES actual data
  const hasOversizedImages = base.some(
    (f) => f.imageSrc?.startsWith("data:") && f.imageSrc.length > MAX_B64_CHARS
  );

  const handleCleanupImages = () => {
    base.forEach((f) => {
      if (f.imageSrc?.startsWith("data:") && f.imageSrc.length > MAX_B64_CHARS) {
        update(f.id, { imageSrc: undefined });
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Storage error banner */}
      {storageError && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="flex-1 text-sm font-semibold text-red-700">{storageError}</p>
          <button
            onClick={clearStorageError}
            className="mt-0.5 shrink-0 text-red-400 hover:text-red-600 transition-colors"
            aria-label="Fehler schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Oversized image cleanup */}
      {hasOversizedImages && (
        <div className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">
            Übergroße Bilder gefunden (über 500 KB). Diese können den Speicher füllen.
          </p>
          <button
            onClick={handleCleanupImages}
            className="ml-4 shrink-0 rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 transition-colors"
          >
            Bildspeicher bereinigen
          </button>
        </div>
      )}

      {/* Flavor groups */}
      <div className="space-y-8">
        {groups.map(([groupId, groupLabel]) => {
          const groupFlavors = base.filter((f) => f.group === groupId);
          return (
            <MachineGroupSection
              key={groupId}
              groupId={groupId}
              groupLabel={groupLabel}
              flavors={groupFlavors}
              allFlavors={base}
              onUpdate={update}
              onRemove={remove}
              onAdd={add}
            />
          );
        })}
      </div>

      {/* Legacy data collapse */}
      {legacySettings && (
        <div className="rounded-2xl border border-black/10 bg-white">
          <button
            data-testid="legacy-settings-toggle"
            onClick={() => toggleLegacy(!legacyOpen)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div>
              <p className="text-sm font-black text-black/60">Erweiterte Lagerdaten</p>
              <p className="text-[11px] text-black/35">Rezepte, Einsatzmengen, Maschinen-Details</p>
            </div>
            {legacyOpen ? (
              <ChevronUp className="h-4 w-4 text-black/30" />
            ) : (
              <ChevronDown className="h-4 w-4 text-black/30" />
            )}
          </button>
          {legacyOpen && (
            <div className="border-t border-black/5 px-5 py-4">{legacySettings}</div>
          )}
        </div>
      )}
    </div>
  );
}
