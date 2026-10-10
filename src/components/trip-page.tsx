"use client";

import { JourneyGuardian } from "@/components/journey-guardian";
import { TripLive } from "@/components/trip-live";
import { TripPlan, type TripExtra } from "@/components/trip-plan";

export function TripPage(props: TripExtra) {
  return <JourneyGuardian Plan={TripPlan} Live={TripLive} extra={props} />;
}
