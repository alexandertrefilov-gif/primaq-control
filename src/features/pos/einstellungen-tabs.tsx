"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { dbGet, dbSet } from "@/lib/db";
import { usePosVatStore } from "./use-pos-vat-store";
import { useReportPermissionsStore } from "./use-report-permissions-store";
import type { ReportPermissions } from "./use-report-permissions-store";
import { PageHeader } from "@/components/ui/page-header";
import { PosFlavorSettings } from "./pos-flavor-settings";
import { PosLayoutSettings } from "./pos-layout-settings";
import { useGuidedModeStore } from "./use-guided-mode-store";
import { usePosThemeStore, COLOR_VARS, COLOR_LABELS, type ColorVar } from "./use-pos-theme-store";
import { SyncPanel } from "@/components/sync/sync-panel";
import { enqueueSettingsSync } from "@/lib/sync/enqueue-settings";
import { getSyncService } from "@/lib/sync/sync-service";

// Keys that flow through the pos_settings cloud-sync pipeline (enqueueSettingsSync).
// primaq-pos-year-history is intentionally excluded here — it syncs per-day via a
// separate mechanism (enqueueDaySync), not as a single settings blob.
const SYNCABLE_SETTINGS_KEYS = [
  "primaq-pos-flavors-v1",
  "primaq-pos-layout-v1",
  "primaq-pos-vat-rate",
] as const;

// Settings: Sorten, Bilder, Farben, Preise, Größen, Jahresdaten.
const SETTINGS_KEYS = [
  "primaq-pos-flavors-v1",
  "primaq-pos-layout-v1",
  "primaq-pos-vat-rate",
  "primaq-pos-year-history",
] as const;

// Backup: everything above + current-day sales state.
const BACKUP_KEYS = [
  "primaq-pos-flavors-v1",
  "primaq-pos-layout-v1",
  "primaq-pos-year-history",
  "primaq-pos-state",
] as const;

// ── Shared helpers ────────────────────────────────────────────────────────────

async function exportKeys(
  keys: readonly string[],
  type: "settings" | "backup",
  filename: string,
): Promise<void> {
  const data: Record<string, unknown> = {};
  for (const key of keys) {
    const raw = await dbGet(key);
    data[key] = raw ? (JSON.parse(raw) as unknown) : null;
  }
  const payload = { version: 1, type, exportedAt: new Date().toISOString(), keys: data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function importKeys(
  file: File,
  allowedKeys: readonly string[],
): Promise<number> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.onload = async (ev) => {
      try {
        const payload = JSON.parse(ev.target?.result as string) as {
          keys?: Record<string, unknown>;
        };
        if (!payload.keys || typeof payload.keys !== "object") {
          reject(new Error("Ungültiges Format. Bitte eine gültige PrimaQ-Exportdatei verwenden."));
          return;
        }
        let count = 0;
        let pushedAny = false;
        for (const key of allowedKeys) {
          if (key in payload.keys && payload.keys[key] !== null) {
            const value = payload.keys[key];
            await dbSet(key, JSON.stringify(value));
            count++;
            // Push imported settings to the cloud with a fresh updatedAt —
            // otherwise the stale pre-import meta timestamp stays in place,
            // and the next pull() from another device can silently overwrite
            // the just-imported data with older cloud data (LWW backwards).
            if ((SYNCABLE_SETTINGS_KEYS as readonly string[]).includes(key)) {
              await enqueueSettingsSync(key, value);
              pushedAny = true;
            }
          }
        }
        if (pushedAny) {
          try {
            await getSyncService().flush();
          } catch {
            // Import already succeeded locally; a flush failure (e.g. offline)
            // just leaves the push queued for the next successful sync.
          }
        }
        resolve(count);
      } catch {
        reject(new Error("Datei ist kein gültiges JSON."));
      }
    };
    reader.readAsText(file);
  });
}

// ── Shared icon components ────────────────────────────────────────────────────

function IconDownload() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" x2="12" y1="3" y2="15"/>
    </svg>
  );
}

function IconUpload() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" x2="12" y1="3" y2="15"/>
    </svg>
  );
}

// ── Einstellungen Export / Import ─────────────────────────────────────────────

