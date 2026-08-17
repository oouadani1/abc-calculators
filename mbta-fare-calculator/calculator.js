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
   and regional rail zone boundaries have shifted in past years.
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

  // Official MBTA Regional Rail zone map, for the "which zone am I in" question.
  // Linked out to rather than embedded — keeps this tool dependency-free.
  zoneMapUrl: "https://cdn.mbta.com/sites/default/files/2021-03/2021-03-23-cr-fare-zones.pdf",

  weeksPerMonth: 4.345,
  daysPerWeekOptions: [1, 2, 3, 4, 5],
  defaultDaysPerWeek: 3,

  // Employer-mode inputs: how many employees a pass benefit would cover.
  employeeCountStep: 5,
  employeeCountMax: 100000,
  defaultEmployeeCount: 25,

  // Temporary Regional Rail promo: 50% off monthly passes, extended
  // through Fall 2026 (originally June-Aug, now through Nov 30). Zone 1A
  // is excluded, matching MBTA's own terms. Auto-expires on its own past
  // endDate (see mbtaPromoIsActive) so nothing has to be remembered by
  // hand once it's over.
  // Source: https://www.mbta.com/fares/commuter-rail-summer-promotions
  promo: {
    discountPct: 50,
    endDate: "2026-11-30",
    excludeZoneIds: ["cr-zone-1a"],
    infoUrl: "https://www.mbta.com/fares/commuter-rail-summer-promotions",
  },

  // Optional analytics: when someone picks their organization, the tool
  // sends one record (org + their inputs) to this endpoint. Point it at
  // the Cloudflare Worker that proxies to Airtable (see
  // analytics/cloudflare-worker.js). Leave blank to disable logging
  // entirely — the org field simply won't appear.
  analytics: {
    endpoint: "https://airtable-calc-automation.oouadani.workers.dev/",
  },

  // Subsidy and pre-tax (Perq) are both modeled the same way, applied to
  // BOTH the pass and pay-per-ride totals — matching how Jawnt's own tool
  // treats these benefits (they're transit-benefit-account features, not
  // pass-specific ones), not the pass-only assumption used previously.
  subsidyStepPct: 5,
  defaultSubsidyPct: 0,
  perqStepPct: 5,
  // MBTA's own Perq page cites ~30% as a typical pre-tax savings figure —
  // used as the stepper's starting point once someone says "yes" to Perq.
  defaultPerqPct: 30,

  // First entry is used directly for the "Subway & Bus" choice.
  // Everything else is Regional Rail, shown only if that's selected.
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

/** True while today is on or before the promo's end date (inclusive, local time). */
function mbtaPromoIsActive(config, today) {
  const end = new Date(config.promo.endDate + "T23:59:59");
  return (today || new Date()).getTime() <= end.getTime();
}

/** Whole days remaining until the promo ends. Never negative; 0 on the last day. */
function mbtaPromoDaysLeft(config, today) {
  const end = new Date(config.promo.endDate + "T23:59:59");
  const ms = end.getTime() - (today || new Date()).getTime();
  return Math.max(0, Math.ceil(ms / 86400000));
}

/** True when a specific pass qualifies for the promo right now: the promo
 * hasn't expired, it's a rail pass, and it isn't on the exclusion list
 * (Zone 1A). Pay-per-ride fares are never discounted, only monthly passes. */
function mbtaPromoApplies(config, passId, today) {
  const pass = mbtaGetPassOption(config, passId);
  if (!pass || pass.group !== "rail") return false;
  if (config.promo.excludeZoneIds.includes(passId)) return false;
  return mbtaPromoIsActive(config, today);
}

/** Employer view: cost of subsidizing a monthly pass across a workforce.
 * Reuses the same subsidy-then-pre-tax breakdown as the employee view, but
 * reads the pieces from the employer's angle: the subsidy amount is what the
 * employer pays, and subsidy + pre-tax together is what each employee saves.
 * Pay-per-ride / days-per-week don't apply here — a pass program is a flat
 * monthly benefit, so those are employee-view-only inputs. */
