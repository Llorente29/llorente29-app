// supabase/functions/hubrise-location-disconnect/index.ts
//
// 2.5 — DESCONECTAR una location de HubRise (ENCARGO CODE, 15/08/2026).
// ============================================================================
// Exigido por la guía de integración de HubRise: "una forma igual de fácil
// de desconectar" que de conectar. Invocado por el USUARIO (admin) desde la
// pantalla de ajustes de Fase 3 -- admin-only, igual que hubrise_location_status
// (ver su COMMENT ON FUNCTION).
//
// ORDEN OBLIGATORIO (Julio, 15/08 -- el orden importa):
//   1) DELETE callback en HubRise -- con el token TODAVÍA vivo (un token
//      revocado ya no puede borrarlo). Verificado en vivo contra el lab:
//      DELETE https://api.hubrise.com/v1/callback (sin id, recurso
//      singleton), X-Access-Token, sin cuerpo -> 200, GET posterior confirma
//      {url:null,events:{}}. Best-effort: si falla, se loguea pero NO
//      bloquea el resto (no es tan crítico como el token en sí).
//   2) Revocar el token: POST https://manager.hubrise.com/oauth2/v1/revoke,
//      Basic client_id:client_secret, token en el cuerpo, 200 = revocado.
//   3) Apagar flags LOCALES -- nunca borrar filas (external_location_map lo
//      necesita el trigger de external_integration para resolver location_id
//      al reconectar; brand_hubrise_catalog NUNCA se toca, sobrevive intacto
//      para que reconectar no obligue a reconfigurar catálogos).
//
// Si la revocación (paso 2) falla (red, 4xx): NO se miente con un
// "desconectado" que no lo es del todo. Se desconecta LOCALMENTE igual
// (dejan de operar is_active/push_status_enabled), pero access_token se
// CONSERVA (para poder reintentar) y revoke_pending=true. Se escala una
// alarma vía system-alert (mismo patrón que hubrise-callback-ensure con
// tokens 401) -- nunca falla en silencio.
//
// REINTENTO: simplemente volver a invocar este mismo Edge con la misma
// (account_id, location_id). La búsqueda de la fila es por location_id, sin
// filtrar is_active -- encuentra la conexión tanto si está activa (desconexión
// normal) como si ya está apagada con revoke_pending=true (reintento): repite
// el DELETE de callback (idempotente, no-op si ya no hay nada) y reintenta
// la revocación; el resto de los flags ya está apagado, no cambia nada.
//
// AUTH: JWT del usuario (functions.invoke). Autoriza con RPC
// current_user_is_admin_of(account_id) usando la sesión del propio usuario
// (mismo patrón de autorización que hubrise-brand-connect vía RLS, aquí
// explícito porque no hay una tabla con RLS de por medio que lo haga solo).
// Deploy SIN --no-verify-jwt.

import { corsHeaders } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HUBRISE_API_BASE = Deno.env.get("HUBRISE_API_BASE") ?? "https://api.hubrise.com/v1";
const HUBRISE_REVOKE_URL = Deno.env.get("HUBRISE_REVOKE_URL") ??
  "https://manager.hubrise.com/oauth2/v1/revoke";
