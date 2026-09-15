import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { redirect } from "next/navigation";
import "./globals.css";
import Nav from "@/components/Nav";
import PwaRegister from "@/components/PwaRegister";
import { sessionState } from "@/lib/auth/users";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "AlphaForge",
  description: "Options command center: levels, plans, and alerts for same-day calls and puts.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "AlphaForge" },
};

export const viewport: Viewport = {
  themeColor: "#080C12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The middleware only checks the cookie signature. Here we confirm the
  // account still exists and is enabled; if not, clear the cookie and
  // send the visitor to the login page.
  const { user, revoked, reason } = await sessionState();
  if (revoked) redirect(`/api/auth/logout?next=/login&reason=${reason === "device_limit" ? "kicked" : "revoked"}`);

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <Nav user={user} install={<PwaRegister />} />
        <main className="w-full">{children}</main>
      </body>
    </html>
  );
}
