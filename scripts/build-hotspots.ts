import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseCsv } from "../src/server/demo-seed";

// Builds src/data/demo-hotspots.json: SYNTHETIC demo hotspots.
// The CSV's own coordinates are scattered around each city centre and do not follow its
// area names, so each named area is placed at an approximate real-world centre and the
// CSV rows for that area name drive its stats. Chats are generated from those stats.
// Usage: npx tsx scripts/build-hotspots.ts

const CENTRES: Record<string, [number, number]> = {
  "Bengaluru|Electronic City": [12.8452, 77.6602],
  "Bengaluru|Indiranagar": [12.9784, 77.6408],
  "Bengaluru|Koramangala": [12.9352, 77.6245],
  "Bengaluru|Whitefield": [12.9698, 77.75],
  "Bengaluru|Yelahanka": [13.1007, 77.5963],
  "Bhopal|Arera Colony": [23.212, 77.433],
  "Bhopal|Habibganj": [23.229, 77.438],
  "Bhopal|Kolar": [23.17, 77.414],
  "Bhopal|MP Nagar": [23.233, 77.434],
  "Bhopal|TT Nagar": [23.233, 77.399],
  "Chennai|Adyar": [13.0012, 80.2565],
  "Chennai|Anna Nagar": [13.085, 80.2101],
  "Chennai|T Nagar": [13.0418, 80.2341],
  "Chennai|Tambaram": [12.9249, 80.1],
  "Chennai|Velachery": [12.9815, 80.218],
  "Delhi|Dwarka": [28.5921, 77.046],
  "Delhi|Karol Bagh": [28.6519, 77.1909],
  "Delhi|Lajpat Nagar": [28.5677, 77.2433],
  "Delhi|Rohini": [28.7495, 77.0565],
  "Delhi|Saket": [28.5245, 77.2066],
  "Hyderabad|Banjara Hills": [17.4156, 78.4347],
  "Hyderabad|Gachibowli": [17.4401, 78.3489],
  "Hyderabad|Kukatpally": [17.4948, 78.3996],
  "Hyderabad|Madhapur": [17.4486, 78.3908],
  "Hyderabad|Secunderabad": [17.4399, 78.4983],
  "Jaipur|Amer": [26.9855, 75.8513],
  "Jaipur|C Scheme": [26.9118, 75.801],
  "Jaipur|Malviya Nagar": [26.853, 75.82],
  "Jaipur|Mansarovar": [26.849, 75.765],
  "Jaipur|Vaishali Nagar": [26.911, 75.727],
  "Kolkata|Dum Dum": [22.6226, 88.393],
  "Kolkata|Garia": [22.464, 88.3844],
  "Kolkata|Howrah": [22.5958, 88.2636],
  "Kolkata|Park Street": [22.5535, 88.352],
  "Kolkata|Salt Lake": [22.58, 88.415],
  "Lucknow|Aliganj": [26.8923, 80.9373],
  "Lucknow|Chowk": [26.869, 80.912],
  "Lucknow|Gomti Nagar": [26.8564, 81.005],
  "Lucknow|Hazratganj": [26.8467, 80.9462],
  "Lucknow|Indira Nagar": [26.876, 80.991],
  "Mumbai|Andheri": [19.1197, 72.8464],
  "Mumbai|Bandra": [19.0596, 72.8295],
  "Mumbai|Dadar": [19.0178, 72.8478],
  "Mumbai|Kurla": [19.0726, 72.8845],
  "Mumbai|Powai": [19.1176, 72.906],
  "Patna|Boring Road": [25.611, 85.121],
  "Patna|Danapur": [25.628, 85.041],
  "Patna|Kankarbagh": [25.588, 85.162],
  "Patna|Patliputra": [25.624, 85.099],
  "Patna|Rajendra Nagar": [25.61, 85.17],
};

// Small deterministic PRNG so the output is stable between runs.
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const THEME_OF: Record<string, string> = {
  Harassment: "street harassment",
  "Verbal Abuse": "catcalling and verbal abuse",
  Stalking: "being followed",
  "Chain Snatching": "chain snatching",
  Assault: "scuffles after dark",
  "Unsafe Transport": "late-night autos and cabs",
  "Night Safety Complaint": "the stretch after dark",
  Kidnapping: "suspicious vehicles",
  "Cyber Crime": "",
  "Domestic Violence": "",
};

