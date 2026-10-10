# ADR 0001 — Keep Next.js + SQLite + Better Auth; SSE for realtime

Date: 2026-10-10 · Status: accepted

## Context

The repository already contains a tested Next.js 16 app with Better Auth sessions and a migrated better-sqlite3 database. No Postgres, Docker or Supabase project exists on the development machine. The owner allowed Supabase "if required".

## Decision

Retain the current stack. Build geospatial features without PostGIS (grid-cell rooms, bounding-box prefilter + Haversine). Deliver room messages over Server-Sent Events with persisted history and per-request membership authorisation. Implement the room service behind an interface so the transport can change.

## Adopt Supabase (Postgres, PostGIS, private Broadcast, RLS) only if

- the deployment must be multi-host or serverless, or
- the Stage 3 realtime tests show SSE fan-out is inadequate, or
- PostGIS capabilities become necessary.
  Then record a new ADR and request project credentials from the owner.

## Consequences

- Authorisation is enforced in the service layer (no database RLS); every query is owner-scoped.
- Single-host deployment with a persistent disk (already documented).
- In-process pub/sub is correct only on one host.
