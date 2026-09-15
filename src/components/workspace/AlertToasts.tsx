"use client";

// Subtle alert toasts: bottom-right stack, no constant animation, each
// disappears on its own. High-urgency alerts also raise a browser
// notification when the trader has allowed them.

import { useEffect } from "react";
import { X } from "lucide-react";
import type { AlertEvent } from "@/lib/alertTransitions";
import { TONE_DOT, type Tone } from "@/lib/ui/tone";

export interface Toast extends AlertEvent { id: string; at: number }

const TONE: Record<AlertEvent["urgency"], Tone> = { high: "bull", medium: "warn", low: "muted" };

export default function AlertToasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  useEffect(() => {
    if (!toasts.length) return;
    const id = setTimeout(() => onDismiss(toasts[0].id), 9000);
    return () => clearTimeout(id);
  }, [toasts, onDismiss]);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-1.5">
      {toasts.slice(-4).map((t) => (
        <div key={t.id} className="pointer-events-auto rounded-lg bg-bg-card p-2.5 shadow-pop">
          <div className="flex items-start gap-2">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[TONE[t.urgency]]}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink">{t.title}</div>
              <div className="text-xs text-ink-muted">{t.detail}</div>
            </div>
            <button onClick={() => onDismiss(t.id)} className="btn-quiet h-5 px-0.5" aria-label="Dismiss"><X size={12} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
