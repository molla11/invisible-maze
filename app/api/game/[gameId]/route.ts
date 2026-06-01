import { NextResponse } from "next/server";
import { advanceClock } from "@/lib/game/engine";
import { getGame, sanitizeGame } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ gameId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const { gameId } = await context.params;
    const { session, game } = await getGame(gameId);
    advanceClock(game);
    return NextResponse.json(sanitizeGame(game, session.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "game_not_found" }, { status: 404 });
  }
}
