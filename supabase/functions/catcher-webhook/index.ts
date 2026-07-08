// supabase/functions/catcher-webhook/index.ts
//
// Webhook receptor de Catcher. Dos eventos:
//   - Webhook Orders: estado del pedido + rider (cruza por externalId = sale.id).
//     Actualiza delivery_state, rider_name, rider_phone, rider_transport_type,
//     rider_lat/lng, rider_seen_at, has_courier, transport_price.
//   - Webhook HD: estado del servicio de reparto del local (open/closed). Se registra.
//
// CONTRATO (payloads reales de Abdul, 07/07/2026) — ver docs/catcher_webhook_contrato.md:
//   Máquina de estados: matching -> matched -> picking -> in_picking_location ->
//                       in_delivery -> finish   (rama alternativa: matching -> canceled)
//   Campo de estado: "Order_status" (O MAYÚSCULA). courier {name, phone, transportType,
//   latitude, longitude, transportPrice} solo con hasCourier=true (desde 'matched').
//   OJO: 'finish' NO significa entregado → finishDetails.delivered dice la verdad
//        (delivered=true -> entregado; false -> finalizado SIN entregar = fallo).
//
// SEGURIDAD: webhook externo -> se despliega con --no-verify-jwt. La frontera la da la
// URL (secreta) y el cruce por externalId/orderId que solo Catcher conoce.

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

// Normaliza el estado de Catcher a un delivery_state veraz para Folvy.
// 'finish' se resuelve con finishDetails.delivered: entregado vs fallido.
function normalizeState(raw: string, delivered: boolean | null): string {
  if (raw === "finish") {
    if (delivered === true) return "delivered";
    if (delivered === false) return "failed";
    return "finish"; // sin dato de entrega: se deja el crudo
  }
  return raw; // matching, matched, picking, in_picking_location, in_delivery, canceled...
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
  const rawStatus = (body.Order_status as string) ?? (body.order_status as string) ?? "";
  const hasCourier = body.hasCourier === true;
  const courier = (body.courier as CourierInfo | undefined) ?? undefined;
  const finishDetails = (body.finishDetails as { delivered?: boolean } | undefined) ?? undefined;
  const delivered = finishDetails && typeof finishDetails.delivered === "boolean" ? finishDetails.delivered : null;

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
    console.log("CATCHER_WEBHOOK_NOMATCH", { orderId, externalId });
    return json(200, { ok: true, matched: false });
  }

  // Construir el patch para sale.
  const patch: Record<string, unknown> = {};

  const state = normalizeState(rawStatus, delivered);
  if (state) patch.delivery_state = state;

  // has_courier: booleano limpio "¿ya hay repartidor?".
  if (typeof body.hasCourier === "boolean") patch.has_courier = hasCourier;

  // Datos del rider: solo cuando vienen (no pisar con nulos en matching/canceled).
  if (courier) {
    if (courier.name) patch.rider_name = courier.name;
    if (courier.phone) patch.rider_phone = courier.phone;
    if (courier.transportType) patch.rider_transport_type = courier.transportType;

    const lat = courier.latitude != null && courier.latitude !== "" ? Number(courier.latitude) : NaN;
    const lng = courier.longitude != null && courier.longitude !== "" ? Number(courier.longitude) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      patch.rider_lat = lat;
      patch.rider_lng = lng;
      patch.rider_seen_at = new Date().toISOString(); // última posición/estado visto
    }

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

  return json(200, {
    ok: true, matched: true, sale_id: saleId,
    delivery_state: state, raw_status: rawStatus, delivered,
    rider: patch.rider_name ?? null, transport_type: patch.rider_transport_type ?? null,
    transport_price: patch.transport_price ?? null,
  });
});
