# Gigsaw

Booking management for music agencies and their artists, modelled on [Overture](https://bookingwithoverture.com/features), with one big addition: **musicians mark when they've arrived at a gig, and the agency can see it live and track punctuality over time.**

## Built for regular venue work

Most agency work is weekly slots at the same venues, so Gigsaw is built around them:

- **Weekly music schedules** on each venue (e.g. Mon–Thu 19:00–21:00 Solo, Fri 16:00–19:00 and 19:00–22:00), with fee, who pays, act type and an optional regular artist. Add the same slot to several days at once.
- **Rota**: a week grid of every venue's slots, showing who's booked and what's empty (amber). Fill a slot by picking an artist; **Book regulars** books every slot's regular artist for 1–12 weeks, skipping anything already booked. **+ Add** in any day adds a gig there (one-off, or tick "Every Thursday" to make it a weekly slot), **Add a gig** at the top does the same for any date and venue, and the date picker jumps to any week. One-off gigs at a venue show on the rota too.
- **New booking** button on every page (or press `N`): act, date, venue (optional, e.g. a wedding), times, type, status, fee and who booked it, with the same double-booking check. The full form is one click away.
- **Change a slot, change its gigs**: new times or fee on a slot can be applied to every upcoming gig in it, and each artist is told.
- **Change several gigs at once**: tick gigs on Bookings, then set new times, move them by some minutes, or set a new fee.
- **Artists are told about changes**: an email and text showing old → new for date, times, venue and their fee, and when a gig is confirmed or cancelled; one message listing new gigs when they're booked.
- **Search everything**: the search bar on every page (press `/`) shows results as you type: acts, venues, contacts, bookings on any date (including by reference, e.g. GS-0042) and pages. Enter opens the full list of gigs for a town, venue or act, with tap-to-call numbers.
- **Calendar**: Day, Week (default) and Month views, coloured by venue (or artist), filter by town.
- **Phone calendars**: artists tap once in their app to add their gigs to Apple, Google or Outlook calendar; it updates by itself.
- **Venue line-up links**: each venue can have a private link (`/v/…`) showing who's playing and when, slots still to be confirmed, and arrivals on the night, plus a calendar feed. It never shows fees, deals, contacts or other venues. Make, replace or turn off the link on the venue's page.
- **Branded emails** in the agency's name; replies go to the agent or agency, not a no-reply address.
- **"Hold on" before double-booking**: saving a booking, filling a rota slot or changing times checks the artist's other gigs. If times overlap, or there isn't enough time to pack down and travel between venues (estimated from the venues' map pins plus a changeover time set in Settings), a clear warning explains why, with **Save anyway** or **Go back**. Gigs with plenty of time between them aren't flagged. "Book regulars" never double-books: it leaves the slot empty and says why.
- **Gig reminders**: each act gets a list of the coming week's gigs (default Sunday 18:00) and a "Don't forget your gig this evening" reminder on the day (default 12:00, or 3 hours before an afternoon call time). They go as phone notifications once turned on in the artist app, and by email; acts without phone notifications get a text instead. Set days and times, or turn them off, in **Settings → Gig reminders**. Each reminder only ever goes once.
- **People, companies and acts** (like Overture's contacts): a person has a company, either a **venue** (so venue managers are simply people at that venue) or another company such as a promoter, plus any number of **acts**, each with a job title. One person can be in several acts (e.g. Wonderlust and their solo act). Typing a new company or act name creates it. Add members from an act's page; add people from a venue's or company's page.
  - A person can have **their own app login**: they see the gigs for every act they're in, labelled by act, with one calendar link for all of them.
  - Reminders and gig changes go to each **member** (an act with no members yet uses its own email and phone).
  - **Double-booking checks follow the people**: a gig for one act is checked against gigs for any act that shares a member.
- **Statuses and offers**: create gigs first, add acts later.
  - **Pending**: the gig is in the calendar (venue, date, times, money) and may have no act yet. It shows as "Needs an act" on the calendar, rota, dashboard and menu badge.
  - **Awaiting confirmation**: add an act and choose this status. The act (or each of its members) gets an email, phone notification or text offering the gig with their own fee only, and a private link (`/o/…`, no login) to **Accept** or **Decline**; several offers can be accepted at once. Offers also appear at the top of the artist app.
  - **Confirmed**: when the act accepts, the gig confirms itself and the agent is emailed. A decline leaves the gig as it is and the agent gets an email and a text. The dashboard lists offers waiting and declined.
  - When a gig becomes Confirmed, the act is told it's booked (and it appears in their phone calendar). For weddings and private events the customer is told too; bar gigs' venues are not (Settings → Weddings and events).
  - Rota: "Put every slot in the calendar" (Pending, no act), "Offer each slot to its regular act" or "Book each regular act in as confirmed"; each empty slot has **Offer** and **Confirm**.
- **Copy a booking**: "Copy" on any booking opens a mini calendar; tick any dates and the booking (venue, times, money, act, details) is copied to each, as Pending, Awaiting confirmation (one offer message to the act for all of them) or Confirmed. With one date you can jump to the new booking; with several you stay put.
- **Venue statements** (Money → Venue statements, or "Statement" on a venue): pick a venue and dates (This month / Last month) to see every gig played there, what the venue owes, what's been received, each act's fee and what's been paid to them, and your margin. "Printable invoice" bills the venue for the confirmed gigs in the period (never showing what the acts are paid). Gigs booked by private customers at the venue are left out unless ticked.
- **Menu in sections**: Bookings, Roster, Clients, Money and Admin.
- **Overdue** gigs show a large red banner on the booking with a Call button.
- **Weddings & events** (menu: Weddings): one booking for the customer with every act they've booked (ceremony singer, band, DJ…). Each act gets its own gig with its own times, **sale** (what the customer pays) and **cost** (the act's fee). The customer's total, payments and balance are added up across the acts, with **one combined invoice**; a payment is shared across the acts automatically.
  - **Checklist** per wedding (contract, deposit, details from the couple, balance, final details to the acts, thank-you); several tick themselves.
  - **Planner link** for the couple (`/w/…`, no login): running order, contact on the day, parking and load-in, dress code, food for the acts, song requests. The acts see it on their gig page with who else is performing, but never any prices.
  - **Automatic emails** (Settings → Weddings and events, or per event): planner link 8 weeks before and a reminder at 3 weeks if it isn't filled in, a balance reminder in the last 2 weeks while money is owed, final details to the acts a week before, and a thank-you with your review link the day after. Sent between 9am and 8pm, each once.
- **Sale and cost**: every booking has what the venue or client pays (the sale), what the act is paid (the cost) and what we make (the difference), worked out as you type. Older commission deals still show correctly and turn into sale and cost when edited. The agency sees everything; acts only see their own pay.
- **Bands made of acts**: on a band's page, add its members by searching your existing acts (e.g. Wonderlust = Graham McKee Solo + Jo Drummond Solo). The solo acts see the band's gigs, and the band's gigs are checked against their solo gigs for clashes. The Acts page has List, Cards and Bands views.
- **Sign-up and subscriptions (Stripe)**: new businesses sign up at /signup, pick a plan (Starter, Growth or Agency by gigs a month, monthly or yearly; prices in src/lib/plans.ts) and get a 30-day free trial with no card. Settings → Plan shows the trial, this month's gigs and users against the plan, Add card and subscribe (Stripe Checkout, with the rest of the trial carried over), Manage billing (Stripe's portal: card, invoices, cancelling) and Change plan. Extra internal users over the plan's allowance are added to the subscription automatically. When a trial ends without a card, or a subscription is cancelled, the business can only reach Plan and Profile until it subscribes (acts' app keeps working). Businesses set up by the owner stay on invoice billing; the owner can switch either way and extend a trial from the Owner area.
- **Contracts signed online**: "Send contract to sign" on a booking, or on a wedding or event (one contract covering every act), emails the payer or customer a private link (`/c/…`, no login). On their phone they read the contract exactly as printed, type their name, draw their signature and tick "I agree". The signed copy is locked with their name, signature, IP address, device, time and a SHA-256 fingerprint of what they saw, and can be printed or saved as PDF by both sides. The booking shows Not sent, Sent, Viewed or Signed, with resend and cancel, and warns "Changed since signing" if the date, times, fee or other terms change afterwards. The lead agent is emailed when it's signed (Profile → notifications), and the checklist flags confirmed bookings without a signed contract. The email's wording is in Settings → Notifications → Customer notifications. The contract shows what the client pays, never what the acts are paid.
- **Card payments from venues and customers (Stripe Connect)**: Settings → Card payments → Connect Stripe makes the agency its own Stripe account (a Standard account they own and log in to themselves) and sends the admin to Stripe to set it up. Once it can take cards, every booking and wedding has **Pay by card**: make a link for the deposit or the balance, then copy it or email it (the "Payment link" email can be reworded in Notifications). The link (`/pay/…`, no login) shows what the venue or customer pays, VAT and booking fee included as on the invoice, and always asks for what's still due; Pay opens Stripe Checkout on the agency's account, so the money goes straight to them. When it's paid, the payment is logged on the gig like one entered by hand (an event's is shared across its acts, deposits first), the deposit counts as received, the lead agent gets an email, and the invoice shows "Paid by card". Acts never see any of it. Gigsaw takes no cut for now (see `applicationFeeMinor` in src/lib/pay-links.ts). Disconnect just forgets the account; it stays the agency's in Stripe.
- **Archive bookings**: tick bookings on All bookings and press Archive selected (or Archive on a booking). They leave every list, calendar, report and the act's app, but are kept: see them under Archived, restore them, or (admins) delete them for good. Only archived bookings can be deleted. Archived gigs that happened still count for Gigsaw billing.
- **Shopify-style admin**: a dark frame with the page in a rounded panel. Settings is a set of pages with its own sidebar menu (General, Plan, Internal users, Notifications, Booking fee, Card payments, Arrivals and alerts, Act reminders, Weddings and events, Contracts and invoices, Demo data) and a search box. Each page saves only its own fields.
- **Profile** (bottom left): your name, mobile, password, light or dark, and your own **notifications**: switch email or text off for late acts, turned-down gigs, accepted gigs, planners coming in and card payments. These only affect you.
- **Notifications** (Settings): the sending address and where replies go, a test button, and every automatic message to acts, customers and the team. Switch any off, or change its subject, opening message and text, with placeholders like {first_name}, {act}, {venue} and {date}. The venue, date, times and links are always added underneath. Cancellations always go out. Plus a full message log.
- **Fill-in templates** (Acts → Import, or Import from a spreadsheet on People and Venues): download a template for acts, people or venues, fill it in with Excel, Numbers or Google Sheets, save as CSV and upload. Members and acts are linked by name (new ones are added), people are linked to the venue or company they work at, venue parking, PA and arrival notes are saved, and the example rows are skipped. Uploading the same file again adds nothing new.
- **Import from Overture** (Acts → Import, admins): upload Overture's contacts export (CSV). Acts come across with their people linked as members (someone in two acts is linked to both), companies with an address or a venue tag become venues with their staff linked, other companies go under Companies & customers, and people tagged Customer become private customers. Things already here with the same name are matched and only blank details filled in, so the same file can be imported again safely.
- **New acts join with a private link** (Acts → New acts): make a link and send it to acts you want to take on. They fill in their act, type, genre, town, contact details, other members, video, photo, Instagram, website, set list, usual fee and bank details (sort code and account number checked), and choose a password. You get an email, and the application waits under New acts (with a count in the menu). Approve it to create the act, its members (the contact gets a login) and email them that they can log in; decline it and nothing is made. Make a new link at any time to stop the old one working. Each act's page shows its profile and bank details (agency only), editable from Edit.
- **Payments** (Money in the menu): what venues and clients still owe and what's still to pay each act, grouped by venue, client or act, with one button to mark a whole group paid (a gig paid both ways after it's happened becomes Settled). Shows gigs that have happened by default, with upcoming ones on request. A payments log for any week, month or year shows money in, money out and the difference.
- **Booking fee**: a fee on top of the act's fee, paid by the venue or client and kept in full by the agency (no act's share). Set a default in Settings, for weddings and private events (charged once per event) or for every booking. It fills in on new bookings, can be changed on any booking, shows as its own line on invoices and contracts, and counts towards what we made in reports. Acts never see it.
- **Acts only see their own pay**: the artist app shows the act's fee after commission, never what the venue or customer pays, the deal or deposits. Contracts, invoices and exports are agency-only.
- **Calendar**: a gig that runs past midnight stays on the day it starts, with a ☾ moon. Hover a gig for its details: times, total fee, received, outstanding, the act's pay, act, venue, who booked it and the act's contact.
- **Dark mode** by default for the agency pages; the sun/moon button by your name switches to light (remembered on that device).
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
| **Artist app** | Phone-friendly pages at `/app` (can be added to the home screen). Artists see their gigs, schedule, venue directions and itinerary, and tap **I'm on the way**, **I've arrived** and **I've left the venue**. **Turn on reminders** enables phone notifications on that phone (on iPhone, add Gigsaw to the Home Screen first; the app shows how). Each act's page shows whether their phone reminders are on. |
| Dashboard | Today's arrivals, shows in the next 30 days, open holds, money owed, overdue deposits, recent activity. |
| Bookings | Booking type (gig, festival, club night, wedding, corporate, private party, other). Enquiry → hold → pending → confirmed → settled (or cancelled). Venue or client pays, act is paid, we make. VAT, deposit, radius clause, itinerary, tags, notes. |
| Checklist | On every booking: double bookings, radius clause breaches, missing venue, client (weddings and parties) or price, act's pay not entered, overdue deposits, missing itinerary details. |
| Calendar | Month view filtered by artist and status. Each artist has a private calendar feed (ICS) for Google, Apple or Outlook calendar. |
| Contacts | Promoters, private customers (e.g. weddings), venue staff and collaborators, with type tabs, tags, search (including the notes archive) and conversation notes. |
| Venues | Address, capacity, time zone and the map pin used to verify arrivals. |
| Money | Payments in from venues and clients and out to acts. What's still owed each way. |
| Documents | Printable contract, invoice and day sheet (print or save as PDF). |
| Reports | Pick a week, month or year (arrows and a date picker) or any dates. What venues and clients paid, what each act earned, what we made, broken down day by day, week by week or month by month. A table per act, per venue (what they paid for live music, with a link to their statement) and per wedding or private client. CSV export. |
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

