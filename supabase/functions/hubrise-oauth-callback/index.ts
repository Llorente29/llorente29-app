// supabase/functions/hubrise-oauth-callback/index.ts
//
// HubRise — callback del OAuth2 authorize. Bifurca por `kind` (ENCARGO CODE
// 2.1/2.2, 15/08/2026), leído del nonce (hubrise_oauth_state, emitido por
// hubrise-oauth-start):
//   kind='writer'   (Fase 1, de siempre): guarda el token EN VAULT vía
//     hubrise_writer_token_save (hubrise_writer_connection). Sin cambios de
//     comportamiento frente a antes de 2.1.
//   kind='location'  (2.1): escribe SOLO en external_integration (nunca
//     hubrise_writer_connection, bajo ninguna circunstancia). Reconecta por
//     (account_id, external_location_id, connection_name='Folvy') -- ver
//     comentario en LOCATION_CONNECTION_NAME sobre por qué el natural key
//     necesita connection_name.
// redirect_uri registrado en la app OAuth de HubRise. HubRise trae aquí el
// navegador con ?code=...&state=<nonce> (o ?error=...). Este Edge:
//   1) Consume el nonce (un solo uso, <15 min).
//   2) Intercambia code -> access_token en HubRise (Basic client_id:secret).
//   3) 2.2: valida que la cuenta HubRise que llega coincide (literal, sin
//      normalizar) con hubrise_writer_connection.hubrise_account_id de esta
//      cuenta Folvy -- aplica a AMBAS ramas. Si no hay fila aún (primera
//      conexión de la cuenta), la fija; si difiere, no guarda nada.
//   4) Guarda según kind.
// Es un redirect de navegador sin sesión Folvy -> no hay JWT que validar; la
// única puerta es el nonce (emitido por hubrise-oauth-start) + que el `code`
// solo es válido si viene realmente de HubRise tras un consentimiento real.
//
// Deploy: --no-verify-jwt (fijado con Julio; slug hubrise-oauth-callback debe
// coincidir EXACTO con el redirect_uri registrado en HubRise).

import { createClient } from "@supabase/supabase-js";
import { ensureHubriseCallback } from "../_shared/hubriseCallback.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// "Folvy Escritor" -- cuenta/catalogo (kind=writer). Sin cambios (2.7).
const HUBRISE_OAUTH_CLIENT_ID = Deno.env.get("HUBRISE_OAUTH_CLIENT_ID") ?? "";
const HUBRISE_OAUTH_CLIENT_SECRET = Deno.env.get("HUBRISE_OAUTH_CLIENT_SECRET") ?? "";
// "Folvy" -- location/pedidos (kind=location). App HubRise DISTINTA de la de
// arriba, no la misma rotada (folvy_mapa_sistema.md, "HubRise -- 2.7",
// 15/08/2026). Su client_secret YA vive en HUBRISE_WEBHOOK_SECRET --
// verificado por HMAC contra un evento real de hubrise-webhook -- no se
// duplica en una Secret nueva a proposito (dos valores iguales es un valor
// que puede desincronizarse). El client_id si es nuevo: HUBRISE_OAUTH_LOCATION_CLIENT_ID.
const HUBRISE_OAUTH_LOCATION_CLIENT_ID = Deno.env.get("HUBRISE_OAUTH_LOCATION_CLIENT_ID") ?? "";
const HUBRISE_OAUTH_LOCATION_CLIENT_SECRET = Deno.env.get("HUBRISE_WEBHOOK_SECRET") ?? "";
const HUBRISE_OAUTH_REDIRECT_URI = Deno.env.get("HUBRISE_OAUTH_REDIRECT_URI") ?? "";
const HUBRISE_TOKEN_URL = Deno.env.get("HUBRISE_TOKEN_URL") ??
  "https://manager.hubrise.com/oauth2/v1/token";
const HUBRISE_REVOKE_URL = Deno.env.get("HUBRISE_REVOKE_URL") ??
  "https://manager.hubrise.com/oauth2/v1/revoke";
const NONCE_MAX_AGE_MS = 15 * 60 * 1000;

