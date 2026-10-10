// Evaluate the triage rules against a labelled set. Usage: npx tsx scripts/triage-eval.ts <file.json>
import { readFileSync } from "node:fs";
import { TRIAGE_CATEGORIES } from "../src/lib/triage-types";
import { triageByRules } from "../src/server/triage/rules";

const file = process.argv[2] ?? "tests/fixtures/triage-eval-dev.json";
const { items } = JSON.parse(readFileSync(file, "utf8")) as {
  items: { text: string; label: string }[];
};
const confusion: Record<string, Record<string, number>> = {};
let correct = 0;
const wrong: string[] = [];
for (const { text, label } of items) {
  const got = triageByRules(text).category;
  confusion[label] ??= {};
  confusion[label][got] = (confusion[label][got] ?? 0) + 1;
  if (got === label) correct++;
  else wrong.push(`  expected ${label}, got ${got}: ${JSON.stringify(text)}`);
}
console.log(
  `${file}: ${correct}/${items.length} = ${((100 * correct) / items.length).toFixed(1)}% exact category match`,
);
for (const c of TRIAGE_CATEGORIES) {
  const row = confusion[c];
  if (!row) continue;
  const n = Object.values(row).reduce((a, b) => a + b, 0);
  console.log(
    `  ${c.padEnd(22)} recall ${((100 * (row[c] ?? 0)) / n).toFixed(0)}% (${row[c] ?? 0}/${n})`,
  );
}
if (wrong.length) console.log("Mistakes:\n" + wrong.join("\n"));
