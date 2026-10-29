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
      "no separate Express Bus tier here. Commuter Rail one-way and monthly " +
      "pass prices, and every zone's one-way Reduced Fare price (zones 1-9 " +
      "included), are confirmed against stations-zones_fares_10.8.26.xlsx " +
      "(the user's/Amir's dataset, round 7) — this replaced the original " +
      "ratio-extrapolated zone 1-9 reduced one-way figures with the real " +
      "published ones (small corrections, a few cents each). Reduced Fare " +
      "MONTHLY pass prices for zones 1-9 are the one field that dataset " +
      "doesn't cover and are STILL the original ratio-extrapolated " +
      "estimates from the two confirmed endpoints (zone 1A and zone 10) — " +
      "verify against MBTA's official tariff before relying on those for " +
      "anything official.",
  },

  // BU covers a fixed 50% of the pass cost, administered through Edenred
  // (not Perq — confirmed on bu.edu/transportation/public-transit/
  // employee-mbta-benefits/). There is no subsidy question in this build;
  // every calculation below uses this constant directly. BU does NOT
  // subsidize single-ride fares (confirmed by Carl Larson, BU Transportation
  // Services, 2026-10) — only Monthly Pass gets this subsidy, never
  // Pay-Per-Ride. See buCalcAll() below.
  subsidyPct: 50,

  // Estimated pre-tax savings on top of BU's subsidy, since Monthly Pass
  // deductions run through payroll pre-tax. Per Carl Larson (BU
  // Transportation Services, 2026-10): the exact rate depends on an
  // individual's federal bracket (10-37%) plus MA state tax (5.0%), FICA
  // (6.2%), and PFML (0.5%) — at least 22.7%, usually 30-35%. 30% is used
  // here as a representative average, disclosed as an estimate in the
  // footer, and (like the subsidy above) only ever applied to Monthly
  // Pass, never Pay-Per-Ride.
  preTaxSavingsPct: 30,

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
  // button grid — wide enough to cover weekend-only, midday-only, or more-
  // than-5-round-trip patterns that a 1-5 day grid couldn't capture. This
  // value is ROUND-TRIPS/week for Subway & Bus, Commuter Rail, and Ferry
  // (doubled to one-way trips before it reaches buCalcAll — see
  // renderEmployee()); the exact same shared variable is reused as literal
  // DAYS DRIVEN for Drive mode, since the two route families never show at
  // once. No upper bound for transit: unlike a day count, a ride count has
  // no real-world ceiling (multiple trips a day, business travel around
  // the city), so tripsMax is intentionally unbounded rather than an
  // arbitrary round number. Drive's day-based question is a separate, real
  // constraint (a week only has 7 days), capped on its own below.
  tripsStep: 1,
  tripsMax: Infinity,
  driveTripsMax: 7, // a week only has 7 days to drive to campus on
  defaultTripsPerWeek: 3, // 3 round-trips/week, a typical 3-day office week

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

  // MBTA's Express Bus fare pilot: Express fares eliminated, every bus
  // route now charges the Local Bus rate. Six months from its 2026-09-01
  // start, per MBTA (mbta.com/FallFarePilots doesn't itself publish an
  // end date, so this is computed from the stated pilot length, not
  // quoted directly from MBTA). Same `enabled` choke-point pattern as
  // the Commuter Rail promo above.
  busPilot: {
    enabled: true,
    startDate: "2026-09-01",
    endDate: "2027-03-01",
    infoUrl: "https://www.mbta.com/FallFarePilots",
  },

  // First two entries are the Subway & Bus tier choices (pop-out pills).
  // Everything else is Commuter Rail, shown only when that route is
  // selected. No Interzone entries — BU's own benefits page and the
  // station dataset both only cover the 11 standard zones (1A, 1-10).
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

    // Ferry: one-way and monthly prices confirmed live on
    // mbta.com/fares/ferry-fares (2026-10). MBTA fare-integrates ferry
    // monthly passes with the equivalent Commuter Rail zone where one
    // exists, which is exactly why Winthrop/Quincy's and Lynn's prices
    // below match cr-zone-1 and cr-zone-2 above dollar-for-dollar (not a
    // coincidence) — their Reduced Fare prices are reused from those
    // confirmed zones for the same reason. Hingham/Hull has no CR-zone
    // equivalent; its regular prices are confirmed, but its reduced
    // MONTHLY price has no published figure, so (like the CR zone 1-9
    // reduced monthly prices above) it's estimated via the same ~50%-of-
    // regular ratio the other confirmed routes follow — flagged in the
    // footer, don't present as exact.
    { id: "ferry-winthrop-quincy", label: "Winthrop/Quincy Ferry", group: "ferry", oneWayFare: 6.50, monthlyPrice: 214.00, reducedOneWayFare: 3.25, reducedMonthlyPrice: 105.00 },
    { id: "ferry-lynn", label: "Lynn Ferry", group: "ferry", oneWayFare: 7.00, monthlyPrice: 232.00, reducedOneWayFare: 3.50, reducedMonthlyPrice: 114.00 },
    { id: "ferry-hingham-hull", label: "Hingham/Hull Ferry", group: "ferry", oneWayFare: 9.75, monthlyPrice: 329.00, reducedOneWayFare: 4.85, reducedMonthlyPrice: 161.00 },
  ],

  // Bluebikes membership add-on: optional, independent of transit choice,
  // folded as a flat line into both cards' monthly totals when checked.
  // $75.50+tax/year is NOT the generic retail price (that's $133.50/year,
  // this repo's bluebikes-membership-calculator's BIKE_CONFIG.
  // retailAnnualPrice) — it's BU's own discounted rate for faculty, staff,
  // and students, confirmed on bu.edu/transportation/bicycling/
  // bluebikes-discount/ (2026-10). Correction from an earlier round of
  // this file, which had used the generic retail price by mistake.
  bluebikesAnnualPrice: 75.50,
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

   line: "fw" flags the 18 stations on the Framingham/Worcester Line
   (South Station through Worcester, confirmed against the official MBTA
   timetable, mbta.com/schedules/CR-Worcester/timetable, 2026-10). Per
   Carl Larson (BU Transportation Services): this is the only CR line
   whose riders can reach Charles River Campus directly — via Lansdowne
   or Boston Landing — without a subway/bus transfer. Every other CR
   zone's Pay-Per-Ride estimate needs an added one-way LinkPass leg (see
   buCalcAll's subwayLegIncluded parameter) to reflect that reality;
   Monthly Pass holders don't, since a CR monthly pass already includes
   unlimited subway/bus system-wide. This assumes a Charles River Campus
   destination throughout — Medical Campus commuters on the F/W line
   would actually still need a transfer, a known simplification since
   this tool's transit comparison doesn't ask which campus (only Drive
   mode does), worth revisiting if Medical Campus transit commuters
   become a focus.
   ------------------------------------------------------------ */
