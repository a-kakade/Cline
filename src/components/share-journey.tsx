"use client";

import { useRef, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api-client";
import type { JourneyShare } from "@/lib/journey-types";
import { getOptionalLocation } from "@/lib/location";
import { Icon } from "@/components/icon";

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

// One tap sends the ETA, the route and the current location to the journey's contacts.
// Tapping again sends a fresh update. A retry after a failed attempt reuses its key so
// it can never message anyone twice.
export function ShareJourney({
  journeyId,
  contactNames,
  routeSummary,
}: {
  journeyId: string;
  contactNames: string[];
  routeSummary?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JourneyShare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const lock = useRef(false);

  async function share() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      // Location is asked for now, on this tap, and is skipped after 3 seconds.
      const { location } = await getOptionalLocation(true);
      key.current ??= crypto.randomUUID();
      const r = await apiRequest<JourneyShare>(
        `/api/journeys/${encodeURIComponent(journeyId)}/share`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotency_key: key.current,
            route_summary: routeSummary,
            location,
          }),
        },
      );
      key.current = null;
      setResult(r);
    } catch (cause) {
      const e =
        cause instanceof ApiError
          ? cause
          : new ApiError("Your journey couldn’t be shared.");
      setError(
        e.code === "TIMEOUT" || e.code === "NETWORK"
          ? `${e.message} You can tap again; it won’t be sent twice.`
          : e.message,
      );
      if (e.status >= 400 && e.status < 500 && e.code !== "RATE_LIMIT")
        key.current = null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const simulated = result?.deliveries.every((d) => d.status === "simulated");
  const failed = result?.deliveries.filter((d) => d.status === "failed") ?? [];

  return (
    <section className="share-card" aria-label="Share my journey">
      <button
        type="button"
        className="share-button"
        disabled={busy || contactNames.length === 0}
        onClick={() => void share()}
      >
        <span className="share-icon">
          <Icon name="share" width={26} height={26} />
        </span>
        <span className="share-text">
          <strong>
            {busy
              ? "Sharing…"
              : result
                ? "Share an update"
                : "Share my journey"}
          </strong>
          <small>
            {contactNames.length
              ? `Sends ETA, route and live location to ${contactNames.join(", ")}`
              : "Add a trusted contact with sharing on to use this"}
          </small>
        </span>
      </button>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="share-result" role="status">
          <p>
            <strong>
              {simulated
                ? "Simulated: nothing was actually sent."
                : failed.length === result.deliveries.length
                  ? "Couldn’t send to anyone."
                  : "Sent."}
            </strong>{" "}
            {clock(result.created_at)} · ETA {clock(result.expected_arrival_at)}{" "}
            ·{" "}
            {result.shared_location
              ? "includes your location"
              : "no location (it was unavailable or not allowed)"}
          </p>
          <ul>
            {result.deliveries.map((d) => (
              <li key={d.contact_name}>
                {d.contact_name}:{" "}
                {d.status === "simulated"
                  ? "simulated"
                  : d.status === "failed"
                    ? "failed"
                    : d.status === "unknown"
                      ? "outcome unknown"
                      : "sent"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