const POSITIVE = [
  "Walked home from {a} metro around 9pm, well lit and plenty of people about. Felt completely fine.",
  "Police patrol van passes by {a} market every evening, you can see them. Makes a real difference.",
  "CCTV has been put up at the main crossing in {a}, and the shopkeepers keep an eye out too.",
  "Honestly {a} is one of the calmer parts of the city to walk around after work. Lively and busy till late.",
  "Street lights on the main road in {a} were fixed last month, so much better now.",
  "Auto stand near {a} is staffed till late and the drivers are decent. Never had a problem.",
  "Women-only compartment and the guard at the {a} station are very helpful, feels secure.",
  "My daughter commutes through {a} daily and has not faced any trouble in a year. Crowded in a good way.",
  "The 24x7 pharmacy and tea stall at {a} keep the corner active at night, feels comfortable.",
];
const NEUTRAL = [
  "Is the {a} footpath near the market still being dug up? Planning to walk tomorrow evening.",
  "Anyone know when the last bus from {a} leaves? Trying to plan my route back.",
  "Okay in the daytime but I would not call {a} lively after 10pm. Depends which lane you take.",
  "Mostly fine in {a}, just stay on the main road and keep your phone charged.",
  "Crowded near {a} at rush hour, keep your bag in front. Otherwise nothing unusual.",
  "New to {a}. Which lanes do you all use to get to the main road?",
];
// Each worry is tied to the dataset crime types it fits, so an area's chats echo its data.
const NEGATIVE: [string[], string][] = [
  [
    ["Night Safety Complaint"],
    "Street lights near the {a} market lane have been off for a week again. It is really dark, I avoid it after 8.",
  ],
  [
    ["Night Safety Complaint"],
    "The underpass near {a} is broken and dark. A woman was harassed there last week, please avoid.",
  ],
  [
    ["Night Safety Complaint", "Kidnapping"],
    "Please avoid the lane behind the {a} market at night, deserted and no lights.",
  ],
  [
    ["Stalking"],
    "Someone was following me from the {a} bus stop yesterday, scary. Stay alert around there.",
  ],
  [
    ["Stalking"],
    "A man followed me for three streets in {a} last night until I reached a shop. Be careful walking alone.",
  ],
  [
    ["Chain Snatching"],
    "Two chain snatching attempts near {a} this month. Be careful with jewellery on bikes passing by.",
  ],
  [
    ["Chain Snatching"],
    "Phone snatching on a bike near the {a} signal again today. Keep your bag on the inside.",
  ],
  [
    ["Harassment", "Verbal Abuse"],
    "Men loitering near the {a} auto stand and passing comments. Not comfortable walking alone there.",
  ],
  [
    ["Harassment", "Verbal Abuse"],
    "Catcalling outside the {a} college gate every evening. Nobody steps in, I do not feel safe there.",
  ],
  [
    ["Unsafe Transport"],
    "Cabs refuse rides from {a} after 10pm or ask for double. Felt stranded and afraid yesterday.",
  ],
  [
    ["Unsafe Transport"],
    "The last shared auto from {a} was empty except for two drunk men, I got off. Late transport is a real problem.",
  ],
  [
    ["Assault"],
    "A fight broke out near the {a} bus stop last night and nobody called anyone. Scary to walk past after dark.",
  ],
  [
    ["Kidnapping"],
    "A van with covered windows kept circling the {a} lane yesterday. Suspicious vehicles, so tell your kids.",
  ],
  [
    [],
    "No patrol visible in {a} for days, the beat box is always empty. Unsafe at night.",
  ],
];

const ALIASES = ["a3f9c1", "7be204", "c01d58", "e9a7b3", "42ff06", "d8c31a"];

const fill = (t: string, a: string, x: string) =>
  t.replace(/\{a\}/g, a).replace("{x}", x);

const rows = parseCsv(
  readFileSync("Woman_Safety_Dataset_Management.csv", "utf8"),
);
const groups = new Map<string, Record<string, string>[]>();
for (const r of rows) {
  const k = `${r.city}|${r.area}`;
  groups.set(k, [...(groups.get(k) ?? []), r]);
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const stats = [...groups].map(([key, v]) => {
  const [city, name] = key.split("|");
  const centre = CENTRES[key];
  if (!centre) throw new Error(`No coordinates for ${key}`);
  const safety = mean(v.map((r) => Number(r.safety_score)));
  const highShare =
    v.filter((r) => r.risk_level === "High" || r.risk_level === "Critical")
      .length / v.length;
  const lighting = mean(v.map((r) => Number(r.lighting_score)));
  const police = mean(v.map((r) => Number(r.police_station_distance_km)));
  const night =
    v.filter((r) => r.time_of_day === "Night" || r.time_of_day === "Evening")
      .length / v.length;
  const crimes = new Map<string, number>();
  for (const r of v)
    crimes.set(r.crime_type, (crimes.get(r.crime_type) ?? 0) + 1);
  const topCrimes = [...crimes]
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c)
    .filter((c) => THEME_OF[c]);
  return {
    key,
    city,
    name,
    centre,
    safety,
    highShare,
    lighting,
    police,
    night,
    topCrimes,
    n: v.length,
  };
});

