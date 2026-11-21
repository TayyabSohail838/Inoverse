// POST /api/orgs { name } → { org: { id, name } }: start a new company, with you as owner.
import { route, readJson } from "@/lib/http";
import { createOrg } from "@/lib/orgs";
import { forgetToken } from "@/lib/auth";
import { tenant } from "@/lib/tenant";
import { demoReadOnly } from "@/lib/demo";

export const POST = route(
  async (req) => {
    demoReadOnly();
    const { name } = await readJson(req);
    const org = await createOrg(name);
    forgetToken(tenant().token); // their company list just changed
    return Response.json({ org }, { status: 201 });
  },
  { needOrg: false }
);
