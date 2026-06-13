import {
  BarChart3,
  ClipboardCheck,
  Home,
  Package,
  ReceiptText,
  Settings,
  ListChecks
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const navigationItems: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: Home },
  { label: "Verkauf", href: "/verkauf", icon: ReceiptText },
  { label: "Abschluss", href: "/abschluss", icon: ClipboardCheck },
  { label: "Berichte", href: "/berichte", icon: BarChart3 },
  { label: "Einsätze", href: "/einsatzuebersicht", icon: ListChecks },
  { label: "Lager", href: "/lager", icon: Package },
  { label: "Einstellungen", href: "/einstellungen", icon: Settings }
];
