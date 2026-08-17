// supabase/functions/hubrise-catalog-create/index.ts
//
// CREAR (o reusar) EL CATÁLOGO DE UNA MARCA EN UN LOCAL — HubRise.
// ============================================================================
// ENCARGO CODE Carabanchel, 17/08/2026, §3. Piloto de una marca:
//   marca Folvy → catálogo HubRise propio → un bridge por plataforma
// El orden es catálogos → bridges → mapeos, y esta función hace el PRIMER paso
// y sólo ese.
//
// POR QUÉ EXISTE, SI YA ESTABA hubrise-brand-connect
// --------------------------------------------------
// hubrise-brand-connect ya crea catálogos por el mismo endpoint y es idempotente.
// Pero termina PUBLICANDO la carta, y esa llamada va sin acotar:
//     hubrise-brand-connect/index.ts:331  body: { brand_id: brandId }
//     hubrise-catalog-publish/index.ts:172 let body: { brand_id?: string } = {}
// hubrise-catalog-publish no acepta location_id y publica a TODAS las filas de
// brand_hubrise_catalog de la marca. Es decir: el acotado por local que trajo
// 2.3 llega a la creación pero NO a la publicación, así que conectar Bendito
// Burrito en Carabanchel republicaría el catálogo de Alcalá (j99jm) — que lleva
// 10 días en producción sin una incidencia y que el encargo prohíbe tocar.
//
// Esta función es ese mismo camino SIN la cola de publicación. Crea, mapea, y
// para. Publicar Carabanchel será una decisión aparte, cuando sus bridges
// apunten al catálogo nuevo.
//
// DEUDA DECLARADA: el bloque crear-o-reusar de aquí y el de hubrise-brand-connect
// son el mismo algoritmo (buscar por nombre → crear → upsert). No se ha
// factorizado a _shared porque eso obliga a redesplegar brand-connect, que hoy
// es camino vivo. DISPARADOR: cuando toque brand-connect por otro motivo,
// extraer el bloque a _shared/hubriseCatalog.ts y que las dos lo importen.
//
// ALCANCE: SIEMPRE un solo local. location_id es OBLIGATORIO — esta función no
// tiene modo barrido, ni por defecto ni por omisión. El local se llama igual en
// laboratorio y en producción ("Foodint Carabanchel" existe en las dos cuentas),
// así que todo va por location_id y jamás por nombre.
//
// QUÉ ESCRIBE (A.2-bis, 17/08). Tres cosas, en este orden:
//   1. el catálogo en HubRise
//   2. brand_hubrise_catalog  (marca → catálogo)
//   3. external_brand_map     (clave que llega en el pedido → marca)
// El (3) se escribe aquí y no desde un escritor aparte: esta función ya tiene
// marca, local y external_location_id, y ya es idempotente. Una superficie
// menos que mantener. Ver ensureBrandMap para la clave y para por qué escribe
// solo si falta.
//
// IDEMPOTENTE en tres capas:
//   1. fila en brand_hubrise_catalog → "ya_conectada", no toca HubRise
//   2. catálogo con ese nombre ya en el local → "reusada_por_nombre"
//   3. si no → POST y crea
// Las TRES ramas aseguran el mapeo, no solo la de "creada". Si no, las 6
// marcas de Carabanchel —que ya tienen catálogo desde el 17/08 y ningún
// mapeo— no lo recibirían nunca, y volver a pulsar no las arreglaría.
//
// dry_run: hace SOLO la lectura (GET /locations/:ext/catalogs) y devuelve el
// scope de lo que hay. No crea ni escribe nada. Es como se responde la pregunta
// del §2 del encargo — si los catálogos de Alcalá son de CUENTA y no de LOCAL,
// Alcalá ya estaría expuesta a que sus precios lleguen a otro local, y eso es
// una conversación, no una tarea.
//
// AUTH: JWT del usuario (igual que hubrise-brand-connect). La autorización la
// da RLS: la marca se lee con el cliente del USUARIO. Deploy SIN --no-verify-jwt.
//
// TOKEN: escritor de cuenta desde el VAULT vía resolveWriterToken
// (hubrise_writer_token_read). Es el de "Folvy Escritor" — account[all_catalogs
// .write,inventory.write] — NUNCA el de "Folvy" (pedidos, el que valida
// hubrise-webhook). El token no sale de esta función: ni al cliente, ni a la
// respuesta, ni a un log.

