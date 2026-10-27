/* ============================================================
   ABC MBTA Fare / Monthly Pass Calculator
   Split into four sections: CONFIG, STATIONS, CALC LOGIC, UI / RENDER.
   Depends on shared/utils/format.js being loaded first.

   Architecture note: comparison-card layout (Jawnt-style side-by-side
   Pay-Per-Ride vs Monthly Pass), trip frequency as a flexible round-trips/
   week input (not a 1-5 days button grid, not capped — any real ride
   pattern, including midday/weekend/multiple-a-day trips, fits the same
   number). Doubled to one-way trips once, right where it's read off the
   stepper (see renderEmployee()), since every fare calc underneath takes
   one-way units.
   ============================================================ */

/* ------------------------------------------------------------
   1. CONFIG
   The only section that should need editing when fares change.
   Every price below was pulled from mbta.com on 2026-07-10, except
   where individually noted.
   RE-VERIFY ANNUALLY — MBTA fares typically change each July/August
   and regional rail zone boundaries have shifted in past years.
   ------------------------------------------------------------ */
const MBTA_CONFIG = {
  fareSource: {
    url: "https://www.mbta.com/fares",
    lastVerified: "2026-07-10",
    note:
      "Zone/interzone table pulled from mbta.com/fares/commuter-rail-fares/zones " +
      "and mbta.com/fares/subway-fares. Reduced Fare one-way/monthly prices for " +
      "Zone 1A and Zones 1-10 are confirmed from mbta.com/fares/reduced. MBTA " +
      "does not publish a Reduced Fare breakdown by Commuter Rail Interzone " +
      "(1-10) at all — those figures are estimated (one-way: half the regular " +
      "fare, rounded to the nearest quarter, matching the pattern every " +
      "confirmed zone already follows; monthly: interpolated between the two " +
      "confirmed endpoints, Zone 1A's $30 and Zone 10's $209) and flagged with " +
      "`estimated: true` below. Verify against MBTA's official tariff before " +
      "treating interzone Reduced Fare numbers as exact.",
  },

  // Official MBTA Commuter Rail zone map, for the "which zone am I in" question.
  // Linked out to rather than embedded — keeps this tool dependency-free.
  zoneMapUrl: "https://cdn.mbta.com/sites/default/files/2021-03/2021-03-23-cr-fare-zones.pdf",

  // 52 weeks a year ÷ 12 months would be the simpler constant (and is what
  // the BU fork of this tool uses), but this tool's break-even stat and
  // footer disclosure were both originally built around 4.345 (365.25/7/12,
  // leap-year-adjusted) — kept as-is rather than changed quietly. Now shown
  // inline on the Pay-Per-Ride line itself, not just in the footer.
  weeksPerMonth: 4.345,

  // Trip frequency: a direct numeric input (typed or +/-1 stepper), not a
  // button grid — covers weekend-only, midday-only, or more-than-5-round-
  // trip patterns a 1-5 day grid couldn't capture. No upper bound: a ride
  // count has no real ceiling the way a day count does. This value is
  // ROUND-TRIPS/week — doubled to one-way trips right where it's read off
  // the stepper (see renderEmployee()), since mbtaCalcAll() and the fare
  // math underneath it take one-way units.
  tripsStep: 1,
  defaultTripsPerWeek: 3, // 3 round-trips/week, a typical 3-day office week

  // Employer-mode inputs: how many employees a pass benefit would cover.
  employeeCountStep: 5,
  employeeCountMax: 100000,
  defaultEmployeeCount: 25,

  // Temporary Commuter Rail promo: 50% off monthly passes. Originally
  // June-Aug 2026, extended through Nov 30. Zone 1A is excluded, matching
  // MBTA's own terms. Auto-expires on its own past endDate (see
  // mbtaPromoIsActive) so nothing has to be remembered by hand once it's
  // over. The employer/Perq ordering-deadline language that used to live
  // in the callout (Sept 10 / Oct 10 cutoffs) is gone — those monthly
  // ordering windows have passed. Direct purchase (mTicket, fare vending
  // machines, ticket windows, Autopay) remains open through the promo's
  // own end date itself, confirmed via mbta.com and 128bc.org (no earlier
  // cutoff found for direct/individual purchases) — the countdown below
  // already counts down to that same endDate.
  // Source: https://www.mbta.com/fares/commuter-rail-summer-promotions
  promo: {
    discountPct: 50,
    endDate: "2026-11-30",
    excludeZoneIds: ["cr-zone-1a"],
    infoUrl: "https://www.mbta.com/fares/commuter-rail-summer-promotions",
  },

  // Subsidy and pre-tax (Perq) are both modeled the same way, applied to
  // BOTH the pass and pay-per-ride totals — these are transit-benefit-
  // account features, not pass-specific ones.
  subsidyStepPct: 5,
  defaultSubsidyPct: 0,
  perqStepPct: 5,
  // MBTA's own Perq page cites ~30% as a typical pre-tax savings figure —
  // used as the stepper's starting point once someone says "yes" to Perq.
  defaultPerqPct: 30,

  // First entry is used directly for the "Subway & Bus" choice.
  // Everything else is Commuter Rail, shown only if that's selected.
  // Zone 1A and LinkPass are both $90 as of this pricing period — that's a
  // real coincidence in current MBTA fares, not a bug.
  // reducedOneWayFare/reducedMonthlyPrice: Zone 1A and Zones 1-10 are
  // confirmed from mbta.com/fares/reduced. Interzones are estimated — see
  // fareSource.note above — and carry `reducedEstimated: true`.
  passOptions: [
    { id: "local-bus", label: "Bus Pass", group: "subway", oneWayFare: 1.70, monthlyPrice: 55.00, reducedOneWayFare: 0.85, reducedMonthlyPrice: 30.00 },
    { id: "linkpass", label: "LinkPass (Subway + Bus)", group: "subway", oneWayFare: 2.40, monthlyPrice: 90.00, reducedOneWayFare: 1.10, reducedMonthlyPrice: 30.00 },
    { id: "cr-zone-1a", label: "Zone 1A", group: "rail", oneWayFare: 2.40, monthlyPrice: 90.00, reducedOneWayFare: 1.10, reducedMonthlyPrice: 30.00 },
    { id: "cr-zone-1", label: "Zone 1", group: "rail", oneWayFare: 6.50, monthlyPrice: 214.00, reducedOneWayFare: 3.25, reducedMonthlyPrice: 105.00 },
    { id: "cr-zone-2", label: "Zone 2", group: "rail", oneWayFare: 7.00, monthlyPrice: 232.00, reducedOneWayFare: 3.50, reducedMonthlyPrice: 114.00 },
    { id: "cr-zone-3", label: "Zone 3", group: "rail", oneWayFare: 8.00, monthlyPrice: 261.00, reducedOneWayFare: 4.00, reducedMonthlyPrice: 128.00 },
    { id: "cr-zone-4", label: "Zone 4", group: "rail", oneWayFare: 8.75, monthlyPrice: 281.00, reducedOneWayFare: 4.25, reducedMonthlyPrice: 138.00 },
    { id: "cr-zone-5", label: "Zone 5", group: "rail", oneWayFare: 9.75, monthlyPrice: 311.00, reducedOneWayFare: 4.75, reducedMonthlyPrice: 153.00 },
    { id: "cr-zone-6", label: "Zone 6", group: "rail", oneWayFare: 10.50, monthlyPrice: 340.00, reducedOneWayFare: 5.25, reducedMonthlyPrice: 167.00 },
    { id: "cr-zone-7", label: "Zone 7", group: "rail", oneWayFare: 11.00, monthlyPrice: 360.00, reducedOneWayFare: 5.50, reducedMonthlyPrice: 177.00 },
    { id: "cr-zone-8", label: "Zone 8", group: "rail", oneWayFare: 12.25, monthlyPrice: 388.00, reducedOneWayFare: 6.00, reducedMonthlyPrice: 190.00 },
    { id: "cr-zone-9", label: "Zone 9", group: "rail", oneWayFare: 12.75, monthlyPrice: 406.00, reducedOneWayFare: 6.25, reducedMonthlyPrice: 199.00 },
    { id: "cr-zone-10", label: "Zone 10", group: "rail", oneWayFare: 13.25, monthlyPrice: 426.00, reducedOneWayFare: 6.50, reducedMonthlyPrice: 209.00 },
    { id: "cr-interzone-1", label: "Interzone 1", group: "rail", oneWayFare: 2.75, monthlyPrice: 90.00, reducedOneWayFare: 1.50, reducedMonthlyPrice: 30.00, reducedEstimated: true },
    { id: "cr-interzone-2", label: "Interzone 2", group: "rail", oneWayFare: 3.25, monthlyPrice: 110.00, reducedOneWayFare: 1.50, reducedMonthlyPrice: 41.00, reducedEstimated: true },
    { id: "cr-interzone-3", label: "Interzone 3", group: "rail", oneWayFare: 3.50, monthlyPrice: 120.00, reducedOneWayFare: 1.75, reducedMonthlyPrice: 46.00, reducedEstimated: true },
    { id: "cr-interzone-4", label: "Interzone 4", group: "rail", oneWayFare: 4.25, monthlyPrice: 139.00, reducedOneWayFare: 2.00, reducedMonthlyPrice: 56.00, reducedEstimated: true },
    { id: "cr-interzone-5", label: "Interzone 5", group: "rail", oneWayFare: 4.75, monthlyPrice: 158.00, reducedOneWayFare: 2.50, reducedMonthlyPrice: 66.00, reducedEstimated: true },
    { id: "cr-interzone-6", label: "Interzone 6", group: "rail", oneWayFare: 5.25, monthlyPrice: 178.00, reducedOneWayFare: 2.50, reducedMonthlyPrice: 77.00, reducedEstimated: true },
    { id: "cr-interzone-7", label: "Interzone 7", group: "rail", oneWayFare: 5.75, monthlyPrice: 196.00, reducedOneWayFare: 3.00, reducedMonthlyPrice: 86.00, reducedEstimated: true },
    { id: "cr-interzone-8", label: "Interzone 8", group: "rail", oneWayFare: 6.25, monthlyPrice: 216.00, reducedOneWayFare: 3.00, reducedMonthlyPrice: 97.00, reducedEstimated: true },
    { id: "cr-interzone-9", label: "Interzone 9", group: "rail", oneWayFare: 6.75, monthlyPrice: 237.00, reducedOneWayFare: 3.50, reducedMonthlyPrice: 108.00, reducedEstimated: true },
    { id: "cr-interzone-10", label: "Interzone 10", group: "rail", oneWayFare: 7.25, monthlyPrice: 257.00, reducedOneWayFare: 3.50, reducedMonthlyPrice: 119.00, reducedEstimated: true },

    // Ferry: one-way and monthly prices confirmed live on
    // mbta.com/fares/ferry-fares (2026-10), same source used for the BU
    // fork's identical entries. MBTA fare-integrates ferry monthly passes
    // with the equivalent Commuter Rail zone where one exists — not a
    // coincidence that Winthrop/Quincy and Lynn match cr-zone-1 and
    // cr-zone-2 above dollar-for-dollar, which is also why their Reduced
    // Fare prices are reused from those confirmed zones. Hingham/Hull has
    // no CR-zone equivalent; its reduced monthly price has no published
    // figure, so it's estimated via the same ~50%-of-regular ratio the
    // other confirmed routes follow — flagged with reducedEstimated.
    { id: "ferry-winthrop-quincy", label: "Winthrop/Quincy Ferry", group: "ferry", oneWayFare: 6.50, monthlyPrice: 214.00, reducedOneWayFare: 3.25, reducedMonthlyPrice: 105.00 },
    { id: "ferry-lynn", label: "Lynn Ferry", group: "ferry", oneWayFare: 7.00, monthlyPrice: 232.00, reducedOneWayFare: 3.50, reducedMonthlyPrice: 114.00 },
    { id: "ferry-hingham-hull", label: "Hingham/Hull Ferry", group: "ferry", oneWayFare: 9.75, monthlyPrice: 329.00, reducedOneWayFare: 4.85, reducedMonthlyPrice: 161.00, reducedEstimated: true },
  ],
};

