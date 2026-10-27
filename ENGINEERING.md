# Engineering notes

How MaidCare is put together, the trade-offs it makes, where it's inefficient
today, and what I'm working on next. The app serves one small business (two
vans, +100 recurring customers, a handful of staff), and several
choices below are right for that size and would change at a larger one. I'd
rather say so here than leave it for a reader to find.

## Architecture

```
Browser ──► Next.js 16 on Vercel (App Router, Server Components, Server Actions)
              │
              ├── Neon Postgres (Drizzle ORM, HTTP driver)
              │     triggers: audit_log, created_by/updated_by stamping
              │
              ├── Stripe ──► webhooks ──► /api/stripe/webhook   (invoices, payments)
              └── Bouncie ─► webhooks ──► /api/bouncie/webhook  (trips, vehicle health)
```

- **No separate API layer.** Pages read the database in Server Components,
  and changes go through Server Actions. Every action re-checks the session
  and the permission on the server, because Server Actions are public
  endpoints even when their button is hidden.
- **Authorization in one place.** [lib/auth/permissions.ts](lib/auth/permissions.ts)
  maps roles to permissions. Buttons and server checks both call `can()`.
- **Stripe is the source of truth for money.** The `invoices` table is a
  mirror, kept current by signed webhooks and an on-demand sync. Every write to
  Stripe carries an idempotency key, so a retried request never charges or
  creates anything twice.
- **The database enforces what it can.** Check constraints, partial unique
  indexes (one open plan per property, one primary contact per customer),
  composite foreign keys (a billing address must be the customer's own
  property), triggers for the audit log, and a trigger that makes signed
  estimate acceptances immutable.
- **Migrations run in the deploy.** `vercel-build` checks the environment,
  runs the unit tests, builds, then migrates in one transaction. If anything
  fails, the previous version stays live.

## GPS visit detection

[lib/fleet/sync.ts](lib/fleet/sync.ts) turns raw Bouncie trips into visit
times.

1. Each trip's start and end point is matched to the nearest property within
   500 m. GPS fixes and address geocoding are each off by tens of meters, and
   vans park down the street.
2. Per vehicle and property, arrivals and departures become **stays**: a trip
   ending at the property starts one, and a trip leaving ends it, unless the
   van is back within an hour (a supply run). Stays under 10 minutes are
   driving past.
3. Stays from different vans that overlap (or follow within an hour) are
   grouped into one **visit**: it starts at the first arrival and ends when
   the last van leaves. Crews swap vans and change order without notice, so a
   visit matches any van, any time that day.
4. Visits move from pending to in progress to completed by themselves. For
   today's visits the calendar follows what really happened, and the booked
   times are kept separately.

This is a variant of *stay-point detection* (Li et al., 2008, Microsoft
GeoLife). Concurrency is handled with a **lease**: a single-row
`UPDATE … WHERE lease expired RETURNING` lets only one sync run at a time,
without a lock server.

## Known inefficiencies

Each item is fine at today's size. Listed from most to least likely to
matter.

### 1. Background work only runs when someone uses the app
There's no scheduler. Fleet sync runs when Bouncie sends a webhook or while
someone has the Fleet page open, and schedule alerts (missed visits, recurring
visits to book, invoices to finalize) run after the dashboard loads
(`after()` in [app/(app)/page.tsx](app/(app)/page.tsx)). If nobody opens the
app on a quiet day, those alerts don't go out. The sync lease keeps this
correct, but it's covering for the missing scheduler.
**Fix:** a Vercel Cron job (or a queue such as Inngest or QStash) that calls
the sync and the alerts on a schedule, with the page-load triggers kept as a
fallback.

### 2. One database round trip per item in several loops
`updateVehicles` runs an `UPDATE` per vehicle, `rematchTrips` one per changed
trip, and `notifyRecurringDue` runs a "was this already sent?" query plus an
insert for each upcoming visit. Over Neon's HTTP driver, each one is a network
round trip.
**Fix:** batch them: `UPDATE … FROM (VALUES …)` for the updates, one query
for the already-sent set, and one multi-row `INSERT`.

### 3. A missing index on notifications
That "already sent?" check looks notifications up by `(kind, href)`, but the
table is only indexed on `created_at`
([db/schema.ts](db/schema.ts), `notifications`). Each check scans the whole
table, and the table only grows.
**Fix:** a unique index on `(kind, href)` plus `INSERT … ON CONFLICT DO
NOTHING`. That's faster, and the database itself guarantees no duplicates.

### 4. Matching trips to properties is brute force
`nearest()` in [lib/fleet/geo.ts](lib/fleet/geo.ts) compares every trip
endpoint with every property (trips × properties haversine calls), and
`saveTrips` reloads the property list for each vehicle and each week of trips.
**Fix:** load properties once per sync with a bounding-box pre-filter. At a
larger scale, use PostGIS with a GiST index and `ST_DWithin`.

### 5. Every sync re-reads six hours of trips
Devices that lose signal upload trips late, so each sync re-requests the last
six hours (`OVERLAP`) and upserts them. That's correct (the writes are
idempotent), but it spends API calls and writes on unchanged data.
**Fix:** ask Bouncie only for trips changed since the last sync, if the API
supports it, or skip upserts whose `transactionId` and end time are unchanged.

### 6. The browser polls
The notification bell and the fleet map each refresh every 60 seconds per
open tab. With a handful of users that's nothing.
**Fix:** server-sent events or a hosted realtime service (Vercel's serverless
functions aren't built for long-lived connections), fed by Postgres
`LISTEN/NOTIFY`.

### 7. Rate limiting lives in Postgres
Failed sign-ins are rows in `login_attempts`, counted per window, and each
failure also deletes rows older than a day. It's simple, transactional and
needs no extra service.
**Fix at scale:** a sliding-window limiter in Redis (such as Upstash
Ratelimit), with the cleanup moved to the scheduled job from item 1.

## Roadmap

What I'm working on next, in order:

- [ ] **Notifications index** (#3): add the unique index and switch alerts to
      `ON CONFLICT DO NOTHING`. Measure with `EXPLAIN ANALYZE` before and after.
- [ ] **Batch the per-row loops** (#2) in fleet sync and the schedule alerts.
- [ ] **Scheduled jobs** (#1): run the fleet sync and alerts on a cron, so
      nothing depends on someone opening the app.
- [ ] **Load properties once per sync** (#4), with a bounding-box pre-filter.
- [ ] **Website booking intake**: the company website posts booking requests
      to an authenticated endpoint, and they become leads with a notification
      for staff.
- [ ] **Void, refund and mark uncollectible** from the app instead of the
      Stripe dashboard.
- [ ] **Integration tests for the visit-detection edge cases**: van swaps, GPS
      gaps, two visits at one property on one day.

## About the demo

The [live demo](README.md) runs this code with `DEMO_MODE=1` against its own
database:
[lib/demo-seed.ts](lib/demo-seed.ts) builds about four months of made-up
history around today's date. Visits in the last 30 days are seeded as
*pending*, and the real visit detection completes them from simulated GPS
trips, so the demo exercises the same code path as production. Stripe and
Bouncie are switched off entirely in demo mode, and a nightly cron rebuilds
the data.
