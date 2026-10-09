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
  // No upper bound for transit: unlike a day count, a ride count has no
  // real-world ceiling (multiple trips a day, business travel around the
  // city), so tripsMax is intentionally unbounded rather than an arbitrary
  // round number. Drive's day-based question is a separate, real
  // constraint (a week only has 7 days), capped on its own below.
  tripsStep: 1,
  tripsMax: Infinity,
  driveTripsMax: 7, // a week only has 7 days to drive to campus on
  defaultTripsPerWeek: 6, // equivalent to a 3-day round-trip commute

  employeeCountStep: 5,
  employeeCountMax: 100000,
  defaultEmployeeCount: 25,

  // Temporary Commuter Rail promo: 50% off monthly passes, Zone 1A
  // excluded. Still applies to BU employees same as everyone else; BU's
  // subsidy and the promo stack (promo first, then BU's 50%).
  // `enabled: false` archives this entire feature (badge, callout,
  // countdown pill, pricing discount) without deleting any of it — the
  // single choke point is mbtaPromoIsActive() below, which this flag
  // short-circuits regardless of endDate. Flip it back to true (and
  // update discountPct/endDate/excludeZoneIds/infoUrl) to resurface this
  // promo or stand up a similar future one.
  promo: {
    enabled: false,
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
   parkingRate is each station's MBTA-published daily park-and-ride fee
   (BU separately subsidizes 50% of this, a different benefit than the
   on-campus parking modeled in Drive mode) — see buCalcStationParkingSubsidy()
   below. Sourced from the user's mbta-CR-parking-lot-rates.csv, joined to
   this station list by name (the CSV doesn't use these common names, e.g.
   "Abington Parking Lot" / stop_id place-PB-0194 -> "Abington"). Where a
   station has more than one MBTA-affiliated lot, the largest by capacity
   is used as the representative rate. Stations with no MBTA parking
   facility in that dataset keep parkingRate: null and simply never show
   the "Will you drive and park at this station?" checkbox.
   ------------------------------------------------------------ */
const BU_STATIONS = [
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
  { label: "Brockton", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Campello", zoneId: "cr-zone-5", parkingRate: 2.00 },
  { label: "Canton Center", zoneId: "cr-zone-3", parkingRate: 4.00 },
  { label: "Canton Junction", zoneId: "cr-zone-3", parkingRate: 4.00 },
  { label: "Chelsea", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Church Street", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Cohasset", zoneId: "cr-zone-4", parkingRate: 2.00 },
  { label: "Concord", zoneId: "cr-zone-5", parkingRate: 0.00 },
  { label: "Dedham Corporate Center", zoneId: "cr-zone-2", parkingRate: 2.00 },
  { label: "East Taunton", zoneId: "cr-zone-8", parkingRate: null },
  { label: "East Weymouth", zoneId: "cr-zone-2", parkingRate: 6.00 },
  { label: "Endicott", zoneId: "cr-zone-2", parkingRate: 0.00 },
  { label: "Fairmount", zoneId: "cr-zone-1a", parkingRate: 4.00 },
  { label: "Fall River Depot", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Fitchburg", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Forest Hills", zoneId: "cr-zone-1a", parkingRate: 9.00 },
  { label: "Forge Park/495", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Four Corners/Geneva", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Foxboro", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Framingham", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "Franklin", zoneId: "cr-zone-6", parkingRate: 6.00 },
  { label: "Freetown", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Gloucester", zoneId: "cr-zone-7", parkingRate: 2.00 },
  { label: "Grafton", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Greenbush", zoneId: "cr-zone-6", parkingRate: 2.00 },
  { label: "Greenwood", zoneId: "cr-zone-2", parkingRate: 2.00 },
  { label: "Halifax", zoneId: "cr-zone-7", parkingRate: 2.00 },
  { label: "Hamilton/Wenham", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "Hanson", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Haverhill", zoneId: "cr-zone-7", parkingRate: 2.00 },
  { label: "Hersey", zoneId: "cr-zone-2", parkingRate: 4.00 },
  { label: "Highland", zoneId: "cr-zone-1", parkingRate: 4.00 },
  { label: "Holbrook/Randolph", zoneId: "cr-zone-3", parkingRate: 4.00 },
  { label: "Hyde Park", zoneId: "cr-zone-1", parkingRate: 4.00 },
  { label: "Ipswich", zoneId: "cr-zone-6", parkingRate: 0.00 },
  { label: "Islington", zoneId: "cr-zone-3", parkingRate: 4.00 },
  { label: "JFK/UMass", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Kendal Green", zoneId: "cr-zone-3", parkingRate: 0.00 },
  { label: "Kingston", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Lansdowne", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Lawrence", zoneId: "cr-zone-6", parkingRate: 4.00 },
  { label: "Lincoln", zoneId: "cr-zone-4", parkingRate: 5.00 },
  { label: "Littleton/Route 495", zoneId: "cr-zone-7", parkingRate: 6.00 },
  { label: "Lowell", zoneId: "cr-zone-6", parkingRate: 8.00 },
  { label: "Lynn", zoneId: "cr-zone-2", parkingRate: 2.00 },
  { label: "Malden Center", zoneId: "cr-zone-1a", parkingRate: 7.50 },
  { label: "Manchester", zoneId: "cr-zone-6", parkingRate: 0.00 },
  { label: "Mansfield", zoneId: "cr-zone-6", parkingRate: 3.00 },
  { label: "Melrose Highlands", zoneId: "cr-zone-1", parkingRate: 5.00 },
  { label: "Melrose/Cedar Park", zoneId: "cr-zone-1", parkingRate: 5.00 },
  { label: "Middleborough", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Montello", zoneId: "cr-zone-4", parkingRate: 2.00 },
  { label: "Montserrat", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Morton Street", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Nantasket Junction", zoneId: "cr-zone-4", parkingRate: 2.00 },
  { label: "Natick Center", zoneId: "cr-zone-4", parkingRate: 0.00 },
  { label: "Needham Center", zoneId: "cr-zone-2", parkingRate: 0.00 },
  { label: "Needham Heights", zoneId: "cr-zone-2", parkingRate: 4.00 },
  { label: "Needham Junction", zoneId: "cr-zone-2", parkingRate: 6.00 },
  { label: "New Bedford", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Newburyport", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Newmarket", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Newtonville", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Norfolk", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "North Beverly", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "North Billerica", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "North Leominster", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "North Scituate", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "North Station", zoneId: "cr-zone-1a", parkingRate: 30.00 },
  { label: "North Wilmington", zoneId: "cr-zone-3", parkingRate: 0.00 },
  { label: "Norwood Central", zoneId: "cr-zone-3", parkingRate: 4.00 },
  { label: "Norwood Depot", zoneId: "cr-zone-3", parkingRate: 2.00 },
  { label: "Oak Grove", zoneId: "cr-zone-1a", parkingRate: 8.00 },
  { label: "Pawtucket/Central Falls", zoneId: "cr-zone-8", parkingRate: 0.00 },
  { label: "Porter", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Providence", zoneId: "cr-zone-8", parkingRate: 0.00 },
  { label: "Quincy Center", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Reading", zoneId: "cr-zone-2", parkingRate: 6.00 },
  { label: "Readville", zoneId: "cr-zone-2", parkingRate: 2.00 },
  { label: "River Works", zoneId: "cr-zone-2", parkingRate: null },
  { label: "Rockport", zoneId: "cr-zone-8", parkingRate: 0.00 },
  { label: "Roslindale Village", zoneId: "cr-zone-1", parkingRate: 4.00 },
  { label: "Route 128", zoneId: "cr-zone-2", parkingRate: 7.00 },
  { label: "Rowley", zoneId: "cr-zone-7", parkingRate: 2.00 },
  { label: "Ruggles", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Salem", zoneId: "cr-zone-3", parkingRate: 5.00 },
  { label: "Sharon", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Shirley", zoneId: "cr-zone-8", parkingRate: 0.00 },
  { label: "South Acton", zoneId: "cr-zone-6", parkingRate: 5.00 },
  { label: "South Attleboro", zoneId: "cr-zone-7", parkingRate: 6.00 },
  { label: "South Station", zoneId: "cr-zone-1a", parkingRate: 30.00 },
  { label: "South Weymouth", zoneId: "cr-zone-3", parkingRate: 2.00 },
  { label: "Southborough", zoneId: "cr-zone-6", parkingRate: 6.00 },
  { label: "Stoughton", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Swampscott", zoneId: "cr-zone-3", parkingRate: 6.00 },
  { label: "Talbot Avenue", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "TF Green Airport", zoneId: "cr-zone-9", parkingRate: 5.00 },
  { label: "Uphams Corner", zoneId: "cr-zone-1a", parkingRate: 0.00 },
  { label: "Wachusett", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Wakefield", zoneId: "cr-zone-2", parkingRate: 6.00 },
  { label: "Walpole", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Waltham", zoneId: "cr-zone-2", parkingRate: 6.00 },
  { label: "Waverley", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Wedgemere", zoneId: "cr-zone-1", parkingRate: 5.00 },
  { label: "Wellesley Farms", zoneId: "cr-zone-3", parkingRate: 6.00 },
  { label: "Wellesley Hills", zoneId: "cr-zone-3", parkingRate: 6.00 },
  { label: "Wellesley Square", zoneId: "cr-zone-3", parkingRate: 6.00 },
  { label: "West Concord", zoneId: "cr-zone-5", parkingRate: 5.00 },
  { label: "West Gloucester", zoneId: "cr-zone-7", parkingRate: 2.00 },
  { label: "West Hingham", zoneId: "cr-zone-3", parkingRate: 4.00 },
  { label: "West Medford", zoneId: "cr-zone-1a", parkingRate: 5.00 },
  { label: "West Natick", zoneId: "cr-zone-4", parkingRate: 6.00 },
  { label: "West Newton", zoneId: "cr-zone-2", parkingRate: 4.00 },
  { label: "West Roxbury", zoneId: "cr-zone-1", parkingRate: 6.00 },
  { label: "Westborough", zoneId: "cr-zone-7", parkingRate: 6.00 },
  { label: "Weymouth Landing/East Braintree", zoneId: "cr-zone-2", parkingRate: 4.00 },
  { label: "Whitman", zoneId: "cr-zone-5", parkingRate: 6.00 },
  { label: "Wickford Junction", zoneId: "cr-zone-10", parkingRate: 0.00 },
  { label: "Wilmington", zoneId: "cr-zone-3", parkingRate: 6.00 },
  { label: "Winchester Center", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Windsor Gardens", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Worcester", zoneId: "cr-zone-8", parkingRate: 15.00 },
  { label: "Wyoming Hill", zoneId: "cr-zone-1", parkingRate: 5.00 },
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
  if (!config.promo.enabled) return false;
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
/** MBTA park-and-ride cost at the selected Commuter Rail station, for
 * someone who drives and parks there instead of walking/biking/getting
 * dropped off. This is an ADD-ON to the pass/ride cost, not a discount on
 * it — BU's 50% subsidy applies to it the same way it applies to the pass
 * itself, itemized the same two-line way (full cost, then the subsidy
 * deducted from it). daysPerWeek is its own direct question (0-7), not
 * derived from the trips/week number — that number is intentionally
 * unbounded (any ride pattern, no real ceiling), so dividing it to infer
 * a day count used to produce nonsense like "10 days/week". */
function buCalcStationParkingSubsidy(stationLabel, daysPerWeek) {
  const station = buGetStation(stationLabel);
  if (!station || station.parkingRate == null || !daysPerWeek) return null;
  const fullMonthlyCost = station.parkingRate * daysPerWeek * BU_CONFIG.weeksPerMonth;
  const subsidyAmt = fullMonthlyCost * 0.5;
  return { rate: station.parkingRate, daysPerWeek, fullMonthlyCost, subsidyAmt, netCost: fullMonthlyCost - subsidyAmt };
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
  let driveCompareMode = "subway"; // "subway" | "rail" — Drive mode's comparison card
  let stationParking = false; // Commuter Rail employee mode only — "Will you drive and park at this station?"
  let stationParkingDays = 3; // its own direct 0-7 question, independent of tripsPerWeek

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
      // Reduced Fare's checkboxes are hidden entirely in employer mode,
      // but the underlying state isn't — reset it here too, so a box
      // checked while in employee mode can never silently keep
      // discounting an employer calculation with no visible control
      // left to undo it.
      if (mode === "employer") {
        reducedFare = false;
        if (reducedFareCheckbox) reducedFareCheckbox.checked = false;
        if (driveReducedFareCheckbox) driveReducedFareCheckbox.checked = false;
      }
      updateStationParkingFieldVisibility();
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
  const reducedFareToggleField = reducedFareField ? reducedFareField.querySelector(".abc-farecalc-toggle-field") : null;
  const reducedFareHomeMount = reducedFareField ? reducedFareField.querySelector(".abc-field") : null;
  const subwayTierMount = rootEl.querySelector("[data-abc-subway-tier-field] .abc-field");

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

  /** W3C ARIA "combobox with list autocomplete" pattern — the documented
   * accessible way to build a type-ahead search field with a popup list
   * (https://www.w3.org/WAI/ARIA/apg/patterns/combobox/), not a bespoke
   * invention. Used instead of a native <input list> datalist because a
   * datalist's suggestion popup is drawn entirely by the browser/OS, so
   * this tool has no real styling control over it — on at least one real
   * Windows/Chrome combination that showed up as unreadable white-on-
   * white text while scrolling through it. This listbox is a plain <ul>
   * this file fully owns, so that class of bug can't happen regardless of
   * OS or browser. onChange(value) fires on every value change (typed or
   * selected), same as the old datalist's plain "input" listener did, so
   * callers don't need to know which widget is underneath. */
  function initStationCombobox(input, listbox, onChange) {
    if (!input || !listbox) return;
    let options = [];
    let activeIndex = -1;

    function renderOptions(matches) {
      listbox.innerHTML = "";
      options = matches;
      if (matches.length === 0) {
        const li = document.createElement("li");
        li.className = "abc-farecalc-combobox-empty";
        li.textContent = "No matching stations";
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
        // mousedown (not click) + preventDefault so the input never
        // blurs before the selection is handled — the classic listbox
        // race condition, and also directly what makes the station field
        // visibly "done" the instant you click rather than leaving the
        // cursor blinking in a focused-but-ambiguous state.
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectValue(label);
        });
        listbox.appendChild(li);
      });
    }

    function openWithQuery(query) {
      const q = query.trim().toLowerCase();
      const matches = q === "" ? [] : BU_STATIONS.map((s) => s.label).filter((label) => label.toLowerCase().includes(q));
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

  // ---- Station picker (employee mode): resolves to a zone under the
  // hood via the combobox above. ----
  const stationInput = rootEl.querySelector("[data-abc-station-input]");
  const stationListbox = rootEl.querySelector("[data-abc-station-listbox]");
  initStationCombobox(stationInput, stationListbox, () => { updateStationParkingFieldVisibility(); render(); });

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

  // ---- Station parking checkbox + its own direct "how many days a
  // week" question: only shown for a station that actually has an MBTA
  // park-and-ride lot. Hidden whenever that's not true (wrong route/
  // mode, no station picked, or a station with no lot in the dataset) —
  // and reset to unchecked whenever it's hidden, the same "don't let a
  // hidden control silently keep affecting the price" rule the rest of
  // this tool follows. The days question only appears once the checkbox
  // itself is checked, and is fully independent of the trips/week number
  // (which is intentionally unbounded and not a day count). ----
  const stationParkingField = rootEl.querySelector("[data-abc-station-parking-field]");
  const stationParkingToggle = rootEl.querySelector("[data-abc-station-parking-toggle]");
  const stationParkingDaysField = rootEl.querySelector("[data-abc-station-parking-days-field]");

  function updateStationParkingFieldVisibility() {
    if (!stationParkingField) return;
    const station = routeType === "rail" && mode === "employee" ? buGetStation(currentStationLabel()) : null;
    const hasParking = !!(station && station.parkingRate != null);
    stationParkingField.style.display = hasParking ? "flex" : "none";
    if (!hasParking && stationParking) {
      stationParking = false;
      if (stationParkingToggle) stationParkingToggle.checked = false;
    }
    if (stationParkingDaysField) stationParkingDaysField.style.display = hasParking && stationParking ? "block" : "none";
  }

  if (stationParkingToggle) {
    stationParkingToggle.addEventListener("change", () => {
      stationParking = stationParkingToggle.checked;
      updateStationParkingFieldVisibility();
      if (stationParkingDaysStepper) stationParkingDaysStepper.repaint();
      render();
    });
  }

  const stationParkingDaysStepper = initStepper(
    "data-abc-station-parking-days-stepper", 1, () => stationParkingDays, (v) => { stationParkingDays = v; }, 0, 7
  );

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

  // ---- Reduced Fare toggle: applies across Subway & Bus, Commuter Rail,
  // and Drive mode's transit-comparison card (MBTA's reduced program
  // spans all of them). Two physical checkboxes share one state —
  // the main one (reparented by route, see updateReducedFarePlacement)
  // and a compact one inside the Drive comparison card, since that card
  // has no other Reduced Fare control visible. Both stay in sync no
  // matter which one someone actually clicks. Subway & Bus resolves to
  // the same $30 reduced product regardless of which tier pill is
  // selected (MBTA doesn't sell a separate reduced bus-only pass), but
  // the pills stay fully interactive — nothing about checking this
  // disables them. ----
  const reducedFareCheckbox = rootEl.querySelector("[data-abc-reduced-fare-toggle]");
  const driveReducedFareCheckbox = rootEl.querySelector("[data-abc-drive-reduced-fare-toggle]");
  function setReducedFare(value) {
    reducedFare = value;
    if (reducedFareCheckbox) reducedFareCheckbox.checked = value;
    if (driveReducedFareCheckbox) driveReducedFareCheckbox.checked = value;
    render();
  }
  if (reducedFareCheckbox) {
    reducedFareCheckbox.addEventListener("change", () => setReducedFare(reducedFareCheckbox.checked));
  }
  if (driveReducedFareCheckbox) {
    driveReducedFareCheckbox.addEventListener("change", () => setReducedFare(driveReducedFareCheckbox.checked));
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

  // ---- Drive card's "compare against" toggle (Subway & Bus vs Commuter
  // Rail) — swaps the comparison card's numbers in place rather than
  // adding a third card, with an inline station field for Commuter Rail
  // using the same combobox pattern as the main CR station picker. ----
  const driveCompareButtons = rootEl.querySelectorAll("[data-abc-drive-compare-select]");
  const driveCompareStationField = rootEl.querySelector("[data-abc-drive-compare-station-field]");
  const driveCompareStationInput = rootEl.querySelector("[data-abc-drive-compare-station-input]");
  const driveCompareStationListbox = rootEl.querySelector("[data-abc-drive-compare-listbox]");
  initStationCombobox(driveCompareStationInput, driveCompareStationListbox, render);

  driveCompareButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      driveCompareMode = btn.dataset.abcDriveCompareSelect;
      driveCompareButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      if (driveCompareStationField) driveCompareStationField.style.display = driveCompareMode === "rail" ? "block" : "none";
      render();
    });
  });

  /** Reduced Fare's checkbox physically moves depending on route: nested
   * under the Local Bus/LinkPass pills for Subway & Bus (same slot/spacing
   * as "Choose Daily Parking" under the Medical Campus pills), or back in
   * its own grid slot beside the Commuter Rail station question, left-
   * aligned under the trips stepper above it. Grid placement is by named
   * area regardless of DOM order, so moving it around the tree doesn't
   * affect anything else's layout. */
  function updateReducedFarePlacement() {
    if (!reducedFareToggleField) return;
    if (routeType === "subway") {
      if (reducedFareField) reducedFareField.style.display = "none";
      if (subwayTierMount && reducedFareToggleField.parentElement !== subwayTierMount) {
        subwayTierMount.appendChild(reducedFareToggleField);
      }
      reducedFareToggleField.classList.remove("abc-farecalc-toggle-field-rail");
      reducedFareToggleField.classList.add("abc-farecalc-toggle-field-nested");
    } else {
      if (reducedFareField) reducedFareField.style.display = routeType === "drive" ? "none" : "";
      if (reducedFareHomeMount && reducedFareToggleField.parentElement !== reducedFareHomeMount) {
        reducedFareHomeMount.appendChild(reducedFareToggleField);
      }
      reducedFareToggleField.classList.remove("abc-farecalc-toggle-field-nested");
      reducedFareToggleField.classList.toggle("abc-farecalc-toggle-field-rail", routeType === "rail");
    }
  }

  function updateRouteVisibility() {
    if (subwayTierField) subwayTierField.style.display = routeType === "subway" ? "" : "none";
    if (railZoneField) railZoneField.style.display = routeType === "rail" ? "" : "none";
    if (driveFields) driveFields.style.display = routeType === "drive" ? "" : "none";
    updateReducedFarePlacement();
    updateStationParkingFieldVisibility();
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
      // A value valid for transit (up to 20 one-way trips/week) can be
      // invalid the moment Drive is selected (at most 7 days/week) — clamp
      // it down immediately rather than leaving a stale over-the-cap number
      // sitting in the field.
      if (routeType === "drive" && tripsPerWeek > BU_CONFIG.driveTripsMax) {
        tripsPerWeek = BU_CONFIG.driveTripsMax;
      }
      if (tripsStepper) tripsStepper.repaint();
      updateRouteVisibility();
      render();
    });
  });
  updateRouteVisibility();

  railZoneSelect.addEventListener("change", render);

  // ---- Generic stepper (trips/week, employee count): typed or +/- ----
  // max can be a plain number or a function, so the trips stepper's cap
  // can depend on the current route (a week only has 7 days to drive,
  // but up to 20 one-way transit trips is a real weekly pattern).
  function initStepper(rootAttr, step, getValue, setValue, min, max) {
    const stepperEl = rootEl.querySelector(`[${rootAttr}]`);
    if (!stepperEl) return null;
    const input = stepperEl.querySelector("[data-abc-stepper-value]");
    const minusBtn = stepperEl.querySelector("[data-abc-stepper-minus]");
    const plusBtn = stepperEl.querySelector("[data-abc-stepper-plus]");

    function currentMax() { return typeof max === "function" ? max() : max; }
    function paint() {
      input.value = getValue();
      const max = currentMax();
      if (Number.isFinite(max)) input.setAttribute("max", max); else input.removeAttribute("max");
    }
    minusBtn.addEventListener("click", () => { setValue(Math.max(min, getValue() - step)); paint(); render(); });
    plusBtn.addEventListener("click", () => { setValue(Math.min(currentMax(), getValue() + step)); paint(); render(); });
    input.addEventListener("input", () => {
      const raw = Number(input.value);
      if (!Number.isNaN(raw)) { setValue(Math.min(currentMax(), Math.max(min, raw))); render(); }
    });
    input.addEventListener("blur", paint);
    paint();
    return { repaint: paint };
  }

  const tripsStepper = initStepper(
    "data-abc-trips-stepper", BU_CONFIG.tripsStep, () => tripsPerWeek, (v) => { tripsPerWeek = v; }, 0,
    () => (routeType === "drive" ? BU_CONFIG.driveTripsMax : BU_CONFIG.tripsMax)
  );
  initStepper("data-abc-count-stepper", BU_CONFIG.employeeCountStep, () => employeeCount, (v) => { employeeCount = v; }, 1, BU_CONFIG.employeeCountMax);

  /** Rounds one line to a whole dollar, writes it (with an optional "-"
   * prefix) to the given element, and returns the signed rounded amount.
   * Every card total in this tool is built by chaining calls to this and
   * accumulating the return values into a running remainder, so the final
   * line a card shows is always the exact sum of the rounded lines printed
   * above it — none of the underlying math (weeksPerMonth, 50% splits,
   * promo percentages) produces round numbers on its own, but what's on
   * screen should still visibly add up rather than needing a calculator
   * to double check. */
  function roundAndShow(selector, rawAmount, isDeduction) {
    const el = rootEl.querySelector(selector);
    const rounded = abcRoundToDollar(Math.abs(rawAmount));
    if (el) el.textContent = `${isDeduction ? "-" : ""}${abcFormatCurrencyWhole(rounded)}`;
    return isDeduction ? -rounded : rounded;
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
    const parkingSubsidy = (routeType === "rail" && stationParking)
      ? buCalcStationParkingSubsidy(currentStationLabel(), stationParkingDays)
      : null;

    // Every card total below is built the same way: round each line to a
    // whole dollar as it's painted, and keep a running "remaining" value
    // that the final line is set from — so what's on screen always adds
    // up exactly, even though none of the underlying math (the 4.33
    // weeks/month conversion, 50% splits, promo percentages) produces
    // round numbers on its own. "Total monthly cost" also spells out its
    // own formula inline for Pay-Per-Ride, where that conversion actually
    // happens; Monthly Pass is just the flat sticker price, no formula
    // needed there.

    // ---- Pay-Per-Ride card ----
    const rideTotalLabelEl = rootEl.querySelector("[data-abc-ride-total-label]");
    if (rideTotalLabelEl && result.pass) {
      rideTotalLabelEl.textContent =
        `Total monthly cost (${abcFormatCurrency(result.pass.oneWayFare)}/trip × ${tripsPerWeek} trip${tripsPerWeek === 1 ? "" : "s"}/week × ${BU_CONFIG.weeksPerMonth.toFixed(2)} weeks/month)`;
    }
    let rideRemaining = roundAndShow("[data-abc-ride-total]", result.rideRegularTotal, false);
    const rideReducedRow = rootEl.querySelector("[data-abc-ride-reduced-row]");
    if (reducedFare && result.rideReducedFareDiscount > 0.005) {
      rideRemaining += roundAndShow("[data-abc-ride-reduced-amt]", result.rideReducedFareDiscount, true);
      rideReducedRow.style.display = "flex";
    } else {
      rideReducedRow.style.display = "none";
    }
    rideRemaining += roundAndShow("[data-abc-ride-subsidy-amt]", result.rideBreakdown.subsidyAmt, true);

    // ---- Monthly Pass card ----
    // Card title names the actual pass, e.g. "Monthly Local Bus Pass" or
    // "Monthly LinkPass (Subway & Bus)" — the latter skips the trailing
    // "Pass" since LinkPass already has one in its own name.
    const titleEl = rootEl.querySelector("[data-abc-pass-title]");
    if (titleEl) {
      titleEl.textContent = result.pass
        ? (result.pass.label.toLowerCase().includes("pass") ? `Monthly ${result.pass.label}` : `Monthly ${result.pass.label} Pass`)
        : "Monthly Pass";
    }
    // Spells out the zone in parentheses once a Commuter Rail station
    // resolves to one, so someone who picked "Four Corners/Geneva" can
    // still see it's billed as Zone 1A.
    const totalLabelEl = rootEl.querySelector("[data-abc-pass-total-label]");
    if (totalLabelEl) {
      totalLabelEl.textContent = (routeType === "rail" && result.pass) ? `Total monthly cost (${result.pass.label})` : "Total monthly cost";
    }
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
      rootEl.querySelector("[data-abc-pass-promo-label]").textContent = `Commuter Rail promo (${BU_CONFIG.promo.discountPct}%)`;
      passRemaining += roundAndShow("[data-abc-pass-promo-amt]", promoAmt, true);
      promoRow.style.display = "flex";
    } else {
      promoRow.style.display = "none";
    }
    passRemaining += roundAndShow("[data-abc-pass-subsidy-amt]", result.passBreakdown.subsidyAmt, true);

    // ---- MBTA station parking: an ADD-ON to the pass/ride cost (not a
    // discount on it), only applied when the checkbox is on. Itemized the
    // same two-line way as everything else (full cost, then BU's subsidy
    // deducted from it), folded into both cards' running remainders since
    // whichever option someone picks, the same parking cost applies. ----
    ["ride", "pass"].forEach((prefix) => {
      const row = rootEl.querySelector(`[data-abc-${prefix}-station-parking-row]`);
      const subsidyRow = rootEl.querySelector(`[data-abc-${prefix}-station-parking-subsidy-row]`);
      if (!row || !subsidyRow) return;
      if (parkingSubsidy) {
        rootEl.querySelector(`[data-abc-${prefix}-station-parking-label]`).textContent =
          `MBTA station parking (${abcFormatCurrency(parkingSubsidy.rate)}/day × ${parkingSubsidy.daysPerWeek} day${parkingSubsidy.daysPerWeek === 1 ? "" : "s"}/week × ${BU_CONFIG.weeksPerMonth.toFixed(2)} weeks/month)`;
        const addAmt = roundAndShow(`[data-abc-${prefix}-station-parking-amt]`, parkingSubsidy.fullMonthlyCost, false);
        const subAmt = roundAndShow(`[data-abc-${prefix}-station-parking-subsidy-amt]`, parkingSubsidy.subsidyAmt, true);
        if (prefix === "ride") rideRemaining += addAmt + subAmt; else passRemaining += addAmt + subAmt;
        row.style.display = "flex";
        subsidyRow.style.display = "flex";
      } else {
        row.style.display = "none";
        subsidyRow.style.display = "none";
      }
    });

    rootEl.querySelector("[data-abc-ride-final]").textContent = abcFormatCurrencyWhole(rideRemaining);
    rootEl.querySelector("[data-abc-pass-final]").textContent = abcFormatCurrencyWhole(passRemaining);
    // finalCost used below (winner/savings calc) stays on the precise,
    // unrounded math — only display is rounded, so a photo-finish between
    // ride and pass still picks the actual cheaper option.

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

    // Reference card: what transit would cost at the same frequency, so
    // driving and transit sit side by side as asked. Defaults to Subway &
    // Bus (LinkPass); the in-card toggle swaps this to a real Commuter
    // Rail monthly pass priced from whichever station the user enters,
    // same BU subsidy and promo logic as the main Commuter Rail cards.
    let compareCost, compareTitle, compareNote;
    if (driveCompareMode === "rail") {
      const compareStation = driveCompareStationInput ? buGetStation(driveCompareStationInput.value.trim()) : null;
      compareTitle = "Commuter Rail Instead";
      if (compareStation) {
        const compareResult = buCalcAll(compareStation.zoneId, tripsPerWeek, reducedFare);
        compareCost = compareResult.passBreakdown.finalCost;
        compareNote = `Monthly Pass from ${compareStation.label}, BU's 50% subsidy applied${reducedFare ? " with Reduced Fare" : ""}.`;
      } else {
        compareCost = 0;
        compareNote = "Enter a station above to see a Commuter Rail comparison.";
      }
    } else {
      const compareTrips = tripsPerWeek * 2; // driving days -> round-trip transit rides
      const compareResult = buCalcAll("linkpass", compareTrips, reducedFare);
      compareCost = compareResult.passBreakdown.finalCost;
      compareTitle = "Subway & Bus Instead";
      compareNote = `LinkPass, same number of weekly campus visits, BU's 50% subsidy applied${reducedFare ? " with Reduced Fare" : ""}.`;
    }
    const parkingCost = parking ? parking.monthlyCost : 0;

    const totalEl = rootEl.querySelector("[data-abc-drive-total]");
    const labelEl = rootEl.querySelector("[data-abc-drive-label]");
    const contextNoteEl = rootEl.querySelector("[data-abc-drive-context-note]");
    const rateLabelEl = rootEl.querySelector("[data-abc-drive-rate-label]");
    const rateAmtEl = rootEl.querySelector("[data-abc-drive-rate-amt]");
    if (totalEl) totalEl.textContent = abcFormatCurrencyWhole(abcRoundToDollar(parkingCost));
    if (labelEl) labelEl.textContent = parking ? parking.label : "Driving to Campus";

    // Context bullets: pre-tax/post-tax and the weekend-rate note (when it
    // applies) are two distinct facts, each its own bullet rather than one
    // run-on paragraph — easier to scan than undifferentiated gray text.
    if (contextNoteEl && parking) {
      contextNoteEl.innerHTML = "";
      const notes = [
        parking.preTax
          ? "Pre-tax: deducted from your paycheck before taxes are withheld."
          : "Post-tax: paid after taxes are withheld.",
      ];
      const showWeekend = campus === "charles-river" && selection && selection.weekendRate != null && selection.weekendRate !== selection.rate;
      if (showWeekend) notes.push(`Weekend rate is lower (${abcFormatCurrency(selection.weekendRate)}/day); this estimate uses the weekday rate.`);
      notes.forEach((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        contextNoteEl.appendChild(li);
      });
    }

    // Itemized rate line: shows exactly where the number comes from, the
    // same "source of the number" transparency the other cards already
    // have (unit price × frequency, or a flat permit rate stated plainly).
    if (rateLabelEl && rateAmtEl && parking) {
      if (parking.isFlat) {
        rateLabelEl.textContent = "Monthly permit rate";
      } else {
        rateLabelEl.textContent = `Daily rate (${abcFormatCurrency(parking.rate)}/day × ${parking.daysPerWeek} day${parking.daysPerWeek === 1 ? "" : "s"}/week × ${BU_CONFIG.weeksPerMonth.toFixed(2)} weeks/month)`;
      }
      rateAmtEl.textContent = abcFormatCurrencyWhole(abcRoundToDollar(parking.monthlyCost));
    }

    const compareEl = rootEl.querySelector("[data-abc-drive-compare-total]");
    if (compareEl) compareEl.textContent = abcFormatCurrencyWhole(abcRoundToDollar(compareCost));
    const compareTitleEl = rootEl.querySelector("[data-abc-drive-compare-title]");
    if (compareTitleEl) compareTitleEl.textContent = compareTitle;
    const compareNoteEl = rootEl.querySelector("[data-abc-drive-compare-note]");
    if (compareNoteEl) compareNoteEl.textContent = compareNote;

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
      winnerCard.querySelector("[data-abc-savings-amt]").textContent = abcFormatCurrencyWhole(abcRoundToDollar(diff * 12));
      loserCard.querySelector("[data-abc-savings-line]").style.display = "none";

      const driveSavingsVsEl = driveCard.querySelector("[data-abc-savings-vs]");
      if (driveSavingsVsEl) driveSavingsVsEl.textContent = driveCompareMode === "rail" ? "taking Commuter Rail" : "taking Subway & Bus";
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

    // Same rounded-running-remainder pattern as the employee cards: round
    // each line to a whole dollar as it's painted, and set the final line
    // from what's left over, so it always equals exactly what's printed
    // above it.
    let empRemaining = roundAndShow("[data-abc-emp-total]", r.totalSticker, false);

    const promoRow = rootEl.querySelector("[data-abc-emp-promo-row]");
    if (r.promoApplies) {
      rootEl.querySelector("[data-abc-emp-promo-label]").textContent = `Commuter Rail promo (${BU_CONFIG.promo.discountPct}%)`;
      empRemaining += roundAndShow("[data-abc-emp-promo-amt]", r.promoAmt, true);
      promoRow.style.display = "flex";
    } else {
      promoRow.style.display = "none";
    }

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
