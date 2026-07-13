/* ============================================================
   ABC MBTA Fare / Monthly Pass Break-Even Calculator
   Split into three sections: CONFIG, CALC LOGIC, UI / RENDER.
   Depends on shared/utils/format.js being loaded first.

   Rebuilt to match the shape of ABC's original Calconic tool: three
   inputs (zone, employer subsidy, pre-tax %), no trip-count input.
   The tool reports your real cost and the breakeven pace (trips/days
   per week) — it does not ask how often you personally ride, so it
   can't tell you whether the pass "wins" for you specifically.
   ============================================================ */

/* ------------------------------------------------------------
   1. CONFIG
   The only section that should need editing when fares change.
   Every price below was pulled from mbta.com on 2026-07-10.
   RE-VERIFY ANNUALLY — MBTA fares typically change each July/August
   and commuter rail zone boundaries have shifted in past years.
   ------------------------------------------------------------ */
const MBTA_CONFIG = {
  fareSource: {
    url: "https://www.mbta.com/fares",
    lastVerified: "2026-07-10",
    note:
      "Zone/interzone table pulled from mbta.com/fares/commuter-rail-fares/zones " +
      "and mbta.com/fares/subway-fares. A temporary summer promo (50% off CR " +
      "monthly passes, June-Aug 2026, excluding Zone 1A) is NOT reflected below " +
      "since it's not a permanent rate.",
  },

  // Official MBTA Commuter Rail zone map, for the "which zone am I in" question.
  // Linked out to rather than embedded — keeps this tool dependency-free.
  zoneMapUrl: "https://cdn.mbta.com/sites/default/files/2021-03/2021-03-23-cr-fare-zones.pdf",

  // Perq (MBTA's pre-tax commuter benefit program). ABC's original tool
  // exposed this as a plain editable percentage (defaulting to 25%), not a
  // toggle — matched here. No official MBTA-published rate; this is always
  // an estimate the user can tune.
  perq: {
    defaultPct: 25,
    source: "https://www.mbta.com/pass-program/perq/perq-employers",
  },

  subsidyPresets: [
    { pct: 0, label: "No" },
    { pct: 25, label: "A little" },
    { pct: 50, label: "Half" },
    { pct: 75, label: "Most" },
    { pct: 100, label: "All of it" },
  ],

  // First entry is used directly for the "Subway & Bus" choice.
  // Everything else is Commuter Rail, shown only if that's selected.
  // Zone 1A and LinkPass are both $90 as of this pricing period — that's a
  // real coincidence in current MBTA fares, not a bug.
  passOptions: [
    { id: "linkpass", label: "Subway & Bus (LinkPass)", group: "subway", oneWayFare: 2.40, monthlyPrice: 90.00 },
    { id: "cr-zone-1a", label: "Zone 1A", group: "rail", oneWayFare: 2.40, monthlyPrice: 90.00 },
    { id: "cr-zone-1", label: "Zone 1", group: "rail", oneWayFare: 6.50, monthlyPrice: 214.00 },
    { id: "cr-zone-2", label: "Zone 2", group: "rail", oneWayFare: 7.00, monthlyPrice: 232.00 },
    { id: "cr-zone-3", label: "Zone 3", group: "rail", oneWayFare: 8.00, monthlyPrice: 261.00 },
    { id: "cr-zone-4", label: "Zone 4", group: "rail", oneWayFare: 8.75, monthlyPrice: 281.00 },
    { id: "cr-zone-5", label: "Zone 5", group: "rail", oneWayFare: 9.75, monthlyPrice: 311.00 },
    { id: "cr-zone-6", label: "Zone 6", group: "rail", oneWayFare: 10.50, monthlyPrice: 340.00 },
    { id: "cr-zone-7", label: "Zone 7", group: "rail", oneWayFare: 11.00, monthlyPrice: 360.00 },
    { id: "cr-zone-8", label: "Zone 8", group: "rail", oneWayFare: 12.25, monthlyPrice: 388.00 },
    { id: "cr-zone-9", label: "Zone 9", group: "rail", oneWayFare: 12.75, monthlyPrice: 406.00 },
    { id: "cr-zone-10", label: "Zone 10", group: "rail", oneWayFare: 13.25, monthlyPrice: 426.00 },
    { id: "cr-interzone-1", label: "Interzone 1", group: "rail", oneWayFare: 2.75, monthlyPrice: 90.00 },
    { id: "cr-interzone-2", label: "Interzone 2", group: "rail", oneWayFare: 3.25, monthlyPrice: 110.00 },
    { id: "cr-interzone-3", label: "Interzone 3", group: "rail", oneWayFare: 3.50, monthlyPrice: 120.00 },
    { id: "cr-interzone-4", label: "Interzone 4", group: "rail", oneWayFare: 4.25, monthlyPrice: 139.00 },
    { id: "cr-interzone-5", label: "Interzone 5", group: "rail", oneWayFare: 4.75, monthlyPrice: 158.00 },
    { id: "cr-interzone-6", label: "Interzone 6", group: "rail", oneWayFare: 5.25, monthlyPrice: 178.00 },
    { id: "cr-interzone-7", label: "Interzone 7", group: "rail", oneWayFare: 5.75, monthlyPrice: 196.00 },
    { id: "cr-interzone-8", label: "Interzone 8", group: "rail", oneWayFare: 6.25, monthlyPrice: 216.00 },
    { id: "cr-interzone-9", label: "Interzone 9", group: "rail", oneWayFare: 6.75, monthlyPrice: 237.00 },
    { id: "cr-interzone-10", label: "Interzone 10", group: "rail", oneWayFare: 7.25, monthlyPrice: 257.00 },
  ],
};

