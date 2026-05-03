# WDW Trip Planner

A small webapp for estimating Walt Disney World vacation expenses. v1 covers hotel stays only — pick a resort, pick a room type, pick check-in/check-out dates, see the total.

## How to open it

Double-click `index.html` (or use the desktop shortcut). It opens in your default browser. No server needed — the rate data ships as JS, so it loads fine from a `file://` URL.

## Sharing with others

The app has a **Download to share** button in the header. Click it to save a single self-contained HTML file (`wdw-trip-planner.html`) that anyone can open — no install, no server, just double-click.

If the button shows an alert about blocked fetches, regenerate the share bundle from the command line:

```
node build-share.js
```

That writes `wdw-trip-planner-share.html` (~800 KB). Email it, drop it on Drive, share however — recipients just double-click to use the planner.

Re-run `node build-share.js` whenever you update `rates.js`, `dining.js`, `tickets.js`, `app.js`, or `index.html` to refresh the share bundle.

## What's in v1

- **3 resorts seeded with real 2026 data:**
  - Disney's All-Star Movies Resort (value)
  - Disney's Wilderness Lodge (deluxe)
  - Disney's Riviera Resort (DVC)
- All room types for each
- Per-night breakdown with season name, rate range, and midpoint
- Total for the stay (midpoint + low/high range)

## Where the data comes from

`rates.js` is hand-built from [mousesavers.com 2026 rate charts](https://www.mousesavers.com/2026-disney-world-room-rates-season-dates/). It's just a JSON object assigned to `window.RATES`. Mousesavers' rates already include tax (12.5% standard, 13.5% at All-Star resorts), so the totals here also include tax.

## How totals are computed

Mousesavers publishes rates in three day-of-week tiers per season:

- **monWed** — Mon, Tue, Wed
- **sunThu** — Sun, Thu
- **friSat** — Fri, Sat

The calculator looks up each night's exact tier rate and sums them — totals are the **actual rack rate**, not an average or midpoint. Flat-rate seasons (Easter, holidays, etc.) have all three tiers equal.

## Caveats

- **Rack rates are list prices.** Almost nobody pays them — Disney runs room offers, AP discounts, free dining, etc. throughout the year. This calculator is the upper bound, not what you'll actually pay.
- **Only 3 resorts so far.** Adding more is a data-entry job, not a code change — extend `rates.js` following the existing pattern.

## Future modules (out of v1 scope)

- More resorts (the other ~25 WDW Disney-owned hotels)
- Tickets pricing
- Dining estimates (table-service, quick-service, character meals)
- Transportation, souvenirs
- Discount/promo overlays so you can model what a deal would do to the total
