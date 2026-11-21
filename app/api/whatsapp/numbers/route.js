// GET    /api/whatsapp/numbers → { numbers: [{ phone, masked, verified, code }] } for this company
// POST   /api/whatsapp/numbers { phone } → { phone, code }: start linking; text "link <code>" to Inovo from that phone
// DELETE /api/whatsapp/numbers { phone } → unlink
import { route, readJson } from "@/lib/http";
import { listNumbers, addNumber, removeNumber } from "@/lib/phones";
import { demoReadOnly, isDemo } from "@/lib/demo";
import { orgReady } from "@/lib/db";
import { hit } from "@/lib/ratelimit";

export const GET = route(async () => {
  if (isDemo() || !orgReady()) return Response.json({ numbers: [] });
  return Response.json({ numbers: await listNumbers() });
});

export const POST = route(async (req) => {
  demoReadOnly();
  await hit("add-number", req);
  const { phone } = await readJson(req);
  return Response.json(await addNumber(phone), { status: 201 });
});

export const DELETE = route(async (req) => {
  demoReadOnly();
  const { phone } = await readJson(req);
  await removeNumber(phone);
  return Response.json({ ok: true });
});
