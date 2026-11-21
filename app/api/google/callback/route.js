// GET /api/google/callback → Google sends you back here after sign-in.
// Saves the long-lived sign-in for the company that started it (from the signed state),
// so Inovo can keep checking that company's "Inovo" emails and calendar.
import { exchangeCode, PROVIDER } from "@/lib/google";
import { saveIntegration } from "@/lib/tasks";
import { isDemo } from "@/lib/demo";
import { unsign } from "@/lib/signed";
import { runAsOrg } from "@/lib/tenant";
import { dbEnabled, serviceDb } from "@/lib/db";

const back = (url, params) => {
  const to = new URL("/", url);
  for (const [k, v] of Object.entries(params)) to.searchParams.set(k, v);
  return new Response(null, {
    status: 302,
    headers: { Location: to.toString(), "Set-Cookie": "g_oauth_state=; Path=/api/google; Max-Age=0" },
  });
};

export async function GET(req) {
  const url = new URL(req.url);
  if (isDemo()) return back(url, { gmail: "demo" });
  if (url.searchParams.get("error")) return back(url, { gmail: "cancelled" });

  const cookie = req.headers.get("cookie") || "";
  const nonce = cookie.match(/(?:^|;\s*)g_oauth_state=([a-f0-9]+)/)?.[1];
  const state = unsign(url.searchParams.get("state"));
  if (!nonce || !state || state.nonce !== nonce) {
    return back(url, { gmail: "error", reason: "The sign-in link expired. Try Connect Gmail again." });
  }
  if (dbEnabled() && !state.org) return back(url, { gmail: "error", reason: "Open your company in Inoverse, then connect Gmail again." });

  try {
    const { refresh_token, account, scopes } = await exchangeCode(url.searchParams.get("code"), url.origin);
    if (!refresh_token) throw new Error("Google didn't give long-term access. Remove Inoverse at myaccount.google.com/permissions and connect again.");
    const save = () => saveIntegration(PROVIDER, { account, refresh_token, scopes });
    // background work for that one company; the service client is fine because the
    // signed state proves which company asked
    if (state.org) await runAsOrg({ orgId: state.org, userId: state.user, client: serviceDb(), system: true }, save);
    else await save();
    return back(url, { gmail: "connected" });
  } catch (err) {
    return back(url, { gmail: "error", reason: err.message.slice(0, 200) });
  }
}
