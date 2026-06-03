import { NextResponse } from "next/server";
import { sanitizeGame, surrenderGame } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ gameId: string }>;
};

export async function POST(_request: Request, context: Context) {
  try {
    const { gameId } = await context.params;
    const { session, game } = await surrenderGame(gameId);
    return NextResponse.json(sanitizeGame(game, session.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "surrender_failed" }, { status: 400 });
  }
}
