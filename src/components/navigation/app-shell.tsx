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
    <div className={cn("flex flex-col overflow-x-hidden", isSalePage ? "h-screen overflow-hidden" : "min-h-screen")}>
      <header className="border-b border-black/10 bg-[#f7f8f4]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5">
          <Link href="/dashboard" className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-primaq-500 text-lg font-bold text-white">
              P
            </span>
            <span>
              <span className="block text-base font-bold leading-tight">PrimaQ Control</span>
              <span className="block text-xs text-black/60">Softeis Betrieb</span>
            </span>
          </Link>
          <span className="rounded-full border border-primaq-500/30 bg-white px-3 py-1 text-xs font-semibold text-primaq-700">
            PWA bereit
          </span>
        </div>
      </header>

      <div
        className={cn(
          "mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 py-2.5 lg:py-3",
          isSalePage && "mx-0 max-w-none px-4 py-3 xl:px-6"
        )}
      >
        <nav className="-mx-4 w-[calc(100%+2rem)] border-b border-black/10 bg-[#f7f8f4]/95 px-4 py-2 backdrop-blur xl:-mx-6 xl:w-[calc(100%+3rem)] xl:px-6">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-black/65 transition-colors",
                    active
                      ? "bg-white text-primaq-700 shadow-sm ring-1 ring-black/5"
                      : "hover:bg-white/70 hover:text-black"
                  )}
                >
                  <Icon aria-hidden className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        <main className={cn("min-w-0 pt-3", isSalePage && "flex flex-col flex-1 min-h-0 pt-2")}>{children}</main>
      </div>
    </div>
  );
}
