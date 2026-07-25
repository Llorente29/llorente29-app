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
// `sb` DEBE ser un cliente service_role (external_integration no es legible por anon).
// Se tipa de forma ESTRUCTURAL a proposito, para no depender del import map de cada
// funcion (unas importan supabase-js por alias, otras por URL de esm.sh).

// deno-lint-ignore no-explicit-any
type QueryResult = { data: any; error: any };
interface SupabaseLike {
  from: (table: string) => {
    // deno-lint-ignore no-explicit-any
    select: (cols: string) => any;
  };
}

export interface HubriseTokenQuery {
  accountId: string;
  externalLocationId?: string | null;
  connectionName?: string | null;
}

// Devuelve el access_token de la conexion, o null si no hay ninguno activo/utilizable.
export async function resolveHubriseToken(
  sb: SupabaseLike,
  q: HubriseTokenQuery,
): Promise<string | null> {
  if (!q.accountId || !q.externalLocationId) return null;

  const { data, error }: QueryResult = await sb
    .from("external_integration")
    .select("connection_name, access_token, push_status_enabled, is_active")
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

  // Preferimos la fila de la conexion EXACTA; si no, cualquiera del local
  // (comparten el token del local en HubRise).
  if (q.connectionName) {
    const exact = usable.find((r) => r["connection_name"] === q.connectionName);
    if (exact) return exact["access_token"] as string;
  }
  return usable[0]["access_token"] as string;
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
