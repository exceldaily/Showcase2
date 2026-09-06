// Owner-only member management: list, disable/enable, remove.
// The owner row itself can never be disabled or deleted here.
import { NextResponse } from "next/server";
import { hasDatabase } from "@/lib/db";
import { deleteMember, listMembers, requireOwner, setMemberDisabled } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/;

export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  if (!hasDatabase()) return NextResponse.json({ members: [] });
  return NextResponse.json({ members: await listMembers() });
}

export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  let body: { id?: string; disabled?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  if (!UUID_RE.test(id) || typeof body.disabled !== "boolean") return NextResponse.json({ error: "id and disabled required" }, { status: 400 });
  if (id === owner.id) return NextResponse.json({ error: "you cannot disable yourself" }, { status: 400 });
  const ok = await setMemberDisabled(id, body.disabled);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}

export async function DELETE(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (id === owner.id) return NextResponse.json({ error: "you cannot remove yourself" }, { status: 400 });
  const ok = await deleteMember(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
