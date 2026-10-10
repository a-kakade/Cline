"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api-client";
import type { Alert, AlertStatus } from "@/lib/emergency-types";
import { Icon } from "@/components/icon";

const labels: Record<AlertStatus, string> = {
  created: "Alert saved — not sent yet",
  queued: "Queued — not delivered",
  sending: "Sending — delivery not confirmed",
  accepted: "Accepted by provider — not confirmed delivered",
  delivered: "Delivery confirmed by provider",
  failed: "Failed — help is not confirmed",
  unknown: "Unknown — delivery cannot be confirmed",
  simulated: "Simulated — no message sent",
  partial: "Mixed results — check each contact",
};
const descriptions: Record<AlertStatus, string> = {
  created:
    "Your alert is saved. The original request may still be preparing to send. You can continue this saved alert without location if that request was interrupted.",
  queued:
    "The alert is waiting to be processed. No delivery has been confirmed.",
  sending:
    "A send attempt is in progress. This is not confirmation that a contact received it.",
  accepted:
    "A provider accepted the request. Acceptance does not mean delivery, that anyone read it, or that help is coming.",
  delivered:
    "The provider reports delivery. This does not confirm that anyone has read the message or is responding.",
  failed:
    "The alert did not complete successfully. Use the direct call link if you need urgent help.",
  unknown:
    "The provider outcome is uncertain. Do not create another alert to retry this one; that could send duplicates. Check again or contact help directly.",
  simulated:
    "This was a local simulation only. No contact received a message, and no help was dispatched.",
  partial:
    "Contacts have different results. Review the outcomes below; do not assume everyone received a message.",
};

function localTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

