import { redirect } from "next/navigation";
import AccountForm from "@/components/auth/AccountForm";
import { authEnabled } from "@/lib/auth/session";
import { userCount } from "@/lib/auth/users";
import { hasDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

/** One-time owner setup. Disappears as soon as any account exists. */
export default async function ClaimPage() {
  if (!authEnabled() || !hasDatabase()) redirect("/options");
  if ((await userCount()) > 0) redirect("/login");
  return <AccountForm mode="claim" next="/invites" />;
}
