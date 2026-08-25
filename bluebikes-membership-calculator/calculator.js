/* ============================================================
   A Better City — Bluebikes Membership Calculator

   Employer-only tool: pick a subsidy tier, enter a headcount, see what
   it costs your organization and what each employee saves. No mode
   toggle needed (unlike the MBTA/Commuter Rail tools) since there's no
   individual-facing angle here, just the employer decision.

   Split into three sections: CONFIG, CALC LOGIC, UI / RENDER.
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
  // no employer/group rate at all — the baseline the "employee saves"
  // figure is measured against.
  retailAnnualPrice: 133.50,

  // Both tiers split the same $101.50/person/year corporate group rate
  // differently. employerAnnualCost + employeeAnnualCost always sum to
  // that $101.50.
  tiers: [
    {
      id: "gold",
      label: "Gold",
      blurb: "you cover the full membership",
      employerAnnualCost: 101.50,
      employeeAnnualCost: 0,
    },
    {
      id: "silver",
      label: "Silver",
      blurb: "you split it evenly",
      employerAnnualCost: 50.75,
      employeeAnnualCost: 50.75,
    },
  ],

  employeeCountStep: 5,
  employeeCountMax: 100000,
  defaultEmployeeCount: 25,
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

/* ------------------------------------------------------------
   3. UI / RENDER
   Reads form inputs, calls CALC LOGIC, writes results to the DOM.
   No math happens in this section. Single live-updating view —
   no steps, no submit button.
   ------------------------------------------------------------ */

function bikeInitCalculator(rootEl) {
  let tierId = "gold";
  let employeeCount = BIKE_CONFIG.defaultEmployeeCount;

  // Tier toggle: same segmented-pill pattern as the other tools' mode
  // toggles, just swapping Gold/Silver instead of employee/employer.
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

  function render() {
    const r = bikeCalcEmployer(BIKE_CONFIG, tierId, employeeCount);

    rootEl.querySelector("[data-abc-tier-heading]").textContent = `${r.tier.label}: ${r.tier.blurb}`;
    rootEl.querySelector("[data-abc-annual-cost]").textContent = abcFormatCurrencyWhole(r.employerAnnualCost);
    rootEl.querySelector("[data-abc-monthly-cost]").textContent = abcFormatCurrencyWhole(r.employerMonthlyCost);
    rootEl.querySelector("[data-abc-savings]").textContent = abcFormatCurrency(r.employeeSavesAnnual);

    const detailEl = rootEl.querySelector("[data-abc-savings-detail]");
    detailEl.textContent = r.employeeStillPays > 0
      ? `, though they'd still chip in ${abcFormatCurrency(r.employeeStillPays)} a year themselves`
      : "";
  }

  // Embed button: same pattern as the other tools' — copies a ready
  // <iframe> tag pointing at this page's own live URL.
  const embedBtn = rootEl.querySelector("[data-abc-embed-btn]");
  if (embedBtn) {
    const originalLabel = embedBtn.textContent;
    let revertTimer = null;

    function buildEmbedHtml() {
      const src = window.location.href;
      return `<iframe src="${src}" title="Bluebikes Membership Calculator" style="width: 100%; border: 0;" height="900" scrolling="auto" allow="clipboard-write"></iframe>`;
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
