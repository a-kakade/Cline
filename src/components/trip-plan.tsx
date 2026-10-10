"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api-client";
import type { Hotspot } from "@/lib/hotspots";
import {
  adjustSafety,
  etaMinutes,
  MODES,
  TAG_LABEL,
  type Companions,
  type PlannedRoute,
  type TravelMode,
  type TripPlan as Plan,
} from "@/lib/trip";
import { saveTrip } from "@/lib/trip-storage";
import { Icon } from "@/components/icon";
import type { PlanContext } from "@/components/journey-guardian";

export type TripExtra = {
  hotspots: Hotspot[];
  tileUrl: string;
  emergencyNumber: string;
};

const LeafletMap = dynamic(() => import("@/components/leaflet-map"), {
  ssr: false,
  loading: () => (
    <p role="status" className="contacts-loading">
      Loading map…
    </p>
  ),
});

const MODE_ICON = {
  walk: "walk",
  cab: "car",
  bus: "bus",
  metro: "train",
} as const;
const DEPART = [
  { min: 0, label: "Leave now" },
  { min: 15, label: "In 15 min" },
  { min: 30, label: "In 30 min" },
  { min: 60, label: "In 1 hour" },
];
const WITH: { id: Companions; label: string; icon: "person" | "people" }[] = [
  { id: "alone", label: "Alone", icon: "person" },
  { id: "friend", label: "With a friend", icon: "people" },
  { id: "group", label: "In a group", icon: "people" },
];
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
export const routeLabel = (r: PlannedRoute, i: number) =>
  `Route ${i + 1}${r.tags.length ? ` (${r.tags.map((t) => TAG_LABEL[t]).join(" · ")})` : ""}`;

