// POST /api/google/connect → { url }: where to send the browser to let Inoverse read your
// "Inovo" emails and calendar. The app then goes to that URL.
// A fetch (not a page visit), so the sign-in and company come with it like any API call.
// The company travels to the callback inside a signed, 10-minute state value, and a
// matching cookie proves the same browser started it.
import { randomBytes } from "node:crypto";
import { authUrl, googleConfigured } from "@/lib/google";
import { isDemo } from "@/lib/demo";
import { route } from "@/lib/http";
import { tenantOrNull } from "@/lib/tenant";
import { sign } from "@/lib/signed";
import { hit } from "@/lib/ratelimit";

export const POST = route(async (req) => {
  const url = new URL(req.url);
  // the public demo never connects a real inbox
  if (isDemo()) return Response.json({ url: "/?gmail=demo" });
  if (!googleConfigured()) return Response.json({ url: "/?gmail=not-configured" });
  await hit("google-connect", req);

  const t = tenantOrNull(); // null in single-laptop mode (no database)
  const nonce = randomBytes(16).toString("hex");
  const state = sign({ nonce, org: t?.orgId || null, user: t?.userId || null }, 600);
  return new Response(JSON.stringify({ url: authUrl(url.origin, state) }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `g_oauth_state=${nonce}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=600${url.protocol === "https:" ? "; Secure" : ""}`,
    },
  });
});
