// supabase/functions/hubrise-webhook/index.ts
//
// FRONTERA de ingesta de HubRise (frontera única + origen-agnóstico).
// ============================================================================
// Gemelo de lastapp-webhook, con el contrato de HubRise (callbacks de pedido).
// Reparto rector: la FRONTERA (este archivo) resuelve cabecera (cuenta, local,
// marca, canal), escribe `sale` + raw, y delega al MOTOR SQL:
//   adapt_hubrise_order(p_sale_id)  -> construye sale_line (product/combo/modifier)
//   close_sale(p_sale_id)           -> coste + consumo (al completar)
//   cancel_sale(p_sale_id, reason)  -> revierte (cancelado/rechazado/fallido)
//
// EVENTOS (callback de HubRise; resource_type='order'):
//   order.create / order.update con new_state = pedido COMPLETO.
//   El estado del pedido (new_state.status) decide la transición:
//     new|received|accepted|in_preparation|awaiting_collection|in_delivery -> open
//     completed                                                            -> closed
//     cancelled|rejected|delivery_failed                                   -> cancelled
//
// IDENTIDAD: external_ref = order.id (HubRise tiene UN pedido por id, no tabs).
// MARCA: por (location_id, connection_name) vía external_brand_map source='hubrise'.
//        Nunca se deduce del producto (principio de marca estable).
//
// SEGURIDAD (frontera): HubRise firma cada request con
//   X-HubRise-Hmac-SHA256 = HEX( HMAC_SHA256( body_crudo, CLIENT_SECRET ) ).
//   OJO (verificado contra la doc de HubRise): la firma es HEXDIGEST (no base64)
//   y el secreto es el CLIENT_SECRET del cliente OAuth (no un secreto de webhook
//   aparte). En el entorno, HUBRISE_WEBHOOK_SECRET DEBE contener el client_secret.
//   Se valida sobre los BYTES EXACTOS del body (sin re-serializar). Firma inválida -> 401.
//
// DEPLOY (al alta, H3): SIEMPRE con --no-verify-jwt (sin la flag el gateway corta
//   con 401 antes de ejecutar y la ingesta falla en silencio).
//
// PENDIENTE DE CONFIRMAR EL DÍA DEL ALTA (no son decisiones, son comprobaciones):
//   - Que `connection_name` venga poblado por marca virtual (clave de marca).
//   - Que el estado `completed` llegue de Uber Eats / Just Eat vía HubRise.
//   - Cadenas exactas de `channel` (p.ej. "Uber Eats" / "Just Eat" / "Glovo").
// (Resuelto: el secreto HMAC es el client_secret del cliente OAuth, único por
//  aplicación, en hex. No es por conexión.)

import { corsHeaders } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const HUBRISE_WEBHOOK_SECRET = Deno.env.get("HUBRISE_WEBHOOK_SECRET") ?? "";

