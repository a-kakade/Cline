"use client";

import { useRef, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api-client";
import { submitReport, type Point } from "@/lib/map-client";
import { HAZARD_CATEGORIES, INCIDENT_CATEGORIES } from "@/lib/safety-types";

const pretty = (s: string) =>
  s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function ReportForm({
  point,
  onSubmitted,
}: {
  point: Point | null;
  onSubmitted: () => void;
}) {
  const [kind, setKind] = useState<"incident" | "infrastructure_hazard">(
    "infrastructure_hazard",
  );
  const [category, setCategory] = useState<string>(HAZARD_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const key = useRef<string | null>(null);
  const categories =
    kind === "incident" ? INCIDENT_CATEGORIES : HAZARD_CATEGORIES;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!point || pending) return;
    setPending(true);
    setMessage(null);
    try {
      key.current ??= crypto.randomUUID();
      await submitReport({
        idempotency_key: key.current,
        kind,
        category,
        description: description.trim() || undefined,
        lat: point.lat,
        lon: point.lon,
        consent: true,
      });
      key.current = null;
      setDescription("");
      setConsent(false);
      setMessage({
        ok: true,
        text: "Report saved as unverified. It shows on the map with that label.",
      });
      onSubmitted();
    } catch (cause) {
      setMessage({
        ok: false,
        text:
          cause instanceof ApiError
            ? cause.message
            : "The report couldn’t be saved.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="journey-card" aria-labelledby="report-heading">
      <h2 id="report-heading">Report a concern here</h2>
      <p className="field-hint">
        This is not an emergency channel. If someone is in danger, call 112.
        Reports are unverified, shown with an approximate position (about 100
        m), and your identity is never shown to others.
      </p>
      {!point ? (
        <p>Choose a place first.</p>
      ) : (
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="report-kind">What kind of report?</label>
            <select
              id="report-kind"
              value={kind}
              onChange={(e) => {
                const next = e.target.value as typeof kind;
                setKind(next);
                setCategory(
                  (next === "incident"
                    ? INCIDENT_CATEGORIES
                    : HAZARD_CATEGORIES)[0],
                );
                key.current = null;
              }}
            >
              <option value="infrastructure_hazard">
                Infrastructure hazard (lighting, path, road)
              </option>
              <option value="incident">
                Something that happened to me or I saw
              </option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="report-category">Category</label>
            <select
              id="report-category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                key.current = null;
              }}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {pretty(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="report-description">
              Details (optional, no names or phone numbers)
            </label>
            <input
              id="report-description"
              type="text"
              maxLength={500}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                key.current = null;
              }}
            />
          </div>
          <label className="journey-choice">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              I understand this will be visible, unverified, to other SAKHI
              users near this spot.
            </span>
          </label>
          {message && (
            <div
              className={message.ok ? "contacts-feedback" : "form-error"}
              role={message.ok ? "status" : "alert"}
            >
              {message.text}
            </div>
          )}
          <button
            className="button button-primary"
            type="submit"
            disabled={!consent || pending}
            style={{ marginTop: 14 }}
          >
            {pending ? "Saving…" : "Submit report"}
          </button>
        </form>
      )}
    </section>
  );
}
