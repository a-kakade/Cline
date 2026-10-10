"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { fetchAreaSummary, type Point } from "@/lib/map-client";
import type { AreaSignals } from "@/lib/safety-types";

const when = (ms: number | null) =>
  ms
    ? new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" })
    : "none";

export function AreaPanel({
  point,
  includeDemo,
  sinceDays,
}: {
  point: Point | null;
  includeDemo: boolean;
  sinceDays: number;
}) {
  const [data, setData] = useState<AreaSignals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lat = point?.lat;
  const lon = point?.lon;
  useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    let active = true;
    fetchAreaSummary({ lat, lon }, sinceDays, includeDemo)
      .then((d) => {
        if (active) {
          setData(d);
          setError(null);
        }
      })
      .catch((c: unknown) => {
        if (active)
          setError(
            c instanceof ApiError
              ? c.message
              : "The area summary couldn’t be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [lat, lon, sinceDays, includeDemo]);

  return (
    <section className="journey-card" aria-labelledby="area-heading">
      <h2 id="area-heading">About this area</h2>
      {!point && <p>Choose a place to see what has been reported nearby.</p>}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {data && (
        <>
          <p className="eyebrow">REPORTED-CONCERNS INDICATOR · PROTOTYPE</p>
          <h3>{data.indicator.label}</h3>
          <p>{data.indicator.explanation}</p>
          <dl className="journey-summary">
            <div>
              <dt>Verified incident reports</dt>
              <dd>
                {data.signals.verified_incidents.count} (latest{" "}
                {when(data.signals.verified_incidents.latest_at)})
              </dd>
            </div>
            <div>
              <dt>Unverified user reports</dt>
              <dd>
                {data.signals.unverified_reports.count} (latest{" "}
                {when(data.signals.unverified_reports.latest_at)})
              </dd>
            </div>
            <div>
              <dt>Infrastructure hazards</dt>
              <dd>
                {data.signals.infrastructure_hazards.count} (latest{" "}
                {when(data.signals.infrastructure_hazards.latest_at)})
              </dd>
            </div>
            <div>
              <dt>Community ratings (opinions, not incidents)</dt>
              <dd>
                {data.signals.community_ratings.status === "ok"
                  ? `${data.signals.community_ratings.average} / 5 from ${data.signals.community_ratings.count} people`
                  : data.signals.community_ratings.status === "insufficient"
                    ? `Not enough ratings yet (${data.signals.community_ratings.count})`
                    : "No ratings yet"}
              </dd>
            </div>
            <div>
              <dt>Official statistics</dt>
              <dd>Not available</dd>
            </div>
          </dl>
          <ul className="field-hint">
            {data.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <details>
            <summary>How this indicator is worked out</summary>
            <p>
              Model <code>{data.model.name}</code> — hand-set weights,{" "}
              <strong>not validated</strong>: verified incident ×
              {data.model.weights.verified_incident} (max{" "}
              {data.model.caps.verified_incident}), unverified report ×
              {data.model.weights.unverified_report} (max{" "}
              {data.model.caps.unverified_report}), infrastructure hazard ×
              {data.model.weights.infrastructure_hazard} (max{" "}
              {data.model.caps.infrastructure_hazard}). Fewer than{" "}
              {data.model.thresholds.insufficient_below} reports shows “not
              enough”; {data.model.thresholds.some_at}+ points is “some”,{" "}
              {data.model.thresholds.many_at}+ is “many”. Area: a{" "}
              {data.area.size_m} m grid cell. {data.window_days}-day window.
            </p>
            <p>{data.signals.official_statistics.note}</p>
          </details>
        </>
      )}
    </section>
  );
}