function SettingsTransfer() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleExport = useCallback(async () => {
    const date = new Date().toISOString().slice(0, 10);
    await exportKeys(SETTINGS_KEYS, "settings", `primaq-einstellungen-${date}.json`);
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setSuccess(false);
    try {
      const count = await importKeys(file, SETTINGS_KEYS);
      if (count === 0) { setError("Keine bekannten Einstellungen in der Datei gefunden."); return; }
      setSuccess(true);
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import fehlgeschlagen.");
    }
  }, []);

  return (
    <div className="mt-6 rounded-2xl border border-black/8 bg-white p-5 shadow-sm">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-black/40">
        Einstellungen sichern
      </p>
      <p className="mb-4 text-sm text-black/50">
        Sorten, Bilder, Farben, Preise, Größen und Jahresdaten als JSON sichern oder auf einem anderen Gerät einspielen.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleExport}
          className="flex items-center gap-2 rounded-xl bg-primaq-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primaq-700 active:scale-[0.97]"
        >
          <IconDownload /> Einstellungen exportieren
        </button>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm font-bold text-black/60 shadow-sm transition-colors hover:bg-black/5 active:scale-[0.97]">
          <IconUpload /> Einstellungen importieren
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            data-testid="settings-file-input"
            onChange={handleFileChange}
          />
        </label>
      </div>
      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">{error}</p>
      )}
      {success && (
        <p className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
          Einstellungen importiert – Seite wird neu geladen…
        </p>
      )}
    </div>
  );
}

// ── Komplettes Backup ─────────────────────────────────────────────────────────

function BackupSection() {
  const backupFileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleExport = useCallback(async () => {
    const date = new Date().toISOString().slice(0, 10);
    await exportKeys(BACKUP_KEYS, "backup", `primaq-backup-${date}.json`);
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setSuccess(false);

    const confirmed = window.confirm(
      "Achtung: Alle aktuellen Daten – einschließlich heutiger Buchungen – werden überschrieben. Fortfahren?"
    );
    if (!confirmed) return;

    try {
      const count = await importKeys(file, BACKUP_KEYS);
      if (count === 0) { setError("Keine bekannten Daten in der Backup-Datei gefunden."); return; }
      setSuccess(true);
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import fehlgeschlagen.");
    }
  }, []);

  return (
    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-amber-700/60">
        Komplettes Backup
      </p>
      <p className="mb-4 text-sm text-amber-800/70">
        Alle Daten inkl. heutiger Buchungen und Jahreshistorie exportieren oder vollständig wiederherstellen.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleExport}
          className="flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-amber-700 active:scale-[0.97]"
        >
          <IconDownload /> Komplettes Backup exportieren
        </button>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-bold text-amber-800 shadow-sm transition-colors hover:bg-amber-50 active:scale-[0.97]">
          <IconUpload /> Backup importieren
          <input
            ref={backupFileRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            data-testid="backup-file-input"
            onChange={handleFileChange}
          />
        </label>
      </div>
      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">{error}</p>
      )}
      {success && (
        <p className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
          Backup importiert – Seite wird neu geladen…
        </p>
      )}
    </div>
  );
}

// ── Grundeinstellungen (VAT) ──────────────────────────────────────────────────

function GrundeinstellungenSection() {
  const { vatRate, setVatRate, hydrated } = usePosVatStore();
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    if (hydrated) setInputValue(String(vatRate));
  }, [hydrated, vatRate]);

  const handlePreset = (v: number) => {
    setVatRate(v);
    setInputValue(String(v));
  };

  const handleBlur = () => {
    const parsed = parseFloat(inputValue.replace(",", "."));
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
      const rounded = Math.round(parsed * 100) / 100;
      setVatRate(rounded);
      setInputValue(String(rounded));
    } else {
      setInputValue(String(vatRate));
    }
  };

  return (
    <div className="rounded-2xl border border-black/8 bg-white p-5 shadow-sm">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-black/40">
        Mehrwertsteuer
      </p>
      <p className="mb-3 text-sm font-semibold text-ink">Mehrwertsteuer (%)</p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {([0, 7, 19] as const).map((v) => (
          <button
            key={v}
            data-testid={`vat-preset-${v}`}
            onClick={() => handlePreset(v)}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-bold transition-colors",
              vatRate === v
                ? "bg-primaq-500 text-white shadow"
                : "border border-black/15 bg-white text-black/60 hover:bg-black/5"
            )}
          >
            {v} %
          </button>
        ))}
        <div className="flex items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            data-testid="vat-rate-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={handleBlur}
            className="w-20 rounded-xl border border-black/15 px-3 py-2 text-sm font-bold text-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-primaq-500"
            placeholder="5,5"
          />
          <span className="text-sm font-bold text-black/40">%</span>
        </div>
      </div>
      <p className="text-xs text-black/40">
        Standard für Softeis zum Mitnehmen: 7 %. Der tatsächlich anzuwendende Steuersatz richtet sich nach den steuerlichen Vorgaben des Betriebs.
      </p>
    </div>
  );
}

