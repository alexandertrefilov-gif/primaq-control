"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock, Settings, Shield } from "lucide-react";
import { AdminProvider, useAdmin } from "@/features/pos/admin-context";
import { SyncStatusPill } from "@/components/sync/sync-status-pill";
import { usePosThemeStore } from "@/features/pos/use-pos-theme-store";
import { cn } from "@/lib/utils";

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSalePage = pathname === "/verkauf";
  const { isAdmin, login, logout } = useAdmin();

  // Apply POS theme to document element (side effect only)
  usePosThemeStore();

  useEffect(() => {
    if (!isSalePage) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      html.style.overscrollBehavior = prev.htmlOverscroll;
      body.style.overscrollBehavior = prev.bodyOverscroll;
    };
  }, [isSalePage]);

  const [showModal, setShowModal] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showModal) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [showModal]);

  const openModal = useCallback(() => {
    setPin("");
    setPinError(false);
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setPin("");
    setPinError(false);
  }, []);

  const handleLogin = useCallback(() => {
    const ok = login(pin);
    if (ok) {
      closeModal();
    } else {
      setPinError(true);
      setPin("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [login, pin, closeModal]);

  return (
    <div
      className={cn(
        "flex flex-col overflow-x-hidden",
        isSalePage ? "h-dvh overflow-hidden" : "min-h-screen"
      )}
    >
      {/* ── Dark header ──────────────────────────────────────────────────── */}
      <header className="pos-header shrink-0 border-b backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-2.5">
          {/* Logo */}
          <Link href="/verkauf" className="flex shrink-0 items-center gap-3 mr-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primaq-500 text-base font-black text-white shadow-lg">
              P
            </span>
            <span className="hidden sm:block">
              <span className="block text-sm font-black leading-tight pos-text">PrimaQ Control</span>
              <span className="block text-xs pos-text-muted">Softeis-Kasse</span>
            </span>
          </Link>

          {/* Nav */}
          <nav className="flex flex-1 items-center gap-1">
            {[
              { label: "Verkauf", href: "/verkauf" },
              { label: "Berichte", href: "/berichte" },
            ].map(({ label, href }) => {
              const active = pathname === href || pathname.startsWith(href + "?");
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold transition-all",
                    active
                      ? "bg-primaq-500/20 text-primaq-400 shadow-[0_0_12px_rgba(0,214,163,0.15)] ring-1 ring-primaq-500/30"
                      : "pos-text-muted pos-hover"
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          {/* Sync status */}
          <SyncStatusPill />

          {/* Admin area */}
          {isAdmin ? (
            <div className="ml-2 flex items-center gap-1.5 shrink-0">
              <Link
                href="/einstellungen"
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold pos-text-muted pos-hover transition-colors"
                title="Einstellungen"
              >
                <Settings className="h-4 w-4" />
                <span className="hidden sm:inline">Einstellungen</span>
              </Link>
              <button
                data-testid="admin-logout"
                onClick={logout}
                title="Admin verlassen"
                className="flex items-center gap-1.5 rounded-lg bg-primaq-500/15 px-3 py-1.5 text-xs font-bold text-primaq-400 hover:bg-red-500/15 hover:text-red-400 transition-colors"
              >
                <Shield className="h-3.5 w-3.5" />
                Admin
              </button>
            </div>
          ) : (
            <button
              data-testid="admin-login"
              onClick={openModal}
              title="Admin-Login"
              className="ml-2 grid h-8 w-8 place-items-center rounded-lg pos-text-dim pos-hover transition-colors shrink-0"
            >
              <Lock className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <main
        className={cn(
          "min-w-0 flex-1 min-h-0",
          isSalePage
            ? "flex flex-col min-h-0 px-4 py-2 xl:px-5"
            : "mx-auto w-full max-w-4xl px-4 py-3"
        )}
      >
        {children}
      </main>

      {/* Admin PIN modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="w-80 rounded-3xl pos-surface p-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex flex-col items-center gap-2 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-primaq-500/20">
                <Lock className="h-6 w-6 text-primaq-400" />
              </div>
              <h2 className="text-xl font-black pos-text">Admin-Zugang</h2>
              <p className="text-sm pos-text-muted">PIN eingeben</p>
            </div>

            <input
              ref={inputRef}
              data-testid="pin-input"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              aria-label="Admin PIN"
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ""));
                setPinError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLogin();
                if (e.key === "Escape") closeModal();
              }}
              placeholder="· · · ·"
              className={cn(
                "mb-1 w-full rounded-xl border-2 px-4 py-3 text-center text-2xl font-black tracking-[0.5em] outline-none transition-colors pos-input",
                pinError && "border-red-500 bg-red-500/10"
              )}
            />

            {pinError && (
              <p className="mb-3 text-center text-sm font-semibold text-red-400">
                Falscher PIN
              </p>
            )}
            {!pinError && <div className="mb-3 h-5" />}

            <button
              data-testid="pin-submit"
              onClick={handleLogin}
              className="mb-2 w-full rounded-xl bg-primaq-500 py-3 font-bold text-white hover:bg-primaq-700 transition-colors"
            >
              Einloggen
            </button>
            <button
              onClick={closeModal}
              className="w-full rounded-xl py-2.5 text-sm font-semibold pos-text-muted pos-hover transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type AppShellProps = {
  children: React.ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <AdminProvider>
      <AppShellInner>{children}</AppShellInner>
    </AdminProvider>
  );
}
