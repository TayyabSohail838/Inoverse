// POST  /api/orgs { name, timezone? } → { org: { id, name } }: start a new company, with you as owner.
//        timezone comes from the founder's browser, so the morning brief arrives at 8:00 their time.
// PATCH /api/orgs { timezone } → change the open company's time zone (owners only).
import { route, readJson, requireOwner } from "@/lib/http";
import { createOrg, setTimezone, validTimezone } from "@/lib/orgs";
import { forgetToken } from "@/lib/auth";
import { tenant } from "@/lib/tenant";
import { demoReadOnly } from "@/lib/demo";
import { hit } from "@/lib/ratelimit";

export const POST = route(
  async (req) => {
    demoReadOnly();
    await hit("create-org", req);
    const { name, timezone } = await readJson(req);
    const org = await createOrg(name);
    // you're its owner now, so you may set it; quietly skipped if jobs.sql isn't run yet
    if (validTimezone(timezone)) await setTimezone(timezone, org.id).catch(() => {});
    forgetToken(tenant().token); // their company list just changed
    return Response.json({ org }, { status: 201 });
  },
  { needOrg: false }
);

export const PATCH = route(async (req) => {
  demoReadOnly();
  requireOwner();
  const { timezone } = await readJson(req);
  const tz = await setTimezone(timezone);
  forgetToken(tenant().token); // the company list carries the time zone
  return Response.json({ timezone: tz });
});
