import { redirect } from "next/navigation";
import { UserPlus } from "lucide-react";
import InvitesManager from "@/components/auth/InvitesManager";
import { authEnabled } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export default async function InvitesPage() {
  if (authEnabled()) {
    const user = await getCurrentUser();
    if (!user) redirect("/login?from=/invites");
    if (user.role !== "owner") redirect("/options");
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/20 text-brand-glow">
          <UserPlus size={18} />
        </span>
        <div>
          <h1 className="text-xl font-bold">Invites and members</h1>
          <p className="text-sm text-ink-muted">
            Only you can invite people. Each link works once, expires in 7 days, and the person picks their own username and password.
          </p>
        </div>
      </div>
      <InvitesManager />
    </div>
  );
}
