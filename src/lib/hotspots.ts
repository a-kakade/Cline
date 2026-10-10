// SYNTHETIC demo hotspots. Ratings come from a demo dataset plus a simple
// word-list sentiment read of the (synthetic) area-room chats. Not real incident data.
import raw from "@/data/demo-hotspots.json";

export type RawHotspot = (typeof raw)[number];
export type ChatLine = {
  alias: string;
  body: string;
  minutes_ago: number;
  sentiment: number;
};
export type Tone = "safer" | "mixed" | "caution";
export type Hotspot = {
  id: string;
  city: string;
  name: string;
  lat: number;
  lon: number;
  /** 1–5, one decimal. */
  rating: number;
  tone: Tone;
  label: string;
  /** Short description written from the room chats. */
  description: string;
  /** 0 (safest) – 1 (most concern); drives the heat colour. */
  risk: number;
  blobs: RawHotspot["blobs"];
  reports: number;
  chat_count: number;
};

const POS =
  /\b(safe|secure|well[- ]lit|lit|patrol|cctv|helpful|calm|comfortable|fine|lively|decent|fixed|better|staffed|active|crowded in a good way|no trouble|no problem|never had a problem)\b/gi;
const NEG =
  /\b(unsafe|dark|followed|following|scary|afraid|avoid|deserted|harass\w*|snatch\w*|loitering|comments?|off|broken|catcalling|drunk|scuffle|fight|nobody|circling|phone snatching|stranded|refuse|complaints?|suspicious|empty|not comfortable|do not feel safe)\b/gi;

/** −1 (worried) … +1 (reassuring). Word-list based; it is a demo, not a model. */
export function sentimentOf(text: string) {
  const p = text.match(POS)?.length ?? 0;
  const n = text.match(NEG)?.length ?? 0;
  return (p - n) / (p + n + 1);
}

const THEMES: { key: string; re: RegExp; good: string; bad: string }[] = [
  {
    key: "lighting",
    re: /\b(light|lights|lit|dark)\b/i,
    good: "well-lit streets",
    bad: "poor street lighting",
  },
  {
    key: "patrol",
    re: /\b(patrol|police|cctv|beat box)\b/i,
    good: "visible patrols and CCTV",
    bad: "little police presence",
  },
  {
    key: "following",
    re: /\b(follow\w*|loitering|comments?|harass\w*|catcalling)\b/i,
    good: "calm streets",
    bad: "harassment and being followed",
  },
  {
    key: "transport",
    re: /\b(cabs?|autos?|bus|metro|station|underpass)\b/i,
    good: "reliable late transport",
    bad: "late-night transport gaps",
  },
  {
    key: "violence",
    re: /\b(fight|scuffle|assault\w*)\b/i,
    good: "calm streets",
    bad: "scuffles after dark",
  },
  {
    key: "vehicles",
    re: /\b(suspicious vehicles?|van with)\b/i,
    good: "calm streets",
    bad: "suspicious vehicles",
  },
  {
    key: "theft",
    re: /\b(snatch\w*|theft)\b/i,
    good: "few theft worries",
    bad: "chain snatching",
  },
];

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

export function analyse(h: RawHotspot): {
  hotspot: Hotspot;
  chats: ChatLine[];
} {
  const chats: ChatLine[] = h.messages.map((m) => ({
    alias: m.alias,
    body: m.body,
    minutes_ago: m.minutes_ago,
    sentiment: sentimentOf(m.body),
  }));
  const meanSent = chats.length
    ? chats.reduce((a, c) => a + c.sentiment, 0) / chats.length
    : 0;
  const sent01 = clamp((meanSent + 0.5) / 1, 0, 1);
  const blend = 0.6 * h.data_score + 0.4 * sent01;
  const rating = Number(clamp(1 + 4 * blend, 1, 5).toFixed(1));
  const tone: Tone =
    rating >= 3.7 ? "safer" : rating >= 2.7 ? "mixed" : "caution";

  const score = (key: string, sign: 1 | -1) =>
    chats.filter(
      (c) =>
        THEMES.find((t) => t.key === key)!.re.test(c.body) &&
        Math.sign(c.sentiment) === sign,
    ).length;
  const ranked = THEMES.map((t) => ({
    t,
    good: score(t.key, 1),
    bad: score(t.key, -1),
  }));
  const topGood = [...ranked].sort((a, b) => b.good - a.good)[0];
  // Praise and worry never name the same theme, which would read as a contradiction.
  const pool =
    tone === "caution" ? ranked : ranked.filter((r) => r.t !== topGood.t);
  const topBad = [...pool].sort((a, b) => b.bad - a.bad)[0];
  const good = topGood.good ? topGood.t.good : "";
  const bad = topBad.bad ? topBad.t.bad : "";
  const description =
    tone === "safer"
      ? `Mostly calm${good ? `, people praise ${good}` : ""}${bad ? `; some mention ${bad}` : ""}.`
      : tone === "mixed"
        ? `Mixed views${good ? `: ${good} on one side` : ""}${bad ? `, ${bad} on the other` : ""}.`
        : `Residents are uneasy${bad ? ` about ${bad}` : ""}; stick to main roads after dark.`;

  return {
    chats,
    hotspot: {
      id: h.id,
      city: h.city,
      name: h.name,
      lat: h.lat,
      lon: h.lon,
      rating,
      tone,
      label:
        tone === "safer" ? "Safer" : tone === "mixed" ? "Mixed" : "Use caution",
      description,
      risk: Number(((5 - rating) / 4).toFixed(2)),
      blobs: h.blobs,
      reports: h.reports,
      chat_count: chats.length,
    },
  };
}

