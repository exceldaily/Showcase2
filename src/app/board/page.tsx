import Board from "@/components/board/Board";
import { authEnabled } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const user = authEnabled() ? await getCurrentUser() : null;
  return <Board isOwner={!authEnabled() || user?.role === "owner"} />;
}