// ESTADO DE DESPLIEGUE — v2 (17/08, tras las 23:45), verify_jwt=true.
// El v1 (09:2x) se desplegó con la cabecera de comentarios quitada y los
// acentos fuera de los mensajes de error: la lógica era idéntica sentencia a
// sentencia pero NO byte a byte, y así se declaró en su momento en vez de
// llamarlo "compila". El v2 sube ESTE fichero tal cual, con sus comentarios y
// sus acentos, y se verifica con un diff contra get_edge_function. Con eso el
// repo vuelve a ser la verdad de lo que corre y la divergencia queda cerrada.
//
// TRAMPA DE NOMBRES, nivel marca (además de la de locales): "Bendito Burrito"
// existe en las DOS cuentas —95635ce3… en Foodint (producción) y 73673376… en
// Folvy Interno (laboratorio)—, igual que "Foodint Carabanchel" existe en las
// dos. El ensayo y la ejecución real se diferencian SÓLO por los UUID. Nunca
// resolver ninguno de los dos por nombre.

import { corsHeaders } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveWriterToken } from "../_shared/hubriseToken.ts";

const HUBRISE_BASE = "https://api.hubrise.com/v1";

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Scope de un catálogo tal como lo devuelve HubRise. La pregunta del §2 es si
// el objeto viene colgado de la CUENTA o del LOCAL: se reporta el dato crudo y
// las claves presentes, sin interpretar de más.
interface CatalogScope {
  id: string | null;
  name: string | null;
  account_id: unknown;
  location_id: unknown;
  scope: "location" | "account" | "desconocido";
  keys: string[];
}

// ── A.2-bis: la fila de external_brand_map ───────────────────────────────────
//
// Se escribe DESDE AQUÍ y no desde un escritor aparte: esta función ya tiene
// marca, local y external_location_id, y ya es idempotente. Una superficie
// menos que mantener.
//
// LA CLAVE ES EL NOMBRE PELADO DE LA MARCA (brand.name), nunca el compuesto del
// bridge. No es preferencia: verificado el 17/08 contra las ventas reales de
// Alcalá — las 8 claves que llegaron por HubRise entre el 06 y el 16/08 son
// nombres pelados, cero compuestas. Las 3 filas "{App} Bridge - {Marca}" que
// hay desde el 29/07 no han casado nunca con nada.
//
// ESCRIBE SOLO SI FALTA. No es un upsert, y la diferencia importa:
//   · una fila con is_ignored=true es una decisión humana ("esta marca no es
//     mía") — pisarla la desharía en silencio;
//   · una fila apuntando a OTRA marca es una atribución que alguien hizo —
//     pisarla re-atribuiría ventas sin avisar.
// Ambas se reportan como conflicto y se dejan quietas. De paso, esto cumple
// literalmente "no toques las 12 filas de Alcalá": sus 9 mapeos pelados ya
// existen y son correctos, así que quedan intactos por construcción.
type BrandMapStatus = 'creado' | 'ya_existia' | 'conflicto' | 'no_escrito_dry_run' | 'error';

interface BrandMapResult {
  status: BrandMapStatus;
  external_brand_id: string;
  detalle?: string;
}

interface EnsureBrandMapArgs {
  accountId: string;
  externalLocationId: string;
  brandId: string;
  brandName: string;
  dryRun: boolean;
}

