"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api-client";
import { haversineMeters } from "@/lib/geo";
import type { Hotspot } from "@/lib/hotspots";
import { compareRoutes, formatDistance, telHref } from "@/lib/map-client";
import type { Service, ServiceCategory } from "@/lib/services";
import { Icon } from "@/components/icon";
import type { MapFocus } from "@/components/leaflet-map";
import { Stars } from "@/components/stars";

const LeafletMap = dynamic(() => import("@/components/leaflet-map"), {
  ssr: false,
  loading: () => (
    <p role="status" className="contacts-loading">
      Loading map…
    </p>
  ),
});

type Trip = { to: Service; km: number; min: number; line: [number, number][] };
const ICON = {
  police: "shield",
  hospital: "hospital",
  transit: "train",
  pharmacy: "hospital",
  women_help: "heart",
  safe_zone: "shield",
} as const;
const KIND: Record<ServiceCategory, string> = {
  police: "Police station",
  hospital: "Hospital",
  transit: "Metro / rail station",
  pharmacy: "24h pharmacy",
  women_help: "Women help desk",
  safe_zone: "Safe zone",
};
const EMERGENCY: ServiceCategory[] = ["police", "hospital"];
const SAFE: ServiceCategory[] = [
  "safe_zone",
  "women_help",
  "transit",
  "pharmacy",
];
const TILES: { id: ServiceCategory; label: string }[] = [
  { id: "police", label: "Police" },
  { id: "hospital", label: "Hospital" },
  { id: "women_help", label: "Women help" },
  { id: "safe_zone", label: "Safe zone" },
];
const MAX_KM = 12;

