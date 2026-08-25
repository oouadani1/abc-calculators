/* ============================================================
   A Better City — Bluebikes Membership Calculator

   Two views: employer (pick a tier, enter a headcount, see what it
   costs your org) and individual (pick a tier, see what you'd personally
   pay/save, plus a nudge to ask your employer for it). Split into three
   sections: CONFIG, CALC LOGIC, UI / RENDER.
   Depends on shared/utils/format.js being loaded first.
   ============================================================ */

/* ------------------------------------------------------------
   1. CONFIG
   The only section that should need editing when Bluebikes pricing
   or tier structure changes. Every price below was pulled from
   bluebikes.com on 2026-08-25.
   RE-VERIFY ANNUALLY — Bluebikes has changed both the corporate rate
   and the retail Annual Membership price before.
   ------------------------------------------------------------ */
const BIKE_CONFIG = {
  pricingSource: {
    url: "https://bluebikes.com/pricing/corporate-membership",
    lastVerified: "2026-08-25",
    note:
      "Gold and Silver figures confirmed live on bluebikes.com/pricing/corporate-membership. " +
      "There is no Bronze tier; it was previously under discussion with Bluebikes but never " +
      "shipped, and is not offered. The $133.50 retail Annual Membership price (bluebikes.com/pricing) " +
      "is used only as the 'what an employee would otherwise pay' baseline for the savings figure.",
  },

  // What an individual pays for Bluebikes' standard Annual Membership with
  // no employer/group rate at all — the baseline the "you'd save" figure
  // is measured against.
  retailAnnualPrice: 133.50,

  // Both tiers split the same $101.50/person/year corporate group rate
  // differently. employerAnnualCost + employeeAnnualCost always sum to
  // that $101.50. Each tier has two blurb variants since the same fact
  // reads differently depending on who's looking at it.
  tiers: [
    {
      id: "gold",
      label: "Gold",
      employerBlurb: "you cover the full membership",
      individualBlurb: "your employer covers the full membership",
      employerAnnualCost: 101.50,
      employeeAnnualCost: 0,
    },
    {
      id: "silver",
      label: "Silver",
      employerBlurb: "you split it evenly",
      individualBlurb: "you split it evenly with your employer",
      employerAnnualCost: 50.75,
      employeeAnnualCost: 50.75,
    },
  ],

  employeeCountStep: 5,
  employeeCountMax: 100000,
  defaultEmployeeCount: 25,

  // Bluebikes' separate Bulk Passes program (short-term/monthly passes,
  // not a discount on Gold/Silver) starts offering volume pricing at 100
  // passes. Surfaced as an informational nudge once headcount crosses
  // that line, not folded into the Gold/Silver math above.
  // Source: https://bluebikes.com/pricing/corporate-membership/corporate-program/bulk-passes
  bulkPasses: {
    threshold: 100,
    url: "https://bluebikes.com/pricing/corporate-membership/corporate-program/bulk-passes",
  },
};

/* ------------------------------------------------------------
   2. CALC LOGIC
   Pure functions: config + inputs in, numbers out. No DOM access.
   ------------------------------------------------------------ */

function bikeGetTier(config, tierId) {
  return config.tiers.find((t) => t.id === tierId);
}

/** Employer view: cost of covering a headcount at a given tier, plus what
 * each employee saves versus paying full retail for their own membership. */
function bikeCalcEmployer(config, tierId, employeeCount) {
  const tier = bikeGetTier(config, tierId);
  const employerAnnualCost = tier.employerAnnualCost * employeeCount;
  const employerMonthlyCost = employerAnnualCost / 12;
  const employeeSavesAnnual = config.retailAnnualPrice - tier.employeeAnnualCost;
  return {
    tier,
    employerAnnualCost,
    employerMonthlyCost,
    employeeSavesAnnual,
    employeeStillPays: tier.employeeAnnualCost,
  };
}

/** Individual view: what one person would pay and save under a tier,
 * regardless of how many coworkers are also covered. */
function bikeCalcIndividual(config, tierId) {
  const tier = bikeGetTier(config, tierId);
  return {
    tier,
    youPay: tier.employeeAnnualCost,
    youSave: config.retailAnnualPrice - tier.employeeAnnualCost,
  };
}

/* ------------------------------------------------------------
   3. UI / RENDER
   Reads form inputs, calls CALC LOGIC, writes results to the DOM.
   No math happens in this section. Single live-updating view —
   no steps, no submit button.
   ------------------------------------------------------------ */

