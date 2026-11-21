# Handoff: business and event sign-up changes (branch `signup-v2`)

Written 2026-11-21. Not live. The user approves on the demo before anything goes to `main`.

## Where things are

- **Site repo:** `ammangogym/wegogym-site` (GitHub Pages: a push to `main` is live). Read its `CLAUDE.md`
  (ad-blocker class names, run `node tools/check-adblock.mjs`, bump `?v=` on changed CSS/JS).
- **Branch:** `signup-v2`, pushed to GitHub. All work below is on it. `main` already has the first
  change of the session (commit `b72153b`, live): an off-peak pricing tip on the events price box and a
  line on the business "done" screen.
- **Demo (private artifact):** https://claude.ai/artifact/5Jji45PhTGb8K6FfkXnc6a
  Built from the branch by `build.py` in `Claude outputs/signup-demo/` in the WGG2 folder. It copies the
  real pages and adds `demo.js`: fake network replies, Continue skips checks, Stripe stand-in screens,
  a step bar. To rebuild: clone the branch to `/home/claude/wegogym-site`, put `demo.js`, `demo.css`,
  `index.html`, `build.py` in `/home/claude/demo-src`, run `python3 build.py` (outputs
  `/home/claude/demo`), then republish with `publish_files` to slug
  `22de84b2-d168-483b-84b4-4959d4dec577` (read the live version with `get_artifact` first).
  `t3.mjs`, `t4.mjs`, `t9.mjs` there are the Playwright click-through tests (serve `/home/claude/demo`
  on port 8767).

## What the branch changes

**Business sign-up** (`business-register/`): after "Getting paid" there are two new steps, then a
"Waiting for approval" screen with a checklist.
- *Prices.* Choice of day passes or classes at set times.
  - Day passes: 1-day price, optional multi-day passes, and a "Fill your quieter times" box (tick to add;
    "% off" prefilled 50, link to type the discounted price instead; days and from/until times).
  - Classes: one class form on the left (type of class with suggestions, days, start, end, spaces, price,
    "Discount this class" with the same % / price switch) and a day-by-day calendar on the right with
    arrows. "Add to calendar" adds and clears the form; clicking a class loads it for Save / Cancel /
    Delete. A class on several days is ONE class: editing it changes every day (user not yet asked
    whether that is right).
- *Front-desk logins.* Optional. Name, email, date of birth, password typed twice. Calls the existing
  `create-venue-operator` function, so this already works live.

**Event sign-up** (`partnerships/`):
- Weekly or fortnightly events on 2+ days get "Some days are different (price, time or place)": per day,
  start, end, place, and "Discount on this day" (% off, link to type the ticket price instead). Shown on
  the review screen.
- Day-by-day calendar beside the events (real dates, arrows, jumps to a date when one is set, click to
  scroll to the event).
- Tip copy: "...running discounts on their quieter sessions to fill spaces..."
- Done screen is "Waiting for approval" with a checklist (sent, identity, payouts if paid, review).

**Bugs fixed on the branch (both are live on `main` today):** the £ sign overlaps typed prices on the
events form; hidden business fields (e.g. "Tell us what kind of place it is") show anyway.

## User decisions this session

- Discounts are the easy default: a percentage, prefilled at 50%, with an option to type the discounted
  price. No "would cost" example line; only problems show there.
- Classes are entered one at a time into a calendar, each with its own start and end time.
- Business sign-up includes front-desk logins.
- Paid-event organisers must reach Stripe payouts (live page does this after the ID check; the server's
  `needsPayouts` decides).

## To go live (after the user says "approved")

1. **Save business prices.** Not saved yet (`savePrices` only stores in page state). Tables exist in the
   WGG2 migrations: `day_pass_prices` (days 1-7), `slot_templates` (day_of_week 0-6, start, end,
   capacity, price), `promotions` (percent or fixed amount off, `days_of_week`, `slot_time_start/end`,
   `starts_on`/`ends_on` required). Check before writing:
   - `slot_templates` has no class name column: needs a migration.
   - The app's `publishDayPassPrices` order rule (narrow `max_pass_days` before writing prices, widen
     after) and `venues.booking_mode`.
   - A typed discounted price becomes a fixed amount off (price minus discounted price).
   - Promotion dates: pick a start and end (ask the user how long a standing discount lasts).
   - Day-number conventions (ISO 1-7 in the form vs 0-6 in the tables).
   - That venue owners' database permissions allow these writes from the website.
2. **Save per-day event details.** Needs a migration (e.g. `partnership_events.day_details` jsonb:
   weekday, start/end time, area, price_pence, discount_percent), the `submit_partnership_application`
   function, the `partnerships` edge function's checks, and the admin screen's display.
3. Bump `?v=` on `business-register.js` (now `v=4`), add one to `business-register.css`, bump
   `partnerships.css` / `partnerships.js`.
4. Run the ad-blocker check and the click-through tests against the real pages, merge `signup-v2` into
   `main`, push, check the live pages.
