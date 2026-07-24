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

// finishDetails.delivered puede llegar boolean O string ("true"/"false"). Coaccionar
// robustamente: cualquier otra cosa (ausente/rara) => null (no sabemos → no forzamos).
// ESTE ERA EL AGUJERO: con `typeof === "boolean"`, un "false" string se colaba como
// 'finish' crudo y el pedido se leía como finalizado/OK sin saltar el fallo.
function parseDelivered(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return null;
}

// Aviso al canal de sistema (email vía system-alert). Fire-and-forget defensivo:
// NUNCA debe tumbar el webhook (si Catcher recibe 500 reintenta y duplica estado).
async function raiseAlert(baseUrl: string, cronSecret: string, subject: string, message: string): Promise<void> {
  if (!cronSecret) { console.log("CATCHER_ALERT_SKIP_NO_SECRET"); return; }
  try {
    await fetch(`${baseUrl}/functions/v1/system-alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret },
      body: JSON.stringify({ subject, message, kind: "catcher-delivery" }),
    });
  } catch (e) {
    console.log("CATCHER_ALERT_FAIL", String(e));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? ""; // para llamar a system-alert
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
  const finishDetails = (body.finishDetails as { delivered?: unknown } | undefined) ?? undefined;
  const delivered = parseDelivered(finishDetails?.delivered);

  if (!orderId && !externalId) {
    return json(400, { ok: false, error: "sin orderId ni externalId" });
  }

  // Localizar el pedido: por externalId (= sale.id) primero, si no por carrier_order_id.
  // Traemos el estado ACTUAL (delivery_state, order_status) para la guarda direccional.
  let saleId: string | null = null;
  let curDeliveryState: string | null = null;
  let curOrderStatus: string | null = null;
  if (externalId) {
    const { data } = await sb.from("sale").select("id, delivery_state, order_status").eq("id", externalId).maybeSingle();
    if (data) { saleId = data.id; curDeliveryState = data.delivery_state; curOrderStatus = data.order_status; }
  }
  if (!saleId && orderId) {
    const { data } = await sb.from("sale").select("id, delivery_state, order_status").eq("carrier_order_id", orderId).maybeSingle();
    if (data) { saleId = data.id; curDeliveryState = data.delivery_state; curOrderStatus = data.order_status; }
  }
  if (!saleId) {
    // Evento de Catcher que no casa con ninguna venta = SEÑAL PERDIDA (posible fallo
    // invisible). Antes solo se logueaba; ahora también avisa por system-alert.
    console.log("CATCHER_WEBHOOK_NOMATCH", { orderId, externalId, rawStatus });
    await raiseAlert(url, cronSecret,
      "Catcher: evento sin pedido (NOMATCH)",
      `Un evento de reparto de Catcher no casa con ninguna venta — posible señal perdida.\n` +
      `orderId=${orderId}\nexternalId=${externalId}\nestado=${rawStatus}\n\nRevisar el cruce externalId=sale.id con Catcher/Abdul.`);
    return json(200, { ok: true, matched: false });
  }

  // Construir el patch para sale.
  const patch: Record<string, unknown> = {};

  const state = normalizeState(rawStatus, delivered);

  // GUARDA DIRECCIONAL: un 'failed' puede CORREGIR a un 'delivered' previo, pero un
  // 'delivered' (o cualquier no-fallo) NUNCA debe pisar un 'failed' ya registrado.
  // Esto evita que un evento tardío/duplicado reescriba el fallo como entregado.
  const wouldDowngradeFailure = curDeliveryState === "failed" && state !== "failed";
  if (wouldDowngradeFailure) {
    console.log("CATCHER_WEBHOOK_DOWNGRADE_BLOCKED", { saleId, from: curDeliveryState, to: state });
  } else if (state) {
    patch.delivery_state = state;
  }

  // Fallo / cancelación de reparto → INCIDENCIAS.
  // OJO (verificado en logs): el "completado" NO garantiza entrega. Lo marca LAST al
  // cerrar la comanda del TPV, aunque la entrega física de Catcher haya fallado — y el
  // fallo de Catcher puede llegar SOBRE un pedido ya cerrado. Por eso la incidencia debe
  // levantarse AUNQUE el pedido esté completed/closed: NO se gatea a "abierto".
  // Solo se respeta un terminal DELIBERADO (cancelado/rechazado) o un fallo ya marcado.
  const isFailure = state === "failed" || state === "canceled";
  const alreadyHandled = curOrderStatus != null &&
    ["cancelled", "rejected", "delivery_failed"].includes(curOrderStatus);
  if (isFailure && !wouldDowngradeFailure && !alreadyHandled) {
    patch.order_status = "delivery_failed";
    // NO tocamos cancelled_at: un no-entregado NO es una cancelación (evitamos
    // contaminar cualquier lógica que se cuelgue de ese sello). La aparición en
    // Incidencias la cubren closed_at (si Last ya cerró) u opened_at/sold_at del
    // mismo día; el caso raro entre-días lo caza la alarma del KDS (Capa 2), que
    // no depende de la ventana temporal de orders_feed.
  }

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

  // Aviso secundario (email) SOLO al TRANSICIONAR a 'failed' (curState != failed evita
  // duplicados si Catcher reenvía). La alarma PRIMARIA en cocina (banner+sonido) la da
  // la Capa 2 leyendo delivery_state; esto es la red de respaldo para el encargado.
  if (state === "failed" && curDeliveryState !== "failed") {
    await raiseAlert(url, cronSecret,
      `Reparto NO ENTREGADO · pedido ${saleId.slice(0, 8)}`,
      `Un pedido se ha marcado NO ENTREGADO (Catcher).\n` +
      `sale_id=${saleId}\n` +
      `repartidor=${(patch.rider_name as string) ?? "—"}\n` +
      `estado_previo=${curOrderStatus ?? "—"} → ${(patch.order_status as string) ?? "sin cambiar (terminal deliberado)"}\n\n` +
      `Revisar en Incidencias. Si Last ya lo había cerrado como completado, se ha reabierto ` +
      `a incidencia (la entrega física falló pese al cierre de la comanda).`);
  }

  return json(200, {
    ok: true, matched: true, sale_id: saleId,
    delivery_state: state, raw_status: rawStatus, delivered,
    rider: patch.rider_name ?? null, transport_type: patch.rider_transport_type ?? null,
    transport_price: patch.transport_price ?? null,
  });
});
