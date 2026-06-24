"use client";

import { useCallback, useEffect, useState } from "react";
import { FLAVORS, MACHINE_GROUP_LABELS } from "./pos-config";
import type { FlavorConfig } from "./pos-config";

const STORAGE_KEY = "primaq-pos-flavors-v1";

export type MutableFlavor = {
  id: string;
  name: string;
  displayName?: string;
  group: string;
  imageSrc?: string;
  backgroundColor: string;
  textColor: string;
  isActive: boolean;
  imageScale: number; // zoom 50–250, default 100
};

export function mutableToConfig(f: MutableFlavor): FlavorConfig {
  return {
    id: f.id,
    name: f.displayName?.trim() || f.name,
    group: f.group,
    imageSrc: f.imageSrc,
    backgroundColor: f.backgroundColor,
    textColor: f.textColor,
    isActive: f.isActive,
    imageScale: f.imageScale,
  };
}

export function computeAllFlavors(base: MutableFlavor[]): FlavorConfig[] {
  const activeFlavors = base.filter((f) => f.isActive).map(mutableToConfig);
  const mixes: FlavorConfig[] = [];

  for (const groupId of Object.keys(MACHINE_GROUP_LABELS)) {
    const pair = activeFlavors.filter((f) => f.group === groupId);
    if (pair.length >= 2) {
      const a = pair[0];
      const b = pair[1];
      mixes.push({
        id: `mix_${a.id}_${b.id}`,
        name: `Mix ${a.name}/${b.name}`,
        group: groupId,
        backgroundColor: b.backgroundColor,
        textColor: "#ffffff",
        isMix: true,
        mixColors: [a.backgroundColor, b.backgroundColor],
        mixParts: [a.id, b.id],
      });
    }
  }

  return [...activeFlavors, ...mixes];
}

function defaultFlavors(): MutableFlavor[] {
  return FLAVORS.filter((f) => !f.isMix).map((f) => ({
    id: f.id,
    name: f.name,
    group: f.group,
    imageSrc: f.imageSrc,
    backgroundColor: f.backgroundColor,
    textColor: f.textColor,
    isActive: true,
    imageScale: 100,
  }));
}

// Returns the error message on failure, null on success.
function safePersist(flavors: MutableFlavor[]): string | null {
  if (typeof window === "undefined") return null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flavors));
    return null;
  } catch (err) {
    const isQuota =
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED");
    return isQuota
      ? "Speicher voll. Bitte Bilder in Einstellungen bereinigen oder kleinere Bilder verwenden."
      : "Speichern fehlgeschlagen.";
  }
}

export function usePosFlavorStore() {
  const [base, setBase] = useState<MutableFlavor[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MutableFlavor[];
        setBase(parsed.map((f) => ({ ...f, imageScale: f.imageScale ?? 100 })));
      } else {
        setBase(defaultFlavors());
      }
    } catch {
      setBase(defaultFlavors());
    }
    setHydrated(true);
  }, []);

  const update = useCallback((id: string, patch: Partial<MutableFlavor>) => {
    setBase((curr) => {
      const next = curr.map((f) => (f.id === id ? { ...f, ...patch } : f));
      const err = safePersist(next);
      if (err) {
        // Schedule outside the updater to stay clear of React's render phase
        queueMicrotask(() => setStorageError(err));
        return curr; // revert – image is not applied
      }
      return next;
    });
  }, []);

  const add = useCallback((flavor: MutableFlavor) => {
    setBase((curr) => {
      const next = [...curr, flavor];
      const err = safePersist(next);
      if (err) {
        queueMicrotask(() => setStorageError(err));
        return curr;
      }
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setBase((curr) => {
      const next = curr.filter((f) => f.id !== id);
      const err = safePersist(next);
      if (err) {
        queueMicrotask(() => setStorageError(err));
        return curr;
      }
      return next;
    });
  }, []);

  const clearStorageError = useCallback(() => setStorageError(null), []);

  const allFlavors = computeAllFlavors(base);

  return { base, allFlavors, hydrated, update, add, remove, storageError, clearStorageError };
}
