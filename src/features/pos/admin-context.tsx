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
