# Gigsaw architecture review

Date: 2 November 2026. Scope: the whole app at commit `4e59fa5` (≈35,600 lines in 275 files, 36 database models, 29 migrations, 238 unit tests).

How this was done: four independent read-only reviews (data and multi-tenancy; security and server actions; business rules; structure, front end, tests and operations), then every finding marked **✓** below was checked by hand against the code. Findings without a tick were reported with file and line references but not re-traced; treat them as very likely, not proven.

## 1. The short version

The app is in better shape than its pace of change would suggest. There is no live cross-agency data leak, every server action checks who is calling, Stripe signatures are verified properly, emails and CSV exports are escaped, and the act privacy rule (acts never see the sale price or booking fee) holds everywhere except one bug.

The problems fall into three groups:

1. **A handful of real bugs that need fixing now** (section 3, P0 and P1): one breaks act privacy, several let a double tap do something twice, and a few break when bookings are archived.
2. **The same rules written in many places** (section 4): what is owed, what a booking's status may change to, what counts as billable, which bookings are hidden. These are copied across pages, actions and lib files, and the copies have already started to disagree. This is the main maintainability risk.
3. **No safety net** (section 5): no CI, no error pages, no logging or error reporting, no database tests, config read from the environment in 15 places without checks.

The plan in section 6 fixes the bugs first (small, independent PRs that can all run at once), then adds the safety net, then reshapes the code into domain modules so each rule lives in one place.

## 2. What is already sound (keep doing this)

- Every exported server action calls `requireStaff` / `requireAdmin` / `requireOwner` / `requireUser`, or is a deliberate public token endpoint.
- Records are always fetched with `findFirst({ id, agencyId })` before update or delete, and ids from the browser (act, venue, payer, agent, customer) are checked against the agency.
- OAuth uses PKCE, state and nonce, RS256 only, issuer and tenant checks.
- Password reset tokens are hashed, single-use, one hour, and clear all sessions on use.
- Stripe webhook signatures use a constant-time compare with a 5-minute window; card payments are unique per Checkout Session.
- No `dangerouslySetInnerHTML`; email HTML is escaped; CSV exports defuse formulas; `appUrl` comes from config, not the Host header; no open redirects.
- Pure logic in `src/lib` is well tested and fast (238 tests in about 4 seconds, no database needed). No import cycles; `lib` never imports from `app` or `actions`; client components don't pull server-only code.

## 3. Findings, by priority

P0 = fix this week (privacy, security or money is wrong today). P1 = fix soon (real bugs users will hit). P2 = structural problems that keep causing bugs. P3 = hygiene.

### P0

| ID | Finding | Where | ✓ |
|---|---|---|---|
| **P0-1** | **Old offer links work for the new act.** `sendOffers` keeps an existing token (`g.offerToken ??= …`) and nothing clears it when the act changes. The `/o/[token]` page and "Accept all" look up the booking's *current* act. If Act A declines and the gig moves to Act B, A's old link shows B's open offers and fees and can accept them for B. Breaks the act privacy rule. | `src/lib/offers.ts:43`, `src/app/o/[token]/page.tsx:17-30`, `src/actions/offers.ts:28-39` | ✓ |
| **P0-2** | **Push endpoint lets any signed-in user make the server call any HTTPS address and read the reply.** `savePushSubscription` accepts any `https://` endpoint; the test push posts to it and stores up to 300 characters of the response in the message log. Anyone on a free trial can probe internal services. | `src/actions/push.ts:15`, `src/lib/push.ts:68` | ✓ |

### P1

