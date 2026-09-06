"use client";

// Owner console: send invites (email or copy link), see who used them,
// cancel pending ones, and disable/enable/remove members.

import { Fragment, useCallback, useEffect, useState } from "react";
import { Ban, Check, Copy, LogOut, Mail, MapPin, RefreshCw, Trash2, UserCheck } from "lucide-react";

interface Invite {
  id: string;
  email: string | null;
  note: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by_name: string | null;
  revoked_at: string | null;
  email_sent: boolean;
  email_error: string | null;
}

interface Member {
  id: string;
  username: string;
  role: "owner" | "member";
  disabled: boolean;
  created_at: string;
  last_login_at: string | null;
  invited_by_name: string | null;
  device_limit: number;
  flagged_at: string | null;
  flag_reason: string | null;
  active_devices: number;
  last_city: string | null;
  last_region: string | null;
  last_country: string | null;
  last_device: string | null;
}

interface DeviceSession {
  id: string;
  created_at: string;
  last_seen_at: string;
  ip: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  device: string | null;
}

interface SigninEntry {
  at: string;
  outcome: string;
  ip: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  device: string | null;
}

function place(p: { city: string | null; region: string | null; country: string | null }): string {
  const parts = [p.city, p.region && p.region !== p.city ? p.region : null, p.country].filter(Boolean);
  return parts.length ? parts.join(", ") : "unknown location";
}

interface Created {
  link: string;
  email: string;
  emailed: { sent: boolean; reason?: string };
}