/* ------------------------------------------------------------
   2. CALC LOGIC
   Pure functions: config + inputs in, numbers out. No DOM access.
   ------------------------------------------------------------ */

function mbtaGetPassOption(config, passId) {
  return config.passOptions.find((p) => p.id === passId);
}

/** Cost after employer subsidy only. */
function mbtaCalcSubsidizedCost(monthlyPrice, subsidyPct) {
  return monthlyPrice * (1 - subsidyPct / 100);
}

/** Real cost after subsidy, then pre-tax savings on top — matches ABC's original tool's math exactly. */
function mbtaCalcEffectivePassCost(monthlyPrice, subsidyPct, perqPct) {
  const afterSubsidy = mbtaCalcSubsidizedCost(monthlyPrice, subsidyPct);
  return afterSubsidy * (1 - perqPct / 100);
}

/** One-way trips per week needed for the pass to break even. Fractional on purpose — this is a pace, not a hard count. */
function mbtaCalcBreakEvenTripsPerWeek(effectivePassCost, oneWayFare) {
  if (oneWayFare <= 0) return 0;
  const tripsPerMonth = effectivePassCost / oneWayFare;
  return tripsPerMonth / 4.345; // avg weeks/month
}

/** Each in-office day = one round trip = two one-way trips. */
function mbtaCalcBreakEvenDaysPerWeek(tripsPerWeek) {
  return tripsPerWeek / 2;
}

/** Bundles every derived number the UI needs for one pass option + inputs. */
function mbtaCalcAll(config, passId, subsidyPct, perqPct) {
  const pass = mbtaGetPassOption(config, passId);
  const afterSubsidy = mbtaCalcSubsidizedCost(pass.monthlyPrice, subsidyPct);
  const effectivePassCost = mbtaCalcEffectivePassCost(pass.monthlyPrice, subsidyPct, perqPct);
  const tripsPerWeek = mbtaCalcBreakEvenTripsPerWeek(effectivePassCost, pass.oneWayFare);
  const daysPerWeek = mbtaCalcBreakEvenDaysPerWeek(tripsPerWeek);

  return {
    pass,
    afterSubsidy,
    effectivePassCost,
    subsidyDollarSavings: pass.monthlyPrice - afterSubsidy,
    pretaxDollarSavings: afterSubsidy - effectivePassCost,
    tripsPerWeek,
    daysPerWeek,
  };
}

/* ------------------------------------------------------------
   3. UI / RENDER
   Reads form inputs, calls CALC LOGIC, writes results to the DOM.
   No math happens in this section. Single live-updating view —
   no steps, no submit button, per the project's original brief.
   ------------------------------------------------------------ */

function mbtaInitCalculator(rootEl) {
  let routeType = "subway"; // "subway" | "rail"

  const routeButtons = rootEl.querySelectorAll("[data-abc-route-select]");
  const railZoneField = rootEl.querySelector("[data-abc-rail-zone-field]");
  const railZoneSelect = rootEl.querySelector("[data-abc-rail-zone-select]");

  const subsidyButtons = rootEl.querySelectorAll("[data-abc-subsidy-preset]");
  let subsidyPct = 0;

  const perqInput = rootEl.querySelector("[data-abc-perq-pct]");

  // Populate the rail zone dropdown from config (everything except linkpass).
  MBTA_CONFIG.passOptions
    .filter((p) => p.group === "rail")
    .forEach((pass) => {
      const opt = document.createElement("option");
      opt.value = pass.id;
      opt.textContent = pass.label;
      railZoneSelect.appendChild(opt);
    });

  function currentPassId() {
    return routeType === "subway" ? "linkpass" : railZoneSelect.value;
  }

  routeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      routeType = btn.dataset.abcRouteSelect;
      routeButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      railZoneField.style.display = routeType === "rail" ? "flex" : "none";
      rootEl.classList.toggle("abc-farecalc-rail-active", routeType === "rail");
      render();
    });
  });

  subsidyButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      subsidyPct = Number(btn.dataset.abcSubsidyPreset);
      subsidyButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      render();
    });
  });

  railZoneSelect.addEventListener("change", render);
  perqInput.addEventListener("input", render);

  function render() {
    const perqPct = Math.min(100, Math.max(0, Number(perqInput.value) || 0));
    const result = mbtaCalcAll(MBTA_CONFIG, currentPassId(), subsidyPct, perqPct);

    rootEl.querySelector("[data-abc-real-cost]").textContent = abcFormatCurrency(result.effectivePassCost);
    rootEl.querySelector("[data-abc-full-price]").textContent =
      `Full price: ${abcFormatCurrencyWhole(result.pass.monthlyPrice)} a month`;
    rootEl.querySelector("[data-abc-after-subsidy]").textContent =
      subsidyPct > 0
        ? `After your employer's help: ${abcFormatCurrency(result.afterSubsidy)} a month`
        : `Your employer isn't covering any of this`;
    rootEl.querySelector("[data-abc-after-pretax]").textContent =
      perqPct > 0
        ? `Buying pre-tax saves you about ${abcFormatCurrency(result.pretaxDollarSavings)} more`
        : `Add a pre-tax percentage above if you buy this through Perq`;

    rootEl.querySelector("[data-abc-trips-week]").textContent = result.tripsPerWeek.toFixed(1);
    rootEl.querySelector("[data-abc-days-week]").textContent = result.daysPerWeek.toFixed(1);

    const takeawayEl = rootEl.querySelector("[data-abc-takeaway]");
    const days = result.daysPerWeek.toFixed(1);
    takeawayEl.textContent =
      `If you're commuting in about ${days} days a week or more, this pass is worth it. ` +
      `Fewer days than that, and paying per ride will usually cost less.`;
  }

  render();
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-abc-farecalc-root]");
  if (root) mbtaInitCalculator(root);
});