| ID | Finding | Where | ✓ |
|---|---|---|---|
| P1-1 | **Double tap does it twice.** Read-then-write without a condition: accepting an offer runs the confirm side effects twice (duplicate emails to act and customer); `markPaid` can log the balance twice; booking from a "Yes" reply can create two bookings; approving a new act twice duplicates it. | `src/lib/offers.ts:119-124`, `src/actions/payments.ts:23-60`, `src/actions/availability.ts:245-292`, `src/actions/join.ts:120-172` | ✓ (offers) |
| P1-2 | **Secret links are kept in plain text in the message log.** Reset, welcome (7 days), offer, contract and pay links are saved in `Message.body` and shown in the owner Outbox. Anyone with an owner session or a database backup can take over accounts. | `src/lib/messaging.ts:81-92`, `src/app/owner/messages/page.tsx` | ✓ |
| P1-3 | **Billing lock only checked in the agency layout.** A business whose trial has ended can still call every server action, `/api/export/*`, `/print/*`, and the act app and feeds. | `src/app/(agency)/layout.tsx:36-38`, `src/lib/auth.ts` | ✓ |
| P1-4 | **Subscription webhooks applied in any order.** A late `deleted` event for an old subscription can overwrite a business's live one and lock a paying customer. Two Checkout tabs can create two live subscriptions. | `src/app/api/stripe/webhook/route.ts:28`, `src/lib/subscription-sync.ts:35-58`, `src/actions/billing.ts:55` | |
| P1-5 | **"Remove demo data" fails once a demo booking is archived** (archived rows are hidden from the delete list, then the act delete hits a foreign key and the whole thing rolls back). | `src/lib/demo.ts:757` | ✓ |
| P1-6 | **Deleting an act removes its login, then fails** if it has archived bookings (the count hides them; no transaction). | `src/actions/crm.ts:73-76` | ✓ |
| P1-7 | **No error pages.** No `error.tsx`, `global-error.tsx` or `not-found.tsx` anywhere, so any server error shows Next's raw "Application error" page (users have already seen this). | `src/app/**` | ✓ |
| P1-8 | **No login rate limit.** Unlimited password guesses. | `src/actions/auth.ts:8-20` | ✓ |
| P1-9 | **A card payment can be dropped after Stripe has taken the money** if the agency disconnected Stripe or the link was deleted: the webhook answers 200 "ignored" and Stripe won't retry. | `src/lib/card-payments.ts:191` | |

### P2: structural (where the bugs come from)