function when(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function inviteStatus(i: Invite): { label: string; tone: string } {
  if (i.used_at) return { label: `used by ${i.used_by_name ?? "someone"}`, tone: "text-bull" };
  if (i.revoked_at) return { label: "cancelled", tone: "text-ink-faint" };
  if (new Date(i.expires_at).getTime() < Date.now()) return { label: "expired", tone: "text-warn" };
  return { label: "pending", tone: "text-brand-glow" };
}

export default function InvitesManager() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ sessions: DeviceSession[]; history: SigninEntry[] } | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch("/api/invites"), fetch("/api/members")]);
    if (a.ok) {
      const d = (await a.json()) as { invites: Invite[]; emailConfigured: boolean };
      setInvites(d.invites);
      setEmailConfigured(d.emailConfigured);
    }
    if (b.ok) setMembers(((await b.json()) as { members: Member[] }).members);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(send: boolean) {
    setBusy(true);
    setError(null);
    setCreated(null);
    setCopied(false);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, note, send }),
      });
      const d = (await res.json()) as { error?: string; link?: string; emailed?: { sent: boolean; reason?: string } };
      if (!res.ok || !d.link) {
        setError(d.error ?? "Could not create the invite.");
      } else {
        setCreated({ link: d.link, email, emailed: d.emailed ?? { sent: false } });
        setEmail("");
        setNote("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copy failed. Select the link and copy it by hand.");
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/invites?id=${id}`, { method: "DELETE" });
    await load();
  }

  async function toggle(m: Member) {
    await fetch("/api/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: m.id, disabled: !m.disabled }),
    });
    await load();
  }

  async function remove(m: Member) {
    if (!window.confirm(`Remove ${m.username}? They will be signed out and cannot sign in again without a new invite.`)) return;
    await fetch(`/api/members?id=${m.id}`, { method: "DELETE" });
    await load();
  }

  async function loadDetail(userId: string) {
    const res = await fetch(`/api/members/sessions?user=${userId}`);
    if (res.ok) setDetail((await res.json()) as { sessions: DeviceSession[]; history: SigninEntry[] });
  }

  async function toggleDetail(m: Member) {
    if (open === m.id) {
      setOpen(null);
      setDetail(null);
      return;
    }
    setOpen(m.id);
    setDetail(null);
    await loadDetail(m.id);
  }

  async function setLimit(m: Member, deviceLimit: number) {
    await fetch("/api/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: m.id, deviceLimit }),
    });
    await load();
    if (open === m.id) await loadDetail(m.id);
  }

  async function unflag(m: Member) {
    await fetch("/api/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: m.id, clearFlag: true }),
    });
    await load();
  }

  async function signOutDevice(m: Member, sessionId: string) {
    await fetch(`/api/members/sessions?id=${sessionId}`, { method: "DELETE" });
    await load();
    await loadDetail(m.id);
  }

  const input = "rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm outline-none transition-colors focus:border-brand";
  const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50";

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Send an invite</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@example.com"
            className={`${input} flex-1`}
            autoComplete="off"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional, goes in the email)"
            className={`${input} flex-1`}
            maxLength={120}
          />
          <button
            type="button"
            onClick={() => create(true)}
            disabled={busy || !email || !emailConfigured}
            className={`${btn} bg-brand text-white hover:bg-brand-glow`}
            title={emailConfigured ? "Email the invite link" : "Email is not configured on the server"}
          >
            <Mail size={14} /> Email invite
          </button>
          <button
            type="button"
            onClick={() => create(false)}
            disabled={busy}
            className={`${btn} border border-border text-ink hover:bg-bg-hover`}
            title="Create a link you can paste into a text or DM"
          >
            <Copy size={14} /> Just make a link
          </button>
        </div>
        {!emailConfigured && (
          <p className="mt-2 text-xs text-warn">Email sending is not configured, so use the link button and send it yourself.</p>
        )}
        {error && <p className="mt-2 text-sm text-bear">{error}</p>}
        {created && (
          <div className="mt-4 rounded-lg border border-border bg-bg-elevated p-3 text-sm">
            <p className={created.emailed.sent ? "text-bull" : "text-ink-muted"}>
              {created.emailed.sent
                ? `Emailed to ${created.email}.`
                : created.email
                  ? `Not emailed (${created.emailed.reason ?? "unknown"}). Send this link yourself:`
                  : "Link created. Send it to one person. It is shown only once:"}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 select-all overflow-x-auto rounded bg-bg px-2 py-1.5 font-mono text-xs">{created.link}</code>
              <button type="button" onClick={() => copy(created.link)} className={`${btn} border border-border hover:bg-bg-hover`}>
                {copied ? <Check size={14} className="text-bull" /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Invites</h2>
          <button type="button" onClick={() => load()} className="text-ink-faint hover:text-ink" title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
        {invites.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">No invites yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-ink-faint">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Sent to</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">Email</th>
                  <th className="py-1.5 pr-3 font-medium">Created</th>
                  <th className="py-1.5 pr-3 font-medium">Expires</th>
                  <th className="py-1.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => {
                  const s = inviteStatus(i);
                  return (
                    <tr key={i.id} className="border-t border-border">
                      <td className="py-2 pr-3 font-mono">{i.email ?? <span className="text-ink-faint">link only</span>}{i.note && <span className="ml-2 text-ink-faint">({i.note})</span>}</td>
                      <td className={`py-2 pr-3 font-semibold ${s.tone}`}>{s.label}</td>
                      <td className="py-2 pr-3 text-ink-muted">{i.email ? (i.email_sent ? "sent" : i.email_error ? `failed: ${i.email_error}` : "not sent") : ""}</td>
                      <td className="py-2 pr-3 text-ink-muted">{when(i.created_at)}</td>
                      <td className="py-2 pr-3 text-ink-muted">{when(i.expires_at)}</td>
                      <td className="py-2 text-right">
                        {s.label === "pending" && (
                          <button type="button" onClick={() => revoke(i.id)} className="inline-flex items-center gap-1 text-ink-faint hover:text-bear" title="Cancel this invite">
                            <Ban size={13} /> cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Members</h2>
        <p className="mt-1 text-xs text-ink-faint">
          Devices = signed-in devices vs the cap. Past the cap, the oldest device gets signed out. A FLAGGED badge means the account was used from two places within 30 minutes (you also get an email).
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-ink-faint">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Username</th>
                <th className="py-1.5 pr-3 font-medium">Role</th>
                <th className="py-1.5 pr-3 font-medium">Devices</th>
                <th className="py-1.5 pr-3 font-medium">Last sign-in</th>
                <th className="py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <Fragment key={m.id}>
                  <tr className={`border-t border-border ${m.disabled ? "opacity-60" : ""}`}>
                    <td className="py-2 pr-3 font-mono">
                      {m.username}
                      {m.disabled && <span className="ml-2 rounded bg-bear/15 px-1 py-0.5 text-[10px] font-semibold text-bear">DISABLED</span>}
                      {m.flagged_at && (
                        <span className="ml-2 rounded bg-warn/15 px-1 py-0.5 text-[10px] font-semibold text-warn" title={m.flag_reason ?? ""}>
                          FLAGGED
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">{m.role}</td>
                    <td className="py-2 pr-3 text-ink-muted">
                      {m.role === "member" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className={m.active_devices > m.device_limit ? "text-warn" : ""}>{m.active_devices}</span>
                          <span className="text-ink-faint">/</span>
                          <select
                            value={m.device_limit}
                            onChange={(e) => setLimit(m, Number(e.target.value))}
                            className="rounded border border-border bg-bg-elevated px-1 py-0.5 text-xs outline-none focus:border-brand"
                            title="Device cap for this member"
                          >
                            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </span>
                      ) : (
                        <span>{m.active_devices}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">
                      {m.last_login_at ? (
                        <span>
                          {when(m.last_login_at)}
                          <span className="ml-1 text-ink-faint">{place({ city: m.last_city, region: m.last_region, country: m.last_country })}{m.last_device ? ` on ${m.last_device}` : ""}</span>
                        </span>
                      ) : "never"}
                    </td>
                    <td className="py-2 text-right">
                      <span className="inline-flex items-center gap-3">
                        <button type="button" onClick={() => toggleDetail(m)} className="inline-flex items-center gap-1 text-ink-faint hover:text-ink" title="Signed-in devices and sign-in history">
                          <MapPin size={13} /> {open === m.id ? "hide" : "details"}
                        </button>
                        {m.flagged_at && (
                          <button type="button" onClick={() => unflag(m)} className="inline-flex items-center gap-1 text-ink-faint hover:text-ink" title="Clear the sharing flag">
                            <Check size={13} /> clear flag
                          </button>
                        )}
                        {m.role === "member" && (
                          <>
                            <button type="button" onClick={() => toggle(m)} className="inline-flex items-center gap-1 text-ink-faint hover:text-ink" title={m.disabled ? "Let them sign in again" : "Block sign-in and end their sessions"}>
                              {m.disabled ? <UserCheck size={13} /> : <Ban size={13} />} {m.disabled ? "enable" : "disable"}
                            </button>
                            <button type="button" onClick={() => remove(m)} className="inline-flex items-center gap-1 text-ink-faint hover:text-bear" title="Remove the account">
                              <Trash2 size={13} /> remove
                            </button>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                  {open === m.id && (
                    <tr className="border-t border-border/50 bg-bg-elevated/40">
                      <td colSpan={5} className="px-2 py-3">
                        {m.flag_reason && <p className="mb-2 text-xs text-warn">{m.flag_reason}</p>}
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Signed-in devices</h3>
                            {detail?.sessions.length ? (
                              <ul className="mt-1.5 space-y-1">
                                {detail.sessions.map((s) => (
                                  <li key={s.id} className="flex items-center justify-between gap-2">
                                    <span>
                                      <span className="font-medium">{s.device ?? "Unknown device"}</span>
                                      <span className="ml-1 text-ink-faint">{place(s)}{s.ip ? ` (${s.ip})` : ""}, last seen {when(s.last_seen_at)}</span>
                                    </span>
                                    <button type="button" onClick={() => signOutDevice(m, s.id)} className="inline-flex items-center gap-1 text-ink-faint hover:text-bear" title="Sign this device out">
                                      <LogOut size={12} /> sign out
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-1.5 text-ink-faint">{detail ? "No devices signed in." : "Loading..."}</p>
                            )}
                          </div>
                          <div>
                            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Recent sign-ins</h3>
                            {detail?.history.length ? (
                              <ul className="mt-1.5 space-y-1">
                                {detail.history.map((h, i) => (
                                  <li key={i} className={h.outcome === "success" ? "" : "text-bear"}>
                                    {when(h.at)} <span className="font-medium">{h.outcome}</span>
                                    <span className="ml-1 text-ink-faint">{place(h)}{h.ip ? ` (${h.ip})` : ""}{h.device ? ` on ${h.device}` : ""}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-1.5 text-ink-faint">{detail ? "No sign-ins yet." : "Loading..."}</p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
