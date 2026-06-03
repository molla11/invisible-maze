import { NextResponse } from "next/server";
import type { EmoteType } from "@/lib/game/types";
import { sanitizeGame, sendGameEmote } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ gameId: string }>;
};

const validEmotes = new Set<EmoteType>(["hello", "nice", "oops", "thinking"]);

export async function POST(request: Request, context: Context) {
  const body = (await request.json().catch(() => ({}))) as { emote?: EmoteType };
  if (!body.emote || !validEmotes.has(body.emote)) {
    return NextResponse.json({ error: "invalid_emote" }, { status: 400 });
  }

  try {
    const { gameId } = await context.params;
    const { session, game } = await sendGameEmote(gameId, body.emote);
    return NextResponse.json(sanitizeGame(game, session.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "emote_failed" }, { status: 400 });
  }
}
