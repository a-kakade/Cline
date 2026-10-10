// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationPicker } from "@/components/location-picker";
import { NearbyServices } from "@/components/nearby-services";
import { compareRoutes, formatDistance, telHref } from "@/lib/map-client";
import type { Place, PlacesResult } from "@/lib/places-types";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ data }),
});
const fail = (status: number, message: string) => ({
  ok: false,
  status,
  json: async () => ({ error: { code: "UNAVAILABLE", message } }),
});
const place = (over: Partial<Place> = {}): Place => ({
  id: "osm:node/1",
  category: "police",
  name: null,
  lat: 28.6,
  lon: 77.2,
  distance_m: 450,
  address: null,
  phone: null,
  opening_hours: null,
  last_confirmed: null,
  source: "osm",
  source_url: "https://www.openstreetmap.org/node/1",
  verified: false,
  verification_note: null,
  ...over,
});
const result = (over: Partial<PlacesResult> = {}): PlacesResult => ({
  places: [place()],
  sources: [
    {
      category: "police",
      provider: "overpass",
      status: "fresh",
      fetched_at: 1_700_000_000_000,
    },
  ],
  query: { radius_m: 2000, categories: ["police"] },
  attribution: "© OpenStreetMap contributors (ODbL)",
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("map client helpers", () => {
  it("sends only coordinates when comparing routes", async () => {
    mocks.fetch.mockResolvedValue(ok({ routes: [], provider: {}, notes: [] }));
    const picked = { lat: 28.6, lon: 77.2, source: "city", label: "Delhi" };
    await compareRoutes(
      picked,
      { lat: 28.7, lon: 77.3, ...({ extra: 1 } as object) },
      false,
    );
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body).toEqual({
      from: { lat: 28.6, lon: 77.2 },
      to: { lat: 28.7, lon: 77.3 },
      include_demo: false,
    });
  });

  it("only builds tel: links from plausible phone numbers and strips everything else", () => {
    expect(telHref("+91 11 2345 6789")).toBe("tel:+911123456789");
    expect(telHref("011-2345678; 011-9999999")).toBe("tel:0112345678");
    for (const bad of [
      null,
      "",
      "javascript:alert(1)",
      "call me",
      "12",
      "+91 98765 43210 ext <script>",
    ])
      expect(telHref(bad)).toBeNull();
  });

  it("formats distances", () => {
    expect(formatDistance(450)).toBe("450 m");
    expect(formatDistance(1500)).toBe("1.5 km");
    expect(formatDistance(12_000)).toBe("12 km");
  });
});

describe("NearbyServices states", () => {
  it("asks for a location first, never searches without one, and keeps 112 visible", () => {
    render(<NearbyServices point={null} emergencyNumber="112" />);
    expect(
      screen.getByText(/Choose where to search above/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Call 112/ })).toHaveAttribute(
      "href",
      "tel:112",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("shows unnamed places and unmapped details as 'Not mapped', never invented values", async () => {
    mocks.fetch.mockResolvedValue(ok(result()));
    render(
      <NearbyServices point={{ lat: 28.6, lon: 77.2 }} emergencyNumber="112" />,
    );
    expect(
      await screen.findByText("Unnamed (police stations)"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not mapped")).toHaveLength(3);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(
      screen.getByText(
        /mapped by OpenStreetMap contributors \(not verified by SAKHI\)/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Call$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open in maps app/ }),
    ).toHaveAttribute("href", "geo:28.6,77.2?q=28.6,77.2");
  });

  it("labels Safe Havens by verification and demo entries as not real", async () => {
    mocks.fetch.mockResolvedValue(
      ok(
        result({
          places: [
            place({
              id: "sakhi:1",
              category: "safe_haven",
              name: "Verified Shop",
              source: "sakhi_safe_haven",
              verified: true,
              verification_note: "Verified: visit",
              phone: "+91 98765 43210",
            }),
            place({
              id: "sakhi:2",
              category: "safe_haven",
              name: "DEMO Haven",
              source: "demo",
              verification_note:
                "Demonstration entry — not a real participating location.",
            }),
          ],
        }),
      ),
    );
    render(
      <NearbyServices
        point={{ lat: 28.6, lon: 77.2 }}
        emergencyNumber="112"
        includeDemo
      />,
    );
    expect(await screen.findByText("Verified Shop")).toBeInTheDocument();
    expect(screen.getByText("Verified Safe Haven ·")).toBeInTheDocument();
    expect(screen.getByText("DEMO — not a real place ·")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Call$/ })).toHaveAttribute(
      "href",
      "tel:+919876543210",
    );
    expect(String(mocks.fetch.mock.calls[0][0])).toContain("include_demo=1");
  });

  it("distinguishes an empty result from a failed source, and a stale copy from fresh data", async () => {
    mocks.fetch.mockResolvedValue(
      ok(
        result({
          places: [],
          sources: [
            {
              category: "police",
              provider: "overpass",
              status: "failed",
              fetched_at: null,
              error: "PROVIDER_TIMEOUT",
            },
            {
              category: "hospital",
              provider: "overpass",
              status: "stale",
              fetched_at: 1_700_000_000_000,
              error: "PROVIDER_RATE_LIMITED",
            },
          ],
          query: { radius_m: 2000, categories: ["police", "hospital"] },
        }),
      ),
    );
    render(
      <NearbyServices point={{ lat: 28.6, lon: 77.2 }} emergencyNumber="112" />,
    );
    expect(
      await screen.findByText("Some map data couldn’t be refreshed."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not mean no help exists/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Where this comes from"));
    expect(
      screen.getByText(
        /Police stations: couldn’t load — the map data service was too slow/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Hospitals: showing older data from .* rate-limiting/),
    ).toBeInTheDocument();
  });

  it("explains a request failure, offers retry, and keeps the emergency call", async () => {
    mocks.fetch.mockResolvedValueOnce(
      fail(503, "This request could not be completed."),
    );
    mocks.fetch.mockResolvedValueOnce(ok(result()));
    render(
      <NearbyServices point={{ lat: 28.6, lon: 77.2 }} emergencyNumber="112" />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be completed",
    );
    expect(
      screen.getByText(/Emergency calling above still works/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("Unnamed (police stations)"),
    ).toBeInTheDocument();
  });

  it("re-queries when categories change and ignores stale responses", async () => {
    let first: (v: unknown) => void = () => {};
    mocks.fetch.mockImplementationOnce(() => new Promise((r) => (first = r)));
    mocks.fetch.mockResolvedValueOnce(
      ok(result({ places: [place({ name: "Newer" })] })),
    );
    render(
      <NearbyServices point={{ lat: 28.6, lon: 77.2 }} emergencyNumber="112" />,
    );
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText("Bus stops"));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Newer")).toBeInTheDocument();
    first(ok(result({ places: [place({ name: "Older" })] })));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText("Older")).not.toBeInTheDocument();
    expect(screen.getByText("Newer")).toBeInTheDocument();
  });
});

describe("LocationPicker", () => {
  it("treats denied permission as a normal outcome and never reports a position", async () => {
    const getCurrentPosition = vi.fn(
      (_ok: unknown, err: (e: { code: number }) => void) => err({ code: 1 }),
    );
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    const onChange = vi.fn();
    render(<LocationPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(
      await screen.findByText(/permission was denied/),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back after a timeout even if the browser never answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition: vi.fn() },
    });
    render(<LocationPicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8100);
    });
    expect(screen.getByText(/didn’t arrive in time/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("offers city centres and states that the position is not saved", () => {
    const onChange = vi.fn();
    render(<LocationPicker value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Or choose a city centre"), {
      target: { value: "Mumbai" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ source: "city", label: "Mumbai", lat: 19.076 }),
    );
    cleanup();
    render(
      <LocationPicker
        value={{
          lat: 1,
          lon: 2,
          source: "device",
          label: "Your device location",
        }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText(/isn’t saved/)).toBeInTheDocument();
  });
});
