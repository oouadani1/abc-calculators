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
      "membership is a separate, higher $133.50/year — don't confuse the two).",
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
  // $101.50 corporate per-signup rate.
  tiers: [
    {
      id: "gold",
      label: "Gold",
      subsidyPct: 100,
      employerAnnualCost: 101.50,
      employeeAnnualCost: 0,
      tentative: false,
    },
    {
      id: "silver",
      label: "Silver",
      subsidyPct: 50,
      employerAnnualCost: 50.75,
      employeeAnnualCost: 50.75,
      tentative: false,
    },
    {
      id: "bronze",
      label: "Bronze",
      subsidyPct: 25.6, // 26 / 101.50 — not currently a live Bluebikes tier
      employerAnnualCost: 26.00,
      employeeAnnualCost: 75.50,
      tentative: true, // NOT on Bluebikes' live corporate page as of 2026-07-10.
      tentativeNote:
        "Pending internal confirmation \u2014 verify with corporateaccounts@bluebikes.com " +
        "or your existing contract before using in published materials.",
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
   No math happens in this section.
   ------------------------------------------------------------ */

function bikeInitCalculator(rootEl) {
  const employeeInput = rootEl.querySelector("[data-abc-employee-input]");
  const overageInput = rootEl.querySelector("[data-abc-overage-input]");
  const tierButtons = rootEl.querySelectorAll("[data-abc-tier-select]");
  const cardsContainer = rootEl.querySelector("[data-abc-cards-container]");

  let selectedTierId = "gold";

  // Build one card per config tier (so adding/removing a tier next year
  // doesn't require touching this file's HTML/JS, only CONFIG).
  BIKE_CONFIG.tiers.forEach((tier) => {
    const card = document.createElement("div");
    card.className = "abc-card";
    card.dataset.abcTierCard = tier.id;
    card.innerHTML = `
      <span class="abc-badge" data-abc-badge style="visibility: hidden;">Selected</span>
      <h3>${tier.label}${tier.tentative ? ' <span class="abc-bikecalc-tentative-flag">(tentative)</span>' : ""}</h3>
      <div class="abc-card-figure" data-abc-employer-figure>$0</div>
      <div class="abc-card-sub" data-abc-employer-sub></div>
      <ul>
        <li data-abc-per-day-line></li>
        <li data-abc-member-line></li>
      </ul>
      ${tier.tentative ? `<p class="abc-bikecalc-tentative-note">${tier.tentativeNote}</p>` : ""}
    `;
    cardsContainer.appendChild(card);
  });

  function render() {
    const employeeCount = Math.max(0, Number(employeeInput.value) || 0);
    const overageMinutes = Math.max(0, Number(overageInput.value) || 0);

    tierButtons.forEach((btn) => {
      btn.classList.toggle("abc-active", btn.dataset.abcTierSelect === selectedTierId);
    });

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
        `${abcFormatCurrency(result.employerMonthlyCost)}/month for ${abcFormatNumber(employeeCount)} employees`;
      card.querySelector("[data-abc-per-day-line]").textContent =
        `${abcFormatCurrency(result.costPerEmployeePerDay)}/employee/day`;
      card.querySelector("[data-abc-member-line]").textContent =
        overageMinutes > 0
          ? `Employee pays ${abcFormatCurrency(result.memberAnnualCost)}/year (incl. est. overage)`
          : `Employee pays ${abcFormatCurrency(result.memberAnnualCost)}/year`;
    });

    const takeawayEl = rootEl.querySelector("[data-abc-takeaway]");
    const tier = selectedResult.tier;
    takeawayEl.textContent =
      `Enrolling ${abcFormatNumber(employeeCount)} employees at ${tier.label} (${tier.subsidyPct}% subsidy) costs your ` +
      `organization ${abcFormatCurrency(selectedResult.employerAnnualCost)}/year ` +
      `(${abcFormatCurrency(selectedResult.employerMonthlyCost)}/month), or about ` +
      `${abcFormatCurrency(selectedResult.costPerEmployeePerDay)}/employee/day. ` +
      (tier.employeeAnnualCost > 0
        ? `Employees pay ${abcFormatCurrency(tier.employeeAnnualCost)}/year toward membership themselves.`
        : `Employees pay $0 for membership access.`);

    overageInput.parentElement.querySelector(".abc-bikecalc-overage-hint").textContent =
      overageMinutes > 0
        ? `Adds ${abcFormatCurrency(bikeCalcMemberOverageCostPerMonth(overageMinutes, BIKE_CONFIG.overage.ratePerMinute))}/rider/month in overage, paid by the employee.`
        : `First ${BIKE_CONFIG.overage.includedMinutesPerRide} min/ride included; leave at 0 to ignore overage.`;
  }

  employeeInput.addEventListener("input", render);
  overageInput.addEventListener("input", render);
  tierButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedTierId = btn.dataset.abcTierSelect;
      render();
    });
  });

  render();
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-abc-bikecalc-root]");
  if (root) bikeInitCalculator(root);
});
