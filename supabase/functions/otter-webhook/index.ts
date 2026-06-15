// supabase/functions/otter-webhook/index.ts
//
// FRONTERA fina del adaptador Otter (principio rector 5: autoriza en el borde, motor puro).
// Gemelo de `lastapp-webhook`. Valida la firma X-HMAC-SHA256 de Otter, despacha por tipo de
// evento y delega el adaptado canónico al motor (RPC `adapt_otter_order` en SQL).
//
// ┌─ ESTADO: ESQUELETO. NO DESPLEGAR todavía. ──────────────────────────────────────────────┐
// │ Espera al alta de Otter:                                                                 │
// │   - OTTER_WEBHOOK_SECRET  (secret del endpoint, del Developer Portal de Otter)            │
// │   - registrar esta URL como webhook en el Developer Portal                               │
// │ Cuando se despliegue, OBLIGATORIO con la flag:                                           │
// │   supabase functions deploy otter-webhook --no-verify-jwt                                │
// │ (sin la flag, el gateway corta con 401 ANTES de ejecutar → se pierde toda entrega).      │
// └──────────────────────────────────────────────────────────────────────────────────────────┘
//
// PENDIENTE DE CONFIRMAR contra OpenAPI Reference / payload real (no verificado en vivo):
//   - El discriminador del tipo de evento (campo `type` / `event` en el body, o por header).
//   - Los nombres EXACTOS de campo del pedido (ver tabla de mapeo en
//     docs/folvy_adaptador_otter_diseno.md §7).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OTTER_WEBHOOK_SECRET = Deno.env.get("OTTER_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── Firma HMAC-SHA256 (Web Crypto) ────────────────────────────────────────────────────────
// Otter manda en TODO request el header `X-HMAC-SHA256` = base64(HMAC_SHA256(body, secret)).
// El HMAC se calcula sobre el BODY CRUDO (los bytes exactos), nunca sobre el JSON re-serializado.
async function computeHmacSha256Base64(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
}

// Comparación en tiempo constante (evita timing attacks al validar la firma).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function isValidSignature(rawBody: string, headerSig: string | null): Promise<boolean> {
  if (!headerSig || !OTTER_WEBHOOK_SECRET) return false;
  const expected = await computeHmacSha256Base64(OTTER_WEBHOOK_SECRET, rawBody);
  return timingSafeEqual(expected, headerSig);
}

// ── Despacho por tipo de evento ───────────────────────────────────────────────────────────
// TODO(alta): confirmar cómo discrimina Otter el tipo (campo del body vs ruta vs header).
function resolveEventType(payload: Record<string, unknown>): string {
  return (
    (payload["type"] as string) ??
    (payload["event"] as string) ??
    (payload["event_type"] as string) ??
    "unknown"
  );
}

// order.create → persistir el pedido COMPLETO (raw event store) y delegar el adaptado al motor.
async function handleOrderCreate(payload: Record<string, unknown>): Promise<Response> {
  // El adaptado canónico (Otter order → sale/sale_line) vive en SQL como `adapt_otter_order`
  // (motor puro, sin guard de usuario), gemelo de `adapt_lastapp_order`. Aquí solo se delega.
  // TODO(O2): implementar `adapt_otter_order` y pasar el raw completo; tras adaptar, el propio
  //           RPC (o este handler) dispara `reprocess_sale` (coste + consumo).
  const { error } = await supabase.rpc("adapt_otter_order", { p_raw: payload });
  if (error) {
    // Error de proceso → se reporta a Otter vía PublishError (TODO al cablear la API saliente).
    console.error("[otter-webhook] adapt_otter_order error:", error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }
  // 200 = procesado síncrono (decisión Folvy; 202+async queda como ruta futura).
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

// stores.upsert → aceptar la tienda (2XX). Tras aceptar, validar y devolver el external store id
// vía `v1/stores` (llamada SALIENTE, requiere Application ID/Secret → O3, al alta).
async function handleStoreUpsert(_payload: Record<string, unknown>): Promise<Response> {
  // TODO(O3): persistir/parear la tienda en external_store_map y devolver external store id a Otter.
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

// stores.fetch_credentials → devolver el esquema de credenciales custom (si aplica).
async function handleFetchCredentials(_payload: Record<string, unknown>): Promise<Response> {
  // TODO(O3): devolver el schema de credenciales que Folvy requiere (probablemente vacío).
  return new Response(JSON.stringify({ schemas: [] }), { status: 200 });
}

// ── Handler principal ─────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // 1) Leer el body CRUDO (necesario para el HMAC: bytes exactos, sin re-serializar).
  const rawBody = await req.text();

  // 2) Validar la firma en la frontera. Sin firma válida → 401, no se procesa.
  const sig = req.headers.get("x-hmac-sha256");
  if (!(await isValidSignature(rawBody, sig))) {
    return new Response("Invalid signature", { status: 401 });
  }

  // 3) Parsear y despachar.
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const eventType = resolveEventType(payload);
  switch (eventType) {
    case "order.create":
      return await handleOrderCreate(payload);
    case "stores.upsert":
      return await handleStoreUpsert(payload);
    case "stores.fetch_credentials":
      return await handleFetchCredentials(payload);
    default:
      // Evento no manejado todavía: aceptar con 200 para no provocar reintentos en bucle,
      // y dejar traza para añadir el handler. (Confirmar política de reintentos de Otter.)
      console.warn("[otter-webhook] evento no manejado:", eventType);
      return new Response(JSON.stringify({ ok: true, ignored: eventType }), { status: 200 });
  }
});
