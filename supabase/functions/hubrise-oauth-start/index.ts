// supabase/functions/hubrise-oauth-start/index.ts
//
// HubRise "Folvy escritor" (Fase 1) — arranque del OAuth2 authorize.
// ============================================================================
// Julio abre esta URL en el navegador con ?account_id=<cuenta Folvy> (por
// cuenta; multi-tenant). Inserta un nonce de un solo uso en
// public.hubrise_oauth_state y redirige 302 al authorize de HubRise pidiendo
// el scope de escritura de catálogo+inventario. hubrise-oauth-callback
// consume el nonce cuando HubRise redirige de vuelta con el code.
//
// Sin secreto de enlace: abrir esto con un account_id ajeno solo lleva a la
// pantalla de login/consentimiento de HubRise (no expone ni cambia nada por
// sí solo; HubRise exige credenciales HubRise reales para continuar).
//
// Fase 2 (self-service) sustituirá esto por un botón "Conectar" en Folvy;
// hoy es un enlace que Julio abre a mano por cuenta.
//
// Deploy: --no-verify-jwt (navegación de navegador, sin sesión Folvy).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HUBRISE_OAUTH_CLIENT_ID = Deno.env.get("HUBRISE_OAUTH_CLIENT_ID") ?? "";
const HUBRISE_OAUTH_REDIRECT_URI = Deno.env.get("HUBRISE_OAUTH_REDIRECT_URI") ?? "";
const HUBRISE_AUTHORIZE_URL = Deno.env.get("HUBRISE_AUTHORIZE_URL") ??
  "https://manager.hubrise.com/oauth2/v1/authorize";
const WRITER_SCOPE = "account[all_catalogs.write,inventory.write]";

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return text("Method Not Allowed", 405);

  if (!HUBRISE_OAUTH_CLIENT_ID || !HUBRISE_OAUTH_REDIRECT_URI) {
    return text(
      "hubrise-oauth-start: faltan Secrets HUBRISE_OAUTH_CLIENT_ID / HUBRISE_OAUTH_REDIRECT_URI.",
      500,
    );
  }

  const url = new URL(req.url);
  const accountId = url.searchParams.get("account_id") ?? "";
  if (!accountId) return text("Falta el parámetro account_id.", 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data, error } = await sb
    .from("hubrise_oauth_state")
    .insert({ account_id: accountId })
    .select("nonce")
    .single();

  if (error || !data) {
    console.error("hubrise-oauth-start: no se pudo crear el nonce", error);
    return text(`No se pudo iniciar la conexión: ${error?.message ?? "error desconocido"}`, 500);
  }

  const authorizeUrl = new URL(HUBRISE_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", HUBRISE_OAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", HUBRISE_OAUTH_REDIRECT_URI);
  authorizeUrl.searchParams.set("scope", WRITER_SCOPE);
  authorizeUrl.searchParams.set("state", data.nonce as string);

  return new Response(null, { status: 302, headers: { Location: authorizeUrl.toString() } });
});
