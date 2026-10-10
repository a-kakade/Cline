# Safety signals, the area indicator, and their limits

SAKHI keeps six different kinds of information separate. They are never merged
into one opaque "safety score", and none is presented as a validated prediction
of crime.

| #   | Signal                                  | Where it comes from                  | Status today                                                                                                                                                                                                           |
| --- | --------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Official / independent crime statistics | Would be NCRB or similar             | **Not connected.** NCRB data on data.gov.in is annual, state/district level, the 2013/2016 snapshots found carry no stated licence, and the portal blocked automated access (HTTP 403). Not street-level, so not used. |
| 2   | Verified incident reports               | Moderator/responder-verified reports | Table and counting exist; **no verification workflow yet** (needs moderator roles, Stage 3), so the count is 0 in practice.                                                                                            |
| 3   | Unverified user reports                 | SAKHI users (`POST /api/reports`)    | Live. Labelled "Unverified user report"; stored position rounded to ~110 m; reporter never exposed.                                                                                                                    |
| 4   | Infrastructure hazards                  | SAKHI users                          | Live (poor lighting, broken path, …), same labelling.                                                                                                                                                                  |
| 5   | Community ratings                       | SAKHI users                          | Not built yet (Stage 3). The indicator shows "not available".                                                                                                                                                          |
| 6   | AI-generated summaries                  | A language model                     | None. If added, they will be labelled as descriptions of the numbers, not evidence.                                                                                                                                    |

Synthetic demo reports (from the provided CSV, see `DATA_SOURCES.md`) are tagged
`synthetic_demo`, hidden by default, only loadable outside production unless
`ALLOW_DEMO_DATA=1`, and labelled "DEMO DATA — did not happen" wherever shown.

## Area unit

A stable ~500 m grid cell (`src/lib/geo.ts`, id like `g500:25123:17320`). Every
point in a cell gets the same id; the id encodes the cell, not a person's
position.

## The "reported-concerns indicator" (prototype `report-volume-prototype-v1`)

Counts reports in the cell within a window (default 90 days), weighted by type,
with a cap per type so one signal cannot dominate:

| Input                    | Weight | Cap (count) |
| ------------------------ | ------ | ----------- |
| Verified incident report | 3      | 5           |
| Unverified user report   | 1      | 10          |
| Infrastructure hazard    | 1.5    | 5           |

Level: fewer than **3** reports → _Not enough reports to say anything_ (no
number shown). Otherwise points < 4 → _Few reports_, ≥ 4 → _Some reports_, ≥ 10
→ _Many reports_. The weights and thresholds were set by hand; they are **not
fitted to data and not validated** against any outcome. The level wording
describes report volume; it never says "safe" or "dangerous".

## Known limitations (also shown in the UI)

- Reports are voluntary and biased toward places and people who use the app.
- An absence of reports is not proof of safety; more reports may mean more
  reporters, not more harm.
- One user cannot create more than 5 reports/minute or 20/day, and cannot repeat
  the same category in the same cell within 24 h, but coordinated or malicious
  reporting is not detected (no moderation tooling yet).
- The indicator ignores report severity, time of day and how many people use the
  area.

## Route comparison

Uses the public OSRM demo server, which returned **identical results for the
foot, driving and bike profiles** (tested 2026-10-10), so it only knows the
vehicle road network. SAKHI therefore labels them "vehicle road routes", shows
vehicle time only, and displays _counts_ of reports and verified Safe Havens
within 150/200 m of each route. It does not rank routes or call one safer.
Both route endpoints are sent to the routing provider.

## Nearby services

OpenStreetMap contributors map the places. A mapped police station, hospital
or pharmacy is shown with only the details that are mapped (name, address,
phone, hours) and "Not mapped" otherwise. Real sample (Delhi centre,
2026-10-10): of 7 police/hospital elements, 2 had a phone, 0 had opening
hours, 3 had no name, and one "hospital" was an IT company — so SAKHI states
"mapped by OpenStreetMap contributors (not verified by SAKHI)" and links to the
OSM entry so users can fix it. **Safe Haven** status requires explicit
participation and verification and is never inferred from an ordinary listing.
