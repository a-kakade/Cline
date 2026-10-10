// Pure geographic helpers shared by the server and the UI.
const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

export type LatLon = { lat: number; lon: number };

export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A box guaranteed to contain every point within `radiusM` of `center`. */
export function boundingBox(center: LatLon, radiusM: number) {
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const cos = Math.max(0.01, Math.cos(rad(center.lat)));
  const dLon = dLat / cos;
  return {
    minLat: Math.max(-90, center.lat - dLat),
    maxLat: Math.min(90, center.lat + dLat),
    minLon: Math.max(-180, center.lon - dLon),
    maxLon: Math.min(180, center.lon + dLon),
  };
}

/** Distance from `p` to the segment a–b (local equirectangular approximation, fine for < 50 km). */
export function distanceToSegmentMeters(p: LatLon, a: LatLon, b: LatLon) {
  const kx = Math.cos(rad(p.lat)) * ((Math.PI / 180) * EARTH_RADIUS_M);
  const ky = (Math.PI / 180) * EARTH_RADIUS_M;
  const ax = (a.lon - p.lon) * kx;
  const ay = (a.lat - p.lat) * ky;
  const bx = (b.lon - p.lon) * kx;
  const by = (b.lat - p.lat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function distanceToPolylineMeters(p: LatLon, line: LatLon[]) {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversineMeters(p, line[0]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++)
    best = Math.min(best, distanceToSegmentMeters(p, line[i - 1], line[i]));
  return best;
}

export const isValidLatLon = (lat: number, lon: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lon) <= 180;

// ---- Stable area grid ---------------------------------------------------
// Everyone inside one cell gets the same id, whoever asks and wherever in the
// cell they stand. The id never encodes a person's position, only the cell.
export const AREA_CELL_METERS = 500;
const M_PER_DEG_LAT = 111_320;

export type Area = {
  id: string;
  center: LatLon;
  size_m: number;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
};

function lonStepFor(latIdx: number, size: number) {
  const latStep = size / M_PER_DEG_LAT;
  const centerLat = (latIdx + 0.5) * latStep;
  return size / (M_PER_DEG_LAT * Math.max(0.01, Math.cos(rad(centerLat))));
}

export function areaForPoint(
  lat: number,
  lon: number,
  size = AREA_CELL_METERS,
): Area {
  if (!isValidLatLon(lat, lon)) throw new RangeError("Invalid coordinates.");
  const latStep = size / M_PER_DEG_LAT;
  const latIdx = Math.floor(lat / latStep);
  const lonStep = lonStepFor(latIdx, size);
  const lonIdx = Math.floor(lon / lonStep);
  return areaFromIndex(latIdx, lonIdx, size);
}

function areaFromIndex(latIdx: number, lonIdx: number, size: number): Area {
  const latStep = size / M_PER_DEG_LAT;
  const lonStep = lonStepFor(latIdx, size);
  const minLat = latIdx * latStep;
  const minLon = lonIdx * lonStep;
  return {
    id: `g${size}:${latIdx}:${lonIdx}`,
    center: { lat: minLat + latStep / 2, lon: minLon + lonStep / 2 },
    size_m: size,
    bounds: {
      minLat,
      maxLat: minLat + latStep,
      minLon,
      maxLon: minLon + lonStep,
    },
  };
}

export function areaFromId(id: string): Area | null {
  const m = /^g(\d{2,5}):(-?\d{1,9}):(-?\d{1,9})$/.exec(id);
  if (!m) return null;
  const size = Number(m[1]);
  const area = areaFromIndex(Number(m[2]), Number(m[3]), size);
  return isValidLatLon(area.center.lat, area.center.lon) ? area : null;
}
