"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock, Settings, Shield } from "lucide-react";
import { AdminProvider, useAdmin } from "@/features/pos/admin-context";
import { SyncStatusPill } from "@/components/sync/sync-status-pill";
import { cn } from "@/lib/utils";

// ── Inner shell – uses context provided by AdminProvider above ────────────────

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSalePage = pathname === "/verkauf";
  const { isAdmin, login, logout } = useAdmin();

  // Prevent any body/html scroll when the POS sale page is active.
  // This blocks iOS rubber-band bounce and ensures nothing scrolls outside
  // the explicitly scrollable cart list.
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

  // Focus PIN input when modal opens
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
      <header className="shrink-0 border-b border-black/10 bg-[#f7f8f4]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-2.5">
          {/* Logo */}
          <Link href="/verkauf" className="flex shrink-0 items-center gap-3 mr-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primaq-500 text-base font-black text-white">
              P
            </span>
            <span className="hidden sm:block">
              <span className="block text-sm font-bold leading-tight">PrimaQ Control</span>
              <span className="block text-xs text-black/50">Softeis-Kasse</span>
            </span>
          </Link>

          {/* Inline nav – Verkauf always + Tagesabschluss/Jahresabschluss when admin */}
          <nav className="flex flex-1 items-center gap-1">
            {[
              { label: "Verkauf", href: "/verkauf" },
              ...(isAdmin ? [
                { label: "Tagesabschluss", href: "/tagesabschluss" },
                { label: "Jahresabschluss", href: "/jahresabschluss" },
              ] : []),
            ].map(({ label, href }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
                    active
                      ? "bg-white text-primaq-700 shadow-sm ring-1 ring-black/5"
                      : "text-black/55 hover:bg-white/70 hover:text-black"
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
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-black/55 hover:bg-white/70 hover:text-black transition-colors"
                title="Einstellungen"
              >
                <Settings className="h-4 w-4" />
                <span className="hidden sm:inline">Einstellungen</span>
              </Link>
              <button
                data-testid="admin-logout"
                onClick={logout}
                title="Admin verlassen"
                className="flex items-center gap-1.5 rounded-lg bg-primaq-500/10 px-3 py-1.5 text-xs font-bold text-primaq-700 hover:bg-red-100 hover:text-red-700 transition-colors"
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
              className="ml-2 grid h-8 w-8 place-items-center rounded-lg text-black/30 hover:bg-black/8 hover:text-black/60 transition-colors shrink-0"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="w-80 rounded-3xl bg-white p-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex flex-col items-center gap-2 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-primaq-100">
                <Lock className="h-6 w-6 text-primaq-600" />
              </div>
              <h2 className="text-xl font-black text-ink">Admin-Zugang</h2>
              <p className="text-sm text-black/50">PIN eingeben</p>
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
                "mb-1 w-full rounded-xl border px-4 py-3 text-center text-2xl font-black tracking-[0.5em] outline-none transition-colors",
                pinError
                  ? "border-red-400 bg-red-50 focus:ring-2 focus:ring-red-400/30"
                  : "border-black/20 bg-black/[0.02] focus:border-primaq-500 focus:ring-2 focus:ring-primaq-500/20"
              )}
            />

            {pinError && (
              <p className="mb-3 text-center text-sm font-semibold text-red-600">
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
              className="w-full rounded-xl py-2.5 text-sm font-semibold text-black/45 hover:bg-black/5 transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Public export – wraps children in AdminProvider ───────────────────────────

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
