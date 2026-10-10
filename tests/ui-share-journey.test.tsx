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
import { ShareJourney } from "@/components/share-journey";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), location: vi.fn() }));
vi.mock("@/lib/location", () => ({ getOptionalLocation: mocks.location }));

const share = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  journey_id: "j1",
  created_at: Date.now(),
  shared_location: true,
  expected_arrival_at: Date.now() + 20 * 60_000,
  deliveries: [{ contact_name: "Asha", status: "simulated", code: null }],
  ...over,
});
const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ data }),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.location.mockResolvedValue({
    location: {
      latitude: 12.97,
      longitude: 77.59,
      accuracy: 10,
      captured_at: Date.now(),
    },
    reason: "available",
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("one-tap share journey", () => {
  it("sends ETA, route and the current location in a single tap, and says it was only simulated", async () => {
    mocks.fetch.mockResolvedValue(ok(share()));
    render(
      <ShareJourney
        journeyId="j1"
        contactNames={["Asha", "Ravi"]}
        routeSummary="Safest route, 6.4 km, 8 min by cab"
      />,
    );
    expect(
      screen.getByText(/ETA, route and live location to Asha, Ravi/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Share my journey/ }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Simulated"),
    );
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("/api/journeys/j1/share");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      route_summary: "Safest route, 6.4 km, 8 min by cab",
      location: { latitude: 12.97, longitude: 77.59 },
    });
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole("status")).toHaveTextContent(
      "includes your location",
    );
    expect(
      screen.getByRole("button", { name: /Share an update/ }),
    ).toBeInTheDocument();
  });

  it("still shares when location is unavailable, and says so", async () => {
    mocks.location.mockResolvedValue({ location: null, reason: "denied" });
    mocks.fetch.mockResolvedValue(ok(share({ shared_location: false })));
    render(<ShareJourney journeyId="j1" contactNames={["Asha"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Share my journey/ }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("no location"),
    );
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).location).toBeNull();
  });

  it("reuses the request id after a network failure so a retry can't send twice", async () => {
    mocks.fetch
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(ok(share()));
    render(<ShareJourney journeyId="j1" contactNames={["Asha"]} />);
    const tap = () =>
      fireEvent.click(
        screen.getByRole("button", { name: /Share my journey|Sharing/ }),
      );
    tap();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    tap();
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    const keys = mocks.fetch.mock.calls.map(
      (c) => JSON.parse(c[1].body).idempotency_key,
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it("is disabled with an explanation when there is nobody to tell", () => {
    render(<ShareJourney journeyId="j1" contactNames={[]} />);
    expect(
      screen.getByRole("button", { name: /Share my journey/ }),
    ).toBeDisabled();
    expect(screen.getByText(/Add a trusted contact/)).toBeInTheDocument();
  });
});
