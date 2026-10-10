export const OSM_CATEGORY_IDS = [
  "police",
  "hospital",
  "ambulance",
  "pharmacy",
  "bus_stop",
  "toilets",
  "help_point",
  "transit",
] as const;
export type OsmCategoryId = (typeof OSM_CATEGORY_IDS)[number];
export type PlaceCategoryId = OsmCategoryId | "safe_haven";

export type CategoryInfo = {
  id: PlaceCategoryId;
  label: string;
  /** Upper bound for the search radius in metres. */
  maxRadiusM: number;
  /** Honest caveat shown beside results of this category. */
  caveat: string;
};
export const CATEGORIES: readonly CategoryInfo[] = [
  {
    id: "police",
    label: "Police stations",
    maxRadiusM: 5000,
    caveat:
      "Mapped by OpenStreetMap contributors; may include posts or checkpoints. Not a dispatch service — call 112 in an emergency.",
  },
  {
    id: "hospital",
    label: "Hospitals",
    maxRadiusM: 8000,
    caveat:
      "Mapped by contributors; services, 24-hour emergency cover and capacity are not known.",
  },
  {
    id: "ambulance",
    label: "Ambulance stations",
    maxRadiusM: 10000,
    caveat:
      "Few ambulance stations are mapped in India. A listing does not mean an ambulance can be dispatched; call 112.",
  },
  {
    id: "pharmacy",
    label: "Pharmacies",
    maxRadiusM: 3000,
    caveat:
      "A mapped pharmacy is a shop, not a Safe Haven. Opening hours are shown only where mapped.",
  },
  {
    id: "bus_stop",
    label: "Bus stops",
    maxRadiusM: 1500,
    caveat:
      "Stop positions only; no service frequency or lighting information.",
  },
  {
    id: "toilets",
    label: "Public washrooms",
    maxRadiusM: 2000,
    caveat: "Mapped by contributors; condition, access and safety are unknown.",
  },
  {
    id: "help_point",
    label: "Emergency phones / help points",
    maxRadiusM: 3000,
    caveat:
      "As mapped in OpenStreetMap; working order and who answers are unknown.",
  },
  {
    id: "transit",
    label: "Metro and rail stations",
    maxRadiusM: 3000,
    caveat:
      "Stations are staffed and busy for most of the day, but hours and lighting vary. Not a verified Safe Haven.",
  },
  {
    id: "safe_haven",
    label: "Verified Safe Havens",
    maxRadiusM: 10000,
    caveat:
      "Only places that explicitly joined SAKHI and were verified. Demo entries are labelled.",
  },
];
export const CATEGORY_BY_ID = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<PlaceCategoryId, CategoryInfo>;

export type PlaceSource = "osm" | "sakhi_safe_haven" | "demo";
export type Place = {
  id: string;
  category: PlaceCategoryId;
  /** null when the source has no name; never invented. */
  name: string | null;
  lat: number;
  lon: number;
  distance_m: number;
  address: string | null;
  /** Raw value from the source; null when absent. */
  phone: string | null;
  opening_hours: string | null;
  /** Source-provided confirmation date (e.g. OSM check_date), else null. */
  last_confirmed: string | null;
  source: PlaceSource;
  source_url: string | null;
  /** True only for Safe Havens SAKHI verified; never true for OSM data. */
  verified: boolean;
  verification_note: string | null;
};

export type SourceStatus = {
  category: PlaceCategoryId;
  provider: "overpass" | "safe_havens";
  status: "fresh" | "cached" | "stale" | "failed";
  fetched_at: number | null;
  truncated?: boolean;
  error?: PlacesErrorCode;
};
export type PlacesErrorCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "PROVIDER_INVALID"
  | "PROVIDER_UNAVAILABLE";

export type PlacesResult = {
  places: Place[];
  sources: SourceStatus[];
  query: { radius_m: number; categories: PlaceCategoryId[] };
  attribution: string;
};
