// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("optional bounded location", () => {
  it.each([-61000, 31000])(
    "rejects stale or future timestamp offset %s",
    async (offset) => {
      vi.stubGlobal("navigator", {
        geolocation: {
          getCurrentPosition: (success: (value: unknown) => void) =>
            success({
              coords: { latitude: 28.6, longitude: 77.2, accuracy: 30 },
              timestamp: Date.now() + offset,
            }),
        },
      });
      const { getOptionalLocation } = await import("@/lib/location");
      expect(await getOptionalLocation(true)).toEqual({
        location: null,
        reason: "unavailable",
      });
    },
  );

  it("never accesses location without explicit consent", async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    const { getOptionalLocation } = await import("@/lib/location");
    expect(await getOptionalLocation(false)).toEqual({
      location: null,
      reason: "not-requested",
    });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("returns a valid timestamped location", async () => {
    const timestamp = Date.now();
    const getCurrentPosition = vi.fn((success) =>
      success({
        coords: { latitude: 28.6, longitude: 77.2, accuracy: 30 },
        timestamp,
      }),
    );
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    const { getOptionalLocation } = await import("@/lib/location");
    expect(await getOptionalLocation(true)).toEqual({
      location: {
        latitude: 28.6,
        longitude: 77.2,
        accuracy: 30,
        captured_at: timestamp,
      },
      reason: "available",
    });
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 3000 },
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not re-prompt after permission denial", async () => {
    const getCurrentPosition = vi.fn((_success, error) => error({ code: 1 }));
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    const { getOptionalLocation } = await import("@/lib/location");
    expect(await getOptionalLocation(true)).toEqual({
      location: null,
      reason: "denied",
    });
    expect(await getOptionalLocation(true)).toEqual({
      location: null,
      reason: "denied",
    });
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });

  it("resolves after three seconds even if the browser never calls back", async () => {
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition: vi.fn() },
    });
    const { getOptionalLocation } = await import("@/lib/location");
    const result = getOptionalLocation(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toEqual({ location: null, reason: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a late successful callback after the timeout", async () => {
    let success: (value: unknown) => void = () => {};
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: vi.fn((callback) => {
          success = callback;
        }),
      },
    });
    const { getOptionalLocation } = await import("@/lib/location");
    const result = getOptionalLocation(true);
    await vi.advanceTimersByTimeAsync(3000);
    success({
      coords: { latitude: 28.6, longitude: 77.2, accuracy: 30 },
      timestamp: Date.now(),
    });
    expect(await result).toEqual({ location: null, reason: "timeout" });
  });

  it("handles unsupported APIs and synchronous browser errors", async () => {
    vi.stubGlobal("navigator", {});
    const { getOptionalLocation } = await import("@/lib/location");
    expect(await getOptionalLocation(true)).toEqual({
      location: null,
      reason: "unsupported",
    });
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: () => {
          throw new Error("Not available");
        },
      },
    });
    expect(await getOptionalLocation(true)).toEqual({
      location: null,
      reason: "unavailable",
    });
  });

  it.each([2, 3])(
    "handles browser error code %s without blocking SOS",
    async (code) => {
      vi.stubGlobal("navigator", {
        geolocation: {
          getCurrentPosition: (
            _success: unknown,
            error: (value: { code: number }) => void,
          ) => error({ code }),
        },
      });
      const { getOptionalLocation } = await import("@/lib/location");
      expect(await getOptionalLocation(true)).toEqual({
        location: null,
        reason: code === 3 ? "timeout" : "unavailable",
      });
    },
  );

  it.each([
    { latitude: 91, longitude: 20, accuracy: 5 },
    { latitude: 12, longitude: Infinity, accuracy: 5 },
    { latitude: 12, longitude: 20, accuracy: -1 },
  ])("rejects invalid coordinates %j", async (coords) => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (success: (value: unknown) => void) =>
          success({ coords, timestamp: Date.now() }),
      },
    });
    const { getOptionalLocation } = await import("@/lib/location");
    expect(await getOptionalLocation(true)).toEqual({
      location: null,
      reason: "unavailable",
    });
  });
});
