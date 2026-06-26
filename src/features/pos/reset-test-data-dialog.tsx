"use client";

import { useState, useCallback } from "react";
import { getSyncService } from "@/lib/sync/sync-service";

interface ResetTestDataDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PRESERVED_ITEMS = [
  "Sorten", "Bilder", "Layout", "Preise",
  "Admin-Einstellungen", "PIN", "Synchronisation", "Cloud-Einstellungen",
];

function IconWarning() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className="text-red-600" aria-hidden>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
      <path d="M12 9v4"/><path d="M12 17h.01"/>
    </svg>
  );
}

function IconCheck() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

export function ResetTestDataDialog({ open, onClose, onSuccess }: ResetTestDataDialogProps) {
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConfirm = inputValue === "RESET";

  const handleConfirm = useCallback(async () => {
    if (!canConfirm || loading) return;
    setLoading(true);
    setError(null);
    try {
      await getSyncService().resetSalesData();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset fehlgeschlagen.");
      setLoading(false);
    }
  }, [canConfirm, loading, onSuccess]);

  const handleClose = useCallback(() => {
    if (loading) return;
    setInputValue("");
    setError(null);
    onClose();
  }, [loading, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-dialog-title"
        data-testid="reset-test-data-dialog"
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        {/* Header */}
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
            <IconWarning />
          </div>
          <div>
            <p id="reset-dialog-title" className="text-base font-black text-black/90">
              Testdaten zurücksetzen
            </p>
            <p className="mt-0.5 text-sm text-black/60">
              Alle Verkaufsdaten und Statistiken werden gelöscht.
            </p>
          </div>
        </div>

        {/* Preserved data */}
        <div className="mb-4 rounded-xl bg-green-50 p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-green-800/60">
            Folgende Daten bleiben erhalten
          </p>
          <div className="grid grid-cols-2 gap-1">
            {PRESERVED_ITEMS.map((item) => (
              <div key={item} className="flex items-center gap-1.5 text-sm font-semibold text-green-800">
                <IconCheck />
                {item}
              </div>
            ))}
          </div>
        </div>

        <p className="mb-4 text-sm font-semibold text-red-600">
          Diese Aktion kann nicht rückgängig gemacht werden.
        </p>

        {/* Confirmation input */}
        <label className="block">
          <span className="text-sm font-bold text-black/70">
            Bitte zur Bestätigung eingeben:{" "}
            <span className="font-black text-black/90 tracking-widest">RESET</span>
          </span>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canConfirm) void handleConfirm(); }}
            disabled={loading}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="RESET"
            data-testid="reset-confirmation-input"
            className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm font-bold tracking-widest text-black/90 placeholder-black/20 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:opacity-60"
          />
        </label>

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {error}
          </p>
        )}

        {/* Buttons */}
        <div className="mt-5 flex gap-3">
          <button
            onClick={handleClose}
            disabled={loading}
            data-testid="reset-cancel-btn"
            className="flex-1 rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm font-bold text-black/60 transition-colors hover:bg-black/5 disabled:opacity-60"
          >
            Abbrechen
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={!canConfirm || loading}
            data-testid="confirm-reset-btn"
            className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-red-700 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Wird gelöscht…" : "Testdaten löschen"}
          </button>
        </div>
      </div>
    </div>
  );
}
