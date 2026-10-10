import { readFileSync } from "node:fs";
import { openDatabase } from "../src/server/database";
import { seedDemo } from "../src/server/demo-seed";

// Usage: npm run seed:demo [-- path/to/file.csv] [--no-rebase]
const path =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ??
  "Woman_Safety_Dataset_Management.csv";
const db = openDatabase(process.env.DATABASE_PATH || "./data/sakhi.sqlite");
try {
  const result = seedDemo(db, readFileSync(path, "utf8"), {
    rebase: !process.argv.includes("--no-rebase"),
  });
  console.log(
    `Loaded SYNTHETIC demo data: ${JSON.stringify(result)}. Every record is labelled as demo data in the app.`,
  );
} finally {
  db.close();
}
