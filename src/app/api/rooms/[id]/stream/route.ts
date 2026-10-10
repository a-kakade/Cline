import { getRoomBus } from "@/server/room-bus";
import { openRoomStream } from "@/server/room-stream";
import { roomService } from "@/server/services";
import { endpoint, requireUser } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const user = await requireUser(request);
    const { id } = await context.params;
    const header =
      request.headers.get("last-event-id") ??
      new URL(request.url).searchParams.get("last");
    const last =
      header !== null && /^\d{1,12}$/.test(header) ? Number(header) : null;
    // Throws 403 before any stream is created if the user is not a current member.
    const stream = openRoomStream(roomService(), getRoomBus(), user, id, last, {
      signal: request.signal,
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  });
}
