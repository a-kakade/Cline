"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { heatColour, TONE_COLOUR, type Hotspot } from "@/lib/hotspots";
import type { Service } from "@/lib/services";

export type MapFocus = {
  lat: number;
  lon: number;
  zoom: number;
  nonce: number;
};
export type MapRoute = {
  id: string;
  line: [number, number][];
  active: boolean;
};
export type MapMarker = {
  lat: number;
  lon: number;
  kind: "from" | "to" | "me";
};
export type MapRadius = { lat: number; lon: number; m: number };

const GLYPH: Record<string, string> = {
  police: "P",
  hospital: "H",
  transit: "M",
  pharmacy: "Rx",
  women_help: "W",
  safe_zone: "S",
};
const MARKER_GLYPH = { from: "●", to: "⚑", me: "" } as const;
const M_PER_DEG = 111_320;

const placeIcon = (cls: string, text: string) =>
  L.divIcon({
    className: "",
    html: `<span class="map-pin ${cls}" aria-hidden="true">${text}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
const ratingIcon = (h: Hotspot, selected: boolean) =>
  L.divIcon({
    className: "",
    html: `<span class="rating-pin${selected ? " rating-pin-on" : ""}" style="--tone:${TONE_COLOUR[h.tone]}"><span aria-hidden="true">★</span>${h.rating.toFixed(1)}</span>`,
    iconSize: [58, 28],
    iconAnchor: [29, 14],
  });

// All Leaflet code lives here; the parent passes plain data and receives picks.
export default function LeafletMap({
  tileUrl,
  hotspots = [],
  selectedId = null,
  pins = true,
  places = [],
  routes = [],
  markers = [],
  radius = null,
  focus,
  fitRoutes = false,
  onSelect,
}: {
  tileUrl: string;
  hotspots?: Hotspot[];
  selectedId?: string | null;
  /** Show the star-rating pin on each hotspot (the heat is always shown). */
  pins?: boolean;
  places?: Service[];
  routes?: MapRoute[];
  markers?: MapMarker[];
  radius?: MapRadius | null;
  focus: MapFocus | null;
  fitRoutes?: boolean;
  onSelect?: (id: string) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const heat = useRef<L.LayerGroup | null>(null);
  const pinLayer = useRef<L.LayerGroup | null>(null);
  const extras = useRef<L.LayerGroup | null>(null);
  const select = useRef(onSelect);
  const list = useRef(hotspots);
  useEffect(() => {
    select.current = onSelect;
    list.current = hotspots;
  });

  useEffect(() => {
    if (!node.current || map.current) return;
    const m = L.map(node.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([22.5, 79], 5);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    // The blur on this pane is what turns overlapping circles into a heat map.
    m.createPane("heat").style.zIndex = "350";
    L.tileLayer(tileUrl, {
      maxZoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      referrerPolicy: "origin",
    }).addTo(m);
    heat.current = L.layerGroup().addTo(m);
    extras.current = L.layerGroup().addTo(m);
    pinLayer.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => {
      if (!select.current) return;
      let best: { id: string; d: number } | null = null;
      for (const h of list.current) {
        const d = m.distance(e.latlng, [h.lat, h.lon]);
        if (d < 1500 && (!best || d < best.d)) best = { id: h.id, d };
      }
      if (best) select.current(best.id);
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, [tileUrl]);

  const placed = useRef(false);
  useEffect(() => {
    const m = map.current;
    if (!m || !focus) return;
    // The first view is set outright; later moves glide.
    if (placed.current)
      m.flyTo([focus.lat, focus.lon], focus.zoom, { duration: 0.8 });
    else {
      m.setView([focus.lat, focus.lon], focus.zoom);
      placed.current = true;
    }
  }, [focus]);

  // Heat blobs + rating pins.
  useEffect(() => {
    const g = heat.current;
    const p = pinLayer.current;
    if (!g || !p) return;
    g.clearLayers();
    p.clearLayers();
    for (const h of hotspots) {
      const colour = heatColour(h.risk);
      const mLon = M_PER_DEG * Math.cos((h.lat * Math.PI) / 180);
      for (const b of h.blobs)
        L.circle([h.lat + b.dy / M_PER_DEG, h.lon + b.dx / mLon], {
          pane: "heat",
          radius: b.radius * 2.3,
          stroke: false,
          fillColor: colour,
          fillOpacity: Math.min(0.85, 0.6 * b.k),
          interactive: false,
        }).addTo(g);
      if (pins)
        L.marker([h.lat, h.lon], {
          icon: ratingIcon(h, h.id === selectedId),
          title: `${h.name}, ${h.city}: ${h.rating} out of 5`,
          zIndexOffset: h.id === selectedId ? 1000 : 0,
        })
          .on("click", () => select.current?.(h.id))
          .addTo(p);
    }
  }, [hotspots, selectedId, pins]);

  // Routes, the search radius, nearby services and position markers.
  useEffect(() => {
    const g = extras.current;
    if (!g) return;
    g.clearLayers();
    if (radius)
      L.circle([radius.lat, radius.lon], {
        radius: radius.m,
        color: "#172d42",
        weight: 1.5,
        dashArray: "6 6",
        fillColor: "#172d42",
        fillOpacity: 0.05,
        interactive: false,
      }).addTo(g);
    // Inactive routes first so the chosen one is drawn on top.
    for (const r of [...routes].sort((a, b) => +a.active - +b.active)) {
      if (r.line.length < 2) continue;
      if (r.active)
        L.polyline(r.line, { color: "#fff", weight: 10, opacity: 0.95 }).addTo(
          g,
        );
      L.polyline(r.line, {
        color: r.active ? "#172d42" : "#8b97a1",
        weight: r.active ? 5 : 4,
        opacity: r.active ? 0.95 : 0.8,
        dashArray: r.active ? undefined : "2 8",
      }).addTo(g);
    }
    for (const pl of places)
      L.marker([pl.lat, pl.lon], {
        icon: placeIcon(
          `map-pin-${pl.category}${pl.synthetic ? " map-pin-demo" : ""}`,
          GLYPH[pl.category] ?? "•",
        ),
        title: pl.name,
      })
        .bindPopup(
          `<strong>${esc(pl.name)}</strong><br>${esc(pl.category.replace("_", " "))} · ${pl.distance_m} m<br><small>${pl.synthetic ? "Demo record, not a real place" : "OpenStreetMap contributors"}</small>`,
        )
        .addTo(g);
    for (const k of markers)
      L.marker([k.lat, k.lon], {
        icon: placeIcon(`map-pin-${k.kind}`, MARKER_GLYPH[k.kind]),
        title:
          k.kind === "me" ? "You" : k.kind === "to" ? "Destination" : "Start",
        zIndexOffset: 900,
        keyboard: false,
      }).addTo(g);
  }, [places, routes, markers, radius]);

  const fitKey = routes.map((r) => r.id + r.line.length).join("|");
  useEffect(() => {
    const m = map.current;
    if (!m || !fitRoutes || !fitKey) return;
    const all = routes.flatMap((r) => r.line);
    if (all.length > 1) m.fitBounds(L.latLngBounds(all), { padding: [48, 48] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, fitRoutes]);

  return (
    <div
      ref={node}
      className="leaflet-host"
      role="region"
      aria-label="Safety map"
      tabIndex={0}
    />
  );
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
