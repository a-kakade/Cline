"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ApiError } from "@/lib/api-client";
import {
  blockAuthor,
  loadHistory,
  reportMessage,
  sendMessage,
} from "@/lib/rooms-client";
import type { RoomInfo, RoomMessage, SenderTriage } from "@/lib/room-types";
import { TriageHelp } from "@/components/triage-help";

type Connection = "connecting" | "live" | "reconnecting" | "ended";
const time = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

function merge(current: RoomMessage[], incoming: RoomMessage[]) {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export function RoomChat({
  room,
  onLeft,
}: {
  room: RoomInfo;
  onLeft: () => void;
}) {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [selfAlias, setSelfAlias] = useState<string>("");
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [triage, setTriage] = useState<SenderTriage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const clientId = useRef<string | null>(null);
  const lastSeq = useRef(0);
  const sendLock = useRef(false);
  const listEnd = useRef<HTMLDivElement>(null);
  const roomId = room.id;

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const page = await loadHistory(roomId);
      setMessages((c) => merge(c, page.messages));
      for (const m of page.messages)
        lastSeq.current = Math.max(lastSeq.current, m.seq);
      setSelfAlias(page.self_alias);
      setNextBefore(page.next_before);
      setLoadError(null);
    } catch (cause) {
      setLoadError(
        cause instanceof ApiError
          ? cause.message
          : "Messages couldn’t be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadInitial();
    });
    return () => {
      active = false;
    };
  }, [loadInitial]);

  // Live updates over Server-Sent Events, with our own reconnect logic: a browser
  // that goes offline often never reports a dead connection, so a watchdog treats
  // 45 s without any event (the server pings every 20 s) as a drop. On reconnect we
  // re-read history first, which both recovers missed messages and tells us if we
  // have been removed from the room.
  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let attempt = 0;

    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(drop, 45_000);
    };
    const drop = () => {
      if (stopped) return;
      source?.close();
      source = null;
      clearTimeout(watchdog);
      setConnection("reconnecting");
      clearTimeout(retryTimer);
      retryTimer = setTimeout(
        reconnect,
        Math.min(15_000, 1000 * 2 ** attempt++),
      );
    };
    const open = () => {
      if (stopped) return;
      const last = lastSeq.current;
      source = new EventSource(
        `/api/rooms/${encodeURIComponent(roomId)}/stream${last ? `?last=${last}` : ""}`,
      );
      source.addEventListener("ready", () => {
        attempt = 0;
        setConnection("live");
        arm();
      });
      source.addEventListener("ping", arm);
      source.addEventListener("message", (e) => {
        const message = JSON.parse((e as MessageEvent).data) as RoomMessage;
        lastSeq.current = Math.max(lastSeq.current, message.seq);
        setMessages((c) => merge(c, [message]));
        arm();
      });
      source.addEventListener("removed", (e) => {
        const { message_id } = JSON.parse((e as MessageEvent).data) as {
          message_id: string;
        };
        setMessages((c) =>
          c.map((m) =>
            m.id === message_id ? { ...m, body: null, status: "hidden" } : m,
          ),
        );
        arm();
      });
      source.addEventListener("closed", () => {
        stopped = true;
        source?.close();
        clearTimeout(watchdog);
        setConnection("ended");
      });
      source.onerror = drop;
    };
    const reconnect = async () => {
      if (stopped) return;
      try {
        const page = await loadHistory(roomId);
        setMessages((c) => merge(c, page.messages));
        for (const m of page.messages)
          lastSeq.current = Math.max(lastSeq.current, m.seq);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 403) {
          stopped = true;
          setConnection("ended");
          return;
        }
        drop(); // still unreachable: back off and try again
        return;
      }
      open();
    };
    const goOffline = () => {
      source?.close();
      source = null;
      clearTimeout(watchdog);
      clearTimeout(retryTimer);
      setConnection("reconnecting");
    };
    const goOnline = () => {
      clearTimeout(retryTimer);
      attempt = 0;
      void reconnect();
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    open();
    return () => {
      stopped = true;
      source?.close();
      clearTimeout(watchdog);
      clearTimeout(retryTimer);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [roomId]);

  const count = messages.length;
  useEffect(() => {
    listEnd.current?.scrollIntoView?.({ block: "end" });
  }, [count]);

  async function older() {
    if (!nextBefore) return;
    try {
      const page = await loadHistory(roomId, nextBefore);
      setMessages((c) => merge(c, page.messages));
      setNextBefore(page.next_before);
    } catch (cause) {
      setLoadError(
        cause instanceof ApiError
          ? cause.message
          : "Earlier messages couldn’t be loaded.",
      );
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    setSendError(null);
    try {
      // The same id is reused for a retry, so a flaky connection can't post twice.
      clientId.current ??= crypto.randomUUID();
      const result = await sendMessage(roomId, clientId.current, body);
      clientId.current = null;
      setDraft("");
      setMessages((c) => merge(c, [result.message]));
      setTriage(result.triage);
    } catch (cause) {
      const error =
        cause instanceof ApiError
          ? cause
          : new ApiError("Your message couldn’t be sent.");
      setSendError(
        error.code === "TIMEOUT" || error.code === "NETWORK"
          ? `${error.message} You can send again; it won’t be posted twice.`
          : error.message,
      );
      if (
        error.status >= 400 &&
        error.status < 500 &&
        error.code !== "RATE_LIMIT"
      )
        clientId.current = null;
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  async function act(label: string, fn: () => Promise<unknown>, done: string) {
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      if (label === "block") void loadInitial();
    } catch (cause) {
      setNotice(
        cause instanceof ApiError ? cause.message : "That didn’t work.",
      );
    }
  }

  const status: Record<Connection, string> = {
    connecting: "Connecting…",
    live: "Live",
    reconnecting:
      "Connection lost — reconnecting. Missed messages will appear when it returns.",
    ended: "Live updates stopped. Reload to reconnect.",
  };

  return (
    <section className="chat" aria-labelledby="chat-heading">
      <div className="chat-head">
        <h2 id="chat-heading">{room.name}</h2>
        <p role="status" className={`chat-status chat-status-${connection}`}>
          <span aria-hidden="true" className="chat-dot" /> {status[connection]}
        </p>
      </div>
      <p className="field-hint">
        A shared zone of about {room.radius_m * 2} m for local safety
        information. Everyone here is shown under a pseudonym; no one sees your
        name, number or position. Don’t post personal details. This is not an
        emergency channel — call 112 or use SOS.
      </p>
      {notice && (
        <p role="status" className="contacts-feedback">
          {notice}
        </p>
      )}
      {loadError && (
        <div className="form-error" role="alert">
          <p>{loadError}</p>
          <button
            type="button"
            className="text-button"
            onClick={() => void loadInitial()}
          >
            Try again
          </button>
        </div>
      )}
      {loading && (
        <p role="status" className="contacts-loading">
          Loading messages…
        </p>
      )}
      {nextBefore && (
        <button
          type="button"
          className="text-button"
          onClick={() => void older()}
        >
          Load earlier messages
        </button>
      )}
      {!loading && !loadError && messages.length === 0 && (
        <p className="contacts-empty">
          No messages yet. Share something useful for people nearby.
        </p>
      )}
      <ol className="chat-list" aria-label="Messages" aria-live="polite">
        {messages.map((m) => (
          <li
            key={m.id}
            className={`chat-message${m.mine ? " chat-mine" : ""}`}
          >
            <p className="chat-meta">
              <strong>{m.mine ? `You (${selfAlias})` : m.alias}</strong> ·{" "}
              <time dateTime={new Date(m.created_at).toISOString()}>
                {time(m.created_at)}
              </time>
            </p>
            {m.body === null ? (
              <p className="chat-removed">Removed by a moderator.</p>
            ) : (
              <p>{m.body}</p>
            )}
            {!m.mine && m.body !== null && (
              <details className="chat-actions">
                <summary>Options for this message</summary>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    void act(
                      "report",
                      () => reportMessage(m.id, "abuse"),
                      "Reported to moderators. Thank you.",
                    )
                  }
                >
                  Report as abusive
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    void act(
                      "report",
                      () => reportMessage(m.id, "unsafe_info"),
                      "Reported to moderators. Thank you.",
                    )
                  }
                >
                  Report as misleading or unsafe
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    void act(
                      "block",
                      () => blockAuthor(m.id),
                      "Blocked. You won’t see this person’s messages.",
                    )
                  }
                >
                  Block this person
                </button>
              </details>
            )}
          </li>
        ))}
      </ol>
      <div ref={listEnd} />

      {triage && (
        <TriageHelp triage={triage} onDismiss={() => setTriage(null)} />
      )}

      <form onSubmit={send} className="chat-form">
        <label htmlFor="chat-input">Message to this area</label>
        <textarea
          id="chat-input"
          rows={2}
          maxLength={500}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-describedby="chat-count"
        />
        <p id="chat-count" className="field-hint">
          {draft.length}/500
        </p>
        {sendError && (
          <div className="form-error" role="alert">
            {sendError}
          </div>
        )}
        <div className="journey-actions">
          <button
            className="button button-primary"
            type="submit"
            disabled={sending || !draft.trim()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
          <button
            type="button"
            className="text-button danger-text"
            onClick={onLeft}
          >
            Leave this room
          </button>
        </div>
      </form>
    </section>
  );
}
