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
    const publicGame = sanitizeGame(game, session.id);
    const etag = `"game:${publicGame.id}:${publicGame.viewerSlot ?? "spectator"}:${publicGame.updatedAt}:${publicGame.events.length}"`;

    if (_request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag
        }
      });
    }

    return NextResponse.json(publicGame, {
      headers: {
        ETag: etag,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "game_not_found" }, { status: 404 });
  }
}
