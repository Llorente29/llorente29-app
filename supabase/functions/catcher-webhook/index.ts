// supabase/functions/catcher-webhook/index.ts
//
// Webhook receptor de Catcher. Dos eventos:
//   - Webhook Orders: estado del pedido + rider (cruza por externalId = sale.id).
//     Actualiza delivery_state, rider_name, rider_phone, transport_price.
//   - Webhook HD: estado del servicio de reparto del local (open/closed). Se
//     registra; el manejo del estado del local es otro frente.
//
// SEGURIDAD: webhook externo → se despliega con --no-verify-jwt. La frontera la
// da la URL (secreta) y el cruce por externalId/orderId que solo Catcher conoce.

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface CourierInfo {
  name?: string;
  phone?: string;
  longitude?: string;
  latitude?: string;
  transportType?: string;
  transportPrice?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const sb = createClient(url, serviceKey);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid json" });
  }

  console.log("CATCHER_WEBHOOK_IN", JSON.stringify(body).slice(0, 500));

  // ── Webhook HD (estado del servicio de reparto del local) ──
  if (body.event === "home_delivery_status_changed") {
    // Por ahora solo se registra. El manejo del estado HD del local es otro frente.
    console.log("CATCHER_HD_STATUS", {
      locationId: body.locationId,
      status: body.status,
      reason: body.reason,
      effectiveUntil: body.effectiveUntil ?? body.effective_until,
    });
    return json(200, { ok: true, handled: "hd_status" });
  }

  // ── Webhook Orders (estado del pedido + rider) ──
  const orderId = (body.orderId as string) ?? "";
  const externalId = (body.externalId as string) ?? "";
  const orderStatus = (body.Order_status as string) ?? (body.order_status as string) ?? "";
  const courier = (body.courier as CourierInfo | undefined) ?? undefined;

  if (!orderId && !externalId) {
    return json(400, { ok: false, error: "sin orderId ni externalId" });
  }

  // Localizar el pedido: por externalId (= sale.id) primero, si no por carrier_order_id.
  let saleId: string | null = null;
  if (externalId) {
    const { data } = await sb.from("sale").select("id").eq("id", externalId).maybeSingle();
    if (data) saleId = data.id;
  }
  if (!saleId && orderId) {
    const { data } = await sb.from("sale").select("id").eq("carrier_order_id", orderId).maybeSingle();
    if (data) saleId = data.id;
  }
  if (!saleId) {
    // No encontrado: respondemos 200 igual (no reintentar) pero lo dejamos en log.
    console.log("CATCHER_WEBHOOK_NOMATCH", { orderId, externalId });
    return json(200, { ok: true, matched: false });
  }

  // Construir el patch para sale.
  const patch: Record<string, unknown> = {};
  if (orderStatus) patch.delivery_state = orderStatus;
  if (courier) {
    if (courier.name) patch.rider_name = courier.name;
    if (courier.phone) patch.rider_phone = courier.phone;
    if (courier.transportPrice != null && courier.transportPrice !== "") {
      const tp = Number(courier.transportPrice);
      if (Number.isFinite(tp)) patch.transport_price = tp;
    }
  }

  if (Object.keys(patch).length === 0) {
    return json(200, { ok: true, matched: true, updated: false });
  }

  const { error: updErr } = await sb.from("sale").update(patch).eq("id", saleId);
  if (updErr) {
    return json(500, { ok: false, error: updErr.message });
  }

  return json(200, { ok: true, matched: true, sale_id: saleId, delivery_state: orderStatus, transport_price: patch.transport_price ?? null });
});
