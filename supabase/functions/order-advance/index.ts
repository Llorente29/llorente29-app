// supabase/functions/order-advance/index.ts
//
// EMPUJE AL CANAL · disparado por el trigger trg_sale_push_status cuando
// sale.order_status cambia. VÍA ÚNICA: el front nunca llama aquí; lo hace la BBDD.
// ============================================================================
// Entra por net.http_post del trigger, con header x-order-advance-secret (sin JWT).
// Deploy CON --no-verify-jwt: la frontera la valida el SECRET.
//
// CICLO DE VIDA POR TIPO DE REPARTO (7a):
//   - platform_delivery: Folvy empuja hasta READY_TO_PICKUP (listo para el rider).
//     El CIERRE (completed) NO se empuja: el rider de Glovo aún lleva el pedido al
//     cliente; Glovo gestiona ese tramo. Empujar DELIVERED daría INVALID_STATUS_CHANGE.
//   - own_delivery / pickup: se empuja todo el ciclo (Folvy controla el desenlace).

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";

const LASTAPP_BASE = "https://api.last.app/v2";

const LAST_STATUS: Record<string, string | null> = {
  new: null,
  received: null,
  accepted: null,
  in_preparation: "KITCHEN",
  awaiting_collection: "READY_TO_PICKUP",
  awaiting_shipment: "READY_TO_PICKUP",
  in_delivery: "ON_DELIVERY",
  completed: "DELIVERED",
  rejected: null,
  cancelled: null,
  delivery_failed: null,
};

const CANCEL_STATES = ["cancelled", "rejected", "delivery_failed"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ROTACION SIN CORTE (B55, 03/09/2026). El secreto vivia en texto plano dentro
  // del cuerpo de trg_sale_push_status, y anon/authenticated tienen SELECT sobre
  // pg_proc: era legible. Ademas viajaba en el repositorio. Hay que rotarlo, no
  // solo esconderlo.
  //
  // El problema es que rotar tiene un precipicio: si se cambia este env antes que
  // la funcion, la BBDD sigue mandando el secreto viejo; si se cambia la funcion
  // antes, aqui se espera el viejo. En los dos casos son 401 y TODOS los empujes
  // caidos hasta que cuadren. Por eso durante la ventana se aceptan los dos.
  //
  // El aviso de abajo es el que dice cuando se puede retirar ORDER_ADVANCE_SECRET_PREV:
  // mientras siga apareciendo en los logs, la rotacion no ha terminado. Cuando deje
  // de salir, se borra la variable y el secreto viejo queda muerto.
  const secret = req.headers.get("x-order-advance-secret") ?? "";
  const expected = Deno.env.get("ORDER_ADVANCE_SECRET") ?? "";
  const previous = Deno.env.get("ORDER_ADVANCE_SECRET_PREV") ?? "";
  const conElNuevo = expected !== "" && secret === expected;
  const conElViejo = previous !== "" && secret === previous;
  if (!conElNuevo && !conElViejo) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (conElViejo) {
    console.warn(
      "order-advance: peticion aceptada con el secreto ANTERIOR. La rotacion B55 " +
      "no ha terminado: falta que trg_sale_push_status lea el nuevo de Vault. " +
      "No retirar ORDER_ADVANCE_SECRET_PREV mientras salga este aviso.",
    );
  }

  let body: { sale_id?: string; new_status?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const saleId = body.sale_id;
  const newStatus = body.new_status;
  if (!saleId || !newStatus) {
    return json({ ok: false, error: "sale_id y new_status requeridos" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const { data: sale } = await sb.from("sale")
    .select("account_id, source, external_tab_ref, external_location_text, service_type")
    .eq("id", saleId).maybeSingle();

  if (!sale) return json({ ok: false, error: "venta no encontrada" }, 404);
  if (sale.source !== "lastapp") {
    return json({ ok: true, push: { attempted: false, reason: "canal sin empuje saliente" } }, 200);
  }

  // Plataforma: Folvy NO empuja el cierre (Glovo gestiona la entrega del rider al cliente).
  if (newStatus === "completed" && sale.service_type === "platform_delivery") {
    return json({ ok: true, push: { attempted: false, reason: "plataforma cierra en su sistema" } }, 200);
  }

  const { data: integ } = await sb.from("external_integration")
    .select("token_secret_name, push_status_enabled, is_active")
    .eq("account_id", sale.account_id).eq("source", "lastapp").eq("is_active", true)
    .limit(1).maybeSingle();

  if (!integ) {
    return json({ ok: true, push: { attempted: false, reason: "sin integración Last activa" } }, 200);
  }
  if (!integ.push_status_enabled) {
    return json({ ok: true, push: { attempted: false, reason: "empuje desactivado" } }, 200);
  }

  const token = Deno.env.get(integ.token_secret_name) ?? "";
  const tabId = sale.external_tab_ref;
  const locId = sale.external_location_text;
  if (!token || !tabId || !locId) {
    return json({ ok: false, error: "faltan token/tab/location" }, 200);
  }

  let result;
  if (CANCEL_STATES.includes(newStatus)) {
    result = await pushLast(`/orders/${tabId}/cancel`, "POST", token, locId, {
      errorMessage: "Cancelado desde Folvy",
      errorCode: "CANCELLED_BY_OPERATOR",
    });
  } else {
    const last = LAST_STATUS[newStatus] ?? null;
    if (!last) {
      return json({ ok: true, push: { attempted: false, reason: "estado no se propaga" } }, 200);
    }
    result = await pushLast(`/orders/${tabId}/status`, "PUT", token, locId, { newStatus: last });
  }

  return json({ ok: result.ok, push: { attempted: true, ...result } }, 200);
});

async function pushLast(
  path: string, method: "PUT" | "POST", token: string, locId: string, payload: unknown,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(`${LASTAPP_BASE}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "locationID": locId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, reason: `Last ${res.status}: ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
