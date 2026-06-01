import { NextResponse } from "next/server";
import { getRoomStatus, joinRoom } from "@/lib/server/store";
import { verifyTurnstile } from "@/lib/server/turnstile";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ code: string }>;
};

export async function POST(request: Request, context: Context) {
  const body = (await request.json().catch(() => ({}))) as { turnstileToken?: string };
  if (!(await verifyTurnstile(body.turnstileToken))) {
    return NextResponse.json({ error: "turnstile_failed" }, { status: 403 });
  }

  try {
    const { code } = await context.params;
    const { room } = await joinRoom(code);
    return NextResponse.json({ code: room.code, gameId: room.gameId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "join_failed" }, { status: 400 });
  }
}

export async function GET(_request: Request, context: Context) {
  try {
    const { code } = await context.params;
    const { room } = await getRoomStatus(code);
    return NextResponse.json({ code: room.code, gameId: room.gameId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "room_not_found" }, { status: 404 });
  }
}
