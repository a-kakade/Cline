import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { Alert } from "../../src/lib/emergency-types";

async function register(page: Page, enabledContact = true) {
  const signup = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin: "http://localhost:3000" },
    data: {
      name: "SOS Browser User",
      email: `sos-${randomUUID()}@example.test`,
      password: randomBytes(24).toString("base64url"),
    },
  });
  expect(signup.ok()).toBe(true);
  if (enabledContact) {
    const contact = await page.request.post("/api/contacts", {
      headers: { origin: "http://localhost:3000" },
      data: {
        name: "Synthetic Browser Contact",
        phone_number: "9876543210",
        alert_enabled: true,
      },
    });
    expect(contact.status()).toBe(201);
  }
}

async function savedAlert(page: Page): Promise<Alert> {
  const id = new URL(page.url()).pathname.split("/").at(-1);
  const response = await page.request.get(`/api/sos/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).data as Alert;
}

test("real SOS records allowed location and truthful simulation status across refresh", async ({
  page,
  context,
}, testInfo) => {
  await register(page);
  await context.grantPermissions(["geolocation"], {
    origin: "http://localhost:3000",
  });
  await context.setGeolocation({
    latitude: 28.6139,
    longitude: 77.209,
    accuracy: 18,
  });
  await page.goto("/dashboard");
  // Check before any action that could scroll the viewport automatically.
  await expect(
    page.getByRole("button", { name: "Send SOS", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: testInfo.outputPath("dashboard-before-sos.png"),
    fullPage: false,
  });
  const include = page.getByRole("checkbox", {
    name: "Include my location",
    exact: true,
  });
  await expect(include).not.toBeChecked();
  await include.check();
  await page.getByRole("button", { name: "Send SOS", exact: true }).click();
  await expect(page).toHaveURL(/\/sos\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "SOS status",
  );
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Simulated — no message sent$/ }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "This was a local simulation only. No contact received a message, and no help was dispatched.",
      { exact: true },
    ),
  ).toBeVisible();
  const alert = await savedAlert(page);
  expect(alert).toMatchObject({
    status: "simulated",
    latitude: 28.6139,
    longitude: 77.209,
    location_accuracy_meters: 18,
  });
  expect(alert.location_captured_at).toBeGreaterThan(Date.now() - 60_000);
  expect(alert.deliveries).toEqual([
    expect.objectContaining({ status: "simulated", attempt_count: 1 }),
  ]);
  await page.reload();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Simulated — no message sent$/ }),
  ).toBeVisible();
  expect((await savedAlert(page)).id).toBe(alert.id);
  await page.screenshot({
    path: testInfo.outputPath("simulated-sos-status.png"),
    fullPage: true,
  });
  expect((await (await page.request.get("/api/sos")).json()).data).toHaveLength(
    1,
  );
  await expect(
    page
      .getByRole("banner")
      .getByRole("link", { name: "Call 112", exact: true }),
  ).toHaveAttribute("href", "tel:112");
});

test("real SOS continues without coordinates after denied location permission", async ({
  page,
  context,
}) => {
  await register(page);
  // An explicit empty permission grant yields denied geolocation rather than an
  // interactive permission prompt. The browser's geolocation API remains real.
  await context.grantPermissions([], { origin: "http://localhost:3000" });
  await page.goto("/dashboard");
  expect(
    await page.evaluate(
      async () =>
        (await navigator.permissions.query({ name: "geolocation" })).state,
    ),
  ).toBe("denied");
  await page
    .getByRole("checkbox", { name: "Include my location", exact: true })
    .check();
  await page.getByRole("button", { name: "Send SOS", exact: true }).click();
  await expect(page).toHaveURL(/\/sos\/[0-9a-f-]+$/);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Simulated — no message sent$/ }),
  ).toBeVisible();
  await expect(
    page.getByText("No location saved with this alert.", { exact: true }),
  ).toBeVisible();
  expect(await savedAlert(page)).toMatchObject({
    status: "simulated",
    latitude: null,
    longitude: null,
    location_captured_at: null,
    deliveries: [
      expect.objectContaining({ status: "simulated", attempt_count: 1 }),
    ],
  });
  await expect(
    page
      .getByRole("banner")
      .getByRole("link", { name: "Call 112", exact: true }),
  ).toBeVisible();
});

test("SOS without enabled contacts persists a truthful failed status", async ({
  page,
}) => {
  await register(page, false);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("checkbox", { name: "Include my location", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Send SOS", exact: true }).click();
  await expect(page).toHaveURL(/\/sos\/[0-9a-f-]+$/);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Failed — help is not confirmed$/ }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "No sharing-enabled contacts were configured. No message was sent.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(await savedAlert(page)).toMatchObject({
    status: "failed",
    reason: "NO_CONTACTS",
    deliveries: [],
    latitude: null,
  });
  await page.reload();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Failed — help is not confirmed$/ }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("banner")
      .getByRole("link", { name: "Call 112", exact: true }),
  ).toHaveAttribute("href", "tel:112");
});

test("an injected SOS API outage preserves emergency calling and the same retry request ID", async ({
  page,
}) => {
  await register(page);
  const requests: { idempotency_key: string; consent: boolean }[] = [];
  await page.route("**/api/sos", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "UNAVAILABLE",
          message: "Synthetic outage: emergency calling remains available.",
        },
      }),
    });
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Send SOS", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "No success is confirmed.",
  );
  await expect(page).toHaveURL(/\/dashboard$/);
  const emergency = page
    .getByRole("banner")
    .getByRole("link", { name: "Call 112", exact: true });
  await expect(emergency).toBeVisible();
  await expect(emergency).toHaveAttribute("href", "tel:112");
  await page
    .getByRole("button", { name: "Retry creating this alert", exact: true })
    .click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0].idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0].consent).toBe(true);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "No success is confirmed.",
  );
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Simulated|Delivery confirmed/ }),
  ).toHaveCount(0);
  // Browser interception is intentional only in this fault-injection test.
  // The real API confirms no alert was created by the intercepted attempts.
  expect(await (await page.request.get("/api/sos")).json()).toEqual({
    data: [],
  });
});
