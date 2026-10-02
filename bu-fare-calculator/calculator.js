/* ============================================================
   BU Fare Calculator
   Bespoke Boston University fork of the MBTA Fare Calculator.
   Split into four sections: CONFIG, STATIONS, CALC LOGIC, UI/RENDER.
   Depends on shared/utils/format.js being loaded first.

   Fork note: this file intentionally does NOT track mbta-fare-calculator's
   calculator.js going forward. BU's benefit structure is materially
   different (fixed subsidy, Edenred not Perq, Reduced Fare, driving
   comparison), so this is a separate codebase that happens to share its
   starting architecture, not a variant kept in lockstep with it.
   ============================================================ */

/* ------------------------------------------------------------
   1. CONFIG
   ------------------------------------------------------------ */
const BU_CONFIG = {
  fareSource: {
    url: "https://www.mbta.com/fares",
    lastVerified: "2026-10-01",
    note:
      "Local Bus and LinkPass prices pulled from mbta.com/fares/bus-fares " +
      "and mbta.com/fares/subway-fares. Note: Express Bus fares merged into " +
      "Local Bus pricing on a pilot basis starting 2026-09-01, so there is " +
      "no separate Express Bus tier here. Commuter Rail zone prices pulled " +
      "from mbta.com/fares/commuter-rail-fares. Reduced Fare LinkPass/bus " +
      "and the Zone 1A / Zone 10 Commuter Rail reduced prices are confirmed " +
      "from mbta.com/fares/reduced. Reduced Fare prices for CR zones 1-9 " +
      "are NOT individually confirmed — MBTA's reduced page only publishes " +
      "the range ($30–$209/mo, $1.10–$6.50/ride) and directs to a tariff " +
      "document. The zones 1-9 figures below are derived by applying the " +
      "same ratio implied by the two confirmed endpoints (zone 1A and zone " +
      "10) across the regular-price table. Verify against MBTA's official " +
      "tariff before relying on these for anything official.",
  },

  // BU covers a fixed 50% of the pass cost, administered through Edenred
  // (not Perq — confirmed on bu.edu/transportation/public-transit/
  // employee-mbta-benefits/). There is no subsidy question in this build;
  // every calculation below uses this constant directly.
  subsidyPct: 50,

  enrollment: {
    platform: "Edenred",
    url: "https://www.bu.edu/transportation/public-transit/employee-mbta-benefits/",
    note: "Enroll, modify, or cancel by the 10th of the month for the following month, through Edenred.",
  },

  // No visible org field in this build (it's always Boston University) —
  // see the hardcoded sessionOrg in buInitCalculator below.
  analytics: {
    endpoint: "https://airtable-calc-automation.oouadani.workers.dev/",
  },

  // 52 weeks in a year ÷ 12 months — the plainest version of this number
  // to explain to someone looking at the math (vs. the more precise but
  // harder-to-explain 365.25/7/12 = 4.345, which only differs by a
  // fraction of a percent). Stated explicitly in the footer accordion.
  weeksPerMonth: 52 / 12,

  // Trip frequency is a direct numeric input (typed or +/-1 stepper), not a
  // button grid — wide enough to cover weekend-only, midday-only, one-way-
  // only, or more-than-5-day patterns that a 1-5 day grid couldn't capture.
  tripsStep: 1,
  tripsMax: 20,
  defaultTripsPerWeek: 6, // equivalent to a 3-day round-trip commute

  employeeCountStep: 5,
  employeeCountMax: 100000,
  defaultEmployeeCount: 25,

  // Temporary Commuter Rail promo: 50% off monthly passes, Zone 1A
  // excluded. Still applies to BU employees same as everyone else; BU's
  // subsidy and the promo stack (promo first, then BU's 50%).
  promo: {
    discountPct: 50,
    endDate: "2026-11-30",
    excludeZoneIds: ["cr-zone-1a"],
    infoUrl: "https://www.mbta.com/fares/commuter-rail-summer-promotions",
  },

  // First two entries are the Subway & Bus tier choices (pop-out pills).
  // Everything else is Commuter Rail, shown only when that route is
  // selected. No Interzone entries — BU's own benefits page and the
  // station dataset both only cover the 11 standard zones (1A, 1-10).
  passOptions: [
    { id: "local-bus", label: "Local Bus", group: "subway", oneWayFare: 1.70, monthlyPrice: 55.00, reducedOneWayFare: 0.85, reducedMonthlyPrice: 30.00 },
    { id: "linkpass", label: "LinkPass (Subway & Bus)", group: "subway", oneWayFare: 2.40, monthlyPrice: 90.00, reducedOneWayFare: 1.10, reducedMonthlyPrice: 30.00 },
    { id: "cr-zone-1a", label: "Zone 1A", group: "rail", oneWayFare: 2.40, monthlyPrice: 90.00, reducedOneWayFare: 1.10, reducedMonthlyPrice: 30.00 },
    { id: "cr-zone-1", label: "Zone 1", group: "rail", oneWayFare: 6.50, monthlyPrice: 214.00, reducedOneWayFare: 3.20, reducedMonthlyPrice: 105.00 },
    { id: "cr-zone-2", label: "Zone 2", group: "rail", oneWayFare: 7.00, monthlyPrice: 232.00, reducedOneWayFare: 3.45, reducedMonthlyPrice: 114.00 },
    { id: "cr-zone-3", label: "Zone 3", group: "rail", oneWayFare: 8.00, monthlyPrice: 261.00, reducedOneWayFare: 3.90, reducedMonthlyPrice: 128.00 },
    { id: "cr-zone-4", label: "Zone 4", group: "rail", oneWayFare: 8.75, monthlyPrice: 281.00, reducedOneWayFare: 4.30, reducedMonthlyPrice: 138.00 },
    { id: "cr-zone-5", label: "Zone 5", group: "rail", oneWayFare: 9.75, monthlyPrice: 311.00, reducedOneWayFare: 4.80, reducedMonthlyPrice: 153.00 },
    { id: "cr-zone-6", label: "Zone 6", group: "rail", oneWayFare: 10.50, monthlyPrice: 340.00, reducedOneWayFare: 5.15, reducedMonthlyPrice: 167.00 },
    { id: "cr-zone-7", label: "Zone 7", group: "rail", oneWayFare: 11.00, monthlyPrice: 360.00, reducedOneWayFare: 5.40, reducedMonthlyPrice: 177.00 },
    { id: "cr-zone-8", label: "Zone 8", group: "rail", oneWayFare: 12.25, monthlyPrice: 388.00, reducedOneWayFare: 6.00, reducedMonthlyPrice: 190.00 },
    { id: "cr-zone-9", label: "Zone 9", group: "rail", oneWayFare: 12.75, monthlyPrice: 406.00, reducedOneWayFare: 6.25, reducedMonthlyPrice: 199.00 },
    { id: "cr-zone-10", label: "Zone 10", group: "rail", oneWayFare: 13.25, monthlyPrice: 426.00, reducedOneWayFare: 6.50, reducedMonthlyPrice: 209.00 },
  ],
};

