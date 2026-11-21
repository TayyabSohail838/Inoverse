// "@/lib/x" → <project>/lib/x.js
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(spec, ctx, next) {
  if (spec.startsWith("@/")) {
    const file = path.join(ROOT, spec.slice(2));
    return next(pathToFileURL(/\.\w+$/.test(file) ? file : file + ".js").href, ctx);
  }
  return next(spec, ctx);
}