// ── Freigaben (Bericht-Berechtigungen) ────────────────────────────────────────

const REPORT_LABELS: { key: keyof ReportPermissions; label: string; desc: string }[] = [
  { key: "tagesabschluss", label: "Tagesabschluss", desc: "Tagesumsatz, Bestellliste, CSV-Export" },
  { key: "wochenbericht",  label: "Wochenbericht",  desc: "Wöchentliche Umsatzübersicht und CSV-Export" },
  { key: "monatsbericht",  label: "Monatsbericht",  desc: "Monatliche Tagesauflistung und CSV-Export" },
  { key: "jahresabschluss", label: "Jahresabschluss", desc: "Jahresauswertung und Reset (nur Admin)" },
];

function FreigabenSection() {
  const { permissions, setPermission, hydrated } = useReportPermissionsStore();

  if (!hydrated) {
    return <div className="flex h-24 items-center justify-center text-black/30">Laden…</div>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-black/8 bg-white p-5 shadow-sm">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-black/40">
          Berichte-Freigaben für Nicht-Admins
        </p>
        <p className="mb-4 text-sm text-black/50">
          Welche Berichte können Mitarbeiter ohne Admin-Anmeldung einsehen?
        </p>
        <div className="space-y-3">
          {REPORT_LABELS.map(({ key, label, desc }) => (
            <label
              key={key}
              data-testid={`perm-toggle-${key}`}
              className="flex cursor-pointer items-start gap-4 rounded-xl border border-black/8 bg-black/[0.02] px-4 py-3 hover:bg-black/[0.04] transition-colors"
            >
              <div className="flex-1">
                <p className="text-sm font-bold text-ink">{label}</p>
                <p className="text-xs text-black/40">{desc}</p>
              </div>
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={permissions[key]}
                  onChange={(e) => setPermission(key, e.target.checked)}
                />
                <div
                  className={cn(
                    "h-6 w-11 rounded-full transition-colors",
                    permissions[key] ? "bg-primaq-500" : "bg-black/15"
                  )}
                />
                <div
                  className={cn(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                    permissions[key] ? "translate-x-5" : "translate-x-0.5"
                  )}
                />
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Color picker row ─────────────────────────────────────────────────────────

function ColorPickerRow({
  variable,
  value,
  isCustom,
  onColor,
  onReset,
}: {
  variable: ColorVar;
  value: string;
  isCustom: boolean;
  onColor: (v: string) => void;
  onReset: () => void;
}) {
  const [hex, setHex] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setHex(value), [value]);

  const tryApply = (raw: string) => {
    const c = raw.startsWith("#") ? raw : `#${raw}`;
    if (/^#[0-9a-fA-F]{6}$/.test(c)) onColor(c);
  };

  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 text-sm font-medium text-ink">{COLOR_LABELS[variable]}</span>
      {/* Swatch opens native color picker */}
      <div
        className="relative h-8 w-11 shrink-0 cursor-pointer rounded-lg border border-black/15 shadow-sm overflow-hidden"
        style={{ backgroundColor: value }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="color"
          value={value}
          onChange={(e) => { onColor(e.target.value); setHex(e.target.value); }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          tabIndex={-1}
        />
      </div>
      {/* Hex text input */}
      <input
        type="text"
        value={hex}
        onChange={(e) => setHex(e.target.value)}
        onBlur={() => tryApply(hex)}
        onKeyDown={(e) => { if (e.key === "Enter") tryApply(hex); }}
        maxLength={7}
        placeholder="#000000"
        className="w-24 rounded-lg border border-black/12 bg-black/[0.03] px-2 py-1 text-xs font-mono text-ink outline-none focus:border-primaq-500 focus:ring-2 focus:ring-primaq-500/20"
      />
      {/* Reset to theme default */}
      {isCustom && (
        <button
          onClick={onReset}
          title="Zurücksetzen"
          className="ml-auto text-xs text-black/35 hover:text-red-500 transition-colors"
        >
          ↺ Reset
        </button>
      )}
    </div>
  );
}

// ── Tab layout ────────────────────────────────────────────────────────────────

type Tab = "grundeinstellungen" | "sorten" | "oberflaeche" | "freigaben" | "sync";

const TABS: { id: Tab; label: string }[] = [
  { id: "grundeinstellungen", label: "Grundeinstellungen" },
  { id: "sorten", label: "Sorten" },
  { id: "oberflaeche", label: "Verkaufsoberfläche" },
  { id: "freigaben", label: "Freigaben" },
  { id: "sync", label: "Sync" },
];

export function EinstellungenTabs({ legacySettings }: { legacySettings: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>("sorten");
  const { guidedMode, setGuidedMode } = useGuidedModeStore();
  const { theme, setTheme, custom, resolvedColors, setCustomColor, resetCustomColor, resetAllCustomColors } = usePosThemeStore();

  return (
    <div>
      <div className="mb-5 flex gap-1 rounded-2xl bg-black/5 p-1 overflow-x-auto">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors",
              tab === id ? "bg-white text-ink shadow-sm" : "text-black/50 hover:text-black/70"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "grundeinstellungen" && (
        <>
          <PageHeader
            title="Grundeinstellungen"
            description="Steuerliche und betriebliche Basiseinstellungen für den POS."
          />
          <GrundeinstellungenSection />
        </>
      )}

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
          <div className="mb-4 rounded-2xl border border-black/8 bg-white/60 px-4 py-3 space-y-3">
            {/* Nacht / Tag Auswahl */}
            <div>
              <p className="text-sm font-semibold text-ink mb-2">Ansicht</p>
              <div className="flex gap-2">
                {([["graphite", "Nacht ☾"], ["hell", "Tag ☀"]] as const).map(([val, label]) => (
                  <button
                    key={val}
                    data-testid={`design-toggle-${val}`}
                    onClick={() => setTheme(val)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-all",
                      theme === val
                        ? "border-primaq-500 bg-primaq-500/10 text-primaq-700"
                        : "border-black/10 bg-white text-black/50 hover:border-black/20"
                    )}
                  >
                    <span className={cn(
                      "h-3.5 w-3.5 rounded-full border-2 flex-shrink-0",
                      theme === val
                        ? "border-primaq-500 bg-primaq-500"
                        : "border-black/25"
                    )} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {/* Farbeinstellung je Bereich */}
            <div className="border-t border-black/8 pt-3 space-y-2.5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold text-ink">Farben anpassen</p>
                {Object.keys(custom).length > 0 && (
                  <button
                    onClick={resetAllCustomColors}
                    className="text-xs text-black/35 hover:text-red-500 transition-colors"
                  >
                    Alle zurücksetzen
                  </button>
                )}
              </div>
              {COLOR_VARS.map((v) => (
                <ColorPickerRow
                  key={v}
                  variable={v}
                  value={resolvedColors[v]}
                  isCustom={!!custom[v]}
                  onColor={(c) => setCustomColor(v, c)}
                  onReset={() => resetCustomColor(v)}
                />
              ))}
            </div>
            {/* Hinweis: Bereichsgrößen jetzt direkt auf der Verkaufsseite */}
            <div
              data-testid="device-layout-resize-hint"
              className="flex items-start gap-2.5 rounded-2xl border border-primaq-100 bg-primaq-50 p-3 text-xs text-primaq-700"
            >
              <p>
                Die Größen der Kassenbereiche werden jetzt direkt auf der Verkaufsseite
                eingestellt: Admin → <strong>„Layout anpassen“</strong> auf /verkauf.
              </p>
            </div>
            {/* Geführter Verkaufsmodus */}
            <div className="flex items-center justify-between gap-4 border-t border-black/8 pt-3">
              <div>
                <p className="text-sm font-semibold text-ink">Geführter Verkaufsmodus</p>
                <p className="text-xs text-black/50">Schritt-für-Schritt-Hervorhebung beim Kassieren</p>
              </div>
              <button
                data-testid="guided-mode-toggle"
                onClick={() => setGuidedMode(!guidedMode)}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  guidedMode ? "bg-[#00D6A3]" : "bg-black/20"
                )}
                role="switch"
                aria-checked={guidedMode}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform",
                    guidedMode ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>
          </div>
          <PosLayoutSettings />
        </>
      )}

      {tab === "freigaben" && (
        <>
          <PageHeader
            title="Freigaben"
            description="Steuern, welche Berichte Mitarbeiter ohne Admin-PIN einsehen dürfen."
          />
          <FreigabenSection />
        </>
      )}

      {tab === "sync" && (
        <>
          <PageHeader
            title="Synchronisation"
            description="Jahresdaten mit der Cloud synchronisieren und Queue-Status prüfen."
          />
          <SyncPanel />
        </>
      )}

      {tab !== "sync" && tab !== "freigaben" && (
        <>
          <SettingsTransfer />
          <BackupSection />
        </>
      )}
    </div>
  );
}
