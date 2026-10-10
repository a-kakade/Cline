// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "@/components/auth-form";
import { SignOutButton } from "@/components/sign-out-button";
import { SiteHeader } from "@/components/site-header";
import { SimulationNotice } from "@/components/simulation-notice";
import HomePage from "@/app/page";
import AuthPage from "@/app/auth/page";
import DashboardPage from "@/app/dashboard/page";
import RootLayout from "@/app/layout";
import Loading from "@/app/loading";
import ErrorPage from "@/app/error";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  useSession: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(),
  getSession: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: mocks.signIn },
    signUp: { email: mocks.signUp },
    signOut: mocks.signOut,
    useSession: mocks.useSession,
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
  usePathname: () => "/auth",
  redirect: mocks.redirect,
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/server/auth", () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession } }),
}));

const user = { id: "user-1", name: "Asha", email: "asha@example.com" };
const password = "A-long-test-password!";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.useSession.mockReturnValue({ data: null, isPending: false });
  mocks.signIn.mockResolvedValue({ data: { user }, error: null });
  mocks.signUp.mockResolvedValue({ data: { user }, error: null });
  mocks.signOut.mockResolvedValue({ data: { success: true }, error: null });
  mocks.getSession.mockResolvedValue(null);
  mocks.headers.mockResolvedValue(new Headers({ cookie: "session=test" }));
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function fillCredentials() {
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: user.email },
  });
  fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
    target: { value: password },
  });
}

describe("foundation navigation and truthful content", () => {
  it("keeps the configured emergency link available while checking a session", () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: true });
    render(<SiteHeader emergencyNumber="112" />);
    expect(screen.getByRole("link", { name: "Call 112" })).toHaveAttribute(
      "href",
      "tel:112",
    );
    expect(
      screen.getByRole("status", { name: "Checking session" }),
    ).toBeInTheDocument();
  });

  it("shows real session-aware navigation without hiding emergency calling", () => {
    mocks.useSession.mockReturnValue({ data: { user }, isPending: false });
    render(<SiteHeader emergencyNumber="999" />);
    expect(screen.getByRole("link", { name: "My account" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("link", { name: "Call 999" })).toHaveAttribute(
      "href",
      "tel:999",
    );
    expect(
      screen.queryByRole("link", { name: "Sign in" }),
    ).not.toBeInTheDocument();
  });

  it("passes the server emergency setting through the root layout and provides a skip link", () => {
    vi.stubEnv("EMERGENCY_NUMBER", "+44112");
    const markup = renderToStaticMarkup(
      <RootLayout>
        <p>Page content</p>
      </RootLayout>,
    );
    expect(markup).toContain('href="tel:+44112"');
    expect(markup).toContain('href="#main-content"');
    expect(markup).toContain('id="main-content"');
    expect(markup).toContain('lang="en"');
  });

  it.each(["", "invalid-number", "javascript:alert(1)"])(
    "falls back to 112 for unsafe or empty configuration %s",
    (number) => {
      vi.stubEnv("EMERGENCY_NUMBER", number);
      expect(
        renderToStaticMarkup(
          <RootLayout>
            <p>Content</p>
          </RootLayout>,
        ),
      ).toContain('href="tel:112"');
    },
  );

  it("links the landing page to real account entry points without claiming to dispatch help", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "confidence",
    );
    expect(
      screen.getByRole("link", { name: "Create your account" }),
    ).toHaveAttribute("href", "/auth?mode=signup");
    expect(
      screen.getByRole("link", { name: "Already a member? Sign in" }),
    ).toHaveAttribute("href", "/auth");
    expect(
      screen.getByRole("complementary", { name: "About this build" }),
    ).toHaveTextContent(
      "does not send alerts, share your location, or dispatch help",
    );
  });

  it("only labels configured non-production simulation as simulation", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NOTIFICATION_PROVIDER", "simulation");
    const { rerender } = render(<SimulationNotice />);
    expect(
      screen.getByText("Local simulation. No real alerts."),
    ).toBeInTheDocument();
    vi.stubEnv("NODE_ENV", "production");
    rerender(<SimulationNotice />);
    expect(
      screen.getByText("Notifications disabled. No real alerts."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Local simulation. No real alerts."),
    ).not.toBeInTheDocument();
  });
});

