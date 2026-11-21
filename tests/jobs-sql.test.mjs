// supabase/jobs.sql: handing jobs to workers, leases, dedupe, and no access from the browser.
import { test } from "node:test";
import { database, sql, ok, fails } from "./helpers.mjs";

test("background job table", async (t) => {
  const db = await database(["schema.sql", "tasks.sql", "people.sql", "seed.sql", "multitenant.sql", "usage.sql", "jobs.sql"]);
  await db.exec(sql("jobs.sql")); // safe to run twice

  const org = (await db.query("select id, timezone from organizations where slug = 'inovix'")).rows[0];
  const claim = async (n = 10, lease = 90) => {
    await db.exec("set role service_role");
    try {
      return (await db.query("select * from claim_jobs($1, $2)", [n, lease])).rows;
    } finally {
      await db.exec("reset role");
    }
  };

  await t.test("time zone", () => ok(org.timezone === "Asia/Karachi", "existing companies get Asia/Karachi"));

  let first;
  await t.test("claiming", async () => {
    await db.query("insert into jobs (kind, org_id) values ('a', $1), ('b', $1), ('c', $1)", [org.id]);
    await db.query("insert into jobs (kind, run_at) values ('later', now() + interval '1 hour')");
    first = await claim(2);
    ok(first.length === 2 && first.every((j) => j.status === "running" && j.attempts === 1), "claims due jobs, marks them running, counts the try");
    const second = await claim(10);
    ok(second.length === 1 && !first.some((j) => j.id === second[0].id), "a second worker only gets the job nobody has");
    ok((await claim(10)).length === 0, "jobs for later aren't handed out early");
  });

  await t.test("a worker that dies", async () => {
    await db.query("update jobs set locked_until = now() - interval '1 second' where id = $1", [first[0].id]);
    const again = await claim(10);
    ok(again.length === 1 && again[0].id === first[0].id && again[0].attempts === 2, "its job is picked up again as try 2 when the lease runs out");
  });

  await t.test("dedupe", async () => {
    for (let i = 0; i < 2; i++) await db.query("insert into jobs (kind, dedupe_key) values ('brief', 'brief:x:2026-11-21') on conflict (dedupe_key) do nothing");
    ok((await db.query("select count(*)::int n from jobs where dedupe_key = 'brief:x:2026-11-21'")).rows[0].n === 1, "the same brief is only added once");
  });

  await t.test("not reachable from the browser", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      ok((await db.query("select count(*)::int n from jobs")).rows[0].n === 0, `${role} sees no jobs`);
      ok(await fails(() => db.query("select * from claim_jobs(1, 60)")), `${role} can't claim jobs`);
      await db.exec("reset role");
    }
  });
});
