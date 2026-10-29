# Gigsaw

Booking management for music agencies and their artists, modelled on [Overture](https://bookingwithoverture.com/features), with one big addition: **musicians mark when they've arrived at a gig, and the agency can see it live and track punctuality over time.**

## Built for regular venue work

Most agency work is weekly slots at the same venues, so Gigsaw is built around them:

- **Weekly music schedules** on each venue (e.g. Mon–Thu 19:00–21:00 Solo, Fri 16:00–19:00 and 19:00–22:00), with fee, who pays, act type and an optional regular artist. Add the same slot to several days at once.
- **Rota**: a week grid of every venue's slots, showing who's booked and what's empty (amber). Fill a slot by picking an artist; **Book regulars** books every slot's regular artist for 1–12 weeks, skipping anything already booked.
- **Change a slot, change its gigs**: new times or fee on a slot can be applied to every upcoming gig in it, and each artist is told.
- **Change several gigs at once**: tick gigs on Bookings, then set new times, move them by some minutes, or set a new fee.
- **Artists are told about changes**: an email and text showing old → new for date, times, venue and their fee, and when a gig is confirmed or cancelled; one message listing new gigs when they're booked.
- **Who's on where**: the search bar on every page (press `/`) finds tonight's and this week's gigs by town, venue or artist, with a tap-to-call number.
- **Calendar**: Day, Week (default) and Month views, coloured by venue (or artist), filter by town.
- **Phone calendars**: artists tap once in their app to add their gigs to Apple, Google or Outlook calendar; it updates by itself.
- **Venue line-up links**: each venue can have a private link (`/v/…`) showing who's playing and when, slots still to be confirmed, and arrivals on the night, plus a calendar feed. It never shows fees, deals, contacts or other venues. Make, replace or turn off the link on the venue's page.
- **Branded emails** in the agency's name; replies go to the agent or agency, not a no-reply address.
- **"Hold on" before double-booking**: saving a booking, filling a rota slot or changing times checks the artist's other gigs. If times overlap, or there isn't enough time to pack down and travel between venues (estimated from the venues' map pins plus a changeover time set in Settings), a clear warning explains why, with **Save anyway** or **Go back**. Gigs with plenty of time between them aren't flagged. "Book regulars" never double-books: it leaves the slot empty and says why.
- **Gigs without an artist are hard to miss**: a count on Rota in the menu (next 7 days), a dashboard banner (next 14 days), and a "Needs an artist" list on the Rota, soonest first, where each can be filled in one step.

## Owner area and agencies

Gigsaw runs many agencies on one site. Each agency only ever sees its own artists, bookings, contacts, venues, reports and settings.

- **Owner area** (`/owner`, owner account only): create an agency and its first admin login, set its price per gig, add admins, reset passwords, suspend or reactivate an agency (suspended agencies can't sign in; their data is kept).
- **Billing:** each agency pays its own price per gig, counted in the month the gig happens (venue's local date). A gig is billable if it's confirmed or settled, if the artist checked in, or if it was left on hold or pending after its date. Cancelled gigs, enquiries and demo data are free. Past gigs never confirmed or cancelled are flagged to the agency (dashboard) and to the owner (agencies list). Once a month is over, **Billing → Issue statements** freezes each agency's count, price and booking references; mark statements paid as money comes in. Re-issuing updates unpaid statements and never touches paid ones. CSV export per month.
- Agency admins see their price and this month's billable gigs under **Settings → Your Gigsaw plan**.


## What's in it

| Area | What it does |
| --- | --- |
| **Arrivals (new)** | Live board of every gig with a call time in the last 12 or next 24 hours: overdue, on the way (with ETA), arrived on time, arrived late. Punctuality table per artist for the last 12 months. Latest check-ins feed. CSV export. Refreshes every 30 seconds. |
| **Artist app** | Phone-friendly pages at `/app` (can be added to the home screen). Artists see their gigs, schedule, venue directions and itinerary, and tap **I'm on the way**, **I've arrived** and **I've left the venue**. |
| Dashboard | Today's arrivals, shows in the next 30 days, open holds, money owed, overdue deposits, recent activity. |
| Bookings | Booking type (gig, festival, club night, wedding, corporate, private party, other). Enquiry → hold → pending → confirmed → settled (or cancelled). Deal types: standard commission, buy/sell, guarantee vs %, guarantee plus bonus, flat fee. Fee, VAT, deposit, radius clause, itinerary, tags, notes. |
| Checklist | On every booking: double bookings, radius clause breaches, missing venue/promoter/fee, overdue deposits, missing itinerary details. |
| Calendar | Month view filtered by artist and status. Each artist has a private calendar feed (ICS) for Google, Apple or Outlook calendar. |
| Contacts | Promoters, clients, venue staff and collaborators with tags, search (including the notes archive) and conversation notes. |
| Venues | Address, capacity, time zone and the map pin used to verify arrivals. |
| Money | Payments in from promoters and out to artists. Commission and artist earnings worked out per deal type. |
| Documents | Printable contract, invoice and day sheet (print or save as PDF). |
| Reports | Gross, commission, artist earnings, received and owed, by artist and by agent, kept separate per currency. CSV exports. |
| Team | Admin and agent roles, artist logins, activity log on every booking. |

## How arrival tracking works

1. Each booking has an **arrive by** time (the call or load-in time), entered in the venue's local time.
2. From 12 hours before the call time, the artist can check in from their phone. Check-in closes 6 hours after the gig ends.
3. When they tap **I've arrived**, the phone shares its location. Gigsaw measures the distance to the venue's map pin:
   - within the venue radius (default 500 m): **Verified at venue**
   - further away: **Away from venue**
   - no location shared, or the venue has no pin: recorded but marked as unverified
4. The arrival counts as **on time** if it's no more than the grace period (default 5 minutes) after the call time, otherwise **late**.
5. If the call time passes with no arrival, the gig shows as **Overdue** on the live board. If the gig ends with no arrival, it's recorded as **No check-in**.
6. If an artist can't use the app, an agent can log the arrival for them on the booking page. It's marked as logged by the agency.

The grace period and venue radius are set in **Settings**. The rules live in `src/lib/arrival.ts` and are covered by unit tests.

## Emails, texts and alerts

- **Late alerts:** once a minute, Gigsaw checks for gigs whose call time (plus the grace period) has passed with no check-in, and emails and texts the booking's agent plus an optional on-call email and mobile (Settings → Arrival tracking and alerts). Each gig is alerted once.
- **Client arrival messages:** when an artist checks in, the booking's promoter or client gets a short email and text. Switch off per agency or per booking.
- **Password reset:** "Forgot password?" on the sign-in page emails a one-hour, single-use link.
- Demo data never sends anything.

Messages go out once these are set in Railway → Variables. Until then, every message is saved to the **Outbox** (Owner area) and the agency's **Settings → Messages**, so nothing is lost and you can check the wording.

| Variable | What it's for |
| --- | --- |
| `RESEND_API_KEY`, `MAIL_FROM` | Email via [Resend](https://resend.com). `MAIL_FROM` like `Gigsaw <alerts@yourdomain.com>` (the domain must be verified in Resend). |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Texts via [Twilio](https://www.twilio.com). `TWILIO_FROM` is your Twilio number, e.g. `+447700900000`. |
| `APP_URL` | Optional. The site address used in links. Railway's own domain is used if this isn't set. |
| `DISABLE_SCHEDULER`, `CRON_SECRET` | Optional. Turn off the built-in checker and call `POST /api/cron/overdue` with `Authorization: Bearer <CRON_SECRET>` from your own scheduler instead. |

Settings → Messages → **Send me a test** checks both are working.

## Deploying on Railway

1. In your Railway project, add the GitHub repo as a service and deploy from the `main` branch.
2. Add a database: **+ New → Database → PostgreSQL**.
3. In the Gigsaw service, open **Variables** and add `DATABASE_URL` with the value `${{Postgres.DATABASE_URL}}` (Railway offers this as a reference variable).
4. In **Settings → Networking**, click **Generate Domain** to get a public web address.
5. Redeploy. On each start, Gigsaw creates or updates its database tables automatically (`prisma migrate deploy`).
6. Open the web address. On a brand new database, the first visit shows a setup page that creates the owner account. It only appears once. Then use the Owner area to add agencies.

Upgrading an existing single-agency install: the migration moves all existing data into one agency (named from its settings) and makes the first admin the owner. Nothing is deleted.

Railway runs `npm run build` and `npm start` on its own and sets the port for you. The site is served over HTTPS, which phones need before they will share their location for check-ins.

To try Gigsaw with sample data, go to **Settings → Demo data → Load demo data**. It adds five artists, nine venues, five promoters and about 80 bookings (including live arrivals for today) alongside your own data, and **Remove demo data** takes it all out again. Sample logins with published passwords are only created by the local seed script, never on the live site.

## Running it locally

You need Node.js 20.19+, 22.12+ or 24+ (Prisma 7 won't run on older versions) and a Postgres database. The quickest way to get Postgres is Docker:

```bash
docker run -d --name gigsaw-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=gigsaw -p 5432:5432 postgres:16
```

Then:

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run setup
```

```bash
npm run dev
```

Open http://localhost:3000. `npm run setup` creates the tables and fills them with demo data (an agency, five artists, venues, promoters and about 80 bookings, including live arrivals for today). It refuses to run over a database that already has data.

Demo logins (password `gigsaw123` for all):

- `admin@gigsaw.test`: owner (Owner area) and admin of Northern Lights Agency
- `agent@gigsaw.test`: agent at Northern Lights
- `maya@gigsaw.test`: artist app for Northern Lights (open it on a phone-sized window)
- `harbour@gigsaw.test`: admin of Harbour Music, a second agency that can't see Northern Lights' data

`npm run db:reset` wipes the local database and reloads the demo data. After changing `prisma/schema.prisma`, run `npm run db:migrate` to create a migration.

The database client is generated into `src/generated/prisma` (not committed) whenever you run `npm install` or `npm run build`; import it from `@/generated/prisma/client`. Prisma's own settings, including where it finds `DATABASE_URL`, are in `prisma.config.ts`.

## Checks

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run build
```

To check the database in `DATABASE_URL` matches `prisma/schema.prisma` ("No difference detected" means no drift):

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

## Tech

Next.js 16 (App Router, server actions), React 19, TypeScript, Tailwind CSS 4, Prisma 7 with Postgres (through the `pg` driver). Money is stored in pence/cents, times in UTC with the venue's time zone alongside.

## Not built yet

These Overture features are not in this first version: sending emails and messages from the app, e-signatures (Dropbox Sign), Stripe payments, live currency conversion, withholding tax, custom document templates, the REST API and Zapier, two-factor sign-in, push notifications, native iOS/Android apps, multi-agency artist accounts, and the AI assistant. Push or SMS alerts to the agent when an artist goes overdue would be a natural next step for arrival tracking.
