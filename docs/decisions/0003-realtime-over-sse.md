# ADR 0003 — Area chat over Server-Sent Events (Supabase not adopted)

Date: 2026-10-10 · Status: accepted · Supersedes the "revisit at Stage 3" note in ADR 0001

## Decision

Rooms are keyed by the grid-cell id; messages are persisted (SQLite) and then published on an in-process bus; members receive them over SSE (`/api/rooms/[id]/stream`). Authorization is checked before a stream opens, on every 20 s ping, and on revocation events (ban/leave). Clients reconnect with their own backoff and recover missed messages from `GET …/messages`.

## Why not Supabase

None of ADR 0001's adoption triggers fired: the deployment is single-host, SSE delivery/reconnect/authorization tests pass (unit and two-browser e2e), and PostGIS is not needed for grid-cell rooms. Supabase remains the fallback if multi-host operation is required.

## Consequences

In-process fan-out only works on one host (KI-019). Pseudonymous aliases are HMACs of room+user with the server secret (rotating the secret changes all aliases). Membership is self-reported (KI-017).