export function MapExplorer({
  tileUrl,
  emergencyNumber,
  hotspots,
}: {
  tileUrl: string;
  emergencyNumber: string;
  hotspots: Hotspot[];
}) {
  const cities = useMemo(
    () => [...new Set(hotspots.map((h) => h.city))],
    [hotspots],
  );
  const [city, setCity] = useState(cities[0]);
  const [selectedId, setSelectedId] = useState(
    hotspots.find((h) => h.city === cities[0])?.id ?? hotspots[0].id,
  );
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [tripBusy, setTripBusy] = useState<string | null>(null);
  const [tripError, setTripError] = useState<string | null>(null);
  const [locStatus, setLocStatus] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState(3);
  const [byArea, setByArea] = useState<Record<string, Service[]>>({});
  const [svcError, setSvcError] = useState<string | null>(null);
  const [svcRetry, setSvcRetry] = useState(0);
  const nonce = useRef(0);

  const selected = hotspots.find((h) => h.id === selectedId) ?? hotspots[0];
  const cityHotspots = useMemo(
    () => hotspots.filter((h) => h.city === city),
    [hotspots, city],
  );

  function fly(h: Hotspot, zoom = 14) {
    setFocus({ lat: h.lat, lon: h.lon, zoom, nonce: ++nonce.current });
  }
  function choose(id: string, zoom = 13) {
    const h = hotspots.find((x) => x.id === id);
    if (!h) return;
    setSelectedId(id);
    setCity(h.city);
    setTrip(null);
    setTripError(null);
    fly(h, zoom);
  }
  function chooseCity(name: string) {
    const first = hotspots.find((h) => h.city === name);
    if (first) choose(first.id, 11);
  }

  // Start centred on the first city.
  useEffect(() => {
    const h = hotspots.find((x) => x.id === selectedId);
    if (h)
      setFocus({ lat: h.lat, lon: h.lon, zoom: 11, nonce: ++nonce.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { lat, lon } = selected;
  const loaded = byArea[selected.id];

  // Real and demo services for the selected area, fetched once up to the maximum
  // radius; the slider then filters them instantly.
  useEffect(() => {
    if (byArea[selected.id]) return;
    let active = true;
    apiRequest<{ services: Service[] }>(
      `/api/services/nearby?lat=${lat}&lon=${lon}&radius_m=${MAX_KM * 1000}`,
    )
      .then((d) => {
        if (!active) return;
        setByArea((m) => ({ ...m, [selected.id]: d.services }));
        setSvcError(null);
      })
      .catch((c: unknown) => {
        if (active)
          setSvcError(
            c instanceof ApiError ? c.message : "Nearby help couldn’t load.",
          );
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.id, svcRetry]);

  const within = useMemo(
    () => (loaded ?? []).filter((p) => p.distance_m <= radiusKm * 1000),
    [loaded, radiusKm],
  );
  const emergency = within.filter((p) => EMERGENCY.includes(p.category));
  const safeZones = within.filter((p) => SAFE.includes(p.category));
  const nearestOf = (c: ServiceCategory) =>
    within.find((p) => p.category === c) ?? null;

  async function route(to: Service) {
    setTripBusy(to.id);
    setTripError(null);
    try {
      const r = (
        await compareRoutes({ lat, lon }, { lat: to.lat, lon: to.lon }, false)
      ).routes[0];
      setTrip({
        to,
        km: r.distance_m / 1000,
        min: Math.max(1, Math.round(r.duration_s / 60)),
        line: r.geometry,
      });
    } catch (c) {
      setTripError(
        c instanceof ApiError ? c.message : "Route couldn’t be found.",
      );
    } finally {
      setTripBusy(null);
    }
  }

  function locate() {
    if (!navigator.geolocation) {
      setLocStatus(
        "Location isn’t available in this browser. Pick a city instead.",
      );
      return;
    }
    setLocStatus("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const me = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const near = hotspots
          .map((h) => ({ h, d: haversineMeters(me, h) }))
          .sort((a, b) => a.d - b.d)[0];
        choose(near.h.id, 13);
        setLocStatus(
          near.d < 30_000
            ? `Showing the hotspot nearest to you: ${near.h.name}.`
            : `No demo hotspots near you yet. Showing ${near.h.name}, ${near.h.city}.`,
        );
      },
      () => setLocStatus("Location wasn’t shared. Pick a city instead."),
      { timeout: 7000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="safemap">
      <div className="safemap-stage">
        <LeafletMap
          tileUrl={tileUrl}
          hotspots={hotspots}
          selectedId={selected.id}
          places={within}
          routes={trip ? [{ id: "trip", line: trip.line, active: true }] : []}
          fitRoutes
          radius={{ lat, lon, m: radiusKm * 1000 }}
          focus={focus}
          onSelect={(id) => choose(id, 13)}
        />
        <div className="safemap-top">
          <div className="city-chips" role="tablist" aria-label="City">
            {cities.map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={c === city}
                className={`city-chip${c === city ? " city-chip-on" : ""}`}
                onClick={() => chooseCity(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="locate-button"
            onClick={locate}
            aria-label="Use my location"
            title="Use my location"
          >
            <Icon name="locate" width={20} height={20} />
          </button>
        </div>
        <div className="safemap-legend" aria-hidden="true">
          <span>Safer</span>
          <i />
          <span>More concern</span>
        </div>
      </div>

      <aside className="safemap-sheet" aria-label="Selected area">
        {locStatus && (
          <p role="status" className="field-hint">
            {locStatus}
          </p>
        )}
        <div className="area-head">
          <div>
            <p className="eyebrow">{selected.city.toUpperCase()} · DEMO DATA</p>
            <h2>{selected.name}</h2>
          </div>
          <div className="area-score">
            <span className={`score-badge score-${selected.tone}`}>
              {selected.rating.toFixed(1)}
            </span>
            <Stars value={selected.rating} tone={selected.tone} size={16} />
            <span className={`score-label score-label-${selected.tone}`}>
              {selected.label}
            </span>
          </div>
        </div>
        <p className="area-desc">{selected.description}</p>
        <p className="field-hint">
          From {selected.chat_count} area-room messages and {selected.reports}{" "}
          demo records. Synthetic, for demonstration.
        </p>
        <Link
          className="button button-secondary area-room-link"
          href={`/rooms?area=${selected.id}`}
        >
          <Icon name="chat" width={18} height={18} /> Open {selected.name} room
        </Link>

        <div className="area-picker" aria-label={`Areas in ${city}`}>
          {cityHotspots.map((h) => (
            <button
              key={h.id}
              type="button"
              className={`area-pick${h.id === selected.id ? " area-pick-on" : ""}`}
              aria-pressed={h.id === selected.id}
              onClick={() => choose(h.id, 13)}
            >
              <span className={`dot dot-${h.tone}`} />
              {h.name}
              <b>{h.rating.toFixed(1)}</b>
            </button>
          ))}
        </div>

        <div className="radius-card">
          <div className="radius-head">
            <label htmlFor="radius">Search distance</label>
            <strong>{radiusKm} km</strong>
          </div>
          <input
            id="radius"
            type="range"
            min={0.5}
            max={MAX_KM}
            step={0.5}
            value={radiusKm}
            onChange={(e) => setRadiusKm(Number(e.target.value))}
            aria-valuetext={`${radiusKm} kilometres`}
          />
          <div className="radius-scale" aria-hidden="true">
            <span>500 m</span>
            <span>{MAX_KM} km</span>
          </div>
        </div>

        <div className="tile-row" aria-label="Nearest help by kind">
          {TILES.map((t) => {
            const n = nearestOf(t.id);
            return (
              <div key={t.id} className="tile">
                <span className={`tile-icon tile-${t.id}`}>
                  <Icon name={ICON[t.id]} width={20} height={20} />
                </span>
                <strong>{t.label}</strong>
                <small>{n ? formatDistance(n.distance_m) : "None"}</small>
              </div>
            );
          })}
        </div>

        {trip && (
          <div className="trip-bar" role="status">
            <Icon name="route" width={20} height={20} />
            <span>
              <strong>{trip.min} min</strong> · {trip.km.toFixed(1)} km to{" "}
              {trip.to.name}
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() => setTrip(null)}
            >
              Clear
            </button>
          </div>
        )}
        {tripError && (
          <div className="form-error" role="alert">
            {tripError}
          </div>
        )}
        {svcError && (
          <div className="form-error" role="alert">
            {svcError}{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => setSvcRetry((k) => k + 1)}
            >
              Try again
            </button>
          </div>
        )}

        <h3 className="sheet-heading">
          Safe zones nearby{loaded ? ` (${safeZones.length})` : ""}
        </h3>
        {!loaded && !svcError ? (
          <p role="status" className="contacts-loading">
            Looking nearby…
          </p>
        ) : safeZones.length ? (
          <ul className="zone-strip">
            {safeZones.map((p) => (
              <li key={p.id} className="zone-card">
                <Icon name={ICON[p.category]} width={20} height={20} />
                <strong>{p.name}</strong>
                <span>
                  {KIND[p.category]} · {formatDistance(p.distance_m)}
                </span>
                {p.hours && <span>{p.hours}</span>}
                {p.synthetic && <em className="demo-tag">DEMO</em>}
                <button
                  type="button"
                  className="text-button"
                  disabled={tripBusy === p.id}
                  onClick={() => void route(p)}
                >
                  {tripBusy === p.id ? "Routing…" : "Route"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="contacts-empty">
            No safe zones within {radiusKm} km. Slide the distance up.
          </p>
        )}

        <h3 className="sheet-heading">
          Emergency services nearby{loaded ? ` (${emergency.length})` : ""}
        </h3>
        {loaded && emergency.length === 0 && (
          <p className="contacts-empty">
            None within {radiusKm} km. Slide the distance up or call{" "}
            {emergencyNumber}.
          </p>
        )}
        <ul className="svc-list">
          {emergency.map((p) => {
            const tel = telHref(p.phone);
            return (
              <li key={p.id} className="svc-row">
                <span className={`svc-icon svc-${p.category}`}>
                  <Icon name={ICON[p.category]} width={20} height={20} />
                </span>
                <span className="svc-text">
                  <strong>{p.name}</strong>
                  <small>
                    {KIND[p.category]} · {formatDistance(p.distance_m)}
                  </small>
                </span>
                <span className="svc-actions">
                  <button
                    type="button"
                    className="button button-secondary svc-btn"
                    disabled={tripBusy === p.id}
                    onClick={() => void route(p)}
                  >
                    {tripBusy === p.id ? "…" : "Route"}
                  </button>
                  {tel && (
                    <a
                      className="button button-secondary svc-btn"
                      href={tel}
                      aria-label={`Call ${p.name}`}
                    >
                      <Icon name="phone" width={16} height={16} />
                    </a>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <a
          className="button button-danger sheet-call"
          href={`tel:${emergencyNumber}`}
        >
          <Icon name="phone" /> In danger now? Call {emergencyNumber}
        </a>
        <p className="field-hint">
          Police, hospitals, stations and pharmacies are from OpenStreetMap
          contributors (not verified by Sakhi). Women help desks and safe zones
          are synthetic demo records. Routes come from OSRM and follow roads.
        </p>
      </aside>
    </div>
  );
}
