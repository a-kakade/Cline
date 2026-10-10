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
import { EmergencyHelp } from "@/components/emergency-help";
import { JourneyGuardian } from "@/components/journey-guardian";
import type { Alert } from "@/lib/emergency-types";
import type { Journey } from "@/lib/journey-types";
import type { Contact } from "@/lib/schemas";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
const MIN = 60_000;
const contact = (over: Partial<Contact> = {}): Contact => ({
  id: "c1",
  user_id: "u1",
  name: "Asha",
  phone_number: "+919876543210",
  relationship: null,
  alert_enabled: true,
  created_at: 1,
  updated_at: 1,
  ...over,
});
const journey = (over: Partial<Journey> = {}): Journey => ({
  id: "j1",
  user_id: "u1",
  status: "active",
  origin: null,
  destination: "Hostel",
  expected_arrival_at: Date.now() + 30 * MIN,
  grace_period_minutes: 10,
  time_zone: null,
  last_known_latitude: null,
  last_known_longitude: null,
  last_location_accuracy_meters: null,
  last_location_updated_at: null,
  started_at: Date.now() - MIN,
  check_in_due_at: null,
  last_check_in_at: null,
  completed_at: null,
  cancelled_at: null,
  escalated_at: null,
  alert_id: null,
  all_clear_alert_id: null,
  created_at: 1,
  updated_at: 1,
  contact_ids: ["c1"],
  events: [{ kind: "started", created_at: 1 }],
  alert: null,
  ...over,
});
const ok = (data: unknown, status = 200) => ({
  ok: true,
  status,
  json: async () => ({ data }),
});
const fail = (status: number, code: string, message: string) => ({
  ok: false,
  status,
  json: async () => ({ error: { code, message } }),
});

