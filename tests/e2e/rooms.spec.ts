import { randomBytes, randomUUID } from "node:crypto";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { MODERATOR_EMAIL, MODERATOR_PASSWORD } from "./constants";

const ORIGIN = "http://localhost:3000";

async function user(browser: Browser, name: string) {
  const context = await browser.newContext({ baseURL: ORIGIN });
  const page = await context.newPage();
  const signup = await context.request.post("/api/auth/sign-up/email", {
    headers: { origin: ORIGIN },
    data: {
      name,
      email: `room-${randomUUID()}@example.test`,
      password: randomBytes(24).toString("base64url"),
    },
  });
  expect(signup.ok()).toBe(true);
  return { context, page };
}
async function joinDelhi(page: Page) {
  await page.goto("/rooms");
  await page.getByLabel("Or choose a city centre").selectOption("Delhi");
  await page.getByRole("button", { name: "Join this area room" }).click();
  await expect(
    page.getByRole("heading", { name: /Area near Delhi/ }).first(),
  ).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
}
const send = async (page: Page, text: string) => {
  await page.getByLabel("Message to this area").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
};
const roomIdOf = async (context: BrowserContext) =>
  (
    await (
      await context.request.post("/api/rooms/resolve", {
        headers: { origin: ORIGIN },
        data: { lat: 28.6139, lon: 77.209 },
      })
    ).json()
  ).data.id as string;

test("rooms require authentication while 112 stays available", async ({
  page,
}) => {
  await page.goto("/rooms");
  await expect(page).toHaveURL(/\/auth$/);
  await expect(
    page
      .getByRole("banner")
      .getByRole("link", { name: "Call 112", exact: true }),
  ).toHaveAttribute("href", "tel:112");
  await page.goto("/moderation");
  await expect(page).toHaveURL(/\/auth$/);
});

test("two members chat live under pseudonyms; an outsider cannot read or subscribe", async ({
  browser,
}) => {
  const a = await user(browser, "Alice RoomUser");
  const b = await user(browser, "Bhavna RoomUser");
  const outsider = await user(browser, "Mallory Outsider");
  await joinDelhi(a.page);
  await joinDelhi(b.page);

  await send(a.page, "Streetlight near the gate is out tonight");
  // B sees it without reloading, from a pseudonym — never A's name.
  const incoming = b.page
    .getByRole("list", { name: "Messages" })
    .getByText("Streetlight near the gate is out tonight");
  await expect(incoming).toBeVisible();
  const text = await b.page.locator(".chat").innerText();
  expect(text).toMatch(/Member [0-9a-f]{6}/);
  expect(text).not.toContain("Alice");
  await expect(a.page.getByText(/You \(Member [0-9a-f]{6}\)/)).toBeVisible();

  // Outsider (not a member): API read, post and stream are all refused.
  const id = await roomIdOf(a.context);
  const read = await outsider.context.request.get(`/api/rooms/${id}/messages`);
  expect(read.status()).toBe(403);
  const post = await outsider.context.request.post(
    `/api/rooms/${id}/messages`,
    {
      headers: { origin: ORIGIN },
      data: { client_id: randomUUID(), body: "let me in" },
    },
  );
  expect(post.status()).toBe(403);
  const stream = await outsider.context.request.get(`/api/rooms/${id}/stream`);
  expect(stream.status()).toBe(403);

  // Nothing about positions or identities is in what members receive.
  const history = JSON.stringify(
    (await (await b.context.request.get(`/api/rooms/${id}/messages`)).json())
      .data,
  );
  expect(history).not.toMatch(/latitude|longitude|email|Alice/);
  await Promise.all([
    a.context.close(),
    b.context.close(),
    outsider.context.close(),
  ]);
});

