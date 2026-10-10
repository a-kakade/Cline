# Safety triage of area-room messages

**Status: a weak triage aid, not an emergency detector.** It misses roughly half
of urgent messages on unseen data. Emergency access never depends on it.

## What it does

Each room message is classified by deterministic rules (`src/server/triage/rules.ts`)
into: `general`, `concern`, `harassment_report`, `infrastructure_hazard`,
`distress`, `urgent_safety_concern`, `unknown`. Output: category, language
(`en`, `hi`, `hi-Latn`, `und`), match **strength** (`none|weak|moderate|strong`, _not_
a probability), a generic reason (never echoing the user's words), `needs_review`,
and suggested actions.

Consequences of a result — and nothing else:

1. **Sender only:** help chips (Call 112, Open SOS, Find nearby help, Share your
   journey, Report a hazard / what happened), labelled "automatic suggestion; may be wrong".
2. **Moderators only:** for `urgent_safety_concern`, `distress`, `harassment_report` a
   queue entry may be created (see policy). It holds ids, the category and priority —
   no coordinates and no phone numbers — and the queue shows the message text
   with a note that the flag may be wrong.
3. Other members see the message and _nothing_ about its classification.

It never contacts police, ambulance, trusted contacts or anyone else, and never
changes a room's or area's rating/indicator ("community sentiment alone does not
make a hotspot").

## Alert policy (`src/server/alert-policy.ts`)

| Category                          | Priority | Deduplication                    | Cooldown / caps                                                      |
| --------------------------------- | -------- | -------------------------------- | -------------------------------------------------------------------- |
| urgent_safety_concern             | urgent   | one per room + author per 10 min | ≤ 3 alerts per author per hour; ≤ 5 urgent per room per rolling hour |
| distress                          | review   | one per room per 30 min          | author cap as above                                                  |
| harassment_report                 | review   | one per room per 30 min          | author cap as above                                                  |
| concern, hazard, general, unknown | –        | no alert                         | –                                                                    |

Recipients: users holding the `moderator` role, granted only by
`npm run role:grant -- <email> moderator` (no HTTP path). Campus responders are
not implemented. Triage or alert failure never blocks, delays or hides a message.

## Measured quality (single annotator = the engineer; not independent)

Three labelled sets in `tests/fixtures/` (EN, Hindi, romanized Hindi; includes hard
negatives such as "can someone help me find the library", fiction, past events,
negation). `npx tsx scripts/triage-eval.ts <file>` reproduces the numbers.

| Set                              | Role                                                      | Result (exact category)                                                                                                             |
| -------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `triage-eval-dev.json` (61)      | used to write the first rules                             | 100% — _overfit, proves nothing_                                                                                                    |
| `triage-eval-heldout.json` (63)  | written after rules v1, then **used to revise the rules** | v1: **60.3%** (urgent recall 5/12); after revision 100% — _contaminated_                                                            |
| `triage-eval-heldout2.json` (61) | written after the revision, **never used for tuning**     | **72.1% (44/61)** — urgent recall **6/12 (50%)**, distress 4/8, harassment 5/8, hazard 5/8, concern 6/6, general 14/15, unknown 4/4 |

Only the last row is an unbiased estimate, and it is from 61 hand-written
messages: wide uncertainty, small samples per category. Failure modes seen:
paraphrases the lexicons don't cover (e.g. "circling me", "breaking the door",
"heart is racing", "dug up… no barricades", Hindi paraphrases), and false positives
such as "my friend is following me on instagram haha". Every miss falls to
`general`, i.e. silence — which is why help must never be gated on this.
`tests/triage.test.ts` pins these numbers as a regression floor (not a claim of adequacy).

## Datasets evaluated (not used for training or scoring)

- **AI4Bharat IndicSentiment** — product-review sentiment (positive/negative/neutral),
  ≥ 10 Indic languages; the dataset card fetched on 2026-10-10 states no licence and the
  repository needs a loading script. Sentiment ≠ danger; unsuitable as an emergency
  benchmark; licence unconfirmed. `EVALUATED_NOT_CONNECTED`.
- **HASOC** (FIRE shared tasks 2019–2025) — hate/offensive-content labels for English,
  Hindi, Marathi, Bangla, code-mixed. Direct download links; **no licence or terms
  stated** on the 2025 dataset page fetched on 2026-10-10. Offensive-content labels do
  not label distress or emergencies. `EVALUATED_NOT_CONNECTED`.

## What would be needed to take this further

A larger labelled set written and adjudicated by several annotators (including
survivors' advocates), with realistic code-mixed text; measure per-language recall of
urgent messages; evaluate any model refinement (Stage 6, needs `CLINE_API_KEY`) on a
set never used for tuning; report confidence intervals; keep the UI wording that this
is an aid. Until then, treat missing a flag as the normal case.
