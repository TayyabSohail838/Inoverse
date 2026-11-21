// Shared test helpers.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ok(condition, what it means, extra detail shown only if it fails)
export const ok = (cond, name, extra = "") => assert.ok(cond, extra ? `${name}: ${extra}` : name);

export const fails = async (fn) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

export const throws = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
};

// A supabase/*.sql file (PGlite has no pgcrypto; gen_random_uuid is built in).
export const sql = (file) => fs.readFileSync(path.join(ROOT, "supabase", file), "utf8").replace(/create extension if not exists pgcrypto;/gi, "");

// Postgres in memory (PGlite) with a stand-in for Supabase's auth schema and roles,
// then the given supabase/*.sql files run in order.
export async function database(files, { users = [] } = {}) {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  `);
  for (const u of users) await db.query("insert into auth.users values ($1, $2, $3)", [u.id, u.email, u.confirmed === false ? null : new Date()]);
  for (const f of files) await db.exec(sql(f));
  return db;
}
