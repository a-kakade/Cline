import type {
  SuggestedAction,
  TriageCategory,
  MatchStrength,
} from "./triage-types";

export type RoomInfo = {
  id: string;
  kind: "area" | "venue";
  name: string;
  /** Centre of the fixed zone (a public grid cell), never a person's position. */
  center: { lat: number; lon: number };
  radius_m: number;
  member_count: number;
  joined: boolean;
  muted: boolean;
  banned: boolean;
  area_id: string | null;
};

export type RoomMessage = {
  id: string;
  seq: number;
  room_id: string;
  /** Stable pseudonym within this room; never a real name or user id. */
  alias: string;
  /** null when a moderator removed the message. */
  body: string | null;
  status: "visible" | "hidden";
  created_at: number;
  mine: boolean;
};

export type SenderTriage = {
  category: TriageCategory;
  strength: MatchStrength;
  reason: string;
  language: string;
  suggested_actions: SuggestedAction[];
  flagged_for_review: boolean;
};

export type PostResult = {
  message: RoomMessage;
  /** Shown only to the sender. null when triage was unavailable. */
  triage: SenderTriage | null;
};

export type HistoryPage = {
  messages: RoomMessage[];
  self_alias: string;
  /** Pass as `before` to load older messages; null when there are none. */
  next_before: number | null;
};
