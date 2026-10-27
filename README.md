# MaidCare

The operations app that runs [Maid Care Home Services](https://www.google.com/search?q=Maid+Care+Home+Services+Dundalk+MD),
a residential and commercial cleaning business in Maryland. It holds
the customers, their homes and service plans, the schedule, the vans' GPS, the
invoices, expenses, contractor pay and inventory, in one place for the owner
and the office staff.

**[Live demo →](https://DEMO-URL-HERE)** Sign in as the owner or as staff with
one click. Everything in the demo is made up (no real customer, payment or
location data), and it resets every night.

This repository is the public copy of the production app. The production
version has its own private repository, database, Stripe account and Bouncie
account, and none of them are reachable from here.

### Highlights
- **GPS visit detection.** Vans report trips through Bouncie. Each trip's start
  and end are matched to the nearest property within 500 m, and a variant of
  stay-point detection turns them into arrivals and departures: the visit
  starts when the first van arrives and stays 10+ minutes, and ends when the
  last one has left (a supply run that's back within an hour doesn't count).
  Visits move from pending to in progress to completed on their own
  ([lib/fleet/sync.ts](lib/fleet/sync.ts)).
- **Stripe as the source of truth for money.** Invoices are mirrored from
  Stripe and kept current by signed webhooks plus an on-demand sync, with
  idempotency keys on every write ([lib/stripe-invoices.ts](lib/stripe-invoices.ts)).
- **Security built for customer data.** Two-step login is required for every
  account, there's layered rate limiting, sessions are stored hashed,
  contractors' tax IDs are encrypted, every change goes to an audit log written
  by database triggers, and all authorization lives in one file
  ([lib/auth/permissions.ts](lib/auth/permissions.ts)), checked on the server
  for every action.
- **Estimates customers sign online.** Each acceptance stores a SHA-256
  fingerprint of the exact version accepted, and the database refuses to
  change or delete acceptance rows.
- **Bilingual.** English and Brazilian Portuguese, chosen per user.

**[ENGINEERING.md](ENGINEERING.md)** covers the design decisions, the known
inefficiencies and what I'm working on next.

### Running the demo yourself
```bash
npm install
# .env.demo: DATABASE_URL, DATABASE_URL_UNPOOLED, AUTH_SECRET, DEMO_MODE=1
npm run demo:migrate
npm run demo:seed
DEMO_MODE=1 npm run dev   # with the same DATABASE_URL and AUTH_SECRET
```
`DEMO_MODE=1` adds the one-click sign-in, drives the simulated vans, turns
off Stripe and Bouncie entirely, and stops visitors from managing users. See
[lib/demo.ts](lib/demo.ts) and [lib/demo-seed.ts](lib/demo-seed.ts).

---

The rest of this file is the app's own documentation.

## Features

### Sign-in
- Email and password at `/login`, then a 6-digit code from an authenticator
  app (Google Authenticator, Microsoft Authenticator, 1Password, Authy).
  **Two-step login is required for every account**: the first sign-in sets it
  up (scan a QR code, confirm one code, save 10 one-time recovery codes).
- No session exists until both steps pass. Wrong codes count toward the
  sign-in limit, five wrong codes end that sign-in, and a code can't be used
  twice.
- Wrong passwords are limited per email from the same address (5 in 15
  minutes), per address (20) and per email overall (100 an hour), so a
  stranger who knows your email can't lock you out. Wrong two-step codes are
  limited per email (5 in 15 minutes). After signing in you're only ever sent
  to a page on this site. Sessions last 14 days. **Sign out** is in the header.
- **Settings → Security** shows two-step login and recovery codes left, and
  makes new recovery codes (needs a current code).
- **Roles**: owner, admin and staff. The owner can do everything; admin and
  staff do day-to-day work but none of the sensitive actions (charging, marking
  paid, finalizing, deleting, Stripe and Bouncie settings, managing users)
  until they're allowed in `lib/auth/permissions.ts`, the one place that
  decides. Buttons are hidden and the server refuses the actions too.
- **Staff** see customers and leads (adding leads, properties, appointments and
  estimates, not editing a customer's code, status or Stripe link, or editing
  properties); book and change today's and future visits only (not completing,
  deleting or invoicing them; they can swap a visit's unpaid invoice); see
  invoices (PDF only); make and send estimates and book accepted ones (no
  duplicating, no price list); add one-time expenses and edit the ones they
  added (each edit notifies the owner with what changed); see Fleet (no Setup)
  and all of Reports. Contractors, vendors, 1099s, inventory and recurring
  expenses are hidden. Owner-only alerts (expense edits, invoices to finalize)
  go to the owner's bell only.
- **Settings → Users** (owner): add people, change roles, reset someone's+
  two-step login, set a password, sign them out, disable accounts. There's
  always at least one active owner, and nobody can change their own role.

### Customers (`/customers`)
- **List** of all customers, sortable by code, name, type, status, email or
  date added.
- **Search** across customer code, name, company and email, plus contact
  names, contact emails, phone numbers (any formatting) and property addresses.
  The search and sort stay in the URL, so results can be bookmarked.
- **Customer page** showing their details, billing address, who referred them
  and who they referred, plus their contacts, properties with current service
  plans, the 10 most recent visits and the 10 most recent payments with a
  total paid.
- **Add and edit** customers. Edits show a summary of what changed and
  ask for confirmation before saving.
- **Billing address**: one of the customer's own properties. A new customer's
  first property (entered on the add-customer form, optional) becomes their
  billing address; change it from the edit form.
- **Add contacts** from the customer page. Phone numbers are stored as
  +1XXXXXXXXXX and shown as (410) 555-1234. Marking a new contact as primary
  replaces the current primary contact.
- Customer **status**: lead, active, paused or inactive. Marking a customer
  inactive requires an end date and at least one reason for leaving.

### Properties (`/properties`)
- **List** of every property with its customer, zone, current service plan
  and status. Search by address, ZIP, or customer name or code.
- **Add a property** to any customer, from the list or from a customer's
  page. If the customer has no billing address yet, it becomes it; tick
  "Use as the customer's billing address" to switch it anyway.
- **Edit a property**: address, zone, crew access and service notes, active
  status, billing address, or move it to a different customer.

### Appointments (`/appointments`)
- **Week view**, Monday to Sunday, with each day's appointments, the vehicle,
  price and status, and how many are booked. Switch between **day, week and
  month** views (the last one used is remembered in each browser), step
  between periods, jump to any date or month with **Go to**, or add an
  appointment on a given day. Dates in the week and month views open that day.
- **Book an appointment** for a customer at one of their properties, with a
  date, start and end time (Eastern), vehicle, price and notes. The property
  defaults to the billing address and the price to its service plan rate.
- **Statuses**: pending, completed or canceled. Canceling keeps the
  appointment on record and frees its vehicle; it can be reopened.
- **A vehicle can't be double-booked**: overlapping appointments for the same
  vehicle are refused (canceled ones don't count), naming the clash.
- **History**: every change records who made it, when, and what changed
  (e.g. "Price: $175.00 → $160.00"). Created/modified by and when are under
  System Information.
- An appointment stays with the customer it was booked for. If its property
  is transferred, pending appointments move to the new owner; completed and
  canceled ones stay.
- Customer pages list their appointments and have a "New appointment" button.

### Fleet (`/fleet`)
Vehicles come from [Bouncie](https://bouncie.com): every car with a tracker on
the connected account is a vehicle, named after its Bouncie nickname (or its
model). There's no Vehicles page to keep up to date; a new tracker appears with
the next update, and **Reconnect Bouncie** (Fleet → Setup) re-shares devices.
- **Live map**: where each vehicle is (driving or parked, at which property),
  today's stops in order, fuel, check-engine and battery warnings. Refreshes
  every minute while open.
- **Visits**: arrival and departure detected when a trip ends or starts within
  ~200 m of the property (`actual_source = gps`); time on site; once a vehicle
  has left a pending visit, **Mark completed** and **Create invoice** (prefilled
  with the customer, property, price and service date). Times entered by hand
  or imported are never overwritten. Nothing is completed or invoiced on its own.
- **Mileage** per vehicle and day, and miles driven to each customer.
- **Maintenance**: service records and intervals ("Due in 320 mi"), check-engine
  codes with their names, battery status, unplugged-tracker alerts, 30 days of
  driving habits.
- **Drive times**: each day's back-to-back visits against how long the drive
  really takes (learned from past trips between the two properties, or
  estimated from distance), flagging gaps that are too short.
- Property locations come from the US Census geocoder (free, no key): new and
  edited addresses are looked up after saving; **Locate properties** on the
  Fleet page does the rest.
- In development without a Bouncie connection, simulated vans built from the
  schedule fill the page (clearly labelled); never in production.

### Finances (`/finances`)
Stripe is the source of truth (numbering, payments, emails); the app keeps a
copy, updated instantly by Stripe's webhook (and by **Sync with Stripe**).
- Tabs for All, Draft, Open, Past due and Paid, with filters and sorting.
  Invoices are linked to app customers through the Stripe customer id
  ("Not linked" ones get a **Link** button) and to a property.
- **New invoice**: customer, property (printed as the service address), due
  date, memo and line items with optional **service dates** (printed on the
  Stripe invoice). Prices are parsed exactly (no floating point), capped at
  $100,000, and Stripe's total is checked against what was typed.
- Invoices start as drafts and are never emailed or charged automatically.
  **Finalize** numbers an invoice without sending or charging it.
- **Charge** (yellow): a card on file, or **paid another way** with what it was
  ("Cash", "Check #1042"). The amount shown is the only amount that can be
  collected: if the invoice changed since the dialog opened (another tab, the
  Stripe dashboard, a customer credit applied at finalizing), nothing is
  charged and the new amount is shown. Stripe never pays an invoice twice.
- **Who collected it** is saved on the invoice and in Stripe's metadata
  (`collected_by`, `collected_by_user_id`).
- Customers without an email in Stripe get "charge automatically" invoices
  (Stripe requires an email to send one); still nothing is charged on its own.
- Outside production only Stripe test/sandbox keys are accepted.

### Reports (`/reports`, owner by default: `reports.view`)
Business numbers for any period (this month, last month, last 3 or 12
months, year to date, all time or custom dates), compared with the same
number of days before. Every number links to what's behind it.
- **Overview**: collected, work completed, outstanding and past due, visits
  not invoiced yet, active customers, visits and cancellations, monthly
  recurring revenue, revenue per hour on site, and what needs attention.
- **Money**: revenue by month (collected, work completed, invoiced), how
  customers pay, outstanding by how late it is and who owes most, how long
  payment takes, top customers, and completed visits with nothing billed
  (with Create invoice).
- **Customers**: active customers by month, new vs lost, why customers left,
  leads and conversion, how long customers stay, revenue per customer,
  referrals, types, top customers.
- **Operations**: visits per week, busiest days, recurring revenue by plan,
  revenue by zone, hours booked per vehicle.
- **Pricing**: revenue per hour on site (and per labor hour once crew sizes
  are recorded) by month and by property, lowest first, with time over the
  booked slot; drive cost per customer from Bouncie trips.
- **Fleet**: miles and fuel per vehicle, on-time arrivals (GPS only),
  service status.
- "Collected" counts each payment once: recorded payments plus paid Stripe
  invoices that aren't already one of them (`lib/reports/queries.ts`, tested
  with exact numbers in `tests/integration/reports.test.ts`).

### Settings (`/settings`, via your name in the header)
- **Profile photo**: upload from a phone or computer (shrunk in the browser,
  stored as a 256×256 WebP), change or remove it.
- **Email** and **password** changes, each confirming your current password.
  Changing the password signs you out on your other devices.
- **Appearance**: light, dark, or match the device. Applied before the page
  paints, so there's no flash of the wrong theme.
- **Language**: English (US) or Português (Brasil) for every menu, label,
  message, date and amount. Customer data isn't translated. Saved to your
  account, so it follows you to other devices after you sign in.

### Not built yet
- Void, refunds and "uncollectible" from the app.
- See the roadmap in [ENGINEERING.md](ENGINEERING.md).

## Security

- Passwords are hashed with scrypt. Session cookies are `httpOnly`, `Secure`
  in production and `SameSite=Lax`, and only a hash of each session token is
  stored. Two-step login is required (see Sign-in); authenticator secrets are
  encrypted with `AUTH_SECRET` (AES-256-GCM), recovery codes are stored hashed.
- Every data read and save action checks the session against the database
  (`requireUser()` in `lib/auth/session.ts`). **Any new page or action that
  touches customer data must call it**, and sensitive actions must call
  `checkPermission()` / `requirePermission()` with a permission from
  `lib/auth/permissions.ts`. Server actions can be called directly, so hiding a
  button is never enough. `proxy.ts` only redirects visitors with no session
  cookie to `/login`.
- Webhooks (`/api/stripe/webhook`, `/api/bouncie/webhook`) have no session:
  Stripe's are verified with its signature (`STRIPE_WEBHOOK_SECRET`), Bouncie's
  with a shared key (`BOUNCIE_WEBHOOK_KEY`). The Stripe webhook re-reads each
  invoice from Stripe instead of trusting the event.
- The Bouncie sign-in uses OAuth with PKCE and a state check; its tokens are
  stored encrypted.
- Writes to audited tables (appointments) run in a `db.batch()` that starts
  with `asUser(user.id)` (`lib/db-helpers.ts`), so the database triggers record
  who made the change. Changes made outside the app are logged with no user.
- Security headers (CSP, HSTS, framing protection and others) are set in
  `next.config.ts`. A new third-party script or service must be added to the
  CSP there or the browser will block it (map tiles from OpenStreetMap are
  allowed for images).
- The app must be served over HTTPS in production.

## Translations

Each person picks English or Brazilian Portuguese in Settings. Two ways to
write text:

- `t.…` keys in `lib/i18n/messages/en-US.ts` and `pt-BR.ts` (the older
  screens). `pt-BR.ts` is typed against the English file, so adding a key to
  one without the other fails the build.
- `tr("English text", { vars })`, for everything newer: the English is the
  key, and `lib/i18n/phrases/pt-BR.ts` has its translation (English is shown
  when one is missing). `{placeholders}` are filled from vars;
  `plural(tr, n, "{n} visit", "{n} visits")` picks one or many; a word with
  two meanings gets a context, `tr("invoice|Open")`. Text made outside a page
  (an action's error, a label list) is marked `phrase("…")` and shown through
  `tr()`. `tests/unit/i18n.test.ts` fails if any of these has no pt-BR entry.

Server Components and Actions use `const { t, tr, fmt } = await getI18n()`;
Client Components use `useI18n()`. `fmt` formats dates, times and money for
the user's language (always in Eastern time). Notifications are stored in
English with their values and translated for each reader. What customers get
(estimates, the texts and emails sent to them, invoices) stays in English, as
do owner-only pages and exports.

Pages read the user's language from the request, so each page wraps its
content in `<Suspense fallback={<PageLoading />}>`; without it, client-side
navigation would block (the layout's boundaries are already on screen).

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router, Cache Components) with React 19
- [Neon](https://neon.tech) Postgres via [Drizzle ORM](https://orm.drizzle.team)
- [shadcn/ui](https://ui.shadcn.com) components on Base UI, styled with Tailwind CSS 4

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env.local`:
   ```
   DATABASE_URL=postgres://...          # pooled, used by the app
   DATABASE_URL_UNPOOLED=postgres://... # direct, used by migrations
   AUTH_SECRET=...                      # 32+ random characters; encrypts two-step login secrets
   STRIPE_SECRET_KEY=sk_test_...        # a TEST key outside production
   STRIPE_WEBHOOK_SECRET=whsec_...      # from `stripe listen` or the Stripe dashboard
   BOUNCIE_CLIENT_ID=...                # from bouncie.dev (optional)
   BOUNCIE_CLIENT_SECRET=...
   BOUNCIE_REDIRECT_URI=http://localhost:3000/api/bouncie/callback
   ```
   Make an `AUTH_SECRET` with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
3. Apply the database migrations and create your account (the first account is
   the owner):
   ```bash
   npm run db:migrate
   npm run users -- add you@example.com Your Name
   ```
4. Start the dev server and open [http://localhost:3000](http://localhost:3000);
   the first sign-in sets up two-step login:
   ```bash
   npm run dev
   ```

To receive Stripe events locally, install the [Stripe CLI](https://stripe.com/docs/stripe-cli)
and run `stripe listen --forward-to localhost:3000/api/stripe/webhook`; put the
`whsec_…` it prints in `STRIPE_WEBHOOK_SECRET`.

## Managing users

Day to day, use **Settings → Users** in the app (owner only). The command line
does the same and is the way back in if the owner loses their phone and their
recovery codes:

```bash
npm run users -- list                    # accounts, roles and two-step login status
npm run users -- add <email> <name>      # create an account (prompts for a password)
npm run users -- role <email> <owner|admin|staff>
npm run users -- reset-2fa <email>       # set up two-step login again at next sign-in
npm run users -- passwd <email>          # set a new password and sign them out
npm run users -- disable <email>         # block sign-in and sign them out
npm run users -- enable <email>          # allow sign-in again
npm run users -- signout <email>         # end all their sessions
```

Passwords must be at least 12 characters.

These use the database in `.env.local`. To manage production accounts, put the
production connection string in front of the command (it takes precedence over
`.env.local`):

```bash
DATABASE_URL='postgres://...' npm run users -- reset-2fa you@example.com
```

## Testing

| Command | What it checks | Runs against |
| --- | --- | --- |
| `npm test` | Price parsing, two-step codes (RFC 6238 vectors), permissions, GPS math | Nothing (no database or network) |
| `npm run test:integration` | Fleet visit detection | The dev database |
| `npm run test:e2e` | In the browser: exact amounts, no double charges, refused tampered requests, two-step login, roles, the Users page, the Stripe webhook, search, phone layouts | The dev server, dev database and Stripe sandbox |
| `npm run test:all` | All of the above | |

- Every production deploy (`vercel-build`) checks the required settings
  (`scripts/check-env.ts`, e.g. `AUTH_SECRET`), runs the unit tests and builds
  before migrating; a failure at any step stops the deploy with the current
  version still live and the database untouched.
- Run `npm run test:all` before pushing to `main`. The browser tests use the
  installed Google Chrome, start `npm run dev` if it isn't running, create
  their own `STRIPETEST…` customers and `…@example.invalid` accounts, and
  delete them afterwards. They refuse to run with a live Stripe key.

## Going to production

Before the first deploy with these features, in Vercel → Settings →
Environment Variables (Production):
1. `AUTH_SECRET`: a new random value (not the dev one). Changing it later
   means everyone sets up two-step login again.
2. `STRIPE_SECRET_KEY`: the live key, if not already set.
3. `STRIPE_WEBHOOK_SECRET`: in Stripe (live mode) → Developers → Webhooks, add
   `https://<your-domain>/api/stripe/webhook` with the `invoice.*` and
   `customer.deleted` events, and copy its signing secret.
4. Bouncie (optional): `BOUNCIE_CLIENT_ID`, `BOUNCIE_CLIENT_SECRET`,
   `BOUNCIE_REDIRECT_URI=https://<your-domain>/api/bouncie/callback` (also added
   to the app on bouncie.dev), and `BOUNCIE_WEBHOOK_KEY` with a webhook on
   bouncie.dev pointing at `https://<your-domain>/api/bouncie/webhook`.

The deploy's migrations end every session, so everyone signs in again and sets
up two-step login; the earliest account becomes the owner. In the live Stripe
dashboard, check Settings → Billing for anything that emails or retries
invoices automatically, then do a $1 test: create, finalize, charge from the
app, and refund it in Stripe.

## Database changes

The schema is defined in `db/schema.ts` and migrations live in `drizzle/`.

1. Edit `db/schema.ts`.
2. Generate a migration: `npx drizzle-kit generate --name <description>`.
   Review the SQL, and hand-edit it when drizzle-kit can't express the change
   (see `drizzle/0001_inactive_status.sql`).
3. Apply it to the dev database: `npm run db:migrate`.
4. Commit the migration with the code that needs it and push to `main`.

**Production is migrated automatically.** Every Vercel production deploy runs
`npm run vercel-build`, which builds the app and then applies any new
migrations to the production database (using its `DATABASE_URL`); the build
doesn't touch the database, so a failed build leaves it as it was. Migrations
run in one transaction, so if one fails, nothing is applied and the deploy
stops with the old version still live. Preview deploys don't run migrations.

A few rules follow from that:
- Never edit a migration that has already been pushed; add a new one instead.
- Don't change the database by hand (Neon console, SQL editor). Make every
  change through a migration, or the two databases will drift apart.
- Migrations run before the new code goes live, so keep them compatible with
  the version currently running: add columns and tables first, and remove old
  ones in a later deploy.
- Use `npm run db:migrate`, not `drizzle-kit migrate`. The script also
  recognizes migrations 0000–0002, which were applied by hand before tracking
  began.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | Lint with ESLint |
| `npm test` / `npm run test:all` | Unit tests / every test (see [Testing](#testing)) |
| `npm run db:migrate` | Apply new migrations to the database in `.env.local` |
| `npm run vercel-build` | Check production settings, unit tests, build, then migrate (what Vercel runs in production) |
| `npm run users -- <command>` | Manage staff accounts |
