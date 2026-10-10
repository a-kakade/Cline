"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ComponentType,
} from "react";
import { apiRequest, ApiError } from "@/lib/api-client";
import { ALERT_STATUS_LABELS } from "@/lib/alert-labels";
import { escalationDeadline, isOpen } from "@/lib/journey-state";
import type { Journey, JourneyAction } from "@/lib/journey-types";
import type { Location } from "@/lib/emergency-types";
import { getOptionalLocation } from "@/lib/location";
import type { Contact } from "@/lib/schemas";
import { Icon } from "@/components/icon";

const TRAVEL_MINUTES = [15, 30, 45, 60, 90, 120, 180, 240, 360, 720];
const GRACE_MINUTES = [5, 10, 15, 30, 60];
const EXTEND_MINUTES = [15, 30, 60];
const STATUS_LABEL: Record<Journey["status"], string> = {
  active: "In progress",
  check_in_due: "Check-in needed",
  escalated: "Missed arrival — your contacts were sent a notice",
  completed: "Completed",
  cancelled: "Cancelled",
};
const MIN = 60_000;

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
const dateTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
// Countdowns round up (never promise more time than remains); ages round down.
function duration(ms: number, round: (n: number) => number) {
  const minutes = round(Math.abs(ms) / MIN);
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
const remaining = (ms: number) => duration(ms, Math.ceil);
const fallbackError = (cause: unknown) =>
  cause instanceof ApiError
    ? cause
    : new ApiError("We couldn’t complete this request.");

/** What a custom "start a trip" screen can do; it never touches journey state itself. */
export type PlanContext = {
  /** Contacts with sharing turned on. */
  contacts: Contact[];
  pending: boolean;
  error: string | null;
  startJourney: (p: {
    destination: string;
    origin: string;
    expected_arrival_at: number;
    contact_ids: string[];
  }) => Promise<Journey | null>;
};
export type LiveContext = {
  journey: Journey;
  contactNames: string[];
  now: number;
};

// With `Plan`/`Live` set, the trip screens replace the plain start form and sit above
// the check-in controls; everything else (states, polling, escalation) is unchanged.
export function JourneyGuardian<E = undefined>({
  Plan,
  Live,
  extra,
}: {
  Plan?: ComponentType<PlanContext & { extra: E }>;
  Live?: ComponentType<LiveContext & { extra: E }>;
  extra?: E;
} = {}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [destination, setDestination] = useState("");
  const [origin, setOrigin] = useState("");
  const [travel, setTravel] = useState(30);
  const [grace, setGrace] = useState(10);
  const [selected, setSelected] = useState<string[]>([]);
  const [includeLocation, setIncludeLocation] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [reviewEta, setReviewEta] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [checkInMinutes, setCheckInMinutes] = useState(15);
  const [shareOnCheckIn, setShareOnCheckIn] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const open = journeys.find((j) => isOpen(j.status)) ?? null;
  const history = journeys.filter((j) => !isOpen(j.status)).slice(0, 5);
  const sharing = contacts.filter((c) => c.alert_enabled);

  const refresh = useCallback(async () => {
    const [c, j] = await Promise.allSettled([
      apiRequest<Contact[]>("/api/contacts"),
      apiRequest<Journey[]>("/api/journeys"),
    ]);
    if (c.status === "fulfilled") setContacts(c.value);
    if (j.status === "fulfilled") {
      setJourneys(j.value);
      setLoadError(null);
    } else
      setLoadError(
        j.reason instanceof ApiError
          ? j.reason.message
          : "Your journeys could not be loaded.",
      );
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
    };
  }, [refresh]);
  // The server owns status changes (check-in due, escalation), so poll while open.
  useEffect(() => {
    if (!open) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 20000);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [open, refresh]);

  function invalidateKey() {
    keyRef.current = null;
    setReviewing(false);
    setConsent(false);
  }
  function toggleContact(id: string) {
    invalidateKey();
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }
  function review(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!destination.trim()) return setFormError("Enter a destination.");
    if (!selected.length)
      return setFormError("Select at least one trusted contact.");
    setReviewEta(Date.now() + travel * MIN);
    setReviewing(true);
    setTimeout(() => headingRef.current?.focus(), 0);
  }

  async function start() {
    if (inFlight.current || !consent) return;
    inFlight.current = true;
    setPending(true);
    setFormError(null);
    try {
      keyRef.current ??= crypto.randomUUID();
      // Optional and time-boxed; the journey starts either way.
      const located = includeLocation
        ? await getOptionalLocation(true)
        : { location: null as Location | null, reason: "not-requested" };
      const created = await apiRequest<Journey>("/api/journeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotency_key: keyRef.current,
          destination: destination.trim(),
          origin: origin.trim() || undefined,
          expected_arrival_at: reviewEta,
          grace_period_minutes: grace,
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          contact_ids: selected,
          consent: true,
          location: located.location,
        }),
      });
      setJourneys((current) => [
        created,
        ...current.filter((j) => j.id !== created.id),
      ]);
      setNotice(
        includeLocation && !located.location
          ? "Journey started without location (it was unavailable or not allowed)."
          : "Journey started.",
      );
      keyRef.current = null;
      setReviewing(false);
      setConsent(false);
      setDestination("");
      setOrigin("");
      void refresh();
    } catch (cause) {
      const error = fallbackError(cause);
      // A timeout leaves the outcome unknown: keep the key so a retry cannot duplicate.
      setFormError(
        error.code === "TIMEOUT" || error.code === "NETWORK"
          ? `${error.message} Check again before retrying; retrying is safe and will not create a second journey.`
          : error.message,
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const quickKey = useRef<string | null>(null);
  async function startQuick(p: {
    destination: string;
    origin: string;
    expected_arrival_at: number;
    contact_ids: string[];
  }) {
    if (inFlight.current) return null;
    inFlight.current = true;
    setPending(true);
    setFormError(null);
    try {
      quickKey.current ??= crypto.randomUUID();
      const created = await apiRequest<Journey>("/api/journeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotency_key: quickKey.current,
          destination: p.destination,
          origin: p.origin || undefined,
          expected_arrival_at: p.expected_arrival_at,
          grace_period_minutes: 10,
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          contact_ids: p.contact_ids,
          consent: true,
          location: null,
        }),
      });
      setJourneys((current) => [
        created,
        ...current.filter((j) => j.id !== created.id),
      ]);
      quickKey.current = null;
      setNotice("Journey started.");
      void refresh();
      return created;
    } catch (cause) {
      const error = fallbackError(cause);
      setFormError(
        error.code === "TIMEOUT" || error.code === "NETWORK"
          ? `${error.message} Check again before retrying; retrying is safe and will not create a second journey.`
          : error.message,
      );
      if (error.status >= 400 && error.status < 500) quickKey.current = null;
      return null;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function act(
    journey: Journey,
    action: JourneyAction,
    body: Record<string, unknown> = {},
    success?: string,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setActionError(null);
    try {
      const updated = await apiRequest<Journey>(
        `/api/journeys/${journey.id}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      setJourneys((current) =>
        current.map((j) => (j.id === updated.id ? updated : j)),
      );
      setNotice(success ?? null);
      setConfirmingCancel(false);
    } catch (cause) {
      setActionError(fallbackError(cause));
      void refresh();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  async function checkIn(journey: Journey) {
    const located = shareOnCheckIn
      ? await getOptionalLocation(true)
      : { location: null as Location | null };
    const body: Record<string, unknown> = { location: located.location };
    if (journey.status === "check_in_due")
      body.expected_arrival_at = Date.now() + checkInMinutes * MIN;
    await act(journey, "check-in", body, "Thanks — your check-in is recorded.");
  }
  function extend(journey: Journey, minutes: number) {
    const base = Math.max(journey.expected_arrival_at, Date.now());
    return act(
      journey,
      "extend",
      { expected_arrival_at: base + minutes * MIN },
      `Arrival time extended by ${minutes} minutes.`,
    );
  }

  if (loading)
    return (
      <p role="status" className="contacts-loading">
        Loading your journeys…
      </p>
    );

  const contactName = (id: string) =>
    contacts.find((c) => c.id === id)?.name ?? "A removed contact";

  return (
    <div>
      {loadError && (
        <div className="form-error" role="alert">
          <p>{loadError}</p>
          <button
            type="button"
            className="text-button"
            onClick={() => void refresh()}
          >
            Try again
          </button>
        </div>
      )}
      <p role="status" className="contacts-feedback">
        {notice}
      </p>

      {open && Live && (
        <Live
          journey={open}
          contactNames={open.contact_ids.map(contactName)}
          now={now}
          extra={extra as E}
        />
      )}
      {!open && Plan && (
        <Plan
          contacts={sharing}
          pending={pending}
          error={formError}
          startJourney={startQuick}
          extra={extra as E}
        />
      )}
      <div className={`journey-grid${Plan ? " journey-grid-single" : ""}`}>
        {(open || !Plan) && (
          <section
            className="journey-card"
            aria-labelledby="journey-main-heading"
          >
            {open ? (
              <ActiveJourney
                journey={open}
                now={now}
                pending={pending}
                error={actionError}
                names={open.contact_ids.map(contactName)}
                checkInMinutes={checkInMinutes}
                setCheckInMinutes={setCheckInMinutes}
                shareOnCheckIn={shareOnCheckIn}
                setShareOnCheckIn={setShareOnCheckIn}
                confirmingCancel={confirmingCancel}
                setConfirmingCancel={setConfirmingCancel}
                onCheckIn={() => void checkIn(open)}
                onExtend={(m) => void extend(open, m)}
                onComplete={() =>
                  void act(
                    open,
                    "complete",
                    {},
                    "Journey completed. Glad you arrived.",
                  )
                }
                onCancel={() =>
                  void act(open, "cancel", {}, "Journey cancelled.")
                }
              />
            ) : reviewing ? (
              <>
                <h2 id="journey-main-heading" tabIndex={-1} ref={headingRef}>
                  Review what will be shared
                </h2>
                <dl className="journey-summary">
                  <div>
                    <dt>Destination</dt>
                    <dd>{destination.trim()}</dd>
                  </div>
                  <div>
                    <dt>Expected arrival</dt>
                    <dd>{clock(reviewEta)}</dd>
                  </div>
                  <div>
                    <dt>Grace period</dt>
                    <dd>{grace} minutes</dd>
                  </div>
                  <div>
                    <dt>Contacts</dt>
                    <dd>{selected.map(contactName).join(", ")}</dd>
                  </div>
                  <div>
                    <dt>Location</dt>
                    <dd>
                      {includeLocation
                        ? "Asked once when you start"
                        : "Not shared"}
                    </dd>
                  </div>
                </dl>
                <p className="field-hint">
                  Starting sends nothing. If you haven’t confirmed arrival by{" "}
                  <strong>{clock(reviewEta + grace * MIN)}</strong>, SAKHI will
                  send these contacts a message with your destination
                  {includeLocation ? " and your last known location" : ""}. It
                  does not call the police or any emergency service, and it is
                  not continuous tracking.
                </p>
                <label className="journey-choice">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>
                    I understand and agree to share this with these contacts.
                  </span>
                </label>
                {formError && (
                  <div className="form-error" role="alert">
                    {formError}
                  </div>
                )}
                <div className="journey-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={!consent || pending}
                    onClick={() => void start()}
                  >
                    {pending ? "Starting…" : "Start journey"}
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={pending}
                    onClick={invalidateKey}
                  >
                    Edit details
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 id="journey-main-heading">Start a journey</h2>
                {sharing.length === 0 ? (
                  <div className="contacts-empty">
                    <h3>No sharing-enabled contacts yet.</h3>
                    <p>
                      Journey Guardian needs at least one trusted contact with
                      sharing turned on.
                    </p>
                    <Link className="text-link" href="/contacts">
                      Manage trusted contacts <Icon name="arrow" />
                    </Link>
                  </div>
                ) : (
                  <form onSubmit={review} noValidate>
                    <div className="field">
                      <label htmlFor="journey-destination">Destination</label>
                      <input
                        id="journey-destination"
                        type="text"
                        maxLength={200}
                        value={destination}
                        onChange={(e) => {
                          invalidateKey();
                          setDestination(e.target.value);
                        }}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="journey-origin">
                        Starting from (optional)
                      </label>
                      <input
                        id="journey-origin"
                        type="text"
                        maxLength={200}
                        value={origin}
                        onChange={(e) => {
                          invalidateKey();
                          setOrigin(e.target.value);
                        }}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="journey-travel">
                        Expected travel time
                      </label>
                      <select
                        id="journey-travel"
                        value={travel}
                        onChange={(e) => {
                          invalidateKey();
                          setTravel(Number(e.target.value));
                        }}
                      >
                        {TRAVEL_MINUTES.map((m) => (
                          <option key={m} value={m}>
                            {m < 60
                              ? `${m} minutes`
                              : `${m / 60} hour${m === 60 ? "" : "s"}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="journey-grace">
                        Grace period after that time
                      </label>
                      <select
                        id="journey-grace"
                        value={grace}
                        onChange={(e) => {
                          invalidateKey();
                          setGrace(Number(e.target.value));
                        }}
                      >
                        {GRACE_MINUTES.map((m) => (
                          <option key={m} value={m}>
                            {m} minutes
                          </option>
                        ))}
                      </select>
                      <p className="field-hint">
                        You’ll be asked to check in at your arrival time.
                        Contacts are only messaged if you still haven’t
                        responded after the grace period.
                      </p>
                    </div>
                    <fieldset
                      className="field"
                      style={{ border: 0, padding: 0 }}
                    >
                      <legend className="journey-legend">
                        Who should be told?
                      </legend>
                      {sharing.map((c) => (
                        <label className="journey-choice" key={c.id}>
                          <input
                            type="checkbox"
                            checked={selected.includes(c.id)}
                            onChange={() => toggleContact(c.id)}
                          />
                          <span>
                            {c.name}{" "}
                            <small>{c.phone_number} (not verified)</small>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    <label className="journey-choice">
                      <input
                        type="checkbox"
                        checked={includeLocation}
                        onChange={(e) => {
                          invalidateKey();
                          setIncludeLocation(e.target.checked);
                        }}
                      />
                      <span>
                        Include my current location (optional; skipped after 3
                        seconds if unavailable)
                      </span>
                    </label>
                    {formError && (
                      <div className="form-error" role="alert">
                        {formError}
                      </div>
                    )}
                    <button
                      className="button button-primary"
                      type="submit"
                      style={{ marginTop: 16 }}
                    >
                      Review what will be shared
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        )}

        <section
          className="journey-card"
          aria-labelledby="journey-history-heading"
        >
          <h2 id="journey-history-heading">Recent journeys</h2>
          {history.length === 0 ? (
            <p>Finished journeys will be listed here.</p>
          ) : (
            <ul className="journey-history">
              {history.map((j) => (
                <li key={j.id}>
                  <strong>{j.destination}</strong>
                  <br />
                  {STATUS_LABEL[j.status]} · {dateTime(j.updated_at)}
                  {j.alert_id && (
                    <>
                      {" · "}
                      <Link className="text-link" href={`/sos/${j.alert_id}`}>
                        Notice status
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="field-hint" style={{ marginTop: 16 }}>
            Journey Guardian checks your deadline on the server, so it still
            works if you close this page. It does not track your location in the
            background.
          </p>
        </section>
      </div>
    </div>
  );
}

function ActiveJourney(props: {
  journey: Journey;
  now: number;
  pending: boolean;
  error: ApiError | null;
  names: string[];
  checkInMinutes: number;
  setCheckInMinutes: (m: number) => void;
  shareOnCheckIn: boolean;
  setShareOnCheckIn: (v: boolean) => void;
  confirmingCancel: boolean;
  setConfirmingCancel: (v: boolean) => void;
  onCheckIn: () => void;
  onExtend: (minutes: number) => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { journey: j, now, pending } = props;
  const deadline = escalationDeadline(j);
  const alert = j.alert;
  return (
    <>
      <div className={`journey-status journey-status-${j.status}`}>
        <p className="eyebrow">{STATUS_LABEL[j.status].toUpperCase()}</p>
        <h3 id="journey-main-heading">To {j.destination}</h3>
        {j.status === "active" && (
          <p role="status">
            Expected arrival {clock(j.expected_arrival_at)} (
            {j.expected_arrival_at > now
              ? `in ${remaining(j.expected_arrival_at - now)}`
              : "now due"}
            ). Sharing with {props.names.join(", ")}.
          </p>
        )}
        {j.status === "check_in_due" && (
          <p role="status">
            <strong>Are you safe?</strong> Your arrival time has passed. Confirm
            below, or {props.names.join(", ")} will be sent a notice at{" "}
            {clock(deadline)} ({remaining(deadline - now)}
            {deadline > now ? " left" : " overdue — escalating"}).
          </p>
        )}
        {j.status === "escalated" && (
          <div role="status">
            <p>
              You didn’t check in by {clock(deadline)}, so SAKHI prepared a
              notice for {props.names.join(", ")}.{" "}
              <strong>
                {alert
                  ? ALERT_STATUS_LABELS[alert.status]
                  : "Status unavailable"}
              </strong>
            </p>
            <p className="field-hint">
              This status never means the police were contacted. Call 112 if you
              need urgent help. If you are safe, close the journey below; your
              contacts will get a follow-up.
            </p>
            {j.alert_id && (
              <Link className="text-link" href={`/sos/${j.alert_id}`}>
                See each contact’s outcome <Icon name="arrow" />
              </Link>
            )}
          </div>
        )}
      </div>

      {props.error && (
        <div className="form-error" role="alert">
          {props.error.message}
        </div>
      )}

      {(j.status === "active" || j.status === "check_in_due") && (
        <>
          {j.status === "check_in_due" && (
            <div className="field">
              <label htmlFor="checkin-eta">
                I’m safe, and expect to arrive in
              </label>
              <select
                id="checkin-eta"
                value={props.checkInMinutes}
                onChange={(e) =>
                  props.setCheckInMinutes(Number(e.target.value))
                }
              >
                {[5, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </div>
          )}
          <label className="journey-choice">
            <input
              type="checkbox"
              checked={props.shareOnCheckIn}
              onChange={(e) => props.setShareOnCheckIn(e.target.checked)}
            />
            <span>Update my last known location with this check-in</span>
          </label>
          <div className="journey-actions" style={{ marginTop: 14 }}>
            <button
              className="button button-primary"
              type="button"
              disabled={pending}
              onClick={props.onCheckIn}
            >
              {j.status === "check_in_due"
                ? "I’m safe — continue journey"
                : "I’m safe"}
            </button>
            {EXTEND_MINUTES.map((m) => (
              <button
                key={m}
                className="button button-secondary"
                type="button"
                disabled={pending}
                onClick={() => props.onExtend(m)}
              >
                +{m} min
              </button>
            ))}
          </div>
        </>
      )}
      <div className="journey-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={pending}
          onClick={props.onComplete}
        >
          {j.status === "escalated"
            ? "I’m safe — close journey"
            : "I’ve arrived"}
        </button>
        {!props.confirmingCancel ? (
          <button
            className="text-button danger-text"
            type="button"
            disabled={pending}
            onClick={() => props.setConfirmingCancel(true)}
          >
            Cancel journey
          </button>
        ) : (
          <>
            <button
              className="button button-danger"
              type="button"
              disabled={pending}
              onClick={props.onCancel}
            >
              Confirm cancel
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => props.setConfirmingCancel(false)}
            >
              Keep journey
            </button>
          </>
        )}
      </div>
      {j.events.length > 0 && (
        <details>
          <summary>Journey history</summary>
          <ul className="journey-history">
            {j.events.map((e, i) => (
              <li key={i}>
                {dateTime(e.created_at)} — {e.kind.replace(/[-_]/g, " ")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
