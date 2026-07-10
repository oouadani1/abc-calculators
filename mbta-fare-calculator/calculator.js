/* ============================================================
   ABC MBTA Fare / Monthly Pass Break-Even Calculator
   Split into three sections: CONFIG, CALC LOGIC, UI / RENDER.
   Depends on shared/utils/format.js being loaded first.
   ============================================================ */

/* ------------------------------------------------------------
   1. CONFIG
   The only section that should need editing when fares change.
   Every price below was pulled from mbta.com on 2026-07-10.
   RE-VERIFY ANNUALLY — MBTA fares typically change each July/August
   and commuter rail zone boundaries have shifted in past years.
   ------------------------------------------------------------ */
const MBTA_CONFIG = {
  // Source of truth for all fares below. Check this page first each year.
  fareSource: {
    url: "https://www.mbta.com/fares",
    lastVerified: "2026-07-10",
    note:
      "Zone/interzone table pulled from mbta.com/fares/commuter-rail-fares/zones " +
      "and mbta.com/fares/subway-fares. A temporary summer promo (50% off CR " +
      "monthly passes, June-Aug 2026, excluding Zone 1A) is NOT reflected below " +
      "since it's not a permanent rate — flag to riders separately if relevant.",
  },

  // Perq (MBTA's pre-tax commuter benefit program) pricing impact.
  // MBTA's own Perq materials describe the discount as "roughly equal to
  // your tax rate, typically around 30%" but do not publish an exact
  // official percentage — this is a user-adjustable estimate, not a fact.
  perq: {
    defaultSavingsRate: 0.30, // 30% — MBTA Perq page's own "typical" figure
    source: "https://www.mbta.com/pass-program/perq/perq-employers",
    disclaimer:
      "Perq pre-tax savings approximate your marginal income tax rate. " +
      "MBTA cites ~30% as typical but does not guarantee an exact percentage " +
      "— adjust to match your own tax bracket for a more accurate estimate.",
  },

  // Employer subsidy quick-select presets (in addition to free-entry 0-100%).
  subsidyPresets: [0, 25, 50, 75, 100],

  // Default assumed one-way trips/month for a hybrid (part-week) commuter.
  defaultTripsPerMonth: 20,

  // Pass options: id, display label, one-way cash fare, full monthly pass price.
  // Zone 1A and LinkPass are both $90 as of this pricing period — that's a
  // real coincidence in current MBTA fares, not a bug.
  passOptions: [
    { id: "linkpass", label: "LinkPass (Subway / Local Bus / Silver Line)", oneWayFare: 2.40, monthlyPrice: 90.00 },
    { id: "cr-zone-1a", label: "Commuter Rail \u2014 Zone 1A", oneWayFare: 2.40, monthlyPrice: 90.00 },
    { id: "cr-zone-1", label: "Commuter Rail \u2014 Zone 1", oneWayFare: 6.50, monthlyPrice: 214.00 },
    { id: "cr-zone-2", label: "Commuter Rail \u2014 Zone 2", oneWayFare: 7.00, monthlyPrice: 232.00 },
    { id: "cr-zone-3", label: "Commuter Rail \u2014 Zone 3", oneWayFare: 8.00, monthlyPrice: 261.00 },
    { id: "cr-zone-4", label: "Commuter Rail \u2014 Zone 4", oneWayFare: 8.75, monthlyPrice: 281.00 },
    { id: "cr-zone-5", label: "Commuter Rail \u2014 Zone 5", oneWayFare: 9.75, monthlyPrice: 311.00 },
    { id: "cr-zone-6", label: "Commuter Rail \u2014 Zone 6", oneWayFare: 10.50, monthlyPrice: 340.00 },
    { id: "cr-zone-7", label: "Commuter Rail \u2014 Zone 7", oneWayFare: 11.00, monthlyPrice: 360.00 },
    { id: "cr-zone-8", label: "Commuter Rail \u2014 Zone 8", oneWayFare: 12.25, monthlyPrice: 388.00 },
    { id: "cr-zone-9", label: "Commuter Rail \u2014 Zone 9", oneWayFare: 12.75, monthlyPrice: 406.00 },
    { id: "cr-zone-10", label: "Commuter Rail \u2014 Zone 10", oneWayFare: 13.25, monthlyPrice: 426.00 },
    { id: "cr-interzone-1", label: "Commuter Rail \u2014 Interzone 1", oneWayFare: 2.75, monthlyPrice: 90.00 },
    { id: "cr-interzone-2", label: "Commuter Rail \u2014 Interzone 2", oneWayFare: 3.25, monthlyPrice: 110.00 },
    { id: "cr-interzone-3", label: "Commuter Rail \u2014 Interzone 3", oneWayFare: 3.50, monthlyPrice: 120.00 },
    { id: "cr-interzone-4", label: "Commuter Rail \u2014 Interzone 4", oneWayFare: 4.25, monthlyPrice: 139.00 },
    { id: "cr-interzone-5", label: "Commuter Rail \u2014 Interzone 5", oneWayFare: 4.75, monthlyPrice: 158.00 },
    { id: "cr-interzone-6", label: "Commuter Rail \u2014 Interzone 6", oneWayFare: 5.25, monthlyPrice: 178.00 },
    { id: "cr-interzone-7", label: "Commuter Rail \u2014 Interzone 7", oneWayFare: 5.75, monthlyPrice: 196.00 },
    { id: "cr-interzone-8", label: "Commuter Rail \u2014 Interzone 8", oneWayFare: 6.25, monthlyPrice: 216.00 },
    { id: "cr-interzone-9", label: "Commuter Rail \u2014 Interzone 9", oneWayFare: 6.75, monthlyPrice: 237.00 },
    { id: "cr-interzone-10", label: "Commuter Rail \u2014 Interzone 10", oneWayFare: 7.25, monthlyPrice: 257.00 },
  ],
};

