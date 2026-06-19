// supabase/functions/order-advance/index.ts
//
// CAPA DE EMPUJE · avanza un pedido y lo propaga al canal cuando se puede.
// ============================================================================
// El front llama aquí al pulsar Empezar/Listo/Completar/Cancelar. Hace DOS cosas:
//   (1) ESTADO INTERNO: mueve sale.order_status vía set_order_status, con la
//       SESIÓN DEL USUARIO (la RPC tiene guard manager/admin -> valida permisos).
//   (2) EMPUJE AL CANAL: si la venta es de Last Y el empuje está activado, llama a
//       Last (PUT /orders/{tabId}/status o POST /orders/{tabId}/cancel) para que
//       Last avise a Glovo/Uber. Con service_role (lee el secret del token).
//
// AGNÓSTICA: para canales sin empuje saliente (hoy HubRise), cambia el estado
// interno y devuelve push.attempted=false. La pantalla es agnóstica del canal.
//
// ROBUSTEZ: si el empuje a Last falla, el estado interno YA avanzó (la cocina no
// se bloquea); se devuelve el error para que el front avise y se pueda reintentar.
//
// SEGURIDAD: verifica el JWT del usuario (no es webhook). El cambio de estado pasa
// por la RPC con la sesión del usuario; service_role solo para leer el secret y
// llamar a Last. DEPLOY NORMAL (CON verificación de JWT) — NO --no-verify-jwt.

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";

const LASTAPP_BASE = "https://api.last.app/v2";

// order_status (Folvy) -> newStatus (Last). null = no se propaga a Last.
const LAST_STATUS: Record<string, string | null> = {
  new: null,
  received: null,
  accepted: null,            // Last ya nació aceptado
  in_preparation: "KITCHEN",
  awaiting_collection: "READY_TO_PICKUP",
  awaiting_shipment: "READY_TO_PICKUP",
  in_delivery: "ON_DELIVERY",
  completed: "DELIVERED",
  rejected: null,            // -> cancel
  cancelled: null,           // -> cancel
  delivery_failed: null,
};

const CANCEL_STATES = ["cancelled", "rejected", "delivery_failed"];

interface PushResult { attempted: boolean; ok: boolean; reason?: string }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return json({ ok: false, error: "missing authorization" }, 401);
  }

  let body: { sale_id?: string; new_status?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const saleId = body.sale_id;
  const newStatus = body.new_status;
  if (!saleId || !newStatus) {
    return json({ ok: false, error: "sale_id y new_status requeridos" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";

  // (1) ESTADO INTERNO con la sesión del usuario: la RPC valida permisos.
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const { error: rpcErr } = await userClient.rpc("set_order_status", {
    p_sale_id: saleId,
    p_new_status: newStatus,
  });
  if (rpcErr) {
    return json({ ok: false, error: `estado interno: ${rpcErr.message}` }, 403);
  }

  // (2) EMPUJE AL CANAL con service_role.
  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  let push: PushResult = { attempted: false, ok: false };

  try {
    const { data: sale } = await sb.from("sale")
      .select("account_id, source, external_tab_ref, external_location_text")
      .eq("id", saleId).maybeSingle();

    if (!sale) {
      push = { attempted: false, ok: false, reason: "venta no encontrada" };
    } else if (sale.source !== "lastapp") {
      push = { attempted: false, ok: false, reason: "canal sin empuje saliente" };
    } else {
      // integración activa de la cuenta (token + toggle)
      const { data: integ } = await sb.from("lastapp_integration")
        .select("token_secret_name, push_status_enabled, is_active")
        .eq("account_id", sale.account_id).eq("is_active", true)
        .limit(1).maybeSingle();

      if (!integ) {
        push = { attempted: false, ok: false, reason: "sin integración Last activa" };
      } else if (!integ.push_status_enabled) {
        push = { attempted: false, ok: false, reason: "empuje desactivado" };
      } else {
        const token = Deno.env.get(integ.token_secret_name) ?? "";
        const tabId = sale.external_tab_ref;
        const locId = sale.external_location_text;
        if (!token || !tabId || !locId) {
          push = { attempted: false, ok: false, reason: "faltan token/tab/location" };
        } else if (CANCEL_STATES.includes(newStatus)) {
          // cancelación con motivo
          push = await pushLast(`/orders/${tabId}/cancel`, "POST", token, locId, {
            errorMessage: "Cancelado desde Folvy",
            errorCode: "CANCELLED_BY_OPERATOR",
          });
        } else {
          const last = LAST_STATUS[newStatus] ?? null;
          if (!last) {
            push = { attempted: false, ok: false, reason: "estado no se propaga" };
          } else {
            push = await pushLast(`/orders/${tabId}/status`, "PUT", token, locId, {
              newStatus: last,
            });
          }
        }
      }
    }
  } catch (e) {
    push = { attempted: true, ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  return json({ ok: true, internal_status: newStatus, push }, 200);
});

async function pushLast(
  path: string, method: "PUT" | "POST", token: string, locId: string, payload: unknown,
): Promise<PushResult> {
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
      return { attempted: true, ok: false, reason: `Last ${res.status}: ${txt.slice(0, 200)}` };
    }
    return { attempted: true, ok: true };
  } catch (e) {
    return { attempted: true, ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