export function TripPlan(props: PlanContext & { extra: TripExtra }) {
  const ctx = props;
  const { hotspots, tileUrl } = props.extra;
  const byCity = useMemo(() => {
    const m = new Map<string, Hotspot[]>();
    for (const h of hotspots) m.set(h.city, [...(m.get(h.city) ?? []), h]);
    return [...m];
  }, [hotspots]);
  const [fromId, setFromId] = useState(hotspots[0].id);
  const [toId, setToId] = useState(
    hotspots.find(
      (h) => h.city === hotspots[0].city && h.id !== hotspots[0].id,
    )!.id,
  );
  const [device, setDevice] = useState<{ lat: number; lon: number } | null>(
    null,
  );
  const [mode, setMode] = useState<TravelMode>("cab");
  const [withWho, setWithWho] = useState<Companions>("alone");
  const [depart, setDepart] = useState(0);
  const [step, setStep] = useState<"plan" | "route">("plan");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [planAt, setPlanAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const spot = (id: string) => hotspots.find((h) => h.id === id);
  const point = (id: string) =>
    id === "device" && device ? device : (spot(id) ?? hotspots[0]);
  const label = (id: string) =>
    id === "device"
      ? "Current location"
      : `${spot(id)!.name}, ${spot(id)!.city}`;

  function pickFrom(id: string) {
    if (id !== "device") return setFromId(id);
    if (!navigator.geolocation) {
      setError("This browser can’t share a location. Choose an area instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDevice({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setFromId("device");
        setLocating(false);
        setError(null);
      },
      () => {
        setLocating(false);
        setError("Location wasn’t shared. Choose a starting area instead.");
      },
      { timeout: 7000, maximumAge: 60_000 },
    );
  }
  function swap() {
    if (fromId === "device") return;
    setFromId(toId);
    setToId(fromId);
    setPlan(null);
  }

  async function find() {
    if (fromId === toId) return setError("Choose two different places.");
    setBusy(true);
    setError(null);
    try {
      const a = point(fromId);
      const b = point(toId);
      const result = await apiRequest<Plan>("/api/trip/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: { lat: a.lat, lon: a.lon },
          to: { lat: b.lat, lon: b.lon },
        }),
      });
      setPlan(result);
      setPlanAt(Date.now());
      setActiveId(result.routes[0].id);
      setStep("route");
    } catch (c) {
      setError(
        c instanceof ApiError
          ? c.message
          : "Routes couldn’t be found right now.",
      );
    } finally {
      setBusy(false);
    }
  }

  const active = plan?.routes.find((r) => r.id === activeId) ?? null;
  const minutes = active ? etaMinutes(mode, active) : 0;
  const arrival = planAt + (depart + minutes) * 60_000;
  const safety = active
    ? adjustSafety(active.safety, withWho, new Date(arrival).getHours())
    : 0;

  async function start() {
    if (!active || !plan) return;
    const a = point(fromId);
    const b = point(toId);
    const when = Date.now() + Math.max(2, depart + minutes) * 60_000;
    const j = await ctx.startJourney({
      destination: label(toId),
      origin: label(fromId),
      expected_arrival_at: when,
      contact_ids: ctx.contacts.map((c) => c.id),
    });
    if (!j) return;
    const idx = plan.routes.indexOf(active);
    saveTrip({
      journeyId: j.id,
      mode,
      from: { lat: a.lat, lon: a.lon, label: label(fromId) },
      to: { lat: b.lat, lon: b.lon, label: label(toId) },
      route: active,
      summary: `${routeLabel(active, idx)}${active.via ? ` via ${active.via}` : ""}, ${(active.distance_m / 1000).toFixed(1)} km, ${minutes} min by ${mode}`,
    });
  }

  if (step === "route" && plan && active) {
    const a = point(fromId);
    const b = point(toId);
    return (
      <section className="trip" aria-labelledby="trip-route-h">
        <header className="trip-head">
          <button
            type="button"
            className="back-button"
            onClick={() => setStep("plan")}
          >
            <Icon
              name="arrow"
              width={18}
              height={18}
              style={{ rotate: "180deg" }}
            />
            Edit
          </button>
          <div>
            <h2 id="trip-route-h">Your journey</h2>
            <p>Review your safest route before you start</p>
          </div>
        </header>

        <div className="trip-map">
          <LeafletMap
            tileUrl={tileUrl}
            hotspots={hotspots}
            pins={false}
            routes={plan.routes.map((r) => ({
              id: r.id,
              line: r.geometry,
              active: r.id === activeId,
            }))}
            markers={[
              { lat: a.lat, lon: a.lon, kind: "from" },
              { lat: b.lat, lon: b.lon, kind: "to" },
            ]}
            focus={null}
            fitRoutes
          />
        </div>

        <div className="trip-fromto trip-fromto-card">
          <div>
            <small>From</small>
            <strong>{label(fromId)}</strong>
          </div>
          <div>
            <small>To</small>
            <strong>{label(toId)}</strong>
          </div>
        </div>

        <dl className="trip-stats">
          <div>
            <Icon name="clock" width={20} height={20} />
            <dt>ETA</dt>
            <dd>{minutes} min</dd>
            <small>arrive {clock(arrival)}</small>
          </div>
          <div>
            <Icon name="route" width={20} height={20} />
            <dt>Distance</dt>
            <dd>{(active.distance_m / 1000).toFixed(1)} km</dd>
          </div>
          <div>
            <Icon name="shield" width={20} height={20} />
            <dt>Safety (demo)</dt>
            <dd className={safety >= 75 ? "ok" : safety >= 55 ? "mid" : "low"}>
              {safety}%
            </dd>
          </div>
        </dl>

        <h3 className="trip-subhead">Recommended route</h3>
        <ul className="route-options" role="radiogroup" aria-label="Routes">
          {plan.routes.map((r, i) => (
            <li key={r.id}>
              <button
                type="button"
                role="radio"
                aria-checked={r.id === activeId}
                className={`route-option${r.id === activeId ? " route-option-on" : ""}`}
                onClick={() => setActiveId(r.id)}
              >
                <span className="route-radio" aria-hidden="true" />
                <span className="route-text">
                  <strong>{routeLabel(r, i)}</strong>
                  <small>
                    {r.via ? `Via ${r.via}` : "Direct roads"} · {r.help_points}{" "}
                    help points · area rating {r.area_rating}
                  </small>
                </span>
                <b>{etaMinutes(mode, r)} min</b>
              </button>
            </li>
          ))}
        </ul>

        {ctx.contacts.length === 0 ? (
          <div className="journey-warning" role="note">
            <strong>Add someone you trust first.</strong> Journey Guardian needs
            at least one contact with sharing turned on.{" "}
            <Link className="text-link" href="/contacts">
              Manage trusted contacts <Icon name="arrow" />
            </Link>
          </div>
        ) : (
          <p className="field-hint">
            Starting sends nothing. If you don’t arrive or check in on time,{" "}
            {ctx.contacts.map((c) => c.name).join(", ")} get a notice. You can
            share your journey with one tap once it starts.
          </p>
        )}
        {ctx.error && (
          <div className="form-error" role="alert">
            {ctx.error}
          </div>
        )}
        <button
          type="button"
          className="button button-primary trip-cta"
          disabled={ctx.pending || ctx.contacts.length === 0}
          onClick={() => void start()}
        >
          {ctx.pending ? "Starting…" : "Start journey"} <Icon name="arrow" />
        </button>
        <ul className="field-hint">
          {plan.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="trip" aria-labelledby="trip-plan-h">
      <header className="trip-head trip-head-center">
        <h2 id="trip-plan-h">Plan your trip</h2>
        <p>Find the safest route for your journey</p>
      </header>

      <div className="trip-fromto trip-fromto-card">
        <div className="trip-rail" aria-hidden="true">
          <i />
          <b />
          <i className="end" />
        </div>
        <div className="trip-fields">
          <label>
            <small>From</small>
            <select
              value={fromId}
              onChange={(e) => {
                setPlan(null);
                pickFrom(e.target.value);
              }}
              disabled={locating}
            >
              <option value="device">
                {locating
                  ? "Finding you…"
                  : device
                    ? "Current location"
                    : "Use my current location"}
              </option>
              {byCity.map(([c, list]) => (
                <optgroup key={c} label={c}>
                  {list.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <small>To</small>
            <select
              value={toId}
              onChange={(e) => {
                setPlan(null);
                setToId(e.target.value);
              }}
            >
              {byCity.map(([c, list]) => (
                <optgroup key={c} label={c}>
                  {list.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="swap-button"
          onClick={swap}
          disabled={fromId === "device"}
          aria-label="Swap start and destination"
        >
          <Icon name="swap" width={18} height={18} />
        </button>
      </div>

      <h3 className="trip-subhead">Travel mode</h3>
      <div className="mode-row" role="radiogroup" aria-label="Travel mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            className={`mode-btn${mode === m.id ? " mode-btn-on" : ""}`}
            onClick={() => setMode(m.id)}
          >
            <Icon name={MODE_ICON[m.id]} width={24} height={24} />
            {m.label}
          </button>
        ))}
      </div>

      <div className="trip-two">
        <div>
          <h3 className="trip-subhead">Departure time</h3>
          <select
            className="trip-select"
            value={depart}
            onChange={(e) => setDepart(Number(e.target.value))}
            aria-label="Departure time"
          >
            {DEPART.map((d) => (
              <option key={d.min} value={d.min}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <h3 className="trip-subhead">Travelling with</h3>
          <div
            className="with-row"
            role="radiogroup"
            aria-label="Travelling with"
          >
            {WITH.map((w) => (
              <button
                key={w.id}
                type="button"
                role="radio"
                aria-checked={withWho === w.id}
                aria-label={w.label}
                title={w.label}
                className={`with-btn${withWho === w.id ? " with-btn-on" : ""}`}
                onClick={() => setWithWho(w.id)}
              >
                <Icon name={w.icon} width={22} height={22} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <button
        type="button"
        className="button button-primary trip-cta"
        disabled={busy || locating}
        onClick={() => void find()}
      >
        {busy ? "Finding routes…" : "Find safest route"} <Icon name="arrow" />
      </button>

      <aside className="safety-first">
        <span className="icon-tile">
          <Icon name="shield" width={20} height={20} />
        </span>
        <span>
          <strong>Safety first</strong>
          <small>
            We compare routes using area ratings and nearby help points, then
            suggest the safest journey. Demo scoring.
          </small>
        </span>
      </aside>
    </section>
  );
}
