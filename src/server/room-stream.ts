import type { RoomBus } from "./room-bus";
import type { RoomService } from "./rooms";

export type StreamOptions = {
  heartbeatMs?: number;
  signal?: AbortSignal;
};

const enc = new TextEncoder();
const frame = (event: string, data: unknown, id?: number) =>
  enc.encode(
    `${id !== undefined ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );

/**
 * Server-Sent Events for one member of one room. Membership is verified before
 * the stream opens (throws 403 otherwise) and re-verified on every heartbeat and
 * on revocation events, so a member who is banned or leaves stops receiving
 * messages. `lastSeq` replays anything missed during a reconnect from the
 * database. Payloads contain aliases and message text only: no user ids, no
 * coordinates, no member list.
 */
export function openRoomStream(
  rooms: RoomService,
  bus: RoomBus,
  userId: string,
  roomId: string,
  lastSeq: number | null,
  options: StreamOptions = {},
): ReadableStream<Uint8Array> {
  rooms.requireMember(userId, roomId);
  let cleanup = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = (reason?: string) => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          if (reason) controller.enqueue(frame("closed", { reason }));
          controller.close();
        } catch {
          /* already closed by the client */
        }
      };
      const send = (bytes: Uint8Array) => {
        if (closed) return;
        // A client that stops reading must not make the server buffer forever.
        if ((controller.desiredSize ?? 1) < -64) return close("slow_consumer");
        try {
          controller.enqueue(bytes);
        } catch {
          close();
        }
      };
      const stillMember = () => {
        try {
          rooms.requireMember(userId, roomId);
          return true;
        } catch {
          return false;
        }
      };

      controller.enqueue(enc.encode("retry: 3000\n\n"));
      controller.enqueue(
        frame("ready", {
          room_id: roomId,
          self_alias: rooms.alias(roomId, userId),
        }),
      );
      let highest = lastSeq ?? 0;
      if (lastSeq !== null)
        for (const m of rooms.since(userId, roomId, lastSeq)) {
          highest = Math.max(highest, m.seq);
          controller.enqueue(frame("message", m, m.seq));
        }

      const unsubscribe = bus.subscribe(roomId, (event) => {
        if (event.type === "revoked") {
          if (event.user_id === userId) close("membership_ended");
          return;
        }
        if (event.type === "removed") {
          send(
            frame("removed", { message_id: event.message_id, seq: event.seq }),
          );
          return;
        }
        if (event.seq <= highest) return;
        highest = event.seq;
        if (
          event.author_id !== userId &&
          rooms.isBlockedBy(userId, event.author_id)
        )
          return;
        send(
          frame(
            "message",
            rooms.toPublic(userId, {
              seq: event.seq,
              id: event.id,
              room_id: event.room_id,
              user_id: event.author_id,
              body: event.body,
              status: "visible",
              created_at: event.created_at,
            }),
            event.seq,
          ),
        );
      });
      const heartbeat = setInterval(() => {
        if (!stillMember()) return close("membership_ended");
        send(frame("ping", { t: Date.now() }));
      }, options.heartbeatMs ?? 20_000);
      cleanup = () => {
        unsubscribe();
        clearInterval(heartbeat);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => close();
      if (options.signal?.aborted) close();
      else options.signal?.addEventListener("abort", onAbort);
    },
    cancel() {
      cleanup();
    },
  });
}
