# ADR 0002 — Cline SDK runs server-side with explicit custom tools only

Date: 2026-10-10 · Status: accepted (implementation in Stage 6)

## Context

`@cline/sdk@0.0.92` (Apache-2.0, Node >=22) exports `Agent` and `createTool`. A spike proved a custom tool runs through the real runtime using a stub `AgentModel`.

## Decision

- The Copilot lives in `src/server/copilot/` and is only invoked from authenticated API routes. The API key (`CLINE_API_KEY`) never reaches the browser.
- The agent receives **only** the seven SAKHI tools. No shell, file-system, MCP or other built-in tools. Tests assert the tool list.
- The authenticated user id is closed over by each tool; tool inputs never contain a user id.
- Tools read through existing services. The only write is `draft_incident_report`, which creates an unconfirmed draft.
- Deterministic tests use a stub `AgentModel`; a live smoke script runs only when a key is present.
- Emergency features never depend on the Copilot.

## Consequences

The SDK pulls in a large dependency tree (telemetry, websockets); its telemetry must be reviewed/disabled in Stage 6 and recorded in the data-source registry.

## Addendum 2026-10-10 — dependency advisories

Installing `@cline/sdk@0.0.92` raised `npm audit --omit=dev` from 0 to 34 findings (4 critical, 14 high), all transitive (KI-011). The package was removed after the spike. Stage 6 may re-add it only after reachability is assessed and mitigation (overrides, isolated worker process, or similar) is documented here.
