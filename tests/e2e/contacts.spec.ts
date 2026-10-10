import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("contacts require authentication while emergency calling stays available", async ({
  page,
}) => {
  await page.goto("/contacts");
  await expect(page).toHaveURL(/\/auth$/);
  await expect(
    page
      .getByRole("banner")
      .getByRole("link", { name: "Call 112", exact: true }),
  ).toHaveAttribute("href", "tel:112");
});

test("real contact CRUD and explicit sharing preferences persist across refresh", async ({
  page,
}) => {
  const email = `contacts-${randomUUID()}@example.test`;
  // Real signup establishes the browser context's HttpOnly session cookie.
  // No route interception, seeded session, or authentication bypass is used.
  const signup = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin: "http://localhost:3000" },
    data: {
      name: "Contacts Browser User",
      email,
      password: randomBytes(24).toString("base64url"),
    },
  });
  expect(signup.ok()).toBe(true);
  await page.goto("/contacts");
  await expect(
    page.getByRole("heading", { name: "Your trusted contacts", level: 1 }),
  ).toBeVisible();

  const add = page.getByRole("form", { name: "Add contact", exact: true });
  const sharing = add.getByRole("checkbox", {
    name: "Allow alerts and location sharing",
    exact: true,
  });
  await expect(sharing).not.toBeChecked();
  await add.getByLabel("Contact name", { exact: true }).fill("Asha Browser");
  await add.getByLabel("Phone number", { exact: true }).fill("98765 43210");
  await add
    .getByLabel("Relationship (optional)", { exact: true })
    .fill("Sister");
  await add.getByRole("button", { name: "Save contact", exact: true }).click();

  let card = page.getByRole("region", { name: "Asha Browser", exact: true });
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("button", {
      name: "Enable sharing for Asha Browser",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  card = page.getByRole("region", { name: "Asha Browser", exact: true });
  await expect(card).toBeVisible();
  let saved = (await (await page.request.get("/api/contacts")).json()).data;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    name: "Asha Browser",
    phone_number: "+919876543210",
    relationship: "Sister",
    alert_enabled: false,
  });

  await card
    .getByRole("button", {
      name: "Enable sharing for Asha Browser",
      exact: true,
    })
    .click();
  await expect(
    card.getByRole("button", {
      name: "Disable sharing for Asha Browser",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    card.getByRole("button", {
      name: "Disable sharing for Asha Browser",
      exact: true,
    }),
  ).toBeVisible();
  saved = (await (await page.request.get("/api/contacts")).json()).data;
  expect(saved[0].alert_enabled).toBe(true);

  await card
    .getByRole("button", { name: "Edit Asha Browser", exact: true })
    .click();
  const edit = page.getByRole("form", { name: "Edit contact", exact: true });
  await expect(
    edit.getByRole("checkbox", {
      name: "Allow alerts and location sharing",
      exact: true,
    }),
  ).toBeChecked();
  await edit.getByLabel("Contact name", { exact: true }).fill("Asha Updated");
  await edit
    .getByLabel("Phone number", { exact: true })
    .fill("+91 98765 43211");
  await edit
    .getByLabel("Relationship (optional)", { exact: true })
    .fill("Friend");
  await edit.getByRole("button", { name: "Save changes", exact: true }).click();
  card = page.getByRole("region", { name: "Asha Updated", exact: true });
  await expect(card).toBeVisible();
  await card
    .getByRole("button", {
      name: "Disable sharing for Asha Updated",
      exact: true,
    })
    .click();
  await expect(
    card.getByRole("button", {
      name: "Enable sharing for Asha Updated",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  saved = (await (await page.request.get("/api/contacts")).json()).data;
  expect(saved[0]).toMatchObject({
    name: "Asha Updated",
    phone_number: "+919876543211",
    relationship: "Friend",
    alert_enabled: false,
  });
  await expect(
    card.getByRole("button", {
      name: "Enable sharing for Asha Updated",
      exact: true,
    }),
  ).toBeVisible();

  await card
    .getByRole("button", { name: "Delete Asha Updated", exact: true })
    .click();
  let confirmation = page.getByRole("region", {
    name: "Confirm deletion of Asha Updated",
    exact: true,
  });
  await confirmation
    .getByRole("button", { name: "Keep contact", exact: true })
    .click();
  await expect(card).toBeVisible();
  await card
    .getByRole("button", { name: "Delete Asha Updated", exact: true })
    .click();
  confirmation = page.getByRole("region", {
    name: "Confirm deletion of Asha Updated",
    exact: true,
  });
  await confirmation
    .getByRole("button", { name: "Delete contact", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(card).toHaveCount(0);
  expect(await (await page.request.get("/api/contacts")).json()).toEqual({
    data: [],
  });
  await expect(
    page
      .getByRole("banner")
      .getByRole("link", { name: "Call 112", exact: true }),
  ).toBeVisible();
});
