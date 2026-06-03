import { advanceClock } from "@/lib/game/engine";
import { getGame, sanitizeGame } from "@/lib/server/store";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ gameId: string }>;
};

const tickMs = 1000;

function sseMessage(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request, context: Context) {
  const { gameId } = await context.params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let lastVersion = "";

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        controller.close();
      };

      const sendGame = async () => {
        if (closed) return;

        try {
          const { session, game } = await getGame(gameId);
          advanceClock(game);

          const publicGame = sanitizeGame(game, session.id);
          const version = `${publicGame.updatedAt}:${publicGame.events.length}`;

          if (version !== lastVersion) {
            lastVersion = version;
            controller.enqueue(encoder.encode(sseMessage(publicGame)));
          } else {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }

          if (publicGame.status === "finished" && publicGame.rematch && Date.now() > publicGame.rematch.expiresAt) {
            close();
          }
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              sseMessage({
                error: error instanceof Error ? error.message : "game_stream_failed"
              })
            )
          );
          close();
        }
      };

      const timer = setInterval(sendGame, tickMs);
      request.signal.addEventListener("abort", close);
      await sendGame();
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no"
    }
  });
}
