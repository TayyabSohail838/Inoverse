// The real supabase/*.sql files in an in-memory Postgres: moving the old single company over,
// and Row Level Security keeping every company's data to itself.
import { test } from "node:test";
import { database, sql, ok, fails } from "./helpers.mjs";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";

test("companies can't see or change each other's data", async (t) => {
  const db = await database(["schema.sql", "tasks.sql", "people.sql", "seed.sql"], {
    users: [
      { id: A, email: "founder@inovix.co" },
      { id: B, email: "b@other.co" },
      { id: C, email: "c@other.co", confirmed: false },
    ],
  });
  await db.exec(`
    insert into tasks (company, title) values ('inovix', 'Secret Inovix task');
    insert into integrations (company, provider, refresh_token) values ('inovix', 'google', 'SECRET-REFRESH');
  `);

  // run a query as a signed-in user (or signed out with uid = null), the way Supabase does
  async function as(uid, email, query, params) {
    await db.exec(
      `reset role; select set_config('request.jwt.claim.sub', '${uid || ""}', false); select set_config('request.jwt.claims', '${JSON.stringify({ email })}', false); set role ${uid ? "authenticated" : "anon"};`
    );
    try {
      return await db.query(query, params);
    } finally {
      await db.exec("reset role");
    }
  }
  const count = async (uid, email, table) => (await as(uid, email, `select count(*)::int n from ${table}`)).rows[0].n;

  let org;
  await t.test("moving the old single company over", async () => {
    await db.exec(sql("multitenant.sql"));
    org = (await db.query(`select id, name from organizations where slug = 'inovix'`)).rows[0];
    ok(org, "the existing company became an organization");
    ok((await db.query(`select count(*)::int n from tasks where org_id is null`)).rows[0].n === 0, "every existing task moved to it");
    await db.exec(sql("multitenant.sql"));
    await db.exec(sql("claim-org.sql").replace("you@example.com", "founder@inovix.co"));
  });

  await t.test("the founder claims the old company", async () => {
    ok((await as(A, "founder@inovix.co", "select accept_invites() n")).rows[0].n === 1, "invite accepted on sign-in");
    ok((await count(A, "founder@inovix.co", "tasks")) >= 1, "sees Inovix tasks");
    ok((await as(A, "founder@inovix.co", "select role from memberships where user_id = $1", [A])).rows[0]?.role === "owner", "is owner");
    ok((await count(A, "founder@inovix.co", "integrations")) === 0, "can't read Google sign-in keys from the browser");
  });

  let bOrg;
  await t.test("another company", async () => {
    bOrg = (await as(B, "b@other.co", "select (create_organization('Other Co')).id")).rows[0].id;
    ok(bOrg, "creates its own company");
    ok((await count(B, "b@other.co", "tasks")) === 0, "sees none of Inovix's tasks");
    ok((await count(B, "b@other.co", "company_profile")) === 1, "sees only its own profile");
    ok((await count(B, "b@other.co", "organizations")) === 1, "sees only its own organization");
    ok(await fails(() => as(B, "b@other.co", "insert into tasks (org_id, title) values ($1, 'planted')", [org.id])), "can't write into Inovix");
    ok(await fails(() => as(B, "b@other.co", "insert into org_invites (org_id, email) values ($1, 'b@other.co')", [org.id])), "can't invite itself into Inovix");
    await as(B, "b@other.co", "delete from memberships where org_id = $1", [org.id]);
    ok((await db.query("select count(*)::int n from memberships where org_id = $1", [org.id])).rows[0].n === 1, "can't remove Inovix's founder");
    await as(B, "b@other.co", "update tasks set title = 'hacked'");
    ok((await db.query("select count(*)::int n from tasks where title = 'hacked'")).rows[0].n === 0, "can't edit Inovix's tasks");
    ok((await count(B, "b@other.co", "whatsapp_numbers")) === 0, "WhatsApp numbers are server-only");
  });

  await t.test("invites", async () => {
    await as(B, "b@other.co", "insert into org_invites (org_id, email) values ($1, 'c@other.co')", [bOrg]);
    ok((await as(C, "c@other.co", "select accept_invites() n")).rows[0].n === 0, "an unconfirmed email can't claim an invite");
    await db.exec(`update auth.users set email_confirmed_at = now() where id = '${C}'`);
    ok((await as(C, "c@other.co", "select accept_invites() n")).rows[0].n === 1, "a confirmed email joins");
    ok((await count(C, "c@other.co", "tasks")) === 0, "Other Co's teammate still can't see Inovix");
    ok(await fails(() => as(C, "c@other.co", "insert into org_invites (org_id, email) values ($1, 'x@y.co')", [bOrg])), "members (not owners) can't invite");
  });

  await t.test("signed out", async () => {
    ok((await count(null, "", "tasks")) === 0, "sees nothing");
    ok(await fails(() => as(null, "", "select create_organization('x')")), "can't create companies");
  });
});
