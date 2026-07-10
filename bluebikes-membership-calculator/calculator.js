/* ============================================================
   ABC Bluebikes Corporate Membership Calculator
   Split into three sections: CONFIG, CALC LOGIC, UI / RENDER.
   Depends on shared/utils/format.js being loaded first.
   ============================================================ */

/* ------------------------------------------------------------
   1. CONFIG
   The only section that should need editing when Bluebikes pricing
   or tier structure changes. Every price below was pulled from
   bluebikes.com on 2026-07-10 UNLESS marked tentative.
   RE-VERIFY ANNUALLY, and before launch confirm the Bronze tier
   with corporateaccounts@bluebikes.com or your existing contract.
   ------------------------------------------------------------ */
const BIKE_CONFIG = {
  pricingSource: {
    url: "https://bluebikes.com/pricing/corporate-membership",
    lastVerified: "2026-07-10",
    note:
      "Gold and Silver figures confirmed live on bluebikes.com. The corporate " +
      "per-signup rate is $101.50/employee/year (individual retail annual " +
      "membership is a separate, higher $133.50/year, not used here).",
  },

  // First 45 minutes of each classic-bike ride are included in membership;
  // additional minutes billed at $0.10/min. Modeled here as always borne by
  // the rider/employee, not the employer — corporate membership covers
  // annual access only, not per-ride overage. Confirm this assumption if
  // your contract differs.
  overage: {
    includedMinutesPerRide: 45,
    ratePerMinute: 0.10,
  },

  // Subsidy tiers. employerAnnualCost + employeeAnnualCost always sum to the
  // $101.50 corporate per-signup rate. "blurb" is the plain-language framing
  // shown on each card instead of a raw percentage.
  tiers: [
    {
      id: "gold",
      label: "Gold",
      blurb: "We cover it all",
      subsidyPct: 100,
      employerAnnualCost: 101.50,
      employeeAnnualCost: 0,
      tentative: false,
    },
    {
      id: "silver",
      label: "Silver",
      blurb: "We split it",
      subsidyPct: 50,
      employerAnnualCost: 50.75,
      employeeAnnualCost: 50.75,
      tentative: false,
    },
    {
      id: "bronze",
      label: "Bronze",
      blurb: "We help a little",
      subsidyPct: 25.6, // 26 / 101.50 — not currently a live Bluebikes tier
      employerAnnualCost: 26.00,
      employeeAnnualCost: 75.50,
      tentative: true, // NOT on Bluebikes' live corporate page as of 2026-07-10.
      tentativeNote:
        "We're still confirming this option with Bluebikes \u2014 don't rely on " +
        "this number publicly yet.",
    },
  ],

  defaultEmployeeCount: 50,
};

/* ------------------------------------------------------------
   2. CALC LOGIC
   Pure functions: config + inputs in, numbers out. No DOM access.
   ------------------------------------------------------------ */

function bikeGetTier(config, tierId) {
  return config.tiers.find((t) => t.id === tierId);
}

function bikeCalcEmployerAnnualCost(tier, employeeCount) {
  return tier.employerAnnualCost * employeeCount;
}

function bikeCalcEmployerMonthlyCost(tier, employeeCount) {
  return bikeCalcEmployerAnnualCost(tier, employeeCount) / 12;
}

/** Marketing-comparable "$X.XX per employee per day" figure. */
function bikeCalcCostPerEmployeePerDay(tier) {
  return tier.employerAnnualCost / 365;
}

function bikeCalcMemberOverageCostPerMonth(overageMinutesPerMonth, ratePerMinute) {
  return Math.max(0, overageMinutesPerMonth) * ratePerMinute;
}

function bikeCalcMemberAnnualCost(tier, overageMinutesPerMonth, ratePerMinute) {
  return tier.employeeAnnualCost + bikeCalcMemberOverageCostPerMonth(overageMinutesPerMonth, ratePerMinute) * 12;
}

/** Bundles every derived number the UI needs for one tier + inputs. */
function bikeCalcAll(config, tierId, employeeCount, overageMinutesPerMonth) {
  const tier = bikeGetTier(config, tierId);
  return {
    tier,
    employerAnnualCost: bikeCalcEmployerAnnualCost(tier, employeeCount),
    employerMonthlyCost: bikeCalcEmployerMonthlyCost(tier, employeeCount),
    costPerEmployeePerDay: bikeCalcCostPerEmployeePerDay(tier),
    memberAnnualCost: bikeCalcMemberAnnualCost(tier, overageMinutesPerMonth, config.overage.ratePerMinute),
    memberMonthlyOverageCost: bikeCalcMemberOverageCostPerMonth(overageMinutesPerMonth, config.overage.ratePerMinute),
  };
}

/* ------------------------------------------------------------
   3. UI / RENDER
   Reads form inputs, calls CALC LOGIC, writes results to the DOM.
   No math happens in this section. Owns a light 2-step flow: how
   many people, then compare tiers (tap a card to pick it — no
   separate selector row needed).
   ------------------------------------------------------------ */

