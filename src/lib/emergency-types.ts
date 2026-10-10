export type DeliveryStatus =
  | "queued"
  | "sending"
  | "accepted"
  | "delivered"
  | "failed"
  | "unknown"
  | "simulated";
export type AlertStatus = DeliveryStatus | "created" | "partial";
export type AlertKind = "sos" | "journey_escalation" | "journey_all_clear";
export type Location = {
  latitude: number;
  longitude: number;
  accuracy: number;
  captured_at: number;
};
export type Delivery = {
  id: string;
  contact_id: string | null;
  status: DeliveryStatus;
  code: string | null;
  attempt_count: number;
  updated_at: number;
};
export type Alert = {
  id: string;
  user_id: string;
  kind: AlertKind;
  status: AlertStatus;
  reason: string | null;
  latitude: number | null;
  longitude: number | null;
  location_accuracy_meters: number | null;
  location_captured_at: number | null;
  message: string;
  created_at: number;
  updated_at: number;
  deliveries: Delivery[];
};
