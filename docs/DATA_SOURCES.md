# Data-source registry

Authoritative inventory of external datasets, providers, APIs, models and
internal data. Status labels: `CONNECTED_VERIFIED`, `CONNECTED_UNVERIFIED`,
`EVALUATED_NOT_CONNECTED`, `PLANNED`, `MOCK_OR_SYNTHETIC`, `UNAVAILABLE`,
`INTERNAL_USER_GENERATED`.

A source is `CONNECTED_VERIFIED` only after an adapter exists, a representative
real query succeeded, and success + failure tests pass. A URL in code is not a
connection. Development fixtures are never described as real data. Model output
is never an official incident report. Last updated: 2026-10-10 (Stage 3).

## Summary

| Source                                                          | Feature                                  | Status                                                                                              | Last verified             |
| --------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------- |
| OpenStreetMap data via Overpass API                             | Nearby services / map                    | CONNECTED_VERIFIED (public servers unreliable; see caveats)                                         | 2026-10-10 (live smoke)   |
| OpenStreetMap tiles                                             | Map display                              | CONNECTED_UNVERIFIED (real tile fetched via curl; in-browser use tested only against a local stub)  | 2026-10-10                |
| Nominatim geocoding                                             | Place search                             | EVALUATED_NOT_CONNECTED (not needed yet: users pick a city or tap the map)                          | 2026-10-10 (manual probe) |
| OSRM public demo                                                | Route comparison                         | CONNECTED_VERIFIED (vehicle network only; demo server)                                              | 2026-10-10 (live smoke)   |
| Google Places / Routes                                          | –                                        | EVALUATED_NOT_CONNECTED (not selected)                                                              | –                         |
| `Woman_Safety_Dataset_Management.csv`                           | Demo fixtures only (`npm run seed:demo`) | MOCK_OR_SYNTHETIC                                                                                   | 2026-10-10                |
| NCRB via data.gov.in                                            | Official statistics                      | EVALUATED_NOT_CONNECTED (no licensed street-level data; access blocked; see section)                | 2026-10-10                |
| SafeCity                                                        | Research reference                       | EVALUATED_NOT_CONNECTED (no authorized access)                                                      | –                         |
| ERSS 112 / Women Helpline 181                                   | Emergency information                    | PLANNED (numbers to verify on official pages)                                                       | –                         |
| AI4Bharat IndicSentiment                                        | Triage research                          | EVALUATED_NOT_CONNECTED (no licence stated on card; sentiment ≠ danger)                             | 2026-10-10                |
| HASOC datasets                                                  | Triage research                          | EVALUATED_NOT_CONNECTED (no licence/terms stated; offensive-content labels only)                    | 2026-10-10                |
| Cline SDK (`@cline/sdk@0.0.92`)                                 | Copilot                                  | CONNECTED_UNVERIFIED (offline runtime proven; no live model call)                                   | 2026-10-10                |
| SAKHI user reports (incident, hazard)                           | Map, area indicator, route counts        | INTERNAL_USER_GENERATED                                                                             | 2026-10-10                |
| SAKHI Safe Havens                                               | Nearby help                              | INTERNAL_USER_GENERATED (verified only; no onboarding flow yet; demo entries are MOCK_OR_SYNTHETIC) | 2026-10-10                |
| SAKHI area ratings, room messages, triage results, alert events | Rooms, ratings, moderation               | INTERNAL_USER_GENERATED (triage results are rule-generated classifications, not reports)            | 2026-10-10                |
| Notification provider                                           | SOS/journey alerts                       | MOCK_OR_SYNTHETIC (dev simulation only)                                                             | 2026-10-10                |
| Supabase Realtime                                               | Chat transport                           | EVALUATED_NOT_CONNECTED (not needed: single-host Server-Sent Events used; see ADR 0003)             | 2026-10-10                |
| Bridgefy / Briar / Nearby Connections                           | Offline P2P                              | PLANNED (feasibility spike in Stage 5)                                                              | –                         |

## OpenStreetMap data via Overpass API

