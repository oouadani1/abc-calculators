/* ============================================================
   A Better City — Calculator analytics proxy (Cloudflare Worker)

   Receives a small JSON payload from the fare calculator and forwards it
   to Airtable, keeping the Airtable token server-side. The token NEVER
   appears in this file or in the public tool — it is read at runtime from
   the Worker's environment.

   ---- Deploy (no CLI needed) ----
   1. dash.cloudflare.com  →  Workers & Pages  →  Create  →  Worker.
   2. Paste this whole file in as the Worker code and deploy once.
   3. Worker  →  Settings  →  Variables and Secrets, add:
        AIRTABLE_TOKEN   (Secret)   your Airtable personal access token
        AIRTABLE_BASE    (Text)     base id, looks like appXXXXXXXXXXXXXX
        AIRTABLE_TABLE   (Text)     table name, e.g. "Calculator Logs"
      Optional:
        ALLOWED_ORIGINS  (Text)     comma-separated list of sites allowed to
                                    POST here. Defaults to the GitHub Pages
                                    origin below. Add your ModX/site origin
                                    and any future host here.
   4. Copy the Worker's URL (…workers.dev) and paste it into
      MBTA_CONFIG.analytics.endpoint in mbta-fare-calculator/calculator.js.

   Scope the Airtable token to ONLY the analytics base, data.records:write.
   ============================================================ */

const DEFAULT_ALLOWED = ["https://oouadani1.github.io"];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGINS
      ? env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
      : DEFAULT_ALLOWED;
    // Reflect the request origin only if it's on the allow-list; otherwise
    // fall back to the first allowed origin (so browsers on other sites
    // are refused by CORS rather than silently accepted).
    const allowOrigin = allowed.includes(origin) ? origin : allowed[0];

    const cors = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    let data;
    try {
      data = await request.json();
    } catch (err) {
      return new Response("Bad JSON", { status: 400, headers: cors });
    }

    const org = (data.org || "").toString().trim();
    if (!org) {
      // No organization = nothing worth logging; the tool shouldn't send
      // these, but guard anyway.
      return new Response("Missing org", { status: 400, headers: cors });
    }

    // Map the tool's payload onto the Airtable table's fields. Keep these
    // names in sync with the table's column names.
    const fields = {
      "Organization": org,
      "Mode": data.mode || "",
      "Transit": data.transit || "",
      "Employer contribution %": Number(data.contributionPct) || 0,
      "Offers Perq": !!data.offersPerq,
      "Perq %": Number(data.perqPct) || 0,
    };
    if (data.employeeCount != null && data.employeeCount !== "") {
      fields["Employees covered"] = Number(data.employeeCount) || 0;
    }

    const airtableUrl =
      `https://api.airtable.com/v0/${env.AIRTABLE_BASE}/${encodeURIComponent(env.AIRTABLE_TABLE)}`;

    const res = await fetch(airtableUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
      },
      // typecast lets Airtable coerce values into single-selects, numbers,
      // etc. without an exact type match on our side.
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return new Response(`Airtable error: ${detail}`, { status: 502, headers: cors });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  },
};
