export const TRIAGE_CATEGORIES = [
  "general",
  "concern",
  "harassment_report",
  "infrastructure_hazard",
  "distress",
  "urgent_safety_concern",
  "unknown",
] as const;
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

/** How strongly the rules matched. Not a probability of danger. */
export type MatchStrength = "none" | "weak" | "moderate" | "strong";

export type SuggestedAction =
  | "call_112"
  | "open_sos"
  | "nearby_help"
  | "share_journey"
  | "report_hazard"
  | "report_harassment";

export type TriageResult = {
  category: TriageCategory;
  /** BCP-47-ish: en, hi, hi-Latn, or und when unsupported/undetermined. */
  language: string;
  strength: MatchStrength;
  /** Short, generic description of why; never echoes the user's text. */
  reason: string;
  needs_review: boolean;
  method: "rules" | "model";
  /** Shown only to the sender, never to the room. */
  suggested_actions: SuggestedAction[];
};

export const ACTION_LABELS: Record<SuggestedAction, string> = {
  call_112: "Call 112",
  open_sos: "Open SOS",
  nearby_help: "Find nearby help",
  share_journey: "Share your journey",
  report_hazard: "Report a hazard",
  report_harassment: "Report what happened",
};