// deno-lint-ignore no-explicit-any
async function ensureBrandMap(sb: any, a: EnsureBrandMapArgs): Promise<BrandMapResult> {
  const key = a.brandName;

  const { data: existing, error: selErr } = await sb
    .from('external_brand_map')
    .select('brand_id, is_ignored')
    .eq('account_id', a.accountId)
    .eq('source', 'hubrise')
    .eq('external_location_id', a.externalLocationId)
    .eq('external_brand_id', key)
    .maybeSingle();

  if (selErr) {
    return { status: 'error', external_brand_id: key, detalle: selErr.message };
  }

  if (existing) {
    if (existing.is_ignored === true) {
      return {
        status: 'conflicto', external_brand_id: key,
        detalle: 'Ya existe y está DESCARTADA (is_ignored). Es una decisión humana: no se toca. Revísala en "Marcas de fuera".',
      };
    }
    if (existing.brand_id && existing.brand_id !== a.brandId) {
      return {
        status: 'conflicto', external_brand_id: key,
        detalle: `Ya existe y apunta a OTRA marca (${existing.brand_id}). No se toca: re-atribuiría ventas en silencio.`,
      };
    }
    return { status: 'ya_existia', external_brand_id: key };
  }

  if (a.dryRun) {
    return { status: 'no_escrito_dry_run', external_brand_id: key, detalle: 'Falta y se crearía.' };
  }

  // El CHECK external_brand_map_decision_chk obliga: mapeada ⇒ brand_id NOT
  // NULL e is_ignored=false. Lo garantiza la BBDD, no esta función.
  const { error: insErr } = await sb.from('external_brand_map').insert({
    account_id: a.accountId,
    source: 'hubrise',
    external_location_id: a.externalLocationId,
    external_brand_id: key,
    brand_id: a.brandId,
    is_ignored: false,
  });
  if (insErr) {
    // Carrera con otra ejecución: la única (account, source, ext_loc,
    // ext_brand) la resuelve la BBDD. Eso no es un fallo, es idempotencia.
    if ((insErr.code as string) === '23505') {
      return { status: 'ya_existia', external_brand_id: key, detalle: 'Creada por otra ejecución simultánea.' };
    }
    return { status: 'error', external_brand_id: key, detalle: insErr.message };
  }
  return { status: 'creado', external_brand_id: key };
}

