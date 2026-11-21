// Tamper-proof little messages (HMAC-signed), for values that travel through the browser,
// like which company a Google sign-in belongs to. Server only.
// Key: APP_SECRET, or derived from the Supabase service key if APP_SECRET isn't set.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function secret() {
  const s = process.env.APP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!s) throw new Error("Set APP_SECRET in .env.local.");
  return createHash("sha256").update(`inoverse:${s}`).digest();
}

const mac = (body) => createHmac("sha256", secret()).update(body).digest("base64url");

// sign({ org: "…" }, 600) → "payload.signature", valid for ttlSecs
export function sign(data, ttlSecs) {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + ttlSecs * 1000 })).toString("base64url");
  return `${body}.${mac(body)}`;
}

// → the data, or null if it was changed or has expired
export function unsign(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}
