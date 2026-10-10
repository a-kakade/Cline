// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNav } from "@/components/bottom-nav";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  pathname: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: mocks.useSession },
}));
vi.mock("next/navigation", () => ({ usePathname: mocks.pathname }));

beforeEach(() => {
  mocks.useSession.mockReturnValue({
    data: { user: { id: "u1" } },
    isPending: false,
  });
  mocks.pathname.mockReturnValue("/dashboard");
});

afterEach(cleanup);

describe("bottom navigation", () => {
  it("puts SOS in the bar, pointing at the SOS control rather than sending", () => {
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: /SOS/ })).toHaveAttribute(
      "href",
      "/dashboard#sos",
    );
  });

  it("links the four primary destinations and marks the current one", () => {
    mocks.pathname.mockReturnValue("/journeys");
    render(<BottomNav />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("link", { name: "Community" })).toHaveAttribute(
      "href",
      "/rooms",
    );
    expect(screen.getByRole("link", { name: "Trip" })).toHaveAttribute(
      "href",
      "/journeys",
    );
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute(
      "href",
      "/map",
    );
    expect(screen.getByRole("link", { name: "Trip" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("stays out of the way when signed out", () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: false });
    render(<BottomNav />);
    expect(
      screen.queryByRole("navigation", { name: "Primary" }),
    ).not.toBeInTheDocument();
  });
});
