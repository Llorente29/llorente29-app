// supabase/functions/hubrise-oauth-start/index.ts
//
// HubRise — arranque del OAuth2 authorize. Dos flujos (ENCARGO CODE 2.1,
// 15/08/2026):
//   kind=writer   (default, Fase 1): ?account_id=<cuenta Folvy> — scope de
//     CUENTA (catálogo+inventario). Comportamiento de siempre, sin cambios.
//   kind=location (2.1): ?account_id=<cuenta Folvy>&scope=location&
//     location_id=<local Folvy> — scope de LOCATION (orders.write). El
//     local debe existir, estar activo y pertenecer a esa cuenta.
// ============================================================================
// Inserta un nonce de un solo uso en public.hubrise_oauth_state (con kind +
// location_id) y redirige 302 al authorize de HubRise pidiendo el scope
// correspondiente. hubrise-oauth-callback consume el nonce y bifurca por
// `kind` — ver ese fichero.
//
// Sin secreto de enlace: abrir esto con un account_id ajeno solo lleva a la
// pantalla de login/consentimiento de HubRise (no expone ni cambia nada por
// sí solo; HubRise exige credenciales HubRise reales para continuar).
//
// Fase 2 (self-service) sustituirá esto por un botón "Conectar" en Folvy;
// hoy es un enlace que Julio (o el asistente de conexión) abre por cuenta/local.
//
// ?scope=<clave>: lista blanca CERRADA — solo las claves de SCOPE_WHITELIST,
//   cualquier otra cosa es 400. Omitido (o "writer") = EXACTAMENTE el
//   comportamiento de siempre, byte a byte (producción no puede notar este
//   parámetro). Nunca se acepta el string de scope crudo por query: solo una
//   clave corta que mapea a un valor fijo en el código.
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
const LOCATION_SCOPE = "location[orders.write]";

// Lista blanca CERRADA de scopes admitidos vía ?scope=<clave>. "writer" es el
// default de siempre. "location" es el flujo real de 2.1 (reemplaza al
// "location_test" temporal del test F0.2/RECON del 15/08 — ver
// folvy_mapa_sistema.md sección HubRise, y el commit que retiró ese modo
// inspección).
const SCOPE_WHITELIST: Record<string, string> = {
  writer: WRITER_SCOPE,
  location: LOCATION_SCOPE,
};

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

  const scopeKey = url.searchParams.get("scope");
  const scope = scopeKey === null ? WRITER_SCOPE : SCOPE_WHITELIST[scopeKey];
  if (!scope) {
    return text(
      `scope no reconocido: "${scopeKey}". Valores válidos: ${Object.keys(SCOPE_WHITELIST).join(", ")}.`,
      400,
    );
  }
  const kind: "writer" | "location" = scopeKey === "location" ? "location" : "writer";

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Flujo location: el location_id es obligatorio y debe ser un local real,
  // activo, de ESTA cuenta — nunca se acepta a ciegas.
  let locationId: string | null = null;
  if (kind === "location") {
    locationId = url.searchParams.get("location_id");
    if (!locationId) return text("Falta el parámetro location_id (obligatorio con scope=location).", 400);

    const { data: loc, error: locErr } = await sb
      .from("locations")
      .select("id")
      .eq("id", locationId)
      .eq("account_id", accountId)
      .eq("active", true)
      .maybeSingle();
    if (locErr) {
      console.error("hubrise-oauth-start: error verificando location_id", locErr);
      return text("Error interno verificando el local.", 500);
    }
    if (!loc) return text("location_id no encontrado, inactivo, o no pertenece a esa cuenta.", 400);
  }

  const { data, error } = await sb
    .from("hubrise_oauth_state")
    .insert({ account_id: accountId, kind, location_id: locationId })
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
  authorizeUrl.searchParams.set("scope", scope);
  authorizeUrl.searchParams.set("state", data.nonce as string);

  return new Response(null, { status: 302, headers: { Location: authorizeUrl.toString() } });
});
