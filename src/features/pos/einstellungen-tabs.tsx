"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { dbGet, dbSet } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { PosFlavorSettings } from "./pos-flavor-settings";
import { PosLayoutSettings } from "./pos-layout-settings";

// Settings: Sorten, Bilder, Farben, Preise, Größen, Jahresdaten.
const SETTINGS_KEYS = [
  "primaq-pos-flavors-v1",
  "primaq-pos-layout-v1",
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
        for (const key of allowedKeys) {
          if (key in payload.keys && payload.keys[key] !== null) {
            await dbSet(key, JSON.stringify(payload.keys[key]));
            count++;
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

// ── Tab layout ────────────────────────────────────────────────────────────────

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

      <SettingsTransfer />
      <BackupSection />
    </div>
  );
}
