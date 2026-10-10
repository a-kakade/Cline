// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripLive } from "@/components/trip-live";
import { TripPlan } from "@/components/trip-plan";
import type { Hotspot } from "@/lib/hotspots";
import type { Journey } from "@/lib/journey-types";
import type { PlannedRoute } from "@/lib/trip";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
// The map needs a real browser; these tests are about the surrounding UI.
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const spot = (id: string, name: string, lat: number, lon: number): Hotspot => ({
  id,
  city: "Bengaluru",
  name,
  lat,
  lon,
  rating: 3.5,
  tone: "mixed",
  label: "Mixed",
  description: "x",
  risk: 0.4,
  blobs: [],
  reports: 1,
  chat_count: 1,
});
const hotspots = [
  spot("bengaluru-koramangala", "Koramangala", 12.9352, 77.6245),
  spot("bengaluru-indiranagar", "Indiranagar", 12.9784, 77.6408),
];
const route = (
  id: string,
  tags: PlannedRoute["tags"],
  min: number,
  safety: number,
): PlannedRoute => ({
  id,
  tags,
  distance_m: 6000,
  duration_s: min * 60,
  geometry: [
    [12.93, 77.62],
    [12.97, 77.64],
  ],
  safety,
  help_points: 4,
  area_rating: 3.4,
  via: null,
});
const plan = {
  routes: [
    route("r2", ["safest"], 8, 84),
    route("r1", ["fastest", "shortest"], 7, 80),
  ],
  notes: ["Demo estimate."],
};
const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ data }),
});
const contact = {
  id: "c1",
  user_id: "u1",
  name: "Asha",
  phone_number: "+919876543210",
  relationship: null,
  alert_enabled: true,
  created_at: 1,
  updated_at: 1,
};
const extra = { hotspots, tileUrl: "x", emergencyNumber: "112" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("trip planner", () => {
  async function findRoutes(
    startJourney = vi.fn().mockResolvedValue(null),
    contacts = [contact],
  ) {
    mocks.fetch.mockResolvedValue(ok(plan));
    render(
      <TripPlan
        contacts={contacts}
        pending={false}
        error={null}
        startJourney={startJourney}
        extra={extra}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Find safest route/ }));
    await screen.findByText("Your journey");
    return startJourney;
  }

  it("asks for the places, mode, departure and company, then lists labelled routes with ETA and safety", async () => {
    mocks.fetch.mockResolvedValue(ok(plan));
    render(
      <TripPlan
        contacts={[contact]}
        pending={false}
        error={null}
        startJourney={vi.fn()}
        extra={extra}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Plan your trip" }),
    ).toBeInTheDocument();
    for (const m of ["Walk", "Cab", "Bus", "Metro"])
      expect(screen.getByRole("radio", { name: m })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Walk" }));
    fireEvent.click(screen.getByRole("button", { name: /Find safest route/ }));
    await screen.findByText("Your journey");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({
      from: { lat: 12.9352 },
      to: { lat: 12.9784 },
    });
    expect(screen.getByText("Route 1 (Safest)")).toBeInTheDocument();
    expect(
      screen.getByText("Route 2 (Fastest · Shortest)"),
    ).toBeInTheDocument();
    // 6 km on foot is 75 minutes, not the 8 minutes a cab takes.
    expect(screen.getAllByText("75 min").length).toBeGreaterThan(0);
  });

  it("starts a journey with the chosen route's ETA and all sharing contacts", async () => {
    const start = await findRoutes(vi.fn().mockResolvedValue(null));
    fireEvent.click(screen.getByRole("button", { name: /Start journey/ }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    const arg = start.mock.calls[0][0];
    expect(arg).toMatchObject({
      destination: "Indiranagar, Bengaluru",
      origin: "Koramangala, Bengaluru",
      contact_ids: ["c1"],
    });
    expect(arg.expected_arrival_at).toBeGreaterThan(Date.now() + 5 * 60_000);
  });

  it("won't start without a sharing contact and points to where to add one", async () => {
    await findRoutes(vi.fn(), []);
    expect(
      screen.getByRole("button", { name: /Start journey/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: /Manage trusted contacts/ }),
    ).toHaveAttribute("href", "/contacts");
  });

  it("shows a server error instead of routes", async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: {
          code: "ROUTING_UNAVAILABLE",
          message: "Route planning is unavailable right now.",
        },
      }),
    });
    render(
      <TripPlan
        contacts={[contact]}
        pending={false}
        error={null}
        startJourney={vi.fn()}
        extra={extra}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Find safest route/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
    expect(screen.queryByText("Your journey")).not.toBeInTheDocument();
  });
});

describe("live trip screen", () => {
  const journey = {
    id: "j1",
    status: "active",
    destination: "Indiranagar, Bengaluru",
    expected_arrival_at: Date.now() + 20 * 60_000,
    contact_ids: ["c1"],
  } as Journey;

  it("shows ETA, a one-tap share button and the nearest help, and keeps SOS one tap away", async () => {
    sessionStorage.setItem(
      "sakhi.trip.plan",
      JSON.stringify({
        journeyId: "j1",
        mode: "cab",
        from: { lat: 12.93, lon: 77.62, label: "A" },
        to: { lat: 12.97, lon: 77.64, label: "B" },
        route: route("r2", ["safest"], 8, 84),
        summary: "Route 1 (Safest), 6.0 km, 8 min by cab",
      }),
    );
    mocks.fetch.mockResolvedValue(
      ok({
        services: [
          {
            id: "a",
            category: "police",
            name: "P",
            lat: 0,
            lon: 0,
            phone: null,
            hours: null,
            distance_m: 450,
            synthetic: false,
          },
          {
            id: "b",
            category: "women_help",
            name: "W",
            lat: 0,
            lon: 0,
            phone: "181",
            hours: null,
            distance_m: 900,
            synthetic: true,
          },
        ],
      }),
    );
    render(
      <TripLive
        journey={journey}
        contactNames={["Asha"]}
        now={Date.now()}
        extra={extra}
      />,
    );
    expect(screen.getByText("20 min")).toBeInTheDocument();
    expect(screen.getByText("6.0 km")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Share my journey/ }),
    ).toBeEnabled();
    expect(screen.getByText(/to Asha/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("450 m")).toBeInTheDocument());
    expect(screen.getByText("900 m")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Emergency SOS/ })).toHaveAttribute(
      "href",
      "/dashboard#sos",
    );
    expect(String(mocks.fetch.mock.calls[0][0])).toContain(
      "/api/services/nearby?lat=12.970&lon=77.640",
    );
  });

  it("flags a check-in when the arrival time has passed", () => {
    render(
      <TripLive
        journey={{ ...journey, status: "check_in_due" }}
        contactNames={["Asha"]}
        now={Date.now()}
        extra={extra}
      />,
    );
    expect(screen.getByText("Due")).toBeInTheDocument();
    expect(screen.getByText("Check in")).toBeInTheDocument();
  });
});
