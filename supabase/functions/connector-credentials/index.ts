// supabase/functions/connector-credentials/index.ts
// D2.2b — Gestión de credenciales de conectores (cifradas en Supabase Vault).
//
// Capa HTTP fina sobre las funciones wrapper public.connector_secret_* (D2.2a).
// Tres acciones (campo `action` del body): save | status | clear.
//
// SEGURIDAD (clave de esta función):
//   - Valida el JWT del USUARIO que llama (header Authorization: Bearer <token>)
//     con un cliente "as user" → obtiene su user_id REAL vía auth.getUser().
//     NO se fía de un user_id que venga en el body (sería falsificable).
//   - Con el user_id validado, usa el cliente SERVICE_ROLE para llamar a los
//     wrappers, que a su vez validan que ese user_id es admin/manager de la cuenta
//     (gating server-side, doble: aquí + dentro del wrapper).
//   - El secreto (token de la plataforma) viaja en el body por HTTPS, se pasa al
//     wrapper (que lo cifra en Vault) y NUNCA se loguea ni se devuelve al front.
//   - No se registra el body en ninguna tabla de log (contendría el secreto).
//
// El front (anon key) llama a esta función; jamás toca Vault ni los wrappers
// directamente (los wrappers están revocados para anon/authenticated).

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";

interface SaveBody {
  action: "save";
  accountConnectorId: string;
  secrets: Record<string, unknown>;   // campos type:'secret' del config_schema
  config?: Record<string, unknown>;   // campos NO sensibles (store_ids, auto_accept…)
}
interface StatusBody {
  action: "status";
  accountConnectorId: string;
}
interface ClearBody {
  action: "clear";
  accountConnectorId: string;
}
type Body = SaveBody | StatusBody | ClearBody;

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method not allowed" });
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // 1. Validar el JWT del usuario → user_id REAL (no se acepta del body).
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return json(401, { ok: false, error: "missing authorization" });
  }
  const sbUser = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userData?.user) {
    return json(401, { ok: false, error: "invalid session" });
  }
  const userId = userData.user.id;

  // 2. Parsear el body.
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { ok: false, error: "invalid json body" });
  }
  if (!body?.action || !body?.accountConnectorId) {
    return json(400, { ok: false, error: "missing action or accountConnectorId" });
  }

  // 3. Cliente service_role para llamar a los wrappers (acceso a Vault).
  const sb = createClient(url, serviceKey);

  try {
    if (body.action === "save") {
      const secretJson = JSON.stringify(body.secrets ?? {});
      const { error } = await sb.rpc("connector_secret_save", {
        p_account_connector_id: body.accountConnectorId,
        p_user_id: userId,
        p_secret_json: secretJson,
        p_config: body.config ?? null,
      });
      if (error) throw new Error(error.message);
      return json(200, { ok: true, status: "connected" });
    }

    if (body.action === "status") {
      const { data, error } = await sb.rpc("connector_secret_status", {
        p_account_connector_id: body.accountConnectorId,
        p_user_id: userId,
      });
      if (error) throw new Error(error.message);
      return json(200, { ok: true, hasCredentials: data === true });
    }

    if (body.action === "clear") {
      const { error } = await sb.rpc("connector_secret_clear", {
        p_account_connector_id: body.accountConnectorId,
        p_user_id: userId,
      });
      if (error) throw new Error(error.message);
      return json(200, { ok: true, status: "paused" });
    }

    return json(400, { ok: false, error: "unknown action" });
  } catch (e) {
    // El mensaje del wrapper (p.ej. "Sin permiso…") se propaga, sin exponer secretos.
    const msg = e instanceof Error ? e.message : String(e);
    // 403 si fue un fallo de permiso; 400 en el resto.
    const status = msg.toLowerCase().includes("permiso") ? 403 : 400;
    return json(status, { ok: false, error: msg });
  }
});