/* ------------------------------------------------------------
   2. CALC LOGIC
   Pure functions: config + inputs in, numbers out. No DOM access.

   Modeling assumption (documented because it drives the whole tool):
   employer subsidy and Perq pre-tax savings apply ONLY to the monthly
   pass purchase, matching how Perq is actually sold (subsidized/pre-tax
   passes, not per-ride stored value). Pay-per-ride fares are assumed
   paid out of pocket at full post-tax price. This is what makes subsidy
   and pre-tax status change the break-even point, per the tool's brief.
   ------------------------------------------------------------ */

function mbtaGetPassOption(config, passId) {
  return config.passOptions.find((p) => p.id === passId);
}

/** Employee's out-of-pocket monthly cost for the pass after employer subsidy. */
function mbtaCalcSubsidizedCost(monthlyPrice, subsidyPct) {
  return monthlyPrice * (1 - subsidyPct / 100);
}

/** Effective real cost after also applying Perq pre-tax savings, if enabled. */
function mbtaCalcEffectivePassCost(monthlyPrice, subsidyPct, pretaxOn, perqSavingsPct) {
  const afterSubsidy = mbtaCalcSubsidizedCost(monthlyPrice, subsidyPct);
  if (!pretaxOn) return afterSubsidy;
  return afterSubsidy * (1 - perqSavingsPct / 100);
}

/** Total pay-per-ride cost for a given number of one-way trips, full fare. */
function mbtaCalcPayPerRideCost(oneWayFare, trips) {
  return oneWayFare * trips;
}

/** Break-even one-way trip count: trips at which pass cost == pay-per-ride cost. */
function mbtaCalcBreakEvenOneWayTrips(effectivePassCost, oneWayFare) {
  if (oneWayFare <= 0) return 0;
  return abcRoundUp(effectivePassCost / oneWayFare);
}

function mbtaCalcBreakEvenRoundTrips(breakEvenOneWayTrips) {
  return abcRoundUp(breakEvenOneWayTrips / 2);
}

/** Bundles every derived number the UI needs for one pass option + inputs. */
function mbtaCalcAll(config, passId, subsidyPct, pretaxOn, perqSavingsPct, tripsPerMonth) {
  const pass = mbtaGetPassOption(config, passId);
  const afterSubsidy = mbtaCalcSubsidizedCost(pass.monthlyPrice, subsidyPct);
  const effectivePassCost = mbtaCalcEffectivePassCost(
    pass.monthlyPrice,
    subsidyPct,
    pretaxOn,
    perqSavingsPct
  );
  const payPerRideCost = mbtaCalcPayPerRideCost(pass.oneWayFare, tripsPerMonth);
  const breakEvenOneWayTrips = mbtaCalcBreakEvenOneWayTrips(effectivePassCost, pass.oneWayFare);
  const breakEvenRoundTrips = mbtaCalcBreakEvenRoundTrips(breakEvenOneWayTrips);

  return {
    pass,
    subsidyDollarSavings: pass.monthlyPrice - afterSubsidy,
    pretaxDollarSavings: pretaxOn ? afterSubsidy - effectivePassCost : 0,
    effectivePassCost,
    payPerRideCost,
    breakEvenOneWayTrips,
    breakEvenRoundTrips,
    passWins: effectivePassCost < payPerRideCost,
  };
}

/* ------------------------------------------------------------
   3. UI / RENDER
   Reads form inputs, calls CALC LOGIC, writes results to the DOM.
   No math happens in this section.
   ------------------------------------------------------------ */

