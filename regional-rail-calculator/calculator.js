/* ============================================================
   A Better City — Commuter Rail Pass Calculator

   A lightweight, promo-focused fork of the MBTA fare calculator: Commuter
   Rail only (no mode choice), no pay-per-ride comparison, no organization
   capture. The full multi-mode tool this was forked from is preserved as
   mbta-fare-calculator/ on the `full-build` branch — pull fixes/features
   back from there if this tool ever needs them.

   Split into three sections: CONFIG, CALC LOGIC, UI / RENDER.
   Depends on shared/utils/format.js being loaded first.
   ============================================================ */

/* ------------------------------------------------------------
   1. CONFIG
   The only section that should need editing when fares change.
   Every price below was pulled from mbta.com on 2026-08-19.
   RE-VERIFY ANNUALLY — MBTA fares typically change each July/August
   and zone boundaries have shifted in past years.
   ------------------------------------------------------------ */
const MBTA_CONFIG = {
  fareSource: {
    url: "https://www.mbta.com/fares/commuter-rail-fares/zones",
    lastVerified: "2026-08-19",
    note:
      "Zone/interzone table pulled from mbta.com/fares/commuter-rail-fares/zones. " +
      "The current promo (50% off Commuter Rail monthly passes, extended through " +
      "Nov 30 2026, Zone 1A excluded) is modeled separately via MBTA_CONFIG.promo " +
      "below rather than baked into these base prices, since it's not a durable fare.",
  },

  // Official MBTA Commuter Rail zone map, for the "which zone am I in" question.
  // Linked out to rather than embedded — keeps this tool dependency-free.
  zoneMapUrl: "https://cdn.mbta.com/sites/default/files/2021-03/2021-03-23-cr-fare-zones.pdf",

  // Employer-mode inputs: how many employees a pass benefit would cover.
  employeeCountStep: 5,
  employeeCountMax: 100000,
  defaultEmployeeCount: 25,

  // Temporary Commuter Rail promo: 50% off monthly passes, extended
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

  subsidyStepPct: 5,
  defaultSubsidyPct: 0,
  perqStepPct: 5,
  // MBTA's own Perq page cites ~30% as a typical pre-tax savings figure —
  // used as the stepper's starting point once someone says "yes" to Perq.
  defaultPerqPct: 30,

  // Commuter Rail zones only — no Subway & Bus option in this build.
  // Zone 1A is excluded from the current promo (see MBTA_CONFIG.promo).
  passOptions: [
    { id: "cr-zone-1a", label: "Zone 1A", monthlyPrice: 90.00 },
    { id: "cr-zone-1", label: "Zone 1", monthlyPrice: 214.00 },
    { id: "cr-zone-2", label: "Zone 2", monthlyPrice: 232.00 },
    { id: "cr-zone-3", label: "Zone 3", monthlyPrice: 261.00 },
    { id: "cr-zone-4", label: "Zone 4", monthlyPrice: 281.00 },
    { id: "cr-zone-5", label: "Zone 5", monthlyPrice: 311.00 },
    { id: "cr-zone-6", label: "Zone 6", monthlyPrice: 340.00 },
    { id: "cr-zone-7", label: "Zone 7", monthlyPrice: 360.00 },
    { id: "cr-zone-8", label: "Zone 8", monthlyPrice: 388.00 },
    { id: "cr-zone-9", label: "Zone 9", monthlyPrice: 406.00 },
    { id: "cr-zone-10", label: "Zone 10", monthlyPrice: 426.00 },
    { id: "cr-interzone-1", label: "Interzone 1", monthlyPrice: 90.00 },
    { id: "cr-interzone-2", label: "Interzone 2", monthlyPrice: 110.00 },
    { id: "cr-interzone-3", label: "Interzone 3", monthlyPrice: 120.00 },
    { id: "cr-interzone-4", label: "Interzone 4", monthlyPrice: 139.00 },
    { id: "cr-interzone-5", label: "Interzone 5", monthlyPrice: 158.00 },
    { id: "cr-interzone-6", label: "Interzone 6", monthlyPrice: 178.00 },
    { id: "cr-interzone-7", label: "Interzone 7", monthlyPrice: 196.00 },
    { id: "cr-interzone-8", label: "Interzone 8", monthlyPrice: 216.00 },
    { id: "cr-interzone-9", label: "Interzone 9", monthlyPrice: 237.00 },
    { id: "cr-interzone-10", label: "Interzone 10", monthlyPrice: 257.00 },
  ],
};

