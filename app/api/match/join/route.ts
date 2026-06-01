import { NextResponse } from "next/server";
import { joinQueue } from "@/lib/server/store";
import { verifyTurnstile } from "@/lib/server/turnstile";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { turnstileToken?: string };
  if (!(await verifyTurnstile(body.turnstileToken))) {
    return NextResponse.json({ error: "turnstile_failed" }, { status: 403 });
  }
  return NextResponse.json(await joinQueue());
}
