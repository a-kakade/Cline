"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api-client";
import type { ModerationQueue as Queue } from "@/server/moderation";

const post = (path: string, body: unknown = {}) =>
  apiRequest<unknown>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export function ModerationQueue() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setQueue(await apiRequest<Queue>("/api/moderation/queue"));
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "The queue couldn’t be loaded.",
      );
    }
  }, []);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void load();
    });
    const t = setInterval(() => void load(), 20000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [load]);

  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (cause) {
      setNotice(
        cause instanceof ApiError ? cause.message : "That didn’t work.",
      );
    }
  }

  if (error)
    return (
      <div className="form-error" role="alert">
        {error}
      </div>
    );
  if (!queue)
    return (
      <p role="status" className="contacts-loading">
        Loading queue…
      </p>
    );
  return (
    <div>
      {notice && (
        <p role="status" className="contacts-feedback">
          {notice}
        </p>
      )}
      <section className="journey-card" aria-labelledby="alerts-heading">
        <h2 id="alerts-heading">Flagged messages ({queue.alerts.length})</h2>
        {queue.alerts.length === 0 && <p>Nothing flagged.</p>}
        <ul className="journey-history">
          {queue.alerts.map((a) => (
            <li key={a.id}>
              <strong>
                {a.priority === "urgent" ? "URGENT · " : ""}
                {a.category.replace(/_/g, " ")}
              </strong>{" "}
              · {a.room_name} · {when(a.created_at)}
              <br />
              <em>{a.alias}:</em> {a.body ?? "(removed)"}
              <br />
              <small>{a.note}</small>
              <div className="place-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() =>
                    void act(
                      () =>
                        post(`/api/moderation/alerts/${a.id}`, {
                          status: "acknowledged",
                        }),
                      "Marked as reviewed.",
                    )
                  }
                >
                  Mark reviewed
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() =>
                    void act(
                      () =>
                        post(`/api/moderation/alerts/${a.id}`, {
                          status: "dismissed",
                        }),
                      "Dismissed.",
                    )
                  }
                >
                  Dismiss
                </button>
                <button
                  className="text-button danger-text"
                  type="button"
                  onClick={() =>
                    void act(
                      () =>
                        post(`/api/moderation/messages/${a.message_id}/hide`),
                      "Message removed.",
                    )
                  }
                >
                  Remove message
                </button>
                <button
                  className="text-button danger-text"
                  type="button"
                  onClick={() =>
                    void act(
                      () =>
                        post(`/api/moderation/messages/${a.message_id}/ban`, {
                          reason: "moderator action",
                        }),
                      "Member removed from the room.",
                    )
                  }
                >
                  Remove member from room
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section
        className="journey-card"
        aria-labelledby="reports-heading"
        style={{ marginTop: 24 }}
      >
        <h2 id="reports-heading">
          Reported messages ({queue.message_reports.length})
        </h2>
        {queue.message_reports.length === 0 && <p>No open reports.</p>}
        <ul className="journey-history">
          {queue.message_reports.map((r) => (
            <li key={r.id}>
              <strong>{r.reason.replace(/_/g, " ")}</strong> ·{" "}
              {when(r.created_at)}
              <br />
              <em>{r.alias}:</em> {r.body ?? "(removed)"}
              <div className="place-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() =>
                    void act(
                      () =>
                        post(`/api/moderation/reports/${r.id}`, {
                          status: "dismissed",
                        }),
                      "Report dismissed.",
                    )
                  }
                >
                  Dismiss
                </button>
                <button
                  className="text-button danger-text"
                  type="button"
                  onClick={() =>
                    void act(
                      () =>
                        post(`/api/moderation/messages/${r.message_id}/hide`),
                      "Message removed.",
                    )
                  }
                >
                  Remove message
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section
        className="journey-card"
        aria-labelledby="rr-heading"
        style={{ marginTop: 24 }}
      >
        <h2 id="rr-heading">
          Reported ratings ({queue.rating_reports.length})
        </h2>
        {queue.rating_reports.length === 0 && <p>No open reports.</p>}
        <ul className="journey-history">
          {queue.rating_reports.map((r) => (
            <li key={`${r.rating_id}-${r.created_at}`}>
              {r.stars}★ {r.review ?? "(no text)"} — {r.reason}
              <div className="place-actions">
                <button
                  className="text-button danger-text"
                  type="button"
                  onClick={() =>
                    void act(
                      () => post(`/api/moderation/ratings/${r.rating_id}/hide`),
                      "Rating hidden.",
                    )
                  }
                >
                  Hide rating
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
