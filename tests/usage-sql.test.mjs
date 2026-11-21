// supabase/usage.sql: AI allowance counting (also used by the rate limits), all-or-nothing
// charging, and no access from the browser.
import { test } from "node:test";
import { database, sql, ok, fails } from "./helpers.mjs";

test("AI allowance and rate-limit counters", async (t) => {
  const db = await database(["schema.sql", "tasks.sql", "people.sql", "seed.sql", "multitenant.sql", "usage.sql"]);
  await db.exec(sql("usage.sql")); // safe to run twice

  const spend = async (keys, windows, limits, cost, role = "service_role") => {
    await db.exec(`set role ${role}`);
    try {
      return (await db.query("select ai_spend($1, $2, $3, $4) r", [keys, windows, limits, cost])).rows[0].r;
    } finally {
      await db.exec("reset role");
    }
  };

  await t.test("allowance", async () => {
    ok((await spend(["u:1:h", "o:A:d"], [3600, 86400], [10, 12], 4)).allowed === true, "first spend allowed");
    await spend(["u:1:h", "o:A:d"], [3600, 86400], [10, 12], 4);
    const r3 = await spend(["u:1:h", "o:A:d"], [3600, 86400], [10, 12], 4);
    ok(r3.allowed === false && r3.key === "u:1:h" && r3.used === 8, "stops when the user's hour is full", JSON.stringify(r3));
    const used = (await db.query("select key, used from ai_limits order by key")).rows;
    ok(used.find((u) => u.key === "o:A:d").used === 8, "a refused spend charges nothing", JSON.stringify(used));
    const r4 = await spend(["u:2:h", "o:A:d"], [3600, 86400], [10, 12], 5);
    ok(r4.allowed === false && r4.key === "o:A:d", "another user is stopped by the company's daily limit", JSON.stringify(r4));
    ok(Boolean(r4.reset_at), "says when it resets");
  });

  await t.test("many requests at once never go past the limit", async () => {
    await Promise.all(Array.from({ length: 25 }, () => spend(["o:B:d"], [86400], [10], 1)));
    ok((await db.query("select used from ai_limits where key = 'o:B:d'")).rows[0].used === 10, "stops at exactly 10");
  });

  await t.test("monthly totals per feature", async () => {
    const org = (await db.query("select id from organizations where slug = 'inovix'")).rows[0].id;
    await db.query(
      "insert into ai_usage (org_id, feature, model, input_tokens, output_tokens) values ($1,'chat','m',100,50), ($1,'chat','m',10,5), ($1,'gap-check','m',1000,500), ($1,'chat','m',999,999)",
      [org]
    );
    await db.query("update ai_usage set demo = true where input_tokens = 999");
    await db.exec("set role service_role");
    const month = (await db.query("select * from org_ai_usage($1, now() - interval '1 day')", [org])).rows;
    await db.exec("reset role");
    const chat = month.find((m) => m.feature === "chat");
    ok(Number(chat.calls) === 2 && Number(chat.tokens) === 165, "demo calls are left out", JSON.stringify(month));
  });

  await t.test("not reachable from the browser", async () => {
    const org = (await db.query("select id from organizations where slug = 'inovix'")).rows[0].id;
    for (const role of ["anon", "authenticated"]) {
      ok(await fails(() => spend(["x"], [60], [1], 1, role)), `${role} can't call ai_spend`);
      await db.exec(`set role ${role}`);
      ok((await db.query("select count(*)::int n from ai_usage")).rows[0].n === 0, `${role} sees no usage rows`);
      ok(await fails(() => db.query("select * from org_ai_usage($1, now())", [org])), `${role} can't read company usage`);
      await db.exec("reset role");
    }
  });
});
