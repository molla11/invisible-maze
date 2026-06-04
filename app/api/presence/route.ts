import { closePresenceConnection, openPresenceConnection, touchPresenceConnection } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const heartbeatMs = 10_000;

export async function GET(request: Request) {
  const { session, connectionId } = await openPresenceConnection();
  const encoder = new TextEncoder();

  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;

  const close = () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    request.signal.removeEventListener("abort", close);
    void closePresenceConnection(connectionId);
    try {
      controllerRef?.close();
    } catch {
      // The stream may already be closed by the runtime.
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;

      const heartbeat = async () => {
        if (closed) return;
        try {
          await touchPresenceConnection(connectionId, session.id);
          controller.enqueue(encoder.encode(`: presence ${Date.now()}\n\n`));
        } catch {
          close();
        }
      };

      request.signal.addEventListener("abort", close, { once: true });
      timer = setInterval(() => void heartbeat(), heartbeatMs);
      void heartbeat();
    },
    cancel: close
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no"
    }
  });
}
