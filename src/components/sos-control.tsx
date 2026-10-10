"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api-client";
import { getOptionalLocation } from "@/lib/location";
import type { Alert } from "@/lib/emergency-types";
import { Icon } from "@/components/icon";

const pendingKeyStorage = "sakhi.sos.pending-key";
function storedKey() {
  try {
    const value = sessionStorage.getItem(pendingKeyStorage);
    return value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
      ? value
      : null;
  } catch {
    return null;
  }
}

export function SosControl({ emergencyNumber }: { emergencyNumber: string }) {
  const router = useRouter();
  const [includeLocation, setIncludeLocation] = useState(false);
  const [pending, setPending] = useState(false);
  const [retryKey, setRetryKey] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [recent, setRecent] = useState<Alert[]>([]);
  const [recentError, setRecentError] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) {
        const key = storedKey();
        keyRef.current = key;
        setRetryKey(key);
      }
    });
    apiRequest<Alert[]>("/api/sos")
      .then((data) => {
        if (active) setRecent(data);
      })
      .catch(() => {
        if (active) setRecentError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function send() {
    if (inFlight.current || savedId) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const key = keyRef.current ?? storedKey() ?? crypto.randomUUID();
      keyRef.current = key;
      setRetryKey(key);
      try {
        sessionStorage.setItem(pendingKeyStorage, key);
      } catch {
        setStorageWarning(true);
      }
      // Start creation first, then optional location in the same user gesture; never await location here.
      const creating = apiRequest<Alert>("/api/sos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotency_key: key, consent: true }),
      });
      const locating = getOptionalLocation(includeLocation);
      const alert = await creating;
      setSavedId(alert.id);
      try {
        sessionStorage.removeItem(pendingKeyStorage);
      } catch {
        /* The server still deduplicates this UUID. */
      }
      setRecent((current) => [
        alert,
        ...current.filter((entry) => entry.id !== alert.id),
      ]);
      router.push(`/sos/${alert.id}`);
      if (alert.status === "created") {
        const { location } = await locating;
        // Internal navigation does not cancel this request. Recovery after page closure is explicit/server-owned.
        const dispatch = (value: typeof location) =>
          apiRequest<Alert>(`/api/sos/${alert.id}/dispatch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ location: value }),
            keepalive: true,
          });
        try {
          await dispatch(location);
        } catch (cause) {
          // This validation error guarantees sending never began. Unknown outcomes are never retried.
          if (
            location &&
            cause instanceof ApiError &&
            cause.status === 400 &&
            cause.code === "LOCATION_TIME"
          )
            await dispatch(null);
          else throw cause;
        }
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause
          : new ApiError(
              "We couldn’t confirm this request. Check the alert status before trying again.",
            ),
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <section className="sos-control" aria-labelledby="sos-heading">
      <div className="sos-control-action">
        <h2 id="sos-heading">Reach out with SOS.</h2>
        <p id="sos-consent">
          Send SOS shares a message with your sharing-enabled contacts and, only
          if selected, your location. It does not call emergency services or
          guarantee a response.
        </p>
        <label className="sos-location-choice">
          <input
            type="checkbox"
            checked={includeLocation}
            disabled={pending || !!savedId}
            aria-describedby="sos-location-hint"
            onChange={(event) => setIncludeLocation(event.target.checked)}
          />
          <span>Include my location</span>
        </label>
        <p id="sos-location-hint">
          Optional. Asked only after SOS; continues without location after 3
          seconds.
        </p>
        {retryKey && !savedId && (
          <p className="sos-retry-note">
            An alert request is pending. Retrying uses the same request ID, not
            a new alert.
          </p>
        )}
        <button
          className="button button-danger sos-send"
          type="button"
          disabled={pending || !!savedId}
          aria-describedby="sos-consent"
          onClick={send}
        >
          {pending
            ? "Creating your alert…"
            : savedId
              ? "Alert saved"
              : retryKey
                ? "Retry creating this alert"
                : "Send SOS"}
        </button>
        <p role="status" className="sos-progress">
          {savedId
            ? "Your alert is saved. Open its status to see the result."
            : pending
              ? "Creating your alert now. Location will not delay saving it."
              : ""}
        </p>
        {savedId && (
          <Link className="text-link" href={`/sos/${savedId}`}>
            View alert status <Icon name="arrow" />
          </Link>
        )}
        {storageWarning && (
          <p className="field-hint">
            This browser cannot retain the request ID across reloads. If the
            connection fails, retry here without reloading.
          </p>
        )}
        {error && (
          <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
            <p>{error.message}</p>
            <p>
              {savedId
                ? "The alert is saved, but sending is not confirmed. Open its status; do not create a replacement."
                : "No success is confirmed. Retry this request with the same ID, or call emergency services directly."}
            </p>
            {error.status === 401 && (
              <Link className="text-link" href="/auth">
                Sign in again
              </Link>
            )}
          </div>
        )}
      </div>
      <div className="sos-control-copy">
        <h3>What happens next</h3>
        <p>
          Your alert is saved immediately, without waiting for location. You’ll
          see its status on a dedicated page. Denied location permission is not
          requested again in this visit. In simulation mode, no message is sent.
        </p>
        <a className="text-link danger-text" href={`tel:${emergencyNumber}`}>
          <Icon name="phone" />
          Need urgent help? Call {emergencyNumber}
        </a>
      </div>
      <div className="sos-recent">
        <h3>Recent alerts</h3>
        {recentError ? (
          <p>
            Recent alerts couldn’t load. This does not disable SOS.{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setRecentError(false);
                apiRequest<Alert[]>("/api/sos")
                  .then(setRecent)
                  .catch(() => setRecentError(true));
              }}
            >
              Reload recent alerts
            </button>
          </p>
        ) : recent.length ? (
          <ul>
            {recent.slice(0, 5).map((alert, index) => (
              <li key={alert.id}>
                <Link className="text-link" href={`/sos/${alert.id}`}>
                  View recent alert {index + 1} <Icon name="arrow" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>Your saved alerts will be listed here.</p>
        )}
      </div>
    </section>
  );
}