| ID | Finding | Where |
|---|---|---|
| P2-1 | **"Hide archived bookings" is implicit.** The Prisma extension in `src/lib/db.ts` adds `archivedAt: null` to most booking reads, but not to `include` / `_count`, and call sites switch it off with `null`, `undefined` or `{ not: null }`. Every P1 archive bug (and the reference-number crash fixed on 31 Oct) came from this. Other affected places: `companyToVenue` count (`crm.ts:284`), venue time-zone change skips archived gigs (`crm.ts:229`), card payment fallback (`card-payments.ts:209`). ✓ (class confirmed) |
| P2-2 | **No single rulebook for booking status.** Any status can change to any other (Settled for a future gig, Cancelled back to Confirmed); the clash check runs in `updateBooking` but not `setBookingStatus`; the "now confirmed" side effects run from three places and not at all when a booking is *created* as Confirmed (create, copy, add to event, rota); money can be logged against cancelled bookings. `src/actions/bookings.ts:50-121`, `events.ts:197`, `slots.ts:305,381,469` |
| P2-3 | **"What's owed" is worked out in at least six places and they disagree.** `lib/payments.ts`, `lib/pay-links.ts`, `lib/events.ts`, dashboard, reports and `recordEventPayment` (which skips deposit-first and includes archived gigs). Pay links accept money on Hold/Pending gigs the other pages don't count. |
| P2-4 | **Money edge cases.** Changing a booking's currency reinterprets existing payments (payments have no currency); events add up gigs in different currencies; `recordCardPayment` doesn't check the currency; every money-out payment counts as "paid to the act", including expenses; refunds and disputes aren't handled. |
| P2-5 | **Archived bookings are counted differently in different places.** Billing counts them (including past holds), but Reports, Payments history and the "tidy up" counter don't. An agency that archives old holds is billed for them and can't see them. Archived bookings can also be hard-deleted before statements are issued. |
| P2-6 | **Messages are sent inline with no retry.** Reminders and event emails are claimed then sent; a provider failure is recorded as FAILED and never retried. Offers and confirmations send one by one inside the request. |
| P2-7 | **Time maths.** On-the-day reminders never fire for call times before about 10:00 (they clamp to 07:00 on a day that's already passed); event payments are dated `T12:00Z` instead of the venue's local noon; `monthIsOver` and the dashboard year use UTC while bookings use the venue's time zone; rescheduling doesn't reset arrival alerts. `src/lib/reminder-time.ts:27`, `reminders.ts:174`, `events.ts:217`, `billing.ts:82` |
| P2-8 | **Extra-user price defined twice.** Invoiced businesses pay yearly ÷ 12 (£16.67); card businesses pay the monthly price (£20). Re-issuing a past month's statement uses today's user count. `src/lib/seats.ts:6`, `src/actions/owner.ts:141`. (Note: a reviewer said extra users are never synced to Stripe; that's wrong, adding and removing users in Settings does sync. Only admins added from the Owner area are missed.) ✓ (correction checked) |
| P2-9 | **Data access is scattered.** About 670 Prisma calls in 129 files, 58 of 90 pages query the database directly, tenant scoping is hand-written each time through nine near-identical `ownX` helpers. Correct today only because every author remembered. |
| P2-10 | **No CI, no lint.** Nothing runs typecheck, tests or build on push; Railway builds `main` directly. `npm run lint` is just `tsc`. ✓ |
| P2-11 | **No database tests.** No server action, tenant isolation or claim/idempotency path is tested. |
| P2-12 | **Config read from `process.env` in about 15 places with no validation.** Missing `APP_URL` silently puts `localhost` links in emails. `.env.example` lists only `DATABASE_URL`. |
| P2-13 | **No observability.** 12 unstructured `console.*` calls, no error reporting, no request ids, several Stripe failures swallowed (`owner-plans.ts:96`, `owner-discounts.ts:61`, `owner.ts:202`). |
| P2-14 | **Migrations run on every start, with future-dated names.** `start` runs `prisma migrate deploy`; there's no health check or pre-deploy step. Folders are named up to `20261123…`, so a migration created normally today (`20261102…`) would sort before nine existing ones. Don't rename the existing ones (production records them); name new ones after `20261123000000`. ✓ |
| P2-15 | **Missing indexes** on hot paths: `Payment.bookingId` (used by almost every list) ✓, `Booking.venueId`, `Booking.promoterId`, `Session.userId`, `ContactNote.contactId`, and the cross-agency overdue scan. |
| P2-16 | **Importers aren't transactional** and `importRef` isn't unique, so a double submit or a mid-way failure leaves duplicates or half an import. |
| P2-17 | **Password change doesn't sign out other sessions.** ✓ |
| P2-18 | **Enquiry form rate limit can be dodged** by setting `X-Forwarded-For`, turning the auto-reply into a spam relay. `src/lib/enquiry-server.ts:24-26` |

### P3: hygiene

- Scheduler runs on every server instance; caches (plans 60s, Stripe keys 30s) only clear on the instance that saved. Fine on one instance; needs a lock and a version stamp before scaling out.
- Account pre-hijack: sign-up doesn't verify email, and "Sign in with Google" links to a matching account automatically.
- Secrets in `AppSecret` (Stripe keys, OAuth cookie key) and session tokens are stored unencrypted / unhashed.
- Cron secret compared with `!==`; one failing cron job stops the rest.
- Act and person calendar tokens default to `cuid()` rather than strong random values.
- Acts can open itineraries for Enquiry/Hold gigs by id (no money shown); acts see other acts' Pending gigs on an event page.
- Minimal security headers (no HSTS, CSP, `nosniff`, `Referrer-Policy` on token pages).
- Big files mixing data, rules and markup: `bookings/[id]/page.tsx` (629 lines), calendar (507), `events/[id]` (457), `artists/[id]` (423), dashboard (401), `lib/demo.ts` (790). Booking and event invoice print pages are near duplicates. The agency layout loads every act, venue and contact on every page for the quick-booking form.
- 117 leftover `slate-*` classes (aliased to `ink-*`, so it looks fine); unused `geist` dependency and a few unused exports.
- Contrast: `text-ink-400` (about 3.1:1) and `text-ink-300` (about 1.9:1) used for real text in about 160 places; no skip link.
- Product decisions needed: VAT on commission deals, door-split deals, a booking fee lost when the fee-carrying gig of an event is cancelled.

## 4. Target structure

Each business area gets three kinds of file: `rules.ts` (pure, fully tested), `service.ts` (server-only: database writes, transactions, side effects) and `queries.ts` (read models for pages). Server actions become thin: check who's calling, parse the form, call the service, refresh the page. Pages call `queries` and only render.

```
src/
  domain/
    bookings/   status.ts (allowed changes + side effects), reference.ts, schedule.ts, clash/,
                copy.ts, bulk.ts, visibility.ts (what acts and customers may see), repo.ts (live / all)
    money/      deal.ts (sale, cost, VAT, booking fee), ledger.ts (owed, allocate, refunds,
                event totals), payer.ts, currency.ts
    card-payments/  connect, pay links, webhook recording, refunds
    offers/     tokens bound to the act, conditional answer
    events/     weddings and events, planner, using money/ledger
    acts/       people, members, availability, away days
    billing/    billable.ts, plans, seats.ts (one price source), subscription sync, statements, discounts
    messaging/  outbox (written in the same transaction, sent by the scheduler with retry),
                channels, templates, notify/ (triggered by status changes)
    scheduler/  one job registry with per-job claim, used by instrumentation and /api/cron
  server/
    db.ts       db.forAgency(agencyId): adds agencyId to every tenant model automatically
    auth.ts     roles + billing lock in one place; a role-to-action table
    tokens.ts   one helper to create, hash, expire and bind public links
    env.ts      validated config
  shared/       time.ts, periods.ts, forms.ts
```

This is reached step by step (section 6, wave 3). Nothing moves in a big-bang PR.

## 5. Ground rules while doing the work

- Every PR keeps `npx tsc --noEmit`, `npx vitest run` and `npm run build` green, and adds a test for the bug it fixes.
- New migrations are named after `20261123000000` (see P2-14).
- Don't change behaviour and structure in the same PR. Fix the bug first, move code later.
- Files to watch for conflicts: `src/actions/bookings.ts`, `src/lib/offers.ts`, `src/lib/db.ts`, `prisma/schema.prisma` and `src/app/(agency)/bookings/[id]/page.tsx` are touched by several PRs; those PRs are sequenced below.

## 6. The work, as PRs

Size: XS < 1 hour, S half a day, M one to two days, L several days.

### Wave 1: fix the bugs (all can run in parallel)

| PR | What | Fixes | Size | Main files | Can run with |
|---|---|---|---|---|---|
| **1A** | Offer tokens: new token whenever the act changes or the gig is re-offered; store `offeredArtistId` and require it to match on the page, "Accept all" and answer; expire once answered or past; conditional accept (`updateMany … status: AWAITING`, continue only if one row changed). | P0-1, P1-1 (offers) | S | `lib/offers.ts`, `actions/offers.ts`, `app/o/[token]`, `actions/bookings.ts` (act change), migration | everything except 1D |
| **1B** | Push: allow only known push-service hosts; never store response bodies. | P0-2 | XS | `actions/push.ts`, `lib/push.ts` | all |
| **1C** | Redact links in the message log (replace token paths with `…`). | P1-2 | XS | `lib/messaging.ts` | all |
| **1D** | Conditional claims for `markPaid`, book-from-reply and approve-act (re-check inside the transaction). | P1-1 (rest) | S | `actions/payments.ts`, `actions/availability.ts`, `actions/join.ts` | all except 1A (both touch reply/offer flows; merge 1A first) |
| **1E** | Archive fixes: demo removal, act delete (count archived, transaction), `companyToVenue`, venue time-zone change, card payment fallback. | P1-5, P1-6, part of P2-1 | S | `lib/demo.ts`, `actions/crm.ts`, `lib/card-payments.ts` | all |
| **1F** | Error pages: root `error.tsx`, `global-error.tsx`, `not-found.tsx`, plus `error.tsx` for agency, act app, owner and public token routes, with the digest shown and a retry button. | P1-7 | S | new files only | all |
| **1G** | Login rate limit (database counter per IP and per email, with backoff); sign out other sessions on password change. | P1-8, P2-17 | S | `actions/auth.ts`, `actions/settings.ts`, migration | all |
| **1H** | Subscription webhook: re-fetch the subscription from Stripe on each event, ignore events for a subscription that isn't the current one, store processed event ids; make checkout idempotent per agency. Card webhook: store unmatched sessions and alert instead of dropping. | P1-4, P1-9 | M | `api/stripe/*`, `lib/subscription-sync.ts`, `lib/card-payments.ts`, `actions/billing.ts`, migration | all except 1E (both touch `card-payments.ts`: small, merge either order) |
| **1I** | Billing lock enforced in `requireUser` / `requireStaff` with an allow-list (plan, profile, sign out), and in exports, print pages and feeds. | P1-3 | S | `lib/auth.ts` | all |

Migrations: 1A, 1G and 1H each add one. Give them consecutive names (`20261124…`, `20261125…`, `20261126…`) up front so they never clash.

### Wave 2: the safety net (parallel with each other; can start alongside wave 1)

| PR | What | Fixes | Size | Depends on | Can run with |
|---|---|---|---|---|---|
| **2A** | CI on GitHub: install, `prisma validate`, typecheck, tests, build; check new migration names sort after the newest. Add ESLint later (2F). | P2-10, P2-14 | S | none | all |
| **2B** | `src/server/env.ts`: one validated config, fail at boot in production if `DATABASE_URL` or a usable `APP_URL` is missing, warn about half-set providers; full `.env.example`. | P2-12 | M | none | 2A, 2D, 2E; do before 2C |
| **2C** | Observability: `onRequestError` + error reporting (Sentry or a JSON logger), log the swallowed Stripe failures, scheduler heartbeat. | P2-13 | S | 2B | 2A, 2D |
| **2D** | Ops: `/api/health` (database ping + scheduler heartbeat), `railway.json` with health check and a pre-deploy `prisma migrate deploy` (remove it from `start`), cron with constant-time secret and per-job error handling, backup runbook in the README. | P2-14, P3 cron | S | none | all |
| **2E** | Indexes migration (P2-15). | P2-15 | XS | after wave-1 migrations are named | all |
| **2F** | Database test harness: Postgres in CI, fixtures for two agencies; first tests for tenant isolation, offer accept, `markPaid`, reminders/alerts claims. | P2-11 | M | 2A | all |

### Wave 3: one rule, one place (sequenced; each builds on the last)

| PR | What | Fixes | Size | Depends on |
|---|---|---|---|---|
| **3A** | Bookings repository: explicit `bookings.live()` / `bookings.all()` replacing the implicit extension, used everywhere; then delete the extension. | P2-1 | M | 1E, 2F |
| **3B** | `db.forAgency(agencyId)`: automatic agency scoping for tenant models; replace the `ownX` helpers. | P2-9 | M | 3A |
| **3C** | `domain/bookings/status.ts`: allowed status changes, act requirement, clash check, and the "confirmed" / "settled" side effects in one place; every action calls it. | P2-2 | M | 1A, 1D, 3A |
| **3D** | `domain/money/ledger.ts`: one owed / allocate / event-totals implementation used by dashboard, reports, payments, pay links and event payments; payment currency column; block currency change once paid; refunds. | P2-3, P2-4 | L | 3A; can run alongside 3C (different files) |
| **3E** | Decide and apply one archive rule for billing and money pages (e.g. archiving an unresolved gig cancels it; archived confirmed gigs stay in reports and payment history); block hard delete in unbilled months. | P2-5 | S | 3D, needs a product decision |
| **3F** | `domain/billing/seats.ts` as the single extra-user price source; snapshot seat counts per month for statements; sync Stripe when the owner adds an admin. | P2-8 | S | none (can run any time) |
| **3G** | Messaging outbox: messages written in the same transaction as the change, sent by the scheduler with retry and backoff; offers and confirmations stop sending inline. | P2-6 | L | 3C |
| **3H** | Time fixes: early-morning day reminders, event payment dates in local time, `monthIsOver` and dashboard year in the right zone, reset arrival alerts on reschedule. | P2-7 | S | none (can run any time) |
| **3I** | Importers: `@@unique([agencyId, importRef])`, upserts in chunked transactions. | P2-16 | M | none |

### Wave 4: hygiene (all parallel, any time after wave 2)

| PR | What | Size |
|---|---|---|
| 4A | Split `bookings/[id]/page.tsx` and `events/[id]` into data + section components; one shared invoice component for booking and event prints. | M |
| 4B | Quick booking loads acts, venues and contacts on demand instead of in the layout. | S |
| 4C | ESLint (`next/core-web-vitals`, `jsx-a11y`) + Prettier check in CI (after 4A to avoid churn). | S |
| 4D | `slate-*` → `ink-*`, remove the alias; contrast fixes (`ink-400` text on light → `ink-500`); skip link. | S |
| 4E | Remove `geist` and unused exports. | XS |
| 4F | Security headers; strong random calendar tokens with rotation; tighten act itinerary and event visibility; enquiry rate limit on the trusted proxy hop plus a per-recipient limit (P2-18). | S |
| 4G | Encrypt `AppSecret` with a key from the environment; hash session tokens; email verification at sign-up before OAuth auto-link. | M |
| 4H | Scheduler leader lock (`pg_try_advisory_lock`) and cache version stamps, before running more than one instance. | S |
| 4I | Playwright smoke tests in CI: sign in, create a booking, act check-in, offer accept. | M |

## 7. Parallel lanes at a glance

```
Lane A (offers & bookings):   1A ─► 1D ─────────────► 3C ─► 3G
Lane B (archive & data):      1E ─────────► 3A ─► 3B
                                              └─► 3D ─► 3E
Lane C (security):            1B, 1C, 1G, 1I  (independent, any order)
Lane D (Stripe):              1H ─► 3F
Lane E (safety net):          2A ─► 2F (needed by 3A)
                              2B ─► 2C
                              2D, 2E
Lane F (any time):            3H, 3I, wave 4
```

Wave 1 and wave 2 together are about 15 small PRs with almost no overlap: with five parallel workers they fit in two to three days. Wave 3 is the long part (about two weeks of focused work) and is mostly sequential along lanes A and B.

## 8. Decisions needed from the business

1. **Archived bookings and billing (3E):** should archiving an old hold or pending gig cancel it (so it's never billed), or should billing skip archived unconfirmed gigs?
2. **VAT on commission deals and door splits:** confirm how these should be calculated before 3D touches deal maths.
3. **Error reporting service (2C):** Sentry (free tier is enough to start) or plain logs in Railway?
4. **Scaling:** will Gigsaw run on more than one Railway instance in the next few months? If not, 4H can wait.
