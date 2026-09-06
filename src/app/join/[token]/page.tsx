import { redirect } from "next/navigation";
import { Activity } from "lucide-react";
import AccountForm from "@/components/auth/AccountForm";
import { authEnabled } from "@/lib/auth/session";
import { getCurrentUser, inviteProblem, peekInvite } from "@/lib/auth/users";
import { hasDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: { token: string } }) {
  if (!authEnabled() || !hasDatabase()) redirect("/options");
  if (await getCurrentUser()) redirect("/options");
  const peek = await peekInvite(params.token);
  if (!peek.ok) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="card w-full max-w-sm p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand">
            <Activity size={22} className="text-white" />
          </span>
          <h1 className="mt-4 text-xl font-bold">
            Alpha<span className="text-brand-glow">Forge</span>
          </h1>
          <p className="mt-4 text-sm text-bear">{inviteProblem(peek.reason)}</p>
          <p className="mt-2 text-xs text-ink-faint">
            Ask the person who invited you for a fresh link, or{" "}
            <a href="/login" className="text-brand-glow hover:underline">sign in</a> if you already have an account.
          </p>
        </div>
      </div>
    );
  }
  return <AccountForm mode="join" token={params.token} invitedBy={peek.invitedBy} next="/options" />;
}
