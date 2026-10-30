import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Archivo with its width axis, so headings can use the wide cut (see globals.css).
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Gigsaw", template: "%s · Gigsaw" },
  description: "Booking management for music agencies and artists, with gig arrival tracking.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Gigsaw", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#15181c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${archivo.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
