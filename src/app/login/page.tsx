import { redirect } from "next/navigation";
import AccountForm from "@/components/auth/AccountForm";
import { authEnabled } from "@/lib/auth/session";
import { getCurrentUser, userCount } from "@/lib/auth/users";
import { hasDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

const REASONS: Record<string, string> = {
  revoked: "You were signed out. Your account was disabled, removed, or signed out everywhere.",
};

export default async function LoginPage({ searchParams }: { searchParams: { from?: string; reason?: string } }) {
  if (!authEnabled()) redirect("/options");
  if (await getCurrentUser()) redirect(searchParams.from?.startsWith("/") ? searchParams.from : "/options");
  const noOwnerYet = hasDatabase() && (await userCount()) === 0;
  return (
    <AccountForm
      mode="login"
      next={searchParams.from}
      notice={searchParams.reason ? REASONS[searchParams.reason] ?? null : null}
      showClaimLink={noOwnerYet}
    />
  );
}