function mbtaCalcEmployer(config, passId, contributionPct, perqPct, employeeCount) {
  const pass = mbtaGetPassOption(config, passId);
  const promoApplies = mbtaPromoApplies(config, passId);
  const passPrice = promoApplies
    ? pass.monthlyPrice * (1 - config.promo.discountPct / 100)
    : pass.monthlyPrice;
  const b = mbtaCalcBreakdown(passPrice, contributionPct, perqPct);
  const perEmployeeMonth = b.subsidyAmt;
  const totalMonth = perEmployeeMonth * employeeCount;
  return {
    pass,
    passPrice,
    promoApplies,
    perEmployeeMonth,
    totalMonth,
    totalYear: totalMonth * 12,
    employeeSavesMonth: b.subsidyAmt + b.pretaxAmt,
    perqIncluded: perqPct > 0,
    contributes: contributionPct > 0,
  };
}

/** Bundles every derived number the UI needs for both options + inputs. */
function mbtaCalcAll(config, passId, daysPerWeek, subsidyPct, perqPct) {
  const pass = mbtaGetPassOption(config, passId);
  const rideTotal = mbtaCalcPayPerRideTotal(pass.oneWayFare, daysPerWeek, config.weeksPerMonth);

  // The promo discounts the monthly pass itself, not pay-per-ride fares, so
  // it's applied before the subsidy/pre-tax breakdown runs on the pass side
  // only — subsidy and Perq then apply on top of the already-discounted price.
  const promoApplies = mbtaPromoApplies(config, passId);
  const passPrice = promoApplies
    ? pass.monthlyPrice * (1 - config.promo.discountPct / 100)
    : pass.monthlyPrice;

  const passBreakdown = mbtaCalcBreakdown(passPrice, subsidyPct, perqPct);
  const rideBreakdown = mbtaCalcBreakdown(rideTotal, subsidyPct, perqPct);

  const winner = passBreakdown.finalCost <= rideBreakdown.finalCost ? "pass" : "ride";
  const monthlyDiff = Math.abs(passBreakdown.finalCost - rideBreakdown.finalCost);

  return {
    pass,
    passBreakdown,
    rideBreakdown,
    winner,
    annualSavings: monthlyDiff * 12,
    promoApplies,
    promoOriginalPrice: pass.monthlyPrice,
  };
}

/* ------------------------------------------------------------
   3. UI / RENDER
   Reads form inputs, calls CALC LOGIC, writes results to the DOM.
   No math happens in this section. Single live-updating view —
   no steps, no submit button.
   ------------------------------------------------------------ */

