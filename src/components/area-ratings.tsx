"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api-client";
import {
  deleteRating,
  loadRatings,
  reportRating,
  saveRating,
  type RatingSummary,
} from "@/lib/rooms-client";

const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
const aggregateText = (
  a: { average: number | null; count: number },
  min: number,
) =>
  a.average !== null
    ? `${a.average} / 5 (${a.count})`
    : `Not enough ratings yet (${a.count} of ${min})`;

export function AreaRatings({ areaId }: { areaId: string }) {
  const [data, setData] = useState<RatingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overall, setOverall] = useState(0);
  const [day, setDay] = useState("");
  const [night, setNight] = useState("");
  const [review, setReview] = useState("");
  const [pending, setPending] = useState(false);

  const fill = useCallback((d: RatingSummary) => {
    setData(d);
    setOverall(d.my_rating?.stars ?? 0);
    setDay(d.my_rating?.day_stars ? String(d.my_rating.day_stars) : "");
    setNight(d.my_rating?.night_stars ? String(d.my_rating.night_stars) : "");
    setReview(d.my_rating?.review ?? "");
  }, []);

  useEffect(() => {
    let active = true;
    loadRatings(areaId)
      .then((d) => {
        if (active) {
          fill(d);
          setError(null);
        }
      })
      .catch((c: unknown) => {
        if (active)
          setError(
            c instanceof ApiError ? c.message : "Ratings couldn’t be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [areaId, fill]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!overall || pending) return;
    setPending(true);
    setNotice(null);
    try {
      fill(
        await saveRating(areaId, {
          stars: overall,
          day_stars: day ? Number(day) : null,
          night_stars: night ? Number(night) : null,
          review: review.trim() || null,
        }),
      );
      setNotice("Your rating is saved. You can change it any time.");
    } catch (cause) {
      setNotice(
        cause instanceof ApiError
          ? cause.message
          : "Your rating couldn’t be saved.",
      );
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    setPending(true);
    try {
      fill(await deleteRating(areaId));
      setNotice("Your rating was removed.");
    } catch (cause) {
      setNotice(
        cause instanceof ApiError
          ? cause.message
          : "Your rating couldn’t be removed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="journey-card" aria-labelledby="ratings-heading">
      <h2 id="ratings-heading">How people rate this area</h2>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {!data && !error && (
        <p role="status" className="contacts-loading">
          Loading ratings…
        </p>
      )}
      {data && (
        <>
          <dl className="journey-summary">
            <div>
              <dt>Overall</dt>
              <dd>{aggregateText(data.overall, data.min_to_show)}</dd>
            </div>
            <div>
              <dt>By day</dt>
              <dd>{aggregateText(data.day, data.min_to_show)}</dd>
            </div>
            <div>
              <dt>At night</dt>
              <dd>{aggregateText(data.night, data.min_to_show)}</dd>
            </div>
            <div>
              <dt>Recent</dt>
              <dd>
                {data.count_last_90_days} in the last 90 days
                {data.latest_at
                  ? `, latest ${new Date(data.latest_at).toLocaleDateString(undefined, { dateStyle: "medium" })}`
                  : ""}
              </dd>
            </div>
          </dl>
          <p className="field-hint">{data.disclaimer}</p>

          <form onSubmit={submit} aria-label="Rate this area">
            <fieldset className="field" style={{ border: 0, padding: 0 }}>
              <legend className="journey-legend">Your overall rating</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="chip">
                  <input
                    type="radio"
                    name="overall"
                    checked={overall === n}
                    onChange={() => setOverall(n)}
                  />
                  {n} {n === 1 ? "star" : "stars"}
                </label>
              ))}
            </fieldset>
            <div className="journey-actions">
              {[
                ["By day (optional)", day, setDay, "rating-day"],
                ["At night (optional)", night, setNight, "rating-night"],
              ].map(([label, value, set, id]) => (
                <div
                  className="field"
                  key={id as string}
                  style={{ marginBottom: 0 }}
                >
                  <label htmlFor={id as string}>{label as string}</label>
                  <select
                    id={id as string}
                    value={value as string}
                    onChange={(e) =>
                      (set as (v: string) => void)(e.target.value)
                    }
                  >
                    <option value="">No opinion</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="rating-review">
                Short review (optional, no names or phone numbers)
              </label>
              <input
                id="rating-review"
                type="text"
                maxLength={280}
                value={review}
                onChange={(e) => setReview(e.target.value)}
              />
            </div>
            {notice && (
              <p role="status" className="contacts-feedback">
                {notice}
              </p>
            )}
            <div className="journey-actions">
              <button
                className="button button-primary"
                type="submit"
                disabled={!overall || pending}
              >
                {data.my_rating ? "Update my rating" : "Submit rating"}
              </button>
              {data.my_rating && (
                <button
                  className="text-button danger-text"
                  type="button"
                  disabled={pending}
                  onClick={() => void remove()}
                >
                  Remove my rating
                </button>
              )}
            </div>
          </form>

          {data.reviews.length > 0 && (
            <>
              <h3>Reviews</h3>
              <ul className="journey-history">
                {data.reviews.map((r) => (
                  <li key={r.id}>
                    <span aria-label={`${r.stars} out of 5`}>
                      {stars(r.stars)}
                    </span>{" "}
                    {r.review}
                    <br />
                    <small>
                      {r.mine ? "You" : "Another SAKHI user"} ·{" "}
                      {new Date(r.updated_at).toLocaleDateString(undefined, {
                        dateStyle: "medium",
                      })}
                      {!r.mine && (
                        <>
                          {" · "}
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              void reportRating(r.id, "abuse")
                                .then(() =>
                                  setNotice(
                                    "Reported to moderators. Thank you.",
                                  ),
                                )
                                .catch((c: unknown) =>
                                  setNotice(
                                    c instanceof ApiError
                                      ? c.message
                                      : "Couldn’t report that.",
                                  ),
                                )
                            }
                          >
                            Report
                          </button>
                        </>
                      )}
                    </small>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
