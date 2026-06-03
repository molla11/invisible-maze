import { NextResponse } from "next/server";
import { joinQueue } from "@/lib/server/store";
import { verifyTurnstile } from "@/lib/server/turnstile";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { turnstileToken?: string };
    if (!(await verifyTurnstile(body.turnstileToken))) {
      return NextResponse.json({ error: "turnstile_failed" }, { status: 403 });
    }
    return NextResponse.json(await joinQueue());
  } catch (error) {
    console.error("match_join_failed", error);
    return NextResponse.json({ error: "match_join_failed" }, { status: 500 });
  }
}
