import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function register(page: Page) {
  const signup = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin: "http://localhost:3000" },
    data: {
      name: "Journey Browser User",
      email: `journey-${randomUUID()}@example.test`,
      password: randomBytes(24).toString("base64url"),
    },
  });
  expect(signup.ok()).toBe(true);
  const contact = await page.request.post("/api/contacts", {
    headers: { origin: "http://localhost:3000" },
    data: {
      name: "Journey Contact",
      phone_number: "9876543210",
      alert_enabled: true,
    },
  });
  expect(contact.status()).toBe(201);
}

test("journeys require authentication while emergency calling stays available", async ({
  page,
}) => {
  await page.goto("/journeys");
  await expect(page).toHaveURL(/\/auth$/);
  await expect(
    page
      .getByRole("banner")
      .getByRole("link", { name: "Call 112", exact: true }),
  ).toHaveAttribute("href", "tel:112");
});

test("real journey: review, start, refresh, check in, extend, complete — with 112 and 181 always visible", async ({
  page,
}) => {
  await register(page);
  await page.goto("/journeys");
  await expect(
    page.getByRole("heading", { name: "Journey Guardian.", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Women Helpline 181/ }),
  ).toHaveAttribute("href", "tel:181");

  await page.getByLabel("Destination").fill("Library");
  await page.getByLabel(/Journey Contact/).check();
  await page
    .getByRole("button", { name: "Review what will be shared" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review what will be shared" }),
  ).toBeVisible();
  const start = page.getByRole("button", { name: "Start journey" });
  await expect(start).toBeDisabled();
  await page.getByLabel(/I understand and agree/).check();
  await start.click();
  await expect(page.getByRole("heading", { name: "To Library" })).toBeVisible();

  // Persistence: the server, not the tab, owns the journey.
  await page.reload();
  await expect(page.getByRole("heading", { name: "To Library" })).toBeVisible();
  const journeys = (await (await page.request.get("/api/journeys")).json())
    .data;
  expect(journeys).toHaveLength(1);
  expect(journeys[0]).toMatchObject({
    status: "active",
    destination: "Library",
  });

  await page.getByRole("button", { name: "I’m safe", exact: true }).click();
  await expect(
    page.getByText("Thanks — your check-in is recorded."),
  ).toBeVisible();
  const eta = journeys[0].expected_arrival_at;
  await page.getByRole("button", { name: "+30 min" }).click();
  await expect(
    page.getByText("Arrival time extended by 30 minutes."),
  ).toBeVisible();
  const after = (await (await page.request.get("/api/journeys")).json())
    .data[0];
  expect(after.expected_arrival_at).toBeGreaterThan(eta + 29 * 60_000);
  expect(after.events.map((e: { kind: string }) => e.kind)).toEqual([
    "started",
    "check-in",
    "extend",
  ]);

  await page.getByRole("button", { name: "I’ve arrived" }).click();
  await expect(page.getByText(/Journey completed/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Start a journey" }),
  ).toBeVisible();
  const done = (await (await page.request.get("/api/journeys")).json()).data[0];
  expect(done.status).toBe("completed");
  // Nothing was ever sent, since the journey ended before any deadline.
  expect(done.alert).toBeNull();
});

test("a second open journey is refused and cancellation needs confirmation", async ({
  page,
}) => {
  await register(page);
  const contacts = (await (await page.request.get("/api/contacts")).json())
    .data;
  const body = () => ({
    idempotency_key: randomUUID(),
    destination: "Station",
    expected_arrival_at: Date.now() + 30 * 60_000,
    grace_period_minutes: 10,
    contact_ids: [contacts[0].id],
    consent: true,
  });
  const headers = { origin: "http://localhost:3000" };
  expect(
    (
      await page.request.post("/api/journeys", { headers, data: body() })
    ).status(),
  ).toBe(201);
  expect(
    (
      await page.request.post("/api/journeys", { headers, data: body() })
    ).status(),
  ).toBe(409);
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Cancel journey" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm cancel" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep journey" }).click();
  await expect(page.getByRole("heading", { name: "To Station" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel journey" }).click();
  await page.getByRole("button", { name: "Confirm cancel" }).click();
  await expect(page.getByText("Journey cancelled.")).toBeVisible();
});
