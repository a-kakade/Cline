import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { contactSchema, type Contact } from "@/lib/schemas";
import { AppError } from "./http";
import { audit, throttle } from "./audit";

type ContactRow = Omit<Contact, "alert_enabled"> & { alert_enabled: number };
const mapped = (row: ContactRow): Contact => ({
  ...row,
  alert_enabled: !!row.alert_enabled,
});
export class ContactService {
  constructor(
    private db: Database.Database,
    private clock = Date.now,
  ) {}
  list(userId: string) {
    return (
      this.db
        .prepare(
          "SELECT * FROM contacts WHERE user_id = ? ORDER BY created_at DESC",
        )
        .all(userId) as ContactRow[]
    ).map(mapped);
  }
  get(userId: string, id: string) {
    const row = this.db
      .prepare("SELECT * FROM contacts WHERE id = ? AND user_id = ?")
      .get(id, userId) as ContactRow | undefined;
    if (!row) throw new AppError(404, "NOT_FOUND", "Contact not found.");
    return mapped(row);
  }
  create(userId: string, input: unknown) {
    const data = contactSchema.parse(input);
    const now = this.clock();
    throttle(this.db, userId, "contacts", 60, now);
    return this.db.transaction(() => {
      if (this.list(userId).length >= 20)
        throw new AppError(
          409,
          "CONTACT_LIMIT",
          "You can save up to 20 contacts.",
        );
      this.checkDuplicate(userId, data.phone_number);
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO contacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          id,
          userId,
          data.name,
          data.phone_number,
          data.relationship || null,
          +data.alert_enabled,
          now,
          now,
        );
      audit(this.db, userId, "contact.created", id, now);
      return this.get(userId, id);
    })();
  }
  update(userId: string, id: string, input: unknown) {
    const data = contactSchema.parse(input);
    const now = this.clock();
    throttle(this.db, userId, "contacts", 60, now);
    return this.db.transaction(() => {
      this.get(userId, id);
      this.checkDuplicate(userId, data.phone_number, id);
      this.db
        .prepare(
          "UPDATE contacts SET name=?, phone_number=?, relationship=?, alert_enabled=?, updated_at=? WHERE id=? AND user_id=?",
        )
        .run(
          data.name,
          data.phone_number,
          data.relationship || null,
          +data.alert_enabled,
          now,
          id,
          userId,
        );
      audit(this.db, userId, "contact.updated", id, now);
      return this.get(userId, id);
    })();
  }
  delete(userId: string, id: string) {
    throttle(this.db, userId, "contacts", 60, this.clock());
    this.db.transaction(() => {
      this.get(userId, id);
      this.db
        .prepare("DELETE FROM contacts WHERE id=? AND user_id=?")
        .run(id, userId);
      audit(this.db, userId, "contact.deleted", id, this.clock());
    })();
    return { deleted: true };
  }
  private checkDuplicate(userId: string, phone: string, except = "") {
    if (
      this.db
        .prepare(
          "SELECT id FROM contacts WHERE user_id=? AND phone_number=? AND id != ?",
        )
        .get(userId, phone, except)
    )
      throw new AppError(
        409,
        "DUPLICATE_CONTACT",
        "This phone number is already in your contacts.",
      );
  }
}
