import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("landing keeps emergency calling visible without an account", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const emergency = page
    .getByRole("banner")
    .getByRole("link", { name: "Call 112", exact: true });
  await expect(emergency).toBeVisible();
  await expect(emergency).toBeInViewport();
  await expect(emergency).toHaveAttribute("href", "tel:112");
  await expect(
    page.getByRole("link", { name: "Create your account", exact: true }),
  ).toHaveAttribute("href", "/auth?mode=signup");
  await expect(
    page.getByText(/does not place a call automatically/),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  // Inspect the dialer link only. Automated tests must never place emergency calls.
});

test("real signup, persisted session, logout, and login", async ({ page }) => {
  const name = "Foundation Browser User";
  const email = `browser-${randomUUID()}@example.test`;
  const password = randomBytes(24).toString("base64url");

  await page.goto("/auth?mode=signup");
  const signup = page.getByRole("form", {
    name: "Create your account",
    exact: true,
  });
  await signup.getByLabel("Your name", { exact: true }).fill(name);
  await signup.getByLabel("Email address", { exact: true }).fill(email);
  await signup.getByLabel("Password", { exact: true }).fill(password);
  await signup
    .getByRole("button", { name: "Create your account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  await expect(page.getByText(email, { exact: true })).toBeVisible();

  const session = await page.request.get("/api/auth/get-session");
  expect(session.ok()).toBe(true);
  expect(await session.json()).toMatchObject({ user: { email } });
  await page.reload();
  await expect(page.getByText(email, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/auth$/);
  expect(
    await (await page.request.get("/api/auth/get-session")).json(),
  ).toBeNull();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/auth$/);
  await expect(
    page
      .getByRole("banner")
      .getByRole("link", { name: "Call 112", exact: true }),
  ).toBeVisible();

  const signin = page.getByRole("form", {
    name: "Sign in to your account",
    exact: true,
  });
  await signin.getByLabel("Email address", { exact: true }).fill(email);
  await signin
    .getByLabel("Password", { exact: true })
    .fill("NotTheCorrectPassword123!");
  await signin.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(signin.getByRole("alert")).toBeVisible();
  await expect(signin.getByRole("alert")).toBeFocused();
  await expect(page).toHaveURL(/\/auth$/);
  await signin.getByLabel("Password", { exact: true }).fill(password);
  await signin.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/auth$/);
});
