"use client";

import { useCallback, useState } from "react";
import { dbGet, getDb } from "@/lib/db";
import type { SyncOp } from "@/lib/db";
import { pullSettings, upsertSettings } from "@/lib/sync/supabase-sync";

const DIAG_KEYS = [
  "primaq-pos-flavors-v1",
  "primaq-pos-layout-v1",
  "primaq-pos-vat-rate",
  "primaq-pos-event-plan",
  "primaq-pos-report-permissions",
] as const;
type DiagKey = (typeof DIAG_KEYS)[number];

type DiagRow = {
  key: DiagKey;
  localExists: boolean;
  localCount: number | null;
  localFirstName: string | null;
  localImageLen: number | null;
  localMetaExists: boolean;
  localUpdatedAt: string | null;
  cloudExists: boolean;
  cloudCount: number | null;
  cloudFirstName: string | null;
  cloudImageLen: number | null;
  cloudUpdatedAt: string | null;
  cloudDeviceId: string | null;
  wouldApply: boolean;
  reason: string;
};

type FailedOpSummary = {
  id: string;
  entity: string;
  operation: string;
  retryCount: number;
  settingsKey: string;
  payloadBytes: number;
  createdAt: string;
};

function extractErrText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (e.message) parts.push(String(e.message));
    if (e.code) parts.push(`[${String(e.code)}]`);
    if (e.details) parts.push(String(e.details));
    if (e.hint) parts.push(`Hint: ${String(e.hint)}`);
    if (parts.length > 0) return parts.join(" ");
    try { return JSON.stringify(e); } catch { /* ignore */ }
  }
  return String(err);
}

function firstImageLen(data: unknown, key: DiagKey): number | null {
  try {
    if (key === "primaq-pos-flavors-v1") {
      const flavors = data as Array<{ imageSrc?: string }>;
      const img = flavors.find((f) => f.imageSrc?.startsWith("data:"))?.imageSrc;
      return img ? img.length : 0;
    }
    if (key !== "primaq-pos-layout-v1") return null;
    const layout = data as {
      active?: { salesSizes?: Record<string, { imageDataUrl?: string | null }> };
    };
    const sizes = Object.values(layout.active?.salesSizes ?? {});
    const img = sizes.find((s) => s.imageDataUrl?.startsWith("data:"))?.imageDataUrl;
    return img ? img.length : 0;
  } catch {
    return null;
  }
}

function firstFlavor(data: unknown): { count: number | null; name: string | null } {
  try {
    const flavors = data as Array<{ name?: string; displayName?: string }>;
    return { count: flavors.length, name: flavors[0]?.displayName ?? flavors[0]?.name ?? null };
  } catch {
    return { count: null, name: null };
  }
}

