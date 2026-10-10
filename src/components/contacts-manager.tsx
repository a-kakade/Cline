"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { contactSchema, type Contact } from "@/lib/schemas";
import { Icon } from "@/components/icon";

type FormValues = {
  name: string;
  phone_number: string;
  relationship: string;
  alert_enabled: boolean;
};
type Feedback = {
  message: string;
  reauthenticate?: boolean;
  uncertain?: boolean;
};
const emptyForm: FormValues = {
  name: "",
  phone_number: "",
  relationship: "",
  alert_enabled: false,
};

class ContactRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    const message =
      response.status === 401
        ? "Your session has expired. Sign in again to manage your contacts."
        : response.status >= 500
          ? "The contacts service is unavailable. Please try again."
          : typeof payload.error?.message === "string"
            ? payload.error.message
            : "We couldn’t complete this request. Please try again.";
    throw new ContactRequestError(message, response.status);
  }
  if (!("data" in payload)) throw new Error("Invalid contacts response");
  return payload.data as T;
}

export function ContactsManager() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Feedback | null>(null);
  const [error, setError] = useState<Feedback | null>(null);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const mutationInFlight = useRef(false);
  const loadInFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);

  const loadContacts = useCallback((signal?: AbortSignal) => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    return request<Contact[]>("/api/contacts", { signal })
      .then((data) => {
        if (signal?.aborted) return;
        if (!Array.isArray(data)) throw new Error("Invalid contact list");
        setContacts(data);
        setError(null);
        setLoadError(null);
      })
      .catch((cause: unknown) => {
        if (signal?.aborted) return;
        setLoadError(
          cause instanceof ContactRequestError
            ? { message: cause.message, reauthenticate: cause.status === 401 }
            : {
                message:
                  "We couldn’t load your contacts. Check your connection and try again.",
              },
        );
      })
      .finally(() => {
        if (!signal?.aborted) {
          loadInFlight.current = false;
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadContacts(controller.signal);
    return () => {
      controller.abort();
      loadInFlight.current = false;
    };
  }, [loadContacts]);

  function refreshContacts() {
    if (loadInFlight.current || mutationInFlight.current) return;
    setLoading(true);
    setLoadError(null);
    void loadContacts();
  }

  useEffect(() => {
    if (error || loadError) errorRef.current?.focus();
  }, [error, loadError]);
  useEffect(() => {
    if (deleting) keepRef.current?.focus();
  }, [deleting]);

  const disabled =
    pending ||
    loading ||
    !!loadError ||
    !!error?.uncertain ||
    !!error?.reauthenticate;

  function resetForm() {
    setEditing(null);
    setForm(emptyForm);
  }

  async function mutate(
    action: "save" | "toggle" | "delete",
    contact?: Contact,
    values?: FormValues,
  ) {
    if (mutationInFlight.current || disabled) return;
    mutationInFlight.current = true;
    setPending(true);
    setError(null);
    setStatus("");
    const id = contact?.id;
    const url = id
      ? `/api/contacts/${encodeURIComponent(id)}`
      : "/api/contacts";

    try {
      if (action === "delete") {
        const result = await request<{ deleted: boolean }>(url, {
          method: "DELETE",
        });
        if (result.deleted !== true) throw new Error("Deletion not confirmed");
        setContacts(
          (current) => current?.filter((entry) => entry.id !== id) ?? [],
        );
        if (editing?.id === id) resetForm();
        setDeleting(null);
        setStatus(`${contact!.name} was deleted.`);
        listHeadingRef.current?.focus();
      } else {
        const saved = await request<Contact>(url, {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        });
        if (!saved?.id || typeof saved.alert_enabled !== "boolean")
          throw new Error("Save not confirmed");
        setContacts((current) =>
          id
            ? (current ?? []).map((entry) => (entry.id === id ? saved : entry))
            : [saved, ...(current ?? [])],
        );
        if (action === "save") {
          resetForm();
          setStatus(`${saved.name} was saved. No message was sent.`);
        } else {
          if (editing?.id === saved.id)
            setForm((current) => ({
              ...current,
              alert_enabled: saved.alert_enabled,
            }));
          setStatus(
            `Sharing permission ${saved.alert_enabled ? "enabled" : "disabled"} for ${saved.name}. No message was sent.`,
          );
        }
      }
    } catch (cause) {
      if (cause instanceof ContactRequestError) {
        setError({
          message: cause.message,
          reauthenticate: cause.status === 401,
          uncertain: cause.status >= 500,
        });
      } else {
        setError({
          message:
            "Connection interrupted. We couldn’t confirm whether your change was saved. Refresh contacts before trying again.",
          uncertain: true,
        });
      }
    } finally {
      mutationInFlight.current = false;
      setPending(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || mutationInFlight.current) return;
    const parsed = contactSchema.safeParse(form);
    if (!parsed.success) {
      setError({
        message: parsed.error.issues.map((issue) => issue.message).join(" "),
      });
      return;
    }
    void mutate("save", editing ?? undefined, {
      ...parsed.data,
      relationship: parsed.data.relationship ?? "",
    });
  }

  function edit(contact: Contact) {
    setEditing(contact);
    setForm({
      name: contact.name,
      phone_number: contact.phone_number,
      relationship: contact.relationship ?? "",
      alert_enabled: contact.alert_enabled,
    });
    setDeleting(null);
    setError(null);
    setStatus("");
    nameRef.current?.focus();
  }

  const feedback = loadError ?? error;

  return (
    <div className="contacts-manager">
      <aside className="contacts-privacy" aria-labelledby="sharing-heading">
        <Icon name="shield" />
        <div>
          <h2 id="sharing-heading">Saved doesn’t mean shared.</h2>
          <p id="sharing-description">
            Saving a contact alone sends nothing. Sharing permission is off by
            default. Enabling it records your permission for that contact to
            receive alerts and location details when you explicitly choose SOS.
            Saving or enabling a contact does not send an alert.
          </p>
          <p>
            Phone numbers are not verified. Confirm the number yourself and ask
            the person before enabling sharing.
          </p>
        </div>
      </aside>
      <div className="contacts-feedback" aria-live="polite" role="status">
        {pending ? "Saving your change…" : status}
      </div>
      {feedback && (
        <div
          className="form-error contacts-error"
          role="alert"
          tabIndex={-1}
          ref={errorRef}
        >
          <p>{feedback.message}</p>
          {feedback.reauthenticate ? (
            <Link className="text-link" href="/auth">
              Sign in again
            </Link>
          ) : (
            (loadError || feedback.uncertain) && (
              <button
                className="button button-secondary"
                type="button"
                disabled={loading || pending}
                onClick={() => void refreshContacts()}
              >
                {loadError ? "Retry loading contacts" : "Refresh contacts"}
              </button>
            )
          )}
          {feedback.uncertain && (
            <p>
              Your saved list may be out of date. Refresh to check before making
              another change.
            </p>
          )}
        </div>
      )}
      <div className="contacts-grid">
        <section
          className="contacts-list-section"
          aria-labelledby="contacts-list-heading"
          aria-busy={loading}
        >
          <div className="contacts-list-heading">
            <h2 id="contacts-list-heading" tabIndex={-1} ref={listHeadingRef}>
              Saved contacts
              {contacts ? (
                <span className="contact-count">{contacts.length}</span>
              ) : null}
            </h2>
            <button
              className="text-button"
              type="button"
              disabled={pending || loading}
              onClick={() => void refreshContacts()}
            >
              Refresh list
            </button>
          </div>
          {loading && (
            <p className="contacts-loading" role="status">
              Loading your contacts…
            </p>
          )}
          {!loading && !loadError && contacts?.length === 0 && (
            <div className="contacts-empty">
              <span className="icon-tile">
                <Icon name="phone" />
              </span>
              <h3>No contacts saved yet.</h3>
              <p>
                Add someone you trust. Their number stays saved to your account;
                adding them doesn’t notify them.
              </p>
              <button
                type="button"
                className="text-link"
                onClick={() => nameRef.current?.focus()}
              >
                Add your first contact <Icon name="arrow" />
              </button>
            </div>
          )}
          {contacts && contacts.length > 0 && (
            <ul className="contact-list">
              {contacts.map((contact) => (
                <li key={contact.id}>
                  <section className="contact-card" aria-label={contact.name}>
                    <div className="contact-card-top">
                      <span className="contact-avatar" aria-hidden="true">
                        {contact.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <h3>{contact.name}</h3>
                        {contact.relationship && (
                          <p className="contact-relationship">
                            {contact.relationship}
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="contact-phone">{contact.phone_number}</p>
                    <p className="contact-verification">Number not verified</p>
                    <p
                      className={`contact-permission${contact.alert_enabled ? " contact-permission-on" : ""}`}
                    >
                      <Icon name={contact.alert_enabled ? "check" : "lock"} />
                      Sharing permission {contact.alert_enabled ? "on" : "off"}
                    </p>
                    <div className="contact-actions">
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={disabled}
                        aria-label={`Edit ${contact.name}`}
                        onClick={() => edit(contact)}
                      >
                        Edit
                      </button>
                      <button
                        className="text-button danger-text"
                        type="button"
                        disabled={disabled}
                        aria-label={`Delete ${contact.name}`}
                        onClick={() => setDeleting(contact.id)}
                      >
                        Delete
                      </button>
                      <button
                        className="text-button contact-sharing-toggle"
                        type="button"
                        disabled={disabled}
                        aria-label={`${contact.alert_enabled ? "Disable" : "Enable"} sharing for ${contact.name}`}
                        aria-describedby="sharing-description"
                        onClick={() =>
                          void mutate("toggle", contact, {
                            name: contact.name,
                            phone_number: contact.phone_number,
                            relationship: contact.relationship ?? "",
                            alert_enabled: !contact.alert_enabled,
                          })
                        }
                      >
                        {contact.alert_enabled
                          ? "Disable sharing"
                          : "Enable sharing"}
                      </button>
                    </div>
                    {deleting === contact.id && (
                      <section
                        className="contact-delete-confirm"
                        aria-label={`Confirm deletion of ${contact.name}`}
                      >
                        <p>
                          Delete {contact.name} from your contacts? This cannot
                          be undone.
                        </p>
                        <div>
                          <button
                            className="button button-danger"
                            type="button"
                            disabled={disabled}
                            onClick={() => void mutate("delete", contact)}
                          >
                            Delete contact
                          </button>
                          <button
                            ref={keepRef}
                            className="button button-secondary"
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              setDeleting(null);
                              listHeadingRef.current?.focus();
                            }}
                          >
                            Keep contact
                          </button>
                        </div>
                      </section>
                    )}
                  </section>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section
          className="contact-form-card"
          aria-labelledby="contact-form-heading"
        >
          <span className="icon-tile">
            <Icon name="lock" />
          </span>
          <h2 id="contact-form-heading">
            {editing ? "Edit contact" : "Add contact"}
          </h2>
          <p className="contact-form-intro">
            {editing
              ? "Update the details you have saved."
              : "Start with a name and phone number."}
          </p>
          <form
            aria-label={editing ? "Edit contact" : "Add contact"}
            onSubmit={save}
            aria-busy={pending}
          >
            <fieldset disabled={disabled}>
              <legend className="sr-only">Contact details</legend>
              <div className="field">
                <label htmlFor="contact-name">Contact name</label>
                <input
                  ref={nameRef}
                  id="contact-name"
                  type="text"
                  autoComplete="off"
                  required
                  maxLength={80}
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="contact-phone">Phone number</label>
                <input
                  id="contact-phone"
                  type="tel"
                  autoComplete="off"
                  required
                  maxLength={40}
                  aria-describedby="contact-phone-hint"
                  value={form.phone_number}
                  onChange={(event) =>
                    setForm({ ...form, phone_number: event.target.value })
                  }
                />
                <p id="contact-phone-hint" className="field-hint">
                  Indian numbers can use the local format. For other countries,
                  include + and the country code.
                </p>
              </div>
              <div className="field">
                <label htmlFor="contact-relationship">
                  Relationship (optional)
                </label>
                <input
                  id="contact-relationship"
                  type="text"
                  autoComplete="off"
                  maxLength={60}
                  value={form.relationship}
                  onChange={(event) =>
                    setForm({ ...form, relationship: event.target.value })
                  }
                />
              </div>
              <div className="contact-consent">
                <label htmlFor="contact-sharing">
                  <input
                    id="contact-sharing"
                    type="checkbox"
                    checked={form.alert_enabled}
                    aria-describedby="sharing-description contact-sharing-hint"
                    onChange={(event) =>
                      setForm({ ...form, alert_enabled: event.target.checked })
                    }
                  />
                  <span>Allow alerts and location sharing</span>
                </label>
                <p id="contact-sharing-hint">
                  Optional. Leave off to save without granting sharing
                  permission. Saving this contact sends no alert or location.
                </p>
              </div>
              <div className="contact-form-actions">
                <button className="button button-primary" type="submit">
                  {pending
                    ? "Saving…"
                    : editing
                      ? "Save changes"
                      : "Save contact"}
                </button>
                {editing && (
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => {
                      resetForm();
                      setError(null);
                      nameRef.current?.focus();
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </div>
            </fieldset>
          </form>
        </section>
      </div>
    </div>
  );
}