function bikeInitCalculator(rootEl) {
  let mode = "employer"; // "employer" | "individual"
  let tierId = "gold";
  let employeeCount = BIKE_CONFIG.defaultEmployeeCount;

  // Employer / individual toggle: swaps copy and which results card shows,
  // same [data-mode-only] pattern as the MBTA/Commuter Rail tools.
  const modeButtons = rootEl.querySelectorAll("[data-abc-mode-select]");
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.abcModeSelect;
      modeButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      rootEl.setAttribute("data-abc-mode", mode);
      render();
    });
  });

  // Gold / Silver toggle: same segmented-pill component, applies to
  // both modes.
  const tierButtons = rootEl.querySelectorAll("[data-abc-tier-select]");
  tierButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tierId = btn.dataset.abcTierSelect;
      tierButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      render();
    });
  });

  // Headcount stepper: same generic +/- pattern used across the other
  // tools' steppers. Typing a value updates live; +/- moves in fixed steps.
  const stepperEl = rootEl.querySelector("[data-abc-count-stepper]");
  const input = stepperEl.querySelector("[data-abc-stepper-value]");
  const minusBtn = stepperEl.querySelector("[data-abc-stepper-minus]");
  const plusBtn = stepperEl.querySelector("[data-abc-stepper-plus]");
  const min = 1;
  const max = BIKE_CONFIG.employeeCountMax;
  const step = BIKE_CONFIG.employeeCountStep;

  function paintStepper() {
    input.value = employeeCount;
  }
  minusBtn.addEventListener("click", () => {
    employeeCount = Math.max(min, employeeCount - step);
    paintStepper();
    render();
  });
  plusBtn.addEventListener("click", () => {
    employeeCount = Math.min(max, employeeCount + step);
    paintStepper();
    render();
  });
  input.addEventListener("input", () => {
    const raw = Number(input.value);
    if (!Number.isNaN(raw)) {
      employeeCount = Math.min(max, Math.max(min, raw));
      render();
    }
  });
  input.addEventListener("blur", paintStepper);

  function renderEmployer() {
    const r = bikeCalcEmployer(BIKE_CONFIG, tierId, employeeCount);

    rootEl.querySelector("[data-abc-tier-heading]").textContent = `${r.tier.label}: ${r.tier.employerBlurb}`;
    rootEl.querySelector("[data-abc-annual-cost]").textContent = abcFormatCurrencyWhole(r.employerAnnualCost);
    rootEl.querySelector("[data-abc-monthly-cost]").textContent = abcFormatCurrencyWhole(r.employerMonthlyCost);
    rootEl.querySelector("[data-abc-savings]").textContent = abcFormatCurrency(r.employeeSavesAnnual);

    const detailEl = rootEl.querySelector("[data-abc-savings-detail]");
    detailEl.textContent = r.employeeStillPays > 0
      ? `, though they'd still chip in ${abcFormatCurrency(r.employeeStillPays)} a year themselves`
      : "";
  }

  function renderIndividual() {
    const r = bikeCalcIndividual(BIKE_CONFIG, tierId);
    rootEl.querySelector("[data-abc-tier-heading-individual]").textContent = `${r.tier.label}: ${r.tier.individualBlurb}`;
    rootEl.querySelector("[data-abc-you-pay]").textContent = abcFormatCurrency(r.youPay);
    rootEl.querySelector("[data-abc-you-save]").textContent = abcFormatCurrency(r.youSave);
  }

  // Bulk-callout visibility depends on BOTH mode and headcount, so it's
  // computed here rather than inside renderEmployer() — an inline
  // style.display set only while in employer mode would otherwise keep
  // overriding the CSS [data-mode-only="employer"] hide rule after
  // switching to individual mode, since inline styles win that fight.
  function updateBulkCallout() {
    const bulkCallout = rootEl.querySelector("[data-abc-bulk-callout]");
    if (!bulkCallout) return;
    const applies = mode === "employer" && employeeCount >= BIKE_CONFIG.bulkPasses.threshold;
    bulkCallout.style.display = applies ? "block" : "none";
  }

  function render() {
    updateBulkCallout();
    if (mode === "employer") renderEmployer();
    else renderIndividual();
  }

  // Embed button: same pattern as the other tools' — copies a ready
  // <iframe> tag pointing at this page's own live URL.
  const embedBtn = rootEl.querySelector("[data-abc-embed-btn]");
  if (embedBtn) {
    const originalLabel = embedBtn.textContent;
    let revertTimer = null;

    function buildEmbedHtml() {
      const src = window.location.href;
      return `<iframe src="${src}" title="Bluebikes Membership Calculator" style="width: 100%; border: 0;" height="1000" scrolling="auto" allow="clipboard-write"></iframe>`;
    }

    function copyWithExecCommand(text) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (err) {
        ok = false;
      }
      document.body.removeChild(ta);
      return ok;
    }

    async function copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        return copyWithExecCommand(text);
      }
    }

    embedBtn.addEventListener("click", async () => {
      clearTimeout(revertTimer);
      const copied = await copyToClipboard(buildEmbedHtml());
      if (copied) {
        embedBtn.textContent = "Embed code copied";
        embedBtn.classList.add("abc-bikecalc-copied");
        return;
      }
      embedBtn.textContent = "Couldn't copy, try again";
      revertTimer = setTimeout(() => {
        embedBtn.classList.remove("abc-bikecalc-copied");
        embedBtn.textContent = originalLabel;
      }, 2500);
    });
  }

  paintStepper();
  render();
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-abc-bikecalc-root]");
  if (root) bikeInitCalculator(root);
});
