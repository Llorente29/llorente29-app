// supabase/functions/hubrise-oauth-callback/index.ts
//
// HubRise "Folvy escritor" (Fase 1) — callback del OAuth2 authorize.
// ============================================================================
// redirect_uri registrado en la app OAuth de HubRise. HubRise trae aquí el
// navegador de Julio con ?code=...&state=<nonce> (o ?error=...). Este Edge:
//   1) Consume el nonce (public.hubrise_oauth_state, un solo uso, <15 min).
//   2) Intercambia code -> access_token en HubRise (Basic client_id:secret).
//   3) Guarda el token EN VAULT vía hubrise_writer_token_save (nunca en claro,
//      nunca logueado).
// Es un redirect de navegador sin sesión Folvy -> no hay JWT que validar; la
// única puerta es el nonce (emitido por hubrise-oauth-start) + que el `code`
// solo es válido si viene realmente de HubRise tras un consentimiento real.
//
// Deploy: --no-verify-jwt (fijado con Julio; slug hubrise-oauth-callback debe
// coincidir EXACTO con el redirect_uri registrado en HubRise).
//
// MODO INSPECCIÓN TEMPORAL (ENCARGO CODE 2.1, punto B, 15/08/2026): si la
// respuesta del intercambio trae `location_id` (grant de scope de LOCATION,
// nunca visto hasta ahora — solo hemos pedido scope de cuenta), NO se guarda
// nada en ningún sitio: se muestra el JSON completo (token enmascarado) en la
// propia página, para diseñar 2.1 sobre datos reales de HubRise en vez de
// sobre la doc. Si NO trae `location_id` (el flujo de escritor de cuenta de
// siempre), el comportamiento es EXACTAMENTE el de hoy, sin cambios — esta
// rama nunca se ha activado en producción porque nunca hemos pedido ese scope.
// Retirar este bloque en cuanto 2.1 tenga su propio manejo real de 'location'.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HUBRISE_OAUTH_CLIENT_ID = Deno.env.get("HUBRISE_OAUTH_CLIENT_ID") ?? "";
const HUBRISE_OAUTH_CLIENT_SECRET = Deno.env.get("HUBRISE_OAUTH_CLIENT_SECRET") ?? "";
const HUBRISE_OAUTH_REDIRECT_URI = Deno.env.get("HUBRISE_OAUTH_REDIRECT_URI") ?? "";
const HUBRISE_TOKEN_URL = Deno.env.get("HUBRISE_TOKEN_URL") ??
  "https://manager.hubrise.com/oauth2/v1/token";
const NONCE_MAX_AGE_MS = 15 * 60 * 1000;

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
const inspect = (json: Record<string, unknown>) => html(
  `<h1>Modo inspeccion (temporal) - nada guardado</h1>` +
  `<p>Respuesta completa del intercambio (token enmascarado):</p>` +
  `<pre style="background:#f5f4f0;padding:1rem;border-radius:8px;white-space:pre-wrap">${
    JSON.stringify(json, null, 2).replace(/</g, "&lt;")
  }</pre>`,
  200,
);

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

  if (!HUBRISE_OAUTH_CLIENT_ID || !HUBRISE_OAUTH_CLIENT_SECRET || !HUBRISE_OAUTH_REDIRECT_URI) {
    return fail("Faltan Secrets HUBRISE_OAUTH_CLIENT_ID / HUBRISE_OAUTH_CLIENT_SECRET / HUBRISE_OAUTH_REDIRECT_URI.");
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // 1) Consumir el nonce (un solo uso).
  const { data: pending, error: readErr } = await sb
    .from("hubrise_oauth_state")
    .select("account_id, created_at")
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

  // 2) Intercambiar code -> access_token.
  const basic = btoa(`${HUBRISE_OAUTH_CLIENT_ID}:${HUBRISE_OAUTH_CLIENT_SECRET}`);
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
    console.error("hubrise-oauth-callback: fetch token endpoint falló", e);
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

  // MODO INSPECCIÓN (temporal, ver comentario de cabecera): grant de location,
  // nunca visto -> loguear y mostrar, NO guardar nada en ningún sitio.
  if (tokenJson && "location_id" in tokenJson) {
    const masked = { ...tokenJson, access_token: accessToken ? `${accessToken.slice(0, 4)}…(${accessToken.length} chars)` : null };
    console.log("hubrise-oauth-callback INSPECT (location grant, no guardado):", JSON.stringify(masked));
    return inspect(masked);
  }

  // 3) Guardar en Vault (nunca loguear el token). Rama de siempre, sin cambios.
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
});
