"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { formatDistance } from "@/lib/map-client";
import type { Service, ServiceCategory } from "@/lib/services";
import { loadTrip } from "@/lib/trip-storage";
import { Icon } from "@/components/icon";
import type { LiveContext } from "@/components/journey-guardian";
import type { TripExtra } from "@/components/trip-plan";
import { ShareJourney } from "@/components/share-journey";

const LeafletMap = dynamic(() => import("@/components/leaflet-map"), {
  ssr: false,
  loading: () => (
    <p role="status" className="contacts-loading">
      Loading map…
    </p>
  ),
});

const TILES: {
  id: ServiceCategory;
  label: string;
  icon: "shield" | "hospital" | "heart";
}[] = [
  { id: "police", label: "Police", icon: "shield" },
  { id: "hospital", label: "Hospital", icon: "hospital" },
  { id: "women_help", label: "Women help", icon: "heart" },
  { id: "safe_zone", label: "Safe zone", icon: "shield" },
];
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

// The "Safety Maps" screen while a journey is open: route, ETA, one-tap share and the
// nearest help. Check-in, extend, arrive and cancel are in the card below it.
export function TripLive(props: LiveContext & { extra: TripExtra }) {
  const ctx = props;
  const { hotspots, tileUrl, emergencyNumber } = props.extra;
  const { journey, now } = ctx;
  const [saved] = useState(() => loadTrip(journey.id));
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  const [watching, setWatching] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);

  // Live position only while the user has switched it on; it stays in this page.
  useEffect(() => {
    if (!watching || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setMe({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocError(null);
      },
      () => {
        setLocError("Your location isn’t available right now.");
        setWatching(false);
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [watching]);

  const anchor = me ?? saved?.to ?? null;
  const ak = anchor
    ? `${anchor.lat.toFixed(3)},${anchor.lon.toFixed(3)}`
    : null;
  useEffect(() => {
    if (!ak) return;
    const [lat, lon] = ak.split(",");
    let active = true;
    apiRequest<{ services: Service[] }>(
      `/api/services/nearby?lat=${lat}&lon=${lon}&radius_m=3000`,
    )
      .then((d) => active && setServices(d.services))
      .catch(() => active && setServices([]));
    return () => {
      active = false;
    };
  }, [ak]);

  const pins = useMemo(
    () =>
      TILES.flatMap((t) =>
        services.filter((s) => s.category === t.id).slice(0, 3),
      ),
    [services],
  );
  const left = Math.max(
    0,
    Math.ceil((journey.expected_arrival_at - now) / 60000),
  );
  const overdue = journey.status !== "active";

  return (
    <section className="trip trip-live" aria-labelledby="trip-live-h">
      <header className="trip-head">
        <div>
          <h2 id="trip-live-h">Safety map</h2>
          <p>To {journey.destination}</p>
        </div>
        <button
          type="button"
          className={`locate-pill${watching ? " locate-pill-on" : ""}`}
          aria-pressed={watching}
          onClick={() => {
            setLocError(null);
            setWatching((w) => !w);
          }}
        >
          <Icon name="locate" width={18} height={18} />
          {watching ? "Showing you" : "Show my location"}
        </button>
      </header>
      {locError && (
        <div className="form-error" role="alert">
          {locError}
        </div>
      )}

      <div className="trip-map">
        <LeafletMap
          tileUrl={tileUrl}
          hotspots={hotspots}
          pins={false}
          places={pins}
          routes={
            saved
              ? [{ id: "live", line: saved.route.geometry, active: true }]
              : []
          }
          markers={[
            ...(saved
              ? [
                  {
                    lat: saved.from.lat,
                    lon: saved.from.lon,
                    kind: "from" as const,
                  },
                  { lat: saved.to.lat, lon: saved.to.lon, kind: "to" as const },
                ]
              : []),
            ...(me ? [{ ...me, kind: "me" as const }] : []),
          ]}
          focus={
            !saved && me
              ? { lat: me.lat, lon: me.lon, zoom: 15, nonce: 1 }
              : null
          }
          fitRoutes
        />
      </div>

      <dl className="trip-stats">
        <div>
          <Icon name="clock" width={20} height={20} />
          <dt>ETA</dt>
          <dd>{overdue ? "Due" : `${left} min`}</dd>
          <small>by {clock(journey.expected_arrival_at)}</small>
        </div>
        <div>
          <Icon name="route" width={20} height={20} />
          <dt>Distance</dt>
          <dd>
            {saved ? `${(saved.route.distance_m / 1000).toFixed(1)} km` : "—"}
          </dd>
        </div>
        <div>
          <Icon name="shield" width={20} height={20} />
          <dt>Status</dt>
          <dd className={overdue ? "low" : "ok"}>
            {journey.status === "active" ? "On track" : "Check in"}
          </dd>
        </div>
      </dl>
      {!saved && (
        <p className="field-hint">
          The route line isn’t kept after the browser tab is closed. Your
          journey, ETA and sharing still work.
        </p>
      )}

      <ShareJourney
        journeyId={journey.id}
        contactNames={ctx.contactNames}
        routeSummary={saved?.summary}
      />

      {anchor && (
        <>
          <h3 className="trip-subhead">
            Nearby safe places{" "}
            <Link className="text-link view-all" href="/map">
              View all
            </Link>
          </h3>
          <div className="tile-row">
            {TILES.map((t) => {
              const n = services.find((s) => s.category === t.id);
              return (
                <div key={t.id} className="tile">
                  <span className={`tile-icon tile-${t.id}`}>
                    <Icon name={t.icon} width={20} height={20} />
                  </span>
                  <strong>{t.label}</strong>
                  <small>{n ? formatDistance(n.distance_m) : "None"}</small>
                </div>
              );
            })}
          </div>
          <p className="field-hint">
            Within 3 km of {me ? "you" : "your destination"}. Police and
            hospitals are from OpenStreetMap; women help desks and safe zones
            are synthetic demo records.
          </p>
        </>
      )}

      <Link className="sos-strip" href="/dashboard#sos">
        <span className="sos-strip-disc">SOS</span>
        <span>
          <strong>Emergency SOS</strong>
          <small>
            Alerts your trusted contacts. Or call {emergencyNumber}.
          </small>
        </span>
        <Icon name="arrow" width={20} height={20} />
      </Link>
    </section>
  );
}
