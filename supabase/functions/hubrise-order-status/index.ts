// supabase/functions/hubrise-order-status/index.ts
//
// CICLO DE VIDA DEL PEDIDO — fase 1c: empuje de estado a HubRise (SALIDA).
// ============================================================================
// La app llama aquí con (sale_id, status[, confirmed_time]). El Edge:
//   1) AUTORIZA: lee la venta con el JWT del usuario (RLS) -> confirma que la venta
//      pertenece a una cuenta del usuario. La frontera autoriza; el motor no.
//   2) RESUELVE TOKEN por conexión: external_integration (source=hubrise) por
//      (account, external_location_id[, connection_name]); fallback al Secret global.
//   3) EMPUJA: PATCH /location/orders/:id a HubRise con X-Access-Token (marca blanca:
//      Folvy llama a HubRise desde el servidor; el cliente nunca toca HubRise).
//   4) ESPEJA: si HubRise acepta (2xx), actualiza sale.order_status (service role).
//
// AUTENTICACIÓN HubRise: cabecera "X-Access-Token: <token>" (NO Bearer). El token es
//   POR LOCATION (HubRise emite un token por cliente×location).
//
// DESPLIEGUE: Edge de cara a la APP -> se despliega CON verificación JWT (por defecto).
//
// UNIFICADO (2026-07): el token ya NO sale de un único Secret global. Se resuelve por
//   conexión desde external_integration (misma fuente que hubrise-catalog-publish y
//   hubrise-webhook). El Secret HUBRISE_ACCESS_TOKEN queda solo como fallback de
//   compatibilidad hasta retirarlo.

import { corsHeaders } from "../_shared/cors.ts";
import { resolveHubriseToken } from "../_shared/hubriseToken.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HUBRISE_API_BASE = Deno.env.get("HUBRISE_API_BASE") ?? "https://api.hubrise.com/v1";
const HUBRISE_ACCESS_TOKEN_ENV = Deno.env.get("HUBRISE_ACCESS_TOKEN") ?? "";

// Estados que el EPOS PUEDE enviar a HubRise (no 'new' inicial ni 'awaiting_shipment' deprecado).
const SENDABLE = new Set([
  "received", "accepted", "in_preparation", "awaiting_collection",
  "in_delivery", "completed", "rejected", "cancelled",
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  // 1) JWT del usuario (la frontera autoriza con RLS).
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "No autenticado" }, 401);

  let payload: { sale_id?: string; status?: string; confirmed_time?: string | null };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const saleId = (payload.sale_id ?? "").trim();
  const status = (payload.status ?? "").trim().toLowerCase();
  const confirmedTime = payload.confirmed_time ?? null;

  if (!saleId) return json({ error: "Falta sale_id" }, 400);
  if (!SENDABLE.has(status)) return json({ error: `Estado no enviable a HubRise: ${status}` }, 400);

  // Cliente con el JWT del usuario -> RLS autoriza la lectura de la venta.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: sale, error: saleErr } = await userClient
    .from("sale")
    .select("id, account_id, source, external_ref, external_location_text, external_brand_text")
    .eq("id", saleId)
    .maybeSingle();

  if (saleErr) return json({ error: `Lectura de venta: ${saleErr.message}` }, 400);
  if (!sale) return json({ error: "Venta no encontrada o sin permiso" }, 403);
  if (sale.source !== "hubrise") return json({ error: "La venta no es de HubRise" }, 400);
  if (!sale.external_ref) return json({ error: "La venta no tiene id de pedido de HubRise" }, 400);

  // Cliente service_role: resolver token por conexión y espejar el estado.
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // 2) Token por conexión (fallback al Secret global durante la migración).
  const dbToken = await resolveHubriseToken(svc, {
    accountId: sale.account_id as string,
    externalLocationId: (sale.external_location_text as string | null) ?? null,
    connectionName: (sale.external_brand_text as string | null) ?? null,
  });
  const accessToken = ((dbToken ?? "").trim()) || HUBRISE_ACCESS_TOKEN_ENV;
  if (!accessToken) return json({ error: "Sin token HubRise para esta conexión (external_integration vacío y sin Secret)" }, 500);

  // 3) Empuje a HubRise.
  const orderBody: Record<string, unknown> = { status };
  if (confirmedTime) orderBody["confirmed_time"] = confirmedTime;

  const url = `${HUBRISE_API_BASE}/location/orders/${encodeURIComponent(sale.external_ref)}`;
  let hubResp: Response;
  try {
    hubResp = await fetch(url, {
      // PATCH (no PUT): ver auditoría de integración HubRise. No revertir a PUT.
      method: "PATCH",
      headers: {
        "X-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderBody),
    });
  } catch (e) {
    return json({ error: `Error de red contra HubRise: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }

  if (!hubResp.ok) {
    const text = await hubResp.text().catch(() => "");
    return json({ error: `HubRise rechazó el cambio (${hubResp.status})`, detail: text.slice(0, 500) }, 502);
  }

  // 4) Espejo local SOLO si HubRise aceptó (service role: el order_status no depende de RLS de UPDATE).
  const { error: updErr } = await svc.from("sale").update({ order_status: status }).eq("id", saleId);
  if (updErr) {
    return json({
      ok: true,
      status,
      warning: `Empujado a HubRise, pero el espejo local falló: ${updErr.message}`,
    });
  }

  return json({ ok: true, status });
});