// Credenciales por kind -- nunca fallback silencioso al cliente equivocado:
// firmar el intercambio con la app de catalogo para un grant de location
// produciria un token que hubrise-webhook rechazaria en frontera (401) sin
// motivo visible (esto es, literal, el bug de 2.7).
function oauthClientFor(kind: string): { clientId: string; clientSecret: string } | null {
  if (kind === "location") {
    if (!HUBRISE_OAUTH_LOCATION_CLIENT_ID || !HUBRISE_OAUTH_LOCATION_CLIENT_SECRET) return null;
    return { clientId: HUBRISE_OAUTH_LOCATION_CLIENT_ID, clientSecret: HUBRISE_OAUTH_LOCATION_CLIENT_SECRET };
  }
  if (!HUBRISE_OAUTH_CLIENT_ID || !HUBRISE_OAUTH_CLIENT_SECRET) return null;
  return { clientId: HUBRISE_OAUTH_CLIENT_ID, clientSecret: HUBRISE_OAUTH_CLIENT_SECRET };
}

// Nombre fijo de la conexión "propia de Folvy" (no una bridge de plataforma)
// en external_integration. RECON en vivo (15/08/2026) mostró que
// external_location_id NO es clave natural por sí solo: 1b6p8-0 tiene 4 filas
// hubrise (Uber Eats Bridge, Glovo Bridge, Just Eat Flyt Bridge -- las 3
// desactivadas -- y una fila "Folvy", activa+push_status_enabled, que es la
// que ux_ei_hubrise_usable ve como "usable" hoy). La clave real para
// reconectar/crear la conexión de 2.1 es (account_id, external_location_id,
// connection_name='Folvy') -- coincide con el nombre que ya usa a mano la
// fila viva de Foodint/1b6p8-0, así que reconectar esa cuenta encuentra y
// reutiliza esa misma fila en vez de duplicarla.
const LOCATION_CONNECTION_NAME = "Folvy";

