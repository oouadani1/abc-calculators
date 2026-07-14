/* ============================================================
   ABC MBTA Fare / Monthly Pass Break-Even Calculator
   Split into three sections: CONFIG, CALC LOGIC, UI / RENDER.
   Depends on shared/utils/format.js being loaded first.

   Architecture note: this tool now mirrors Jawnt's own comparison-card
   pattern (the original design reference from the project brief) rather
   than ABC's older single-panel Calconic tool. That means trip frequency
   IS an input again — asked as "days per week you commute" rather than
   raw one-way trips — because a real side-by-side dollar comparison
   needs usage data; you can't compare two totals without it.
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

  weeksPerMonth: 4.345,
  daysPerWeekOptions: [1, 2, 3, 4, 5],
  defaultDaysPerWeek: 3,

  // Subsidy and pre-tax (Perq) are both modeled the same way, applied to
  // BOTH the pass and pay-per-ride totals — matching how Jawnt's own tool
  // treats these benefits (they're transit-benefit-account features, not
  // pass-specific ones), not the pass-only assumption used previously.
  subsidyStepPct: 5,
  defaultSubsidyPct: 0,
  perqStepPct: 5,
  defaultPerqPct: 0,

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

/** Total monthly pay-per-ride cost at a given commute frequency, full fare. */
function mbtaCalcPayPerRideTotal(oneWayFare, daysPerWeek, weeksPerMonth) {
  return oneWayFare * 2 * daysPerWeek * weeksPerMonth;
}

/** Applies subsidy, then pre-tax savings, to any monthly total. Returns each step. */
function mbtaCalcBreakdown(total, subsidyPct, perqPct) {
  const subsidyAmt = total * (subsidyPct / 100);
  const afterSubsidy = total - subsidyAmt;
  const pretaxAmt = afterSubsidy * (perqPct / 100);
  const finalCost = afterSubsidy - pretaxAmt;
  return { total, subsidyAmt, afterSubsidy, pretaxAmt, finalCost };
}

/** Bundles every derived number the UI needs for both options + inputs. */
function mbtaCalcAll(config, passId, daysPerWeek, subsidyPct, perqPct) {
  const pass = mbtaGetPassOption(config, passId);
  const rideTotal = mbtaCalcPayPerRideTotal(pass.oneWayFare, daysPerWeek, config.weeksPerMonth);

  const passBreakdown = mbtaCalcBreakdown(pass.monthlyPrice, subsidyPct, perqPct);
  const rideBreakdown = mbtaCalcBreakdown(rideTotal, subsidyPct, perqPct);

  const winner = passBreakdown.finalCost <= rideBreakdown.finalCost ? "pass" : "ride";
  const monthlyDiff = Math.abs(passBreakdown.finalCost - rideBreakdown.finalCost);

  return {
    pass,
    passBreakdown,
    rideBreakdown,
    winner,
    annualSavings: monthlyDiff * 12,
  };
}

/* ------------------------------------------------------------
   3. UI / RENDER
   Reads form inputs, calls CALC LOGIC, writes results to the DOM.
   No math happens in this section. Single live-updating view —
   no steps, no submit button.
   ------------------------------------------------------------ */