export const allHotspots = (): Hotspot[] =>
  raw
    .map((h) => analyse(h).hotspot)
    .sort(
      (a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name),
    );

export const hotspotChats = (id: string): ChatLine[] => {
  const h = raw.find((x) => x.id === id);
  return h ? analyse(h).chats : [];
};

export const hotspotCities = () => [...new Set(raw.map((h) => h.city))];

/** Theme colours: safer = sage green, mixed = amber, caution = brand red. */
export const TONE_COLOUR: Record<Tone, string> = {
  safer: "#4a7c59",
  mixed: "#c28a1a",
  caution: "#a42e34",
};

/** Heat colour on a green → amber → red ramp for risk 0…1. */
export function heatColour(risk: number) {
  const stops = [
    [0, [74, 124, 89]],
    [0.5, [214, 160, 40]],
    [1, [196, 52, 58]],
  ] as const;
  const r = clamp(risk, 0, 1);
  const [a, b] = r <= 0.5 ? [stops[0], stops[1]] : [stops[1], stops[2]];
  const t = (r - a[0]) / (b[0] - a[0]);
  const c = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * t));
  return `rgb(${c.join(",")})`;
}

// ---- Community feed ------------------------------------------------------
export const POST_CATEGORIES = [
  "Safety",
  "Travel",
  "Lighting",
  "Harassment",
] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];
export type FeedPost = {
  id: string;
  area_id: string;
  area: string;
  city: string;
  alias: string;
  minutes_ago: number;
  body: string;
  sentiment: number;
  category: PostCategory;
  likes: number;
  comments: number;
};

export function postCategory(body: string): PostCategory {
  if (/\b(lights?|lit|dark)\b/i.test(body)) return "Lighting";
  if (/\b(follow\w*|loitering|comments?|harass\w*|catcalling)\b/i.test(body))
    return "Harassment";
  if (
    /\b(cabs?|autos?|bus|metro|station|underpass|transport|route)\b/i.test(body)
  )
    return "Travel";
  return "Safety";
}

const hash = (s: string) => {
  let h = 5381;
  for (const c of s) h = (h * 33) ^ c.charCodeAt(0);
  return h >>> 0;
};

export const agoLabel = (m: number) =>
  m < 60
    ? `${m}m ago`
    : m < 1440
      ? `${Math.round(m / 60)}h ago`
      : `${Math.round(m / 1440)}d ago`;

/** Every synthetic room message as a feed post, newest first. Counts are made up. */
export function allPosts(): FeedPost[] {
  return raw
    .flatMap((h) =>
      analyse(h).chats.map((c, i): FeedPost => {
        const id = `${h.id}:${i}`;
        const k = hash(id);
        return {
          id,
          area_id: h.id,
          area: h.name,
          city: h.city,
          alias: c.alias,
          minutes_ago: c.minutes_ago,
          body: c.body,
          sentiment: c.sentiment,
          category: postCategory(c.body),
          likes: 2 + (k % 47),
          comments: (k >>> 8) % 13,
        };
      }),
    )
    .sort((a, b) => a.minutes_ago - b.minutes_ago || a.id.localeCompare(b.id));
}
