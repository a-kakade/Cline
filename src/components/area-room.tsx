"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import type { ChatLine, Hotspot } from "@/lib/hotspots";
import { joinRoom, leaveRoom, resolveRoom } from "@/lib/rooms-client";
import type { RoomInfo } from "@/lib/room-types";
import { AreaRatings } from "@/components/area-ratings";
import { DemoChat } from "@/components/demo-chat";
import { Icon } from "@/components/icon";
import {
  LocationPicker,
  type PickedLocation,
} from "@/components/location-picker";
import { RoomChat } from "@/components/room-chat";
import { Stars } from "@/components/stars";

// One area's room: demo conversation for everyone, live chat and ratings once joined.
export function AreaRoom({
  hotspot,
  chats,
  onBack,
}: {
  hotspot: Hotspot;
  chats: ChatLine[];
  onBack: () => void;
}) {
  const [here, setHere] = useState<PickedLocation>({
    lat: hotspot.lat,
    lon: hotspot.lon,
    source: "map",
    label: hotspot.name,
  });
  const [custom, setCustom] = useState(false);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { lat, lon } = here;
  useEffect(() => {
    let active = true;
    resolveRoom({ lat, lon })
      .then((r) => {
        if (active) {
          setRoom(r);
          setError(null);
        }
      })
      .catch((c: unknown) => {
        if (active) {
          setRoom(null);
          setError(
            c instanceof ApiError
              ? c.message
              : "The area room couldn’t be found.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [lat, lon]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      setRoom(await joinRoom(here));
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "You couldn’t join this room.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function leave() {
    if (!room) return;
    try {
      await leaveRoom(room.id);
      setRoom({
        ...room,
        joined: false,
        member_count: Math.max(0, room.member_count - 1),
      });
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "You couldn’t leave this room.",
      );
    }
  }

  return (
    <div className="area-room">
      <button type="button" className="back-button" onClick={onBack}>
        <Icon
          name="arrow"
          width={18}
          height={18}
          style={{ rotate: "180deg" }}
        />
        Community feed
      </button>

      <section className="room-summary" aria-labelledby="room-summary-h">
        <div className="room-summary-head">
          <div>
            <p className="eyebrow">
              {custom ? "YOUR PLACE" : hotspot.city.toUpperCase()}
            </p>
            <h2 id="room-summary-h">
              {custom ? "Chosen place" : hotspot.name}
            </h2>
          </div>
          {!custom && (
            <div className="area-score">
              <span className={`score-badge score-${hotspot.tone}`}>
                {hotspot.rating.toFixed(1)}
              </span>
              <Stars value={hotspot.rating} tone={hotspot.tone} size={15} />
            </div>
          )}
        </div>
        {!custom && <p className="area-desc">{hotspot.description}</p>}
        <p className="field-hint">
          {room
            ? `${room.member_count} ${room.member_count === 1 ? "person has" : "people have"} joined this zone of about ${room.radius_m * 2} m.`
            : "Finding this area’s room…"}
        </p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {room &&
          (room.banned ? (
            <p className="form-error" role="alert">
              You can’t join this room.
            </p>
          ) : room.joined ? (
            <p className="join-state">
              <Icon name="check" width={16} height={16} /> You’re in this room
            </p>
          ) : (
            <>
              <button
                className="button button-primary"
                type="button"
                disabled={busy}
                onClick={() => void join()}
              >
                {busy ? "Joining…" : "Join this area room"}
              </button>
              <p className="field-hint">
                Joining uses the place you chose once to pick the room. Your
                position isn’t saved or shown; others see only a pseudonym. Only
                people who say they’re here can join, and that isn’t verified.
              </p>
            </>
          ))}
      </section>

      {!custom && <DemoChat chats={chats} area={hotspot.name} />}
      {room?.joined && (
        <RoomChat key={room.id} room={room} onLeft={() => void leave()} />
      )}
      {room?.area_id && <AreaRatings areaId={room.area_id} />}

      <details className="room-elsewhere">
        <summary>Not here? Pick another place</summary>
        <LocationPicker
          value={here}
          onChange={(v) => {
            setRoom(null);
            setCustom(true);
            setHere(v);
          }}
        />
      </details>
    </div>
  );
}
