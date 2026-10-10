import type { Alert } from "./emergency-types";
export type JourneyStatus = "active" | "check_in_due" | "completed" | "cancelled" | "escalated";
export type JourneyAction = "check-in" | "extend" | "complete" | "cancel";
export type Journey = {
  id:string; user_id:string; status:JourneyStatus; origin:string|null; destination:string;
  expected_arrival_at:number; grace_period_minutes:number;
  last_known_latitude:number|null; last_known_longitude:number|null; last_location_accuracy_meters:number|null; last_location_updated_at:number|null;
  started_at:number; completed_at:number|null; cancelled_at:number|null; escalated_at:number|null;
  alert_id:string|null; created_at:number; updated_at:number;
  contact_ids:string[]; events:{kind:string;created_at:number}[]; alert:Alert|null;
};