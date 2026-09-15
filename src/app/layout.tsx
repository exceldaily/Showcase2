import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import "./globals.css";
import Nav from "@/components/Nav";
import PwaRegister from "@/components/PwaRegister";
import { sessionState } from "@/lib/auth/users";

export const metadata: Metadata = {
  title: "AlphaForge",
  description: "Options command center: levels, plans, and alerts for same-day calls and puts.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "AlphaForge" },
};

export const viewport: Viewport = {
  themeColor: "#070b13",
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
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Nav user={user} install={<PwaRegister />} />
        <main className="w-full px-4 py-6 sm:px-6">{children}</main>
        <footer className="border-t border-border py-6 text-center text-xs text-ink-faint">
          AlphaForge — research &amp; education tool. Not financial advice. No
          guarantee of profit. Paper trading only.
        </footer>
      </body>
    </html>
  );
}
