# ABC In-House Calculators

Two lightweight, framework-free calculators built to replace A Better City's
Calconic-embedded tools: the **MBTA Fare / Monthly Pass Break-Even
Calculator** and the **Bluebikes Corporate Membership Calculator**. Both are
plain HTML/CSS/JS — no build step, no framework, no iframe — designed to be
pasted directly into a ModX Chunk.

## Repo structure

```
abc-calculators/
├── shared/
│   ├── styles/base.css      # design tokens + shared components (cards, badges, inputs, callout)
│   └── utils/format.js      # currency/number formatting helpers
├── mbta-fare-calculator/
│   ├── index.html           # local dev preview only — NOT what gets pasted into ModX
│   ├── calculator.js        # CONFIG / CALC LOGIC / UI-RENDER, in that order
│   ├── calculator.css       # tool-specific overrides, prefix .abc-farecalc-*
│   └── README.md
├── bluebikes-membership-calculator/
│   ├── index.html
│   ├── calculator.js        # prefix .abc-bikecalc-*
│   ├── calculator.css
│   └── README.md
├── dist/                    # generated — ModX-ready chunks, do not hand-edit
│   ├── mbta-fare-chunk.html
│   └── bluebikes-chunk.html
└── build.sh                 # trivial concat script, no bundler
```

## Architecture pattern (both calculators)

Every `calculator.js` is split into three clearly commented sections, always
in this order:

1. **CONFIG** — every rate/price/rule, heavily commented with source URLs
   and a "last verified" date. This is the *only* section that should need
   editing when prices change.
2. **CALC LOGIC** — pure functions: config + inputs in, numbers out. No DOM
   access anywhere in this section.
3. **UI / RENDER** — reads form inputs, calls calc functions, writes to the
   DOM. No math happens here.

CSS classes are prefixed per tool (`.abc-farecalc-*`, `.abc-bikecalc-*`) so
nothing collides with the ModX site theme when embedded; shared primitives
in `shared/styles/base.css` use a plain `.abc-*` prefix.

## Local development

Each tool's `index.html` is a standalone preview page — open it directly in
a browser, or serve the repo root with any static server
(`python3 -m http.server`) since it references `../shared/...` by relative
path. It is **never** what gets pasted into ModX.

## Building the ModX chunks

```sh
./build.sh
```

This concatenates `shared/styles/base.css` + the tool's `calculator.css`
into a `<style>` block, extracts the calculator's HTML (the markup between
`<!-- ABC-CALC-HTML-START -->` / `<!-- ABC-CALC-HTML-END -->` markers in its
`index.html`), and concatenates `shared/utils/format.js` + the tool's
`calculator.js` into a `<script>` block — writing the result to
`dist/*.html`. No bundler; a non-developer could do this by hand by copying
the three pieces into one file if the script ever broke.

**Note on markers, not div-balance matching:** the build script extracts
HTML via explicit `<!-- ABC-CALC-HTML-START/END -->` comments rather than
matching `<div>...</div>` nesting in `sed`/`awk` — nested divs make
balance-matching fragile in plain shell tools. Keep those markers in place
around the root `.abc-calc` div in each `index.html`.

**Note on character encoding:** all visible text and JS string literals use
ASCII-safe escapes (`&mdash;` in HTML, `—`/`×` in JS) instead of
raw em-dashes/× characters. The `dist/*.html` files are bare fragments with
no `<head>`/`<meta charset>` of their own — they inherit whatever charset
the ModX page declares. Keeping the fragment itself byte-safe (pure ASCII)
means it renders correctly regardless of the parent page's encoding
declaration, rather than assuming ModX always gets it right.

## Pasting into ModX

1. Run `./build.sh`.
2. Open the relevant file in `dist/`.
3. Copy the full contents and paste into a ModX Chunk.
4. Test on a staging page before publishing — confirm the calculator
   renders and updates live with no console errors, and that
   `.abc-farecalc-*` / `.abc-bikecalc-*` styles aren't being overridden by
   the site theme.

## How to update fares / pricing next year

This is the process that's supposed to prevent this repo from becoming next
year's Calconic problem:

1. Open the relevant tool's `calculator.js` and find the `CONFIG` object at
   the top — it's the only place that should need edits.
2. Re-verify every number against the live source cited in that config
   object's comments (MBTA's fares page, Bluebikes' corporate pricing page).
3. Update the `lastVerified` / `verified` date fields as you go — these are
   what future-you checks first to know how stale the data might be.
4. If a number changed, sanity-check the derived UI output for a couple of
   inputs (e.g. does the $/employee/day figure for Gold still look right?).
5. Run `./build.sh` and re-paste the regenerated `dist/*.html` into the
   ModX chunk. Test on staging before publishing.
6. Each tool's own README documents tool-specific data-source nuances (e.g.
   the tentative Bluebikes Bronze tier, the MBTA Perq savings-rate estimate)
   — check those too, since they can have their own separate
   confirm-before-launch caveats beyond a straight price refresh.

Do this **annually at minimum** — MBTA fares in particular have changed on
that cadence historically, sometimes with structural changes (zone
boundaries), not just price bumps.

## Non-goals (v1)

No backend, no database, no user accounts, no analytics beyond whatever
ModX/site-wide analytics already capture, no framework, no build tooling
beyond `build.sh`, no iframe embed.
