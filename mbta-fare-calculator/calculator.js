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
      "since it's not a permanent rate.",
  },

  // Perq (MBTA's pre-tax commuter benefit program) pricing impact.
  // MBTA's own Perq materials describe the discount as "roughly equal to
  // your tax rate, typically around 30%" but do not publish an exact
  // official percentage — this is a user-adjustable estimate, not a fact.
  perq: {
    defaultSavingsRate: 0.30, // 30% — MBTA Perq page's own "typical" figure
    source: "https://www.mbta.com/pass-program/perq/perq-employers",
  },

  // Employer subsidy presets, in plain language for the UI + the % each maps to.
  subsidyPresets: [
    { pct: 0, label: "No" },
    { pct: 25, label: "A little" },
    { pct: 50, label: "Half" },
    { pct: 75, label: "Most" },
    { pct: 100, label: "All of it" },
  ],

  defaultTripsPerMonth: 20,
  maxTripsPerMonth: 44, // ~5 round trips/week, generous slider ceiling

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

   Modeling assumption (documented because it drives the whole tool):
   employer subsidy and Perq pre-tax savings apply ONLY to the monthly
   pass purchase, matching how Perq is actually sold (subsidized/pre-tax
   passes, not per-ride stored value). Pay-per-ride fares are assumed
   paid out of pocket at full post-tax price. This is what makes subsidy
   and pre-tax status change the break-even point.
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

