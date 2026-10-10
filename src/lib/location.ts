import type { Location } from "@/lib/emergency-types";

export type LocationResult = {
  location: Location | null;
  reason:
    | "available"
    | "not-requested"
    | "denied"
    | "timeout"
    | "unsupported"
    | "unavailable";
};
let permissionDenied = false;

// An independent timer is essential: some browsers never invoke either callback.
export function getOptionalLocation(consent: boolean): Promise<LocationResult> {
  if (!consent)
    return Promise.resolve({ location: null, reason: "not-requested" });
  if (permissionDenied)
    return Promise.resolve({ location: null, reason: "denied" });
  if (typeof navigator === "undefined" || !navigator.geolocation)
    return Promise.resolve({ location: null, reason: "unsupported" });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: LocationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ location: null, reason: "timeout" }),
      3000,
    );
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          const captured_at = Math.trunc(position.timestamp);
          if (
            ![latitude, longitude, accuracy, captured_at].every(
              Number.isFinite,
            ) ||
            Math.abs(latitude) > 90 ||
            Math.abs(longitude) > 180 ||
            accuracy < 0 ||
            accuracy > 100000 ||
            captured_at <= 0 ||
            captured_at > Date.now() + 30000 ||
            Date.now() - captured_at > 60000
          ) {
            finish({ location: null, reason: "unavailable" });
            return;
          }
          finish({
            location: { latitude, longitude, accuracy, captured_at },
            reason: "available",
          });
        },
        (error) => {
          if (error.code === 1) permissionDenied = true;
          finish({
            location: null,
            reason:
              error.code === 1
                ? "denied"
                : error.code === 3
                  ? "timeout"
                  : "unavailable",
          });
        },
        { enableHighAccuracy: false, maximumAge: 0, timeout: 3000 },
      );
    } catch {
      finish({ location: null, reason: "unavailable" });
    }
  });
}