export function SyncDiagnostic() {
  const [rows, setRows] = useState<DiagRow[]>([]);
  const [failedOps, setFailedOps] = useState<FailedOpSummary[]>([]);
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);

  // ── Direct write test ──────────────────────────────────────────────────────
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testRunning, setTestRunning] = useState(false);

  const handleWriteTest = useCallback(async () => {
    setTestRunning(true);
    setTestResult(null);
    try {
      await upsertSettings({
        businessId: "default",
        deviceId: "diag-test",
        settingsKey: "__diag_test__",
        data: { test: true, ts: Date.now() },
        updatedAt: new Date().toISOString(),
      });
      setTestResult("✓ Schreiben erfolgreich — kein Supabase-Fehler");
      console.log("[Diag] Schreibtest erfolgreich");
    } catch (err) {
      const e = err as Record<string, unknown>;
      const detail = {
        message: e.message,
        code: e.code,
        details: e.details,
        hint: e.hint,
        raw: err,
      };
      setTestResult(JSON.stringify({ message: e.message, code: e.code, details: e.details, hint: e.hint }, null, 2));
      console.error("[Diag] Schreibtest FEHLER:", detail);
    } finally {
      setTestRunning(false);
    }
  }, []);

  // ── Clear failed ops ───────────────────────────────────────────────────────
  const [clearing, setClearing] = useState(false);

  const handleClearFailed = useCallback(async () => {
    setClearing(true);
    try {
      const db = getDb();
      const allOps = await db.sync_queue.toArray();
      const failedIds = allOps.filter((op: SyncOp) => op.status === "failed").map((op: SyncOp) => op.id);
      for (const id of failedIds) {
        await db.sync_queue.delete(id);
      }
      setFailedOps([]);
      console.log(`[Diag] ${failedIds.length} fehlgeschlagene Ops gelöscht`);
    } finally {
      setClearing(false);
    }
  }, []);

  // ── Main diagnostic run ────────────────────────────────────────────────────
  const run = useCallback(async () => {
    setRunning(true);
    setCloudError(null);
    try {
      const allOps = await getDb().sync_queue.toArray();
      const failed = allOps.filter((op) => op.status === "failed");
      const failedSummaries: FailedOpSummary[] = failed.map((op: SyncOp) => {
        let settingsKey = "(unbekannt)";
        try {
          settingsKey = (JSON.parse(op.payload) as Record<string, unknown>).settingsKey as string ?? op.entity;
        } catch { /* ignore */ }
        return {
          id: op.id,
          entity: op.entity,
          operation: op.operation,
          retryCount: op.retryCount,
          settingsKey,
          payloadBytes: op.payload.length,
          createdAt: op.createdAt,
        };
      });
      setFailedOps(failedSummaries);
      console.log("[Diag] Fehlgeschlagene Ops:", failedSummaries);

      let cloudRows: Awaited<ReturnType<typeof pullSettings>> = [];
      try {
        cloudRows = await pullSettings("default");
      } catch (err) {
        setCloudError(extractErrText(err));
      }

      const result: DiagRow[] = [];

      for (const key of DIAG_KEYS) {
        const localRaw = await dbGet(key);
        const metaRaw = await dbGet(`${key}-meta`);
        const localMeta = metaRaw ? (JSON.parse(metaRaw) as { updatedAt: string }) : null;
        const cloudRow = cloudRows.find((r) => r.settings_key === key);

        const localData = localRaw ? (JSON.parse(localRaw) as unknown) : null;
        const cloudData = cloudRow ? cloudRow.data : null;

        const localFlavor =
          key === "primaq-pos-flavors-v1" && localData ? firstFlavor(localData) : { count: null, name: null };
        const cloudFlavor =
          key === "primaq-pos-flavors-v1" && cloudData ? firstFlavor(cloudData) : { count: null, name: null };

        const localUpdatedAt = localMeta?.updatedAt ?? null;
        const cloudUpdatedAt = cloudRow?.updated_at ?? null;

        let wouldApply = false;
        let reason = "";
        if (!cloudRow) {
          reason = "kein Cloud-Eintrag vorhanden";
        } else if (!localMeta) {
          wouldApply = true;
          reason = "kein lokales Meta → Cloud wird angewendet";
        } else if (cloudUpdatedAt! > localUpdatedAt!) {
          wouldApply = true;
          reason = "Cloud neuer als lokal → wird angewendet";
        } else {
          reason = "Lokal >= Cloud → ÜBERSPRUNGEN (Reset nötig!)";
        }

        const row: DiagRow = {
          key,
          localExists: !!localRaw,
          localCount: localFlavor.count,
          localFirstName: localFlavor.name,
          localImageLen: localData ? firstImageLen(localData, key) : null,
          localMetaExists: !!metaRaw,
          localUpdatedAt,
          cloudExists: !!cloudRow,
          cloudCount: cloudFlavor.count,
          cloudFirstName: cloudFlavor.name,
          cloudImageLen: cloudData ? firstImageLen(cloudData, key) : null,
          cloudUpdatedAt,
          cloudDeviceId: cloudRow?.device_id ?? null,
          wouldApply,
          reason,
        };
        result.push(row);

        console.log(`[Diag] ${key}`, {
          localExists: row.localExists,
          localCount: row.localCount,
          localFirstName: row.localFirstName,
          localImageLen: row.localImageLen,
          localMetaExists: row.localMetaExists,
          localUpdatedAt: row.localUpdatedAt,
          cloudExists: row.cloudExists,
          cloudCount: row.cloudCount,
          cloudFirstName: row.cloudFirstName,
          cloudImageLen: row.cloudImageLen,
          cloudUpdatedAt: row.cloudUpdatedAt,
          wouldApply: row.wouldApply,
          reason: row.reason,
        });
      }

      setRows(result);
      setRanAt(new Date().toISOString());
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-amber-700">
        Admin-Diagnose
      </p>

      {/* ── Schreibtest ───────────────────────────────────────────────────── */}
      <div className="mb-3 rounded-lg border border-amber-200 bg-white p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-black/40">
          Supabase Schreibtest (kein Bild)
        </p>
        <button
          onClick={handleWriteTest}
          disabled={testRunning}
          className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-60"
        >
          {testRunning ? "Teste…" : "Kleines Objekt schreiben"}
        </button>
        {testResult !== null && (
          <pre className={`mt-2 rounded p-2 text-[10px] leading-relaxed whitespace-pre-wrap break-all ${testResult.startsWith("✓") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {testResult}
          </pre>
        )}
      </div>

      {/* ── Diagnose + Fehlgeschlagene leeren ─────────────────────────────── */}
      <div className="mb-3 flex gap-2">
        <button
          onClick={run}
          disabled={running}
          className="flex-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {running ? "Analysiere…" : "Diagnose ausführen"}
        </button>
        {failedOps.length > 0 && (
          <button
            onClick={handleClearFailed}
            disabled={clearing}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-60"
          >
            {clearing ? "Lösche…" : `${failedOps.length} Fehlgeschl. löschen`}
          </button>
        )}
      </div>

      {cloudError && (
        <p className="mb-2 rounded bg-red-100 p-2 font-mono text-xs text-red-700">
          Supabase-Lesefehler: {cloudError}
        </p>
      )}
      {ranAt && (
        <p className="mb-3 text-[10px] text-amber-600">
          Stand: {new Date(ranAt).toLocaleTimeString("de-DE")} — Details auch in DevTools (console.log)
        </p>
      )}

      {/* ── Fehlgeschlagene Queue-Ops ────────────────────────────────────── */}
      {failedOps.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-lg border border-red-200 bg-white">
          <div className="bg-red-100 px-3 py-1.5">
            <span className="text-xs font-bold text-red-700">
              Fehlgeschlagene Sync-Ops ({failedOps.length})
            </span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-black/5">
                <th className="px-3 py-1 text-left font-medium text-black/40">Key</th>
                <th className="px-3 py-1 text-left font-medium text-black/40">Retries</th>
                <th className="px-3 py-1 text-left font-medium text-black/40">Payload</th>
                <th className="px-3 py-1 text-left font-medium text-black/40">Erstellt</th>
              </tr>
            </thead>
            <tbody>
              {failedOps.map((op) => (
                <tr key={op.id} className="border-t border-black/5">
                  <td className="px-3 py-1 font-mono text-red-700">{op.settingsKey}</td>
                  <td className="px-3 py-1 text-black/60">{op.retryCount}</td>
                  <td className="px-3 py-1 text-black/60">{(op.payloadBytes / 1024).toFixed(0)} KB</td>
                  <td className="px-3 py-1 text-black/40">
                    {new Date(op.createdAt).toLocaleTimeString("de-DE")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Settings-Vergleich lokal vs. Cloud ──────────────────────────── */}
      {rows.map((row) => (
        <div key={row.key} className="mb-3 overflow-hidden rounded-lg border border-amber-200 bg-white">
          <div className="bg-amber-100 px-3 py-1.5">
            <span className="font-mono text-xs font-bold text-amber-800">{row.key}</span>
          </div>
          <table className="w-full text-xs">
            <tbody>
              <Section label="Lokal" />
              <R label="vorhanden" v={row.localExists ? "ja" : "NEIN"} warn={!row.localExists} />
              {row.localCount !== null && <R label="Anzahl Sorten" v={String(row.localCount)} />}
              {row.localFirstName && <R label="Erste Sorte" v={row.localFirstName} />}
              <R
                label="Bild-Bytes (1. Eintrag)"
                v={row.localImageLen === null ? "—" : row.localImageLen === 0 ? "kein base64-Bild" : `${row.localImageLen.toLocaleString()} Bytes`}
              />
              <R label="Meta-Key" v={row.localMetaExists ? "ja" : "NEIN"} />
              <R label="lokales updatedAt" v={row.localUpdatedAt ?? "—"} />

              <Section label="Cloud (Supabase)" />
              <R label="vorhanden" v={row.cloudExists ? "ja" : "NEIN"} warn={!row.cloudExists} />
              {row.cloudCount !== null && <R label="Anzahl Sorten" v={String(row.cloudCount)} />}
              {row.cloudFirstName && <R label="Erste Sorte" v={row.cloudFirstName} />}
              <R
                label="Bild-Bytes (1. Eintrag)"
                v={row.cloudImageLen === null ? "—" : row.cloudImageLen === 0 ? "kein base64-Bild" : `${row.cloudImageLen.toLocaleString()} Bytes`}
              />
              <R label="cloud updated_at" v={row.cloudUpdatedAt ?? "—"} />
              <R label="zuletzt geschrieben von Gerät" v={row.cloudDeviceId ? row.cloudDeviceId.slice(0, 8) : "—"} />

              <Section label="Entscheidung (nächster Pull)" />
              <R
                label="würde angewendet?"
                v={row.wouldApply ? "JA ✓" : "NEIN ✗"}
                warn={!row.cloudExists || (!row.wouldApply && row.cloudExists)}
              />
              <R label="Grund" v={row.reason} warn={!row.wouldApply && row.cloudExists} />
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function Section({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={2} className="bg-black/3 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-black/40">
        {label}
      </td>
    </tr>
  );
}

function R({ label, v, warn }: { label: string; v: string; warn?: boolean }) {
  return (
    <tr className="border-t border-black/5">
      <td className="w-44 px-3 py-1 text-black/40">{label}</td>
      <td className={`break-all px-3 py-1 ${warn ? "font-semibold text-red-600" : "text-black/70"}`}>{v}</td>
    </tr>
  );
}
