# MBTA Fare / Monthly Pass Break-Even Calculator

Rebuilt to match the shape of ABC's original Calconic tool: tells a hybrid
commuter their real monthly pass cost after employer subsidy and Perq
pre-tax savings, and the breakeven pace (trips/days per week) at which a
pass beats paying per ride.

## What it does

A single, live-updating page — no multi-step wizard, no submit button (see
the root [README's design system](../README.md#design-system) for the
shared voice/look rules). Three inputs, same shape as the original tool:

1. **How do you get to work?** — Subway & Bus, or Commuter Rail (reveals a
   zone dropdown + a link to MBTA's official zone map PDF only if rail is
   picked). Commuter Rail's button uses MBTA's own official line color
   (`#80276C`); hovering Subway & Bus cycles through the other MBTA line
   colors and settles on ABC teal — a nod to the real system without
   picking one line to represent a multi-line pass.
2. **Does your employer help pay for your commute?** — plain-language
   buttons (No / A little / Half / Most / All of it), not a raw percentage.
3. **Do you buy your pass before taxes come out?** — a plain adjustable
   percentage field (default 25%, matching the original tool), not a toggle
   or a slider.

Results update instantly: real monthly cost (full price → after subsidy →
after pre-tax, shown as a breakdown), then the breakeven pace as **trips
per week** and **days per week in the office** — fractional numbers on
purpose, since this is a pace, not a hard weekly quota. A plain-language
"Next steps" line explains what the breakeven number means for a hybrid
schedule. Sourcing detail is tucked behind a collapsed "Where we got these
numbers" toggle instead of shown by default.

## What changed from the first rebuild, and why

The first pass at this tool added a trip-count input (with a "days/week"
slider hint) and a two-card pass-vs-pay-per-ride comparison, plus an
adjustable Perq slider and a 3-step wizard. None of that was in the
original brief or the original tool — it was scope added while translating
the Jawnt design reference. Once we had a screenshot of ABC's actual
original Calconic tool, it was clear the real tool never asked for trip
count at all: it only reports the pass's own real cost and breakeven pace,
leaving the user to self-assess against their own schedule. Dropping the
trip-count input necessarily means dropping the pay-per-ride comparison
card too — there's nothing to compare against without ridership data.

This version's calc logic was checked directly against the original tool's
own screenshot numbers (60% subsidy, 25% pre-tax → $27.00 real cost, 2.6
trips/week, 1.3 days/week) and matches exactly.

## Key modeling assumption

Real cost is subsidy applied first, then Perq's pre-tax percentage applied
on top of that — `afterSubsidy × (1 - perqPct/100)` — which is the exact
math the original tool used. See `mbtaCalcEffectivePassCost` in
`calculator.js`.

## Data sources (as of last update)

| What | Value | Source | Verified |
|---|---|---|---|
| LinkPass monthly | $90.00 | mbta.com/fares/subway-fares | 2026-07-10 |
| CR Zone 1A–10, Interzone 1–10 | $90–$426 | mbta.com/fares/commuter-rail-fares/zones | 2026-07-10 |
| Perq pre-tax %, default | 25% (adjustable) | matches ABC's original tool's default | 2026-07-10 |
| Commuter Rail zone map | PDF | cdn.mbta.com (official MBTA asset) | 2026-07-10 |

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
4. If the zone map PDF URL changes, update `zoneMapUrl` and the link in
   `index.html`.
5. Run `../build.sh` from the repo root and re-paste `dist/mbta-fare-chunk.html`
   into the ModX chunk.

## Local preview

Open `index.html` directly in a browser, or serve the repo root with any
static file server (e.g. `python3 -m http.server`) since it loads
`../shared/...` files by relative path.
