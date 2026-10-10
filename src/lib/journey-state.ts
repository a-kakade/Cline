// Single source of truth for the Journey Guardian state machine.
// Pure and dependency-free: imported by the server service, the API and the UI.
//
//   active ──(ETA reached)──────────────▶ check_in_due ──(ETA + grace reached)──▶ escalated
//     ▲  ◀───────(check-in with new ETA, or extend)────┘                              │
//     └── complete / cancel (from active, check_in_due or escalated) ─▶ completed / cancelled
//
// "draft" is deliberately not persisted: the review step happens in the client
// before the journey exists, so nothing is stored or shared until the user confirms.

export const JOURNEY_STATUSES = [
  "active",
  "check_in_due",
  "escalated",
  "completed",
  "cancelled",
] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];

export const OPEN_STATUSES: readonly JourneyStatus[] = [
  "active",
  "check_in_due",
  "escalated",
];
export const TERMINAL_STATUSES: readonly JourneyStatus[] = [
  "completed",
  "cancelled",
];

export type JourneyAction = "check-in" | "extend" | "complete" | "cancel";
export const JOURNEY_ACTIONS: readonly JourneyAction[] = [
  "check-in",
  "extend",
  "complete",
  "cancel",
];

/** Statuses from which each user action is permitted. */
export const ACTION_ALLOWED: Record<JourneyAction, readonly JourneyStatus[]> = {
  "check-in": ["active", "check_in_due"],
  extend: ["active", "check_in_due"],
  complete: ["active", "check_in_due", "escalated"],
  cancel: ["active", "check_in_due", "escalated"],
};

/** Status after a user action succeeds. */
export function statusAfter(action: JourneyAction): JourneyStatus {
  if (action === "complete") return "completed";
  if (action === "cancel") return "cancelled";
  return "active";
}

export type JourneyTiming = {
  expected_arrival_at: number;
  grace_period_minutes: number;
};

export const MIN_ETA_MS = 60_000;
export const MAX_ETA_MS = 24 * 60 * 60_000;

export function escalationDeadline(journey: JourneyTiming): number {
  return journey.expected_arrival_at + journey.grace_period_minutes * 60_000;
}

/**
 * The next automatic (server-side) transition that is due, or null. Only one
 * step is returned; the processor applies steps in order so a journey that was
 * missed entirely by the scheduler still passes through `check_in_due`.
 */
export function dueSystemTransition(
  journey: JourneyTiming & { status: JourneyStatus },
  now: number,
): "check_in_due" | "escalated" | null {
  if (journey.status === "active" && now >= journey.expected_arrival_at)
    return "check_in_due";
  if (journey.status === "check_in_due" && now >= escalationDeadline(journey))
    return "escalated";
  return null;
}

export function isOpen(status: JourneyStatus): boolean {
  return OPEN_STATUSES.includes(status);
}