- Official: https://wiki.openstreetmap.org/wiki/Overpass_API · public instance `https://overpass-api.de/api/interpreter` · explorer https://overpass-turbo.eu/
- Feature: nearby police, hospitals, pharmacies, bus stops, public toilets, help points (shared places service).
- Fields: element id/type, lat/lon (or centre), `amenity`/`highway` tags, optional `name`, `phone`/`contact:phone`, `opening_hours`, `addr:*`. Granularity: point/area features worldwide; per-feature coverage varies by locality. Freshness: replicated minutely; `timestamp_osm_base` returned per query (observed 2026-10-10T11:21Z). Individual features may be years old.
- Licence: ODbL 1.0 — attribution "© OpenStreetMap contributors" required and share-alike on derived databases; https://www.openstreetmap.org/copyright.
- Auth: none. Quota: public servers are shared and rate/slot limited; not for high volume. Identify the app with a User-Agent.
- Probe results (2026-10-10, manual, Entry 006): Delhi centre 200 in 11.3 s with sparse tags (3/42 phone, 0/42 hours); combined queries for Bengaluru and Jaipur returned 504; smaller police+hospital query returned 200 in 1.6 s; mirror `overpass.private.coffee` 200, `overpass.kumi.systems` 500.
- Status: **CONNECTED_VERIFIED** (2026-10-10). Adapter: `src/server/places/overpass.ts` + `service.ts` — per-category queries, 12 s timeout, one mirror fallback, serialised and paced (1 s) upstream calls, 24 h cache with stale fallback up to 7 days, per-process request coalescing, user position never sent upstream (a ~1 km grid point is), missing fields stay null.
- Verification: `tests/places.test.ts` (25 tests incl. a real recorded response, 429/504/500/400/timeout/invalid-JSON/runtime-error remark, cache/stale/failed, privacy, rate limit) and live `npm run smoke:map` on 2026-10-10: Delhi police 6 ok but hospital and pharmacy queries failed with HTTP 5xx; Bengaluru police 10, pharmacy 10, hospital failed; Jaipur police 2, hospital 10, pharmacy failed — i.e. **about a third of live category queries failed on the public server**, which the UI reports per category.
- Known gaps: sparse phone/hours; OSM does not say whether an amenity is a safe place; "ambulance station" coverage in India is limited.

## OpenStreetMap tiles

- https://operations.osmfoundation.org/policies/tiles/ — the public tile servers are not for heavy use and require attribution and a valid Referer/User-Agent. Planned for development/demo scale only; production needs a tile provider or own tiles. Status: PLANNED.

## Nominatim

- https://nominatim.org/release-docs/latest/api/Overview/ · policy https://operations.osmfoundation.org/policies/nominatim/ — max 1 request/second, identifying User-Agent, caching required, no bulk geocoding, autocomplete discouraged.
- Probe: `search?q=Connaught+Place+Delhi` returned 200 with ODbL licence note (2026-10-10). Status: EVALUATED_NOT_CONNECTED.

## OSRM

- https://project-osrm.org/docs/ · public demo `router.project-osrm.org` (demonstration only; no uptime/volume guarantee).
- Probe: Delhi two-point route with alternatives → `Ok`, 2 routes, 1.6 s. Walking-profile fidelity unverified (KI-008). Route output has no safety data; comparison would show distance/duration plus separately sourced signals only.
- Status: **CONNECTED_VERIFIED as a demo server** (2026-10-10, `src/server/routing.ts`, `tests/safety-map.test.ts`, live smoke: 2 routes returned). Confirmed 2026-10-10 that the demo returns **identical** distance/duration for `foot`, `driving` and `bike` (3981 m/396 s and 5572 m/562 s), so only the vehicle network is available; SAKHI labels routes accordingly (KI-008). Not for production volume.

## Google Places / Routes

- https://developers.google.com/maps/documentation/places/web-service/overview · /routes. Not selected: needs billing key and has caching/display restrictions. Revisit only if OSM coverage proves inadequate.

## `Woman_Safety_Dataset_Management.csv` (local file)

- Origin: provided by the project owner; no source, licence or collection method documented. 20,000 rows, columns: incident_id, city, area, latitude, longitude, crime_type, crime_count, time_of_day, lighting_score, police_station_distance_km, crowd_density, weather_condition, safety_score, risk_level, incident_timestamp.
- Assessment (Entry 004): synthetic — uniform category counts, `time_of_day` independent of timestamp hour, random IDs.
- Status: MOCK_OR_SYNTHETIC. Allowed use: labelled demo fixtures and prototype-scoring development only. Prohibited: presenting as real incidents, official statistics or validated risk. Not committed to Git (owner decision pending, KI-006).

## NCRB (data.gov.in)

- https://data.gov.in/ministrydepartment/National%20Crime%20Records%20Bureau%20%28NCRB%29 — official aggregates (state/city, annual). Not street-level; time lag of 1–2 years typical. Licence: Government Open Data Licence – India (to confirm per dataset). 2026-10-10 evaluation: search found data.gov.in resources for district-wise crimes against women (e.g. 2013, source Crime in India 2013), annual, police districts, no API; a 2016 mirror listed "No License Provided"; direct fetch of the NCRB organisation page returned HTTP 403. Third-party repackagers (Dataful, Mendeley) exist but have their own terms. Conclusion: no verified, licensed, current, street-level feed. Status: EVALUATED_NOT_CONNECTED. The UI states "Official statistics: not available" instead of showing anything.

## SafeCity

- https://webapp.safecity.in/ — research reference. No authorized data-access mechanism; no scraping or bulk import. Status: EVALUATED_NOT_CONNECTED.

## Women Helpline 181 and emergency number 112 (information links)

