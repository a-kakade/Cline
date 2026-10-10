"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api-client";
import {
  agoLabel,
  POST_CATEGORIES,
  postCategory,
  type FeedPost,
  type Hotspot,
  type PostCategory,
} from "@/lib/hotspots";
import { joinRoom, resolveRoom, sendMessage } from "@/lib/rooms-client";
import type { RoomInfo, SenderTriage } from "@/lib/room-types";
import { AreaRoom } from "@/components/area-room";
import { Icon } from "@/components/icon";
import { TriageHelp } from "@/components/triage-help";

const PAGE = 8;
const TITLE_MAX = 60;
const DESC_MAX = 380;
const TINTS = ["#e9efe9", "#e6ecf2", "#fff1ee", "#f6efdc", "#ece8f2"];
const tint = (alias: string) =>
  TINTS[
    (alias.charCodeAt(alias.length - 1) + alias.charCodeAt(7)) % TINTS.length
  ];

type Mine = FeedPost & { mine: true };

export function CommunityHub({
  hotspots,
  posts,
  initialAreaId,
}: {
  hotspots: Hotspot[];
  posts: FeedPost[];
  initialAreaId?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(
    hotspots.some((h) => h.id === initialAreaId)
      ? (initialAreaId ?? null)
      : null,
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PostCategory | "All">("All");
  const [city, setCity] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [mine, setMine] = useState<Mine[]>([]);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const cities = useMemo(
    () => [...new Set(hotspots.map((h) => h.city))],
    [hotspots],
  );

  const feed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...mine, ...posts].filter(
      (p) =>
        (category === "All" || p.category === category) &&
        (!city || p.city === city) &&
        (!q ||
          p.body.toLowerCase().includes(q) ||
          p.area.toLowerCase().includes(q) ||
          p.city.toLowerCase().includes(q)),
    );
  }, [posts, mine, query, category, city]);

  const open = hotspots.find((h) => h.id === openId) ?? null;
  if (open)
    return (
      <AreaRoom
        key={open.id}
        hotspot={open}
        chats={posts
          .filter((p) => p.area_id === open.id)
          .reverse()
          .map(({ alias, body, minutes_ago, sentiment }) => ({
            alias,
            body,
            minutes_ago,
            sentiment,
          }))}
        onBack={() => setOpenId(null)}
      />
    );

  function toggleLike(id: string) {
    setLiked((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  }
  async function share(p: FeedPost) {
    const url = `${window.location.origin}/rooms?area=${p.area_id}`;
    try {
      if (navigator.share)
        await navigator.share({ title: `Sakhi · ${p.area}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setShareNote(`Link to the ${p.area} room copied.`);
      }
    } catch {
      /* Sharing was cancelled or isn’t available. */
    }
  }

  return (
    <div className="community">
      <div className="community-search">
        <Icon name="search" width={18} height={18} />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE);
          }}
          placeholder="Search posts, areas, cities…"
          aria-label="Search posts"
        />
        <label className="community-city">
          <Icon name="filter" width={18} height={18} />
          <span className="sr-only">City</span>
          <select
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              setShown(PAGE);
            }}
          >
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="community-chips" role="group" aria-label="Category">
        {(["All", ...POST_CATEGORIES] as const).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={category === c}
            className={`cat-chip${category === c ? " cat-chip-on" : ""}`}
            onClick={() => {
              setCategory(c);
              setShown(PAGE);
            }}
          >
            {c}
          </button>
        ))}
      </div>

      <Composer
        hotspots={hotspots}
        onPosted={(area, text) =>
          setMine((m) => [
            {
              id: `mine:${Date.now()}`,
              area_id: area.id,
              area: area.name,
              city: area.city,
              alias: "You",
              minutes_ago: 0,
              body: text,
              sentiment: 0,
              category: postCategory(text),
              likes: 0,
              comments: 0,
              mine: true,
            },
            ...m,
          ])
        }
        onOpen={setOpenId}
      />

      <div className="community-list-head">
        <h2>Recent discussions</h2>
        <span className="field-hint">
          {feed.length} {feed.length === 1 ? "post" : "posts"}
        </span>
      </div>
      <p className="field-hint">
        Demo posts are synthetic and not from real people. Posts you share go to
        that area’s live room.
      </p>
      {shareNote && (
        <p role="status" className="contacts-feedback">
          {shareNote}
        </p>
      )}

      {feed.length === 0 ? (
        <p className="contacts-empty">
          Nothing matches. Try another word, category or city.
        </p>
      ) : (
        <ul className="post-list">
          {feed.slice(0, shown).map((p) => {
            const isMine = "mine" in p;
            const isLiked = liked.has(p.id);
            return (
              <li key={p.id} className="post-card">
                <div className="post-top">
                  <span
                    className="post-avatar"
                    style={{ background: tint(p.alias) }}
                    aria-hidden="true"
                  >
                    {isMine ? "Y" : p.alias.slice(-2).toUpperCase()}
                  </span>
                  <div className="post-who">
                    <strong>{p.alias}</strong>
                    <span>
                      {isMine ? "just now" : agoLabel(p.minutes_ago)} ·{" "}
                      <button
                        type="button"
                        className="post-place"
                        onClick={() => setOpenId(p.area_id)}
                      >
                        <Icon name="map" width={13} height={13} />
                        {p.area}, {p.city}
                      </button>
                    </span>
                  </div>
                  <span
                    className={`post-tag post-tag-${p.category.toLowerCase()}`}
                  >
                    {p.category}
                  </span>
                </div>
                <p className="post-body">{p.body}</p>
                <div className="post-actions">
                  <button
                    type="button"
                    aria-pressed={isLiked}
                    aria-label={`Like, ${p.likes + (isLiked ? 1 : 0)} likes`}
                    className={isLiked ? "post-liked" : undefined}
                    onClick={() => toggleLike(p.id)}
                  >
                    <Icon name="heart" width={18} height={18} />
                    {p.likes + (isLiked ? 1 : 0)}
                  </button>
                  <button
                    type="button"
                    aria-label={`Open the ${p.area} room, ${p.comments} replies`}
                    onClick={() => setOpenId(p.area_id)}
                  >
                    <Icon name="chat" width={18} height={18} />
                    {p.comments}
                  </button>
                  <button
                    type="button"
                    aria-label={`Share the ${p.area} room`}
                    onClick={() => void share(p)}
                  >
                    <Icon name="share" width={18} height={18} />
                    Share
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {feed.length > shown && (
        <button
          type="button"
          className="button button-secondary community-more"
          onClick={() => setShown((n) => n + PAGE)}
        >
          Show more
        </button>
      )}
    </div>
  );
}

// "Share a safety alert": posts into the chosen area's live room, joining it first
// if needed. It uses the same send endpoint as the room chat, so limits, triage and
// moderation all apply, and the sender sees the same suggested-help panel.
function Composer({
  hotspots,
  onPosted,
  onOpen,
}: {
  hotspots: Hotspot[];
  onPosted: (area: Hotspot, text: string) => void;
  onOpen: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [areaId, setAreaId] = useState(hotspots[0].id);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [triage, setTriage] = useState<SenderTriage | null>(null);

  const area = hotspots.find((h) => h.id === areaId)!;
  const byCity = useMemo(() => {
    const m = new Map<string, Hotspot[]>();
    for (const h of hotspots) m.set(h.city, [...(m.get(h.city) ?? []), h]);
    return [...m];
  }, [hotspots]);

  const { lat, lon } = area;
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    resolveRoom({ lat, lon })
      .then((r) => active && setRoom(r))
      .catch(() => active && setRoom(null));
    return () => {
      active = false;
    };
  }, [expanded, lat, lon]);

  const text = [title.trim(), desc.trim()].filter(Boolean).join(". ");
  const needsJoin = !!room && !room.joined && !room.banned;

  async function post(event: FormEvent) {
    event.preventDefault();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      let current = room;
      if (!current?.joined) current = await joinRoom({ lat, lon });
      setRoom(current);
      const result = await sendMessage(current.id, crypto.randomUUID(), text);
      setTriage(result.triage);
      setDone(`Posted to the ${area.name} room.`);
      onPosted(area, text);
      setTitle("");
      setDesc("");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Your post couldn’t be sent.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="composer" aria-label="Share a safety alert">
      <button
        type="button"
        className="composer-head"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="icon-tile">
          <Icon name="edit" width={20} height={20} />
        </span>
        <span className="composer-title">
          <strong>Share a safety alert</strong>
          <small>Tell people nearby what you’ve noticed</small>
        </span>
        <Icon
          name="chevron"
          width={20}
          height={20}
          style={{ rotate: expanded ? "180deg" : "0deg" }}
        />
      </button>
      {expanded && (
        <form onSubmit={post} className="composer-form">
          <div className="field">
            <label htmlFor="composer-area">Location</label>
            <select
              id="composer-area"
              value={areaId}
              onChange={(e) => {
                setAreaId(e.target.value);
                setRoom(null);
                setDone(null);
              }}
            >
              {byCity.map(([c, list]) => (
                <optgroup key={c} label={c}>
                  {list.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="composer-title">Title</label>
            <input
              id="composer-title"
              type="text"
              maxLength={TITLE_MAX}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Describe the situation…"
            />
          </div>
          <div className="field">
            <label htmlFor="composer-desc">Description</label>
            <textarea
              id="composer-desc"
              rows={3}
              maxLength={DESC_MAX}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Write your safety concern…"
              aria-describedby="composer-count"
            />
            <p id="composer-count" className="field-hint">
              {desc.length}/{DESC_MAX}. Don’t include names, numbers or exact
              addresses. This isn’t an emergency channel: call 112 or use SOS.
            </p>
          </div>
          {needsJoin && (
            <p className="field-hint">
              Posting joins you to the {area.name} room. Others see only a
              pseudonym; your position isn’t saved.
            </p>
          )}
          {room?.banned && (
            <p className="form-error" role="alert">
              You can’t post in this room.
            </p>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button
            className="button button-primary composer-post"
            type="submit"
            disabled={busy || !text || room?.banned}
          >
            {busy ? "Posting…" : needsJoin ? "Join & post" : "Post"}
          </button>
        </form>
      )}
      {done && (
        <p role="status" className="contacts-feedback">
          {done}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => onOpen(area.id)}
          >
            Open the room
          </button>
        </p>
      )}
      {triage && (
        <TriageHelp triage={triage} onDismiss={() => setTriage(null)} />
      )}
    </section>
  );
}