/* Charles River Campus: two flat daily-rate zones (not per-lot pricing —
 * every lot within a zone costs the same). Source: BU's own "Employee FLEX
 * PERMIT" zone map (2026-08), placed in the project folder. Zone 1 has a
 * cheaper weekend rate; this tool uses the weekday rate for the trips-based
 * estimate and surfaces the weekend rate as a note rather than asking for a
 * weekday/weekend trip split, which would reintroduce the same complexity
 * the trip-frequency question was just simplified away from. */
const BU_PARKING_CONFIG = {
  charlesRiver: {
    permitName: "Employee FLEX Permit",
    preTax: true,
    zones: [
      {
        id: "crc-zone-1",
        label: "Zone 1 (east of BU Bridge)",
        weekdayRate: 14.00,
        weekendRate: 10.00,
        lots: ["Lower Bridge Lot", "Upper Bridge Lot", "CAS Lot", "Warren Towers Garage", "575 Commonwealth Avenue", "Rafik B. Hariri Building Garage", "Kenmore Lot", "730/750 Commonwealth Avenue", "766 Commonwealth Avenue"],
      },
      {
        id: "crc-zone-2",
        label: "Zone 2 (west of BU Bridge + Fenway Campus)",
        weekdayRate: 10.00,
        weekendRate: 10.00,
        lots: ["Agganis Arena Garage & Lot", "Langsam Garage", "Agganis Way Lot", "Buick Street Garage & Lot", "CFA Lot", "Essex Street Garage & Lot", "890 Commonwealth Avenue", "25/55/65 Pilgrim Road (Fenway Campus)", "43 Hawes Street Lot"],
      },
    ],
  },
  // Source: Carl Larson (BU Transportation Services) email, 2026. BU's own
  // lots-and-locations page also lists a separate 710 Albany Street Garage
  // (and a 720 Harrison Avenue DOB lot open to the public) on the Medical
  // Campus — those aren't modeled here because no rate for them was ever
  // provided, not because they were deliberately excluded. Add them once a
  // rate is confirmed.
  medical: {
    locations: [
      { id: "crosstown", label: "Crosstown Garage", daily: { rate: 25.00, preTax: false }, monthly: { rate: 249.00, preTax: true } },
      { id: "610-albany", label: "610 Albany Street Garage", monthly: { rate: 181.00, preTax: true } },
    ],
  },
};

/* ------------------------------------------------------------
   2. STATIONS
   Commuter Rail station names, individual/employee mode only — a
   friendlier front end over the same zone pricing, so someone picks
   "Natick Center" instead of knowing it's "Zone 4". Employer mode keeps
   the zone-based dropdown (an employer sets a policy per zone, not per
   station). Source: station dataset the user placed in the project
   folder (Stations_April_2025). Only the station name -> zone mapping is
   used; that file's own per-station price columns are NOT used here, see
   README note in the project memory for why.
   parkingRate is a hook for a future per-station MBTA park-and-ride
   subsidy pilot (BU separately subsidizes 50% of MBTA's own station
   parking fee) — null for every station until that dataset exists; see
   buCalcStationParkingSubsidy() below.
   ------------------------------------------------------------ */