/* ------------------------------------------------------------
   2. CALC LOGIC
   Pure functions: config + inputs in, numbers out. No DOM access.
   ------------------------------------------------------------ */

function mbtaGetPassOption(config, passId) {
  return config.passOptions.find((p) => p.id === passId);
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
 * hasn't expired and the zone isn't on the exclusion list (Zone 1A). */
function mbtaPromoApplies(config, passId, today) {
  const pass = mbtaGetPassOption(config, passId);
  if (!pass) return false;
  if (config.promo.excludeZoneIds.includes(passId)) return false;
  return mbtaPromoIsActive(config, today);
}

/** Employee view: cost of a single monthly pass, promo/subsidy/Perq applied
 * in that order, each on top of what's left after the step before it. */
function mbtaCalcPass(config, passId, subsidyPct, perqPct) {
  const pass = mbtaGetPassOption(config, passId);
  if (!pass) {
    return {
      pass: null,
      breakdown: mbtaCalcBreakdown(0, subsidyPct, perqPct),
      promoApplies: false,
      promoOriginalPrice: 0,
    };
  }
  const promoApplies = mbtaPromoApplies(config, passId);
  const passPrice = promoApplies
    ? pass.monthlyPrice * (1 - config.promo.discountPct / 100)
    : pass.monthlyPrice;
  const breakdown = mbtaCalcBreakdown(passPrice, subsidyPct, perqPct);
  return {
    pass,
    breakdown,
    promoApplies,
    promoOriginalPrice: pass.monthlyPrice,
  };
}

/** Clamps a typed zone-headcount value to a safe whole number: no letters
 * (Number() on non-numeric text is NaN), no negatives, no zero, no decimals,
 * and capped at the same ceiling the old flat headcount stepper used. Never
 * reads the raw string anywhere else, so there's nothing here for an
 * injected value to reach. An empty field (nothing typed yet) sanitizes to
 * 0, not 1 — that's what lets a not-yet-filled-in row stay excluded from
 * the total instead of silently counting as one employee, and what lets
 * the placeholder text keep showing until something real is typed. */
function mbtaSanitizeZoneCount(rawValue) {
  if (rawValue === "" || rawValue == null) return 0;
  const n = Math.floor(Number(rawValue));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MBTA_CONFIG.employeeCountMax);
}

/** Employer view: cost of subsidizing passes across a workforce spread
 * across one or more zones. zoneRows is [{ passId, count }, ...] — one
 * entry per zone row in the UI. Each zone's promo eligibility (Zone 1A is
 * excluded) is resolved independently, then subsidy/Perq are applied once
 * to the pooled total, since those percentages are shared across zones
 * rather than set per row. */
