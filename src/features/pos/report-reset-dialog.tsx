"use client";

import { useState, useCallback } from "react";

interface ReportResetDialogProps {
  open: boolean;
  title: string;        // z.B. "KW26 2026 zurücksetzen"
  scopeLabel: string;    // z.B. "KW26 2026"
  unitLabel: string;     // z.B. "Wochendaten" / "Monatsdaten" / "Jahresdaten"
  historyCount: number;  // Anzahl abgeschlossener Tage, die tatsächlich gelöscht würden
  hasLiveDay: boolean;   // ob ein noch laufender (nicht abgeschlossener) Tag mit eingeblendet ist
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function WarningIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className="text-red-600" aria-hidden>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
      <path d="M12 9v4"/><path d="M12 17h.01"/>
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className="text-primaq-600" aria-hidden>
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 16v-4"/><path d="M12 8h.01"/>
    </svg>
  );
}

function dayWord(n: number): string {
  return n === 1 ? "Tag" : "Tage";
}

export function ReportResetDialog({
  open,
  title,
  scopeLabel,
  unitLabel,
  historyCount,
  hasLiveDay,
  onClose,
  onConfirm,
}: ReportResetDialogProps) {
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConfirm = inputValue === "RESET";
  const nothingToDelete = historyCount === 0;

  const handleConfirm = useCallback(async () => {
    if (!canConfirm || loading) return;
    setLoading(true);
    setError(null);
    try {
      await onConfirm();
      setInputValue("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }, [canConfirm, loading, onConfirm, onClose]);

  const handleClose = useCallback(() => {
    if (loading) return;
    setInputValue("");
    setError(null);
    onClose();
  }, [loading, onClose]);

  if (!open) return null;

  if (nothingToDelete) {
    const message = hasLiveDay
      ? `Es gibt keine abgeschlossenen ${unitLabel} zum Löschen. Der laufende Tag wird nicht gelöscht.`
      : `Es gibt keine abgeschlossenen ${unitLabel} zum Löschen.`;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40" onClick={handleClose} aria-hidden />
        <div
          role="dialog"
          aria-modal="true"
          data-testid="report-reset-dialog"
          className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        >
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primaq-100">
              <InfoIcon />
            </div>
            <div>
              <p className="text-base font-black text-black/90">{title}</p>
              <p className="mt-0.5 text-sm text-black/60" data-testid="reset-dialog-message">
                {message}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            data-testid="reset-close-info"
            className="w-full rounded-xl bg-primaq-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primaq-700"
          >
            Schließen
          </button>
        </div>
      </div>
    );
  }

  const message = hasLiveDay
    ? `Es werden nur abgeschlossene ${unitLabel} gelöscht (${historyCount} ${dayWord(historyCount)}). Der laufende Tag bleibt erhalten.`
    : `Alle abgeschlossenen Daten für ${scopeLabel} werden gelöscht (${historyCount} ${dayWord(historyCount)}).`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        data-testid="report-reset-dialog"
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
            <WarningIcon />
          </div>
          <div>
            <p className="text-base font-black text-black/90">{title}</p>
            <p className="mt-0.5 text-sm text-black/60" data-testid="reset-dialog-message">
              {message}
            </p>
          </div>
        </div>

        <p className="mb-4 text-sm font-semibold text-red-600">
          Dieser Vorgang kann nicht rückgängig gemacht werden.
        </p>

        <label className="block">
          <span className="text-sm font-bold text-black/70">
            Zur Bestätigung eingeben:{" "}
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
            data-testid="reset-input"
            className="mt-2 w-full rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm font-bold tracking-widest text-black/90 placeholder-black/20 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:opacity-60"
          />
        </label>

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" data-testid="reset-error">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-3">
          <button
            onClick={handleClose}
            disabled={loading}
            data-testid="reset-cancel"
            className="flex-1 rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm font-bold text-black/60 transition-colors hover:bg-black/5 disabled:opacity-60"
          >
            Abbrechen
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={!canConfirm || loading}
            data-testid="reset-confirm"
            className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Wird gelöscht…" : "Daten löschen"}
          </button>
        </div>
      </div>
    </div>
  );
}
