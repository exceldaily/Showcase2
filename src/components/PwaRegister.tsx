"use client";

// Registers the service worker and offers an "Install app" button when
// the browser says the site is installable (Chrome/Edge/Android).

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PwaRegister() {
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", () => setInstallEvt(null));
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!installEvt) return null;
  return (
    <button
      onClick={async () => {
        await installEvt.prompt();
        await installEvt.userChoice.catch(() => undefined);
        setInstallEvt(null);
      }}
      className="flex items-center gap-1 rounded-md border border-brand/50 bg-brand/15 px-2 py-1 text-xs font-semibold text-brand-glow hover:bg-brand/25"
      title="Install AlphaForge as an app"
    >
      <Download size={13} /> Install app
    </button>
  );
}
