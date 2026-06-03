import { NextResponse } from "next/server";
import { createRoom } from "@/lib/server/store";
import { verifyTurnstile } from "@/lib/server/turnstile";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { turnstileToken?: string };
    if (!(await verifyTurnstile(body.turnstileToken))) {
      return NextResponse.json({ error: "turnstile_failed" }, { status: 403 });
    }
    const { room } = await createRoom();
    return NextResponse.json({ code: room.code, gameId: room.gameId });
  } catch (error) {
    console.error("room_create_failed", error);
    return NextResponse.json({ error: "room_create_failed" }, { status: 500 });
  }
}
