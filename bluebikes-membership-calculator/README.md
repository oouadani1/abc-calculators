# Bluebikes Corporate Membership Calculator

Helps an employer estimate the cost of offering Bluebikes memberships to
employees at Gold/Silver/Bronze subsidy tiers.

## What it does

A 2-step, plain-language flow (see the root [README's design
system](../README.md#design-system) for the shared voice/look rules):

1. **Your team** — a slider for how many people to enroll. Ride overage
   minutes are optional and tucked behind a collapsed "Some riders go over
   their ride time" `<details>` toggle rather than shown by default.
2. **Compare your options** — three glass cards, Gold/Silver/Bronze, each
   framed in plain language ("We cover it all" / "We split it" / "We help a
   little") instead of raw percentages, with total annual/monthly employer
   cost, cost per person per day (the figure ABC's marketing already uses),
   and what the employee pays. **Tapping a card selects it** — there's no
   separate tier-selector control — and updates the "Next steps" sentence
   below. There's no cost-based "winner" here (all three are valid business
   choices, unlike the fare calculator); the selection just tracks which
   tier the user is currently comparing against.

## Key modeling assumption

Ride overage minutes (beyond the 45 min/ride included in membership, billed
at $0.10/min) are modeled as **always paid by the employee**, not the
employer, regardless of tier. Corporate membership is assumed to cover
annual access only. Confirm this matches your actual Bluebikes contract
before publishing — see `BIKE_CONFIG.overage` comment in `calculator.js`.

## Data sources (as of last update)

| What | Value | Source | Verified |
|---|---|---|---|
| Corporate per-signup rate | $101.50/employee/year | bluebikes.com/pricing/corporate-membership | 2026-07-10 |
| Gold tier | 100% subsidy, employer pays $101.50, employee pays $0 | same | 2026-07-10 |
| Silver tier | 50% subsidy, employer pays $50.75, employee pays $50.75 | same | 2026-07-10 |
| Overage rate | $0.10/min beyond 45 min included | bluebikes.com/pricing/annual-membership | 2026-07-10 |

### ⚠ Bronze tier is tentative

Bluebikes' live corporate page currently only lists Gold and Silver — **no
Bronze tier exists there today.** The Bronze figures in `BIKE_CONFIG`
($26 employer / $75.50 employee, summing to the same $101.50 base rate) were
provided directly and are marked `tentative: true` in the config, which:
- Flags the card in the UI with an orange "Not confirmed" tag and a plain-language caution note
- Should **not** be treated as confirmed until verified internally or with
  `corporateaccounts@bluebikes.com`

Once confirmed, set `tentative: false` and remove the `tentativeNote` field
(or update it to reflect the confirmed date/source) in `calculator.js`.

Don't confuse the $101.50/year **corporate** rate with the $133.50/year
**individual retail** annual membership — they're separate products.

## How to update pricing next year

See the root [README.md](../README.md#how-to-update-fares--pricing-next-year)
for the general process. For this tool specifically:

1. Open `calculator.js`, find `BIKE_CONFIG` (the **CONFIG** section).
2. Re-check the corporate per-signup rate and tier structure at
   [bluebikes.com/pricing/corporate-membership](https://bluebikes.com/pricing/corporate-membership).
3. Update each tier's `employerAnnualCost` / `employeeAnnualCost` — they
   should always sum to the corporate per-signup rate.
4. Update `pricingSource.lastVerified`.
5. Run `../build.sh` from the repo root and re-paste
   `dist/bluebikes-chunk.html` into the ModX chunk.

## Local preview

Open `index.html` directly in a browser, or serve the repo root with any
static file server since it loads `../shared/...` files by relative path.
