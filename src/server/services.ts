import { getDatabase } from "./database";
import { EmergencyService } from "./emergency";
import { JourneyService } from "./journeys";
import { selectProvider } from "./notifications";
export function journeyService() {
  const db=getDatabase();
  return new JourneyService(db,new EmergencyService(db,selectProvider()));
}