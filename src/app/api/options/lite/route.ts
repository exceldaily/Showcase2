// Board widgets: the slice of the analysis a chart card needs. Shares
// the server-side analysis cache with the full terminal endpoint.
import { NextResponse } from "next/server";
import { buildOptionsAnalysis } from "@/lib/optionsTerminal";
import { toLite } from "@/lib/liteAnalysis";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const u = new URL(request.url);
  const symbol = (u.searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(symbol)) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const profile = u.searchParams.get("profile") ?? "DAY";
  try {
    return NextResponse.json(toLite(await buildOptionsAnalysis(symbol, { profile })));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "analysis failed" }, { status: 502 });
  }
}
