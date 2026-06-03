import { NextResponse } from "next/server";
import { requestGameRematch, sanitizeGame } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ gameId: string }>;
};

export async function POST(_request: Request, context: Context) {
  try {
    const { gameId } = await context.params;
    const { session, game, nextGameId } = await requestGameRematch(gameId);
    return NextResponse.json({ game: sanitizeGame(game, session.id), nextGameId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "rematch_failed" }, { status: 400 });
  }
}
