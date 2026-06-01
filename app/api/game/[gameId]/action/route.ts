import { NextResponse } from "next/server";
import type { Direction } from "@/lib/game/types";
import { submitGameAction, sanitizeGame } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ gameId: string }>;
};

const validDirections = new Set(["up", "right", "down", "left"]);

export async function POST(request: Request, context: Context) {
  const body = (await request.json().catch(() => ({}))) as { steps?: Direction[] };
  if (!Array.isArray(body.steps) || body.steps.some((step) => !validDirections.has(step))) {
    return NextResponse.json({ error: "invalid_steps" }, { status: 400 });
  }

  try {
    const { gameId } = await context.params;
    const { session, game } = await submitGameAction(gameId, body.steps);
    return NextResponse.json(sanitizeGame(game, session.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "action_failed" }, { status: 400 });
  }
}
