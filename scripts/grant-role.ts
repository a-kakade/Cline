import { openDatabase } from "../src/server/database";

// Usage: npm run role:grant -- someone@example.org moderator   (or `revoke`)
// Roles are never grantable through the HTTP API.
const [email, role = "moderator", action = "grant"] = process.argv.slice(2);
if (!email || role !== "moderator") {
  console.error(
    "Usage: npm run role:grant -- <email> moderator [grant|revoke]",
  );
  process.exit(1);
}
const db = openDatabase(process.env.DATABASE_PATH || "./data/sakhi.sqlite");
try {
  const user = db
    .prepare('SELECT id FROM "user" WHERE email=?')
    .get(email.toLowerCase()) as { id: string } | undefined;
  if (!user) throw new Error("No account with that email.");
  if (action === "revoke")
    db.prepare("DELETE FROM user_roles WHERE user_id=? AND role=?").run(
      user.id,
      role,
    );
  else
    db.prepare(
      "INSERT OR IGNORE INTO user_roles(user_id,role,granted_at) VALUES(?,?,?)",
    ).run(user.id, role, Date.now());
  console.log(
    `${action === "revoke" ? "Revoked" : "Granted"} ${role} for the account (id ${user.id.slice(0, 6)}…).`,
  );
} finally {
  db.close();
}