// Min–max normalise each factor across areas so differences between areas are visible.
const norm = (f: (s: (typeof stats)[number]) => number, invert = false) => {
  const xs = stats.map(f);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return (s: (typeof stats)[number]) =>
    (invert ? hi - f(s) : f(s) - lo) / (hi - lo || 1);
};
const nSafety = norm((s) => s.safety);
const nHigh = norm((s) => s.highShare, true);
const nLight = norm((s) => s.lighting);
const nPolice = norm((s) => s.police, true);
const nNight = norm((s) => s.night, true);

const hotspots = stats.map((s) => {
  const r = rng(s.key);
  const dataScore = Number(
    (
      0.3 * nSafety(s) +
      0.3 * nHigh(s) +
      0.2 * nLight(s) +
      0.1 * nPolice(s) +
      0.1 * nNight(s)
    ).toFixed(3),
  );
  // Chat tone follows the data score so the chats and the numbers tell one story.
  const tier =
    dataScore >= 0.62 ? "safe" : dataScore >= 0.38 ? "mixed" : "unsafe";
  const mix = {
    safe: [6, 2, 1],
    mixed: [3, 3, 3],
    unsafe: [1, 2, 6],
  }[tier];
  const bag: string[] = [];
  const take = (pool: string[], n: number) => {
    const copy = [...pool].sort(() => r() - 0.5);
    for (let i = 0; i < n; i++)
      bag.push(fill(copy[i % copy.length], s.name, ""));
  };
  take(POSITIVE, mix[0]);
  take(NEUTRAL, mix[1]);
  // Worries that match this area's most common crime types come first.
  const rank = (crimes: string[]) =>
    crimes.length
      ? Math.min(
          ...crimes.map((c) => {
            const i = s.topCrimes.indexOf(c);
            return i < 0 ? 9 : i;
          }),
        )
      : 8;
  const worries = [...NEGATIVE]
    .map((w) => ({ w, k: rank(w[0]) + r() * 0.5 }))
    .sort((a, b) => a.k - b.k)
    .slice(0, mix[2])
    .map(({ w }) => fill(w[1], s.name, ""));
  bag.push(...worries);
  bag.sort(() => r() - 0.5);
  let minutes = 18;
  const messages = bag.map((body, i) => {
    minutes += Math.round(25 + r() * 240);
    return {
      alias: `Member ${ALIASES[(i * 7 + Math.floor(r() * 3)) % ALIASES.length]}`,
      minutes_ago: minutes,
      body,
    };
  });
  messages.reverse(); // oldest first
  // A soft cluster of heat blobs around the centre (offsets in metres).
  const blobs = [{ dx: 0, dy: 0, radius: 700 + Math.round(r() * 200), k: 1 }];
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2;
    const d = 350 + r() * 800;
    blobs.push({
      dx: Math.round(Math.cos(a) * d),
      dy: Math.round(Math.sin(a) * d),
      radius: 280 + Math.round(r() * 280),
      k: Number((0.7 + r() * 0.6).toFixed(2)),
    });
  }
  return {
    id: `${s.city}-${s.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    city: s.city,
    name: s.name,
    lat: s.centre[0],
    lon: s.centre[1],
    data_score: dataScore,
    reports: s.n,
    lighting: Number(s.lighting.toFixed(1)),
    top_crimes: s.topCrimes.slice(0, 3),
    blobs,
    messages,
  };
});

mkdirSync("src/data", { recursive: true });
writeFileSync(
  "src/data/demo-hotspots.json",
  `${JSON.stringify(hotspots, null, 1)}\n`,
);
console.log(
  `Wrote ${hotspots.length} demo hotspots, ${hotspots.reduce((n, h) => n + h.messages.length, 0)} chat messages.`,
);
