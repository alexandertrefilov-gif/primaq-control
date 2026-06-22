import { ClipboardCheck, ReceiptText } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

// Tagesabschluss is injected dynamically by AppShell when admin is active
export const navigationItems: NavigationItem[] = [
  { label: "Verkauf", href: "/verkauf", icon: ReceiptText },
];

export const adminNavigationItems: NavigationItem[] = [
  { label: "Tagesabschluss", href: "/tagesabschluss", icon: ClipboardCheck },
];
