import { apiRequest } from "@/lib/api-client";
import type { HistoryPage, PostResult, RoomInfo } from "@/lib/room-types";
import type { Point } from "@/lib/map-client";

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
// Only coordinates are sent; picker labels never are.
const pos = (p: Point) => ({ lat: p.lat, lon: p.lon });

export const resolveRoom = (p: Point) =>
  apiRequest<RoomInfo>("/api/rooms/resolve", json(pos(p)));
export const joinRoom = (p: Point) =>
  apiRequest<RoomInfo>("/api/rooms/join", json({ ...pos(p), consent: true }));
export const leaveRoom = (id: string) =>
  apiRequest<{ left: boolean }>(
    `/api/rooms/${encodeURIComponent(id)}/leave`,
    json({}),
  );
export const muteRoom = (id: string, muted: boolean) =>
  apiRequest<RoomInfo>(
    `/api/rooms/${encodeURIComponent(id)}/mute`,
    json({ muted }),
  );
export const loadHistory = (id: string, before?: number) =>
  apiRequest<HistoryPage>(
    `/api/rooms/${encodeURIComponent(id)}/messages?limit=30${before ? `&before=${before}` : ""}`,
  );
export const sendMessage = (id: string, client_id: string, body: string) =>
  apiRequest<PostResult>(
    `/api/rooms/${encodeURIComponent(id)}/messages`,
    json({ client_id, body }),
  );
export const reportMessage = (id: string, reason: string) =>
  apiRequest<{ reported: boolean }>(
    `/api/messages/${encodeURIComponent(id)}/report`,
    json({ reason }),
  );
export const blockAuthor = (id: string) =>
  apiRequest<{ blocked: boolean; alias: string }>(
    `/api/messages/${encodeURIComponent(id)}/block`,
    json({}),
  );

export type RatingSummary = {
  area: { id: string };
  overall: { average: number | null; count: number; shown: boolean };
  day: { average: number | null; count: number; shown: boolean };
  night: { average: number | null; count: number; shown: boolean };
  distribution: number[];
  count_last_90_days: number;
  latest_at: number | null;
  min_to_show: number;
  reviews: {
    id: string;
    stars: number;
    review: string;
    updated_at: number;
    mine: boolean;
  }[];
  my_rating: {
    stars: number;
    day_stars: number | null;
    night_stars: number | null;
    review: string | null;
  } | null;
  disclaimer: string;
};
export const loadRatings = (areaId: string) =>
  apiRequest<RatingSummary>(`/api/areas/${encodeURIComponent(areaId)}/ratings`);
export const saveRating = (areaId: string, body: Record<string, unknown>) =>
  apiRequest<RatingSummary>(`/api/areas/${encodeURIComponent(areaId)}/rating`, {
    ...json(body),
    method: "PUT",
  });
export const deleteRating = (areaId: string) =>
  apiRequest<RatingSummary>(`/api/areas/${encodeURIComponent(areaId)}/rating`, {
    method: "DELETE",
  });
export const reportRating = (id: string, reason: string) =>
  apiRequest<{ reported: boolean }>(
    `/api/ratings/${encodeURIComponent(id)}/report`,
    json({ reason }),
  );
