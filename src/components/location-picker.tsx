"use client";

import { useRef, useState } from "react";
import { CITY_CENTRES, type Point } from "@/lib/map-client";

export type PickedLocation = Point & {
  source: "device" | "city" | "map";
  label: string;
};

// Location is optional everywhere: the page works from a city centre or a chosen
// map point. A device position is used in memory only and is never stored.
export function LocationPicker({
  value,
  onChange,
}: {
  value: PickedLocation | null;
  onChange: (value: PickedLocation) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const settled = useRef(false);

  function useDevice() {
    setStatus(null);
    if (!navigator.geolocation) {
      setStatus(
        "This browser can’t provide a location. Choose a city or tap the map instead.",
      );
      return;
    }
    setBusy(true);
    settled.current = false;
    // Independent timer: some browsers never call either callback.
    const timer = setTimeout(() => {
      if (settled.current) return;
      settled.current = true;
      setBusy(false);
      setStatus(
        "Your location didn’t arrive in time. Choose a city or tap the map instead.",
      );
    }, 8000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled.current) return;
        settled.current = true;
        clearTimeout(timer);
        setBusy(false);
        onChange({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          source: "device",
          label: "Your device location",
        });
      },
      (error) => {
        if (settled.current) return;
        settled.current = true;
        clearTimeout(timer);
        setBusy(false);
        setStatus(
          error.code === 1
            ? "Location permission was denied. That’s fine — choose a city or tap the map."
            : "Your location is unavailable right now. Choose a city or tap the map.",
        );
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 7000 },
    );
  }

  return (
    <div className="location-picker">
      <div className="journey-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={useDevice}
        >
          {busy ? "Finding you…" : "Use my location"}
        </button>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="city-select">Or choose a city centre</label>
          <select
            id="city-select"
            value={value?.source === "city" ? value.label : ""}
            onChange={(e) => {
              const city = CITY_CENTRES.find((c) => c.name === e.target.value);
              if (city)
                onChange({
                  lat: city.lat,
                  lon: city.lon,
                  source: "city",
                  label: city.name,
                });
            }}
          >
            <option value="">Select…</option>
            {CITY_CENTRES.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p role="status" className="field-hint">
        {status ??
          (value
            ? `Searching around: ${value.source === "city" ? `${value.label} city centre` : value.label}. Your position is used for this search only and isn’t saved.`
            : "Pick where to look. Location is optional; nothing is shared until you search.")}
      </p>
    </div>
  );
}