- **Late alerts:** once a minute, Gigsaw checks for gigs whose call time (plus the grace period) has passed with no check-in, and emails and texts the booking's agent plus an optional on-call email and mobile (Settings → Arrivals and alerts). Each gig is alerted once.
- **Client arrival messages:** when an artist checks in, the booking's client gets a short email and text. Switch off per agency or per booking.
- **Password reset:** "Forgot password?" on the sign-in page emails a one-hour, single-use link.
- **Gig reminders** for acts: weekly and on the day (see above). Phone notifications need no extra account or provider.
- Demo data never sends anything.

Messages go out once these are set in Railway → Variables. Until then, every message is saved to the **Outbox** (Owner area) and the agency's **Settings → Messages**, so nothing is lost and you can check the wording.

| Variable | What it's for |
| --- | --- |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Card subscriptions. Products and prices are created in Stripe automatically. Add a webhook endpoint in Stripe pointing at `<your site>/api/stripe/webhook` with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`, and turn on the customer portal in Stripe's settings. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Card payments from venues and customers into each agency's own Stripe account. Uses the same `STRIPE_SECRET_KEY`; turn on Connect in the Stripe dashboard first. Add a second webhook endpoint that listens to events on **connected accounts**, pointing at `<your site>/api/stripe/connect-webhook`, with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `account.updated` and `account.application.deauthorized`. Its signing secret goes here. |
| `RESEND_API_KEY`, `MAIL_FROM` | Email via [Resend](https://resend.com). `MAIL_FROM` like `Gigsaw <bookings@send.gigsaw.live>` (the domain must be verified in Resend). Replies go to the agency email from Settings, not this address. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Texts via [Twilio](https://www.twilio.com). `TWILIO_FROM` is your Twilio number, e.g. `+447700900000`. |
| `APP_URL` | Optional. The site address used in links. Railway's own domain is used if this isn't set. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Optional. Keys that sign phone notifications. If not set, Gigsaw makes a pair once and keeps it in the database, which is fine for most installs. Changing them means every phone has to turn reminders on again. |
| `DISABLE_SCHEDULER`, `CRON_SECRET` | Optional. Turn off the built-in checker (late alerts and gig reminders) and call `POST /api/cron/overdue` with `Authorization: Bearer <CRON_SECRET>` from your own scheduler instead. |

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

To try Gigsaw with sample data, go to **Settings → Demo data → Load demo data**. It adds a bar-circuit agency: 12 acts (solos, duos, a DJ and two bands, one built from solo acts), 8 venues with weekly music schedules, managers and the pub companies that pay, six weeks of gigs played, live arrivals today, the next month of gigs with offers out and gigs still needing an act, two weddings and two private events, alongside your own data, and **Remove demo data** takes it all out again. Sample logins with published passwords are only created by the local seed script, never on the live site.

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

Open http://localhost:3000. `npm run setup` creates the tables and fills them with demo data (two agencies, each with 12 acts (solos, duos, a DJ and two bands, one built from solo acts), 8 venues with weekly music schedules, managers and the pub companies that pay, six weeks of gigs played, live arrivals today, the next month of gigs with offers out and gigs still needing an act, two weddings and two private events). It refuses to run over a database that already has data.

Demo logins (password `gigsaw123` for all):

- `admin@gigsaw.test`: owner (Owner area) and admin of Northern Lights Agency
- `agent@gigsaw.test`: agent at Northern Lights
- `ellie@gigsaw.test`: artist app as a solo act's login (open it on a phone-sized window)
- `graham@gigsaw.test`: artist app as a person: Graham sees his solo gigs and those of Wonderlust, a band built from his act and Jo Drummond's
- `harbour@gigsaw.test`: admin of Harbour Music, a second agency that can't see Northern Lights' data

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

These Overture features are not in this first version: sending emails and messages from the app, e-signatures (Dropbox Sign), card refunds from inside Gigsaw (do them in Stripe), live currency conversion, withholding tax, custom document templates, the REST API and Zapier, two-factor sign-in, native iOS/Android apps, multi-agency artist accounts, and the AI assistant.
