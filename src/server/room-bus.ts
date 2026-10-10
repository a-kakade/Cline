// In-process fan-out for room events. Correct on a single Node host (see ADR
// 0001); messages are persisted before anything is published, so a missed event is
// recovered from the database by sequence number.
export type BusEvent =
  | {
      type: "message";
      seq: number;
      id: string;
      room_id: string;
      author_id: string;
      body: string;
      created_at: number;
    }
  | { type: "removed"; message_id: string; seq: number }
  | { type: "revoked"; user_id: string };

type Listener = (event: BusEvent) => void;
export class RoomBus {
  private rooms = new Map<string, Set<Listener>>();
  subscribe(roomId: string, listener: Listener) {
    let set = this.rooms.get(roomId);
    if (!set) this.rooms.set(roomId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.rooms.delete(roomId);
    };
  }
  publish(roomId: string, event: BusEvent) {
    for (const listener of [...(this.rooms.get(roomId) ?? [])]) {
      try {
        listener(event);
      } catch {
        /* one broken subscriber must not affect the others */
      }
    }
  }
  listenerCount(roomId: string) {
    return this.rooms.get(roomId)?.size ?? 0;
  }
}
const shared = globalThis as typeof globalThis & { sakhiRoomBus?: RoomBus };
export const getRoomBus = () => (shared.sakhiRoomBus ??= new RoomBus());