// ── Firma HMAC-SHA256 (Web Crypto) ──────────────────────────────────────────
// HubRise firma en HEXDIGEST (no base64). El secreto es el client_secret.
async function computeHmacSha256Hex(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function isValidSignature(rawBody: string, headerSig: string | null): Promise<boolean> {
  if (!headerSig || !HUBRISE_WEBHOOK_SECRET) return false;
  // HubRise envía el hex en minúsculas; normalizamos por si acaso.
  const expected = await computeHmacSha256Hex(HUBRISE_WEBHOOK_SECRET, rawBody);
  return timingSafeEqual(expected, headerSig.trim().toLowerCase());
}

// ── Helpers de formato HubRise ──────────────────────────────────────────────
// Importes "9.00 EUR" -> 9.00 (unidades mayores; NO céntimos).
function money(s: unknown): number | null {
  if (s === null || s === undefined) return null;
  const n = parseFloat(String(s).split(" ")[0]);
  return Number.isNaN(n) ? null : n;
}

// channel (nombre del cliente API / bridge) -> slug de sales_channel.
function channelSlug(channel: string | null | undefined): string | null {
  if (!channel) return null;
  const t = channel.toLowerCase();
  if (t.includes("glovo")) return "glovo";
  if (t.includes("uber")) return "uber";
  if (t.includes("just")) return "justeat"; // "Just Eat" / "JustEat" / "Just Eat Flyt"
  if (t.includes("deliveroo")) return "deliveroo";
  return null;
}

// service_type HubRise (delivery|collection|eat_in) -> service_type canónico.
function mapServiceType(st: string | null | undefined): string | null {
  if (!st) return null;
  const t = st.toLowerCase();
  if (t === "delivery") return "platform_delivery";
  if (t === "collection") return "pickup";
  if (t === "eat_in") return "eat_in";
  return null;
}

// estado HubRise -> estado canónico de la venta.
type CanonStatus = "open" | "closed" | "cancelled";
function mapStatus(s: string | null | undefined): CanonStatus {
  const t = (s ?? "").toLowerCase();
  if (t === "cancelled" || t === "rejected" || t === "delivery_failed") return "cancelled";
  if (t === "completed") return "closed";
  // new | received | accepted | in_preparation | awaiting_collection | in_delivery
  return "open";
}

// estado del PEDIDO de plataforma (espejo de HubRise en sale.order_status).
// Solo deja pasar los valores admitidos por el CHECK; cualquier otro -> null
// (nunca rompe el upsert por un estado inesperado).
const ORDER_STATUS_ALLOWED = new Set([
  "new", "received", "accepted", "in_preparation", "awaiting_collection",
  "awaiting_shipment", "in_delivery", "completed", "rejected", "cancelled", "delivery_failed",
]);
function mapOrderStatus(s: string | null | undefined): string | null {
  const t = (s ?? "").toLowerCase();
  return ORDER_STATUS_ALLOWED.has(t) ? t : null;
}

// Suma de descuentos (price_off) de un pedido HubRise.
function sumDiscounts(order: Record<string, unknown>): number | null {
  const arr = order["discounts"];
  if (!Array.isArray(arr)) return null;
  let total = 0;
  for (const d of arr) {
    if (d && (d as Record<string, unknown>)["deleted"] === true) continue;
    const v = money((d as Record<string, unknown>)["price_off"]);
    if (v) total += v;
  }
  return total > 0 ? total : null;
}

// ── Resolución de cabecera (cuenta/local, marca, canal) ─────────────────────
async function resolveLocation(
  sb: SupabaseClient, hubriseLocationId: string,
): Promise<{ accountId: string; locationId: string | null } | null> {
  const { data, error } = await sb.from("external_location_map")
    .select("account_id, location_id")
    .eq("source", "hubrise")
    .eq("external_location_id", hubriseLocationId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`external_location_map: ${error.message}`);
  if (!data) return null;
  return {
    accountId: data.account_id as string,
    locationId: (data.location_id as string | null) ?? null,
  };
}

async function resolveBrand(
  sb: SupabaseClient, accountId: string, hubriseLocationId: string, connectionName: string | null,
): Promise<string | null> {
  if (!connectionName) return null;
  const { data, error } = await sb.from("external_brand_map")
    .select("brand_id, is_ignored")
    .eq("account_id", accountId)
    .eq("source", "hubrise")
    .eq("external_location_id", hubriseLocationId)
    .eq("external_brand_id", connectionName)
    .maybeSingle();
  if (error) throw new Error(`external_brand_map: ${error.message}`);
  if (!data || data.is_ignored === true || !data.brand_id) return null;
  return data.brand_id as string;
}

async function resolveChannel(
  sb: SupabaseClient, accountId: string, slug: string | null,
): Promise<string | null> {
  if (!slug) return null;
  const { data, error } = await sb.from("sales_channel")
    .select("id, is_active")
    .eq("account_id", accountId)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`sales_channel: ${error.message}`);
  if (!data || data.is_active === false) return null;
  return data.id as string;
}

