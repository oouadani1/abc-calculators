# MBTA Fare / Monthly Pass Break-Even Calculator

Helps a hybrid commuter figure out how many trips per month they need to take
for an MBTA monthly pass to beat paying per ride — factoring in employer
transit subsidy and Perq pre-tax purchase savings.

## What it does

A 3-step, plain-language flow (see the root [README's design
system](../README.md#design-system) for the shared voice/look rules):

1. **How you get to work** — Subway & Bus, or Commuter Rail (picks the zone
   only if rail is chosen), plus a slider for about how many one-way trips a
   month, with a live "about N days a week" hint.
2. **Employer perks** — plain buttons for how much the employer covers (No /
   A little / Half / Most / All of it), and a toggle for buying pre-tax
   through Perq, which reveals an adjustable savings-rate slider.
3. **Your answer** — two cards, effective monthly pass cost vs. pay-per-ride
   cost at that trip count, cheaper one highlighted with a "Recommended"
   badge; a plain-language "Next steps" takeaway; break-even trip count
   folded into that sentence rather than shown as a separate stat; sourcing
   detail tucked behind a collapsed "Where these numbers come from" toggle.

## Key modeling assumption

Employer subsidy and Perq pre-tax savings are applied **only to the monthly
pass purchase**, not to pay-per-ride fares — because that's how Perq is
actually sold (subsidized/pre-tax passes, not per-ride stored value credit).
Pay-per-ride is modeled as full fare, paid post-tax, out of pocket. This is
what makes subsidy/pre-tax status actually move the break-even point — see
the comment block above `mbtaCalcAll` in `calculator.js` if this needs
revisiting.

## Data sources (as of last update)

| What | Value | Source | Verified |
|---|---|---|---|
| LinkPass monthly | $90.00 | mbta.com/fares/subway-fares | 2026-07-10 |
| CR Zone 1A–10, Interzone 1–10 | $90–$426 | mbta.com/fares/commuter-rail-fares/zones | 2026-07-10 |
| Perq pre-tax savings estimate | ~30% (adjustable) | mbta.com/pass-program/perq/perq-employers | 2026-07-10 |

**Not baked in:** a temporary summer 2026 promo (50% off Commuter Rail
monthly passes, June–Aug, excluding Zone 1A) — that's a promotional rate,
not a durable fare, so it's intentionally excluded from `MBTA_CONFIG`.

## How to update fares next year

See the root [README.md](../README.md#how-to-update-fares--pricing-next-year)
for the general process. For this tool specifically:

1. Open `calculator.js`, find the `MBTA_CONFIG` object at the top (the
   **CONFIG** section — nothing else in this file should need to change).
2. Re-check every price in `passOptions` against
   [mbta.com/fares](https://www.mbta.com/fares). Update `oneWayFare` and
   `monthlyPrice` per row.
3. Update `fareSource.lastVerified` to today's date.
4. If Perq publishes an official savings percentage (rather than the
   "typical ~30%" language), update `perq.defaultSavingsRate` and the note
   in `index.html`'s "Where these numbers come from" `<details>` block
   (step 3).
5. Run `../build.sh` from the repo root and re-paste `dist/mbta-fare-chunk.html`
   into the ModX chunk.

## Local preview

Open `index.html` directly in a browser, or serve the repo root with any
static file server (e.g. `python3 -m http.server`) since it loads
`../shared/...` files by relative path.
