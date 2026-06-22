"use client";

import { useState, useRef } from "react";
import { GripVertical, Lock, Unlock, RotateCcw, Save, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  usePosLayoutStore,
  PANEL_LABELS,
  SIZE_LABELS,
  TOGGLE_LABELS,
} from "./use-pos-layout-store";
import type { LayoutConfig, PanelConfig, PanelId, PanelSize, ToggleId } from "./use-pos-layout-store";

// ── Panel preview helpers ──────────────────────────────────────────

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

// Approximate flex weights for the preview bar
const PREVIEW_FLEX: Record<PanelId, Record<PanelSize, number>> = {
  groessen: { klein: 0.7, mittel: 0.9, gross: 1.2, xl: 1.7 },
  sorten:   { klein: 2.5, mittel: 2.5, gross: 2.5, xl: 2.5 },
  warenkorb:{ klein: 1.8, mittel: 2.1, gross: 2.5, xl: 3.3 },
};

function LayoutPreview({ config }: { config: LayoutConfig }) {
  return (
    <div className="flex h-14 overflow-hidden rounded-xl border border-black/8">
      {config.panels.map((panel) => (
        <div
          key={panel.id}
          className={cn(
            "flex items-center justify-center px-1 text-[10px] font-bold leading-tight text-center",
            PANEL_BG[panel.id]
          )}
          style={{ flex: PREVIEW_FLEX[panel.id][panel.size] }}
        >
          {PANEL_LABELS[panel.id]}
        </div>
      ))}
    </div>
  );
}

// ── Size selector ──────────────────────────────────────────────────

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
            value === s
              ? "bg-primaq-500 text-white shadow-sm"
              : "bg-black/5 text-black/50 hover:bg-black/10"
          )}
        >
          {SIZE_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

// ── iOS-compatible toggle switch ──────────────────────────────────

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

// ── Main settings component ────────────────────────────────────────

export function PosLayoutSettings() {
  const { active, profiles, hydrated, update, saveProfile, loadProfile, deleteProfile, resetToDefault } =
    usePosLayoutStore();

  const [editMode, setEditMode] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [resetConfirm, setResetConfirm] = useState(false);
  const [draggingId, setDraggingId] = useState<PanelId | null>(null);

  // Refs to avoid stale closures in pointer handlers
  const draggingIdRef = useRef<PanelId | null>(null);
  const panelsRef = useRef<PanelConfig[]>(active.panels);
  const activeRef = useRef<LayoutConfig>(active);
  panelsRef.current = active.panels;
  activeRef.current = active;

  // Per-item DOM refs for bounding-box hit testing
  const itemDivRefs = useRef<Map<PanelId, HTMLDivElement>>(new Map());

  // Returns pointer-event props for a drag handle; uses setPointerCapture so
  // move/up events keep firing even when the finger leaves the element.
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

  function updateSize(id: PanelId, size: PanelSize) {
    update({ ...active, panels: active.panels.map((p) => (p.id === id ? { ...p, size } : p)) });
  }

  function updateToggle(id: ToggleId, value: boolean) {
    update({ ...active, toggles: { ...active.toggles, [id]: value } });
  }

  function handleSaveProfile() {
    const name = profileName.trim();
    if (!name) return;
    saveProfile(name);
    setProfileName("");
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

  if (!hydrated) return null;

  return (
    <div className="max-w-xl space-y-4">
      {/* ── Lock / Edit toggle ─────────────────────────────────── */}
      <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow">
        <div className="flex-1">
          <p className="text-sm font-bold text-ink">Layout bearbeiten</p>
          <p className="text-xs text-black/50">
            {editMode
              ? "Bereiche antippen und verschieben."
              : "Layout ist gesperrt – Normalbetrieb."}
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

      {/* ── Live preview ───────────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-4 shadow">
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-black/40">Vorschau</p>
        <LayoutPreview config={active} />
      </div>

      {/* ── Sortable panel list ────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-white shadow">
        <div className="border-b border-black/5 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-widest text-black/40">Bereiche</p>
          {editMode && (
            <p className="mt-0.5 text-xs text-primaq-600">↕ Griff halten und nach oben/unten verschieben</p>
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
                      ? "cursor-grab bg-black/5 text-black/50 hover:bg-primaq-100 hover:text-primaq-700 active:cursor-grabbing"
                      : "cursor-not-allowed text-black/20"
                  )}
                >
                  <GripVertical className="h-4 w-4" />
                </div>
                <div className={cn("h-2.5 w-2.5 shrink-0 rounded-full", PANEL_DOT[panel.id])} />
                <span className="flex-1 text-sm font-bold text-ink">{PANEL_LABELS[panel.id]}</span>
                <span className="text-xs font-semibold text-black/40">{SIZE_LABELS[panel.size]}</span>
              </div>
              <div className="pl-12">
                <SizeSelector
                  value={panel.size}
                  onChange={(size) => updateSize(panel.id, size)}
                  disabled={!editMode}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Visibility toggles ─────────────────────────────────── */}
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
                onChange={(v) => updateToggle(id, v)}
                disabled={!editMode}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Profile management ─────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-4 shadow">
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-black/40">Profile</p>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Name (z.B. Alexander, Rush-Hour…)"
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
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-xl bg-black/[0.03] px-3 py-2.5"
              >
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
          <p className="mt-3 text-center text-xs text-black/35">Noch keine Profile gespeichert</p>
        )}
      </div>

      {/* ── Reset to default ───────────────────────────────────── */}
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
