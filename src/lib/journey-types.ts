import type { Alert } from "./emergency-types";
import type { JourneyAction, JourneyStatus } from "./journey-state";

export type { JourneyAction, JourneyStatus };
export type JourneyEventKind =
  | "started"
  | "check_in_due"
  | "check-in"
  | "extend"
  | "complete"
  | "cancel"
  | "escalated";
export type Journey = {
  id: string;
  user_id: string;
  status: JourneyStatus;
  origin: string | null;
  destination: string;
  expected_arrival_at: number;
  grace_period_minutes: number;
  time_zone: string | null;
  last_known_latitude: number | null;
  last_known_longitude: number | null;
  last_location_accuracy_meters: number | null;
  last_location_updated_at: number | null;
  started_at: number;
  check_in_due_at: number | null;
  last_check_in_at: number | null;
  completed_at: number | null;
  cancelled_at: number | null;
  escalated_at: number | null;
  alert_id: string | null;
  all_clear_alert_id: string | null;
  created_at: number;
  updated_at: number;
  contact_ids: string[];
  events: { kind: JourneyEventKind; created_at: number }[];
  /** The escalation notification record, if any. Never implies delivery. */
  alert: Alert | null;
};

export type JourneyShare = {
  id: string;
  journey_id: string;
  created_at: number;
  shared_location: boolean;
  /** Expected arrival that was sent. */
  expected_arrival_at: number;
  deliveries: {
    contact_name: string;
    status: "accepted" | "delivered" | "failed" | "unknown" | "simulated";
    code: string | null;
  }[];
};
