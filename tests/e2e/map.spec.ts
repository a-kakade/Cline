import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function register(page: Page) {
  const signup = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin: "http://localhost:3000" },
    data: {
      name: "Map Browser User",
      email: `map-${randomUUID()}@example.test`,
      password: randomBytes(24).toString("base64url"),
    },
  });
  expect(signup.ok()).toBe(true);
}

test("nearby help and the map require authentication while 112 stays available", async ({
  page,
}) => {
  for (const path of ["/services", "/map"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth$/);
    await expect(
      page
        .getByRole("banner")
        .getByRole("link", { name: "Call 112", exact: true }),
    ).toHaveAttribute("href", "tel:112");
  }
});

test("nearby help lists mapped places nearest-first and says what is not mapped", async ({
  page,
}) => {
  await register(page);
  await page.goto("/services");
  await expect(
    page.getByRole("link", { name: /In danger now\? Call 112/ }),
  ).toHaveAttribute("href", "tel:112");
  await expect(page.getByText("Choose where to search above")).toBeVisible();
  await page.getByLabel("Or choose a city centre").selectOption("Delhi");

  const list = page.getByRole("list", { name: "Nearby places, nearest first" });
  await expect(list).toBeVisible();
  const cards = list.getByRole("listitem");
  await expect(cards.first()).toBeVisible();
  // Real recorded data: a police HQ and a hospital are present; missing fields are stated, not invented.
  await expect(list.getByText("Delhi Police Headquarters")).toBeVisible();
  await expect(list.getByText("Not mapped").first()).toBeVisible();
  await expect(
    list
      .getByText(
        /mapped by OpenStreetMap contributors \(not verified by SAKHI\)/,
      )
      .first(),
  ).toBeVisible();
  const distances = await cards.locator(".pill").allTextContents();
  const meters = distances.map((d) =>
    d.endsWith(" km") ? parseFloat(d) * 1000 : parseFloat(d),
  );
  expect([...meters].sort((a, b) => a - b)).toEqual(meters);

  await page.getByText("Where this comes from").click();
  await expect(page.getByText(/© OpenStreetMap contributors/)).toBeVisible();
  await expect(
    page.getByText(/Police stations: (loaded|saved copy)/),
  ).toBeVisible();

  // Switching categories re-queries: the pharmacy comes from the stubbed provider.
  await page.getByLabel("Pharmacies").check();
  await expect(list.getByText("Test Pharmacy (e2e stub)")).toBeVisible();
  await expect(list.getByText(/A mapped pharmacy is a shop/)).toHaveCount(0);
  // A mapped pharmacy is never presented as a Safe Haven.
  await expect(list.getByText("Verified Safe Haven")).toHaveCount(0);
});

test("a map-data outage is reported honestly and emergency calling keeps working", async ({
  page,
}) => {
  await register(page);
  await page.goto("/services");
  await page.getByLabel("Or choose a city centre").selectOption("Patna"); // stub returns 504 here
  await expect(
    page.getByText("Some map data couldn’t be refreshed."),
  ).toBeVisible();
  await expect(
    page.getByText(/Nothing found within|no help exists/).first(),
  ).toBeVisible();
  await page.getByText("Where this comes from").click();
  await expect(
    page.getByText(/couldn’t load — the map data service was too slow/).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Call 112/ }).first(),
  ).toHaveAttribute("href", "tel:112");
  await expect(
    page.getByRole("link", { name: /Women Helpline 181/ }),
  ).toHaveAttribute("href", "tel:181");
});

test("denied device location falls back to choosing a city", async ({
  page,
  context,
}) => {
  await register(page);
  await context.grantPermissions([], { origin: "http://localhost:3000" });
  await page.goto("/services");
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByText(/permission was denied/)).toBeVisible();
  await page.getByLabel("Or choose a city centre").selectOption("Delhi");
  await expect(
    page.getByRole("list", { name: "Nearby places, nearest first" }),
  ).toBeVisible();
});

test("safety map: real map, honest area signals, report, demo labelling and route comparison", async ({
  page,
}) => {
  await register(page);
  await page.goto("/map");
  await expect(page.getByRole("region", { name: "Map" })).toBeVisible();
  await page.getByLabel("Or choose a city centre").selectOption("Delhi");

  // Area panel: three DEMO rows exist but are hidden by default; nothing is called "safe".
  await expect(
    page.getByRole("heading", { name: "Not enough reports to say anything" }),
  ).toBeVisible();
  await expect(page.getByText(/does not mean the area is safe/)).toBeVisible();
  await expect(
    page.getByText("Official statistics", { exact: true }),
  ).toBeVisible();

  // Demo data is opt-in and loudly labelled.
  await page.getByLabel(/Include DEMO data/).check();
  await expect(page.getByText("Demo data is on.")).toBeVisible();
  await expect(
    page.getByText(/synthetic records that did not happen/),
  ).toBeVisible();
  await page.getByLabel(/Include DEMO data/).uncheck();

  // A user report is stored unverified and appears through the real API.
  await page.getByLabel("Category").selectOption("poor_lighting");
  await page.getByLabel(/I understand this will be visible/).check();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/api/reports") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Submit report" }).click();
  const created = (await (await saved).json()).data;
  await expect(page.getByText(/Report saved as unverified/)).toBeVisible();
  expect(created).toMatchObject({
    kind: "infrastructure_hazard",
    category: "poor_lighting",
    verification: "unverified",
    source: "user",
  });
  // The database is shared by both browser projects, so look for this report by id.
  const listed = (
    await (
      await page.request.get(
        "/api/reports?lat=28.6139&lon=77.209&since_days=30",
      )
    ).json()
  ).data.reports;
  expect(listed.map((r: { id: string }) => r.id)).toContain(created.id);
  expect(JSON.stringify(listed)).not.toContain("reporter");

  // Route comparison: choose a destination on the real map, compare, read the caveats.
  await page.getByRole("button", { name: "Set destination on map" }).click();
  const map = page.getByRole("region", { name: "Map" });
  await expect(map).toBeInViewport(); // picking mode scrolls the map into view
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.4);
  await page.getByRole("button", { name: "Compare routes" }).click();
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(
    page.getByText(/road routes for vehicles, not walking routes/),
  ).toBeVisible();
  await expect(
    page.getByText(/describe data, not how safe a route is/),
  ).toBeVisible();
});
