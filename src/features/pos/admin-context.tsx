"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export const ADMIN_PIN = "1234";
const SESSION_KEY = "primaq-admin";

type AdminContextValue = {
  isAdmin: boolean;
  hydrated: boolean;
  login: (pin: string) => boolean;
  logout: () => void;
};

const AdminContext = createContext<AdminContextValue>({
  isAdmin: false,
  hydrated: false,
  login: () => false,
  logout: () => {},
});

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setIsAdmin(sessionStorage.getItem(SESSION_KEY) === "true");
    setHydrated(true);
  }, []);

  const login = useCallback((pin: string): boolean => {
    if (pin === ADMIN_PIN) {
      sessionStorage.setItem(SESSION_KEY, "true");
      setIsAdmin(true);
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setIsAdmin(false);
  }, []);

  return (
    <AdminContext.Provider value={{ isAdmin, hydrated, login, logout }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}

export function AdminRequired({ children }: { children: React.ReactNode }) {
  const { isAdmin, hydrated } = useAdmin();

  if (!hydrated) {
    return <div className="flex h-40 items-center justify-center text-black/40">Laden…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center gap-6 py-20 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-black/5">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-black/25" aria-hidden>
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <div>
          <p className="text-xl font-black text-black/60">Admin-Berechtigung erforderlich</p>
          <p className="mt-1 text-sm text-black/40">
            Bitte als Admin anmelden, um diesen Bereich zu sehen.
          </p>
        </div>
        <a
          href="/verkauf"
          className="rounded-xl bg-primaq-500 px-6 py-3 font-bold text-white hover:bg-primaq-700 transition-colors"
        >
          Zurück zum Verkauf
        </a>
      </div>
    );
  }

  return <>{children}</>;
}
