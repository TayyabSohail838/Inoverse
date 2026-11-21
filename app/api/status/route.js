// GET /api/status → what is configured, for the setup screen. Public; never returns secrets.
// The Supabase URL and anon key are public by design (the browser signs in with them;
// Row Level Security decides what they can reach).
import { serviceDb, dbEnabled, anonKey, supabaseUrl } from "@/lib/db";
import { isDemo } from "@/lib/demo";
import { authRequired, authConfigured } from "@/lib/auth";

export async function GET() {
  const status = {
    accessCodeRequired: Boolean(process.env.ACCESS_CODE) && !dbEnabled(),
    demo: isDemo(), // public link: sample data instead of the founder's real tasks, people and email
    gemma: {
      configured: Boolean(process.env.GEMINI_API_KEY),
      model: process.env.GEMMA_MODEL || "gemma-4-31b-it",
    },
    supabase: { configured: dbEnabled(), ok: false, error: null },
    auth: {
      required: authRequired(),
      configured: authConfigured(),
      url: authRequired() && authConfigured() ? supabaseUrl() : null,
      anonKey: authRequired() && authConfigured() ? anonKey() : null,
    },
  };

  if (status.supabase.configured) {
    try {
      const { error } = await serviceDb().from("organizations").select("id").limit(1);
      if (error) throw new Error(error.message);
      status.supabase.ok = true;
    } catch (err) {
      status.supabase.error = /organizations|relation .* does not exist|schema cache/i.test(err.message)
        ? "Multi-company tables not found. Run supabase/multitenant.sql in the Supabase SQL Editor."
        : err.message;
    }
  }
  return Response.json(status);
}
