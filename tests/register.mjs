// Loaded before every test (node --import ./tests/register.mjs): makes the app's "@/..."
// imports work outside Next.js, the same way jsconfig.json maps them.
import { register } from "node:module";

register(new URL("./alias-hooks.mjs", import.meta.url).href);
