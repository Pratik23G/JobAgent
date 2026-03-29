// GET /api/extension/stream?sessionId=xxx — Server-Sent Events endpoint
// The Chrome extension connects here to receive real-time apply pack updates.

import { extensionEvents, type ExtensionEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return new Response("Missing sessionId parameter", { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ sessionId })}\n\n`)
      );

      // Subscribe to events for this session
      const unsubscribe = extensionEvents.subscribe(sessionId, (event: ExtensionEvent) => {
        try {
          const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Stream may be closed
        }
      });

      // Send keepalive ping every 30s to prevent timeout
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(pingInterval);
        }
      }, 30000);

      // Cleanup on abort (client disconnects)
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(pingInterval);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  // Validate origin against allowlist (default: localhost + chrome extensions)
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim());
  const origin = request.headers.get("Origin") || "";
  const isAllowed =
    origin.startsWith("chrome-extension://") ||
    allowedOrigins.includes(origin) ||
    !origin; // SSE from same origin sends no Origin header

  if (!isAllowed) {
    return new Response("Forbidden", { status: 403 });
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...(origin && isAllowed ? { "Access-Control-Allow-Origin": origin } : {}),
      Vary: "Origin",
    },
  });
}
