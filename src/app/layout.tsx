import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "AlphaForge — AI Swing Trading Scanner",
  description:
    "AI-powered catalyst-driven swing trading scanner with entries, stops, targets, confidence scores, and paper-trading performance tracking.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Nav />
        <main className="w-full px-4 py-6 sm:px-6">{children}</main>
        <footer className="border-t border-border py-6 text-center text-xs text-ink-faint">
          AlphaForge — research &amp; education tool. Not financial advice. No
          guarantee of profit. Paper trading only.
        </footer>
      </body>
    </html>
  );
}
