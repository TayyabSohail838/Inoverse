// GET /api/whatsapp/status → is the WhatsApp bot set up, and which numbers may talk to it for this company
import { whatsappConfigured, briefRecipients } from "@/lib/whatsapp";
import { lastInboundAt } from "@/lib/people";
import { route } from "@/lib/http";

export const GET = route(async () => {
  const numbers = await briefRecipients().catch(() => []);
  const owner = numbers[0] || "";
  return Response.json({
    configured: whatsappConfigured(),
    owner: owner ? `+${owner.slice(0, 4)}•••${owner.slice(-3)}` : "",
    linked: numbers.length,
    hasVerifyToken: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
    briefTemplate: Boolean(process.env.WHATSAPP_BRIEF_TEMPLATE),
    // the number people text, shown in the app so teammates know where to send "link <code>"
    botNumber: process.env.WHATSAPP_DISPLAY_NUMBER || "",
    lastMessageAt: await lastInboundAt().catch(() => null),
  });
});