// ASCII-ONLY a proposito (Encargo HubRise, punto 3, 15/08/2026): el gateway de
// Supabase Edge Functions REESCRIBE el Content-Type de la respuesta a
// "text/plain" + "X-Content-Type-Options: nosniff" SIN importar lo que
// devuelva el codigo de esta funcion -- probado con una funcion de control
// aislada que solo hacia return new Response(html, {headers:{"Content-Type":
// "text/html"}}) y llegaba igualmente como text/plain. No hay arreglo de
// codigo posible aqui: el navegador pinta el <h1>/<p> como texto plano, asi
// que cualquier tilde/enye/emoji sale como mojibake (UTF-8 mal interpretado).
// El arreglo real es la 3.ter (redirigir a una pagina real del frontend en
// vez de servir HTML desde el Edge) -- no hecho todavia. Mientras tanto, esto
// es el interino de coste real cero: texto sin acentos ni emoji, legible
// aunque se muestre como texto plano.
function html(body: string, status: number): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem">${body}</body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
const ok = (msg: string) => html(`<h1>HubRise conectado</h1><p>${msg}</p><p>Ya puedes cerrar esta ventana.</p>`, 200);
const fail = (msg: string) => html(`<h1>No se pudo conectar</h1><p>${msg}</p>`, 400);

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return fail("Method Not Allowed");

  const url = new URL(req.url);
  const err = url.searchParams.get("error");
  if (err) {
    return fail(`HubRise devolvio un error: ${err} - ${url.searchParams.get("error_description") ?? ""}`);
  }

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !state) return fail("Faltan code/state en la respuesta de HubRise.");

  // redirect_uri es el mismo para ambas apps (parametro de la llamada de
  // autorizacion, no configuracion de la app -- ver folvy_mapa_sistema.md,
  // "HubRise -- 2.7"). Las credenciales del cliente SI dependen de kind, y
  // kind no se conoce hasta leer el nonce -- se comprueban mas abajo.
  if (!HUBRISE_OAUTH_REDIRECT_URI) {
    return fail("Falta el Secret HUBRISE_OAUTH_REDIRECT_URI.");
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // 1) Consumir el nonce (un solo uso).
  const { data: pending, error: readErr } = await sb
    .from("hubrise_oauth_state")
    .select("account_id, created_at, kind, location_id")
    .eq("nonce", state)
    .maybeSingle();
  if (readErr) {
    console.error("hubrise-oauth-callback: error leyendo nonce", readErr);
    return fail("Error interno validando el enlace.");
  }
  if (!pending) return fail("Enlace invalido o ya usado. Vuelve a abrir hubrise-oauth-start.");

  await sb.from("hubrise_oauth_state").delete().eq("nonce", state);

  const age = Date.now() - new Date(pending.created_at as string).getTime();
  if (age > NONCE_MAX_AGE_MS) return fail("El enlace caduco (mas de 15 minutos). Vuelve a abrir hubrise-oauth-start.");

  const accountId = pending.account_id as string;
  const kind = (pending.kind as string | null) ?? "writer";
  const nonceLocationId = (pending.location_id as string | null) ?? null;

  const oauthClient = oauthClientFor(kind);
  if (!oauthClient) {
    const missing = kind === "location"
      ? "HUBRISE_OAUTH_LOCATION_CLIENT_ID / HUBRISE_WEBHOOK_SECRET"
      : "HUBRISE_OAUTH_CLIENT_ID / HUBRISE_OAUTH_CLIENT_SECRET";
    console.error(`hubrise-oauth-callback: faltan credenciales OAuth para kind=${kind} (${missing})`);
    return fail(
      `Faltan Secrets del cliente OAuth de ${kind === "location" ? "pedidos (Folvy)" : "catalogo (Folvy Escritor)"}: ${missing}.`,
    );
  }

  // 2) Intercambiar code -> access_token.
  const basic = btoa(`${oauthClient.clientId}:${oauthClient.clientSecret}`);
  let tokenResp: Response;
  try {
    tokenResp = await fetch(HUBRISE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: HUBRISE_OAUTH_REDIRECT_URI,
      }),
    });
  } catch (e) {
    console.error("hubrise-oauth-callback: fetch token endpoint fallo", e);
    return fail("No se pudo contactar con HubRise para intercambiar el code.");
  }

  if (!tokenResp.ok) {
    const body = await tokenResp.text().catch(() => "");
    console.error(`hubrise-oauth-callback: token endpoint HTTP ${tokenResp.status}: ${body.slice(0, 300)}`);
    return fail(`HubRise rechazo el intercambio (HTTP ${tokenResp.status}).`);
  }

  const tokenJson = await tokenResp.json().catch(() => null) as Record<string, unknown> | null;
  const accessToken = tokenJson?.access_token as string | undefined;
  if (!accessToken) {
    console.error("hubrise-oauth-callback: respuesta de HubRise sin access_token", Object.keys(tokenJson ?? {}));
    return fail("HubRise no devolvio access_token.");
  }
  const hubriseAccountId = (tokenJson?.account_id as string | undefined) ?? null;
  const accountName = (tokenJson?.account_name as string | undefined) ?? null;

  // 3) 2.2 -- validacion de cuenta HubRise, ANTES de escribir nada, aplica a
  // ambas ramas. Comparacion literal (sin normalizar) contra
  // hubrise_writer_connection.hubrise_account_id de esta cuenta Folvy.
  const { data: writerRow, error: writerReadErr } = await sb
    .from("hubrise_writer_connection")
    .select("hubrise_account_id")
    .eq("account_id", accountId)
    .maybeSingle();
  if (writerReadErr) {
    console.error("hubrise-oauth-callback: error leyendo hubrise_writer_connection", writerReadErr);
    return fail("Error interno validando la cuenta HubRise.");
  }
  const expectedHubriseAccountId = (writerRow?.hubrise_account_id as string | null | undefined) ?? null;

  if (kind === "location") {
    // La rama location NUNCA toca hubrise_writer_connection (ni para leer-y-
    // fijar el primer valor): exige que la cuenta escritora (kind=writer) ya
    // este conectada. Esto es una resolucion mia a un conflicto real que
    // encontre en el encargo -- lo declaro en vez de decidirlo en silencio:
    // el punto 4 dice "la primera conexion fija el valor esperado" para 2.2,
    // pero tambien dice, con lenguaje mas fuerte y mas especifico, que
    // kind=location no debe tocar hubrise_writer_connection "bajo ninguna
    // circunstancia". Ante el conflicto, gana la regla mas fuerte: location
    // solo VALIDA contra un valor ya establecido por writer, nunca lo fija.
    if (!expectedHubriseAccountId) {
      return fail(
        "Esta cuenta Folvy todavia no tiene una conexion HubRise de cuenta (kind=writer). " +
          "Conecta primero la cuenta escritora antes de conectar un local.",
      );
    }
    if (expectedHubriseAccountId !== hubriseAccountId) {
      return fail(
        `Cuenta HubRise distinta de la esperada: se esperaba "${expectedHubriseAccountId}", ` +
          `ha llegado "${hubriseAccountId ?? "(vacio)"}". No se ha guardado nada.`,
      );
    }
  } else {
    // kind=writer: si ya hay una cuenta HubRise fijada para esta cuenta
    // Folvy y no coincide, no se guarda nada (protege contra reconectar por
    // error la cuenta HubRise equivocada). Si es la primera conexion (sin
    // fila, o hubrise_account_id aun null), hubrise_writer_token_save la fija.
    if (expectedHubriseAccountId && expectedHubriseAccountId !== hubriseAccountId) {
      return fail(
        `Cuenta HubRise distinta de la esperada: se esperaba "${expectedHubriseAccountId}", ` +
          `ha llegado "${hubriseAccountId ?? "(vacio)"}". No se ha guardado nada.`,
      );
    }
  }

  // 4) Guardar segun kind.
  if (kind === "writer") {
    // Rama de siempre, sin cambios de comportamiento.
    const { error: saveErr } = await sb.rpc("hubrise_writer_token_save", {
      p_account_id: accountId,
      p_access_token: accessToken,
      p_hubrise_account_id: hubriseAccountId,
    });
    if (saveErr) {
      console.error("hubrise-oauth-callback: error guardando en Vault", saveErr.message ?? saveErr);
      return fail(`No se pudo guardar el token: ${saveErr.message ?? "error desconocido"}`);
    }
    return ok(`Cuenta Folvy ${accountId}${hubriseAccountId ? ` - cuenta HubRise ${hubriseAccountId}` : ""}.`);
  }

  // kind === "location"
  const externalLocationId = tokenJson?.location_id as string | undefined;
  const locationName = (tokenJson?.location_name as string | undefined) ?? null;
  if (!externalLocationId) {
    console.error("hubrise-oauth-callback: grant location sin location_id en la respuesta", Object.keys(tokenJson ?? {}));
    return fail("HubRise no devolvio location_id para un grant de location. No se ha guardado nada.");
  }
  if (!nonceLocationId) {
    // No deberia pasar: el CHECK de hubrise_oauth_state exige location_id no
    // nulo para kind=location. Defensivo, no fallo silencioso.
    console.error("hubrise-oauth-callback: nonce kind=location sin location_id (inconsistencia de datos)");
    return fail("Enlace inconsistente (sin local asociado). Vuelve a abrir hubrise-oauth-start.");
  }

  // external_location_map es la fuente real de "que local de Folvy es esta
  // location de HubRise" -- trg_ei_fill_location_id (20260815T1930) resuelve
  // external_integration.location_id DESDE AQUI en un BEFORE INSERT/UPDATE
  // con `select ... into new.location_id ... limit 1`: si no hay fila en el
  // mapa, el SELECT INTO deja new.location_id en NULL SIEMPRE, aunque se
  // pase location_id explicito en el INSERT -- el trigger lo pisa. Por eso
  // los casos limite A/B se comprueban aqui (contra el mapa, que si tiene el
  // dato) y no contra external_integration (que hasta ahora podia salir NULL
  // sin que nadie lo notara -- hallazgo de Julio via revision del codigo
  // desplegado, 15/08/2026). El UPSERT del mapa va ANTES del INSERT/UPDATE de
  // external_integration para que el trigger encuentre la fila.
  //
  // Indice real verificado (RECON, no asumido): UNIQUE(source,
  // external_location_id) -- SIN account_id (external_location_id de HubRise
  // ya es unico por diseño, no hace falta account_id en la clave). El ON
  // CONFLICT del upsert va contra esa pareja.
  //
  // Unico escritor existente de external_location_map hoy es
  // lastappIntegrationService.linkLocation() (source='lastapp', INSERT
  // simple desde el panel admin) -- para source='hubrise' nunca ha escrito
  // nadie por codigo, siempre a mano. Esto es el primer escritor automatico.

  // Caso limite A: la location de HubRise elegida ya esta ligada a OTRO
  // local de Folvy en el mapa -> rechazar, no reasignar en silencio. Filtro
  // is_active=true a proposito (fallo de especificacion original, corregido
  // 15/08 en el diseno de 2.5): sin el, una fila de mapa DESCONECTADA (2.5
  // la apaga, nunca la borra) bloquearia para siempre reconectar esa misma
  // location de HubRise a cualquier local -- con el filtro, el UPSERT de
  // abajo reactiva y sobrescribe la fila apagada sin problema.
  const { data: mapByExternalLoc, error: mapByExternalLocErr } = await sb
    .from("external_location_map")
    .select("location_id")
    .eq("source", "hubrise")
    .eq("external_location_id", externalLocationId)
    .eq("is_active", true)
    .maybeSingle();
  if (mapByExternalLocErr) {
    console.error("hubrise-oauth-callback: error comprobando mapa por location HubRise", mapByExternalLocErr);
    return fail("Error interno comprobando el mapa de locations.");
  }
  if (mapByExternalLoc?.location_id && mapByExternalLoc.location_id !== nonceLocationId) {
    return fail(
      `Esta location de HubRise (${externalLocationId}) ya esta conectada a otro local de Folvy ` +
        `en el mapa. Desconectala primero si quieres moverla. No se ha guardado nada.`,
    );
  }

  // Caso limite B (inverso): este local de Folvy ya esta mapeado a OTRA
  // location de HubRise activa -> rechazar, no reemplazar en silencio.
  const { data: mapByFolvyLoc, error: mapByFolvyLocErr } = await sb
    .from("external_location_map")
    .select("external_location_id, external_location_name")
    .eq("source", "hubrise")
    .eq("account_id", accountId)
    .eq("location_id", nonceLocationId)
    .eq("is_active", true)
    .neq("external_location_id", externalLocationId)
    .limit(1)
    .maybeSingle();
  if (mapByFolvyLocErr) {
    console.error("hubrise-oauth-callback: error comprobando mapa por local Folvy", mapByFolvyLocErr);
    return fail("Error interno comprobando el mapa de locations.");
  }
  if (mapByFolvyLoc) {
    return fail(
      `Este local de Folvy ya esta mapeado a otra location de HubRise ` +
        `(${mapByFolvyLoc.external_location_id}${mapByFolvyLoc.external_location_name ? ` - ${mapByFolvyLoc.external_location_name}` : ""}). ` +
        `Desconectala primero si quieres cambiarla. No se ha guardado nada.`,
    );
  }

  // UPSERT del mapa -- ANTES de tocar external_integration (ver comentario
  // arriba). ON CONFLICT contra el indice real (source, external_location_id).
  const { error: mapUpsertErr } = await sb
    .from("external_location_map")
    .upsert(
      {
        account_id: accountId,
        source: "hubrise",
        external_location_id: externalLocationId,
        external_location_name: locationName,
        location_id: nonceLocationId,
        is_active: true,
        needs_review: false,
      },
      { onConflict: "source,external_location_id" },
    );
  if (mapUpsertErr) {
    console.error("hubrise-oauth-callback: error en upsert de external_location_map", mapUpsertErr.message ?? mapUpsertErr);
    return fail(`No se pudo guardar el mapa de locations: ${mapUpsertErr.message ?? "error desconocido"}`);
  }

  // Reconexion en external_integration: SELECT explicito por (account_id,
  // external_location_id, connection_name), SIN filtrar por
  // is_active/push_status_enabled -- ver comentario de
  // LOCATION_CONNECTION_NAME. Nunca INSERT a ciegas, nunca ON CONFLICT contra
  // ux_ei_hubrise_usable (indice parcial: una fila desactivada no dispara el
  // conflicto, y un INSERT ciego duplicaria).
  const { data: existingRows, error: existingErr } = await sb
    .from("external_integration")
    .select("id, access_token, revoke_pending")
    .eq("account_id", accountId)
    .eq("source", "hubrise")
    .eq("external_location_id", externalLocationId)
    .eq("connection_name", LOCATION_CONNECTION_NAME)
    .order("id", { ascending: true });
  if (existingErr) {
    console.error("hubrise-oauth-callback: error buscando conexion existente", existingErr);
    return fail("Error interno buscando la conexion existente.");
  }
  if ((existingRows?.length ?? 0) > 1) {
    console.warn(
      `hubrise-oauth-callback: ${existingRows!.length} filas para account=${accountId} ` +
        `external_location_id=${externalLocationId} connection_name=${LOCATION_CONNECTION_NAME} ` +
        `(se esperaba <=1). Usando la de menor id.`,
    );
  }
  const existing = existingRows && existingRows.length > 0 ? existingRows[0] : null;

  const writeFields = {
    access_token: accessToken,
    external_account_name: accountName,
    external_location_name: locationName,
    is_active: true,
    push_status_enabled: true,
    token_status: "ok",
    token_checked_at: new Date().toISOString(),
    revoke_pending: false,
  };

  if (existing) {
    if (existing.revoke_pending && existing.access_token) {
      // Consecuencia de 2.5 (revoke_pending): si una desconexion anterior no
      // pudo revocar el token viejo, sigue guardado para poder reintentar.
      // Reconectar va a SOBRESCRIBIR access_token con el nuevo -- sin este
      // intento, el token viejo quedaria huerfano (valido en HubRise) y sin
      // forma de volver a intentarlo. Best-effort, no bloquea la reconexion.
      try {
        const basicOld = btoa(`${oauthClient.clientId}:${oauthClient.clientSecret}`);
        const revOldResp = await fetch(HUBRISE_REVOKE_URL, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${basicOld}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ token: existing.access_token }),
        });
        if (!revOldResp.ok) {
          console.warn(`hubrise-oauth-callback: no se pudo revocar el token viejo huerfano (HTTP ${revOldResp.status}) al reconectar`);
        }
      } catch (e) {
        console.warn("hubrise-oauth-callback: error revocando token viejo huerfano al reconectar", e);
      }
    }

    const { error: updErr } = await sb
      .from("external_integration")
      .update(writeFields)
      .eq("id", existing.id);
    if (updErr) {
      console.error("hubrise-oauth-callback: error reactivando conexion", updErr.message ?? updErr);
      return fail(`No se pudo guardar el token: ${updErr.message ?? "error desconocido"}`);
    }
  } else {
    const { error: insErr } = await sb
      .from("external_integration")
      .insert({
        account_id: accountId,
        source: "hubrise",
        connection_name: LOCATION_CONNECTION_NAME,
        external_location_id: externalLocationId,
        ...writeFields,
      });
    if (insErr) {
      console.error("hubrise-oauth-callback: error creando conexion", insErr.message ?? insErr);
      if (insErr.code === "23505") {
        return fail(
          "Ya existe otra conexion HubRise activa y utilizable para este local (indice unico). " +
            "Revisa las conexiones existentes antes de reintentar. No se ha guardado nada.",
        );
      }
      return fail(`No se pudo guardar el token: ${insErr.message ?? "error desconocido"}`);
    }
  }

  // 2.6 -- asegurar el callback de pedidos AHORA, sincrono, como parte del
  // propio flujo de conexion (no por cron: ver cabecera de
  // _shared/hubriseCallback.ts). Que conectar deje el local operativo, no
  // "conectado pero mudo" -- hallazgo real (Carabanchel-lab, 15/08/2026)
  // que motivo este punto: sin esto, una location recien conectada no
  // recibia ni un pedido hasta que alguien invocara callback-ensure a mano.
  const callbackResult = await ensureHubriseCallback(accessToken);
  let callbackWarning = "";
  if (callbackResult.outcome === "error" || callbackResult.outcome === "token_401") {
    console.error(
      `hubrise-oauth-callback: no se pudo asegurar el callback de pedidos ` +
        `(outcome=${callbackResult.outcome}, status=${callbackResult.status ?? "?"})`,
    );
    callbackWarning = " ADVERTENCIA: no se pudo registrar el callback de pedidos -- " +
      "el local esta conectado pero puede NO recibir pedidos. Vuelve a intentarlo.";
  }

  return ok(
    `Local Folvy conectado a HubRise. Cuenta ${hubriseAccountId}` +
      `${accountName ? ` (${accountName})` : ""}, location ${externalLocationId}` +
      `${locationName ? ` (${locationName})` : ""}.${callbackWarning}`,
  );
});
