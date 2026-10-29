# Gigsaw

Booking management for music agencies and their artists, modelled on [Overture](https://bookingwithoverture.com/features), with one big addition: **musicians mark when they've arrived at a gig, and the agency can see it live and track punctuality over time.**

## What's in it

| Area | What it does |
| --- | --- |
| **Arrivals (new)** | Live board of every gig with a call time in the last 12 or next 24 hours: overdue, on the way (with ETA), arrived on time, arrived late. Punctuality table per artist for the last 12 months. Latest check-ins feed. CSV export. Refreshes every 30 seconds. |
| **Artist app** | Phone-friendly pages at `/app` (can be added to the home screen). Artists see their gigs, schedule, venue directions and itinerary, and tap **I'm on the way**, **I've arrived** and **I've left the venue**. |
| Dashboard | Today's arrivals, shows in the next 30 days, open holds, money owed, overdue deposits, recent activity. |
| Bookings | Enquiry → hold → pending → confirmed → settled (or cancelled). Deal types: standard commission, buy/sell, guarantee vs %, guarantee plus bonus, flat fee. Fee, VAT, deposit, radius clause, itinerary, tags, notes. |
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

## Deploying on Railway

1. In your Railway project, add the GitHub repo as a service and deploy from the `main` branch.
2. Add a database: **+ New → Database → PostgreSQL**.
3. In the Gigsaw service, open **Variables** and add `DATABASE_URL` with the value `${{Postgres.DATABASE_URL}}` (Railway offers this as a reference variable).
4. In **Settings → Networking**, click **Generate Domain** to get a public web address.
5. Redeploy. On each start, Gigsaw creates or updates its database tables automatically (`prisma migrate deploy`).
6. Open the web address. The first visit shows a setup page where you name the agency and create the admin login. It only appears once.

Railway runs `npm run build` and `npm start` on its own and sets the port for you. The site is served over HTTPS, which phones need before they will share their location for check-ins.

The demo data is not loaded on Railway, because its logins use a published password. Add your own artists, venues and team from the app.

## Running it locally

You need Node.js 20 or newer and a Postgres database. The quickest way to get Postgres is Docker:

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

- `admin@gigsaw.test`: agency admin
- `agent@gigsaw.test`: agent
- `maya@gigsaw.test`: artist app (open it on a phone-sized window)

`npm run db:reset` wipes the local database and reloads the demo data. After changing `prisma/schema.prisma`, run `npm run db:migrate` to create a migration.

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

## Tech

Next.js 15 (App Router, server actions), React 19, TypeScript, Tailwind CSS 4, Prisma with Postgres. Money is stored in pence/cents, times in UTC with the venue's time zone alongside.

## Not built yet

These Overture features are not in this first version: sending emails and messages from the app, e-signatures (Dropbox Sign), Stripe payments, live currency conversion, withholding tax, custom document templates, the REST API and Zapier, two-factor sign-in, push notifications, native iOS/Android apps, multi-agency artist accounts, and the AI assistant. Push or SMS alerts to the agent when an artist goes overdue would be a natural next step for arrival tracking.