// Esta funcion SOLO maneja conexiones connection_name='Folvy' (location) --
// nunca escritoras -- asi que el cliente OAuth es siempre el de pedidos
// ("Folvy"), no el de catalogo ("Folvy Escritor"). Corregido junto con 2.7
// (folvy_mapa_sistema.md, "HubRise -- 2.7", 15/08/2026): antes revocaba con
// las credenciales equivocadas para cualquier token emitido por el flujo
// location ya corregido -- HubRise rechaza un revoke firmado por una app
// distinta de la que emitio el token. El client_secret ya vive en
// HUBRISE_WEBHOOK_SECRET (verificado por HMAC), no se duplica en una Secret
// nueva.
const HUBRISE_OAUTH_LOCATION_CLIENT_ID = Deno.env.get("HUBRISE_OAUTH_LOCATION_CLIENT_ID") ?? "";
const HUBRISE_OAUTH_LOCATION_CLIENT_SECRET = Deno.env.get("HUBRISE_WEBHOOK_SECRET") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const CONNECTION_NAME = "Folvy";

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function raiseAlert(subject: string, message: string): Promise<void> {
  if (!CRON_SECRET) {
    console.error("hubrise-location-disconnect: CRON_SECRET ausente -> no se pudo escalar alarma:", subject);
    return;
  }
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/system-alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({ subject, message, kind: "hubrise-revoke-pending" }),
    });
  } catch (e) {
    console.error("hubrise-location-disconnect: fallo al escalar alarma", e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const sbUser = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await sbUser.auth.getUser();
  if (!userData?.user) return json({ ok: false, error: "no autenticado" }, 401);

  let body: { account_id?: string; location_id?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const accountId = body.account_id;
  const locationId = body.location_id;
  if (!accountId || !locationId) {
    return json({ ok: false, error: "account_id y location_id son obligatorios" }, 400);
  }

  // Autorizacion: admin de esta cuenta (o platform admin), verificado con la
  // sesion del propio usuario -- pantalla admin-only de Fase 3.
  const { data: isAdmin, error: authErr } = await sbUser.rpc("current_user_is_admin_of", {
    p_account_id: accountId,
  });
  if (authErr) {
    console.error("hubrise-location-disconnect: error verificando autorizacion", authErr);
    return json({ ok: false, error: "Error interno verificando autorizacion." }, 500);
  }
  if (!isAdmin) return json({ ok: false, error: "No autorizado." }, 403);

  const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

  // Buscar por location_id SIN filtrar is_active -- soporta desconexion
  // normal (activa) y reintento (ya apagada, revoke_pending=true).
  const { data: integ, error: integErr } = await sb
    .from("external_integration")
    .select("id, access_token, is_active, external_location_id, revoke_pending")
    .eq("account_id", accountId)
    .eq("source", "hubrise")
    .eq("connection_name", CONNECTION_NAME)
    .eq("location_id", locationId)
    .maybeSingle();
  if (integErr) {
    console.error("hubrise-location-disconnect: error buscando la conexion", integErr);
    return json({ ok: false, error: "Error interno buscando la conexion." }, 500);
  }
  if (!integ) {
    return json({ ok: false, error: "No hay conexion HubRise para este local." }, 200);
  }

  if (!integ.access_token) {
    // El CHECK garantiza: sin token solo es posible si is_active=false.
    // Ya desconectada del todo (revoke_pending tambien deberia ser false;
    // si no lo fuera seria un estado imposible, no hay nada que reintentar
    // sin token). Idempotente: no es un error, solo confirma el estado.
    return json({ ok: true, disconnected: true, already: true }, 200);
  }

  // 1) DELETE callback -- best effort, con el token todavia vivo.
  try {
    const delResp = await fetch(`${HUBRISE_API_BASE}/callback`, {
      method: "DELETE",
      headers: { "X-Access-Token": integ.access_token },
    });
    if (!delResp.ok) {
      console.warn(`hubrise-location-disconnect: DELETE callback HTTP ${delResp.status} (no bloqueante)`);
    }
  } catch (e) {
    console.warn("hubrise-location-disconnect: error borrando callback (no bloqueante)", e);
  }

  // 2) Revocar el token.
  let revoked = false;
  let revokeErrorMsg: string | null = null;
  if (!HUBRISE_OAUTH_LOCATION_CLIENT_ID || !HUBRISE_OAUTH_LOCATION_CLIENT_SECRET) {
    revokeErrorMsg = "faltan Secrets HUBRISE_OAUTH_LOCATION_CLIENT_ID / HUBRISE_WEBHOOK_SECRET";
  } else {
    try {
      const basic = btoa(`${HUBRISE_OAUTH_LOCATION_CLIENT_ID}:${HUBRISE_OAUTH_LOCATION_CLIENT_SECRET}`);
      const revResp = await fetch(HUBRISE_REVOKE_URL, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token: integ.access_token }),
      });
      if (revResp.ok) {
        revoked = true;
      } else {
        const t = await revResp.text().catch(() => "");
        revokeErrorMsg = `HTTP ${revResp.status}${t ? `: ${t.slice(0, 200)}` : ""}`;
      }
    } catch (e) {
      revokeErrorMsg = e instanceof Error ? e.message : String(e);
    }
  }

  // 3) Apagar flags LOCALES. Si se revoco: borrar tambien el token (secreto
  // muerto, no dejarlo en texto plano sin motivo). Si no: conservarlo para
  // poder reintentar, y marcar revoke_pending.
  //
  // callback_status='missing' SIEMPRE aqui, dirigido por el evento de
  // desconexion (Fase 3, A.1) -- el paso 1 ya intento borrar el callback en
  // HubRise (best-effort); se declara la intencion, no se re-verifica con
  // otro GET (eso seria volver a sondear -- ver regla permanente en
  // folvy_mapa_sistema.md).
  const nowIso = new Date().toISOString();
  const updateFields = revoked
    ? {
      is_active: false,
      push_status_enabled: false,
      access_token: null,
      token_status: "invalid",
      revoke_pending: false,
      callback_status: "missing",
      callback_checked_at: nowIso,
    }
    : {
      is_active: false,
      push_status_enabled: false,
      revoke_pending: true,
      callback_status: "missing",
      callback_checked_at: nowIso,
    };

  const { error: updErr } = await sb
    .from("external_integration")
    .update(updateFields)
    .eq("id", integ.id);
  if (updErr) {
    console.error("hubrise-location-disconnect: error apagando la conexion", updErr.message ?? updErr);
    return json({ ok: false, error: `No se pudo desconectar: ${updErr.message ?? "error desconocido"}` }, 500);
  }

  // external_location_map: apagar, NUNCA borrar (ver cabecera).
  const { error: mapErr } = await sb
    .from("external_location_map")
    .update({ is_active: false })
    .eq("account_id", accountId)
    .eq("source", "hubrise")
    .eq("external_location_id", integ.external_location_id);
  if (mapErr) {
    console.error("hubrise-location-disconnect: error apagando el mapa (conexion ya apagada)", mapErr.message ?? mapErr);
  }

  if (!revoked) {
    await raiseAlert(
      "Revocacion de token HubRise pendiente",
      `La conexion HubRise de la cuenta ${accountId} / local ${locationId} ` +
        `(external_location_id=${integ.external_location_id}) se desconecto localmente, ` +
        `pero la revocacion del token en HubRise fallo: ${revokeErrorMsg}.\n\n` +
        `El token SIGUE guardado (revoke_pending=true) para poder reintentar -- ` +
        `vuelve a invocar hubrise-location-disconnect con la misma cuenta/local.`,
    );
    return json({
      ok: true,
      disconnected: true,
      revoked: false,
      warning: `Desconectado localmente. La revocacion del token en HubRise fallo (${revokeErrorMsg}) -- ` +
        `queda registrada para reintentar (revoke_pending=true).`,
    }, 200);
  }

  return json({ ok: true, disconnected: true, revoked: true }, 200);
});