test("a dropped connection is shown honestly and missed messages arrive after reconnecting", async ({
  browser,
}) => {
  const a = await user(browser, "Asha Sender");
  const b = await user(browser, "Bela Receiver");
  await joinDelhi(a.page);
  await joinDelhi(b.page);
  await b.context.setOffline(true);
  await expect(b.page.getByText(/Connection lost — reconnecting/)).toBeVisible({
    timeout: 20_000,
  });
  await send(a.page, "Posted while Bela was offline");
  await b.context.setOffline(false);
  await expect(b.page.getByText("Posted while Bela was offline")).toBeVisible({
    timeout: 30_000,
  });
  await expect(b.page.getByText("Live", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await Promise.all([a.context.close(), b.context.close()]);
});

test("a distress message gives the sender help options and quietly flags it for moderators; moderators can remove it", async ({
  browser,
}) => {
  const a = await user(browser, "Anita Sender");
  const b = await user(browser, "Bina Reader");
  await joinDelhi(a.page);
  await joinDelhi(b.page);

  await send(a.page, "Someone is following me please help");
  const help = a.page.getByRole("complementary", { name: "Suggested help" });
  await expect(help).toBeVisible();
  await expect(help.getByRole("link", { name: "Call 112" })).toHaveAttribute(
    "href",
    "tel:112",
  );
  await expect(help.getByRole("link", { name: "Open SOS" })).toHaveAttribute(
    "href",
    "/dashboard",
  );
  await expect(help.getByText(/may be wrong/)).toBeVisible();
  await expect(
    help.getByText(/no one has been contacted automatically/),
  ).toBeVisible();
  // Another member sees the message and nothing about its classification.
  await expect(
    b.page.getByText("Someone is following me please help"),
  ).toBeVisible();
  await expect(
    b.page.getByRole("complementary", { name: "Suggested help" }),
  ).toHaveCount(0);
  await expect(b.page.getByText(/moderator may review/)).toHaveCount(0);

  // The moderator queue shows it (alias + text, urgent first) and removal reaches live readers.
  const mod = await browser.newContext({ baseURL: ORIGIN });
  const login = await mod.request.post("/api/auth/sign-in/email", {
    headers: { origin: ORIGIN },
    data: { email: MODERATOR_EMAIL, password: MODERATOR_PASSWORD },
  });
  expect(login.ok()).toBe(true);
  const modPage = await mod.newPage();
  await modPage.goto("/moderation");
  await expect(
    modPage.getByRole("heading", { name: /Flagged messages/ }),
  ).toBeVisible();
  const item = modPage
    .getByRole("listitem")
    .filter({ hasText: "Someone is following me please help" });
  await expect(item.getByText(/URGENT/)).toBeVisible();
  await expect(item.getByText(/miss many real emergencies/)).toBeVisible();
  await item.getByRole("button", { name: "Remove message" }).click();
  await expect(b.page.getByText("Removed by a moderator.")).toBeVisible();
  await Promise.all([a.context.close(), b.context.close(), mod.close()]);
});

test("ordinary users cannot open moderation (404) or its API (403)", async ({
  browser,
}) => {
  const u = await user(browser, "Nosy User");
  await u.page.goto("/moderation");
  // Streamed pages can't change the HTTP status, so check what is (not) rendered.
  await expect(
    u.page.getByText(/could not be found|404/i).first(),
  ).toBeVisible();
  await expect(u.page.getByRole("heading", { name: /Moderation/ })).toHaveCount(
    0,
  );
  expect((await u.context.request.get("/api/moderation/queue")).status()).toBe(
    403,
  );
  await u.context.close();
});

test("area ratings: opinions are labelled, need several people before an average shows, and reject contact details", async ({
  browser,
}) => {
  const a = await user(browser, "Rater One");
  await joinDelhi(a.page);
  const ratings = a.page.getByRole("region", {
    name: "How people rate this area",
  });
  const id = await roomIdOf(a.context);
  const read = async () =>
    (await (await a.context.request.get(`/api/areas/${id}/ratings`)).json())
      .data;
  // The database is shared by both browser projects, so measure relative to what exists.
  const before = (await read()).overall.count as number;
  const pending = (n: number) => `Not enough ratings yet (${n} of 5)`;
  await expect(ratings.getByText(pending(before)).first()).toBeVisible();
  await expect(ratings.getByText(/not verified incidents/)).toBeVisible();
  await expect(
    ratings.getByText(/does not prove an area is safe/),
  ).toBeVisible();

  await ratings.getByLabel("4 stars").check();
  await ratings.getByLabel("At night (optional)").selectOption("2");
  await ratings.getByLabel(/Short review/).fill("call me on 98765 43210");
  await ratings.getByRole("button", { name: "Submit rating" }).click();
  await expect(
    ratings.getByText(/leave phone numbers and email addresses out/),
  ).toBeVisible();
  expect((await read()).overall.count).toBe(before); // nothing was saved

  await ratings
    .getByLabel(/Short review/)
    .fill("Well lit on the main road, quiet after 9");
  await ratings.getByRole("button", { name: "Submit rating" }).click();
  await expect(ratings.getByText("Your rating is saved.")).toBeVisible();
  await expect(ratings.getByText(pending(before + 1)).first()).toBeVisible();
  // Reviews from both browser projects may be listed; this user's own is marked "You".
  await expect(
    ratings
      .getByRole("listitem")
      .filter({ hasText: "You ·" })
      .getByText("Well lit on the main road, quiet after 9"),
  ).toBeVisible();
  // One rating per person: submitting again updates it; it doesn't add another.
  await ratings.getByLabel("5 stars").check();
  await ratings.getByRole("button", { name: "Update my rating" }).click();
  await expect(ratings.getByText(pending(before + 1)).first()).toBeVisible();
  const summary = await read();
  expect(summary.overall).toMatchObject({
    count: before + 1,
    shown: false,
    average: null,
  });
  expect(summary.my_rating.stars).toBe(5);
  await a.context.close();
});
