import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TRIAGE_CATEGORIES } from "../src/lib/triage-types";
import { detectLanguage, triageByRules } from "../src/server/triage/rules";

type Item = { text: string; label: string };
const load = (name: string) =>
  (
    JSON.parse(
      readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
    ) as { items: Item[] }
  ).items;
function score(items: Item[]) {
  const per: Record<string, { ok: number; n: number }> = {};
  let ok = 0;
  for (const { text, label } of items) {
    const got = triageByRules(text).category;
    per[label] ??= { ok: 0, n: 0 };
    per[label].n++;
    if (got === label) {
      per[label].ok++;
      ok++;
    }
  }
  return { accuracy: ok / items.length, per };
}

describe("triage evaluation sets", () => {
  // These two sets were used while writing/revising the rules, so their scores
  // are NOT evidence of generalisation. They guard against regressions only.
  it("does not regress on the development set and held-out-1 (both used for tuning)", () => {
    expect(score(load("triage-eval-dev.json")).accuracy).toBe(1);
    expect(score(load("triage-eval-heldout.json")).accuracy).toBe(1);
  });

  // The only unbiased measurement: written after the rules were final and never
  // used to change them. Measured 2026-10-10: 44/61 = 72.1%, urgent recall 6/12,
  // distress recall 4/8. The floors below only detect regressions; they are not a
  // claim that the detector is adequate (it is not — see docs/SAFETY_TRIAGE.md).
  it("keeps the measured held-out-2 performance from getting worse", () => {
    const { accuracy, per } = score(load("triage-eval-heldout2.json"));
    expect(accuracy).toBeGreaterThanOrEqual(44 / 61);
    expect(per.urgent_safety_concern.ok).toBeGreaterThanOrEqual(6);
    expect(per.distress.ok).toBeGreaterThanOrEqual(4);
    expect(per.unknown.ok).toBe(per.unknown.n);
  });

  it("uses only valid labels", () => {
    for (const f of [
      "triage-eval-dev.json",
      "triage-eval-heldout.json",
      "triage-eval-heldout2.json",
    ])
      for (const { label } of load(f))
        expect(TRIAGE_CATEGORIES).toContain(label);
  });
});

describe("triage behaviour", () => {
  it("flags urgent messages for review and offers the sender help options, never an automatic action", () => {
    const r = triageByRules("Someone is following me please help");
    expect(r).toMatchObject({
      category: "urgent_safety_concern",
      needs_review: true,
      method: "rules",
      language: "en",
    });
    expect(r.suggested_actions).toEqual([
      "call_112",
      "open_sos",
      "nearby_help",
    ]);
    expect(r.strength).toMatch(/^(moderate|strong)$/);
  });

  it("never echoes user-specific content (names, places, numbers) in its reason", () => {
    for (const text of [
      "Someone is following me please help",
      "streetlight broken near Rose Apartments gate 4",
      "bachao mujhe bachao 9876543210",
    ])
      expect(triageByRules(text).reason).not.toMatch(
        /Rose|Apartments|gate 4|9876/i,
      );
  });

  it("treats a request for ordinary help, questions about safety and fiction as general", () => {
    for (const text of [
      "can someone help me find the library?",
      "please help me with directions to the bus stop",
      "Is it safe to take the 9pm bus?",
      "I was scared watching that horror movie last night",
      "he is not following me anymore, all good now",
    ])
      expect(triageByRules(text).category).toBe("general");
  });

  it("recognises English, Devanagari Hindi and romanized Hindi", () => {
    expect(detectLanguage("someone is following me")).toBe("en");
    expect(detectLanguage("koi mera peecha kar raha hai")).toBe("hi-Latn");
    expect(detectLanguage("मुझे डर लग रहा है")).toBe("hi");
    expect(detectLanguage("நன்றி")).toBe("und");
    expect(detectLanguage("👍")).toBe("und");
  });

  it("returns 'unknown' needing review for unsupported scripts, and 'unknown' for near-empty text", () => {
    expect(triageByRules("தயவுசெய்து உதவுங்கள்")).toMatchObject({
      category: "unknown",
      needs_review: true,
      strength: "none",
    });
    expect(triageByRules("?").category).toBe("unknown");
    expect(triageByRules("").category).toBe("unknown");
  });

  it("only offers actions appropriate to each category", () => {
    expect(
      triageByRules("The street light is not working on this lane")
        .suggested_actions,
    ).toEqual(["report_hazard"]);
    expect(triageByRules("good morning neighbours").suggested_actions).toEqual(
      [],
    );
    expect(
      triageByRules("Got catcalled by a group outside the gate")
        .suggested_actions,
    ).toContain("report_harassment");
    for (const text of ["hello", "the bus was late"])
      expect(triageByRules(text).suggested_actions).not.toContain("call_112");
  });

  it("is safe on hostile input: huge, repetitive, markup, control characters", () => {
    const cases = [
      "a".repeat(500),
      "help ".repeat(100),
      "i am ".repeat(100),
      "is ".repeat(160) + "following me",
      "<script>alert(1)</script> help me knife",
      "\u0000\u0001‮ help me ​​",
      "😀".repeat(200),
      "ह".repeat(500),
    ];
    for (const text of cases) {
      const start = performance.now();
      const r = triageByRules(text);
      expect(performance.now() - start).toBeLessThan(250);
      expect(TRIAGE_CATEGORIES).toContain(r.category);
      expect(typeof r.reason).toBe("string");
    }
  });

  it("is deterministic", () => {
    const text = "mujhe bahut dar lag raha hai akele";
    expect(triageByRules(text)).toEqual(triageByRules(text));
  });
});
