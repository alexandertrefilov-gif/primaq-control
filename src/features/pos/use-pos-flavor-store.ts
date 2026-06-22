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
  }));
}

function persist(flavors: MutableFlavor[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flavors));
  }
}

export function usePosFlavorStore() {
  const [base, setBase] = useState<MutableFlavor[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      setBase(raw ? (JSON.parse(raw) as MutableFlavor[]) : defaultFlavors());
    } catch {
      setBase(defaultFlavors());
    }
    setHydrated(true);
  }, []);

  const update = useCallback((id: string, patch: Partial<MutableFlavor>) => {
    setBase((curr) => {
      const next = curr.map((f) => (f.id === id ? { ...f, ...patch } : f));
      persist(next);
      return next;
    });
  }, []);

  const add = useCallback((flavor: MutableFlavor) => {
    setBase((curr) => {
      const next = [...curr, flavor];
      persist(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setBase((curr) => {
      const next = curr.filter((f) => f.id !== id);
      persist(next);
      return next;
    });
  }, []);

  const allFlavors = computeAllFlavors(base);

  return { base, allFlavors, hydrated, update, add, remove };
}
