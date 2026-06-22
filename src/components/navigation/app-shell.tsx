"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigationItems } from "@/config/navigation";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: React.ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const isSalePage = pathname === "/verkauf";

  return (
    <div
      className={cn(
        "flex flex-col overflow-x-hidden",
        isSalePage ? "h-screen overflow-hidden" : "min-h-screen"
      )}
    >
      <header className="shrink-0 border-b border-black/10 bg-[#f7f8f4]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5">
          <Link href="/verkauf" className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primaq-500 text-base font-black text-white">
              P
            </span>
            <span>
              <span className="block text-sm font-bold leading-tight">PrimaQ Control</span>
              <span className="block text-xs text-black/50">Softeis-Kasse</span>
            </span>
          </Link>
        </div>
      </header>

      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col",
          isSalePage ? "px-4 py-3 xl:px-6" : "mx-auto max-w-4xl px-4 py-2.5 lg:py-3"
        )}
      >
        <nav className="shrink-0 border-b border-black/10 pb-2">
          <div className="flex gap-2">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                    active
                      ? "bg-white text-primaq-700 shadow-sm ring-1 ring-black/5"
                      : "text-black/55 hover:bg-white/70 hover:text-black"
                  )}
                >
                  <Icon aria-hidden className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        <main
          className={cn(
            "min-w-0 pt-3",
            isSalePage && "flex flex-1 flex-col min-h-0 pt-2"
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