function mbtaCalcEmployerMultiZone(config, zoneRows, contributionPct, perqPct) {
  let totalSticker = 0; // sum of full, pre-promo prices — mirrors the
  // employee card's "Total monthly cost" line, which always shows the
  // sticker price regardless of promo (see renderEmployee's promo-row logic).
  let totalRaw = 0; // sum of prices actually charged, after any promo
  let totalCount = 0;
  let anyPromoApplies = false;
  // Per-zone employer cost, for the summary card's breakdown list. Subsidy
  // is a flat percentage (not tiered), so applying it to each zone's raw
  // cost independently and applying it once to the pooled total are
  // mathematically the same — the per-zone amounts always sum to totalMonth.
  const zoneBreakdown = [];

  zoneRows.forEach(({ passId, count }) => {
    const pass = mbtaGetPassOption(config, passId);
    if (!pass || count < 1) return;
    const promoApplies = mbtaPromoApplies(config, passId);
    if (promoApplies) anyPromoApplies = true;
    const passPrice = promoApplies
      ? pass.monthlyPrice * (1 - config.promo.discountPct / 100)
      : pass.monthlyPrice;
    const zoneRaw = passPrice * count;
    totalSticker += pass.monthlyPrice * count;
    totalRaw += zoneRaw;
    totalCount += count;
    zoneBreakdown.push({
      label: pass.label,
      count,
      monthCost: zoneRaw * (contributionPct / 100),
    });
  });

  const b = mbtaCalcBreakdown(totalRaw, contributionPct, perqPct);
  const totalMonth = b.subsidyAmt; // the employer's own final cost
  const promoAmt = totalSticker - totalRaw;
  const employeesShareAmt = b.afterSubsidy; // the portion employees collectively cover
  const perEmployeeMonth = totalCount > 0 ? totalMonth / totalCount : 0;
  const employeeSavesMonth = totalCount > 0 ? (b.subsidyAmt + b.pretaxAmt) / totalCount : 0;

  return {
    totalSticker,
    totalRaw,
    promoAmt,
    employeesShareAmt,
    totalMonth,
    totalYear: totalMonth * 12,
    perEmployeeMonth,
    employeeSavesMonth,
    zoneBreakdown,
    perqIncluded: perqPct > 0,
    contributes: contributionPct > 0,
    promoApplies: anyPromoApplies,
    totalCount,
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
  let subsidyPct = MBTA_CONFIG.defaultSubsidyPct;
  let perqAnswer = null; // null | "yes" | "no" — null means unanswered
  let perqEnabled = false;
  let perqPct = MBTA_CONFIG.defaultPerqPct;

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

  const railZoneSelect = rootEl.querySelector("[data-abc-rail-zone-select]");
  const promoActive = mbtaPromoIsActive(MBTA_CONFIG);

  function updatePromoUI() {
    const callout = rootEl.querySelector("[data-abc-promo-callout]");
    if (!callout) return;
    // Shown for every zone, including before one's picked (the empty
    // placeholder value) — only Zone 1A itself turns it off. This is
    // deliberately not the same check mbtaCalcPass/mbtaCalcEmployer use
    // (which also require a real, priced zone) since the callout is just
    // announcing the promo, not computing a discount off a specific price.
    const applies = promoActive && !MBTA_CONFIG.promo.excludeZoneIds.includes(currentPassId());
    callout.style.display = applies ? "block" : "none";
    if (applies) {
      const days = mbtaPromoDaysLeft(MBTA_CONFIG);
      rootEl.querySelector("[data-abc-promo-days]").textContent = `${days} day${days === 1 ? "" : "s"} left`;
    }
  }

  // Populate the zone dropdown from config, starting on an unselected
  // "Select zone" placeholder rather than defaulting to a real zone —
  // mbtaCalcPass/mbtaCalcEmployer below both treat an empty passId as
  // "nothing chosen yet" and return zeroed-out results instead of erroring.
  const placeholderOpt = document.createElement("option");
  placeholderOpt.value = "";
  placeholderOpt.textContent = "Select zone";
  placeholderOpt.disabled = true;
  placeholderOpt.selected = true;
  railZoneSelect.appendChild(placeholderOpt);

  MBTA_CONFIG.passOptions.forEach((pass) => {
    const opt = document.createElement("option");
    opt.value = pass.id;
    opt.textContent = pass.label;
    railZoneSelect.appendChild(opt);
  });

  function currentPassId() {
    return railZoneSelect.value;
  }

  railZoneSelect.addEventListener("change", render);

  // ---- Employer multi-zone breakdown ----
  // Employer mode can subsidize employees split across several zones
  // instead of one flat headcount against a single zone. The first row
  // is the original zone select + a count input that sits beside it;
  // "+ Add another zone" appends more rows (their own select + count +
  // remove button) into the extra-rows container. Employee mode never
  // sees any of this — the extra-rows container and every count input
  // are data-mode-only="employer", hidden by the existing CSS rule.
  const zonerowsExtra = rootEl.querySelector("[data-abc-zonerows-extra]");
  const addZoneBtn = rootEl.querySelector("[data-abc-add-zone]");

  function wireZoneCountInput(input) {
    // Live calc always reads through mbtaSanitizeZoneCount() at render
    // time (see readZoneRow), so typing doesn't get corrected mid-keystroke.
    // Blur snaps the visible value to what was actually used, the same
    // convention the other steppers use — except when the field is empty,
    // which is left alone so the placeholder ("Employees in this zone")
    // keeps showing rather than getting overwritten with a number.
    input.addEventListener("input", render);
    input.addEventListener("blur", () => {
      if (input.value.trim() === "") return;
      input.value = mbtaSanitizeZoneCount(input.value);
    });
  }

  function populateZoneSelect(select) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select zone";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
    MBTA_CONFIG.passOptions.forEach((pass) => {
      const opt = document.createElement("option");
      opt.value = pass.id;
      opt.textContent = pass.label;
      select.appendChild(opt);
    });
  }

  function createZoneRow() {
    const row = document.createElement("div");
    row.className = "abc-farecalc-zonerow";
    row.setAttribute("data-abc-zonerow", "");

    const select = document.createElement("select");
    select.className = "abc-select";
    select.setAttribute("aria-label", "Which Commuter Rail zone");
    populateZoneSelect(select);
    select.addEventListener("change", render);

    const input = document.createElement("input");
    input.type = "number";
    input.className = "abc-select abc-farecalc-zonecount-input";
    input.min = "1";
    input.step = "1";
    input.inputMode = "numeric";
    input.placeholder = "Employees in this zone";
    input.setAttribute("aria-label", "Number of employees covered from this zone");
    wireZoneCountInput(input);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "abc-farecalc-zone-remove";
    removeBtn.setAttribute("aria-label", "Remove this zone");
    removeBtn.textContent = "−";
    removeBtn.addEventListener("click", () => {
      row.remove();
      updateAddZoneButtonState();
      render();
    });

    row.appendChild(select);
    row.appendChild(input);
    row.appendChild(removeBtn);
    return row;
  }

  /** Every zone row currently in the DOM: the first (static) row, plus
   * any added via "+ Add another zone". Only meaningful in employer mode. */
  function getZoneRows() {
    const firstRow = rootEl.querySelector("[data-abc-zonerow]");
    const extraRows = zonerowsExtra ? Array.from(zonerowsExtra.querySelectorAll("[data-abc-zonerow]")) : [];
    return firstRow ? [firstRow, ...extraRows] : extraRows;
  }

  // There are only MBTA_CONFIG.passOptions.length distinct zones to choose
  // from (21, as of this config) — past that, "+ Add another zone" has
  // nothing left to add, so it's disabled rather than left to pile up
  // rows nobody can usefully fill in.
  const maxZoneRows = MBTA_CONFIG.passOptions.length;

  function updateAddZoneButtonState() {
    if (!addZoneBtn) return;
    const atLimit = getZoneRows().length >= maxZoneRows;
    addZoneBtn.disabled = atLimit;
    addZoneBtn.classList.toggle("abc-farecalc-add-zone-disabled", atLimit);
  }

  if (addZoneBtn && zonerowsExtra) {
    addZoneBtn.addEventListener("click", () => {
      if (getZoneRows().length >= maxZoneRows) return;
      zonerowsExtra.appendChild(createZoneRow());
      updateAddZoneButtonState();
      render();
    });
  }

  const firstZoneCountInput = rootEl.querySelector("[data-abc-zone-count-input]");
  if (firstZoneCountInput) wireZoneCountInput(firstZoneCountInput);

  function readZoneRow(rowEl) {
    const select = rowEl.querySelector("select");
    const input = rowEl.querySelector(".abc-farecalc-zonecount-input");
    return {
      passId: select ? select.value : "",
      count: input ? mbtaSanitizeZoneCount(input.value) : 1,
    };
  }

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
    const result = mbtaCalcPass(MBTA_CONFIG, currentPassId(), subsidyPct, effectivePerqPct);
    paintCard("pass", result.breakdown, subsidyPct, effectivePerqPct);

    // Promo discount as its own emphasized line item: when it applies,
    // "Total monthly cost" shows the full sticker price and the promo's
    // own dollar amount is broken out as a deduction row above employer
    // subsidy / Perq — the same pattern those two already use.
    const promoRow = rootEl.querySelector("[data-abc-pass-promo-row]");
    if (result.promoApplies) {
      const promoAmt = result.promoOriginalPrice - result.breakdown.total;
      rootEl.querySelector("[data-abc-pass-total]").textContent = abcFormatCurrency(result.promoOriginalPrice);
      rootEl.querySelector("[data-abc-pass-promo-label]").textContent =
        `Commuter Rail promo (${MBTA_CONFIG.promo.discountPct}%)`;
      rootEl.querySelector("[data-abc-pass-promo-amt]").textContent = `-${abcFormatCurrency(promoAmt)}`;
      promoRow.style.display = "flex";
    } else {
      promoRow.style.display = "none";
    }
  }

  function renderEmployer() {
    const zoneRows = getZoneRows().map(readZoneRow);
    const r = mbtaCalcEmployerMultiZone(MBTA_CONFIG, zoneRows, subsidyPct, perqEnabled ? perqPct : 0);

    // Waterfall card, mirroring the employee card's line-item shape: total
    // (always the pre-promo sticker sum) → promo deduction → what employees
    // collectively cover → the employer's own final line.
    rootEl.querySelector("[data-abc-emp-total]").textContent = abcFormatCurrency(r.totalSticker);

    const promoRow = rootEl.querySelector("[data-abc-emp-promo-row]");
    if (r.promoApplies) {
      rootEl.querySelector("[data-abc-emp-promo-amt]").textContent = `-${abcFormatCurrency(r.promoAmt)}`;
      promoRow.style.display = "flex";
    } else {
      promoRow.style.display = "none";
    }

    rootEl.querySelector("[data-abc-emp-share-label]").textContent = `Employees' share (${100 - subsidyPct}%)`;
    rootEl.querySelector("[data-abc-emp-share-amt]").textContent =
      r.employeesShareAmt > 0 ? `-${abcFormatCurrency(r.employeesShareAmt)}` : abcFormatCurrency(0);

    rootEl.querySelector("[data-abc-emp-final]").textContent = abcFormatCurrency(r.totalMonth);

    rootEl.querySelector("[data-abc-emp-peremployee]").textContent = abcFormatCurrency(r.perEmployeeMonth);
    rootEl.querySelector("[data-abc-emp-saves]").textContent = abcFormatCurrency(r.employeeSavesMonth);

    // Per-zone cost breakdown: only worth showing once there's actually
    // more than one zone to break down — with a single zone it would just
    // repeat the "per month" stat above.
    const breakdownEl = rootEl.querySelector("[data-abc-zone-breakdown]");
    if (breakdownEl) {
      breakdownEl.innerHTML = "";
      if (r.zoneBreakdown.length > 1) {
        r.zoneBreakdown.forEach((zone) => {
          const row = document.createElement("div");
          row.className = "abc-farecalc-line abc-farecalc-zone-breakdown-line";
          const label = document.createElement("span");
          label.textContent = `${zone.label} (${abcFormatNumber(zone.count)} employee${zone.count === 1 ? "" : "s"})`;
          const amt = document.createElement("span");
          amt.textContent = `${abcFormatCurrency(zone.monthCost)}/mo`;
          row.appendChild(label);
          row.appendChild(amt);
          breakdownEl.appendChild(row);
        });
      }
    }

    // Spell out where the employee's savings come from, so the number isn't
    // floating without context: contribution, Perq, or both.
    let detail = "";
    if (r.perqIncluded && r.contributes) detail = ", thanks to your contribution and their Perq pre-tax savings";
    else if (r.perqIncluded) detail = ", thanks to Perq pre-tax savings";
    else if (r.contributes) detail = ", thanks to your contribution";
    rootEl.querySelector("[data-abc-emp-saves-detail]").textContent = detail;
  }

  // Embed button: copies a ready-to-paste <iframe> tag pointing at this
  // page's own URL, so it only produces a working snippet once the page
  // is actually live at its real hosted address — not on the dev-preview
  // index.html or a local file:// open. The "copied" state is a
  // click-triggered class (abc-farecalc-copied), not a :hover effect, so
  // it behaves identically on touch and mouse.
  const embedBtn = rootEl.querySelector("[data-abc-embed-btn]");
  if (embedBtn) {
    const originalLabel = embedBtn.textContent;
    let revertTimer = null;

    function buildEmbedHtml() {
      const src = window.location.href;
      return `<iframe src="${src}" title="Commuter Rail Pass Calculator" style="width: 100%; border: 0;" height="1360" scrolling="auto" allow="clipboard-write"></iframe>`;
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
      const copied = await copyToClipboard(buildEmbedHtml());
      if (copied) {
        // Success stays put until the page reloads — no auto-revert. An
        // error still reverts below so the button is clickable to retry.
        embedBtn.textContent = "Embed code copied";
        embedBtn.classList.add("abc-farecalc-copied");
        return;
      }
      embedBtn.textContent = "Couldn't copy, try again";
      revertTimer = setTimeout(() => {
        embedBtn.classList.remove("abc-farecalc-copied");
        embedBtn.textContent = originalLabel;
      }, 2500);
    });
  }

  render();
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-abc-farecalc-root]");
  if (root) mbtaInitCalculator(root);
});