function inspectCatalog(c: Record<string, unknown>): CatalogScope {
  const hasLoc = c["location_id"] !== undefined && c["location_id"] !== null;
  const hasAcc = c["account_id"] !== undefined && c["account_id"] !== null;
  return {
    id: (c["id"] as string) ?? null,
    name: (c["name"] as string) ?? null,
    account_id: c["account_id"] ?? null,
    location_id: c["location_id"] ?? null,
    scope: hasLoc ? "location" : hasAcc ? "account" : "desconocido",
    keys: Object.keys(c).sort(),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // ── Auth: validar usuario por su JWT ──────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const sbUser = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await sbUser.auth.getUser();
  const user = userData?.user ?? null;
  if (!user) return json({ ok: false, error: "no autenticado" }, 401);

  let body: { brand_id?: string; location_id?: string; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const brandId = body.brand_id;
  const locationId = body.location_id;
  const dryRun = body.dry_run === true;

  if (!brandId) return json({ ok: false, error: "brand_id requerido" }, 400);
  // Sin valor por defecto peligroso: sin location_id no se hace nada. Esta
  // función no tiene modo barrido a propósito (ver cabecera).
  if (!locationId) {
    return json({
      ok: false,
      error: "location_id requerido. Esta función SIEMPRE opera sobre un solo local; no tiene modo barrido.",
    }, 400);
  }

  // ── Autorización por RLS: leer la marca con el cliente del USUARIO ─────────
  const { data: brand, error: brErr } = await sbUser
    .from("brand")
    .select("id, account_id, name, catalog_source")
    .eq("id", brandId)
    .maybeSingle();
  if (brErr) return json({ ok: false, error: `acceso a marca: ${brErr.message}` }, 403);
  if (!brand) return json({ ok: false, error: "marca no encontrada o sin acceso" }, 403);
  if ((brand.catalog_source as string) !== "folvy") {
    return json({
      ok: false,
      error: "Esta marca no la gobierna Folvy (catalog_source != 'folvy'): su carta la manda el TPV. No se conecta.",
    }, 200);
  }
  const accountId = brand.account_id as string;
  const brandName = brand.name as string;

  const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

  // ── Token ESCRITOR desde el Vault. Sin fallo mudo. ────────────────────────
  const writerToken = await resolveWriterToken(sb, accountId);
  if (!writerToken) {
    return json({
      ok: false,
      error: "Sin conexión escritor HubRise para esta cuenta. Conéctala primero (Ajustes > HubRise).",
    }, 200);
  }

  // ── Las tres condiciones del local, idénticas a hubrise-brand-connect ─────
  // a) el local existe y pertenece a esta cuenta
  const { data: loc, error: locErr } = await sb.from("locations")
    .select("id, name")
    .eq("id", locationId).eq("account_id", accountId)
    .maybeSingle();
  if (locErr) return json({ ok: false, error: `locations: ${locErr.message}` }, 500);
  if (!loc) {
    return json({
      ok: false,
      error: `location_id "${locationId}" no existe o no pertenece a la cuenta de esta marca.`,
    }, 200);
  }

  // b) tiene conexión HubRise activa
  const { data: elm, error: elmErr } = await sb.from("external_location_map")
    .select("external_location_id")
    .eq("account_id", accountId).eq("source", "hubrise").eq("is_active", true)
    .eq("location_id", locationId)
    .maybeSingle();
  if (elmErr) return json({ ok: false, error: `external_location_map: ${elmErr.message}` }, 500);
  if (!elm?.external_location_id) {
    return json({
      ok: false,
      error: `El local "${loc.name}" no tiene conexión HubRise activa (external_location_map). Conéctalo primero.`,
    }, 200);
  }
  const externalLocationId = elm.external_location_id as string;

  // c) la marca está activa en ese local
  const { data: bla, error: blaErr } = await sb.from("brand_location_availability")
    .select("location_id")
    .eq("account_id", accountId).eq("brand_id", brandId)
    .eq("location_id", locationId).eq("is_active", true)
    .maybeSingle();
  if (blaErr) return json({ ok: false, error: `brand_location_availability: ${blaErr.message}` }, 500);
  if (!bla) {
    return json({
      ok: false,
      error: `La marca "${brandName}" no está activa en el local "${loc.name}" (brand_location_availability).`,
    }, 200);
  }

  // El alcance nunca queda implícito: se dice entero en el log y en la respuesta.
  console.log(
    `hubrise-catalog-create: brand=${brandId} ("${brandName}") account=${accountId} ` +
    `location=${locationId} ("${loc.name}") ext_loc=${externalLocationId} dry_run=${dryRun}`,
  );

  const base = {
    brand_id: brandId,
    brand_name: brandName,
    account_id: accountId,
    location_id: locationId,
    location_name: loc.name as string,
    external_location_id: externalLocationId,
    dry_run: dryRun,
  };

  // ── Capa 1 de idempotencia: ya hay mapping para esta marca en este local ──
  const { data: existing, error: existErr } = await sb.from("brand_hubrise_catalog")
    .select("external_catalog_id, hubrise_catalog_name")
    .eq("account_id", accountId).eq("brand_id", brandId)
    .eq("external_location_id", externalLocationId)
    .maybeSingle();
  if (existErr) return json({ ok: false, error: `brand_hubrise_catalog: ${existErr.message}` }, 500);

  // ── Lectura de catálogos del local. Sirve para dos cosas: responder el §2
  // (scope de lo que ya existe) y buscar por nombre antes de crear — los
  // nombres de catálogo son únicos por local en HubRise. ────────────────────
  let scopeCheck: CatalogScope[] = [];
  let listOk = false;
  let listError: string | null = null;
  try {
    const listRes = await fetch(`${HUBRISE_BASE}/locations/${externalLocationId}/catalogs`, {
      headers: { "X-Access-Token": writerToken },
    });
    listOk = listRes.ok;
    if (listRes.ok) {
      const list = await listRes.json();
      if (Array.isArray(list)) {
        scopeCheck = list.map((c) => inspectCatalog(c as Record<string, unknown>));
      }
    } else {
      listError = (await listRes.text()).slice(0, 300);
    }
  } catch (e) {
    listError = e instanceof Error ? e.message : String(e);
  }

  // Resumen del §2 — dicho en una línea para que no haya que leer el array.
  const scopeSummary = {
    total: scopeCheck.length,
    de_local: scopeCheck.filter((c) => c.scope === "location").length,
    de_cuenta: scopeCheck.filter((c) => c.scope === "account").length,
    desconocido: scopeCheck.filter((c) => c.scope === "desconocido").length,
  };

  const mapArgs = {
    accountId, externalLocationId, brandId, brandName, dryRun,
  };

  if (dryRun) {
    return json({
      ok: listOk,
      ...base,
      status: "dry_run",
      ya_mapeado: existing?.external_catalog_id ?? null,
      list_ok: listOk,
      list_error: listError,
      scope_summary: scopeSummary,
      brand_map: await ensureBrandMap(sb, mapArgs),   // solo mira, no escribe
      catalogs: scopeCheck,
    }, 200);
  }

  // ── ya_conectada TAMBIÉN asegura el mapeo ────────────────────────────────
  // Es el caso que de verdad importa hoy: las 6 marcas de Carabanchel ya
  // tienen catálogo (creado el 17/08) y ninguna tiene mapeo. Si el mapeo solo
  // se escribiera en la rama "creada", esas seis no lo recibirían NUNCA —
  // volver a pulsar no las arreglaría, que es justo lo contrario de lo que se
  // espera de un botón idempotente. Con esto, pulsar otra vez las repara.
  if (existing?.external_catalog_id) {
    const brandMap = await ensureBrandMap(sb, mapArgs);
    return json({
      ok: brandMap.status !== 'error', ...base,
      status: "ya_conectada",
      external_catalog_id: existing.external_catalog_id,
      hubrise_catalog_name: existing.hubrise_catalog_name,
      brand_map: brandMap,
      scope_summary: scopeSummary,
    }, 200);
  }

  if (!listOk) {
    // No se crea a ciegas: sin poder listar no se puede garantizar que no haya
    // ya un catálogo con ese nombre, y crear encima duplicaría.
    return json({
      ok: false, ...base,
      status: "error",
      error: `No se pudo listar catálogos del local (${listError ?? "error desconocido"}). No se crea nada a ciegas.`,
    }, 200);
  }

  // ── Capa 2: reusar por nombre ─────────────────────────────────────────────
  const found = scopeCheck.find((c) => c.name === brandName);
  let catalogId = found?.id ?? null;
  const reused = !!catalogId;

  // ── Capa 3: crear ─────────────────────────────────────────────────────────
  if (!catalogId) {
    const createRes = await fetch(`${HUBRISE_BASE}/locations/${externalLocationId}/catalogs`, {
      method: "POST",
      headers: { "X-Access-Token": writerToken, "Content-Type": "application/json" },
      body: JSON.stringify({ name: brandName }),
    });
    if (!createRes.ok) {
      return json({
        ok: false, ...base, status: "error",
        error: `HubRise rechazó la creación: ${(await createRes.text()).slice(0, 300)}`,
      }, 200);
    }
    const created = await createRes.json();
    catalogId = (created?.id as string | undefined) ?? null;
    if (!catalogId) {
      return json({
        ok: false, ...base, status: "error",
        error: "HubRise no devolvió id de catálogo.",
      }, 200);
    }
  }

  // ── Mapping en Folvy ──────────────────────────────────────────────────────
  const { error: upErr } = await sb.from("brand_hubrise_catalog").upsert({
    account_id: accountId, brand_id: brandId, location_id: locationId,
    external_location_id: externalLocationId, external_catalog_id: catalogId,
    hubrise_catalog_name: brandName, created_by: user.id,
  }, { onConflict: "account_id,brand_id,external_location_id" });
  if (upErr) {
    return json({
      ok: false, ...base, status: "error",
      external_catalog_id: catalogId,
      error: `Catálogo ${reused ? "reusado" : "creado"} (${catalogId}) pero no se pudo guardar el mapping: ${upErr.message}`,
    }, 200);
  }

  const brandMap = await ensureBrandMap(sb, mapArgs);

  return json({
    ok: brandMap.status !== 'error', ...base,
    status: reused ? "reusada_por_nombre" : "creada",
    external_catalog_id: catalogId,
    hubrise_catalog_name: brandName,
    brand_map: brandMap,
    scope_summary: scopeSummary,
    // Esta función NO publica. Dicho explícitamente para que no se dé por hecho.
    published: false,
    nota: "Catálogo creado y mapeado (catálogo + brand_hubrise_catalog + external_brand_map). NO se ha publicado carta: eso es un paso aparte, cuando los bridges apunten aquí.",
  }, 200);
});