function bikeInitCalculator(rootEl) {
  const STEP_LABELS = ["Your team", "Compare your options"];
  let currentStep = 1;
  let selectedTierId = "gold";

  const employeeSlider = rootEl.querySelector("[data-abc-employee-input]");
  const employeeValueEl = rootEl.querySelector("[data-abc-employee-value]");
  const overageInput = rootEl.querySelector("[data-abc-overage-input]");
  const overageHintEl = rootEl.querySelector("[data-abc-overage-hint]");
  const cardsContainer = rootEl.querySelector("[data-abc-cards-container]");

  const progressDots = rootEl.querySelectorAll("[data-abc-progress-dot]");
  const progressLabel = rootEl.querySelector("[data-abc-progress-label]");
  const steps = rootEl.querySelectorAll("[data-abc-step]");
  const editAnswersLink = rootEl.querySelector("[data-abc-edit-answers]");

  // Build one card per config tier (so adding/removing a tier next year
  // doesn't require touching this file's HTML/JS, only CONFIG).
  BIKE_CONFIG.tiers.forEach((tier) => {
    const card = document.createElement("div");
    card.className = "abc-card abc-bikecalc-card";
    card.dataset.abcTierCard = tier.id;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.innerHTML = `
      <span class="abc-badge" data-abc-badge style="visibility: hidden;">Selected</span>
      <h3>${tier.label}${tier.tentative ? '<span class="abc-tag-caution">Not confirmed</span>' : ""}</h3>
      <div class="abc-card-sub abc-bikecalc-blurb">${tier.blurb}</div>
      <div class="abc-card-figure" data-abc-employer-figure>$0</div>
      <div class="abc-card-sub" data-abc-employer-sub></div>
      <ul>
        <li data-abc-per-day-line></li>
        <li data-abc-member-line></li>
      </ul>
      ${tier.tentative ? `<p class="abc-caution-note">${tier.tentativeNote}</p>` : ""}
    `;
    card.addEventListener("click", () => {
      selectedTierId = tier.id;
      render();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectedTierId = tier.id;
        render();
      }
    });
    cardsContainer.appendChild(card);
  });

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

  rootEl.querySelectorAll("[data-abc-next]").forEach((btn) => {
    btn.addEventListener("click", () => goToStep(currentStep + 1));
  });
  editAnswersLink.addEventListener("click", () => goToStep(1));

  function updateEmployeeDisplay() {
    employeeValueEl.textContent = abcFormatNumber(Number(employeeSlider.value));
  }
  employeeSlider.addEventListener("input", updateEmployeeDisplay);
  updateEmployeeDisplay();

  function render() {
    const employeeCount = Math.max(0, Number(employeeSlider.value) || 0);
    const overageMinutes = Math.max(0, Number(overageInput.value) || 0);

    let selectedResult = null;

    BIKE_CONFIG.tiers.forEach((tier) => {
      const result = bikeCalcAll(BIKE_CONFIG, tier.id, employeeCount, overageMinutes);
      if (tier.id === selectedTierId) selectedResult = result;

      const card = cardsContainer.querySelector(`[data-abc-tier-card="${tier.id}"]`);
      const isSelected = tier.id === selectedTierId;
      card.classList.toggle("abc-card-winner", isSelected);
      card.querySelector("[data-abc-badge]").style.visibility = isSelected ? "visible" : "hidden";

      card.querySelector("[data-abc-employer-figure]").textContent = abcFormatCurrency(result.employerAnnualCost);
      card.querySelector("[data-abc-employer-sub]").textContent =
        `${abcFormatCurrency(result.employerMonthlyCost)}/month for ${abcFormatNumber(employeeCount)} people`;
      card.querySelector("[data-abc-per-day-line]").textContent =
        `${abcFormatCurrency(result.costPerEmployeePerDay)} per person, per day`;
      card.querySelector("[data-abc-member-line]").textContent =
        overageMinutes > 0
          ? `They pay ${abcFormatCurrency(result.memberAnnualCost)}/year (with overage)`
          : `They pay ${abcFormatCurrency(result.memberAnnualCost)}/year`;
    });

    const takeawayEl = rootEl.querySelector("[data-abc-takeaway]");
    const tier = selectedResult.tier;
    if (employeeCount === 0) {
      takeawayEl.textContent = "Add at least one person to see what this would cost.";
    } else {
      takeawayEl.textContent =
        `Covering ${abcFormatNumber(employeeCount)} people at ${tier.label} runs your team ` +
        `${abcFormatCurrency(selectedResult.employerAnnualCost)} a year ` +
        `(${abcFormatCurrency(selectedResult.employerMonthlyCost)} a month) \u2014 about ` +
        `${abcFormatCurrency(selectedResult.costPerEmployeePerDay)} per person, per day. ` +
        (tier.employeeAnnualCost > 0
          ? `Everyone else chips in ${abcFormatCurrency(tier.employeeAnnualCost)} a year.`
          : `Nobody pays anything out of pocket.`);
    }

    overageHintEl.textContent =
      overageMinutes > 0
        ? `Adds ${abcFormatCurrency(bikeCalcMemberOverageCostPerMonth(overageMinutes, BIKE_CONFIG.overage.ratePerMinute))} a month per rider, paid by the rider.`
        : `Rides include the first ${BIKE_CONFIG.overage.includedMinutesPerRide} minutes free. Leave at 0 if that's usually enough.`;
  }

  overageInput.addEventListener("input", render);

  goToStep(1);
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-abc-bikecalc-root]");
  if (root) bikeInitCalculator(root);
});