describe("Better Auth account form", () => {
  it("signs in through the auth client before navigating", async () => {
    render(<AuthForm />);
    fillCredentials();
    fireEvent.submit(
      screen.getByRole("form", { name: "Sign in to your account" }),
    );
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/dashboard"),
    );
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith({
      email: user.email,
      password,
    });
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("creates an account through the real client contract with server-aligned password rules", async () => {
    render(<AuthForm initialMode="signup" />);
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "  Asha  " },
    });
    fillCredentials();
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
      "minLength",
      "12",
    );
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
      "maxLength",
      "128",
    );
    expect(
      screen.getByLabelText("Password", { exact: true }),
    ).toHaveAccessibleDescription(/12–128 characters/);
    fireEvent.submit(screen.getByRole("form", { name: "Create your account" }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/dashboard"),
    );
    expect(mocks.signUp).toHaveBeenCalledExactlyOnceWith({
      name: user.name,
      email: user.email,
      password,
    });
  });

  it("requires a non-whitespace name before creating an account", async () => {
    render(<AuthForm initialMode="signup" />);
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "   " },
    });
    fillCredentials();
    fireEvent.submit(screen.getByRole("form", { name: "Create your account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please enter your name.",
    );
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("focuses failed sign-in feedback and never bypasses authentication", async () => {
    mocks.signIn.mockResolvedValue({
      error: { message: "Invalid credentials" },
    });
    render(<AuthForm />);
    fillCredentials();
    fireEvent.submit(
      screen.getByRole("form", { name: "Sign in to your account" }),
    );
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("We couldn’t sign you in.");
    await waitFor(() => expect(error).toHaveFocus());
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not navigate after rejected sign-up", async () => {
    mocks.signUp.mockResolvedValue({ error: { message: "Rejected" } });
    render(<AuthForm initialMode="signup" />);
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: user.name },
    });
    fillCredentials();
    fireEvent.submit(screen.getByRole("form", { name: "Create your account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t create your account.",
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("handles network failures without exposing internal errors", async () => {
    mocks.signIn.mockRejectedValue(new Error("Internal sensitive detail"));
    render(<AuthForm />);
    fillCredentials();
    fireEvent.submit(
      screen.getByRole("form", { name: "Sign in to your account" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check your connection and try again.",
    );
    expect(
      screen.queryByText("Internal sensitive detail"),
    ).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("disables controls and prevents duplicate requests while submitting", async () => {
    let resolve: (value: { error: null }) => void = () => {
      throw new Error("Request not started");
    };
    mocks.signIn.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<AuthForm />);
    fillCredentials();
    const form = screen.getByRole("form", { name: "Sign in to your account" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.signIn).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    expect(screen.getByLabelText("Email address")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeDisabled();
    resolve({ error: null });
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/dashboard"),
    );
  });

  it("offers a labelled password visibility toggle and resets secrets when switching modes", () => {
    render(<AuthForm />);
    const input = screen.getByLabelText("Password", { exact: true });
    fireEvent.change(input, { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText("Password", { exact: true })).toHaveValue("");
    expect(screen.getByLabelText("Your name")).toBeRequired();
  });
});

describe("session enforcement and sign-out", () => {
  it("redirects unauthenticated dashboard requests to auth on the server", async () => {
    await expect(DashboardPage()).rejects.toThrow("REDIRECT:/auth");
    expect(mocks.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    });
    expect(mocks.redirect).toHaveBeenCalledWith("/auth");
  });

  it("does not expose dashboard content when the session service fails", async () => {
    mocks.getSession.mockRejectedValue(new Error("Service unavailable"));
    await expect(DashboardPage()).rejects.toThrow("Service unavailable");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("shows only the authenticated account details", async () => {
    mocks.getSession.mockResolvedValue({ user });
    render(await DashboardPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Welcome, Asha.",
    );
    const details = screen.getByRole("region", { name: "Your details" });
    expect(within(details).getByText(user.email)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects an authenticated visitor away from the auth page", async () => {
    mocks.getSession.mockResolvedValue({ user });
    await expect(
      AuthPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("opens sign-up directly from the landing page query", async () => {
    render(
      await AuthPage({ searchParams: Promise.resolve({ mode: "signup" }) }),
    );
    expect(
      screen.getByRole("form", { name: "Create your account" }),
    ).toBeInTheDocument();
  });

  it("signs out using Better Auth before navigating to auth", async () => {
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/auth"));
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("keeps the session view in place if sign-out fails", async () => {
    mocks.signOut.mockResolvedValue({ error: { message: "Failed" } });
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please try again before leaving this device.",
    );
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });

  it("handles an unreachable sign-out service without pretending success", async () => {
    mocks.signOut.mockRejectedValue(new Error("Network error"));
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please try signing out again.",
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});

describe("accessible loading and recovery", () => {
  it("announces loading and points to emergency access", () => {
    render(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "The emergency call link remains available above.",
    );
  });

  it("offers retry without displaying raw error details", () => {
    const reset = vi.fn();
    render(
      <ErrorPage error={new Error("Secret database details")} reset={reset} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Something went wrong.",
    );
    expect(
      screen.queryByText("Secret database details"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
