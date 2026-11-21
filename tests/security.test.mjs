// Phase 4: encrypted secrets, rate limits, request size limits, link code expiry.
import { test } from "node:test";
import { ok, throws } from "./helpers.mjs";

process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-test";
delete process.env.ENCRYPTION_KEY;
delete process.env.ENCRYPTION_KEY_OLD;
// no database: rate limits count in memory
delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;

const { seal, open, needsReseal, isSealed } = await import("@/lib/secretbox");
const { hit } = await import("@/lib/ratelimit");
const { readJson } = await import("@/lib/http");
const { LimitError } = await import("@/lib/usage");

test("secrets are encrypted before saving", async () => {
  const token = "1//0g-example-refresh-token";
  const sealed = seal(token);
  ok(isSealed(sealed) && !sealed.includes(token), "the saved value doesn't contain the token");
  ok(open(sealed) === token, "it opens back to the token");
  ok(seal(token) !== seal(token), "the same token encrypts differently each time");
  ok(open(token) === token && needsReseal(token), "old plain values still work and get re-encrypted");
  ok(!needsReseal(sealed), "a current value is left alone");

  const tampered = sealed.slice(0, -4) + (sealed.endsWith("AAAA") ? "BBBB" : "AAAA");
  ok(await throws(() => open(tampered)), "a changed value is rejected");

  process.env.ENCRYPTION_KEY = "a-new-key-for-the-test";
  try {
    ok(open(sealed) === token, "after setting a new key, older values still open");
    ok(needsReseal(sealed), "and are marked to be re-encrypted with the new key");
    const fresh = seal(token);
    delete process.env.ENCRYPTION_KEY;
    ok(/key that isn't set/.test((await throws(() => open(fresh)))?.message || ""), "a missing key gives a clear error");
  } finally {
    delete process.env.ENCRYPTION_KEY;
  }
});

test("rate limits stop fast repeats", async () => {
  const who = `test-${Date.now()}`;
  const tries = [];
  for (let i = 0; i < 7; i++) tries.push(await hit("link-code", null, { who, throwIt: false }));
  ok(tries.slice(0, 5).every(Boolean) && !tries[5] && !tries[6], "5 link-code tries, then blocked", JSON.stringify(tries));
  ok(await hit("link-code", null, { who: `${who}-other`, throwIt: false }), "another phone isn't affected");

  let err = null;
  try {
    for (let i = 0; i < 6; i++) await hit("create-org", null, { who });
  } catch (e) {
    err = e;
  }
  ok(err instanceof LimitError && /Too many new companies/.test(err.message), "the 6th new company in an hour is refused with a clear message", err?.message);
});

test("requests have a size limit", async () => {
  const req = (body, headers = {}) => new Request("http://x/api", { method: "POST", body, headers });
  ok((await readJson(req('{"a":1}'))).a === 1, "normal JSON is read");
  ok(/too much/i.test((await throws(() => readJson(req("x".repeat(1_000_001)))))?.message || ""), "more than 1 MB is refused");
  ok(/too much/i.test((await throws(() => readJson(req("{}", { "content-length": "5000000" }))))?.message || ""), "a declared size over the limit is refused before reading");
  ok((await readJson(req(JSON.stringify({ audio: "x".repeat(2_000_000) })), { max: 4_100_000 })).audio.length === 2_000_000, "a route can allow more (voice)");
  ok(/must be JSON/.test((await throws(() => readJson(req("not json"))))?.message || ""), "broken JSON gets a clear error");
});
