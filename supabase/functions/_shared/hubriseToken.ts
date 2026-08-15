// supabase/functions/_shared/hubriseToken.ts
//
// RESOLUCION DE TOKEN HubRise POR CONEXION — helper compartido.
// ============================================================================
// Unifica de donde sale el X-Access-Token de HubRise. FUENTE DE VERDAD:
//   tabla `external_integration` (source='hubrise') -> token + catalogo POR conexion
//   (account_id x external_location_id x connection_name). Es la MISMA tabla que ya
//   consume `hubrise-catalog-publish`, asi que ENTRADA, SALIDA y CATALOGO comparten
//   origen de token (fin del `HUBRISE_ACCESS_TOKEN` global disperso).
//
// El token de HubRise es POR conexion cliente x location y cubre las marcas de ese
// local; por eso resolvemos por (account, external_location_id) y afinamos por
// connection_name si viene. El llamador cae al Secret global HUBRISE_ACCESS_TOKEN
// SOLO como ultimo recurso (compatibilidad durante la migracion). Sin fallos en
// silencio: si no hay token en ningun sitio, devuelve null y el push lo reporta.
//
// Uso tipico:
//   import { resolveHubriseToken } from "../_shared/hubriseToken.ts";
//   const token = (await resolveHubriseToken(sb, { accountId, externalLocationId, connectionName }))
//                 ?? (Deno.env.get("HUBRISE_ACCESS_TOKEN") ?? "");
//
// `sb` DEBE ser un cliente service_role (external_integration no es legible por anon
// desde el 15/08/2026 — antes SÍ lo era, ver 20260815T2300_hubrise_revoke_token_columns.sql).
// Se tipa de forma ESTRUCTURAL a proposito, para no depender del import map de cada
// funcion (unas importan supabase-js por alias, otras por URL de esm.sh).
//
// DEUDA DECLARADA (15/08/2026): access_token vive en TEXTO PLANO en esta
// columna — el único patrón Vault real de todo HubRise es
// hubrise_writer_connection.credentials_ref (la conexión escritora). El
// REVOKE de la migración de arriba cierra el riesgo real (cualquier empleado
// podía leerlo); Vault sigue siendo mejor pero NO se hace ahora: dos de los
// lectores de esta tabla (hubrise-catalog-publish y availability-dispatch)
// tienen su PROPIO SELECT directo de access_token en sus rutas de fallback,
// duplicado del de este fichero — migrar a Vault exige tocar esos dos
// también, y availability-dispatch es el camino vivo del 86 en producción.
// DISPARADOR: consolidar esas lecturas duplicadas para que pasen por
// resolveHubriseToken/listActiveHubriseConnections, y migrar a Vault, ANTES
// de conectar el cliente 2 — no antes, para no meter riesgo en mitad de la
// certificación de Carabanchel (hubrise-catalog-publish v40 recién desplegada).

// deno-lint-ignore no-explicit-any
type QueryResult = { data: any; error: any };
interface SupabaseLike {
  from: (table: string) => {
    // deno-lint-ignore no-explicit-any
    select: (cols: string) => any;
  };
  // deno-lint-ignore no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<QueryResult>;
}

export interface HubriseTokenQuery {
  accountId: string;
  externalLocationId?: string | null;
  connectionName?: string | null;
}

