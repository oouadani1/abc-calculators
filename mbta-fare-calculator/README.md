# MBTA Fare / Monthly Pass Break-Even Calculator

Helps a hybrid commuter figure out how many trips per month they need to take
for an MBTA monthly pass to beat paying per ride — factoring in employer
transit subsidy and Perq pre-tax purchase savings.

## What it does

- User picks a pass type (LinkPass, or a Commuter Rail zone/interzone), an
  estimated number of one-way trips/month, an employer subsidy percentage,
  and whether they'd buy the pass pre-tax through Perq.
- Shows two cards side by side: effective monthly pass cost vs. pay-per-ride
  cost at that trip count, with the cheaper option highlighted.
- Shows the break-even trip count (one-way and round trip) — the number of
  rides at which the pass becomes worth it.

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
   "typical ~30%" language), update `perq.defaultSavingsRate` and remove the
   estimate disclaimer in `index.html`'s `.abc-disclaimer` paragraph.
5. Run `../build.sh` from the repo root and re-paste `dist/mbta-fare-chunk.html`
   into the ModX chunk.

## Local preview

Open `index.html` directly in a browser, or serve the repo root with any
static file server (e.g. `python3 -m http.server`) since it loads
`../shared/...` files by relative path.