/* ------------------------------------------------------------
   1b. MBTA PARK-AND-RIDE: per-station daily parking fee at MBTA-owned
   Commuter Rail lots, for someone who drives to their station and parks
   there. Not the same thing as a monthly pass or employer subsidy — this
   is MBTA's own facility pricing. Source: the user's
   mbta-CR-parking-lot-rates.csv, joined to station names by stop_id
   (the CSV's facility names don't match common station names, e.g.
   "Abington Parking Lot" / stop_id place-PB-0194 -> "Abington"). Where a
   station has more than one MBTA-affiliated lot, the largest by capacity
   is used as the representative rate (118 of 142 stations have a usable
   rate; the other 24, mostly urban infill stops, have no MBTA lot at all
   and simply never show the "will you park here" checkbox). zoneId ties
   each station to a standard Zone 1A-10 fare — this dataset does not
   cover Interzone stations, so the station search (employee mode) only
   ever resolves to a standard zone; employer mode's zone dropdown still
   has full Interzone access.
   ------------------------------------------------------------ */
const MBTA_STATIONS = [
  { label: "Abington", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Anderson/Woburn", zoneId: "cr-zone-2", parkingRate: 4.00 },
  { label: "Andover", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "Ashland", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Attleboro", zoneId: "cr-zone-7", parkingRate: 5.00 },
  { label: "Auburndale", zoneId: "cr-zone-2", parkingRate: 6.00 },
  { label: "Ayer", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Back Bay", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Ballardvale", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Bellevue", zoneId: "cr-zone-1", parkingRate: 4.00 },
  { label: "Belmont", zoneId: "cr-zone-1", parkingRate: 5.00 },
  { label: "Beverly", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Beverly Farms", zoneId: "cr-zone-5", parkingRate: 0.00 },
  { label: "Blue Hill Avenue", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Boston Landing", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Bradford", zoneId: "cr-zone-7", parkingRate: 2.00 },
  { label: "Braintree", zoneId: "cr-zone-2", parkingRate: 9.00 },
  { label: "Brandeis/Roberts", zoneId: "cr-zone-2", parkingRate: 4.00 },
  { label: "Bridgewater", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Brockton", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Campello", zoneId: "cr-zone-5", parkingRate: null },
  { label: "Canton Center", zoneId: "cr-zone-3", parkingRate: 4.00 },
  { label: "Canton Junction", zoneId: "cr-zone-3", parkingRate: 4.00 },
  { label: "Chelsea", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Church Street", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Cohasset", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Concord", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "Dedham Corporate Center", zoneId: "cr-zone-2", parkingRate: null },
  { label: "East Taunton", zoneId: "cr-zone-8", parkingRate: null },
  { label: "East Weymouth", zoneId: "cr-zone-2", parkingRate: 6.00 },
  { label: "Endicott", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Fairmount", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Fall River Depot", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Fitchburg", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Forest Hills", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Forge Park/495", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Four Corners/Geneva", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Foxboro", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Framingham", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "Franklin", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Freetown", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Gloucester", zoneId: "cr-zone-7", parkingRate: 4.00 },
  { label: "Grafton", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Greenbush", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Greenwood", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Halifax", zoneId: "cr-zone-7", parkingRate: 4.00 },
  { label: "Hamilton/Wenham", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "Hanson", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Haverhill", zoneId: "cr-zone-7", parkingRate: 4.00 },
  { label: "Hersey", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Highland", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Holbrook/Randolph", zoneId: "cr-zone-3", parkingRate: 4.00 },
  { label: "Hyde Park", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Ipswich", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Islington", zoneId: "cr-zone-3", parkingRate: null },
  { label: "JFK/UMass", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Kendal Green", zoneId: "cr-zone-3", parkingRate: 4.00 },
  { label: "Kingston", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Lansdowne", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Lawrence", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Lincoln", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Littleton/Route 495", zoneId: "cr-zone-7", parkingRate: 4.00 },
  { label: "Lowell", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Lynn", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Malden Center", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Manchester", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Mansfield", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Melrose Highlands", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Melrose/Cedar Park", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Middleborough", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Montello", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Montserrat", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Morton Street", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Nantasket Junction", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Natick Center", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Needham Center", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Needham Heights", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Needham Junction", zoneId: "cr-zone-2", parkingRate: null },
  { label: "New Bedford", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Newburyport", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Newmarket", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Newtonville", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Norfolk", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "North Beverly", zoneId: "cr-zone-5", parkingRate: null },
  { label: "North Billerica", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "North Leominster", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "North Scituate", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "North Station", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "North Wilmington", zoneId: "cr-zone-3", parkingRate: 4.00 },
  { label: "Norwood Central", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Norwood Depot", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Oak Grove", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Pawtucket/Central Falls", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Porter", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Providence", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Quincy Center", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Reading", zoneId: "cr-zone-2", parkingRate: 4.00 },
  { label: "Readville", zoneId: "cr-zone-2", parkingRate: null },
  { label: "River Works", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Rockport", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Roslindale Village", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Route 128", zoneId: "cr-zone-2", parkingRate: 4.00 },
  { label: "Rowley", zoneId: "cr-zone-7", parkingRate: 4.00 },
  { label: "Ruggles", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Salem", zoneId: "cr-zone-3", parkingRate: 4.00 },
  { label: "Sharon", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Shirley", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "South Acton", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "South Attleboro", zoneId: "cr-zone-7", parkingRate: null },
  { label: "South Station", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "South Weymouth", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Southborough", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Stoughton", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Swampscott", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Talbot Avenue", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "TF Green Airport", zoneId: "cr-zone-9", parkingRate: null },
  { label: "Uphams Corner", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Wachusett", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Wakefield", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Walpole", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Waltham", zoneId: "cr-zone-2", parkingRate: 6.00 },
  { label: "Waverley", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Wedgemere", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Wellesley Farms", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Wellesley Hills", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Wellesley Square", zoneId: "cr-zone-3", parkingRate: null },
  { label: "West Concord", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "West Gloucester", zoneId: "cr-zone-7", parkingRate: null },
  { label: "West Hingham", zoneId: "cr-zone-3", parkingRate: null },
  { label: "West Medford", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "West Natick", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "West Newton", zoneId: "cr-zone-2", parkingRate: 4.00 },
  { label: "West Roxbury", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Westborough", zoneId: "cr-zone-7", parkingRate: 4.00 },
  { label: "Weymouth Landing/East Braintree", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Whitman", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "Wickford Junction", zoneId: "cr-zone-10", parkingRate: null },
  { label: "Wilmington", zoneId: "cr-zone-3", parkingRate: 4.00 },
  { label: "Winchester Center", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Windsor Gardens", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Worcester", zoneId: "cr-zone-8", parkingRate: 15.00 },
  { label: "Wyoming Hill", zoneId: "cr-zone-1", parkingRate: null },
];

function mbtaGetStation(label) {
  const needle = (label || "").trim().toLowerCase();
  if (!needle) return null;
  return MBTA_STATIONS.find((s) => s.label.toLowerCase() === needle) || null;
}

/* ------------------------------------------------------------
   2. CALC LOGIC
   Pure functions: config + inputs in, numbers out. No DOM access.
   ------------------------------------------------------------ */

function mbtaGetPassOption(config, passId) {
  return config.passOptions.find((p) => p.id === passId);
}

/** Resolves a pass's actual fare/price for right now: the Reduced Fare
 * figures when reducedFare is true, the regular ones otherwise. Mirrors
 * the regular-vs-reduced split BU's fork introduced, now generalized
 * here. */
function mbtaResolvePassPrice(pass, reducedFare) {
  if (reducedFare) {
    return { oneWayFare: pass.reducedOneWayFare, monthlyPrice: pass.reducedMonthlyPrice };
  }
  return { oneWayFare: pass.oneWayFare, monthlyPrice: pass.monthlyPrice };
}

/** Total monthly pay-per-ride cost for a given number of ONE-WAY
 * trips/week. The UI question asks for round-trips, not one-way trips —
 * callers must double it before calling this (see renderEmployee()). */
function mbtaCalcPayPerRideTotal(oneWayFare, oneWayTripsPerWeek, weeksPerMonth) {
  return oneWayFare * oneWayTripsPerWeek * weeksPerMonth;
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

/** MBTA park-and-ride cost at the selected Commuter Rail station, for
 * someone who drives to their station and parks there — an ADD-ON to the
 * pass/ride cost, not a discount on it, itemized the same two-line way as
 * the rest of this tool (full cost, then whatever's subtracted from it —
 * here nothing is, since MBTA's own parking isn't subsidized the way the
 * pass itself can be). daysPerWeek is its own direct question (0-7), not
 * derived from tripsPerWeek, which has no day-count ceiling to divide by. */
function mbtaCalcStationParking(stationLabel, daysPerWeek) {
  const station = mbtaGetStation(stationLabel);
  if (!station || station.parkingRate == null || !daysPerWeek) return null;
  const monthlyCost = station.parkingRate * daysPerWeek * MBTA_CONFIG.weeksPerMonth;
  return { rate: station.parkingRate, daysPerWeek, monthlyCost };
}

/** Employer view, single pass (Subway & Bus, always just LinkPass): cost of
 * subsidizing a monthly pass across a flat headcount. Reuses the same
 * subsidy-then-pre-tax breakdown as the employee view, but reads the pieces
 * from the employer's angle: the subsidy amount is what the employer pays,
 * and subsidy + pre-tax together is what each employee saves.
 * The Commuter Rail promo never applies here — bulk/employer-administered
 * pass orders aren't eligible for that individual retail promo, so this
 * always prices off the full sticker price regardless of config.promo. */
function mbtaCalcEmployer(config, passId, contributionPct, perqPct, employeeCount) {
  const pass = mbtaGetPassOption(config, passId);
  if (!pass) {
    return {
      pass: null,
      passPrice: 0,
      promoApplies: false,
      perEmployeeMonth: 0,
      totalMonth: 0,
      totalYear: 0,
      employeesShareAmt: 0,
      employeeSavesMonth: 0,
      perqIncluded: perqPct > 0,
      contributes: contributionPct > 0,
    };
  }
  const passPrice = pass.monthlyPrice;
  const b = mbtaCalcBreakdown(passPrice, contributionPct, perqPct);
  const perEmployeeMonth = b.subsidyAmt;
  const totalMonth = perEmployeeMonth * employeeCount;
  return {
    pass,
    passPrice,
    promoApplies: false,
    perEmployeeMonth,
    totalMonth,
    totalYear: totalMonth * 12,
    employeesShareAmt: b.afterSubsidy * employeeCount,
    employeeSavesMonth: b.subsidyAmt + b.pretaxAmt,
    perqIncluded: perqPct > 0,
    contributes: contributionPct > 0,
  };
}

/** Clamps a typed zone-headcount value to a safe whole number: no letters
 * (Number() on non-numeric text is NaN), no negatives, no zero, no decimals,
 * capped at the same ceiling the flat headcount stepper uses. An empty
 * field (nothing typed yet) sanitizes to 0, not 1 — that's what lets a
 * not-yet-filled-in row stay excluded from the total instead of silently
 * counting as one employee, and what lets the placeholder text keep
 * showing until something real is typed. */
function mbtaSanitizeZoneCount(rawValue) {
  if (rawValue === "" || rawValue == null) return 0;
  const n = Math.floor(Number(rawValue));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MBTA_CONFIG.employeeCountMax);
}

/** Employer view, Commuter Rail: cost of subsidizing passes across a
 * workforce spread across one or more zones. zoneRows is
 * [{ passId, count }, ...] — one entry per zone row in the UI. The
 * Commuter Rail promo never applies here, same reasoning as
 * mbtaCalcEmployer() above — totalRaw always prices off full sticker. */
function mbtaCalcEmployerMultiZone(config, zoneRows, contributionPct, perqPct) {
  let totalSticker = 0;
  let totalCount = 0;
  const zoneBreakdown = [];

  zoneRows.forEach(({ passId, count }) => {
    const pass = mbtaGetPassOption(config, passId);
    if (!pass || count < 1) return;
    totalSticker += pass.monthlyPrice * count;
    totalCount += count;
    zoneBreakdown.push({
      label: pass.label,
      count,
      unitPrice: pass.monthlyPrice,
      subtotal: pass.monthlyPrice * count,
      zoneOrder: config.passOptions.indexOf(pass),
    });
  });

  zoneBreakdown.sort((a, b) => a.zoneOrder - b.zoneOrder);

  const b = mbtaCalcBreakdown(totalSticker, contributionPct, perqPct);
  const totalMonth = b.subsidyAmt;
  const employeesShareAmt = b.afterSubsidy;
  const perEmployeeMonth = totalCount > 0 ? totalMonth / totalCount : 0;
  const employeeSavesMonth = totalCount > 0 ? (b.subsidyAmt + b.pretaxAmt) / totalCount : 0;

  return {
    totalSticker,
    totalRaw: totalSticker,
    promoAmt: 0,
    employeesShareAmt,
    totalMonth,
    totalYear: totalMonth * 12,
    perEmployeeMonth,
    employeeSavesMonth,
    zoneBreakdown,
    perqIncluded: perqPct > 0,
    contributes: contributionPct > 0,
    promoApplies: false,
    totalCount,
  };
}

/** Bundles every derived number the UI needs for both options + inputs,
 * Reduced Fare is its own itemized deduction (regular sticker price
 * always shown first), same waterfall pattern the promo and subsidy/Perq
 * lines already use. tripsPerWeek here is in ONE-WAY units — the caller
 * (renderEmployee()) doubles the round-trips/week stepper value before
 * passing it in. */
function mbtaCalcAll(config, passId, tripsPerWeek, subsidyPct, perqPct, reducedFare) {
  const pass = mbtaGetPassOption(config, passId);
  if (!pass) {
    const zeroBreakdown = mbtaCalcBreakdown(0, subsidyPct, perqPct);
    return {
      pass: null,
      passBreakdown: zeroBreakdown,
      rideBreakdown: zeroBreakdown,
      winner: "pass",
      annualSavings: 0,
      promoApplies: false,
      promoOriginalPrice: 0,
      passRegularTotal: 0,
      rideRegularTotal: 0,
      reducedFareDiscount: 0,
      rideReducedFareDiscount: 0,
    };
  }

  const regular = mbtaResolvePassPrice(pass, false);
  const resolved = reducedFare ? mbtaResolvePassPrice(pass, true) : regular;

  const rideRegularTotal = mbtaCalcPayPerRideTotal(regular.oneWayFare, tripsPerWeek, config.weeksPerMonth);
  const rideReducedTotal = mbtaCalcPayPerRideTotal(resolved.oneWayFare, tripsPerWeek, config.weeksPerMonth);

  // The promo discounts the monthly pass itself, not pay-per-ride fares, so
  // it's applied before the subsidy/pre-tax breakdown runs on the pass side
  // only — subsidy and Perq then apply on top of the already-discounted
  // (and, if applicable, already-Reduced-Fare) price.
  const promoApplies = mbtaPromoApplies(config, passId);
  const passPrice = promoApplies
    ? resolved.monthlyPrice * (1 - config.promo.discountPct / 100)
    : resolved.monthlyPrice;

  const passBreakdown = mbtaCalcBreakdown(passPrice, subsidyPct, perqPct);
  const rideBreakdown = mbtaCalcBreakdown(rideReducedTotal, subsidyPct, perqPct);

  const winner = passBreakdown.finalCost <= rideBreakdown.finalCost ? "pass" : "ride";
  const monthlyDiff = Math.abs(passBreakdown.finalCost - rideBreakdown.finalCost);

  return {
    pass, passBreakdown, rideBreakdown, winner,
    annualSavings: monthlyDiff * 12, promoApplies, promoOriginalPrice: resolved.monthlyPrice,
    passRegularTotal: regular.monthlyPrice,
    rideRegularTotal,
    reducedFareDiscount: regular.monthlyPrice - resolved.monthlyPrice,
    rideReducedFareDiscount: rideRegularTotal - rideReducedTotal,
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
  let routeType = "subway"; // "subway" | "rail" | "ferry"
  let passTier = "linkpass"; // "local-bus" | "linkpass" — Subway & Bus sub-choice
  let ferryRouteId = "ferry-winthrop-quincy";
  let tripsPerWeek = MBTA_CONFIG.defaultTripsPerWeek;
  let subsidyPct = MBTA_CONFIG.defaultSubsidyPct;
  let perqAnswer = null; // null | "yes" | "no" — null means unanswered
  let perqEnabled = false;
  let perqPct = MBTA_CONFIG.defaultPerqPct;
  let employeeCount = MBTA_CONFIG.defaultEmployeeCount;
  let reducedFare = false;
  let stationParking = false;
  let stationParkingDays = 3;

  // ---- W3C ARIA "combobox with list autocomplete" pattern — the
  // documented accessible way to build a type-ahead search field with a
  // popup list (https://www.w3.org/WAI/ARIA/apg/patterns/combobox/), not
  // a bespoke invention. Used instead of a native <input list> datalist
  // because a datalist's suggestion popup is drawn entirely by the
  // browser/OS, so this tool has no real styling control over it. This
  // listbox is a plain <ul> this file fully owns, reused for both the
  // organization field and the Commuter Rail station field. onChange
  // fires on every value change (typed or selected). ----
  function initCombobox(input, listbox, getOptions, onChange) {
    if (!input || !listbox) return;
    let options = [];
    let activeIndex = -1;

    function renderOptions(matches) {
      listbox.innerHTML = "";
      options = matches;
      if (matches.length === 0) {
        const li = document.createElement("li");
        li.className = "abc-farecalc-combobox-empty";
        li.textContent = "No matches";
        listbox.appendChild(li);
        return;
      }
      matches.forEach((label, i) => {
        const li = document.createElement("li");
        li.className = "abc-farecalc-combobox-option";
        li.id = `${listbox.id}-opt-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", i === activeIndex ? "true" : "false");
        li.textContent = label;
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectValue(label);
        });
        listbox.appendChild(li);
      });
    }

    function openWithQuery(query) {
      const q = query.trim().toLowerCase();
      const matches = q === "" ? [] : getOptions().filter((label) => label.toLowerCase().includes(q));
      activeIndex = -1;
      renderOptions(matches);
      const shouldOpen = q !== "";
      listbox.hidden = !shouldOpen;
      input.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    }

    function close() {
      listbox.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      activeIndex = -1;
    }

    function selectValue(label) {
      input.value = label;
      close();
      onChange(label);
      input.blur();
    }

    function moveActive(delta) {
      if (options.length === 0) return;
      activeIndex = (activeIndex + delta + options.length) % options.length;
      Array.from(listbox.children).forEach((li, i) => li.setAttribute("aria-selected", i === activeIndex ? "true" : "false"));
      const activeEl = listbox.children[activeIndex];
      if (activeEl) {
        input.setAttribute("aria-activedescendant", activeEl.id);
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }

    input.addEventListener("input", () => {
      openWithQuery(input.value);
      onChange(input.value.trim());
    });
    input.addEventListener("focus", () => openWithQuery(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (listbox.hidden) openWithQuery(input.value);
        moveActive(1);
      } else if (e.key === "ArrowUp") {
        if (!listbox.hidden) { e.preventDefault(); moveActive(-1); }
      } else if (e.key === "Enter") {
        if (!listbox.hidden && activeIndex >= 0 && options[activeIndex]) {
          e.preventDefault();
          selectValue(options[activeIndex]);
        }
      } else if (e.key === "Escape") {
        close();
      }
    });
    input.addEventListener("blur", close);
  }

  /** Rounds one line to a whole dollar, writes it (with an optional "-"
   * prefix) to the given element, and returns the signed rounded amount.
   * Card totals are built by chaining calls to this and accumulating the
   * return values into a running remainder, so the final line a card
   * shows is always the exact sum of the rounded lines printed above it. */
  function roundAndShow(selector, rawAmount, isDeduction) {
    const el = rootEl.querySelector(selector);
    const rounded = abcRoundToDollar(Math.abs(rawAmount));
    if (el) el.textContent = `${isDeduction ? "-" : ""}${abcFormatCurrencyWhole(rounded)}`;
    return isDeduction ? -rounded : rounded;
  }

  // Mode toggle: swaps copy/fields/results between the employee and employer
  // views. Copy and field visibility are driven off the root's data-abc-mode
  // attribute in CSS; this just flips the attribute and re-renders.
  const modeButtons = rootEl.querySelectorAll("[data-abc-mode-select]");
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.abcModeSelect;
      modeButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      rootEl.setAttribute("data-abc-mode", mode);
      // Reduced Fare and station parking are employee-only controls, but
      // the underlying state isn't tied to visibility — reset both here
      // too, so a box checked while in employee mode can never silently
      // keep affecting an employer-mode calculation with no visible
      // control left to undo it.
      if (mode === "employer") {
        reducedFare = false;
        if (reducedFareCheckbox) reducedFareCheckbox.checked = false;
        stationParking = false;
        if (stationParkingCheckbox) stationParkingCheckbox.checked = false;
        updateStationParkingFieldVisibility();
      }
      updateAdvocacy();
      render();
    });
  });

  const routeButtons = rootEl.querySelectorAll("[data-abc-route-select]");
  const railZoneField = rootEl.querySelector("[data-abc-rail-zone-field]");
  const railZoneSelect = rootEl.querySelector("[data-abc-rail-zone-select]");
  const subwayTierField = rootEl.querySelector("[data-abc-subway-tier-field]");
  const ferryRouteField = rootEl.querySelector("[data-abc-ferry-route-field]");

  // ---- Subway & Bus pass-tier pop-out (Bus Pass / LinkPass) ----
  const tierButtons = rootEl.querySelectorAll("[data-abc-pass-tier-select]");
  tierButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      passTier = btn.dataset.abcPassTierSelect;
      tierButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      render();
    });
  });

  // ---- Ferry route pop-out (Winthrop/Quincy / Lynn / Hingham/Hull) ----
  const ferryRouteButtons = rootEl.querySelectorAll("[data-abc-ferry-route-select]");
  ferryRouteButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      ferryRouteId = btn.dataset.abcFerryRouteSelect;
      ferryRouteButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      render();
    });
  });

  // Commuter Rail promo: whether it's still running at all is fixed for
  // the whole session, computed once here; whether it actually SHOWS
  // (badge and callout both) also depends on mode and which pass is
  // selected (Zone 1A excluded, employer mode never qualifies), so both
  // are recomputed in updatePromoUI() below on every render.
  const promoActive = mbtaPromoIsActive(MBTA_CONFIG);
  const promoBadge = rootEl.querySelector("[data-abc-promo-badge]");

  // Employer-mode purchases don't qualify for this promo (bulk/employer-
  // administered orders aren't eligible for the individual retail
  // discount — see mbtaCalcEmployer()'s doc comment), so neither the
  // route-button badge nor the detailed callout show while in employer
  // mode, even though the promo is otherwise time-active.
  function updatePromoUI() {
    if (promoBadge) promoBadge.style.display = (promoActive && mode === "employee") ? "" : "none";
    const callout = rootEl.querySelector("[data-abc-promo-callout]");
    if (!callout) return;
    const applies = promoActive && mode === "employee" && routeType === "rail" && !MBTA_CONFIG.promo.excludeZoneIds.includes(currentPassId());
    callout.style.display = applies ? "block" : "none";
    if (applies) {
      const days = mbtaPromoDaysLeft(MBTA_CONFIG);
      rootEl.querySelector("[data-abc-promo-days]").textContent = `${days} day${days === 1 ? "" : "s"} left`;
    }
  }

  // Populate the rail zone dropdown from config (everything except
  // linkpass), starting on an unselected "Select zone" placeholder rather
  // than defaulting to a real zone.
  function populateZoneSelect(select) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select zone";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
    MBTA_CONFIG.passOptions
      .filter((p) => p.group === "rail")
      .forEach((pass) => {
        const opt = document.createElement("option");
        opt.value = pass.id;
        opt.textContent = pass.label;
        select.appendChild(opt);
      });
  }
  populateZoneSelect(railZoneSelect);

  // ---- Commuter Rail station search (employee mode): resolves to a
  // standard zone (1A-10) under the hood via MBTA_STATIONS, the same
  // friendlier front end BU's fork introduced — someone picks
  // "Framingham" instead of knowing it's "Zone 5". Employer mode keeps
  // the zone-based dropdown (an employer sets a policy per zone/
  // Interzone, not per individual's station) — Interzone fares are only
  // reachable through that dropdown, since MBTA_STATIONS doesn't cover
  // them. ----
  const stationInput = rootEl.querySelector("[data-abc-station-input]");
  const stationListbox = rootEl.querySelector("[data-abc-station-listbox]");
  initCombobox(
    stationInput,
    stationListbox,
    () => MBTA_STATIONS.map((s) => s.label),
    () => { updateStationParkingFieldVisibility(); render(); }
  );

  function currentStationLabel() {
    return stationInput ? stationInput.value.trim() : "";
  }

  function employeeRailPassId() {
    const station = mbtaGetStation(currentStationLabel());
    return station ? station.zoneId : "";
  }

  // ---- Station parking checkbox + its own direct "how many days a
  // week" question: only shown for a station that actually has an MBTA
  // park-and-ride lot. Hidden whenever that's not true, and reset to
  // unchecked whenever it's hidden, so a hidden control never silently
  // keeps affecting the price. The days question is fully independent of
  // tripsPerWeek, which has no day-count ceiling to derive one from. ----
  const stationParkingField = rootEl.querySelector("[data-abc-station-parking-field]");
  const stationParkingCheckbox = rootEl.querySelector("[data-abc-station-parking-toggle]");
  const stationParkingDaysField = rootEl.querySelector("[data-abc-station-parking-days-field]");

  function updateStationParkingFieldVisibility() {
    if (!stationParkingField) return;
    const station = routeType === "rail" && mode === "employee" ? mbtaGetStation(currentStationLabel()) : null;
    const hasParking = !!(station && station.parkingRate != null);
    stationParkingField.style.display = hasParking ? "flex" : "none";
    if (!hasParking && stationParking) {
      stationParking = false;
      if (stationParkingCheckbox) stationParkingCheckbox.checked = false;
    }
    if (stationParkingDaysField) stationParkingDaysField.style.display = hasParking && stationParking ? "block" : "none";
  }

  if (stationParkingCheckbox) {
    stationParkingCheckbox.addEventListener("change", () => {
      stationParking = stationParkingCheckbox.checked;
      updateStationParkingFieldVisibility();
      if (stationParkingDaysStepper) stationParkingDaysStepper.repaint();
      render();
    });
  }

  function currentPassId() {
    if (routeType === "subway") return passTier;
    if (routeType === "ferry") return ferryRouteId;
    if (mode === "employee") return employeeRailPassId();
    return railZoneSelect.value;
  }

  // ---- Reduced Fare toggle: applies across Subway & Bus and Commuter
  // Rail alike (MBTA's reduced program spans both). Employee mode only —
  // employer-subsidized programs aren't individually means-tested. ----
  const reducedFareCheckbox = rootEl.querySelector("[data-abc-reduced-fare-toggle]");
  if (reducedFareCheckbox) {
    reducedFareCheckbox.addEventListener("change", () => {
      reducedFare = reducedFareCheckbox.checked;
      render();
    });
  }

  // ---- Employer multi-zone breakdown (Commuter Rail only) ----
  const zonerowsExtra = rootEl.querySelector("[data-abc-zonerows-extra]");
  const addZoneBtn = rootEl.querySelector("[data-abc-add-zone]");
  const countField = rootEl.querySelector("[data-abc-count-field]");

  function wireZoneCountInput(input) {
    input.addEventListener("input", render);
    input.addEventListener("blur", () => {
      if (input.value.trim() === "") return;
      input.value = mbtaSanitizeZoneCount(input.value);
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
    input.placeholder = "Number of employees in this zone";
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

  function getZoneRows() {
    const firstRow = rootEl.querySelector("[data-abc-zonerow]");
    const extraRows = zonerowsExtra ? Array.from(zonerowsExtra.querySelectorAll("[data-abc-zonerow]")) : [];
    return firstRow ? [firstRow, ...extraRows] : extraRows;
  }

  function readZoneRow(rowEl) {
    const select = rowEl.querySelector("select");
    const input = rowEl.querySelector(".abc-farecalc-zonecount-input");
    return {
      passId: select ? select.value : "",
      count: input ? mbtaSanitizeZoneCount(input.value) : 1,
    };
  }

  const maxZoneRows = MBTA_CONFIG.passOptions.filter((p) => p.group === "rail").length;

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

  function updateRouteVisibility() {
    railZoneField.style.display = routeType === "rail" ? "" : "none";
    if (subwayTierField) subwayTierField.style.display = routeType === "subway" ? "" : "none";
    if (ferryRouteField) ferryRouteField.style.display = routeType === "ferry" ? "" : "none";
    if (countField) countField.style.display = routeType === "rail" ? "none" : "";
    updateStationParkingFieldVisibility();
    rootEl.classList.toggle("abc-theme-rail", routeType === "rail");
    rootEl.classList.toggle("abc-theme-ferry", routeType === "ferry");
  }

  routeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      routeType = btn.dataset.abcRouteSelect;
      routeButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      updateRouteVisibility();
      render();
    });
  });
  updateRouteVisibility();

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

  function updateAdvocacy() {
    perqAdvocacy.style.display = (perqAnswer === "no" && mode === "employee") ? "block" : "none";
  }

  // Generic stepper wiring. min/max default to a 0-100 percentage; max
  // can be a plain number or a function (trips/week has no cap, so it's
  // left out entirely in that call below).
  function initStepper(rootAttr, step, getValue, setValue, min = 0, max = 100) {
    const stepperEl = rootEl.querySelector(`[${rootAttr}]`);
    if (!stepperEl) return null;
    const input = stepperEl.querySelector("[data-abc-stepper-value]");
    const minusBtn = stepperEl.querySelector("[data-abc-stepper-minus]");
    const plusBtn = stepperEl.querySelector("[data-abc-stepper-plus]");

    function currentMax() { return typeof max === "function" ? max() : max; }
    function paint() {
      input.value = getValue();
      const m = currentMax();
      if (Number.isFinite(m)) input.setAttribute("max", m); else input.removeAttribute("max");
    }
    minusBtn.addEventListener("click", () => {
      setValue(Math.max(min, getValue() - step));
      paint();
      render();
    });
    plusBtn.addEventListener("click", () => {
      setValue(Math.min(currentMax(), getValue() + step));
      paint();
      render();
    });
    input.addEventListener("input", () => {
      const raw = Number(input.value);
      if (!Number.isNaN(raw)) {
        setValue(Math.min(currentMax(), Math.max(min, raw)));
        render();
      }
    });
    input.addEventListener("blur", paint);
    paint();
    return { repaint: paint };
  }

  initStepper(
    "data-abc-trips-stepper",
    MBTA_CONFIG.tripsStep,
    () => tripsPerWeek,
    (v) => { tripsPerWeek = v; },
    0,
    Infinity
  );
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
  const stationParkingDaysStepper = initStepper(
    "data-abc-station-parking-days-stepper",
    1,
    () => stationParkingDays,
    (v) => { stationParkingDays = v; },
    0,
    7
  );

  function render() {
    updatePromoUI();
    if (mode === "employer") renderEmployer();
    else renderEmployee();
  }

  function renderEmployee() {
    const effectivePerqPct = perqEnabled ? perqPct : 0;
    // tripsPerWeek is round-trips/week; every fare calc below needs
    // one-way trips, so it's doubled once, right here.
    const oneWayTripsPerWeek = tripsPerWeek * 2;
    const result = mbtaCalcAll(MBTA_CONFIG, currentPassId(), oneWayTripsPerWeek, subsidyPct, effectivePerqPct, reducedFare);

    // ---- Pay-Per-Ride card ----
    const rideTotalLabelEl = rootEl.querySelector("[data-abc-ride-total-label]");
    if (rideTotalLabelEl && result.pass) {
      const fare = reducedFare ? result.pass.reducedOneWayFare : result.pass.oneWayFare;
      rideTotalLabelEl.textContent =
        `Total monthly cost (${abcFormatCurrency(fare)}/trip × ${oneWayTripsPerWeek} one-way trip${oneWayTripsPerWeek === 1 ? "" : "s"}/week × ${MBTA_CONFIG.weeksPerMonth} weeks/month)`;
    }
    let rideRemaining = roundAndShow("[data-abc-ride-total]", result.rideRegularTotal, false);
    const rideReducedRow = rootEl.querySelector("[data-abc-ride-reduced-row]");
    if (reducedFare && result.rideReducedFareDiscount > 0.005) {
      rideRemaining += roundAndShow("[data-abc-ride-reduced-amt]", result.rideReducedFareDiscount, true);
      rideReducedRow.style.display = "flex";
    } else {
      rideReducedRow.style.display = "none";
    }
    rootEl.querySelector("[data-abc-ride-subsidy-label]").textContent = `Employer subsidy (${subsidyPct}%)`;
    rideRemaining += roundAndShow("[data-abc-ride-subsidy-amt]", result.rideBreakdown.subsidyAmt, true);
    const ridePretaxRow = rootEl.querySelector("[data-abc-ride-pretax-row]");
    if (effectivePerqPct > 0) {
      rootEl.querySelector("[data-abc-ride-pretax-label]").textContent = `Pre-tax savings (${effectivePerqPct}%)`;
      rideRemaining += roundAndShow("[data-abc-ride-pretax-amt]", result.rideBreakdown.pretaxAmt, true);
      ridePretaxRow.style.display = "flex";
    } else {
      ridePretaxRow.style.display = "none";
    }

    // ---- Monthly Pass card ----
    let passRemaining = roundAndShow("[data-abc-pass-total]", result.passRegularTotal, false);
    const passReducedRow = rootEl.querySelector("[data-abc-pass-reduced-row]");
    if (reducedFare && result.reducedFareDiscount > 0.005) {
      passRemaining += roundAndShow("[data-abc-pass-reduced-amt]", result.reducedFareDiscount, true);
      passReducedRow.style.display = "flex";
    } else {
      passReducedRow.style.display = "none";
    }
    const promoRow = rootEl.querySelector("[data-abc-pass-promo-row]");
    if (result.promoApplies) {
      const promoAmt = result.promoOriginalPrice - result.passBreakdown.total;
      rootEl.querySelector("[data-abc-pass-promo-label]").textContent = `Commuter Rail promo (${MBTA_CONFIG.promo.discountPct}%)`;
      passRemaining += roundAndShow("[data-abc-pass-promo-amt]", promoAmt, true);
      promoRow.style.display = "flex";
    } else {
      promoRow.style.display = "none";
    }
    rootEl.querySelector("[data-abc-pass-subsidy-label]").textContent = `Employer subsidy (${subsidyPct}%)`;
    passRemaining += roundAndShow("[data-abc-pass-subsidy-amt]", result.passBreakdown.subsidyAmt, true);
    const passPretaxRow = rootEl.querySelector("[data-abc-pass-pretax-row]");
    if (effectivePerqPct > 0) {
      rootEl.querySelector("[data-abc-pass-pretax-label]").textContent = `Pre-tax savings (${effectivePerqPct}%)`;
      passRemaining += roundAndShow("[data-abc-pass-pretax-amt]", result.passBreakdown.pretaxAmt, true);
      passPretaxRow.style.display = "flex";
    } else {
      passPretaxRow.style.display = "none";
    }

    // ---- MBTA station parking: add-on, folded into both cards' running
    // remainders since whichever option wins, the same parking cost applies. ----
    const parking = (routeType === "rail" && stationParking)
      ? mbtaCalcStationParking(currentStationLabel(), stationParkingDays)
      : null;
    ["ride", "pass"].forEach((prefix) => {
      const row = rootEl.querySelector(`[data-abc-${prefix}-parking-row]`);
      if (!row) return;
      if (parking) {
        rootEl.querySelector(`[data-abc-${prefix}-parking-label]`).textContent =
          `MBTA station parking (${abcFormatCurrency(parking.rate)}/day × ${parking.daysPerWeek} day${parking.daysPerWeek === 1 ? "" : "s"}/week × ${MBTA_CONFIG.weeksPerMonth} weeks/month)`;
        const addAmt = roundAndShow(`[data-abc-${prefix}-parking-amt]`, parking.monthlyCost, false);
        if (prefix === "ride") rideRemaining += addAmt; else passRemaining += addAmt;
        row.style.display = "flex";
      } else {
        row.style.display = "none";
      }
    });

    rootEl.querySelector("[data-abc-ride-final]").textContent = abcFormatCurrencyWhole(rideRemaining);
    rootEl.querySelector("[data-abc-pass-final]").textContent = abcFormatCurrencyWhole(passRemaining);

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
    winnerCard.querySelector("[data-abc-savings-amt]").textContent = abcFormatCurrencyWhole(abcRoundToDollar(result.annualSavings));
    winnerCard.querySelector("[data-abc-savings-vs]").textContent = otherOptionLabel;
    loserCard.querySelector("[data-abc-savings-line]").style.display = "none";
  }

  function renderEmployer() {
    let r;
    let zoneBreakdown = [];

    if (routeType === "rail") {
      const zoneRows = getZoneRows().map(readZoneRow);
      const multi = mbtaCalcEmployerMultiZone(MBTA_CONFIG, zoneRows, subsidyPct, perqEnabled ? perqPct : 0);
      r = multi;
      zoneBreakdown = multi.zoneBreakdown;
    } else {
      const single = mbtaCalcEmployer(MBTA_CONFIG, currentPassId(), subsidyPct, perqEnabled ? perqPct : 0, employeeCount);
      r = {
        totalSticker: single.pass ? single.pass.monthlyPrice * employeeCount : 0,
        promoAmt: 0,
        employeesShareAmt: single.employeesShareAmt,
        totalMonth: single.totalMonth,
        perEmployeeMonth: single.perEmployeeMonth,
        employeeSavesMonth: single.employeeSavesMonth,
        perqIncluded: single.perqIncluded,
        contributes: single.contributes,
        promoApplies: false,
      };
    }

    let empRemaining = roundAndShow("[data-abc-emp-total]", r.totalSticker, false);

    const promoRow = rootEl.querySelector("[data-abc-emp-promo-row]");
    if (r.promoApplies) {
      rootEl.querySelector("[data-abc-emp-promo-label]").textContent = `Commuter Rail promo (${MBTA_CONFIG.promo.discountPct}%)`;
      empRemaining += roundAndShow("[data-abc-emp-promo-amt]", r.promoAmt, true);
      promoRow.style.display = "flex";
    } else {
      promoRow.style.display = "none";
    }

    const employeesSharePct = 100 - subsidyPct;
    rootEl.querySelector("[data-abc-emp-share-label]").textContent = `Employees' share (${employeesSharePct}%)`;
    empRemaining += roundAndShow("[data-abc-emp-share-amt]", r.employeesShareAmt, true);

    rootEl.querySelector("[data-abc-emp-final]").textContent = abcFormatCurrencyWhole(empRemaining);
    rootEl.querySelector("[data-abc-emp-saves]").textContent = abcFormatCurrencyWhole(abcRoundToDollar(r.employeeSavesMonth));

    const breakdownEl = rootEl.querySelector("[data-abc-zone-breakdown]");
    if (breakdownEl) {
      breakdownEl.innerHTML = "";
      if (zoneBreakdown.length > 1) {
        zoneBreakdown.forEach((zone) => {
          const row = document.createElement("div");
          row.className = "abc-farecalc-line abc-farecalc-zone-breakdown-line";
          const label = document.createElement("span");
          label.textContent = `${zone.label} (${abcFormatCurrencyWhole(zone.unitPrice)} × ${abcFormatNumber(zone.count)} employee${zone.count === 1 ? "" : "s"})`;
          const amt = document.createElement("span");
          amt.textContent = abcFormatCurrencyWhole(zone.subtotal);
          row.appendChild(label);
          row.appendChild(amt);
          breakdownEl.appendChild(row);
        });
      }
    }

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
  // files, so there's nothing self-contained to copy from there.
  const embedBtn = rootEl.querySelector("[data-abc-embed-btn]");
  if (embedBtn) {
    const originalLabel = embedBtn.textContent;
    let revertTimer = null;

    async function getEmbedHtml() {
      try {
        const res = await fetch(window.location.href);
        if (!res.ok) throw new Error("fetch failed");
        return await res.text();
      } catch (err) {
        const styleTag = document.querySelector("style");
        const scriptTag = document.querySelector("script:not([src])");
        const parts = [];
        if (styleTag) parts.push(`<style>${styleTag.textContent}<\/style>`);
        parts.push(rootEl.outerHTML);
        if (scriptTag) parts.push(`<script>${scriptTag.textContent}<\/script>`);
        return parts.join("\n");
      }
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
      try {
        const html = await getEmbedHtml();
        const copied = await copyToClipboard(html);
        if (!copied) throw new Error("copy failed");
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

  render();
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-abc-farecalc-root]");
  if (root) mbtaInitCalculator(root);
});