const BU_STATIONS = [
  { label: "Abington", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Anderson/Woburn", zoneId: "cr-zone-2", parkingRate: 4.00 },
  { label: "Andover", zoneId: "cr-zone-5", parkingRate: 4.00 },
  { label: "Ashland", zoneId: "cr-zone-6", parkingRate: 4.00, line: "fw" },
  { label: "Attleboro", zoneId: "cr-zone-7", parkingRate: 5.00 },
  { label: "Auburndale", zoneId: "cr-zone-2", parkingRate: 6.00, line: "fw" },
  { label: "Ayer", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Back Bay", zoneId: "cr-zone-1a", parkingRate: null, line: "fw" },
  { label: "Ballardvale", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Bellevue", zoneId: "cr-zone-1", parkingRate: 4.00 },
  { label: "Belmont", zoneId: "cr-zone-1", parkingRate: 5.00 },
  { label: "Beverly", zoneId: "cr-zone-4", parkingRate: 4.00 },
  { label: "Beverly Farms", zoneId: "cr-zone-5", parkingRate: 0.00 },
  { label: "Blue Hill Avenue", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Boston Landing", zoneId: "cr-zone-1a", parkingRate: null, line: "fw" },
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
  { label: "Framingham", zoneId: "cr-zone-5", parkingRate: 4.00, line: "fw" },
  { label: "Franklin", zoneId: "cr-zone-6", parkingRate: 6.00 },
  { label: "Freetown", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Gloucester", zoneId: "cr-zone-7", parkingRate: 2.00 },
  { label: "Grafton", zoneId: "cr-zone-8", parkingRate: 4.00, line: "fw" },
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
  { label: "Lansdowne", zoneId: "cr-zone-1a", parkingRate: null, line: "fw" },
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
  { label: "Natick Center", zoneId: "cr-zone-4", parkingRate: 0.00, line: "fw" },
  { label: "Needham Center", zoneId: "cr-zone-2", parkingRate: 0.00 },
  { label: "Needham Heights", zoneId: "cr-zone-2", parkingRate: 4.00 },
  { label: "Needham Junction", zoneId: "cr-zone-2", parkingRate: 6.00 },
  { label: "New Bedford", zoneId: "cr-zone-8", parkingRate: null },
  { label: "Newburyport", zoneId: "cr-zone-8", parkingRate: 4.00 },
  { label: "Newmarket", zoneId: "cr-zone-1a", parkingRate: null },
  { label: "Newtonville", zoneId: "cr-zone-1", parkingRate: null, line: "fw" },
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
  { label: "South Station", zoneId: "cr-zone-1a", parkingRate: 30.00, line: "fw" },
  { label: "South Weymouth", zoneId: "cr-zone-3", parkingRate: 2.00 },
  { label: "Southborough", zoneId: "cr-zone-6", parkingRate: 6.00, line: "fw" },
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
  { label: "Wellesley Farms", zoneId: "cr-zone-3", parkingRate: 6.00, line: "fw" },
  { label: "Wellesley Hills", zoneId: "cr-zone-3", parkingRate: 6.00, line: "fw" },
  { label: "Wellesley Square", zoneId: "cr-zone-3", parkingRate: 6.00, line: "fw" },
  { label: "West Concord", zoneId: "cr-zone-5", parkingRate: 5.00 },
  { label: "West Gloucester", zoneId: "cr-zone-7", parkingRate: 2.00 },
  { label: "West Hingham", zoneId: "cr-zone-3", parkingRate: 4.00 },
  { label: "West Medford", zoneId: "cr-zone-1a", parkingRate: 5.00 },
  { label: "West Natick", zoneId: "cr-zone-4", parkingRate: 6.00, line: "fw" },
  { label: "West Newton", zoneId: "cr-zone-2", parkingRate: 4.00, line: "fw" },
  { label: "West Roxbury", zoneId: "cr-zone-1", parkingRate: 6.00 },
  { label: "Westborough", zoneId: "cr-zone-7", parkingRate: 6.00, line: "fw" },
  { label: "Weymouth Landing/East Braintree", zoneId: "cr-zone-2", parkingRate: 4.00 },
  { label: "Whitman", zoneId: "cr-zone-5", parkingRate: 6.00 },
  { label: "Wickford Junction", zoneId: "cr-zone-10", parkingRate: 0.00 },
  { label: "Wilmington", zoneId: "cr-zone-3", parkingRate: 6.00 },
  { label: "Winchester Center", zoneId: "cr-zone-1", parkingRate: null },
  { label: "Windsor Gardens", zoneId: "cr-zone-4", parkingRate: null },
  { label: "Worcester", zoneId: "cr-zone-8", parkingRate: 15.00, line: "fw" },
  { label: "Wyoming Hill", zoneId: "cr-zone-1", parkingRate: 5.00 },
];

/* Rapid transit (subway/bus) park-and-ride stations, Subway & Bus route
 * only — separate from BU_STATIONS above since it's a different question
 * (no zone/fare to resolve, parking is the only thing this list is for)
 * and a different BU policy scope: per Carl Larson (BU Transportation
 * Services, 2026-10), BU's parking subsidy works with ANY BU-subsidized
 * monthly pass, not just Commuter Rail — "we want it to work for folks
 * who park at Alewife, for instance, not just CR riders." Weekday daily
 * rates confirmed live on mbta.com/parking/stations-and-rates (2026-10).
 * Limited to stations with a real flat daily rate; excludes a handful of
 * small metered/hourly-only lots (Beaconsfield, Brookline Hills, Longwood)
 * and the downtown hourly garages (North Station, South Station,
 * Haymarket) that don't fit this tool's "daily rate × days/week" model
 * and aren't realistic all-day commuter parking anyway. Where a station
 * has more than one lot, the larger-capacity garage (not a surface lot)
 * is used as the representative rate, same convention BU_STATIONS uses. */
const MBTA_RAPID_STATIONS = [
  { label: "Alewife", parkingRate: 9.00 },
  { label: "Beachmont", parkingRate: 5.00 },
  { label: "Braintree", parkingRate: 9.00 },
  { label: "Chestnut Hill", parkingRate: 9.00 },
  { label: "Eliot", parkingRate: 9.00 },
  { label: "Forest Hills", parkingRate: 9.00 },
  { label: "Malden Center", parkingRate: 7.50 },
  { label: "Mattapan", parkingRate: 2.00 },
  { label: "North Quincy", parkingRate: 5.00 },
  { label: "Oak Grove", parkingRate: 9.00 },
  { label: "Orient Heights", parkingRate: 5.00 },
  { label: "Quincy Adams", parkingRate: 9.00 },
  { label: "Riverside", parkingRate: 6.00 },
  { label: "Savin Hill", parkingRate: 7.50 },
  { label: "Suffolk Downs", parkingRate: 2.50 },
  { label: "Sullivan Square", parkingRate: 9.00 },
  { label: "Waban", parkingRate: 9.00 },
  { label: "Wellington", parkingRate: 5.00 },
  { label: "Wollaston", parkingRate: 6.00 },
  { label: "Wonderland", parkingRate: 7.00 },
  { label: "Woodland", parkingRate: 6.00 },
];

function buGetRapidStation(label) {
  return MBTA_RAPID_STATIONS.find((s) => s.label === label);
}

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
 * weeks/month. Takes ONE-WAY trips — callers with a round-trips/week input
 * (the employee transit question) must double it before calling this. */
function buCalcPayPerRideTotal(oneWayFare, oneWayTripsPerWeek, weeksPerMonth) {
  return oneWayFare * oneWayTripsPerWeek * weeksPerMonth;
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

function mbtaBusPilotIsActive(config, today) {
  if (!config.busPilot.enabled) return false;
  const end = new Date(config.busPilot.endDate + "T23:59:59");
  return (today || new Date()).getTime() <= end.getTime();
}

function mbtaBusPilotDaysLeft(config, today) {
  const now = today || new Date();
  const end = new Date(config.busPilot.endDate + "T23:59:59");
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000));
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

/** MBTA park-and-ride cost at the selected station, for someone who drives
 * and parks there instead of walking/biking/getting dropped off. This is
 * an ADD-ON to the pass/ride cost, not a discount on it — BU's 50%
 * subsidy applies to it the same way it applies to the pass itself,
 * itemized the same two-line way (full cost, then the subsidy deducted
 * from it). Takes a rate directly rather than a station lookup, so the
 * same function serves both BU_STATIONS (Commuter Rail) and
 * MBTA_RAPID_STATIONS (Subway & Bus) — any BU-subsidized monthly pass
 * qualifies for this subsidy, not just Commuter Rail (Carl Larson, BU
 * Transportation Services, 2026-10: "we want it to work for folks who
 * park at Alewife, for instance, not just CR riders"). daysPerWeek is its
 * own direct question (0-7), not derived from the trips/week number —
 * that number is intentionally unbounded (any ride pattern, no real
 * ceiling), so dividing it to infer a day count used to produce nonsense
 * like "10 days/week". */
function buCalcStationParkingSubsidy(parkingRate, daysPerWeek) {
  if (parkingRate == null || !daysPerWeek) return null;
  const fullMonthlyCost = parkingRate * daysPerWeek * BU_CONFIG.weeksPerMonth;
  const subsidyAmt = fullMonthlyCost * 0.5;
  return { rate: parkingRate, daysPerWeek, fullMonthlyCost, subsidyAmt, netCost: fullMonthlyCost - subsidyAmt };
}

/** Bundles every derived number the employee Pay-Per-Ride vs Monthly Pass
 * comparison needs. tripsPerWeek here is in ONE-WAY units (callers with a
 * round-trips/week input must double it first — see renderEmployee()).
 * BU's 50% subsidy and the pre-tax savings estimate both apply ONLY to
 * Monthly Pass, never Pay-Per-Ride — confirmed by Carl Larson (BU
 * Transportation Services, 2026-10): BU does not subsidize single-ride
 * fares, so rideFinalCost is always the full (Reduced-Fare-adjusted, if
 * applicable) sticker cost with no deduction.
 *
 * includeSubwayLeg (Commuter Rail only, see BU_STATIONS' "line: 'fw'" doc
 * comment): a CR Monthly Pass already includes unlimited subway/bus
 * system-wide, but paying per-ride on CR does not — someone without an
 * F/W-line one-seat ride to Charles River Campus also pays a one-way
 * LinkPass fare (regular or reduced, matching their own Reduced Fare
 * status) to complete the trip. Added to Pay-Per-Ride only, never
 * Monthly Pass, per that same real policy difference. */
function buCalcAll(passId, tripsPerWeek, reducedFare, includeSubwayLeg) {
  const pass = buGetPassOption(passId);
  if (!pass) {
    const zeroBreakdown = buCalcBreakdown(0, BU_CONFIG.subsidyPct);
    return {
      pass: null, passBreakdown: zeroBreakdown, rideFinalCost: 0, winner: "pass", passEffectiveCost: 0,
      annualSavings: 0, promoApplies: false, promoOriginalPrice: 0,
      passRegularTotal: 0, rideRegularTotal: 0, reducedFareDiscount: 0, rideReducedFareDiscount: 0,
      preTaxSavingsAmt: 0,
    };
  }
  // "Total monthly cost" always shows the regular (non-reduced) sticker
  // price, same as it always shows the pre-promo price — Reduced Fare is
  // then its own itemized deduction, exactly like the Commuter Rail promo
  // is, rather than silently swapping the sticker price shown.
  const regular = buResolvePassPrice(pass, false);
  const resolved = reducedFare ? buResolvePassPrice(pass, true) : regular;

  const linkpass = includeSubwayLeg ? buGetPassOption("linkpass") : null;
  const subwayLegRegular = linkpass ? linkpass.oneWayFare : 0;
  const subwayLegResolved = linkpass ? (reducedFare ? linkpass.reducedOneWayFare : linkpass.oneWayFare) : 0;

  const rideRegularTotal = buCalcPayPerRideTotal(regular.oneWayFare + subwayLegRegular, tripsPerWeek, BU_CONFIG.weeksPerMonth);
  const rideReducedTotal = buCalcPayPerRideTotal(resolved.oneWayFare + subwayLegResolved, tripsPerWeek, BU_CONFIG.weeksPerMonth);
  const rideFinalCost = rideReducedTotal;

  const promoApplies = mbtaPromoApplies(BU_CONFIG, passId);
  const passPrice = promoApplies
    ? resolved.monthlyPrice * (1 - BU_CONFIG.promo.discountPct / 100)
    : resolved.monthlyPrice;

  const passBreakdown = buCalcBreakdown(passPrice, BU_CONFIG.subsidyPct);
  const preTaxSavingsAmt = passBreakdown.finalCost * (BU_CONFIG.preTaxSavingsPct / 100);
  // The headline number Monthly Pass actually competes on — per Carl
  // Larson's explicit request, pre-tax savings now reduce the same
  // final figure the subsidy does, not just an informational footnote.
  const passEffectiveCost = passBreakdown.finalCost - preTaxSavingsAmt;

  const winner = passEffectiveCost <= rideFinalCost ? "pass" : "ride";
  const monthlyDiff = Math.abs(passEffectiveCost - rideFinalCost);

  return {
    pass, passBreakdown, rideFinalCost, winner, passEffectiveCost,
    annualSavings: monthlyDiff * 12, promoApplies, promoOriginalPrice: resolved.monthlyPrice,
    passRegularTotal: regular.monthlyPrice,
    rideRegularTotal,
    reducedFareDiscount: regular.monthlyPrice - resolved.monthlyPrice,
    rideReducedFareDiscount: rideRegularTotal - rideReducedTotal,
    preTaxSavingsAmt,
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
  let routeType = "subway"; // "subway" | "rail" | "ferry" | "drive"
  let passTier = "linkpass"; // "local-bus" | "linkpass" — Subway & Bus sub-choice
  let ferryRouteId = "ferry-winthrop-quincy"; // Ferry sub-choice
  let reducedFare = false;
  let tripsPerWeek = BU_CONFIG.defaultTripsPerWeek; // round-trips/week (transit) or days/week (drive) — see BU_CONFIG.tripsStep comment
  let campus = "charles-river"; // "charles-river" | "medical", Drive mode only
  let crcZoneId = "crc-zone-1";
  let medicalLocationId = "crosstown";
  let medicalDaily = false; // only meaningful when medicalLocationId === "crosstown"
  let driveCompareMode = "link"; // "bus" | "link" | "rail" | "ferry" — Drive mode's comparison card
  let driveCompareFerryRouteId = "ferry-winthrop-quincy";
  let driveCompareParking = false; // "Will you drive and park there, then ride the rest of the way?" — bus/link/rail only, no Ferry parking data
  let driveCompareParkingDays = 3;
  let driveCompareBluebikesAdded = false;
  let stationParking = false; // Commuter Rail only — "Will you drive and park at this station?"
  let stationParkingDays = 3; // its own direct 0-7 question, independent of tripsPerWeek
  let rapidStationParking = false; // Subway & Bus only — same question, MBTA_RAPID_STATIONS instead of BU_STATIONS
  let rapidStationParkingDays = 3;
  let bluebikesAdded = false; // optional Bluebikes membership add-on, folded into both cards

  const routeButtons = rootEl.querySelectorAll("[data-abc-route-select]");
  const railZoneField = rootEl.querySelector("[data-abc-rail-zone-field]");
  const subwayTierField = rootEl.querySelector("[data-abc-subway-tier-field]");
  const ferryRouteField = rootEl.querySelector("[data-abc-ferry-route-field]");
  const driveFields = rootEl.querySelector("[data-abc-drive-fields]");
  const tripsField = rootEl.querySelector("[data-abc-trips-field]");
  const reducedFareField = rootEl.querySelector("[data-abc-reduced-fare-field]");
  const reducedFareToggleField = reducedFareField ? reducedFareField.querySelector(".abc-farecalc-toggle-field") : null;
  const reducedFareHomeMount = reducedFareField ? reducedFareField.querySelector(".abc-field") : null;

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

  // ---- Express Bus fare pilot callout: shown only while Bus Pass is the
  // active pass being compared, main card and Drive-compare card alike. ----
  // Shown above the route question regardless of which mode is selected —
  // this is relevant everywhere, not just when Bus Pass is the active
  // pass. The only gate is whether the pilot itself is still running.
  function updateBusPilotUI() {
    const mainCallout = rootEl.querySelector("[data-abc-bus-pilot-callout]");
    if (!mainCallout) return;
    const applies = mbtaBusPilotIsActive(BU_CONFIG);
    mainCallout.style.display = applies ? "block" : "none";
    if (applies) {
      const days = mbtaBusPilotDaysLeft(BU_CONFIG);
      rootEl.querySelector("[data-abc-bus-pilot-days]").textContent = `${days} day${days === 1 ? "" : "s"} left`;
    }
  }

  // ---- Ferry route pop-out (Winthrop/Quincy / Lynn / Hingham/Hull) ----
  const ferryRouteButtons = rootEl.querySelectorAll("[data-abc-ferry-route-select]");
  ferryRouteButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      ferryRouteId = btn.dataset.abcFerryRouteSelect;
      ferryRouteButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      render();
    });
  });

  // ---- Bluebikes membership add-on toggle ----
  const bluebikesToggle = rootEl.querySelector("[data-abc-bluebikes-toggle]");
  if (bluebikesToggle) {
    bluebikesToggle.addEventListener("change", () => {
      bluebikesAdded = bluebikesToggle.checked;
      render();
    });
  }

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
   * callers don't need to know which widget is underneath. stationList
   * defaults to BU_STATIONS (Commuter Rail); the rapid-transit parking
   * combobox passes MBTA_RAPID_STATIONS instead. */
  function initStationCombobox(input, listbox, onChange, stationList) {
    if (!input || !listbox) return;
    const stations = stationList || BU_STATIONS;
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
      const matches = q === "" ? [] : stations.map((s) => s.label).filter((label) => label.toLowerCase().includes(q));
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

  // ---- Station picker: resolves to a zone under the hood via the
  // combobox above. ----
  const stationInput = rootEl.querySelector("[data-abc-station-input]");
  const stationListbox = rootEl.querySelector("[data-abc-station-listbox]");
  initStationCombobox(stationInput, stationListbox, () => { updateStationParkingFieldVisibility(); render(); });

  function currentStationLabel() {
    return stationInput ? stationInput.value.trim() : "";
  }

  /** Resolves the Commuter Rail pass id from the selected station, when
   * one matches a real station; otherwise unresolved (nothing priced yet). */
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
    const station = routeType === "rail" ? buGetStation(currentStationLabel()) : null;
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

  // ---- Rapid-transit (Subway & Bus) park-and-ride: same BU parking
  // subsidy, same two-line itemization, but MBTA_RAPID_STATIONS instead
  // of BU_STATIONS, and no fare to resolve (Local Bus/LinkPass pricing
  // doesn't depend on which station you park at), so the checkbox shows
  // unconditionally under Subway & Bus rather than waiting on a station
  // pick first the way the Commuter Rail version does. ----
  const rapidStationParkingField = rootEl.querySelector("[data-abc-rapid-station-parking-field]");
  const rapidStationParkingToggle = rootEl.querySelector("[data-abc-rapid-station-parking-toggle]");
  const rapidStationField = rootEl.querySelector("[data-abc-rapid-station-field]");
  const rapidStationInput = rootEl.querySelector("[data-abc-rapid-station-input]");
  const rapidStationListbox = rootEl.querySelector("[data-abc-rapid-station-listbox]");
  const rapidStationParkingDaysField = rootEl.querySelector("[data-abc-rapid-station-parking-days-field]");
  initStationCombobox(rapidStationInput, rapidStationListbox, render, MBTA_RAPID_STATIONS);

  function currentRapidStationLabel() {
    return rapidStationInput ? rapidStationInput.value.trim() : "";
  }

  function updateRapidStationParkingFieldVisibility() {
    if (!rapidStationParkingField) return;
    const show = routeType === "subway";
    rapidStationParkingField.style.display = show ? "flex" : "none";
    if (!show && rapidStationParking) {
      rapidStationParking = false;
      if (rapidStationParkingToggle) rapidStationParkingToggle.checked = false;
    }
    if (rapidStationField) rapidStationField.style.display = show && rapidStationParking ? "block" : "none";
    if (rapidStationParkingDaysField) rapidStationParkingDaysField.style.display = show && rapidStationParking ? "block" : "none";
  }

  if (rapidStationParkingToggle) {
    rapidStationParkingToggle.addEventListener("change", () => {
      rapidStationParking = rapidStationParkingToggle.checked;
      updateRapidStationParkingFieldVisibility();
      if (rapidStationParkingDaysStepper) rapidStationParkingDaysStepper.repaint();
      render();
    });
  }

  const rapidStationParkingDaysStepper = initStepper(
    "data-abc-rapid-station-parking-days-stepper", 1, () => rapidStationParkingDays, (v) => { rapidStationParkingDays = v; }, 0, 7
  );

  function currentPassId() {
    if (routeType === "subway") return passTier;
    if (routeType === "ferry") return ferryRouteId;
    return employeeRailPassId();
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

  // ---- Drive card's "compare against" toggle (Bus Pass / Link Pass /
  // Commuter Rail / Ferry) — swaps the comparison card's numbers in place
  // rather than adding more cards, with an inline station field for
  // Commuter Rail and an inline route picker for Ferry, same combobox/
  // pop-out patterns as the main questions above. ----
  const driveCompareButtons = rootEl.querySelectorAll("[data-abc-drive-compare-select]");
  const driveCompareStationField = rootEl.querySelector("[data-abc-drive-compare-station-field]");
  const driveCompareStationInput = rootEl.querySelector("[data-abc-drive-compare-station-input]");
  const driveCompareStationListbox = rootEl.querySelector("[data-abc-drive-compare-listbox]");
  const driveCompareFerryField = rootEl.querySelector("[data-abc-drive-compare-ferry-field]");
  const driveCompareFerryButtons = rootEl.querySelectorAll("[data-abc-drive-compare-ferry-select]");
  initStationCombobox(driveCompareStationInput, driveCompareStationListbox, render);

  // ---- "Driving to the station" park-and-ride, same BU subsidy as the
  // main cards: useful for comparing "drive all the way" vs "drive to a
  // station and ride the rest of the way" per Carl Larson's suggestion.
  // Bus Pass/Link Pass use MBTA_RAPID_STATIONS via their own station
  // search (fare doesn't depend on station there, so there's no existing
  // one to reuse); Commuter Rail reuses driveCompareStationInput, already
  // resolved for fare purposes. No parking option for Ferry — no station
  // dataset sourced for it. ----
  const driveCompareParkingField = rootEl.querySelector("[data-abc-drive-compare-parking-field]");
  const driveCompareParkingToggle = rootEl.querySelector("[data-abc-drive-compare-parking-toggle]");
  const driveCompareRapidStationField = rootEl.querySelector("[data-abc-drive-compare-rapid-station-field]");
  const driveCompareRapidStationInput = rootEl.querySelector("[data-abc-drive-compare-rapid-station-input]");
  const driveCompareRapidStationListbox = rootEl.querySelector("[data-abc-drive-compare-rapid-listbox]");
  const driveCompareParkingDaysField = rootEl.querySelector("[data-abc-drive-compare-parking-days-field]");
  initStationCombobox(driveCompareRapidStationInput, driveCompareRapidStationListbox, render, MBTA_RAPID_STATIONS);

  function currentDriveCompareRapidStationLabel() {
    return driveCompareRapidStationInput ? driveCompareRapidStationInput.value.trim() : "";
  }

  function updateDriveCompareFieldVisibility() {
    if (driveCompareStationField) driveCompareStationField.style.display = driveCompareMode === "rail" ? "block" : "none";
    if (driveCompareFerryField) driveCompareFerryField.style.display = driveCompareMode === "ferry" ? "block" : "none";

    const isRapidMode = driveCompareMode === "bus" || driveCompareMode === "link";
    const parkingApplies = driveCompareMode !== "ferry";
    if (driveCompareParkingField) driveCompareParkingField.style.display = parkingApplies ? "flex" : "none";
    if (!parkingApplies && driveCompareParking) {
      driveCompareParking = false;
      if (driveCompareParkingToggle) driveCompareParkingToggle.checked = false;
    }
    if (driveCompareRapidStationField) driveCompareRapidStationField.style.display = isRapidMode && driveCompareParking ? "block" : "none";
    if (driveCompareParkingDaysField) driveCompareParkingDaysField.style.display = parkingApplies && driveCompareParking ? "block" : "none";
  }

  if (driveCompareParkingToggle) {
    driveCompareParkingToggle.addEventListener("change", () => {
      driveCompareParking = driveCompareParkingToggle.checked;
      updateDriveCompareFieldVisibility();
      if (driveCompareParkingDaysStepper) driveCompareParkingDaysStepper.repaint();
      render();
    });
  }

  const driveCompareParkingDaysStepper = initStepper(
    "data-abc-drive-compare-parking-days-stepper", 1, () => driveCompareParkingDays, (v) => { driveCompareParkingDays = v; }, 0, 7
  );

  // ---- Bluebikes add-on, same as the main cards ----
  const driveCompareBluebikesToggle = rootEl.querySelector("[data-abc-drive-compare-bluebikes-toggle]");
  if (driveCompareBluebikesToggle) {
    driveCompareBluebikesToggle.addEventListener("change", () => {
      driveCompareBluebikesAdded = driveCompareBluebikesToggle.checked;
      render();
    });
  }

  driveCompareButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      driveCompareMode = btn.dataset.abcDriveCompareSelect;
      driveCompareButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      updateDriveCompareFieldVisibility();
      render();
    });
  });
  // Default compare mode is "link", which should show the parking toggle
  // right away — without this, it stays hidden (the HTML default) until
  // someone clicks a compare-mode button once.
  updateDriveCompareFieldVisibility();

  driveCompareFerryButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      driveCompareFerryRouteId = btn.dataset.abcDriveCompareFerrySelect;
      driveCompareFerryButtons.forEach((b) => b.classList.toggle("abc-active", b === btn));
      render();
    });
  });

  /** Reduced Fare's checkbox sits in its own grid slot beside the "which
   * pass/station" question, left-aligned under the trips stepper above
   * it — same position for Subway & Bus and Commuter Rail alike (the
   * subway-specific nested-under-the-pills placement from an earlier
   * round was dropped in favor of this, for visual consistency between
   * the two transit modes). Hidden entirely for Drive, same as before. */
  function updateReducedFarePlacement() {
    if (!reducedFareToggleField) return;
    if (reducedFareField) reducedFareField.style.display = routeType === "drive" ? "none" : "";
    if (reducedFareHomeMount && reducedFareToggleField.parentElement !== reducedFareHomeMount) {
      reducedFareHomeMount.appendChild(reducedFareToggleField);
    }
    reducedFareToggleField.classList.toggle("abc-farecalc-toggle-field-rail", routeType !== "drive");
  }

  function updateRouteVisibility() {
    if (subwayTierField) subwayTierField.style.display = routeType === "subway" ? "" : "none";
    if (railZoneField) railZoneField.style.display = routeType === "rail" ? "" : "none";
    if (ferryRouteField) ferryRouteField.style.display = routeType === "ferry" ? "" : "none";
    if (driveFields) driveFields.style.display = routeType === "drive" ? "" : "none";
    updateReducedFarePlacement();
    updateStationParkingFieldVisibility();
    updateRapidStationParkingFieldVisibility();
    if (tripsField) {
      const label = tripsField.querySelector("[data-abc-trips-label]");
      if (label) {
        label.textContent = routeType === "drive"
          ? "How many days a week do you drive?"
          : "How many round-trips do you take per week?";
      }
    }
    rootEl.classList.toggle("abc-theme-rail", routeType === "rail");
    rootEl.classList.toggle("abc-theme-drive", routeType === "drive");
    rootEl.classList.toggle("abc-theme-ferry", routeType === "ferry");

    // Swap the result cards themselves: Pay-Per-Ride/Monthly Pass for
    // transit routes, the two driving/comparison cards for Drive.
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
      // A value valid for transit (round-trips/week, uncapped) can be
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

  // ---- Generic stepper (trips/week, parking days): typed or +/- ----
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
    updateBusPilotUI();
    if (routeType === "drive") renderDrive();
    else renderEmployee();
    scheduleAnalyticsFlush();
  }

  function renderEmployee() {
    // tripsPerWeek is round-trips/week for every non-Drive route; buCalcAll
    // (and the Pay-Per-Ride fare math inside it) needs ONE-WAY trips, so it
    // gets doubled right here, the single place that conversion happens.
    const oneWayTripsPerWeek = tripsPerWeek * 2;
    // CR Pay-Per-Ride needs an added subway/bus leg unless this station is
    // on the Framingham/Worcester Line (see BU_STATIONS' "line: 'fw'" doc
    // comment) — not relevant for Subway & Bus or Ferry, which have no
    // transfer-to-campus question to begin with.
    const currentStation = routeType === "rail" ? buGetStation(currentStationLabel()) : null;
    const includeSubwayLeg = routeType === "rail" && !!currentStation && currentStation.line !== "fw";
    const result = buCalcAll(currentPassId(), oneWayTripsPerWeek, reducedFare, includeSubwayLeg);
    // Station parking subsidy: BU_STATIONS for Commuter Rail, or
    // MBTA_RAPID_STATIONS for Subway & Bus — same subsidy either way,
    // just a different dataset depending on route (see
    // buCalcStationParkingSubsidy's doc comment).
    let parkingSubsidy = null;
    if (routeType === "rail" && stationParking && currentStation && currentStation.parkingRate != null) {
      parkingSubsidy = buCalcStationParkingSubsidy(currentStation.parkingRate, stationParkingDays);
    } else if (routeType === "subway" && rapidStationParking) {
      const rapidStation = buGetRapidStation(currentRapidStationLabel());
      if (rapidStation) parkingSubsidy = buCalcStationParkingSubsidy(rapidStation.parkingRate, rapidStationParkingDays);
    }
    const bluebikesMonthlyCost = bluebikesAdded ? BU_CONFIG.bluebikesAnnualPrice / 12 : 0;
    // Parking is asymmetric (ride pays the full rate, pass gets the
    // subsidized net rate), so it can flip which option is actually
    // cheaper — the winner/savings comparison below must account for it,
    // not just result.winner/.annualSavings, which buCalcAll computes
    // before parking or Bluebikes exist.
    const rideParkingAddon = parkingSubsidy ? parkingSubsidy.fullMonthlyCost : 0;
    const passParkingAddon = parkingSubsidy ? parkingSubsidy.netCost : 0;

    // Every card total below is built the same way: round each line to a
    // whole dollar as it's painted, and keep a running "remaining" value
    // that the final line is set from — so what's on screen always adds
    // up exactly, even though none of the underlying math (the 4.33
    // weeks/month conversion, 50% splits, promo percentages) produces
    // round numbers on its own. "Total monthly cost" also spells out its
    // own formula inline for Pay-Per-Ride, where that conversion actually
    // happens; Monthly Pass is just the flat sticker price, no formula
    // needed there.

    // ---- Pay-Per-Ride card. No BU subsidy here, ever — BU doesn't
    // subsidize single-ride fares (see buCalcAll's doc comment). ----
    const rideTotalLabelEl = rootEl.querySelector("[data-abc-ride-total-label]");
    if (rideTotalLabelEl && result.pass) {
      const fareDescription = includeSubwayLeg
        ? `${abcFormatCurrency(result.pass.oneWayFare)} CR + ${abcFormatCurrency(buGetPassOption("linkpass").oneWayFare)} subway`
        : abcFormatCurrency(result.pass.oneWayFare);
      rideTotalLabelEl.textContent =
        `Total monthly cost (${fareDescription}/trip × ${oneWayTripsPerWeek} one-way trip${oneWayTripsPerWeek === 1 ? "" : "s"}/week × ${BU_CONFIG.weeksPerMonth.toFixed(2)} weeks/month)`;
    }
    let rideRemaining = roundAndShow("[data-abc-ride-total]", result.rideRegularTotal, false);
    const rideReducedRow = rootEl.querySelector("[data-abc-ride-reduced-row]");
    if (reducedFare && result.rideReducedFareDiscount > 0.005) {
      rideRemaining += roundAndShow("[data-abc-ride-reduced-amt]", result.rideReducedFareDiscount, true);
      rideReducedRow.style.display = "flex";
    } else {
      rideReducedRow.style.display = "none";
    }

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

    // ---- Pre-tax savings: Monthly Pass only (see BU_CONFIG.
    // preTaxSavingsPct's doc comment). Per Carl Larson's explicit request,
    // this is now a proper itemized deduction feeding "Your estimated
    // monthly cost" directly, the same treatment BU subsidy gets, not a
    // separate footnoted figure. ----
    const pretaxLine = rootEl.querySelector("[data-abc-pretax-line]");
    if (result.preTaxSavingsAmt > 0.5) {
      passRemaining += roundAndShow("[data-abc-pretax-amt]", result.preTaxSavingsAmt, true);
      pretaxLine.style.display = "flex";
    } else {
      pretaxLine.style.display = "none";
    }

    // ---- MBTA station parking: an ADD-ON to the pass/ride cost (not a
    // discount on it), only applied when the checkbox is on. BU's 50%
    // parking subsidy requires a BU-subsidized Monthly Pass (confirmed by
    // Carl Larson, BU Transportation Services, 2026-10), so Pay-Per-Ride
    // gets the full, unsubsidized parking line while Monthly Pass gets the
    // full cost plus the subsidy deducted from it, same two-line itemized
    // shape as everything else. ----
    const rideParkingRow = rootEl.querySelector("[data-abc-ride-station-parking-row]");
    const passParkingRow = rootEl.querySelector("[data-abc-pass-station-parking-row]");
    const passParkingSubsidyRow = rootEl.querySelector("[data-abc-pass-station-parking-subsidy-row]");
    if (parkingSubsidy) {
      const parkingLabel = `MBTA station parking (${abcFormatCurrency(parkingSubsidy.rate)}/day × ${parkingSubsidy.daysPerWeek} day${parkingSubsidy.daysPerWeek === 1 ? "" : "s"}/week × ${BU_CONFIG.weeksPerMonth.toFixed(2)} weeks/month)`;

      rootEl.querySelector("[data-abc-ride-station-parking-label]").textContent = parkingLabel;
      rideRemaining += roundAndShow("[data-abc-ride-station-parking-amt]", parkingSubsidy.fullMonthlyCost, false);
      if (rideParkingRow) rideParkingRow.style.display = "flex";

      rootEl.querySelector("[data-abc-pass-station-parking-label]").textContent = parkingLabel;
      passRemaining += roundAndShow("[data-abc-pass-station-parking-amt]", parkingSubsidy.fullMonthlyCost, false);
      passRemaining += roundAndShow("[data-abc-pass-station-parking-subsidy-amt]", parkingSubsidy.subsidyAmt, true);
      if (passParkingRow) passParkingRow.style.display = "flex";
      if (passParkingSubsidyRow) passParkingSubsidyRow.style.display = "flex";
    } else {
      if (rideParkingRow) rideParkingRow.style.display = "none";
      if (passParkingRow) passParkingRow.style.display = "none";
      if (passParkingSubsidyRow) passParkingSubsidyRow.style.display = "none";
    }

    // ---- Bluebikes membership add-on: MBTA-independent, so the same flat
    // monthly cost is added to both cards equally (unaffected by BU's
    // subsidy or pre-tax savings, which only apply to the transit pass). ----
    const rideBikeRow = rootEl.querySelector("[data-abc-ride-bluebikes-row]");
    const passBikeRow = rootEl.querySelector("[data-abc-pass-bluebikes-row]");
    if (bluebikesAdded) {
      rideRemaining += roundAndShow("[data-abc-ride-bluebikes-amt]", bluebikesMonthlyCost, false);
      passRemaining += roundAndShow("[data-abc-pass-bluebikes-amt]", bluebikesMonthlyCost, false);
      if (rideBikeRow) rideBikeRow.style.display = "flex";
      if (passBikeRow) passBikeRow.style.display = "flex";
    } else {
      if (rideBikeRow) rideBikeRow.style.display = "none";
      if (passBikeRow) passBikeRow.style.display = "none";
    }

    rootEl.querySelector("[data-abc-ride-final]").textContent = abcFormatCurrencyWhole(rideRemaining);
    rootEl.querySelector("[data-abc-pass-final]").textContent = abcFormatCurrencyWhole(passRemaining);
    // finalCost used below (winner/savings calc) stays on the precise,
    // unrounded math — only display is rounded, so a photo-finish between
    // ride and pass still picks the actual cheaper option. Parking and
    // Bluebikes addons are folded in here too, since they're part of
    // what's actually on screen for each card.
    const rideFinalCost = result.rideFinalCost + rideParkingAddon + bluebikesMonthlyCost;
    const passFinalCost = result.passEffectiveCost + passParkingAddon + bluebikesMonthlyCost;
    const winner = passFinalCost <= rideFinalCost ? "pass" : "ride";
    const annualSavings = Math.abs(passFinalCost - rideFinalCost) * 12;

    const rideCard = rootEl.querySelector("[data-abc-card-ride]");
    const passCard = rootEl.querySelector("[data-abc-card-pass]");
    rideCard.classList.toggle("abc-card-winner", winner === "ride");
    passCard.classList.toggle("abc-card-winner", winner === "pass");
    rideCard.querySelector("[data-abc-badge]").style.visibility = winner === "ride" ? "visible" : "hidden";
    passCard.querySelector("[data-abc-badge]").style.visibility = winner === "pass" ? "visible" : "hidden";

    const winnerCard = winner === "ride" ? rideCard : passCard;
    const loserCard = winner === "ride" ? passCard : rideCard;
    const otherOptionLabel = winner === "ride" ? "purchasing a monthly pass" : "paying per ride";
    winnerCard.querySelector("[data-abc-savings-line]").style.display = annualSavings > 0.5 ? "block" : "none";
    winnerCard.querySelector("[data-abc-savings-amt]").textContent = abcFormatCurrencyWhole(abcRoundToDollar(annualSavings));
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
    // On-campus parking isn't BU-subsidized, but the monthly permits (and
    // Crosstown's monthly option) ARE pre-tax, same payroll-deduction
    // mechanism Monthly Pass benefits from — per Carl Larson's explicit
    // ask, parking gets the same pre-tax treatment transit does, so the
    // two sides of this comparison stay apples-to-apples. Crosstown's
    // daily rate is post-tax (parking.preTax is false there), so no
    // pre-tax line shows for that specific option.
    const parkingPreTaxSavings = parking && parking.preTax ? parking.monthlyCost * (BU_CONFIG.preTaxSavingsPct / 100) : 0;

    // Reference card: what transit would cost at the same frequency, so
    // driving and transit sit side by side as asked. The in-card toggle
    // swaps which pass this compares against — Bus Pass and Link Pass
    // resolve directly, Commuter Rail and Ferry resolve from their own
    // inline station/route pickers — then renders the exact same itemized
    // waterfall (total, Reduced Fare, promo, BU subsidy, final) the main
    // Pay-Per-Ride/Monthly Pass cards use, via buCalcAll().
    let comparePassId, compareTitle, compareStation;
    if (driveCompareMode === "bus") {
      comparePassId = "local-bus";
      compareTitle = "Bus Pass Instead";
    } else if (driveCompareMode === "rail") {
      compareStation = driveCompareStationInput ? buGetStation(driveCompareStationInput.value.trim()) : null;
      comparePassId = compareStation ? compareStation.zoneId : "";
      compareTitle = "Commuter Rail Instead";
    } else if (driveCompareMode === "ferry") {
      comparePassId = driveCompareFerryRouteId;
      compareTitle = "Ferry Instead";
    } else {
      comparePassId = "linkpass";
      compareTitle = "Link Pass Instead";
    }
    // driving days -> one-way transit-equivalent trips, same conversion
    // the main cards use for their round-trips/week question.
    const compareTrips = tripsPerWeek * 2;
    const compareResult = buCalcAll(comparePassId, compareTrips, reducedFare);
    const parkingCost = parking ? parking.monthlyCost : 0;
    const parkingEffectiveCost = parkingCost - parkingPreTaxSavings;

    const labelEl = rootEl.querySelector("[data-abc-drive-label]");
    const contextNoteEl = rootEl.querySelector("[data-abc-drive-context-note]");
    const rateLabelEl = rootEl.querySelector("[data-abc-drive-rate-label]");
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

    // Itemized rate line, then (when pre-tax) the savings deduction, same
    // running-remainder waterfall every other card in this tool uses, so
    // the final bold number always equals exactly what's printed above it.
    let driveRemaining = 0;
    if (rateLabelEl && parking) {
      if (parking.isFlat) {
        rateLabelEl.textContent = "Monthly permit rate";
      } else {
        rateLabelEl.textContent = `Daily rate (${abcFormatCurrency(parking.rate)}/day × ${parking.daysPerWeek} day${parking.daysPerWeek === 1 ? "" : "s"}/week × ${BU_CONFIG.weeksPerMonth.toFixed(2)} weeks/month)`;
      }
      driveRemaining += roundAndShow("[data-abc-drive-rate-amt]", parking.monthlyCost, false);
    }
    const drivePretaxRow = rootEl.querySelector("[data-abc-drive-pretax-row]");
    if (parking && parking.preTax && parkingPreTaxSavings > 0.5) {
      driveRemaining += roundAndShow("[data-abc-drive-pretax-amt]", parkingPreTaxSavings, true);
      drivePretaxRow.style.display = "flex";
    } else {
      drivePretaxRow.style.display = "none";
    }
    rootEl.querySelector("[data-abc-drive-total]").textContent = abcFormatCurrencyWhole(driveRemaining);

    const compareTitleEl = rootEl.querySelector("[data-abc-drive-compare-title]");
    if (compareTitleEl) compareTitleEl.textContent = compareTitle;

    const compareTotalLabelEl = rootEl.querySelector("[data-abc-drive-compare-total-label]");
    if (compareTotalLabelEl) {
      compareTotalLabelEl.textContent = (driveCompareMode === "rail" || driveCompareMode === "ferry") && compareResult.pass
        ? `Total monthly cost (${compareResult.pass.label})`
        : "Total monthly cost";
    }
    let compareRemaining = roundAndShow("[data-abc-drive-compare-total]", compareResult.passRegularTotal, false);
    const compareReducedRow = rootEl.querySelector("[data-abc-drive-compare-reduced-row]");
    if (reducedFare && compareResult.reducedFareDiscount > 0.005) {
      compareRemaining += roundAndShow("[data-abc-drive-compare-reduced-amt]", compareResult.reducedFareDiscount, true);
      compareReducedRow.style.display = "flex";
    } else {
      compareReducedRow.style.display = "none";
    }
    const comparePromoRow = rootEl.querySelector("[data-abc-drive-compare-promo-row]");
    if (compareResult.promoApplies) {
      const promoAmt = compareResult.promoOriginalPrice - compareResult.passBreakdown.total;
      rootEl.querySelector("[data-abc-drive-compare-promo-label]").textContent = `Commuter Rail promo (${BU_CONFIG.promo.discountPct}%)`;
      compareRemaining += roundAndShow("[data-abc-drive-compare-promo-amt]", promoAmt, true);
      comparePromoRow.style.display = "flex";
    } else {
      comparePromoRow.style.display = "none";
    }
    compareRemaining += roundAndShow("[data-abc-drive-compare-subsidy-amt]", compareResult.passBreakdown.subsidyAmt, true);
    const comparePretaxRow = rootEl.querySelector("[data-abc-drive-compare-pretax-row]");
    if (compareResult.preTaxSavingsAmt > 0.5) {
      compareRemaining += roundAndShow("[data-abc-drive-compare-pretax-amt]", compareResult.preTaxSavingsAmt, true);
      comparePretaxRow.style.display = "flex";
    } else {
      comparePretaxRow.style.display = "none";
    }

    // ---- "Drive to the station" park-and-ride: this compare card always
    // represents a Monthly Pass scenario, so it gets the full BU subsidy
    // treatment (full cost + subsidy deducted), same as the main Monthly
    // Pass card. Rate source depends on mode — rail reuses compareStation
    // (already resolved above), bus/link resolve their own rapid-transit
    // station search. ----
    let compareParkingRate = null;
    if (driveCompareParking) {
      if (driveCompareMode === "rail" && compareStation && compareStation.parkingRate != null) {
        compareParkingRate = compareStation.parkingRate;
      } else if (driveCompareMode === "bus" || driveCompareMode === "link") {
        const rapidStation = buGetRapidStation(currentDriveCompareRapidStationLabel());
        if (rapidStation) compareParkingRate = rapidStation.parkingRate;
      }
    }
    const compareParkingSubsidy = compareParkingRate != null ? buCalcStationParkingSubsidy(compareParkingRate, driveCompareParkingDays) : null;
    const compareParkingRow = rootEl.querySelector("[data-abc-drive-compare-parking-row]");
    const compareParkingSubsidyRow = rootEl.querySelector("[data-abc-drive-compare-parking-subsidy-row]");
    if (compareParkingSubsidy) {
      rootEl.querySelector("[data-abc-drive-compare-parking-label]").textContent =
        `MBTA station parking (${abcFormatCurrency(compareParkingSubsidy.rate)}/day × ${compareParkingSubsidy.daysPerWeek} day${compareParkingSubsidy.daysPerWeek === 1 ? "" : "s"}/week × ${BU_CONFIG.weeksPerMonth.toFixed(2)} weeks/month)`;
      compareRemaining += roundAndShow("[data-abc-drive-compare-parking-amt]", compareParkingSubsidy.fullMonthlyCost, false);
      compareRemaining += roundAndShow("[data-abc-drive-compare-parking-subsidy-amt]", compareParkingSubsidy.subsidyAmt, true);
      compareParkingRow.style.display = "flex";
      compareParkingSubsidyRow.style.display = "flex";
    } else {
      compareParkingRow.style.display = "none";
      compareParkingSubsidyRow.style.display = "none";
    }

    // ---- Bluebikes add-on, same flat line the main cards use ----
    const compareBluebikesRow = rootEl.querySelector("[data-abc-drive-compare-bluebikes-row]");
    if (driveCompareBluebikesAdded) {
      compareRemaining += roundAndShow("[data-abc-drive-compare-bluebikes-amt]", BU_CONFIG.bluebikesAnnualPrice / 12, false);
      compareBluebikesRow.style.display = "flex";
    } else {
      compareBluebikesRow.style.display = "none";
    }

    rootEl.querySelector("[data-abc-drive-compare-final]").textContent = abcFormatCurrencyWhole(compareRemaining);
    // compareCost stays on the precise, unrounded math for the winner/
    // savings comparison below, same "display rounds, math doesn't" rule
    // the main cards follow. Pre-tax-adjusted on both sides (parking and
    // the compared pass alike), per Carl Larson's explicit request that
    // this comparison stay apples-to-apples. Station parking (net of its
    // own subsidy) and Bluebikes are also folded in here, since both are
    // already part of what compareRemaining shows on screen — leaving
    // them out made a cheaper-looking card lose, and made the park-and-
    // ride days stepper have no effect on "you save $X a year".
    const compareParkingNetCost = compareParkingSubsidy ? compareParkingSubsidy.netCost : 0;
    const compareBluebikesCost = driveCompareBluebikesAdded ? BU_CONFIG.bluebikesAnnualPrice / 12 : 0;
    const compareCost = compareResult.passEffectiveCost + compareParkingNetCost + compareBluebikesCost;

    // Same winner highlight the Pay-Per-Ride/Monthly Pass cards use,
    // driven by whichever option is actually cheaper at the chosen
    // frequency.
    const driveModeCards = rootEl.querySelectorAll('[data-abc-mode-card="drive"]');
    const driveCard = driveModeCards[0];
    const compareCard = driveModeCards[1];
    if (driveCard && compareCard) {
      const driveWins = parkingEffectiveCost <= compareCost;
      driveCard.classList.toggle("abc-card-winner", driveWins);
      compareCard.classList.toggle("abc-card-winner", !driveWins);
      driveCard.querySelector("[data-abc-badge]").style.visibility = driveWins ? "visible" : "hidden";
      compareCard.querySelector("[data-abc-badge]").style.visibility = !driveWins ? "visible" : "hidden";

      const winnerCard = driveWins ? driveCard : compareCard;
      const loserCard = driveWins ? compareCard : driveCard;
      const diff = Math.abs(parkingEffectiveCost - compareCost);
      winnerCard.querySelector("[data-abc-savings-line]").style.display = diff > 0.5 ? "block" : "none";
      winnerCard.querySelector("[data-abc-savings-amt]").textContent = abcFormatCurrencyWhole(abcRoundToDollar(diff * 12));
      loserCard.querySelector("[data-abc-savings-line]").style.display = "none";

      const driveCompareVsText = {
        bus: "taking the bus",
        link: "taking Subway & Bus",
        rail: "taking Commuter Rail",
        ferry: "taking the ferry",
      }[driveCompareMode];
      const driveSavingsVsEl = driveCard.querySelector("[data-abc-savings-vs]");
      if (driveSavingsVsEl) driveSavingsVsEl.textContent = driveCompareVsText;
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
    if (routeType === "ferry") {
      const opt = buGetPassOption(ferryRouteId);
      return "Ferry: " + (opt ? opt.label : "");
    }
    const opt = buGetPassOption(employeeRailPassId());
    return "Commuter Rail: " + (opt ? opt.label : "");
  }

  function analyticsPayload() {
    // mode/employeeCount are kept in the payload shape (hardcoded, since
    // the Employer tab was removed) rather than renamed, so whatever reads
    // this on the Airtable side doesn't need a matching schema change.
    return {
      org: sessionOrg,
      recordId: sessionRecordId,
      mode: "employee",
      transit: currentTransitLabel(),
      reducedFare,
      employeeCount: null,
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
