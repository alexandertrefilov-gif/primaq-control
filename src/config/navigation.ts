import { ClipboardCheck, ReceiptText } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const navigationItems: NavigationItem[] = [
  { label: "Verkauf", href: "/verkauf", icon: ReceiptText },
  { label: "Tagesabschluss", href: "/tagesabschluss", icon: ClipboardCheck },
];
