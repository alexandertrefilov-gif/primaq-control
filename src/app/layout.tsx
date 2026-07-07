import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/navigation/app-shell";
import { SyncFoundation } from "@/components/sync/sync-foundation";
import { PwaUpdateWatcher } from "@/components/sync/pwa-update-watcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "PrimaQ Control",
  description: "Mobile PWA fuer Softeis-Verkaufsbetrieb",
  applicationName: "PrimaQ Control",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "PrimaQ Control",
    statusBarStyle: "default"
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg"
  }
};

export const viewport: Viewport = {
  themeColor: "#19a983",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>
        <SyncFoundation />
        <PwaUpdateWatcher />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