function mbtaInitCalculator(rootEl) {
  const passSelect = rootEl.querySelector("[data-abc-pass-select]");
  const tripsInput = rootEl.querySelector("[data-abc-trips-input]");
  const subsidyInput = rootEl.querySelector("[data-abc-subsidy-input]");
  const subsidyPresetButtons = rootEl.querySelectorAll("[data-abc-subsidy-preset]");
  const pretaxToggle = rootEl.querySelector("[data-abc-pretax-toggle]");
  const perqRateInput = rootEl.querySelector("[data-abc-perq-rate]");
  const perqRateRow = rootEl.querySelector("[data-abc-perq-rate-row]");

  // Populate pass dropdown from config
  MBTA_CONFIG.passOptions.forEach((pass) => {
    const opt = document.createElement("option");
    opt.value = pass.id;
    opt.textContent = pass.label;
    passSelect.appendChild(opt);
  });

  function syncSubsidyPresetButtons() {
    const current = Number(subsidyInput.value);
    subsidyPresetButtons.forEach((btn) => {
      btn.classList.toggle("abc-active", Number(btn.dataset.abcSubsidyPreset) === current);
    });
  }

  function render() {
    const passId = passSelect.value;
    const trips = Math.max(0, Number(tripsInput.value) || 0);
    const subsidyPct = Math.min(100, Math.max(0, Number(subsidyInput.value) || 0));
    const pretaxOn = pretaxToggle.checked;
    const perqRate = Math.min(100, Math.max(0, Number(perqRateInput.value) || 0));

    perqRateRow.style.display = pretaxOn ? "flex" : "none";

    const result = mbtaCalcAll(MBTA_CONFIG, passId, subsidyPct, pretaxOn, perqRate, trips);

    const passCard = rootEl.querySelector("[data-abc-card-pass]");
    const rideCard = rootEl.querySelector("[data-abc-card-ride]");
    passCard.classList.toggle("abc-card-winner", result.passWins);
    rideCard.classList.toggle("abc-card-winner", !result.passWins);
    passCard.querySelector("[data-abc-badge]").style.visibility = result.passWins ? "visible" : "hidden";
    rideCard.querySelector("[data-abc-badge]").style.visibility = !result.passWins ? "visible" : "hidden";

    rootEl.querySelector("[data-abc-pass-figure]").textContent = abcFormatCurrency(result.effectivePassCost);
    rootEl.querySelector("[data-abc-pass-sticker]").textContent =
      `Sticker price ${abcFormatCurrencyWhole(result.pass.monthlyPrice)}/month`;
    rootEl.querySelector("[data-abc-pass-subsidy-line]").textContent =
      subsidyPct > 0 ? `Employer subsidy (${subsidyPct}%) saves ${abcFormatCurrency(result.subsidyDollarSavings)}` : "No employer subsidy applied";
    rootEl.querySelector("[data-abc-pass-pretax-line]").textContent = pretaxOn
      ? `Perq pre-tax (${perqRate}%) saves an additional ${abcFormatCurrency(result.pretaxDollarSavings)}`
      : "Pre-tax purchase not applied";

    rootEl.querySelector("[data-abc-ride-figure]").textContent = abcFormatCurrency(result.payPerRideCost);
    rootEl.querySelector("[data-abc-ride-sticker]").textContent =
      `${abcFormatCurrency(result.pass.oneWayFare)} per one-way trip \u00D7 ${abcFormatNumber(trips)} trips/month`;

    const takeawayEl = rootEl.querySelector("[data-abc-takeaway]");
    const diff = Math.abs(result.effectivePassCost - result.payPerRideCost);
    if (result.passWins) {
      takeawayEl.textContent =
        `The pass wins at your estimated ${abcFormatNumber(trips)} trips/month \u2014 saving you about ` +
        `${abcFormatCurrency(diff)}/month versus paying per ride. Break-even is ` +
        `${abcFormatNumber(result.breakEvenOneWayTrips)} one-way trips (${abcFormatNumber(result.breakEvenRoundTrips)} round trips) per month.`;
    } else {
      takeawayEl.textContent =
        `Paying per ride wins at your estimated ${abcFormatNumber(trips)} trips/month \u2014 saving you about ` +
        `${abcFormatCurrency(diff)}/month versus the pass. You'd need at least ` +
        `${abcFormatNumber(result.breakEvenOneWayTrips)} one-way trips (${abcFormatNumber(result.breakEvenRoundTrips)} round trips) per month ` +
        `for the pass to pay off.`;
    }

    syncSubsidyPresetButtons();
  }

  passSelect.addEventListener("change", render);
  tripsInput.addEventListener("input", render);
  subsidyInput.addEventListener("input", render);
  pretaxToggle.addEventListener("change", render);
  perqRateInput.addEventListener("input", render);
  subsidyPresetButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      subsidyInput.value = btn.dataset.abcSubsidyPreset;
      render();
    });
  });

  render();
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-abc-farecalc-root]");
  if (root) mbtaInitCalculator(root);
});
