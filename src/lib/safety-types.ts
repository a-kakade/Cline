export const INCIDENT_CATEGORIES = [
  "harassment",
  "stalking",
  "theft_or_snatching",
  "assault",
  "unsafe_transport",
  "other",
] as const;
export const HAZARD_CATEGORIES = [
  "poor_lighting",
  "broken_road_or_path",
  "blocked_path",
  "no_footpath",
  "other",
] as const;
export type ReportKind = "incident" | "infrastructure_hazard";
export type ReportSource = "user" | "synthetic_demo";

export type PublicReport = {
  id: string;
  kind: ReportKind;
  category: string;
  description: string | null;
  /** Approximate (about 100 m) for user reports. */
  lat: number;
  lon: number;
  created_at: number;
  occurred_at: number | null;
  age_days: number;
  verification: "unverified" | "verified";
  source: ReportSource;
  source_label: string;
  limitation: string;
};

export type ConcernLevel =
  "insufficient_data" | "few_reports" | "some_reports" | "many_reports";

export type AreaSignals = {
  area: { id: string; center: { lat: number; lon: number }; size_m: number };
  window_days: number;
  includes_demo: boolean;
  indicator: {
    level: ConcernLevel;
    points: number | null;
    label: string;
    explanation: string;
  };
  signals: {
    official_statistics: { status: "unavailable"; note: string };
    verified_incidents: { count: number; latest_at: number | null };
    unverified_reports: { count: number; latest_at: number | null };
    infrastructure_hazards: { count: number; latest_at: number | null };
    community_ratings: {
      status: "unavailable" | "insufficient" | "ok";
      average: number | null;
      count: number;
    };
    ai_summaries: { status: "none"; note: string };
  };
  model: {
    name: string;
    validated: false;
    weights: Record<string, number>;
    caps: Record<string, number>;
    thresholds: {
      insufficient_below: number;
      some_at: number;
      many_at: number;
    };
  };
  limitations: string[];
};