// Devuelve el access_token de la conexion, o null si no hay ninguno activo/utilizable.
//
// ORDEN DETERMINISTA (Fase 1.1, ENCARGO CODE módulo HubRise): el índice único
// parcial `ux_ei_hubrise_usable` (account_id, external_location_id) WHERE
// source='hubrise' AND is_active AND push_status_enabled garantiza en BBDD que
// a lo sumo UNA fila puede ser "usable" para un (cuenta, location) dado. Si
// aun así aparece más de una (dato heredado de antes del índice, o el índice
// se sorteó), el fallback ya NO coge `usable[0]` a ciegas: ordena por
// connection_name y avisa por consola — nunca falla en silencio.
export async function resolveHubriseToken(
  sb: SupabaseLike,
  q: HubriseTokenQuery,
): Promise<string | null> {
  if (!q.accountId || !q.externalLocationId) return null;

  const { data, error }: QueryResult = await sb
    .from("external_integration")
    .select("id, connection_name, access_token, push_status_enabled, is_active")
    .eq("source", "hubrise")
    .eq("account_id", q.accountId)
    .eq("external_location_id", q.externalLocationId)
    .eq("is_active", true);

  if (error || !data || data.length === 0) return null;

  // Filas con token utilizable (push habilitado y token no vacio).
  const usable = (data as Array<Record<string, unknown>>).filter((r) => {
    const enabled = r["push_status_enabled"] !== false;
    const tok = r["access_token"];
    return enabled && typeof tok === "string" && tok.length > 0;
  });
  if (usable.length === 0) return null;

  // Preferimos la fila de la conexion EXACTA; si no, la más antigua por orden
  // determinista (connection_name, luego id) — nunca "la primera que llegó".
  if (q.connectionName) {
    const exact = usable.find((r) => r["connection_name"] === q.connectionName);
    if (exact) return exact["access_token"] as string;
  }

  if (usable.length > 1) {
    console.warn(
      `resolveHubriseToken: ${usable.length} conexiones usables para account=${q.accountId} ` +
      `location=${q.externalLocationId} (se esperaba <=1; revisa ux_ei_hubrise_usable). ` +
      `Usando la de menor connection_name/id por orden determinista.`,
    );
  }
  const sorted = [...usable].sort((a, b) => {
    const an = (a["connection_name"] as string | null) ?? "";
    const bn = (b["connection_name"] as string | null) ?? "";
    if (an !== bn) return an < bn ? -1 : 1;
    const aid = (a["id"] as string | null) ?? "";
    const bid = (b["id"] as string | null) ?? "";
    return aid < bid ? -1 : aid > bid ? 1 : 0;
  });
  return sorted[0]["access_token"] as string;
}

// Conexion HubRise activa con token — para el auto-sanador MULTI-CONEXION.
export interface HubriseConnection {
  accountId: string;
  externalLocationId: string | null;
  connectionName: string | null;
  accessToken: string;
}

// Lista todas las conexiones HubRise activas con token utilizable.
export async function listActiveHubriseConnections(
  sb: SupabaseLike,
): Promise<HubriseConnection[]> {
  const { data, error }: QueryResult = await sb
    .from("external_integration")
    .select("account_id, external_location_id, connection_name, access_token, push_status_enabled, is_active")
    .eq("source", "hubrise")
    .eq("is_active", true);

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>)
    .filter((r) => {
      const enabled = r["push_status_enabled"] !== false;
      const tok = r["access_token"];
      return enabled && typeof tok === "string" && tok.length > 0;
    })
    .map((r) => ({
      accountId: r["account_id"] as string,
      externalLocationId: (r["external_location_id"] as string | null) ?? null,
      connectionName: (r["connection_name"] as string | null) ?? null,
      accessToken: r["access_token"] as string,
    }));
}

// ── Token ESCRITOR (Fase 1) ─────────────────────────────────────────────────
//
// Conexión OAuth propia de Folvy por CUENTA (scope account[all_catalogs.write,
// inventory.write]), guardada en Vault (public.hubrise_writer_connection +
// hubrise_writer_token_save/read — 20260729T1500_hubrise_writer_token.sql).
// Distinta de resolveHubriseToken/listActiveHubriseConnections (tokens de
// BRIDGE, por conexión/local, con orders.write — esos NO se tocan: los sigue
// usando hubrise-webhook/hubrise-order-status).
//
// Devuelve null (nunca lanza) si no hay conexión escritor para la cuenta; el
// llamador decide el fallback transicional al token de bridge y lo avisa con
// console.warn (sin fallo mudo).
export async function resolveWriterToken(
  sb: SupabaseLike,
  accountId: string,
): Promise<string | null> {
  if (!accountId) return null;

  const { data, error }: QueryResult = await sb.rpc("hubrise_writer_token_read", {
    p_account_id: accountId,
  });
  if (error) {
    console.warn("resolveWriterToken: error RPC hubrise_writer_token_read", error.message ?? error);
    return null;
  }
  return typeof data === "string" && data.length > 0 ? data : null;
}
