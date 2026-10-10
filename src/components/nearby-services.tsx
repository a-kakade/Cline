"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  fetchNearby,
  formatDistance,
  telHref,
  type Point,
} from "@/lib/map-client";
import {
  CATEGORIES,
  CATEGORY_BY_ID,
  type Place,
  type PlaceCategoryId,
  type PlacesResult,
  type SourceStatus,
} from "@/lib/places-types";
import { Icon } from "@/components/icon";

const DEFAULT_CATEGORIES: PlaceCategoryId[] = [
  "police",
  "hospital",
  "pharmacy",
  "safe_haven",
];
const RADIUS_CHOICES = [500, 1000, 2000, 5000];

const ERROR_TEXT: Record<string, string> = {
  PROVIDER_TIMEOUT: "the map data service was too slow",
  PROVIDER_RATE_LIMITED: "the map data service is rate-limiting requests",
  PROVIDER_ERROR: "the map data service reported an error",
  PROVIDER_INVALID: "the map data service sent an unreadable reply",
  PROVIDER_UNAVAILABLE: "the map data service can’t be reached",
};

function sourceMessage(s: SourceStatus) {
  const label = CATEGORY_BY_ID[s.category].label;
  const when = s.fetched_at
    ? new Date(s.fetched_at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  if (s.status === "failed")
    return `${label}: couldn’t load — ${ERROR_TEXT[s.error ?? ""] ?? "unavailable"}. Nothing is shown for this category, which does not mean none exist.`;
  if (s.status === "stale")
    return `${label}: showing older data from ${when} because ${ERROR_TEXT[s.error ?? ""] ?? "the service"} is unavailable.`;
  if (s.status === "cached") return `${label}: saved copy from ${when}.`;
  return `${label}: loaded${s.truncated ? " (results may be incomplete — try a smaller radius)" : ""}.`;
}

export function PlaceCard({ place }: { place: Place }) {
  const tel = telHref(place.phone);
  const info = CATEGORY_BY_ID[place.category];
  return (
    <li className="place-card">
      <div className="place-card-head">
        <h3>{place.name ?? `Unnamed (${info.label.toLowerCase()})`}</h3>
        <span className="pill">{formatDistance(place.distance_m)}</span>
      </div>
      <p className="place-source">
        {place.source === "sakhi_safe_haven" && (
          <strong>Verified Safe Haven · </strong>
        )}
        {place.source === "demo" && <strong>DEMO — not a real place · </strong>}
        {info.label} ·{" "}
        {place.source === "osm"
          ? "mapped by OpenStreetMap contributors (not verified by SAKHI)"
          : place.verification_note}
      </p>
      <dl className="place-details">
        <div>
          <dt>Address</dt>
          <dd>{place.address ?? "Not mapped"}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{place.phone ?? "Not mapped"}</dd>
        </div>
        <div>
          <dt>Hours</dt>
          <dd>{place.opening_hours ?? "Not mapped"}</dd>
        </div>
        <div>
          <dt>Last confirmed</dt>
          <dd>{place.last_confirmed ?? "Unknown"}</dd>
        </div>
      </dl>
      <div className="place-actions">
        {tel && (
          <a className="button button-secondary" href={tel}>
            <Icon name="phone" /> Call
          </a>
        )}
        <a
          className="button button-secondary"
          href={`geo:${place.lat},${place.lon}?q=${place.lat},${place.lon}`}
        >
          Open in maps app
        </a>
        <a
          className="text-link"
          href={`https://www.openstreetmap.org/directions?to=${place.lat}%2C${place.lon}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Directions (OpenStreetMap)
        </a>
        {place.source_url && (
          <a
            className="text-link"
            href={place.source_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            See or fix this entry
          </a>
        )}
      </div>
    </li>
  );
}

export function NearbyServices({
  point,
  emergencyNumber,
  includeDemo = false,
  onPlaces,
}: {
  point: Point | null;
  emergencyNumber: string;
  includeDemo?: boolean;
  onPlaces?: (places: Place[]) => void;
}) {
  const [categories, setCategories] =
    useState<PlaceCategoryId[]>(DEFAULT_CATEGORIES);
  const [radius, setRadius] = useState(2000);
  const [result, setResult] = useState<PlacesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const latest = useRef(0);
  const report = useRef(onPlaces);
  useEffect(() => {
    report.current = onPlaces;
  });

  const lat = point?.lat;
  const lon = point?.lon;
  useEffect(() => {
    if (lat === undefined || lon === undefined || !categories.length) return;
    const id = ++latest.current;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetchNearby({ lat, lon }, categories, radius, includeDemo)
        .then((data) => {
          if (id !== latest.current) return;
          setResult(data);
          report.current?.(data.places);
        })
        .catch((cause: unknown) => {
          if (id !== latest.current) return;
          setError(
            cause instanceof ApiError
              ? cause
              : new ApiError("Nearby places couldn’t be loaded."),
          );
          setResult(null);
          report.current?.([]);
        })
        .finally(() => {
          if (id === latest.current) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [lat, lon, categories, radius, includeDemo, reloadKey]);

  function toggle(id: PlaceCategoryId) {
    setCategories((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  }
  const anyFailed = result?.sources.some(
    (s) => s.status === "failed" || s.status === "stale",
  );

  return (
    <section className="nearby" aria-labelledby="nearby-heading">
      <h2 id="nearby-heading">Nearby help</h2>
      <p className="nearby-call">
        <a className="button button-danger" href={`tel:${emergencyNumber}`}>
          <Icon name="phone" /> In danger now? Call {emergencyNumber}
        </a>
      </p>
      <fieldset className="field category-chips">
        <legend className="journey-legend">What are you looking for?</legend>
        {CATEGORIES.map((c) => (
          <label
            key={c.id}
            className={`chip${categories.includes(c.id) ? " chip-on" : ""}`}
          >
            <input
              type="checkbox"
              checked={categories.includes(c.id)}
              onChange={() => toggle(c.id)}
            />
            {c.label}
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor="nearby-radius">Search within</label>
        <select
          id="nearby-radius"
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
        >
          {RADIUS_CHOICES.map((r) => (
            <option key={r} value={r}>
              {formatDistance(r)}
            </option>
          ))}
        </select>
      </div>

      {!point && (
        <p className="contacts-empty">
          Choose where to search above to see nearby help.
        </p>
      )}
      {point && !categories.length && <p>Select at least one category.</p>}
      {loading && (
        <p role="status" className="contacts-loading">
          Looking nearby…
        </p>
      )}
      {error && (
        <div className="form-error" role="alert">
          <p>{error.message}</p>
          <p>Emergency calling above still works.</p>
          <button
            type="button"
            className="text-button"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {result && !loading && (
        <>
          {anyFailed && (
            <div className="journey-warning" role="note">
              <strong>Some map data couldn’t be refreshed.</strong> Missing
              categories below are unavailable, not empty.
            </div>
          )}
          {result.places.length === 0 ? (
            <p role="status" className="contacts-empty">
              Nothing found within {formatDistance(result.query.radius_m)} in
              the data we could load. That does not mean no help exists — try a
              larger radius or call {emergencyNumber}.
            </p>
          ) : (
            <ul
              className="place-list"
              aria-label="Nearby places, nearest first"
            >
              {result.places.map((p) => (
                <PlaceCard key={p.id} place={p} />
              ))}
            </ul>
          )}
          <details className="nearby-sources">
            <summary>Where this comes from</summary>
            <ul>
              {result.sources.map((s) => (
                <li key={s.category}>{sourceMessage(s)}</li>
              ))}
            </ul>
            <ul>
              {result.query.categories.map((id) => (
                <li key={id}>
                  <strong>{CATEGORY_BY_ID[id].label}:</strong>{" "}
                  {CATEGORY_BY_ID[id].caveat}
                </li>
              ))}
            </ul>
            <p className="field-hint">
              {result.attribution}. Your exact position is not sent to the map
              data service; a ~1 km grid point is.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