function mbtaInitCalculator(rootEl) {
  let mode = "employee"; // "employee" | "employer"
  let routeType = "subway"; // "subway" | "rail"
  let daysPerWeek = MBTA_CONFIG.defaultDaysPerWeek;
  let subsidyPct = MBTA_CONFIG.defaultSubsidyPct;
  let perqAnswer = null; // null | "yes" | "no" — null means unanswered
  let perqEnabled = false;
  let perqPct = MBTA_CONFIG.defaultPerqPct;
  let employeeCount = MBTA_CONFIG.defaultEmployeeCount;

  // Mode toggle: swaps copy/fields/results between the employee and employer
  // views. Copy and field visibility are driven off the root's data-abc-mode
  // attribute in CSS; this just flips the attribute and re-renders.
  const modeButtons = rootEl.querySelectorAll("[data-abc-mode-select]");
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.abcModeSelect;
      modeButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      rootEl.setAttribute("data-abc-mode", mode);
      updateAdvocacy();
      render();
    });
  });

  const routeButtons = rootEl.querySelectorAll("[data-abc-route-select]");
  const railZoneField = rootEl.querySelector("[data-abc-rail-zone-field]");
  const railZoneSelect = rootEl.querySelector("[data-abc-rail-zone-select]");
  const dayButtons = rootEl.querySelectorAll("[data-abc-day-select]");

  // Regional Rail promo: the button badge only depends on whether the promo
  // as a whole is still running, so it's set once here rather than on every
  // render. The callout and price strikethrough depend on which specific
  // pass is selected (Zone 1A is excluded), so those are recomputed in
  // updatePromoUI() below on every render instead.
  const promoActive = mbtaPromoIsActive(MBTA_CONFIG);
  const promoBadge = rootEl.querySelector("[data-abc-promo-badge]");
  if (promoBadge) promoBadge.style.display = promoActive ? "" : "none";

  function updatePromoUI() {
    const callout = rootEl.querySelector("[data-abc-promo-callout]");
    if (!callout) return;
    const applies = promoActive && mbtaPromoApplies(MBTA_CONFIG, currentPassId());
    callout.style.display = applies ? "block" : "none";
    if (applies) {
      const days = mbtaPromoDaysLeft(MBTA_CONFIG);
      rootEl.querySelector("[data-abc-promo-days]").textContent =
        `${days} day${days === 1 ? "" : "s"}`;
    }
  }

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

  // Perq yes/no: only reveals the stepper (and only counts toward the
  // math) when "yes" is picked. The advocacy line only appears once "no"
  // is explicitly chosen — not on initial load, and not for "yes".
  const perqButtons = rootEl.querySelectorAll("[data-abc-perq-select]");
  const perqStepperField = rootEl.querySelector("[data-abc-perq-stepper-field]");
  const perqAdvocacy = rootEl.querySelector("[data-abc-perq-advocacy]");

  perqButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      perqAnswer = btn.dataset.abcPerqSelect;
      perqEnabled = perqAnswer === "yes";
      perqButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      perqStepperField.style.display = perqEnabled ? "block" : "none";
      updateAdvocacy();
      render();
    });
  });

  // Advocacy nudge is employee-view-only, and only after "No" is picked.
  function updateAdvocacy() {
    perqAdvocacy.style.display = (perqAnswer === "no" && mode === "employee") ? "block" : "none";
  }

  // Generic stepper wiring: works for the subsidy, pre-tax, and employee-count
  // controls. min/max default to a 0-100 percentage; the count stepper passes
  // its own wider range.
  function initStepper(rootAttr, step, getValue, setValue, min = 0, max = 100) {
    const stepperEl = rootEl.querySelector(`[${rootAttr}]`);
    const input = stepperEl.querySelector("[data-abc-stepper-value]");
    const minusBtn = stepperEl.querySelector("[data-abc-stepper-minus]");
    const plusBtn = stepperEl.querySelector("[data-abc-stepper-plus]");

    function paint() {
      input.value = getValue();
    }
    minusBtn.addEventListener("click", () => {
      setValue(Math.max(min, getValue() - step));
      paint();
      render();
    });
    plusBtn.addEventListener("click", () => {
      setValue(Math.min(max, getValue() + step));
      paint();
      render();
    });
    // Typing a value updates live; +/- still moves in fixed steps, but a
    // typed number isn't forced to snap to the nearest one — precision is
    // the whole point of allowing manual entry.
    input.addEventListener("input", () => {
      const raw = Number(input.value);
      if (!Number.isNaN(raw)) {
        setValue(Math.min(max, Math.max(min, raw)));
        render();
      }
    });
    input.addEventListener("blur", paint);
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
  initStepper(
    "data-abc-count-stepper",
    MBTA_CONFIG.employeeCountStep,
    () => employeeCount,
    (v) => { employeeCount = v; },
    1,
    MBTA_CONFIG.employeeCountMax
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
    updatePromoUI();
    if (mode === "employer") renderEmployer();
    else renderEmployee();
  }

  function renderEmployee() {
    const effectivePerqPct = perqEnabled ? perqPct : 0;
    const result = mbtaCalcAll(MBTA_CONFIG, currentPassId(), daysPerWeek, subsidyPct, effectivePerqPct);

    paintCard("ride", result.rideBreakdown, subsidyPct, effectivePerqPct);
    paintCard("pass", result.passBreakdown, subsidyPct, effectivePerqPct);

    // Promo discount as its own emphasized line item, not a discreet
    // strikethrough: when it applies, "Total monthly cost" reverts to the
    // full sticker price (matching how the Pay-Per-Ride card always shows
    // its full total), and the promo's own dollar amount is broken out as
    // a deduction row above employer subsidy / Perq — the same pattern
    // those two already use, just emphasized in the promo's blue.
    const promoRow = rootEl.querySelector("[data-abc-pass-promo-row]");
    if (result.promoApplies) {
      const promoAmt = result.promoOriginalPrice - result.passBreakdown.total;
      rootEl.querySelector("[data-abc-pass-total]").textContent = abcFormatCurrency(result.promoOriginalPrice);
      rootEl.querySelector("[data-abc-pass-promo-label]").textContent =
        `Regional Rail promo (${MBTA_CONFIG.promo.discountPct}%)`;
      rootEl.querySelector("[data-abc-pass-promo-amt]").textContent = `-${abcFormatCurrency(promoAmt)}`;
      promoRow.style.display = "flex";
    } else {
      promoRow.style.display = "none";
    }

    const rideCard = rootEl.querySelector("[data-abc-card-ride]");
    const passCard = rootEl.querySelector("[data-abc-card-pass]");
    rideCard.classList.toggle("abc-card-winner", result.winner === "ride");
    passCard.classList.toggle("abc-card-winner", result.winner === "pass");
    rideCard.querySelector("[data-abc-badge]").style.visibility = result.winner === "ride" ? "visible" : "hidden";
    passCard.querySelector("[data-abc-badge]").style.visibility = result.winner === "pass" ? "visible" : "hidden";

    const winnerCard = result.winner === "ride" ? rideCard : passCard;
    const loserCard = result.winner === "ride" ? passCard : rideCard;
    const otherOptionLabel = result.winner === "ride" ? "purchasing a monthly pass" : "paying per ride";
    winnerCard.querySelector("[data-abc-savings-line]").style.display = result.annualSavings > 0.5 ? "block" : "none";
    winnerCard.querySelector("[data-abc-savings-amt]").textContent = abcFormatCurrency(result.annualSavings);
    winnerCard.querySelector("[data-abc-savings-vs]").textContent = otherOptionLabel;
    loserCard.querySelector("[data-abc-savings-line]").style.display = "none";
  }

  function renderEmployer() {
    const r = mbtaCalcEmployer(MBTA_CONFIG, currentPassId(), subsidyPct, perqEnabled ? perqPct : 0, employeeCount);
    rootEl.querySelector("[data-abc-emp-permonth]").textContent = abcFormatCurrencyWhole(r.totalMonth);
    rootEl.querySelector("[data-abc-emp-peryear]").textContent = abcFormatCurrencyWhole(r.totalYear);
    rootEl.querySelector("[data-abc-emp-peremployee]").textContent = abcFormatCurrency(r.perEmployeeMonth);
    rootEl.querySelector("[data-abc-emp-saves]").textContent = abcFormatCurrency(r.employeeSavesMonth);

    // Spell out where the employee's savings come from, so the number isn't
    // floating without context: contribution, Perq, or both.
    let detail = "";
    if (r.perqIncluded && r.contributes) detail = ", thanks to your contribution and their Perq pre-tax savings";
    else if (r.perqIncluded) detail = ", thanks to Perq pre-tax savings";
    else if (r.contributes) detail = ", thanks to your contribution";
    rootEl.querySelector("[data-abc-emp-saves-detail]").textContent = detail;
  }

  // Embed button: re-fetches this page's own source and copies it to the
  // clipboard. Only produces a complete, pasteable snippet when the page
  // is actually the built dist/*.html chunk (inline <style>/<script>) —
  // on the dev-preview index.html, CSS/JS are separate <link>/<script src>
  // files, so there's nothing self-contained to copy from there. The
  // "copied" state is a click-triggered class (abc-farecalc-copied), not
  // a :hover effect, so it behaves identically on touch and mouse.
  const embedBtn = rootEl.querySelector("[data-abc-embed-btn]");
  if (embedBtn) {
    const originalLabel = embedBtn.textContent;
    let revertTimer = null;

    // Tries re-fetching the page's own URL first (works for any normal
    // http/https hosting). Opening the file directly from disk (file://)
    // makes that fetch fail with a CORS error every time, even though
    // nothing is actually wrong \u2014 browsers block fetch() on file:// URLs
    // on principle. Falls back to reading the already-loaded <style> and
    // <script> tags straight from the DOM, which works regardless of how
    // the page was opened.
    async function getEmbedHtml() {
      try {
        const res = await fetch(window.location.href);
        if (!res.ok) throw new Error("fetch failed");
        return await res.text();
      } catch (err) {
        const styleTag = document.querySelector("style");
        const scriptTag = document.querySelector("script:not([src])");
        const parts = [];
        // The closing tags below are deliberately split with a backslash.
        // build.sh inlines this file's own source into a real script
        // element, and the HTML parser ends that element at the literal
        // closing-tag text wherever it appears in the source, including
        // inside a JS string, template literal, or even this comment —
        // it doesn't parse JS at all, just scans for the raw bytes. An
        // unescaped closing tag here would truncate the whole script at
        // build time.
        if (styleTag) parts.push(`<style>${styleTag.textContent}<\/style>`);
        parts.push(rootEl.outerHTML);
        if (scriptTag) parts.push(`<script>${scriptTag.textContent}<\/script>`);
        return parts.join("\n");
      }
    }

    // A page embedded via a cross-origin <iframe> only gets clipboard-write
    // access if the parent page's <iframe> tag explicitly grants it (e.g.
    // allow="clipboard-write") — a browser permissions policy, not
    // something fixable from inside the iframe itself. The older
    // execCommand approach predates that policy and isn't governed by it,
    // so it's used as a fallback rather than the tool just failing inside
    // any iframe whose host page hasn't set that attribute.
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
      try {
        const html = await getEmbedHtml();
        const copied = await copyToClipboard(html);
        if (!copied) throw new Error("copy failed");
        // Success stays put until the page reloads — no auto-revert. An
        // error still reverts below so the button is clickable to retry.
        embedBtn.textContent = "Embed code copied";
        embedBtn.classList.add("abc-farecalc-copied");
        return;
      } catch (err) {
        embedBtn.textContent = "Couldn't copy, try again";
      }
      revertTimer = setTimeout(() => {
        embedBtn.classList.remove("abc-farecalc-copied");
        embedBtn.textContent = originalLabel;
      }, 2500);
    });
  }

  // Optional analytics: when someone picks their organization, send one
  // record (org + current inputs) to the configured endpoint. Fire-and-
  // forget — logging must never block or break the tool. The org field
  // only appears when an endpoint is set and the org list actually loaded,
  // so leaving MBTA_CONFIG.analytics.endpoint blank hides it entirely.
  const orgField = rootEl.querySelector("[data-abc-org-field]");
  const orgInput = rootEl.querySelector("[data-abc-org-input]");
  const orgList = rootEl.querySelector("[data-abc-org-list]");
  const analyticsEndpoint = (MBTA_CONFIG.analytics && MBTA_CONFIG.analytics.endpoint) || "";
  const orgNames = (typeof window !== "undefined" && window.ABC_MEMBER_ORGS) || [];

  if (orgField && orgInput && orgList && analyticsEndpoint && orgNames.length) {
    orgNames.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      orgList.appendChild(opt);
    });
    orgField.style.display = "";

    function currentTransitLabel() {
      if (routeType === "subway") return "Subway & Bus (LinkPass)";
      const opt = mbtaGetPassOption(MBTA_CONFIG, railZoneSelect.value);
      return "Regional Rail — " + (opt ? opt.label : "");
    }

    // One record per distinct org entered — dedupe so re-focusing the field
    // (or re-picking the same name) doesn't file duplicates.
    let lastLoggedOrg = "";
    orgInput.addEventListener("change", () => {
      const org = orgInput.value.trim();
      if (!org || org === lastLoggedOrg) return;
      lastLoggedOrg = org;
      const payload = {
        org,
        mode,
        transit: currentTransitLabel(),
        contributionPct: subsidyPct,
        offersPerq: perqEnabled,
        perqPct: perqEnabled ? perqPct : 0,
        employeeCount: mode === "employer" ? employeeCount : null,
        source: (typeof window !== "undefined") ? window.location.href : "",
      };
      try {
        fetch(analyticsEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {});
      } catch (err) {
        /* never let logging break the tool */
      }
    });
  }

  render();
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-abc-farecalc-root]");
  if (root) mbtaInitCalculator(root);
});