const BU_STATIONS = [
  { label: "Abington", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Anderson/Woburn", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Andover", zoneId: "cr-zone-5", parkingRate: null },
  { label: "Ashland", zoneId: "cr-zone-6", parkingRate: null },
  { label: "Attleboro", zoneId: "cr-zone-7", parkingRate: null },
  { label: "Auburndale", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Ayer", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Back Bay", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Ballardvale", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Bellevue", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Belmont", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Beverly", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Beverly Farms", zoneId: "cr-zone-5", parkingRate: null },
  { label: "Blue Hill Avenue", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Boston Landing", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Bradford", zoneId: "cr-zone-7", parkingRate: null },
  { label: "Braintree", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Brandeis/Roberts", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Bridgewater", zoneId: "cr-zone-6", parkingRate: null },
  { label: "Brockton", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Campello", zoneId: "cr-zone-5", parkingRate: null },
  { label: "Canton Center", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Canton Junction", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Chelsea", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Church Street", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Cohasset", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Concord", zoneId: "cr-zone-5", parkingRate: null },
  { label: "Dedham Corporate Center", zoneId: "cr-zone-2", parkingRate: null },
  { label: "East Taunton", zoneId: "cr-zone-8", parkingRate: null },
  { label: "East Weymouth", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Endicott", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Fairmount", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Fall River Depot", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Fitchburg", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Forest Hills", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Forge Park/495", zoneId: "cr-zone-6", parkingRate: null },
  { label: "Four Corners/Geneva", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Foxboro", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Framingham", zoneId: "cr-zone-5", parkingRate: null },
  { label: "Franklin", zoneId: "cr-zone-6", parkingRate: null },
  { label: "Freetown", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Gloucester", zoneId: "cr-zone-7", parkingRate: null },
  { label: "Grafton", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Greenbush", zoneId: "cr-zone-6", parkingRate: null },
  { label: "Greenwood", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Halifax", zoneId: "cr-zone-7", parkingRate: null },
  { label: "Hamilton/Wenham", zoneId: "cr-zone-5", parkingRate: null },
  { label: "Hanson", zoneId: "cr-zone-6", parkingRate: null },
  { label: "Haverhill", zoneId: "cr-zone-7", parkingRate: null },
  { label: "Hersey", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Highland", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Holbrook/Randolph", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Hyde Park", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Ipswich", zoneId: "cr-zone-6", parkingRate: null },
  { label: "Islington", zoneId: "cr-zone-3", parkingRate: null },
  { label: "JFK/UMass", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Kendal Green", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Kingston", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Lansdowne", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Lawrence", zoneId: "cr-zone-6", parkingRate: null },
  { label: "Lincoln", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Littleton/Route 495", zoneId: "cr-zone-7", parkingRate: null },
  { label: "Lowell", zoneId: "cr-zone-6", parkingRate: null },
  { label: "Lynn", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Malden Center", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Manchester", zoneId: "cr-zone-6", parkingRate: null },
  { label: "Mansfield", zoneId: "cr-zone-6", parkingRate: null },
  { label: "Melrose Highlands", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Melrose/Cedar Park", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Middleborough", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Montello", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Montserrat", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Morton Street", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Nantasket Junction", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Natick Center", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Needham Center", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Needham Heights", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Needham Junction", zoneId: "cr-zone-2", parkingRate: null },
  { label: "New Bedford", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Newburyport", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Newmarket", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Newtonville", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Norfolk", zoneId: "cr-zone-5", parkingRate: null },
  { label: "North Beverly", zoneId: "cr-zone-5", parkingRate: null },
  { label: "North Billerica", zoneId: "cr-zone-5", parkingRate: null },
  { label: "North Leominster", zoneId: "cr-zone-8", parkingRate: null },
  { label: "North Scituate", zoneId: "cr-zone-5", parkingRate: null },
  { label: "North Station", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "North Wilmington", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Norwood Central", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Norwood Depot", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Oak Grove", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Pawtucket/Central Falls", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Porter", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Providence", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Quincy Center", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Reading", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Readville", zoneId: "cr-zone-2", parkingRate: null },
  { label: "River Works", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Rockport", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Roslindale Village", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Route 128", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Rowley", zoneId: "cr-zone-7", parkingRate: null },
  { label: "Ruggles", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Salem", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Sharon", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Shirley", zoneId: "cr-zone-8", parkingRate: null },
  { label: "South Acton", zoneId: "cr-zone-6", parkingRate: null },
  { label: "South Attleboro", zoneId: "cr-zone-7", parkingRate: null },
  { label: "South Station", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "South Weymouth", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Southborough", zoneId: "cr-zone-6", parkingRate: null },
  { label: "Stoughton", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Swampscott", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Talbot Avenue", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "TF Green Airport", zoneId: "cr-zone-9", parkingRate: null },
  { label: "Uphams Corner", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Wachusett", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Wakefield", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Walpole", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Waltham", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Waverley", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Wedgemere", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Wellesley Farms", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Wellesley Hills", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Wellesley Square", zoneId: "cr-zone-3", parkingRate: null },
  { label: "West Concord", zoneId: "cr-zone-5", parkingRate: null },
  { label: "West Gloucester", zoneId: "cr-zone-7", parkingRate: null },
  { label: "West Hingham", zoneId: "cr-zone-3", parkingRate: null },
  { label: "West Medford", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "West Natick", zoneId: "cr-zone-4", parkingRate: null },
  { label: "West Newton", zoneId: "cr-zone-2", parkingRate: null },
  { label: "West Roxbury", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Westborough", zoneId: "cr-zone-7", parkingRate: null },
  { label: "Weymouth Landing/East Braintree", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Whitman", zoneId: "cr-zone-5", parkingRate: null },
  { label: "Wickford Junction", zoneId: "cr-zone-10", parkingRate: null },
  { label: "Wilmington", zoneId: "cr-zone-3", parkingRate: null },
  { label: "Winchester Center", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Windsor Gardens", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Worcester", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Wyoming Hill", zoneId: "cr-zone-1", parkingRate: null },
];

/* ------------------------------------------------------------
   3. CALC LOGIC
   Pure functions: config + inputs in, numbers out. No DOM access.
   ------------------------------------------------------------ */

function buGetPassOption(passId) {
  return BU_CONFIG.passOptions.find((p) => p.id === passId);
}

function buGetStation(label) {
  return BU_STATIONS.find((s) => s.label === label);
}

/** Resolves whichever pass's one-way/monthly price applies right now,
 * swapping to the Reduced Fare schedule when reducedFare is true. Subway &
 * Bus has only one reduced product ($30/mo, $1.10 one-way) regardless of
 * Local Bus vs LinkPass — MBTA doesn't sell a separate reduced bus-only
 * pass — so both tiers resolve to the same reduced numbers. */
function buResolvePassPrice(pass, reducedFare) {
  if (!pass) return { oneWayFare: 0, monthlyPrice: 0 };
  if (!reducedFare) return { oneWayFare: pass.oneWayFare, monthlyPrice: pass.monthlyPrice };
  return { oneWayFare: pass.reducedOneWayFare, monthlyPrice: pass.reducedMonthlyPrice };
}

/** Total monthly pay-per-ride cost: one-way fare × one-way trips/week ×
 * weeks/month. tripsPerWeek already counts each one-way ride individually
 * (a 5-day round-trip commute = 10), so there's no separate ×2 here. */
function buCalcPayPerRideTotal(oneWayFare, tripsPerWeek, weeksPerMonth) {
  return oneWayFare * tripsPerWeek * weeksPerMonth;
}

/** Applies BU's fixed 50% subsidy to a monthly total. No pre-tax step —
 * BU doesn't publish a separate adjustable pre-tax estimate the way Perq's
 * page does, so the subsidized price is just stated plainly. */
function buCalcBreakdown(total, subsidyPct) {
  const subsidyAmt = total * (subsidyPct / 100);
  const finalCost = total - subsidyAmt;
  return { total, subsidyAmt, finalCost };
}

function mbtaPromoIsActive(config, today) {
  const end = new Date(config.promo.endDate + "T23:59:59");
  return (today || new Date()).getTime() <= end.getTime();
}

/** Days left until the next Edenred order deadline (the 10th of this
 * month, or next month's if today is already past the 10th) — the
 * actionable countdown for the callout, rather than the promo's own
 * end date, since the 10th is the date that actually forces a decision. */
function buEdenredDeadlineDaysLeft(today) {
  const now = today || new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  let target = new Date(year, month, 10, 23, 59, 59);
  if (now.getTime() > target.getTime()) {
    target = new Date(year, month + 1, 10, 23, 59, 59);
  }
  const ms = target.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86400000));
}

function mbtaPromoApplies(config, passId, today) {
  const pass = buGetPassOption(passId);
  if (!pass || pass.group !== "rail") return false;
  if (config.promo.excludeZoneIds.includes(passId)) return false;
  return mbtaPromoIsActive(config, today);
}

/** Optional per-station MBTA park-and-ride subsidy: BU separately
 * subsidizes 50% of the MBTA's own station parking fee for CR commuters
 * who drive to their station. Dormant until BU_STATIONS entries get real
 * parkingRate values — returns null (no line item) until then. */
function buCalcStationParkingSubsidy(stationLabel) {
  const station = buGetStation(stationLabel);
  if (!station || station.parkingRate == null) return null;
  const subsidyAmt = station.parkingRate * 0.5;
  return { fullRate: station.parkingRate, subsidyAmt, finalCost: station.parkingRate - subsidyAmt };
}

/** Employer view, single pass (Subway & Bus): cost of subsidizing a
 * monthly pass across a flat headcount, at BU's fixed 50%. */
function buCalcEmployer(passId, employeeCount, reducedFare) {
  const pass = buGetPassOption(passId);
  if (!pass) {
    return { pass: null, passPrice: 0, promoApplies: false, perEmployeeMonth: 0, totalMonth: 0, employeesShareAmt: 0, employeeSavesMonth: 0 };
  }
  const promoApplies = mbtaPromoApplies(BU_CONFIG, passId);
  const resolved = buResolvePassPrice(pass, reducedFare);
  const passPrice = promoApplies
    ? resolved.monthlyPrice * (1 - BU_CONFIG.promo.discountPct / 100)
    : resolved.monthlyPrice;
  const b = buCalcBreakdown(passPrice, BU_CONFIG.subsidyPct);
  const perEmployeeMonth = b.subsidyAmt;
  const totalMonth = perEmployeeMonth * employeeCount;
  return {
    pass,
    passPrice,
    promoApplies,
    perEmployeeMonth,
    totalMonth,
    employeesShareAmt: (passPrice - b.subsidyAmt) * employeeCount,
    employeeSavesMonth: b.subsidyAmt,
  };
}

/** Clamps a typed zone-headcount value: empty -> 0 (excluded), invalid ->
 * 1, capped at employeeCountMax. Same sanitization rule used throughout
 * the other calculators. */
function buSanitizeZoneCount(rawValue) {
  if (rawValue === "" || rawValue == null) return 0;
  const n = Math.floor(Number(rawValue));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, BU_CONFIG.employeeCountMax);
}

/** Employer view, Commuter Rail: cost of subsidizing passes across a
 * workforce spread across one or more zones, at BU's fixed 50%. */
function buCalcEmployerMultiZone(zoneRows, reducedFare) {
  let totalSticker = 0;
  let totalRaw = 0;
  let totalCount = 0;
  let anyPromoApplies = false;
  const zoneBreakdown = [];

  zoneRows.forEach(({ passId, count }) => {
    const pass = buGetPassOption(passId);
    if (!pass || count < 1) return;
    const promoApplies = mbtaPromoApplies(BU_CONFIG, passId);
    if (promoApplies) anyPromoApplies = true;
    const resolved = buResolvePassPrice(pass, reducedFare);
    const passPrice = promoApplies
      ? resolved.monthlyPrice * (1 - BU_CONFIG.promo.discountPct / 100)
      : resolved.monthlyPrice;
    const zoneRaw = passPrice * count;
    totalSticker += resolved.monthlyPrice * count;
    totalRaw += zoneRaw;
    totalCount += count;
    zoneBreakdown.push({
      label: pass.label,
      count,
      unitPrice: resolved.monthlyPrice,
      subtotal: resolved.monthlyPrice * count,
      zoneOrder: BU_CONFIG.passOptions.indexOf(pass),
    });
  });

  zoneBreakdown.sort((a, b) => a.zoneOrder - b.zoneOrder);

  const b = buCalcBreakdown(totalRaw, BU_CONFIG.subsidyPct);
  const totalMonth = b.subsidyAmt;
  const promoAmt = totalSticker - totalRaw;
  const employeesShareAmt = totalRaw - b.subsidyAmt;
  const employeeSavesMonth = totalCount > 0 ? b.subsidyAmt / totalCount : 0;

  return { totalSticker, totalRaw, promoAmt, employeesShareAmt, totalMonth, zoneBreakdown, promoApplies: anyPromoApplies, totalCount, employeeSavesMonth };
}

/** Bundles every derived number the employee Pay-Per-Ride vs Monthly Pass
 * comparison needs. */
function buCalcAll(passId, tripsPerWeek, reducedFare) {
  const pass = buGetPassOption(passId);
  if (!pass) {
    const zeroBreakdown = buCalcBreakdown(0, BU_CONFIG.subsidyPct);
    return {
      pass: null, passBreakdown: zeroBreakdown, rideBreakdown: zeroBreakdown, winner: "pass",
      annualSavings: 0, promoApplies: false, promoOriginalPrice: 0,
      passRegularTotal: 0, rideRegularTotal: 0, reducedFareDiscount: 0, rideReducedFareDiscount: 0,
    };
  }
  // "Total monthly cost" always shows the regular (non-reduced) sticker
  // price, same as it always shows the pre-promo price — Reduced Fare is
  // then its own itemized deduction, exactly like the Commuter Rail promo
  // is, rather than silently swapping the sticker price shown.
  const regular = buResolvePassPrice(pass, false);
  const resolved = reducedFare ? buResolvePassPrice(pass, true) : regular;

  const rideRegularTotal = buCalcPayPerRideTotal(regular.oneWayFare, tripsPerWeek, BU_CONFIG.weeksPerMonth);
  const rideReducedTotal = buCalcPayPerRideTotal(resolved.oneWayFare, tripsPerWeek, BU_CONFIG.weeksPerMonth);

  const promoApplies = mbtaPromoApplies(BU_CONFIG, passId);
  const passPrice = promoApplies
    ? resolved.monthlyPrice * (1 - BU_CONFIG.promo.discountPct / 100)
    : resolved.monthlyPrice;

  const passBreakdown = buCalcBreakdown(passPrice, BU_CONFIG.subsidyPct);
  const rideBreakdown = buCalcBreakdown(rideReducedTotal, BU_CONFIG.subsidyPct);

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

/** Driving-to-campus monthly estimate. For daily-rate products (Charles
 * River zones, Medical Crosstown daily), multiplies by the number of days
 * a week someone drives in. Flat monthly permits ignore trip frequency
 * entirely — a permit costs the same whether you drive 2 days or 5. */
function buCalcParking(selection, daysPerWeek) {
  if (!selection) return null;
  if (selection.rateType === "monthly") {
    return { label: selection.label, monthlyCost: selection.rate, preTax: selection.preTax, isFlat: true, rate: selection.rate, daysPerWeek: null };
  }
  return { label: selection.label, monthlyCost: selection.rate * daysPerWeek * BU_CONFIG.weeksPerMonth, preTax: selection.preTax, isFlat: false, rate: selection.rate, daysPerWeek };
}

/* ------------------------------------------------------------
   4. UI / RENDER
   ------------------------------------------------------------ */

function buInitCalculator(rootEl) {
  let mode = "employee"; // "employee" | "employer"
  let routeType = "subway"; // "subway" | "rail" | "drive"
  let passTier = "linkpass"; // "local-bus" | "linkpass" — Subway & Bus sub-choice
  let reducedFare = false;
  let tripsPerWeek = BU_CONFIG.defaultTripsPerWeek;
  let employeeCount = BU_CONFIG.defaultEmployeeCount;
  let campus = "charles-river"; // "charles-river" | "medical", Drive mode only
  let crcZoneId = "crc-zone-1";
  let medicalLocationId = "crosstown";
  let medicalDaily = false; // only meaningful when medicalLocationId === "crosstown"

  const modeButtons = rootEl.querySelectorAll("[data-abc-mode-select]");
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.abcModeSelect;
      modeButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      rootEl.setAttribute("data-abc-mode", mode);
      // Drive is individual-only; bounce back to Subway & Bus if an
      // employer switches into a state Drive-mode UI was left in.
      if (mode === "employer" && routeType === "drive") {
        routeType = "subway";
        routeButtons.forEach((b) => b.classList.toggle("abc-active", b.dataset.abcRouteSelect === "subway"));
        updateRouteVisibility();
      }
      render();
    });
  });

  const routeButtons = rootEl.querySelectorAll("[data-abc-route-select]");
  const railZoneField = rootEl.querySelector("[data-abc-rail-zone-field]");
  const subwayTierField = rootEl.querySelector("[data-abc-subway-tier-field]");
  const driveFields = rootEl.querySelector("[data-abc-drive-fields]");
  const countField = rootEl.querySelector("[data-abc-count-field]");
  const tripsField = rootEl.querySelector("[data-abc-trips-field]");
  const reducedFareField = rootEl.querySelector("[data-abc-reduced-fare-field]");

  const promoActive = mbtaPromoIsActive(BU_CONFIG);
  const promoBadge = rootEl.querySelector("[data-abc-promo-badge]");
  if (promoBadge) promoBadge.style.display = promoActive ? "" : "none";

  function updatePromoUI() {
    const callout = rootEl.querySelector("[data-abc-promo-callout]");
    if (!callout) return;
    const applies = promoActive && routeType === "rail" && !BU_CONFIG.promo.excludeZoneIds.includes(currentPassId());
    callout.style.display = applies ? "block" : "none";
    if (applies) {
      const days = buEdenredDeadlineDaysLeft();
      rootEl.querySelector("[data-abc-promo-days]").textContent = `${days} day${days === 1 ? "" : "s"} left to order`;
    }
  }

  // ---- Commuter Rail zone select (employer mode): unchanged zone-based
  // picker, 11 zones, no Interzone entries. ----
  const railZoneSelect = rootEl.querySelector("[data-abc-rail-zone-select]");
  function populateZoneSelect(select) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select zone";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
    BU_CONFIG.passOptions.filter((p) => p.group === "rail").forEach((pass) => {
      const opt = document.createElement("option");
      opt.value = pass.id;
      opt.textContent = pass.label;
      select.appendChild(opt);
    });
  }
  populateZoneSelect(railZoneSelect);

  // ---- Station picker (employee mode): text input + datalist, sorted
  // alphabetically, resolving to a zone under the hood. The datalist gives
  // the "type the first few letters to jump to it" search behavior for
  // free, matching the org-field autocomplete pattern used elsewhere in
  // these tools. ----
  const stationInput = rootEl.querySelector("[data-abc-station-input]");
  const stationList = rootEl.querySelector("[data-abc-station-list]");
  if (stationList) {
    BU_STATIONS.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.label;
      stationList.appendChild(opt);
    });
  }

  function currentStationLabel() {
    return stationInput ? stationInput.value.trim() : "";
  }

  /** Resolves the employee-mode rail pass id: from the selected station
   * when one matches a real station, otherwise unresolved (nothing priced
   * yet). Employer mode reads the zone select directly instead. */
  function employeeRailPassId() {
    const station = buGetStation(currentStationLabel());
    return station ? station.zoneId : "";
  }

  function currentPassId() {
    if (routeType === "subway") return passTier;
    if (mode === "employee") return employeeRailPassId();
    return railZoneSelect.value;
  }

  // ---- Subway & Bus pass-tier pop-out (Local Bus / LinkPass) ----
  const tierButtons = rootEl.querySelectorAll("[data-abc-pass-tier-select]");
  tierButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      passTier = btn.dataset.abcPassTierSelect;
      tierButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      render();
    });
  });

  // ---- Reduced Fare toggle: applies across Subway & Bus and Commuter
  // Rail (MBTA's reduced program spans both). Subway & Bus resolves to the
  // same $30 reduced product regardless of which tier pill is selected
  // (MBTA doesn't sell a separate reduced bus-only pass), but the pills
  // stay fully interactive — nothing about checking this disables them. ----
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

  function wireZoneCountInput(input) {
    input.addEventListener("input", render);
    input.addEventListener("blur", () => {
      if (input.value.trim() === "") return;
      input.value = buSanitizeZoneCount(input.value);
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
    return { passId: select ? select.value : "", count: input ? buSanitizeZoneCount(input.value) : 1 };
  }

  const maxZoneRows = BU_CONFIG.passOptions.filter((p) => p.group === "rail").length;
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

  // ---- Drive mode: campus -> lot/garage fields ----
  const campusButtons = rootEl.querySelectorAll("[data-abc-campus-select]");
  const crcZoneButtons = rootEl.querySelectorAll("[data-abc-crc-zone-select]");
  const medicalLocationButtons = rootEl.querySelectorAll("[data-abc-medical-location-select]");
  const medicalDailyField = rootEl.querySelector("[data-abc-medical-daily-field]");
  const medicalDailyToggle = rootEl.querySelector("[data-abc-medical-daily-toggle]");
  const crcFields = rootEl.querySelector("[data-abc-crc-fields]");
  const medicalFields = rootEl.querySelector("[data-abc-medical-fields]");

  campusButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      campus = btn.dataset.abcCampusSelect;
      campusButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      if (crcFields) crcFields.style.display = campus === "charles-river" ? "block" : "none";
      if (medicalFields) medicalFields.style.display = campus === "medical" ? "block" : "none";
      render();
    });
  });

  crcZoneButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      crcZoneId = btn.dataset.abcCrcZoneSelect;
      crcZoneButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      render();
    });
  });

  /** Only Crosstown Garage has both a daily and a monthly rate; 610 Albany
   * only has the monthly permit, so the daily/monthly checkbox only makes
   * sense (and only shows) when Crosstown is the selected location. */
  function updateMedicalDailyFieldVisibility() {
    if (!medicalDailyField) return;
    const location = BU_PARKING_CONFIG.medical.locations.find((l) => l.id === medicalLocationId);
    const hasDailyOption = !!(location && location.daily);
    medicalDailyField.style.display = hasDailyOption ? "flex" : "none";
    if (!hasDailyOption) medicalDaily = false;
  }

  medicalLocationButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      medicalLocationId = btn.dataset.abcMedicalLocationSelect;
      medicalLocationButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      updateMedicalDailyFieldVisibility();
      render();
    });
  });

  if (medicalDailyToggle) {
    medicalDailyToggle.addEventListener("change", () => {
      medicalDaily = medicalDailyToggle.checked;
      render();
    });
  }
  updateMedicalDailyFieldVisibility();

  function updateRouteVisibility() {
    if (subwayTierField) subwayTierField.style.display = routeType === "subway" ? "" : "none";
    if (railZoneField) railZoneField.style.display = routeType === "rail" ? "" : "none";
    if (driveFields) driveFields.style.display = routeType === "drive" ? "" : "none";
    if (reducedFareField) reducedFareField.style.display = routeType === "drive" ? "none" : "";
    // Flat headcount only makes sense for Subway & Bus employer mode;
    // Commuter Rail uses the per-zone breakdown, Drive has no employer view.
    if (countField) countField.style.display = (mode === "employer" && routeType === "subway") ? "" : "none";
    if (tripsField) {
      const label = tripsField.querySelector("[data-abc-trips-label]");
      if (label) {
        label.textContent = routeType === "drive"
          ? "How many days a week do you drive?"
          : "How many one-way trips do you take per week?";
      }
    }
    rootEl.classList.toggle("abc-theme-rail", routeType === "rail");
    rootEl.classList.toggle("abc-theme-drive", routeType === "drive");

    // Swap the result cards themselves: Pay-Per-Ride/Monthly Pass for
    // transit routes, the two driving/comparison cards for Drive. Only
    // relevant in employee mode (Drive has no employer view at all), but
    // harmless to set regardless since employer mode hides this whole
    // card row via [data-mode-only="employee"] on its container.
    rootEl.querySelectorAll('[data-abc-mode-card="transit"]').forEach((el) => {
      el.style.display = routeType === "drive" ? "none" : "";
    });
    rootEl.querySelectorAll('[data-abc-mode-card="drive"]').forEach((el) => {
      el.style.display = routeType === "drive" ? "" : "none";
    });
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

  if (stationInput) stationInput.addEventListener("input", render);
  railZoneSelect.addEventListener("change", render);

  // ---- Generic stepper (trips/week, employee count): typed or +/- ----
  function initStepper(rootAttr, step, getValue, setValue, min, max) {
    const stepperEl = rootEl.querySelector(`[${rootAttr}]`);
    if (!stepperEl) return;
    const input = stepperEl.querySelector("[data-abc-stepper-value]");
    const minusBtn = stepperEl.querySelector("[data-abc-stepper-minus]");
    const plusBtn = stepperEl.querySelector("[data-abc-stepper-plus]");

    function paint() { input.value = getValue(); }
    minusBtn.addEventListener("click", () => { setValue(Math.max(min, getValue() - step)); paint(); render(); });
    plusBtn.addEventListener("click", () => { setValue(Math.min(max, getValue() + step)); paint(); render(); });
    input.addEventListener("input", () => {
      const raw = Number(input.value);
      if (!Number.isNaN(raw)) { setValue(Math.min(max, Math.max(min, raw))); render(); }
    });
    input.addEventListener("blur", paint);
    paint();
  }

  initStepper("data-abc-trips-stepper", BU_CONFIG.tripsStep, () => tripsPerWeek, (v) => { tripsPerWeek = v; }, 0, BU_CONFIG.tripsMax);
  initStepper("data-abc-count-stepper", BU_CONFIG.employeeCountStep, () => employeeCount, (v) => { employeeCount = v; }, 1, BU_CONFIG.employeeCountMax);

  function paintCard(prefix, breakdown) {
    rootEl.querySelector(`[data-abc-${prefix}-subsidy-amt]`).textContent = `-${abcFormatCurrency(breakdown.subsidyAmt)}`;
    rootEl.querySelector(`[data-abc-${prefix}-final]`).textContent = abcFormatCurrency(breakdown.finalCost);
  }

  /** Reduced Fare discount row, shared between the Pay-Per-Ride and
   * Monthly Pass cards: only shown when the checkbox is on, same pattern
   * as the Commuter Rail promo row (its own itemized deduction, not a
   * silent swap of the sticker price shown above it). */
  function paintReducedFareRow(prefix, discountAmt) {
    const row = rootEl.querySelector(`[data-abc-${prefix}-reduced-row]`);
    if (!row) return;
    if (reducedFare && discountAmt > 0.005) {
      rootEl.querySelector(`[data-abc-${prefix}-reduced-amt]`).textContent = `-${abcFormatCurrency(discountAmt)}`;
      row.style.display = "flex";
    } else {
      row.style.display = "none";
    }
  }

  function render() {
    updatePromoUI();
    if (mode === "employer") renderEmployer();
    else if (routeType === "drive") renderDrive();
    else renderEmployee();
    scheduleAnalyticsFlush();
  }

  function renderEmployee() {
    const result = buCalcAll(currentPassId(), tripsPerWeek, reducedFare);

    paintCard("ride", result.rideBreakdown);
    paintCard("pass", result.passBreakdown);

    // "Total monthly cost" always shows the regular (non-reduced, pre-
    // promo) sticker price on both cards — Reduced Fare and the Commuter
    // Rail promo are each their own itemized deduction below it, the same
    // invoice-style waterfall pattern used everywhere else in this tool.
    rootEl.querySelector("[data-abc-ride-total]").textContent = abcFormatCurrency(result.rideRegularTotal);
    rootEl.querySelector("[data-abc-pass-total]").textContent = abcFormatCurrency(result.passRegularTotal);
    paintReducedFareRow("ride", result.rideReducedFareDiscount);
    paintReducedFareRow("pass", result.reducedFareDiscount);

    // Card title names the actual pass, e.g. "Monthly Local Bus Pass" or
    // "Monthly LinkPass (Subway & Bus)" — the latter skips the trailing
    // "Pass" since LinkPass already has one in its own name.
    const titleEl = rootEl.querySelector("[data-abc-pass-title]");
    if (titleEl) {
      titleEl.textContent = result.pass
        ? (result.pass.label.toLowerCase().includes("pass") ? `Monthly ${result.pass.label}` : `Monthly ${result.pass.label} Pass`)
        : "Monthly Pass";
    }

    // "Total monthly cost" line spells out the zone in parentheses once a
    // Commuter Rail station resolves to one, so someone who picked "Four
    // Corners/Geneva" can still see it's billed as Zone 1A.
    const totalLabelEl = rootEl.querySelector("[data-abc-pass-total-label]");
    if (totalLabelEl) {
      totalLabelEl.textContent = (routeType === "rail" && result.pass) ? `Total monthly cost (${result.pass.label})` : "Total monthly cost";
    }

    const promoRow = rootEl.querySelector("[data-abc-pass-promo-row]");
    if (result.promoApplies) {
      const promoAmt = result.promoOriginalPrice - result.passBreakdown.total;
      rootEl.querySelector("[data-abc-pass-promo-label]").textContent = `Commuter Rail promo (${BU_CONFIG.promo.discountPct}%)`;
      rootEl.querySelector("[data-abc-pass-promo-amt]").textContent = `-${abcFormatCurrency(promoAmt)}`;
      promoRow.style.display = "flex";
    } else {
      promoRow.style.display = "none";
    }

    // Dormant MBTA station parking subsidy hook: only shows once a
    // selected station has a real parkingRate (none do yet).
    const stationParkingRow = rootEl.querySelector("[data-abc-station-parking-row]");
    if (stationParkingRow) {
      const subsidy = routeType === "rail" ? buCalcStationParkingSubsidy(currentStationLabel()) : null;
      if (subsidy) {
        rootEl.querySelector("[data-abc-station-parking-amt]").textContent = `-${abcFormatCurrency(subsidy.subsidyAmt)}`;
        stationParkingRow.style.display = "flex";
      } else {
        stationParkingRow.style.display = "none";
      }
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

  function currentCrcZone() {
    return BU_PARKING_CONFIG.charlesRiver.zones.find((z) => z.id === crcZoneId);
  }
  function currentMedicalLocation() {
    return BU_PARKING_CONFIG.medical.locations.find((l) => l.id === medicalLocationId);
  }

  function renderDrive() {
    let selection;
    if (campus === "charles-river") {
      const zone = currentCrcZone();
      selection = zone ? { label: `Charles River Campus, ${zone.label.replace(/ \(.*\)$/, "")}`, rateType: "daily", rate: zone.weekdayRate, preTax: BU_PARKING_CONFIG.charlesRiver.preTax, weekendRate: zone.weekendRate } : null;
    } else {
      const location = currentMedicalLocation();
      if (location) {
        const useDaily = medicalDaily && location.daily;
        const rateInfo = useDaily ? location.daily : location.monthly;
        selection = { label: `Medical Campus, ${location.label}`, rateType: useDaily ? "daily" : "monthly", rate: rateInfo.rate, preTax: rateInfo.preTax };
      }
    }

    const parking = buCalcParking(selection, tripsPerWeek);

    // Reference card: what Subway & Bus (LinkPass) would cost at the same
    // frequency, so driving and transit sit side by side as asked.
    const compareTrips = tripsPerWeek * 2; // driving days -> round-trip transit rides
    const compareResult = buCalcAll("linkpass", compareTrips, reducedFare);
    const compareCost = compareResult.passBreakdown.finalCost;
    const parkingCost = parking ? parking.monthlyCost : 0;

    const totalEl = rootEl.querySelector("[data-abc-drive-total]");
    const labelEl = rootEl.querySelector("[data-abc-drive-label]");
    const contextNoteEl = rootEl.querySelector("[data-abc-drive-context-note]");
    const rateLabelEl = rootEl.querySelector("[data-abc-drive-rate-label]");
    const rateAmtEl = rootEl.querySelector("[data-abc-drive-rate-amt]");
    if (totalEl) totalEl.textContent = abcFormatCurrency(parkingCost);
    if (labelEl) labelEl.textContent = parking ? parking.label : "Driving to Campus";

    // One context line: pre-tax/post-tax explained in plain terms, with
    // the weekend-rate note appended to the same line (not a second
    // paragraph) when it applies.
    if (contextNoteEl && parking) {
      let note = parking.preTax
        ? "Pre-tax: deducted from your paycheck before taxes are withheld, same as your MBTA pass contribution."
        : "Post-tax: paid after taxes are withheld, unlike your MBTA pass contribution.";
      const showWeekend = campus === "charles-river" && selection && selection.weekendRate != null && selection.weekendRate !== selection.rate;
      if (showWeekend) note += ` Weekend rate is lower (${abcFormatCurrency(selection.weekendRate)}/day); this estimate uses the weekday rate.`;
      contextNoteEl.textContent = note;
    }

    // Itemized rate line: shows exactly where the number comes from, the
    // same "source of the number" transparency the other cards already
    // have (unit price × frequency, or a flat permit rate stated plainly).
    if (rateLabelEl && rateAmtEl && parking) {
      if (parking.isFlat) {
        rateLabelEl.textContent = "Monthly permit rate";
      } else {
        rateLabelEl.textContent = `Daily rate (${abcFormatCurrency(parking.rate)}/day × ${parking.daysPerWeek} day${parking.daysPerWeek === 1 ? "" : "s"}/week)`;
      }
      rateAmtEl.textContent = abcFormatCurrency(parking.monthlyCost);
    }

    const compareEl = rootEl.querySelector("[data-abc-drive-compare-total]");
    if (compareEl) compareEl.textContent = abcFormatCurrency(compareCost);

    // Same winner highlight the Pay-Per-Ride/Monthly Pass cards use,
    // driven by whichever option is actually cheaper at the chosen
    // frequency.
    const driveModeCards = rootEl.querySelectorAll('[data-abc-mode-card="drive"]');
    const driveCard = driveModeCards[0];
    const compareCard = driveModeCards[1];
    if (driveCard && compareCard) {
      const driveWins = parkingCost <= compareCost;
      driveCard.classList.toggle("abc-card-winner", driveWins);
      compareCard.classList.toggle("abc-card-winner", !driveWins);
      driveCard.querySelector("[data-abc-badge]").style.visibility = driveWins ? "visible" : "hidden";
      compareCard.querySelector("[data-abc-badge]").style.visibility = !driveWins ? "visible" : "hidden";

      const winnerCard = driveWins ? driveCard : compareCard;
      const loserCard = driveWins ? compareCard : driveCard;
      const diff = Math.abs(parkingCost - compareCost);
      winnerCard.querySelector("[data-abc-savings-line]").style.display = diff > 0.5 ? "block" : "none";
      winnerCard.querySelector("[data-abc-savings-amt]").textContent = abcFormatCurrency(diff * 12);
      loserCard.querySelector("[data-abc-savings-line]").style.display = "none";
    }
  }

  function currentEmployeeCount() {
    if (routeType === "rail") {
      return getZoneRows().map(readZoneRow).reduce((sum, row) => sum + (row.count > 0 ? row.count : 0), 0);
    }
    return employeeCount;
  }

  function renderEmployer() {
    let r;
    let zoneBreakdown = [];

    if (routeType === "rail") {
      const zoneRows = getZoneRows().map(readZoneRow);
      const multi = buCalcEmployerMultiZone(zoneRows, reducedFare);
      r = multi;
      zoneBreakdown = multi.zoneBreakdown;
    } else {
      const single = buCalcEmployer(currentPassId(), employeeCount, reducedFare);
      r = {
        totalSticker: single.pass ? single.pass.monthlyPrice * employeeCount : 0,
        promoAmt: 0,
        employeesShareAmt: single.employeesShareAmt,
        totalMonth: single.totalMonth,
        employeeSavesMonth: single.employeeSavesMonth,
        promoApplies: false,
      };
    }

    rootEl.querySelector("[data-abc-emp-total]").textContent = abcFormatCurrency(r.totalSticker);

    const promoRow = rootEl.querySelector("[data-abc-emp-promo-row]");
    if (r.promoApplies) {
      rootEl.querySelector("[data-abc-emp-promo-label]").textContent = `Commuter Rail promo (${BU_CONFIG.promo.discountPct}%)`;
      rootEl.querySelector("[data-abc-emp-promo-amt]").textContent = `-${abcFormatCurrency(r.promoAmt)}`;
      promoRow.style.display = "flex";
    } else {
      promoRow.style.display = "none";
    }

    rootEl.querySelector("[data-abc-emp-share-amt]").textContent = `-${abcFormatCurrency(r.employeesShareAmt)}`;
    rootEl.querySelector("[data-abc-emp-final]").textContent = abcFormatCurrency(r.totalMonth);
    rootEl.querySelector("[data-abc-emp-saves]").textContent = abcFormatCurrency(r.employeeSavesMonth);

    const breakdownEl = rootEl.querySelector("[data-abc-zone-breakdown]");
    if (breakdownEl) {
      breakdownEl.innerHTML = "";
      if (zoneBreakdown.length > 1) {
        zoneBreakdown.forEach((zone) => {
          const row = document.createElement("div");
          row.className = "abc-farecalc-line abc-farecalc-zone-breakdown-line";
          const label = document.createElement("span");
          label.textContent = `${zone.label} (${abcFormatCurrency(zone.unitPrice)} × ${abcFormatNumber(zone.count)} employee${zone.count === 1 ? "" : "s"})`;
          const amt = document.createElement("span");
          amt.textContent = abcFormatCurrency(zone.subtotal);
          row.appendChild(label);
          row.appendChild(amt);
          breakdownEl.appendChild(row);
        });
      }
    }
  }

  // ---- Analytics: hardcoded to Boston University, no visible org field.
  // Session starts on first render (debounced) rather than on typing an
  // org name, since there's nothing to type here. ----
  const analyticsEndpoint = (BU_CONFIG.analytics && BU_CONFIG.analytics.endpoint) || "";
  const sessionOrg = "Boston University";
  let sessionRecordId = null;
  let analyticsTimer = null;

  function currentTransitLabel() {
    if (routeType === "subway") {
      const opt = buGetPassOption(passTier);
      return opt ? opt.label : "Subway & Bus";
    }
    if (routeType === "drive") {
      return campus === "charles-river" ? `Drive: Charles River ${crcZoneId}` : `Drive: Medical ${medicalLocationId}${medicalDaily ? " (daily)" : ""}`;
    }
    const opt = buGetPassOption(mode === "employee" ? employeeRailPassId() : railZoneSelect.value);
    return "Commuter Rail: " + (opt ? opt.label : "");
  }

  function analyticsPayload() {
    return {
      org: sessionOrg,
      recordId: sessionRecordId,
      mode,
      transit: currentTransitLabel(),
      reducedFare,
      employeeCount: mode === "employer" ? currentEmployeeCount() : null,
      source: (typeof window !== "undefined") ? window.location.href : "",
    };
  }

  function sendAnalyticsSnapshot() {
    if (!analyticsEndpoint) return;
    try {
      fetch(analyticsEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(analyticsPayload()),
        keepalive: true,
      })
        .then((res) => res.json())
        .then((data) => { if (data && data.recordId) sessionRecordId = data.recordId; })
        .catch(() => {});
    } catch (err) {
      /* never let logging break the tool */
    }
  }

  function scheduleAnalyticsFlush() {
    if (!analyticsEndpoint) return;
    clearTimeout(analyticsTimer);
    analyticsTimer = setTimeout(sendAnalyticsSnapshot, 1500);
  }

  function flushAnalyticsOnHide() {
    if (!analyticsEndpoint || !analyticsTimer) return;
    clearTimeout(analyticsTimer);
    analyticsTimer = null;
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(analyticsPayload())], { type: "application/json" });
      navigator.sendBeacon(analyticsEndpoint, blob);
    } else {
      sendAnalyticsSnapshot();
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAnalyticsOnHide();
  });
  window.addEventListener("pagehide", flushAnalyticsOnHide);

  render();
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-abc-farecalc-root]");
  if (root) buInitCalculator(root);
});
