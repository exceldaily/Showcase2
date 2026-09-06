import type { Metadata } from "next";
import { redirect } from "next/navigation";
import "./globals.css";
import Nav from "@/components/Nav";
import { sessionState } from "@/lib/auth/users";

export const metadata: Metadata = {
  title: "AlphaForge — AI Swing Trading Scanner",
  description:
    "AI-powered catalyst-driven swing trading scanner with entries, stops, targets, confidence scores, and paper-trading performance tracking.",
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
        <Nav user={user} />
        <main className="w-full px-4 py-6 sm:px-6">{children}</main>
        <footer className="border-t border-border py-6 text-center text-xs text-ink-faint">
          AlphaForge — research &amp; education tool. Not financial advice. No
          guarantee of profit. Paper trading only.
        </footer>
      </body>
    </html>
  );
}