export function SosStatus({
  id,
  emergencyNumber,
}: {
  id: string;
  emergencyNumber: string;
}) {
  const [alert, setAlert] = useState<Alert | null>(null);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    (isActive: () => boolean = () => true) => {
      return apiRequest<Alert>(`/api/sos/${encodeURIComponent(id)}`)
        .then((data) => {
          if (isActive()) {
            setAlert(data);
            setCheckedAt(Date.now());
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (isActive())
            setError(
              cause instanceof ApiError
                ? cause
                : new ApiError("We couldn’t check this alert."),
            );
        })
        .finally(() => {
          if (isActive()) setLoading(false);
        });
    },
    [id],
  );

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load]);
  useEffect(() => {
    if (
      !alert ||
      error ||
      dispatching ||
      !["created", "queued", "sending"].includes(alert.status)
    )
      return;
    let active = true;
    const timer = setTimeout(() => void load(() => active), 2000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [alert, error, dispatching, load]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function continuePending() {
    if (inFlight.current || alert?.status !== "created") return;
    inFlight.current = true;
    setDispatching(true);
    setError(null);
    try {
      setAlert(
        await apiRequest<Alert>(`/api/sos/${encodeURIComponent(id)}/dispatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ location: null }),
          keepalive: true,
        }),
      );
      setCheckedAt(Date.now());
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause
          : new ApiError(
              "Sending could not be confirmed. Refresh the saved alert status.",
            ),
      );
    } finally {
      inFlight.current = false;
      setDispatching(false);
    }
  }

  return (
    <div className="sos-status-panel">
      <a className="button button-danger" href={`tel:${emergencyNumber}`}>
        <Icon name="phone" />
        Call {emergencyNumber} for urgent help
      </a>
      <p className="sos-call-note">
        SOS does not contact emergency services. No status means that help is on
        its way.
      </p>
      {loading && (
        <p role="status" className="sos-loading">
          Checking your saved alert…
        </p>
      )}
      {error && (
        <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
          <p>{error.message}</p>
          <p>
            {alert
              ? "The result below was last confirmed earlier and may be out of date. Refresh status; do not create a replacement alert."
              : "No outcome can be confirmed here. The emergency call link remains available."}
          </p>
          {error.status === 401 ? (
            <Link className="text-link" href="/auth">
              Sign in again
            </Link>
          ) : (
            <button
              className="text-button"
              type="button"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              Retry loading alert
            </button>
          )}
        </div>
      )}
      {alert && (
        <>
          <section
            className={`sos-result sos-result-${alert.status}`}
            aria-labelledby="alert-result-heading"
          >
            <p className="eyebrow">SAVED ALERT</p>
            <h2 id="alert-result-heading" role="status">
              {labels[alert.status]}
            </h2>
            <p>{descriptions[alert.status]}</p>
            {alert.reason === "NO_CONTACTS" && (
              <div className="sos-no-contacts">
                <p>
                  No sharing-enabled contacts were configured. No message was
                  sent.
                </p>
                <Link className="text-link" href="/contacts">
                  Manage trusted contacts <Icon name="arrow" />
                </Link>
              </div>
            )}
            {alert.reason && alert.reason !== "NO_CONTACTS" && (
              <p className="field-hint">Reason: {alert.reason}</p>
            )}
            <dl className="sos-metadata">
              <div>
                <dt>Created</dt>
                <dd>
                  <time dateTime={new Date(alert.created_at).toISOString()}>
                    {localTime(alert.created_at)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>
                  <time dateTime={new Date(alert.updated_at).toISOString()}>
                    {localTime(alert.updated_at)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>
                  {alert.latitude !== null && alert.longitude !== null ? (
                    <>
                      Saved with this alert
                      {alert.location_accuracy_meters !== null
                        ? ` (accuracy about ${Math.round(alert.location_accuracy_meters)} m)`
                        : ""}
                      .
                      {alert.location_captured_at && (
                        <> Captured {localTime(alert.location_captured_at)}.</>
                      )}
                    </>
                  ) : (
                    "No location saved with this alert."
                  )}
                </dd>
              </div>
            </dl>
            <div className="sos-status-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={loading || dispatching}
                onClick={() => {
                  setLoading(true);
                  void load();
                }}
              >
                Refresh status
              </button>
              {alert.status === "created" && (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={dispatching || loading || !!error}
                  onClick={continuePending}
                >
                  {dispatching
                    ? "Continuing saved alert…"
                    : "Continue pending alert without location"}
                </button>
              )}
            </div>
            {alert.status === "created" && (
              <p className="field-hint">
                Continue uses this saved alert, not a new one. If the server
                recovery worker is running, it can also resume interrupted
                alerts after 15 seconds.
              </p>
            )}
            {checkedAt && (
              <p className="field-hint">
                Last checked {localTime(checkedAt)}. Times shown in your
                device’s local time.
              </p>
            )}
          </section>
          {alert.deliveries.length > 0 && (
            <section
              className="sos-deliveries"
              aria-labelledby="delivery-heading"
            >
              <h2 id="delivery-heading">Contact outcomes</h2>
              <p>
                Contacts are numbered for privacy. Acceptance is not delivery;
                delivery is not a response.
              </p>
              <ul>
                {alert.deliveries.map((delivery, index) => (
                  <li key={delivery.id}>
                    <div>
                      <h3>Contact {index + 1}</h3>
                      <p>{labels[delivery.status]}</p>
                      {delivery.code && (
                        <p className="field-hint">
                          {delivery.code === "PROVIDER_NOT_CONFIGURED"
                            ? "Notification provider is not configured."
                            : delivery.code === "CONTACT_UNAVAILABLE"
                              ? "This contact is no longer available for sharing."
                              : `Result code: ${delivery.code}`}
                        </p>
                      )}
                    </div>
                    <p className="field-hint">
                      Attempts: {delivery.attempt_count}
                      <br />
                      <time
                        dateTime={new Date(delivery.updated_at).toISOString()}
                      >
                        {localTime(delivery.updated_at)}
                      </time>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="sos-reference">
            Alert reference: <span>{alert.id}</span>. Keep this page’s URL to
            return to the same alert.
          </p>
        </>
      )}
    </div>
  );
}
