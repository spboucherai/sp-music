import type { Metadata, Viewport } from "next";
import { getUser } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Music SP", template: "%s · Music SP" },
  description: "Lecteur musical privé.",
  applicationName: "Music SP",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  icons: { icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192" }], apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Music SP", statusBarStyle: "black-translucent" },
  referrer: "same-origin",
};
export const viewport: Viewport = { themeColor: "#0b0a0d", colorScheme: "dark", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <html lang={user?.locale ?? "fr"} data-accent={user?.accent ?? "ember"}>
      <body>{children}</body>
    </html>
  );
}