- https://missionshakti.wcd.gov.in/ — fetched 2026-10-10. The page lists "WHL : 181" and describes Women Helpline as a 24x7x365 telephone short code service that links women to the police, One Stop Centres, hospitals and legal services authorities; the same page lists "For Emergency : 112". Other references: https://112.gov.in/ (connection refused from the test machine on 2026-10-10, so unverified here) and https://www.india.gov.in/directory/helpline (not yet checked).
- Use in SAKHI: user-initiated `tel:` links only (`EmergencyHelp` component, header link). No dispatch API is used or claimed. A SAKHI SMS to a relative does not notify police. Numbers are static configuration; re-verify before each release. Status: CONNECTED_VERIFIED as static information (no API).

## AI4Bharat IndicSentiment / HASOC

- https://huggingface.co/datasets/ai4bharat/IndicSentiment — product-review sentiment, polarity positive/negative/neutral, ≥ 10 Indic languages (Assamese, Bengali, Hindi, +7 more). The card fetched 2026-10-10 states **no licence**; loading needs a script. https://hasocfire.github.io/hasoc/2025/dataset.html — hate/offensive-content shared-task data (2019–2025; English, Hindi, Marathi, Bangla, Gujarati, Bodo, code-mixed), downloaded from Drive/GitHub links with **no licence or terms stated**.
- Neither contains distress/emergency labels, so neither can validate an emergency detector. Not downloaded, not used. SAKHI's triage is measured on its own hand-labelled sets (`docs/SAFETY_TRIAGE.md`). Status: EVALUATED_NOT_CONNECTED.

## Cline SDK

- https://github.com/cline/cline (sdk) · npm `@cline/sdk@0.0.92`, Apache-2.0, Node >=22.
- Verified (2026-10-10 spike): installation; `createTool` + `Agent` execute a custom tool through the real runtime with a stub model; the result field is `outputText`. Not verified: any live provider call (needs `CLINE_API_KEY`).
- Blocker discovered: installing it adds 34 production audit advisories (4 critical) via transitive dependencies (KI-011). Removed from `package.json` until Stage 6. Status: EVALUATED_NOT_CONNECTED.

## Notification provider

- Local simulation adapter labelled "Simulated — no message sent". Production selects a fail-closed adapter. No real SMS/WhatsApp provider is integrated. Status: MOCK_OR_SYNTHETIC.

## Demo hotspots, ratings and area-room chats

- `scripts/build-hotspots.ts` reads `Woman_Safety_Dataset_Management.csv` (synthetic) and writes `src/data/demo-hotspots.json`: 50 named areas in 10 cities. The CSV's own coordinates are scattered around each city centre and do not follow its area names, so each area is placed at an approximate real-world centre and the CSV rows with that area name supply its stats (safety score, share of high-risk rows, lighting, police distance, evening/night share).
- The 450 area-room messages are synthesised from templates weighted by each area's top crime types. The star rating (1–5) blends the data score (60%) with a word-list sentiment read of those messages (40%); the short description is built from the same read (`src/lib/hotspots.ts`). It is a demo, not a validated model. Status: MOCK_OR_SYNTHETIC.
- `scripts/fetch-services.ts` snapshots **real** OpenStreetMap police stations, hospitals, metro/rail stations and 24/7 pharmacies around those areas into `src/data/demo-services.json` (© OpenStreetMap contributors, ODbL; snapshot date inside the file). Names, positions and phone numbers are as mapped by contributors and not verified by SAKHI. Routes to a service come from the OSRM public demo server (vehicle roads). Status: EVALUATED_AND_CONNECTED (snapshot).

## Nearby help radius, synthetic women help desks and safe zones

- `src/lib/services.ts` serves help around any point up to 12 km (`GET /api/services/nearby`). The map's distance slider filters that list client-side. **Real:** police, hospitals, metro/rail stations and 24h pharmacies from the OSM snapshot above. **Synthetic (labelled DEMO, shown dashed on the map):** 4 women help desks and 9 safe zones generated deterministically around each of the 50 hotspots. Women help desks list the real national helpline 181, but their positions are invented. Status: MOCK_OR_SYNTHETIC for the generated records.

## Trip planner and one-tap journey share

- `POST /api/trip/plan` asks the OSRM demo server for the direct road route plus alternatives, and up to two routes via a nearby police station, women help desk, safe zone or station. Each route gets a 0–100 **demo** safety score from the synthetic area ratings it passes (inverse-distance weighted) plus help points within 250 m (`src/lib/trip.ts`). Hand-set weights, not validated, not a prediction. Walk/bus/metro times are rough estimates from distance; OSRM only gives vehicle roads. Status: MOCK_OR_SYNTHETIC scoring over real OSRM geometry.
- `POST /api/journeys/[id]/share` (migration `008_journey_shares.sql`): one tap messages the journey's sharing-enabled contacts the ETA, a route summary and the user's current location, through the same notification provider as SOS (simulation mode sends nothing real and says so). Coordinates are sent in the message only and are never stored; `journey_shares` records who was messaged and the outcome. Each retry with the same request id returns the first result instead of messaging twice.
