// ─────────────────────────────────────────────────────────
// Email adapter (Brevo transactional API).
// Degrades honestly: without BREVO_API_KEY (+ a recipient) it reports
// "not configured" instead of pretending to send. Never logs keys.
// ─────────────────────────────────────────────────────────

export function emailConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY && process.env.ALERT_EMAIL_TO);
}

/** Invites only need a key and a verified sender address. */
export function inviteEmailConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY && (process.env.ALERT_EMAIL_FROM || process.env.ALERT_EMAIL_TO));
}

export interface EmailResult {
  sent: boolean;
  reason?: string;
}

export async function sendEmail(opts: { to: string; subject: string; text: string; senderName?: string }): Promise<EmailResult> {
  const key = process.env.BREVO_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM ?? process.env.ALERT_EMAIL_TO;
  if (!key || !from) return { sent: false, reason: "email not configured (BREVO_API_KEY / ALERT_EMAIL_FROM)" };
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: opts.senderName ?? "AlphaForge", email: from },
        to: [{ email: opts.to }],
        subject: opts.subject,
        textContent: opts.text,
        htmlContent: `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre-wrap">${opts.text
          .replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
      }),
    });
    if (!res.ok) return { sent: false, reason: `Brevo ${res.status}: ${(await res.text()).slice(0, 160)}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "email failed" };
  }
}

export async function sendAlertEmail(subject: string, text: string): Promise<EmailResult> {
  const to = process.env.ALERT_EMAIL_TO;
  if (!process.env.BREVO_API_KEY || !to) return { sent: false, reason: "email not configured (BREVO_API_KEY / ALERT_EMAIL_TO)" };
  return sendEmail({ to, subject, text, senderName: "AlphaForge Siren" });
}
