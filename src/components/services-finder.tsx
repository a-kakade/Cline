"use client";

import { useState } from "react";
import {
  LocationPicker,
  type PickedLocation,
} from "@/components/location-picker";
import { NearbyServices } from "@/components/nearby-services";

export function ServicesFinder({
  emergencyNumber,
  demoAllowed,
}: {
  emergencyNumber: string;
  demoAllowed: boolean;
}) {
  const [here, setHere] = useState<PickedLocation | null>(null);
  const [demo, setDemo] = useState(false);
  return (
    <div>
      <LocationPicker value={here} onChange={setHere} />
      {demoAllowed && (
        <label className="journey-choice">
          <input
            type="checkbox"
            checked={demo}
            onChange={(e) => setDemo(e.target.checked)}
          />
          <span>Include DEMO Safe Havens (fake, for demonstration only)</span>
        </label>
      )}
      <NearbyServices
        point={here}
        emergencyNumber={emergencyNumber}
        includeDemo={demo}
      />
    </div>
  );
}