function serve(opts: {
  contacts?: Contact[];
  journeys?: Journey[];
  monitor?: unknown;
  post?: (url: string, body: unknown) => unknown;
}) {
  mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST")
      return opts.post?.(url, JSON.parse(String(init.body))) ?? ok(journey());
    if (url === "/api/contacts") return ok(opts.contacts ?? [contact()]);
    if (url === "/api/journeys") return ok(opts.journeys ?? []);
    if (url === "/api/journeys/monitor")
      return ok(opts.monitor ?? { state: "ok", last_run_at: Date.now() });
    throw new Error(`unexpected ${url}`);
  });
}
async function ready() {
  render(<JourneyGuardian />);
  await waitFor(() =>
    expect(
      screen.queryByText("Loading your journeys…"),
    ).not.toBeInTheDocument(),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("emergency help", () => {
  it("offers 112 and 181 dialer links and does not imply police were contacted", () => {
    render(<EmergencyHelp />);
    expect(screen.getByRole("link", { name: /Call 112/ })).toHaveAttribute(
      "href",
      "tel:112",
    );
    expect(
      screen.getByRole("link", { name: /Women Helpline 181/ }),
    ).toHaveAttribute("href", "tel:181");
    expect(screen.getByText(/do not alert the police/)).toBeInTheDocument();
  });
});

describe("Journey Guardian start flow", () => {
  it("explains that sharing-enabled contacts are required", async () => {
    serve({ contacts: [contact({ alert_enabled: false })] });
    await ready();
    expect(
      screen.getByText("No sharing-enabled contacts yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Manage trusted contacts/ }),
    ).toHaveAttribute("href", "/contacts");
  });

  it("validates, shows exactly what will be shared and requires consent before starting", async () => {
    const posted: unknown[] = [];
    serve({
      post: (_url, body) => {
        posted.push(body);
        return ok(journey({ destination: "Hostel gate" }), 201);
      },
    });
    await ready();
    fireEvent.click(
      screen.getByRole("button", { name: "Review what will be shared" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a destination.");
    fireEvent.change(screen.getByLabelText("Destination"), {
      target: { value: "Hostel gate" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Review what will be shared" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Select at least one trusted contact.",
    );
    fireEvent.click(screen.getByLabelText(/Asha/));
    fireEvent.click(
      screen.getByRole("button", { name: "Review what will be shared" }),
    );

    expect(
      screen.getByRole("heading", { name: "Review what will be shared" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Hostel gate")).toBeInTheDocument();
    expect(screen.getByText("Not shared")).toBeInTheDocument();
    expect(screen.getByText(/Starting sends nothing/)).toBeInTheDocument();
    expect(screen.getByText(/does not call the police/)).toBeInTheDocument();
    const start = screen.getByRole("button", { name: "Start journey" });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I understand and agree/));
    expect(start).toBeEnabled();
    fireEvent.click(start);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      destination: "Hostel gate",
      contact_ids: ["c1"],
      consent: true,
      grace_period_minutes: 10,
      location: null,
    });
    expect(await screen.findByText("Journey started.")).toBeInTheDocument();
  });

  it("shows server errors and keeps the same request id for a safe retry", async () => {
    const keys: string[] = [];
    let attempts = 0;
    serve({
      post: (_url, body) => {
        keys.push((body as { idempotency_key: string }).idempotency_key);
        return ++attempts === 1
          ? fail(
              409,
              "JOURNEY_OPEN",
              "Complete or cancel your open journey before starting another.",
            )
          : ok(journey(), 201);
      },
    });
    await ready();
    fireEvent.change(screen.getByLabelText("Destination"), {
      target: { value: "Home" },
    });
    fireEvent.click(screen.getByLabelText(/Asha/));
    fireEvent.click(
      screen.getByRole("button", { name: "Review what will be shared" }),
    );
    fireEvent.click(screen.getByLabelText(/I understand and agree/));
    fireEvent.click(screen.getByRole("button", { name: "Start journey" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Complete or cancel your open journey",
    );
    fireEvent.click(screen.getByRole("button", { name: "Start journey" }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBe(keys[1]);
  });
});

describe("Journey Guardian active states", () => {
  it("lets the user check in, extend and complete an active journey", async () => {
    const calls: string[] = [];
    serve({
      journeys: [journey()],
      post: (url) => {
        calls.push(url);
        return ok(
          journey({
            status: url.endsWith("complete") ? "completed" : "active",
          }),
        );
      },
    });
    await ready();
    expect(screen.getByText(/Sharing with Asha/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I’m safe" }));
    await waitFor(() => expect(calls).toContain("/api/journeys/j1/check-in"));
    fireEvent.click(screen.getByRole("button", { name: "+30 min" }));
    await waitFor(() => expect(calls).toContain("/api/journeys/j1/extend"));
    fireEvent.click(screen.getByRole("button", { name: "I’ve arrived" }));
    await waitFor(() => expect(calls).toContain("/api/journeys/j1/complete"));
    expect(await screen.findByText(/Journey completed/)).toBeInTheDocument();
  });

  it("asks for confirmation before cancelling", async () => {
    const calls: string[] = [];
    serve({
      journeys: [journey()],
      post: (url) => (calls.push(url), ok(journey({ status: "cancelled" }))),
    });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Cancel journey" }));
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));
    await waitFor(() => expect(calls).toEqual(["/api/journeys/j1/cancel"]));
  });

  it("prompts clearly when a check-in is due and requires choosing a new arrival time", async () => {
    const bodies: unknown[] = [];
    serve({
      journeys: [
        journey({
          status: "check_in_due",
          expected_arrival_at: Date.now() - MIN,
        }),
      ],
      post: (_u, body) => (bodies.push(body), ok(journey())),
    });
    await ready();
    expect(screen.getByText("Are you safe?")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "I’m safe — continue journey" }),
    );
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(
      (bodies[0] as { expected_arrival_at: number }).expected_arrival_at,
    ).toBeGreaterThan(Date.now());
  });

  it("reports an escalation with the real delivery status and never claims police were contacted", async () => {
    const alert = {
      id: "a1",
      status: "simulated",
      kind: "journey_escalation",
      deliveries: [],
    } as unknown as Alert;
    serve({
      journeys: [
        journey({
          status: "escalated",
          alert_id: "a1",
          alert,
          escalated_at: Date.now(),
        }),
      ],
    });
    await ready();
    expect(screen.getByText("Simulated — no message sent")).toBeInTheDocument();
    expect(
      screen.getByText(/never means the police were contacted/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /See each contact/ }),
    ).toHaveAttribute("href", "/sos/a1");
    expect(
      screen.getByRole("button", { name: "I’m safe — close journey" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /\+15 min/ }),
    ).not.toBeInTheDocument();
  });

  it("does not show a scheduler warning at the top of the page", async () => {
    serve({ monitor: { state: "never", last_run_at: null } });
    await ready();
    expect(
      screen.queryByText(/Automatic escalation is not confirmed to be running/),
    ).not.toBeInTheDocument();
  });

  it("shows a retryable error when journeys cannot load, without blocking emergency links", async () => {
    mocks.fetch.mockImplementation(async (url: string) =>
      url === "/api/journeys"
        ? fail(503, "UNAVAILABLE", "This request could not be completed.")
        : ok([]),
    );
    await ready();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "could not be completed",
    );
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});