// ── upsertSale: crea o REFRESCA la venta desde el pedido HubRise. NO la cierra. ──
// Idempotente por external_ref = order.id. GUARD: una venta ya closed/cancelled
// NO se re-adapta (un update tardío no corrompe una venta consolidada).
async function upsertSale(
  sb: SupabaseClient, accountId: string, locationId: string | null,
  order: Record<string, unknown>, caches: { brandId: string | null; channelId: string | null },
): Promise<{ id: string; status: string; isNew: boolean } | null> {
  const orderId = order["id"] as string | undefined;
  if (!orderId) return null;

  const channelText = (order["channel"] as string | null) ?? (order["created_by"] as string | null) ?? null;
  const deliveryFee = money((order["delivery"] as Record<string, unknown> | undefined)?.["fee"]);

  const common = {
    external_channel_text: channelText,
    channel_id: caches.channelId,
    brand_id: caches.brandId,
    location_id: locationId,
    external_brand_text: (order["connection_name"] as string | null) ?? null,
    external_location_text: (order["location_id"] as string | null) ?? null,
    external_tab_ref: orderId, // HubRise: el id del pedido también agrupa (no hay tab aparte)
    order_status: mapOrderStatus(order["status"] as string | null),
    sold_at: (order["created_at"] as string | null) ?? new Date().toISOString(),
    total: money(order["total"]) ?? 0,
    delivery_cost: deliveryFee,
    discount_amount: sumDiscounts(order),
    tax: null,          // HubRise da tax_rate por línea; total de impuesto no directo (futuro)
    taxable_base: null,
    service_type: mapServiceType(order["service_type"] as string | null),
    raw_products: JSON.stringify(order["items"] ?? []),
    raw_tab: JSON.stringify(order),
  };

  const { data: existing, error: exErr } = await sb.from("sale")
    .select("id, status")
    .eq("account_id", accountId).eq("source", "hubrise")
    .eq("external_ref", String(orderId)).limit(1).maybeSingle();
  if (exErr) throw new Error(`exists check ${orderId}: ${exErr.message}`);

  if (existing) {
    const status = (existing as { status?: string }).status ?? "open";
    if (status !== "open") return { id: (existing as { id: string }).id, status, isNew: false };

    await sb.from("sale").update({ ...common, updated_at: new Date().toISOString() })
      .eq("id", (existing as { id: string }).id);
    const { error: adaptErr } = await sb.rpc("adapt_hubrise_order", { p_sale_id: (existing as { id: string }).id });
    if (adaptErr) console.error(`re-adapt ${orderId}: ${adaptErr.message}`);
    return { id: (existing as { id: string }).id, status: "open", isNew: false };
  }

  const { data: saleRow, error: saleErr } = await sb.from("sale").insert({
    account_id: accountId,
    source: "hubrise",
    external_ref: String(orderId),
    status: "open",
    opened_at: (order["created_at"] as string | null) ?? new Date().toISOString(),
    is_active: true,
    ...common,
  }).select("id").single();
  if (saleErr || !saleRow) throw new Error(`sale insert ${orderId}: ${saleErr?.message ?? "unknown"}`);

  const { error: adaptErr } = await sb.rpc("adapt_hubrise_order", { p_sale_id: saleRow.id });
  if (adaptErr) {
    await sb.from("sale").delete().eq("id", saleRow.id); // no dejar venta huérfana sin líneas
    throw new Error(`adapt_hubrise_order ${orderId}: ${adaptErr.message}`);
  }
  return { id: saleRow.id, status: "open", isNew: true };
}

