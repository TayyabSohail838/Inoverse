// GET /api/models → which AI model answers right now (the app shows it when a backup is in use)
// { chat: { main, active, onBackup, backUntil }, live: { … } }
// Models are shared by every company (one Google AI key), so this is the same for everyone.
import { route } from "@/lib/http";
import { modelStatus } from "@/lib/gemma";

export const GET = route(async () => Response.json(await modelStatus()));
