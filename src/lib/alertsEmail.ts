// ─────────────────────────────────────────────────────────
// Alert email adapter (Brevo transactional API).
// Degrades honestly: without BREVO_API_KEY + ALERT_EMAIL_TO it reports
// "not configured" instead of pretending to send. Never logs keys.
// ─────────────────────────────────────────────────────────

export function emailConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY && process.env.ALERT_EMAIL_TO);
}

export interface EmailResult {
  sent: boolean;
  reason?: string;
}

export async function sendAlertEmail(subject: string, text: string): Promise<EmailResult> {
  const key = process.env.BREVO_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  if (!key || !to) return { sent: false, reason: "email not configured (BREVO_API_KEY / ALERT_EMAIL_TO)" };
  const from = process.env.ALERT_EMAIL_FROM ?? to;
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "AlphaForge Siren", email: from },
        to: [{ email: to }],
        subject,
        textContent: text,
        htmlContent: `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre-wrap">${text
          .replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
      }),
    });
    if (!res.ok) return { sent: false, reason: `Brevo ${res.status}: ${(await res.text()).slice(0, 160)}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "email failed" };
  }
}
