import { getDatabase } from "./database";
import { EmergencyService } from "./emergency";
import { JourneyService } from "./journeys";
import { selectProvider } from "./notifications";
import { AreaSafetyService } from "./area-safety";
import { ModerationService } from "./moderation";
import { RatingService } from "./ratings";
import { RoomService } from "./rooms";
import { OverpassClient } from "./places/overpass";
import { PlacesService } from "./places/service";
import { ReportService } from "./reports";
import { RoutingService } from "./routing";
import { TripService } from "./trip";

// One Overpass client per process so upstream calls stay paced and serialised.
const shared = globalThis as typeof globalThis & {
  sakhiOverpass?: OverpassClient;
};

export function emergencyService() {
  return new EmergencyService(getDatabase(), selectProvider());
}
export function journeyService() {
  const db = getDatabase();
  return new JourneyService(db, new EmergencyService(db, selectProvider()));
}
export function placesService() {
  return new PlacesService(
    getDatabase(),
    (shared.sakhiOverpass ??= new OverpassClient()),
  );
}
export function reportService() {
  return new ReportService(getDatabase());
}
export function areaSafetyService() {
  return new AreaSafetyService(getDatabase());
}
export function routingService() {
  return new RoutingService(getDatabase());
}
export function roomService() {
  return new RoomService(getDatabase());
}
export function ratingService() {
  return new RatingService(getDatabase());
}
export function moderationService() {
  return new ModerationService(getDatabase());
}
export function tripService() {
  return new TripService(getDatabase());
}