async function cancelByOrderId(
  sb: SupabaseClient, accountId: string, orderId: string, reason: string,
): Promise<boolean> {
  const { data: sale, error } = await sb.from("sale").select("id, status")
    .eq("account_id", accountId).eq("source", "hubrise")
    .eq("external_ref", String(orderId)).limit(1).maybeSingle();
  if (error) { console.error(`cancel lookup ${orderId}: ${error.message}`); return false; }
  if (!sale) return false;
  if ((sale as { status?: string }).status === "cancelled") return true;

  const { error: cErr } = await sb.rpc("cancel_sale", {
    p_sale_id: (sale as { id: string }).id, p_reason: reason,
  });
  if (cErr) { console.error(`cancel_sale ${orderId}: ${cErr.message}`); return false; }
  // Espejo del estado de plataforma (rejected/cancelled/delivery_failed).
  const os = mapOrderStatus(reason);
  if (os) {
    await sb.from("sale").update({ order_status: os })
      .eq("id", (sale as { id: string }).id);
  }
  return true;
}

// ── Entrada HTTP (la frontera) ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  // 1) Body CRUDO (necesario para el HMAC: bytes exactos).
  const rawBody = await req.text();

  // 2) Validar firma en la frontera. Sin firma válida -> 401.
  const sig = req.headers.get("x-hubrise-hmac-sha256");
  if (!(await isValidSignature(rawBody, sig))) {
    return new Response(JSON.stringify({ ok: false, error: "invalid signature" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const headers: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) headers[k] = v;

  let payload: Record<string, unknown> | null = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payload = { _unparsed: rawBody };
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const resourceType = (payload?.resource_type as string | undefined) ?? null;
  const eventType = (payload?.event_type as string | undefined) ?? null;
  let note = `frontera-${resourceType ?? "?"}-${eventType ?? "?"}`;
  let processedOk = false;
  let processError: string | null = null;

  try {
    if (resourceType === "order" && (eventType === "create" || eventType === "update")) {
      // El pedido completo viene en new_state.
      const order = (payload?.new_state ?? {}) as Record<string, unknown>;
      const hubriseLocationId =
        (order["location_id"] as string | undefined) ??
        (payload?.location_id as string | undefined) ?? null;
      if (!hubriseLocationId) throw new Error("order sin location_id");

      const loc = await resolveLocation(sb, hubriseLocationId);
      if (!loc) throw new Error(`location ${hubriseLocationId} no mapeada (external_location_map)`);

      const orderId = order["id"] as string | undefined;
      const canon = mapStatus(order["status"] as string | null);

      if (canon === "cancelled") {
        if (orderId) {
          await cancelByOrderId(sb, loc.accountId, String(orderId),
            (order["status"] as string | null) ?? "cancelled");
        }
        processedOk = true;
      } else {
        const brandId = await resolveBrand(
          sb, loc.accountId, hubriseLocationId, (order["connection_name"] as string | null) ?? null);
        const channelId = await resolveChannel(
          sb, loc.accountId, channelSlug(order["channel"] as string | null));

        const r = await upsertSale(sb, loc.accountId, loc.locationId, order, { brandId, channelId });
        if (r && canon === "closed" && r.status === "open") {
          // completed -> consolidar coste + consumo.
          const { error: closeErr } = await sb.rpc("close_sale", { p_sale_id: r.id });
          if (closeErr) console.error(`close_sale ${orderId}: ${closeErr.message}`);
        }
        processedOk = true;
      }
    } else {
      // Otros recursos (catalog/inventory/customer/delivery): aún no manejados.
      // Aceptar para no provocar reintentos en bucle; queda traza en el log.
      note = `frontera-ignorado-${resourceType ?? "?"}-${eventType ?? "?"}`;
      processedOk = true;
    }
  } catch (e) {
    processError = e instanceof Error ? e.message : String(e);
    console.error("hubrise-webhook error", processError);
  }

  // Log SIEMPRE (auditoría; reproceso desde el log si algo falló).
  try {
    await sb.from("external_webhook_log").insert({
      source: "hubrise", headers, payload, note, processed: processedOk,
    });
  } catch (e) {
    console.error("log insert error", e);
  }

  // Ack 200 (HubRise considera entregado con 200-499 en <20s).
  return new Response(
    JSON.stringify({ ok: true, resource: resourceType, event: eventType, processed: processedOk, error: processError }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
