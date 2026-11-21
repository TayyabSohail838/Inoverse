// Encrypts secrets before they go into the database (e.g. Google sign-in keys). Server only.
//
// AES-256-GCM. A stored value looks like  enc:v1:<key id>:<iv>:<tag>:<data>  so a leaked
// database (or backup) alone is useless without the key, which lives only in Vercel's settings.
//
// The key: ENCRYPTION_KEY (any long random string; `node -e "console.log(require('crypto')
// .randomBytes(32).toString('base64'))"` makes one). Without it, a key derived from the
// service key is used, which still keeps database-only leaks safe.
// To change the key: put the old one in ENCRYPTION_KEY_OLD and the new one in ENCRYPTION_KEY.
// Old values still open (each value names its key), and are re-saved with the new key when read.
//
// open() also accepts values saved before encryption existed (plain text), so nothing breaks
// while old rows are being upgraded.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function material(secret) {
  const key = createHash("sha256").update(secret).digest(); // 32 bytes from any string
  const id = createHash("sha256").update(key).digest("hex").slice(0, 8); // names the key, reveals nothing
  return { key, id };
}

// [current, ...older] keys that can open values
function keys() {
  const list = [];
  const add = (s) => s && !list.some((k) => k.secret === s) && list.push({ secret: s, ...material(s) });
  add((process.env.ENCRYPTION_KEY || "").trim());
  add((process.env.ENCRYPTION_KEY_OLD || "").trim());
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (service) add(`inoverse-secretbox:${service}`);
  if (!list.length) throw new Error("No encryption key: set ENCRYPTION_KEY (or SUPABASE_SERVICE_ROLE_KEY).");
  return list;
}

export const isSealed = (value) => typeof value === "string" && value.startsWith(PREFIX);

// text → "enc:v1:…"
export function seal(text) {
  if (text == null || text === "") return text;
  const { key, id } = keys()[0];
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return PREFIX + [id, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

// "enc:v1:…" → text. Plain (old) values come back as they are.
export function open(value) {
  if (!isSealed(value)) return value;
  const [id, iv, tag, data] = value.slice(PREFIX.length).split(":");
  const k = keys().find((x) => x.id === id);
  if (!k) throw new Error("This secret was encrypted with a key that isn't set any more (ENCRYPTION_KEY / ENCRYPTION_KEY_OLD).");
  const decipher = createDecipheriv("aes-256-gcm", k.key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

// Should this stored value be re-saved? (plain text, or sealed with an older key)
export function needsReseal(value) {
  if (!value) return false;
  if (!isSealed(value)) return true;
  return value.slice(PREFIX.length).split(":")[0] !== keys()[0].id;
}
