# ABC In-House Calculators

Two lightweight, framework-free calculators built to replace A Better City's
Calconic-embedded tools: the **MBTA Fare / Monthly Pass Break-Even
Calculator** and the **Bluebikes Corporate Membership Calculator**. Both are
plain HTML/CSS/JS — no build step, no framework, no iframe — designed to be
pasted directly into a ModX Chunk.

## Live preview (GitHub Pages test space, pre-ModX approval)

- MBTA Fare Calculator: https://oouadani1.github.io/abc-calculators/mbta-fare-calculator/index.html
- Bluebikes Membership Calculator: https://oouadani1.github.io/abc-calculators/bluebikes-membership-calculator/index.html

These are the dev-preview pages, served as-is from the repo — not the final
ModX embed. Useful for sharing a live link before internal approval.

## Repo structure

```
abc-calculators/
├── shared/
│   ├── styles/fonts.css     # self-hosted IBM Plex Sans/Mono, base64-embedded (no CDN)
│   ├── styles/base.css      # design tokens + glass components (cards, badges, steps, callout)
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

## Design system

- **Voice:** plain, friendly, full-sentence language throughout ("Does your
  employer help pay for your commute?" not "Employer subsidy (%)"). Results
  read like a sentence a person would say out loud, not a spreadsheet cell.
- **Flow:** ask only what's mission-critical, on one live-updating page —
  no wizard, no submit button, matching the original brief's "live-updating,
  no submit button" instruction. Before adding an input, check whether it's
  actually load-bearing for the output or something we're tempted to add for
  polish (see the MBTA README's "what changed from the first rebuild"
  section for a worked example of walking one back). Optional/rare detail is
  tucked behind a native `<details>` disclosure instead of shown by default.
- **Look:** flat, solid, bold — no gradients, no glass/blur. Two colors
  pulled directly from abettercity.org's live site: electric teal
  (`--abc-teal`, `#13A6B5`) for selected/winning states, and bold orange
  (`--abc-orange`, `#E96E17`) for the "Next steps" callout and caution
  flags, both against a deep navy (`--abc-navy`, `#134072`) base. All
  defined as CSS custom properties in `shared/styles/base.css` — change the
  palette in one place. Where a tool has its own real-world color system
  (e.g. MBTA's official line colors), use it directly rather than forcing
  everything through the shared ABC palette — see the MBTA calculator's
  Commuter Rail purple (`#80276C`, MBTA's actual line color) for an example.
- **Type:** IBM Plex Sans for everything, IBM Plex Mono for the big dollar
  figures in result cards (a small deliberate "calculator" accent). Both are
  self-hosted as base64-embedded `@font-face` rules in
  `shared/styles/fonts.css` — no Google Fonts CDN call at render time, so a
  ModX page with a strict CSP or no internet reachability to Google still
  renders correctly. IBM Plex Sans is embedded once as a variable font
  (400–700 weight range) rather than four separate static files.

## Local development

Each tool's `index.html` is a standalone preview page — open it directly in
a browser, or serve the repo root with any static server
(`python3 -m http.server`) since it references `../shared/...` by relative
path. It is **never** what gets pasted into ModX.

## Building the ModX chunks

```sh
./build.sh
```

This concatenates `shared/styles/fonts.css` + `shared/styles/base.css` +
the tool's `calculator.css` into a `<style>` block, extracts the calculator's HTML (the markup between
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
