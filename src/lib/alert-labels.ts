import type { AlertStatus } from "./emergency-types";

// One wording for every alert surface. None of these claims a message was read
// or that help is coming; a simulation is never described as a delivery.
export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = {
  created: "Alert saved — not sent yet",
  queued: "Queued — not delivered",
  sending: "Sending — delivery not confirmed",
  accepted: "Accepted by provider — not confirmed delivered",
  delivered: "Delivery confirmed by provider",
  failed: "Failed — help is not confirmed",
  unknown: "Unknown — delivery cannot be confirmed",
  simulated: "Simulated — no message sent",
  partial: "Mixed results — check each contact",
};
