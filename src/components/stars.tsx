import { TONE_COLOUR, type Tone } from "@/lib/hotspots";

/** Five stars, partially filled to `value` (0–5). */
export function Stars({
  value,
  tone,
  size = 18,
}: {
  value: number;
  tone: Tone;
  size?: number;
}) {
  return (
    <span
      className="stars"
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
      style={{ fontSize: size, ["--tone" as string]: TONE_COLOUR[tone] }}
    >
      <span className="stars-base" aria-hidden="true">
        ★★★★★
      </span>
      <span
        className="stars-fill"
        aria-hidden="true"
        style={{ width: `${(value / 5) * 100}%` }}
      >
        ★★★★★
      </span>
    </span>
  );
}
