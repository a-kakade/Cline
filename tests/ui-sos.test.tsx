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
import { SosControl } from "@/components/sos-control";
import { SosStatus } from "@/components/sos-status";
import SosPage from "@/app/sos/[id]/page";
import { ApiError } from "@/lib/api-client";
import type { Alert, AlertStatus } from "@/lib/emergency-types";
import type { LocationResult } from "@/lib/location";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  location: vi.fn(),
  push: vi.fn(),
  getSession: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  apiRequest: mocks.api,
}));
vi.mock("@/lib/location", () => ({ getOptionalLocation: mocks.location }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  redirect: mocks.redirect,
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/server/auth", () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession } }),
}));

const alert: Alert = {
  id: "alert-1",
  user_id: "user-1",
  kind: "sos",
  status: "created",
  reason: null,
  latitude: null,
  longitude: null,
  location_accuracy_meters: null,
  location_captured_at: null,
  message: "Please contact me.",
  created_at: 1000,
  updated_at: 2000,
  deliveries: [
    {
      id: "delivery-1",
      contact_id: "contact-1",
      status: "queued",
      code: null,
      attempt_count: 0,
      updated_at: 2000,
    },
  ],
};
const key = "11111111-1111-4111-8111-111111111111";
const withStatus = (status: AlertStatus): Alert => ({
  ...alert,
  status,
  deliveries: [],
});

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  mocks.location.mockResolvedValue({ location: null, reason: "not-requested" });
  mocks.api.mockImplementation((path: string, options?: RequestInit) =>
    Promise.resolve(
      path === "/api/sos" && !options
        ? []
        : options?.method === "POST" && path.endsWith("dispatch")
          ? withStatus("simulated")
          : alert,
    ),
  );
  mocks.headers.mockResolvedValue(new Headers());
  mocks.getSession.mockResolvedValue(null);
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("explicit SOS creation", () => {
  it("drops stale location only after an explicit LOCATION_TIME validation rejection", async () => {
    const location = {
      latitude: 28.6,
      longitude: 77.2,
      accuracy: 30,
      captured_at: Date.now(),
    };
    mocks.location.mockResolvedValue({ location, reason: "available" });
    let dispatchCount = 0;
    mocks.api.mockImplementation((path: string, options?: RequestInit) => {
      if (path.endsWith("dispatch")) {
        dispatchCount += 1;
        return dispatchCount === 1
          ? Promise.reject(
              new ApiError("Location too old", 400, "LOCATION_TIME"),
            )
          : Promise.resolve(withStatus("simulated"));
      }
      return Promise.resolve(options ? alert : []);
    });
    render(<SosControl emergencyNumber="112" />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Include my location" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send SOS" }));
    await waitFor(() => expect(dispatchCount).toBe(2));
    const dispatches = mocks.api.mock.calls.filter(([path]) =>
      path.endsWith("dispatch"),
    );
    expect(JSON.parse(dispatches[0][1].body)).toEqual({ location });
    expect(JSON.parse(dispatches[1][1].body)).toEqual({ location: null });
  });

  it("starts event creation and optional location concurrently, navigating as soon as saved", async () => {
    let resolveLocation: (value: LocationResult) => void = () => {};
    mocks.location.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLocation = resolve;
        }),
    );
    render(<SosControl emergencyNumber="112" />);
    expect(
      screen.getByRole("checkbox", { name: "Include my location" }),
    ).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Include my location" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send SOS" }));
    expect(mocks.api).toHaveBeenCalledWith(
      "/api/sos",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.location).toHaveBeenCalledWith(true);
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/sos/alert-1"),
    );
    expect(
      screen.getByRole("link", { name: "View alert status" }),
    ).toHaveAttribute("href", "/sos/alert-1");
    expect(
      mocks.api.mock.calls.some(([path]) => path.endsWith("dispatch")),
    ).toBe(false);
    await act(async () => {
      resolveLocation({ location: null, reason: "timeout" });
    });
    expect(mocks.api).toHaveBeenCalledWith(
      "/api/sos/alert-1/dispatch",
      expect.objectContaining({
        body: JSON.stringify({ location: null }),
        keepalive: true,
      }),
    );
  });

  it("does not request location without opt-in and guards double clicks", async () => {
    render(<SosControl emergencyNumber="112" />);
    const button = screen.getByRole("button", { name: "Send SOS" });
    expect(button).toHaveAccessibleDescription(/sharing-enabled contacts/);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
    expect(mocks.location).toHaveBeenCalledExactlyOnceWith(false);
    expect(
      mocks.api.mock.calls.filter(
        ([path, options]) => path === "/api/sos" && options?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("persists only the UUID and retries creation with exactly the same ID", async () => {
    mocks.api.mockImplementation((path: string, options?: RequestInit) =>
      options?.method === "POST"
        ? Promise.reject(new ApiError("Offline"))
        : Promise.resolve([]),
    );
    render(<SosControl emergencyNumber="999" />);
    fireEvent.click(screen.getByRole("button", { name: "Send SOS" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    const first = JSON.parse(
      mocks.api.mock.calls.find(([, options]) => options?.method === "POST")![1]
        .body,
    );
    expect(first).toEqual({
      idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      consent: true,
    });
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.getItem("sakhi.sos.pending-key")).toBe(
      first.idempotency_key,
    );
    expect(
      screen.getByRole("link", { name: "Need urgent help? Call 999" }),
    ).toHaveAttribute("href", "tel:999");
    fireEvent.click(
      screen.getByRole("button", { name: "Retry creating this alert" }),
    );
    await waitFor(() =>
      expect(
        mocks.api.mock.calls.filter(
          ([, options]) => options?.method === "POST",
        ),
      ).toHaveLength(2),
    );
    const attempts = mocks.api.mock.calls.filter(
      ([, options]) => options?.method === "POST",
    );
    expect(attempts[1][1].body).toBe(attempts[0][1].body);
  });

  it("resumes a pending UUID after reload without automatically sending", async () => {
    sessionStorage.setItem("sakhi.sos.pending-key", key);
    render(<SosControl emergencyNumber="112" />);
    const retry = await screen.findByRole("button", {
      name: "Retry creating this alert",
    });
    expect(mocks.api.mock.calls.every(([, options]) => !options?.method)).toBe(
      true,
    );
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    expect(mocks.api).toHaveBeenCalledWith(
      "/api/sos",
      expect.objectContaining({
        body: JSON.stringify({ idempotency_key: key, consent: true }),
      }),
    );
    expect(sessionStorage.getItem("sakhi.sos.pending-key")).toBeNull();
  });

  it("does not resend an already processed alert recovered by idempotency", async () => {
    mocks.api.mockImplementation((_path: string, options?: RequestInit) =>
      Promise.resolve(options ? withStatus("unknown") : []),
    );
    render(<SosControl emergencyNumber="112" />);
    fireEvent.click(screen.getByRole("button", { name: "Send SOS" }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/sos/alert-1"),
    );
    expect(
      mocks.api.mock.calls.some(([path]) => path.endsWith("dispatch")),
    ).toBe(false);
  });

  it("keeps SOS available when recent-alert loading fails", async () => {
    mocks.api.mockRejectedValue(new ApiError("Unavailable"));
    render(<SosControl emergencyNumber="112" />);
    expect(
      await screen.findByText(/Recent alerts couldn’t load/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send SOS" })).toBeEnabled();
  });

  it("retains the saved URL after dispatch failure rather than offering a new alert", async () => {
    mocks.api.mockImplementation((path: string, options?: RequestInit) =>
      path.endsWith("dispatch")
        ? Promise.reject(new ApiError("Provider outcome unknown"))
        : Promise.resolve(options ? alert : []),
    );
    render(<SosControl emergencyNumber="112" />);
    fireEvent.click(screen.getByRole("button", { name: "Send SOS" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The alert is saved, but sending is not confirmed.",
    );
    expect(
      screen.getByRole("link", { name: "View alert status" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alert saved" })).toBeDisabled();
  });
});

describe("saved SOS status", () => {
  it("shows loading and keeps direct emergency calling available when GET fails", async () => {
    let reject: (reason: unknown) => void = () => {};
    mocks.api.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    render(<SosStatus id="alert-1" emergencyNumber="112" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking your saved alert…",
    );
    expect(
      screen.getByRole("link", { name: "Call 112 for urgent help" }),
    ).toHaveAttribute("href", "tel:112");
    await act(async () => {
      reject(new ApiError("Offline"));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No outcome can be confirmed here.",
    );
    expect(
      screen.getByRole("button", { name: "Retry loading alert" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["simulated", "Simulated — no message sent"],
    ["accepted", "Accepted by provider — not confirmed delivered"],
    ["delivered", "Delivery confirmed by provider"],
    ["unknown", "Unknown — delivery cannot be confirmed"],
    ["failed", "Failed — help is not confirmed"],
    ["partial", "Mixed results — check each contact"],
  ] as const)(
    "renders truthful %s without provider retry",
    async (status, label) => {
      mocks.api.mockResolvedValue(withStatus(status));
      render(<SosStatus id="alert-1" emergencyNumber="112" />);
      expect(await screen.findByText(label)).toHaveAttribute("role", "status");
      expect(
        screen.queryByRole("button", {
          name: "Continue pending alert without location",
        }),
      ).not.toBeInTheDocument();
      expect(mocks.api).toHaveBeenCalledExactlyOnceWith("/api/sos/alert-1");
    },
  );

  it("does not dispatch from a status fetch and requires explicit continuation", async () => {
    render(<SosStatus id="alert-1" emergencyNumber="112" />);
    const resume = await screen.findByRole("button", {
      name: "Continue pending alert without location",
    });
    expect(mocks.api).toHaveBeenCalledExactlyOnceWith("/api/sos/alert-1");
    fireEvent.click(resume);
    fireEvent.click(resume);
    expect(
      await screen.findByText("Simulated — no message sent"),
    ).toBeInTheDocument();
    expect(
      mocks.api.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1);
    expect(mocks.api).toHaveBeenCalledWith(
      "/api/sos/alert-1/dispatch",
      expect.objectContaining({ body: JSON.stringify({ location: null }) }),
    );
  });

  it("refreshes from saved server state without creating another alert", async () => {
    mocks.api
      .mockResolvedValueOnce(withStatus("unknown"))
      .mockResolvedValueOnce(withStatus("delivered"));
    render(<SosStatus id="alert-1" emergencyNumber="112" />);
    await screen.findByText("Unknown — delivery cannot be confirmed");
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(
      await screen.findByText("Delivery confirmed by provider"),
    ).toBeInTheDocument();
    expect(mocks.api.mock.calls.every(([, options]) => !options?.method)).toBe(
      true,
    );
  });

  it("explains NO_CONTACTS with a contacts link", async () => {
    mocks.api.mockResolvedValue({
      ...withStatus("failed"),
      reason: "NO_CONTACTS",
    });
    render(<SosStatus id="alert-1" emergencyNumber="112" />);
    expect(
      await screen.findByText(
        "No sharing-enabled contacts were configured. No message was sent.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Manage trusted contacts" }),
    ).toHaveAttribute("href", "/contacts");
  });

  it("shows each anonymous delivery outcome and local timestamps", async () => {
    mocks.api.mockResolvedValue({
      ...alert,
      status: "partial",
      deliveries: [
        { ...alert.deliveries[0], status: "accepted", attempt_count: 1 },
        {
          ...alert.deliveries[0],
          id: "delivery-2",
          status: "failed",
          code: "PROVIDER_NOT_CONFIGURED",
          attempt_count: 1,
        },
      ],
    });
    render(<SosStatus id="alert-1" emergencyNumber="112" />);
    expect(
      await screen.findByRole("heading", { name: "Contact 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Contact 2" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Accepted by provider — not confirmed delivered"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Notification provider is not configured."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Times shown in your device’s local time/),
    ).toBeInTheDocument();
  });
});

describe("SOS status server gate", () => {
  it("requires a real server session", async () => {
    await expect(
      SosPage({ params: Promise.resolve({ id: "alert-1" }) }),
    ).rejects.toThrow("REDIRECT:/auth");
  });

  it("passes the configured emergency number and saved ID", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.api.mockResolvedValue(withStatus("simulated"));
    vi.stubEnv("EMERGENCY_NUMBER", "999");
    render(await SosPage({ params: Promise.resolve({ id: "alert-1" }) }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "SOS status.",
    );
    expect(
      screen.getByRole("link", { name: "Call 999 for urgent help" }),
    ).toHaveAttribute("href", "tel:999");
    await screen.findByText("Simulated — no message sent");
  });
});

describe("bounded API client", () => {
  it.each(["fetch", "body"])(
    "times out a stalled %s without automatically repeating it",
    async (stalled) => {
      vi.useFakeTimers();
      const actual =
        await vi.importActual<typeof import("@/lib/api-client")>(
          "@/lib/api-client",
        );
      const fetch = vi
        .fn()
        .mockImplementation(() =>
          stalled === "fetch"
            ? new Promise(() => {})
            : Promise.resolve({ ok: true, json: () => new Promise(() => {}) }),
        );
      vi.stubGlobal("fetch", fetch);
      const result = actual
        .apiRequest("/api/sos")
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(12000);
      expect(await result).toMatchObject({ code: "TIMEOUT", status: 0 });
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
