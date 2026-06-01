import { NextResponse } from "next/server";
import { heartbeatGame, sanitizeGame } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ gameId: string }>;
};

export async function POST(_request: Request, context: Context) {
  try {
    const { gameId } = await context.params;
    const { session, game } = await heartbeatGame(gameId);
    return NextResponse.json(sanitizeGame(game, session.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "heartbeat_failed" }, { status: 404 });
  }
}