/** Friendly "about N days a week" estimate from one-way trips/month. Display only. */
function mbtaEstimateDaysPerWeek(oneWayTripsPerMonth) {
  const roundTripsPerWeek = oneWayTripsPerMonth / 2 / 4.345;
  return Math.round(roundTripsPerWeek * 2) / 2; // nearest half day
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
   No math happens in this section. Also owns the 3-step flow
   (state, progress dots, back/continue nav) so the form asks one
   plain question at a time instead of a dense wall of fields.
   ------------------------------------------------------------ */

function mbtaInitCalculator(rootEl) {
  const STEP_LABELS = ["How you get to work", "Employer perks", "Your answer"];
  let currentStep = 1;
  let routeType = "subway"; // "subway" | "rail"

  const routeButtons = rootEl.querySelectorAll("[data-abc-route-select]");
  const railZoneField = rootEl.querySelector("[data-abc-rail-zone-field]");
  const railZoneSelect = rootEl.querySelector("[data-abc-rail-zone-select]");

  const tripsSlider = rootEl.querySelector("[data-abc-trips-input]");
  const tripsValueEl = rootEl.querySelector("[data-abc-trips-value]");
  const tripsDaysHint = rootEl.querySelector("[data-abc-trips-days-hint]");

  const subsidyButtons = rootEl.querySelectorAll("[data-abc-subsidy-preset]");
  let subsidyPct = 0;

  const pretaxToggle = rootEl.querySelector("[data-abc-pretax-toggle]");
  const perqRateRow = rootEl.querySelector("[data-abc-perq-rate-row]");
  const perqRateSlider = rootEl.querySelector("[data-abc-perq-rate]");
  const perqRateValueEl = rootEl.querySelector("[data-abc-perq-rate-value]");

  const progressDots = rootEl.querySelectorAll("[data-abc-progress-dot]");
  const progressLabel = rootEl.querySelector("[data-abc-progress-label]");
  const steps = rootEl.querySelectorAll("[data-abc-step]");
  const editAnswersLink = rootEl.querySelector("[data-abc-edit-answers]");

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

  function goToStep(n) {
    currentStep = n;
    steps.forEach((stepEl) => {
      stepEl.classList.toggle("abc-step-active", Number(stepEl.dataset.abcStep) === n);
    });
    progressDots.forEach((dot, i) => {
      dot.classList.toggle("abc-dot-active", i === n - 1);
      dot.classList.toggle("abc-dot-done", i < n - 1);
    });
    progressLabel.textContent = `Step ${n} of ${steps.length} \u2014 ${STEP_LABELS[n - 1]}`;
    if (n === steps.length) render();
  }

  routeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      routeType = btn.dataset.abcRouteSelect;
      routeButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      railZoneField.style.display = routeType === "rail" ? "flex" : "none";
    });
  });

  function updateTripsDisplay() {
    const trips = Number(tripsSlider.value);
    tripsValueEl.textContent = abcFormatNumber(trips);
    const days = mbtaEstimateDaysPerWeek(trips);
    tripsDaysHint.textContent = days > 0 ? `about ${days} day${days === 1 ? "" : "s"} a week` : "not a regular commute";
  }
  tripsSlider.addEventListener("input", updateTripsDisplay);
  updateTripsDisplay();

  subsidyButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      subsidyPct = Number(btn.dataset.abcSubsidyPreset);
      subsidyButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
    });
  });

  function updatePerqRateDisplay() {
    perqRateValueEl.textContent = `${perqRateSlider.value}%`;
  }
  pretaxToggle.addEventListener("change", () => {
    perqRateRow.style.display = pretaxToggle.checked ? "flex" : "none";
  });
  perqRateSlider.addEventListener("input", updatePerqRateDisplay);
  updatePerqRateDisplay();

  rootEl.querySelectorAll("[data-abc-next]").forEach((btn) => {
    btn.addEventListener("click", () => goToStep(currentStep + 1));
  });
  rootEl.querySelectorAll("[data-abc-back]").forEach((btn) => {
    btn.addEventListener("click", () => goToStep(currentStep - 1));
  });
  editAnswersLink.addEventListener("click", () => goToStep(1));

  function render() {
    const trips = Number(tripsSlider.value);
    const pretaxOn = pretaxToggle.checked;
    const perqRate = Number(perqRateSlider.value);

    const result = mbtaCalcAll(MBTA_CONFIG, currentPassId(), subsidyPct, pretaxOn, perqRate, trips);

    const passCard = rootEl.querySelector("[data-abc-card-pass]");
    const rideCard = rootEl.querySelector("[data-abc-card-ride]");
    passCard.classList.toggle("abc-card-winner", result.passWins);
    rideCard.classList.toggle("abc-card-winner", !result.passWins);
    passCard.querySelector("[data-abc-badge]").style.visibility = result.passWins ? "visible" : "hidden";
    rideCard.querySelector("[data-abc-badge]").style.visibility = !result.passWins ? "visible" : "hidden";

    rootEl.querySelector("[data-abc-pass-figure]").textContent = abcFormatCurrency(result.effectivePassCost);
    rootEl.querySelector("[data-abc-pass-sticker]").textContent =
      `Full price is ${abcFormatCurrencyWhole(result.pass.monthlyPrice)}/month`;
    rootEl.querySelector("[data-abc-pass-subsidy-line]").textContent =
      subsidyPct > 0 ? `Your employer covers ${abcFormatCurrency(result.subsidyDollarSavings)} of that` : "Your employer isn't covering any of this";
    rootEl.querySelector("[data-abc-pass-pretax-line]").textContent = pretaxOn
      ? `Buying pre-tax saves you about ${abcFormatCurrency(result.pretaxDollarSavings)} more`
      : "You're not buying this pre-tax";

    rootEl.querySelector("[data-abc-ride-figure]").textContent = abcFormatCurrency(result.payPerRideCost);
    rootEl.querySelector("[data-abc-ride-sticker]").textContent =
      `${abcFormatCurrency(result.pass.oneWayFare)} a ride \u00D7 ${abcFormatNumber(trips)} rides a month`;

    const takeawayEl = rootEl.querySelector("[data-abc-takeaway]");
    const diff = Math.abs(result.effectivePassCost - result.payPerRideCost);
    if (trips === 0) {
      takeawayEl.textContent = "You told us you're not taking any trips this month, so paying as you go costs nothing \u2014 the pass isn't worth it unless your commute picks up.";
    } else if (result.passWins) {
      takeawayEl.textContent =
        `Get the pass. At ${abcFormatNumber(trips)} rides a month, it saves you about ` +
        `${abcFormatCurrency(diff)} compared to paying per ride.`;
    } else {
      takeawayEl.textContent =
        `Stick with paying per ride for now \u2014 it's about ${abcFormatCurrency(diff)} cheaper at your pace. ` +
        `If you get to ${abcFormatNumber(result.breakEvenOneWayTrips)} one-way trips ` +
        `(${abcFormatNumber(result.breakEvenRoundTrips)} round trips) a month, the pass starts to pay off.`;
    }
  }

  goToStep(1);
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-abc-farecalc-root]");
  if (root) mbtaInitCalculator(root);
});