function mbtaInitCalculator(rootEl) {
  let routeType = "subway"; // "subway" | "rail"
  let daysPerWeek = MBTA_CONFIG.defaultDaysPerWeek;
  let subsidyPct = MBTA_CONFIG.defaultSubsidyPct;
  let perqPct = MBTA_CONFIG.defaultPerqPct;

  const routeButtons = rootEl.querySelectorAll("[data-abc-route-select]");
  const railZoneField = rootEl.querySelector("[data-abc-rail-zone-field]");
  const railZoneSelect = rootEl.querySelector("[data-abc-rail-zone-select]");
  const dayButtons = rootEl.querySelectorAll("[data-abc-day-select]");

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
      rootEl.classList.toggle("abc-theme-rail", routeType === "rail");
      render();
    });
  });

  dayButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      daysPerWeek = Number(btn.dataset.abcDaySelect);
      dayButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      render();
    });
  });

  railZoneSelect.addEventListener("change", render);

  // Generic stepper wiring: works for both the subsidy and pre-tax controls.
  function initStepper(rootAttr, step, getValue, setValue) {
    const stepperEl = rootEl.querySelector(`[${rootAttr}]`);
    const valueEl = stepperEl.querySelector("[data-abc-stepper-value]");
    const minusBtn = stepperEl.querySelector("[data-abc-stepper-minus]");
    const plusBtn = stepperEl.querySelector("[data-abc-stepper-plus]");

    function paint() {
      valueEl.textContent = getValue();
    }
    minusBtn.addEventListener("click", () => {
      setValue(Math.max(0, getValue() - step));
      paint();
      render();
    });
    plusBtn.addEventListener("click", () => {
      setValue(Math.min(100, getValue() + step));
      paint();
      render();
    });
    paint();
  }

  initStepper(
    "data-abc-subsidy-stepper",
    MBTA_CONFIG.subsidyStepPct,
    () => subsidyPct,
    (v) => { subsidyPct = v; }
  );
  initStepper(
    "data-abc-perq-stepper",
    MBTA_CONFIG.perqStepPct,
    () => perqPct,
    (v) => { perqPct = v; }
  );

  function paintCard(prefix, breakdown, subsidyPctVal, perqPctVal) {
    rootEl.querySelector(`[data-abc-${prefix}-total]`).textContent = abcFormatCurrency(breakdown.total);
    rootEl.querySelector(`[data-abc-${prefix}-subsidy-label]`).textContent = `Employer subsidy (${subsidyPctVal}%)`;
    rootEl.querySelector(`[data-abc-${prefix}-subsidy-amt]`).textContent = subsidyPctVal > 0 ? `-${abcFormatCurrency(breakdown.subsidyAmt)}` : abcFormatCurrency(0);
    rootEl.querySelector(`[data-abc-${prefix}-pretax-row]`).style.display = perqPctVal > 0 ? "flex" : "none";
    rootEl.querySelector(`[data-abc-${prefix}-pretax-label]`).textContent = `Pre-tax savings (${perqPctVal}%)`;
    rootEl.querySelector(`[data-abc-${prefix}-pretax-amt]`).textContent = `-${abcFormatCurrency(breakdown.pretaxAmt)}`;
    rootEl.querySelector(`[data-abc-${prefix}-final]`).textContent = abcFormatCurrency(breakdown.finalCost);
  }

  function render() {
    const result = mbtaCalcAll(MBTA_CONFIG, currentPassId(), daysPerWeek, subsidyPct, perqPct);

    paintCard("ride", result.rideBreakdown, subsidyPct, perqPct);
    paintCard("pass", result.passBreakdown, subsidyPct, perqPct);

    const rideCard = rootEl.querySelector("[data-abc-card-ride]");
    const passCard = rootEl.querySelector("[data-abc-card-pass]");
    rideCard.classList.toggle("abc-card-winner", result.winner === "ride");
    passCard.classList.toggle("abc-card-winner", result.winner === "pass");
    rideCard.querySelector("[data-abc-badge]").style.visibility = result.winner === "ride" ? "visible" : "hidden";
    passCard.querySelector("[data-abc-badge]").style.visibility = result.winner === "pass" ? "visible" : "hidden";

    const winnerCard = result.winner === "ride" ? rideCard : passCard;
    const loserCard = result.winner === "ride" ? passCard : rideCard;
    winnerCard.querySelector("[data-abc-savings-line]").style.display = result.annualSavings > 0.5 ? "block" : "none";
    winnerCard.querySelector("[data-abc-savings-amt]").textContent = abcFormatCurrency(result.annualSavings);
    loserCard.querySelector("[data-abc-savings-line]").style.display = "none";
  }

  render();
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-abc-farecalc-root]");
  if (root) mbtaInitCalculator(root);
});
