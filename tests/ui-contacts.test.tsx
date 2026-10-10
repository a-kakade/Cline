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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactsManager } from "@/components/contacts-manager";
import ContactsPage from "@/app/contacts/page";
import type { Contact } from "@/lib/schemas";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getSession: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/server/auth", () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession } }),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const contact: Contact = {
  id: "contact-1",
  user_id: "user-1",
  name: "Asha",
  phone_number: "+919876543210",
  relationship: "Friend",
  alert_enabled: false,
  created_at: 1,
  updated_at: 1,
};
const response = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => ({ data }),
});
const failure = (message: string, status = 400, code = "INVALID_INPUT") => ({
  ok: false,
  status,
  json: async () => ({ error: { code, message } }),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue(response([]));
  mocks.getSession.mockResolvedValue(null);
  mocks.headers.mockResolvedValue(new Headers({ cookie: "session=example" }));
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function ready(contacts: Contact[] = []) {
  mocks.fetch.mockResolvedValueOnce(response(contacts));
  render(<ContactsManager />);
  await waitFor(() =>
    expect(
      screen.queryByText("Loading your contacts…"),
    ).not.toBeInTheDocument(),
  );
}

function fillForm(name = "Asha", phone = "9876543210") {
  fireEvent.change(screen.getByLabelText("Contact name"), {
    target: { value: name },
  });
  fireEvent.change(screen.getByLabelText("Phone number"), {
    target: { value: phone },
  });
  fireEvent.change(screen.getByLabelText("Relationship (optional)"), {
    target: { value: "Friend" },
  });
}

describe("contacts loading and recovery", () => {
  it("announces loading without treating it as an empty list", async () => {
    let resolve: (value: ReturnType<typeof response>) => void = () => {};
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<ContactsManager />);
    expect(screen.getByText("Loading your contacts…")).toHaveAttribute(
      "role",
      "status",
    );
    expect(
      screen.queryByText("No contacts saved yet."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save contact" })).toBeDisabled();
    resolve(response([]));
    expect(
      await screen.findByText("No contacts saved yet."),
    ).toBeInTheDocument();
  });

  it("loads saved server contacts with no-store and explicit disabled sharing", async () => {
    await ready([contact]);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/contacts",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    const card = screen.getByRole("region", { name: "Asha" });
    expect(card).toHaveTextContent(contact.phone_number);
    expect(card).toHaveTextContent("Number not verified");
    expect(card).toHaveTextContent("Sharing permission off");
    expect(
      screen.getByRole("checkbox", {
        name: "Allow alerts and location sharing",
      }),
    ).not.toBeChecked();
  });

  it("offers focused offline feedback and retries the real list request", async () => {
    mocks.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<ContactsManager />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Check your connection and try again.");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(
      screen.queryByText("No contacts saved yet."),
    ).not.toBeInTheDocument();
    mocks.fetch.mockResolvedValueOnce(response([contact]));
    fireEvent.click(
      screen.getByRole("button", { name: "Retry loading contacts" }),
    );
    expect(
      await screen.findByRole("region", { name: "Asha" }),
    ).toBeInTheDocument();
  });

  it("shows a sign-in link for expired sessions rather than editable stale data", async () => {
    mocks.fetch.mockResolvedValueOnce(failure("Unauthenticated", 401));
    render(<ContactsManager />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session has expired.",
    );
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/auth",
    );
    expect(screen.getByRole("button", { name: "Save contact" })).toBeDisabled();
  });

  it("refreshes from server persistence instead of retaining a stale local list", async () => {
    await ready([contact]);
    mocks.fetch.mockResolvedValueOnce(
      response([{ ...contact, name: "Updated elsewhere" }]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
    expect(
      await screen.findByRole("region", { name: "Updated elsewhere" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Asha" }),
    ).not.toBeInTheDocument();
  });
});

describe("contact creation and validation", () => {
  it("saves a normalized phone number with sharing off by default", async () => {
    await ready();
    fillForm();
    mocks.fetch.mockResolvedValueOnce(response(contact, 201));
    fireEvent.submit(screen.getByRole("form", { name: "Add contact" }));
    expect(
      await screen.findByRole("region", { name: "Asha" }),
    ).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      "/api/contacts",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Asha",
          phone_number: contact.phone_number,
          relationship: "Friend",
          alert_enabled: false,
        }),
      }),
    );
    expect(
      screen.getByText("Asha was saved. No message was sent."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Contact name")).toHaveValue("");
  });

  it("only sends alert_enabled true after explicit checkbox opt-in", async () => {
    await ready();
    fillForm();
    const checkbox = screen.getByRole("checkbox", {
      name: "Allow alerts and location sharing",
    });
    expect(checkbox).toHaveAccessibleDescription(
      /Saving a contact alone sends nothing/,
    );
    fireEvent.click(checkbox);
    mocks.fetch.mockResolvedValueOnce(
      response({ ...contact, alert_enabled: true }, 201),
    );
    fireEvent.submit(screen.getByRole("form", { name: "Add contact" }));
    await screen.findByText("Sharing permission on");
    const options = mocks.fetch.mock.calls.at(-1)![1];
    expect(JSON.parse(options.body)).toMatchObject({ alert_enabled: true });
    expect(checkbox).not.toBeChecked();
  });

  it.each([
    ["   ", "9876543210", "Enter a contact name."],
    ["Asha", "123", "Enter a valid phone number"],
  ])(
    "rejects invalid form input before posting",
    async (name, phone, message) => {
      await ready();
      fillForm(name, phone);
      fireEvent.submit(screen.getByRole("form", { name: "Add contact" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(mocks.fetch).toHaveBeenCalledOnce();
    },
  );

  it("matches the name and relationship limits", async () => {
    await ready();
    expect(screen.getByLabelText("Contact name")).toHaveAttribute(
      "maxlength",
      "80",
    );
    expect(screen.getByLabelText("Relationship (optional)")).toHaveAttribute(
      "maxlength",
      "60",
    );
  });

  it("surfaces duplicate errors and preserves entered details", async () => {
    await ready();
    fillForm();
    mocks.fetch.mockResolvedValueOnce(
      failure(
        "This phone number is already in your contacts.",
        409,
        "DUPLICATE_CONTACT",
      ),
    );
    fireEvent.submit(screen.getByRole("form", { name: "Add contact" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This phone number is already in your contacts.",
    );
    expect(screen.getByLabelText("Contact name")).toHaveValue("Asha");
    expect(
      screen.queryByRole("region", { name: "Asha" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save contact" })).toBeEnabled();
  });

  it("blocks duplicate submissions and waits for confirmed server success", async () => {
    await ready();
    fillForm();
    let resolve: (value: ReturnType<typeof response>) => void = () => {};
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const form = screen.getByRole("form", { name: "Add contact" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(
      screen.queryByRole("region", { name: "Asha" }),
    ).not.toBeInTheDocument();
    resolve(response(contact));
    expect(
      await screen.findByRole("region", { name: "Asha" }),
    ).toBeInTheDocument();
  });

  it("requires a server refresh after an uncertain network mutation outcome", async () => {
    await ready();
    fillForm();
    mocks.fetch.mockRejectedValueOnce(new TypeError("Network interrupted"));
    fireEvent.submit(screen.getByRole("form", { name: "Add contact" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "couldn’t confirm whether your change was saved",
    );
    expect(screen.getByRole("button", { name: "Save contact" })).toBeDisabled();
    expect(
      screen.queryByText("Asha was saved. No message was sent."),
    ).not.toBeInTheDocument();
    mocks.fetch.mockResolvedValueOnce(response([contact]));
    fireEvent.click(screen.getByRole("button", { name: "Refresh contacts" }));
    expect(
      await screen.findByRole("region", { name: "Asha" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("edit, permission and deletion", () => {
  it("edits via a full-schema PATCH and updates the returned record", async () => {
    await ready([contact]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Asha" }));
    expect(screen.getByLabelText("Contact name")).toHaveFocus();
    expect(screen.getByLabelText("Phone number")).toHaveValue(
      contact.phone_number,
    );
    fireEvent.change(screen.getByLabelText("Contact name"), {
      target: { value: "Asha Rao" },
    });
    mocks.fetch.mockResolvedValueOnce(
      response({ ...contact, name: "Asha Rao" }),
    );
    fireEvent.submit(screen.getByRole("form", { name: "Edit contact" }));
    expect(
      await screen.findByRole("region", { name: "Asha Rao" }),
    ).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      "/api/contacts/contact-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "Asha Rao",
          phone_number: contact.phone_number,
          relationship: "Friend",
          alert_enabled: false,
        }),
      }),
    );
    expect(
      screen.getByRole("form", { name: "Add contact" }),
    ).toBeInTheDocument();
  });

  it("cancels edit without mutating the saved contact", async () => {
    await ready([contact]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Asha" }));
    fireEvent.change(screen.getByLabelText("Contact name"), {
      target: { value: "Discard" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(screen.getByLabelText("Contact name")).toHaveValue("");
    expect(screen.getByRole("region", { name: "Asha" })).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("enables and disables sharing only after an explicit action and successful PATCH", async () => {
    await ready([contact]);
    const enable = screen.getByRole("button", {
      name: "Enable sharing for Asha",
    });
    expect(enable).toHaveAccessibleDescription(/alerts and location details/);
    mocks.fetch.mockResolvedValueOnce(
      response({ ...contact, alert_enabled: true }),
    );
    fireEvent.click(enable);
    expect(
      await screen.findByRole("button", { name: "Disable sharing for Asha" }),
    ).toBeInTheDocument();
    expect(JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body)).toMatchObject({
      name: contact.name,
      phone_number: contact.phone_number,
      relationship: "Friend",
      alert_enabled: true,
    });
    mocks.fetch.mockResolvedValueOnce(response(contact));
    fireEvent.click(
      screen.getByRole("button", { name: "Disable sharing for Asha" }),
    );
    expect(
      await screen.findByRole("button", { name: "Enable sharing for Asha" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Sharing permission disabled for Asha. No message was sent.",
      ),
    ).toBeInTheDocument();
  });

  it("does not change permission locally when PATCH fails", async () => {
    await ready([contact]);
    mocks.fetch.mockResolvedValueOnce(
      failure("Please slow down.", 429, "RATE_LIMIT"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Enable sharing for Asha" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please slow down.",
    );
    expect(screen.getByText("Sharing permission off")).toBeInTheDocument();
  });

  it("focuses the safe deletion choice and only deletes after confirmation", async () => {
    await ready([contact]);
    fireEvent.click(screen.getByRole("button", { name: "Delete Asha" }));
    const confirmation = screen.getByRole("region", {
      name: "Confirm deletion of Asha",
    });
    expect(
      within(confirmation).getByRole("button", { name: "Keep contact" }),
    ).toHaveFocus();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    mocks.fetch.mockResolvedValueOnce(response({ deleted: true }));
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Delete contact" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Asha" }),
      ).not.toBeInTheDocument(),
    );
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      "/api/contacts/contact-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(screen.getByText("Asha was deleted.")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Saved contacts/ }),
    ).toHaveFocus();
  });

  it("keeps contacts on cancelled or failed deletion", async () => {
    await ready([contact]);
    fireEvent.click(screen.getByRole("button", { name: "Delete Asha" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep contact" }));
    expect(
      screen.queryByRole("region", { name: "Confirm deletion of Asha" }),
    ).not.toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Delete Asha" }));
    mocks.fetch.mockResolvedValueOnce(failure("Please try again.", 503));
    fireEvent.click(screen.getByRole("button", { name: "Delete contact" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The contacts service is unavailable.",
    );
    expect(screen.getByRole("region", { name: "Asha" })).toBeInTheDocument();
  });
});

describe("server contacts protection", () => {
  it("redirects unauthenticated page requests", async () => {
    await expect(ContactsPage()).rejects.toThrow("REDIRECT:/auth");
    expect(mocks.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    });
  });

  it("renders the real manager only for an authenticated session", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    render(await ContactsPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Your trusted contacts.",
    );
    expect(
      await screen.findByText("No contacts saved yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to my account" }),
    ).toHaveAttribute("href", "/dashboard");
  });
});
