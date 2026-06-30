"use client";

import { useState, useCallback, useEffect } from "react";
import { dbGet, dbSet } from "@/lib/db";
import { enqueueSettingsSync } from "@/lib/sync/enqueue-settings";

export type ReportPermissions = {
  tagesabschluss: boolean;
  wochenbericht: boolean;
  monatsbericht: boolean;
  jahresabschluss: boolean;
};

export const REPORT_PERMISSIONS_KEY = "primaq-pos-report-permissions";

const DEFAULT_PERMISSIONS: ReportPermissions = {
  tagesabschluss: false,
  wochenbericht: false,
  monatsbericht: false,
  jahresabschluss: false,
};

function parse(raw: string | null): ReportPermissions {
  if (!raw) return DEFAULT_PERMISSIONS;
  try {
    const p = JSON.parse(raw) as Partial<ReportPermissions>;
    return {
      tagesabschluss: p.tagesabschluss ?? false,
      wochenbericht:  p.wochenbericht  ?? false,
      monatsbericht:  p.monatsbericht  ?? false,
      jahresabschluss: p.jahresabschluss ?? false,
    };
  } catch {
    return DEFAULT_PERMISSIONS;
  }
}

export function useReportPermissionsStore() {
  const [permissions, setPermissions] = useState<ReportPermissions>(DEFAULT_PERMISSIONS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    dbGet(REPORT_PERMISSIONS_KEY)
      .then((raw) => { setPermissions(parse(raw)); setHydrated(true); })
      .catch(() => setHydrated(true));
  }, []);

  useEffect(() => {
    const onSynced = (e: Event) => {
      const { key, data } = (e as CustomEvent<{ key: string; data: unknown }>).detail;
      if (key !== REPORT_PERMISSIONS_KEY) return;
      setPermissions(parse(JSON.stringify(data)));
    };
    window.addEventListener("primaq-settings-synced", onSynced);
    return () => window.removeEventListener("primaq-settings-synced", onSynced);
  }, []);

  const setPermission = useCallback((key: keyof ReportPermissions, value: boolean) => {
    setPermissions((prev) => {
      const next = { ...prev, [key]: value };
      void dbSet(REPORT_PERMISSIONS_KEY, JSON.stringify(next));
      void enqueueSettingsSync(REPORT_PERMISSIONS_KEY, next);
      return next;
    });
  }, []);

  return { permissions, setPermission, hydrated };
}
