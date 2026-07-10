/* ============================================================
   ABC Calculators — Shared Formatting Helpers
   Pure functions only. No DOM access. Loaded before calculator.js
   in both index.html (dev) and dist/ chunks (inlined by build script).
   ============================================================ */

/** Format a number as USD currency, e.g. 63.4 -> "$63.40" */
function abcFormatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Format a number as USD with no cents, e.g. 90 -> "$90" */
function abcFormatCurrencyWhole(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Round up to the nearest whole unit (e.g. trips can't be fractional) */
function abcRoundUp(value) {
  return Math.ceil(value);
}

/** Format a plain number with thousands separators, e.g. 1234 -> "1,234" */
function abcFormatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

/** Format a decimal as a percentage string, e.g. 0.3 -> "30%" */
function abcFormatPercent(value) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);
}
