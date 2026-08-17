// supabase/functions/hubrise-brand-connect/index.ts
//
// ASISTENTE "CONECTAR A DELIVERY" · HubRise Fase 2 (self-service).
// ============================================================================
// Invocado por el USUARIO desde la página de carta de la marca (botón
// "Conectar a delivery") o por el asistente de conexión de Fase 3 (2.3,
// 15/08/2026). Por cada local activo de la marca con conexión HubRise
// (brand_location_availability x external_location_map):
//   1. Crea el catálogo en HubRise (POST /locations/{ext_loc}/catalogs) con
//      el token ESCRITOR de cuenta -- IDEMPOTENTE: si la marca ya tiene fila
//      en brand_hubrise_catalog para ese local, la reusa; si no, busca por
//      nombre (GET /locations/{ext_loc}/catalogs -- los nombres de catálogo
//      son únicos por local en HubRise) antes de crear uno nuevo.
//   2. Guarda el mapping en brand_hubrise_catalog (fuente de verdad marca->
//      catálogo que leen hubrise-catalog-publish / availability-dispatch).
//   3. Publica la carta -- REUSA hubrise-catalog-publish invocándolo por HTTP
//      con el JWT del propio usuario (no se duplica la construcción del
//      payload de categorías/productos/modificadores/combos/imágenes).
//
// NO hace el "reconnect" de plataforma (Uber/Glovo/Just Eat) -- eso no tiene
// API en HubRise (solo consentimiento OAuth de panel); es un paso GUIADO de
// go-live, aparte, fuera de esta fase.
//
// AUTH: el usuario invoca con su sesión (functions.invoke manda su JWT). La
//   autorización la da RLS: se lee la marca con el cliente del USUARIO; si
//   RLS la deja ver, tiene acceso. El trabajo pesado va con service_role.
//   Deploy SIN --no-verify-jwt (no es webhook; el gateway valida el JWT).
//
// Requiere token ESCRITOR de cuenta (hubrise_writer_connection, Fase 1). Sin
// fallo mudo: si no hay, error visible -- crear catálogo exige scope de
// escritura de cuenta, no hay fallback de bridge posible para esto.
//
// location_id (body, OPCIONAL, 2.3 15/08/2026): acota la operación a UN solo
// local en vez del barrido de todos los locales mapeados de la marca. Omitido
// = comportamiento de siempre (todos), para no romper el botón "Conectar a
// delivery" de Kitchen. El asistente de Fase 3 SIEMPRE lo pasa -- acota al
// local que se acaba de conectar por 2.1, sin retocar los demás.
//
// Riesgo de valor por defecto peligroso, neutralizado por diseño (Julio,
// 15/08): un location_id omitido por error nunca puede quedar invisible.
//   1) El log dice explícitamente si el alcance vino ACOTADO o fue BARRIDO
//      COMPLETO, con cuántos locales. La respuesta JSON también lleva
//      `scope`/`requested_location_id`, no solo la lista `locations` (que ya
//      de por sí es el resultado por local, nunca un "ok" agregado).
//   2) Un location_id inválido falla A LA VISTA, con un mensaje que dice
//      EXACTAMENTE cuál de las tres condiciones no se cumple -- nunca
//      "0 locales procesados" silencioso:
//        a) el local pertenece a esta cuenta (locations.account_id)
//        b) tiene conexión HubRise activa (external_location_map)
//        c) la marca está activa ahí (brand_location_availability)
// ============================================================================

import { corsHeaders } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveWriterToken } from "../_shared/hubriseToken.ts";

const HUBRISE_BASE = "https://api.hubrise.com/v1";

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface LocationTarget {
  locationId: string;
  externalLocationId: string;
  locationName: string;
}

interface CatalogResult {
  location_id: string;
  external_location_id: string;
  location_name: string;
  status: "ya_conectada" | "reusada_por_nombre" | "creada" | "error";
  external_catalog_id?: string;
  error?: string;
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

  let body: { brand_id?: string; location_id?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const brandId = body.brand_id;
  if (!brandId) return json({ ok: false, error: "brand_id requerido" }, 400);
  const requestedLocationId = body.location_id ? body.location_id : null;

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

  // ── service_role para el trabajo ──────────────────────────────────────────
  const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

  // ── Token ESCRITOR (Fase 1): obligatorio para crear catálogo. Sin fallo mudo. ──
  const writerToken = await resolveWriterToken(sb, accountId);
  if (!writerToken) {
    return json({
      ok: false,
      error: "Sin conexión escritor HubRise para esta cuenta. Conéctala primero (Ajustes > HubRise).",
    }, 200);
  }

  // ── Locales objetivo: ACOTADO a location_id, o BARRIDO de todos los
  // locales activos de la marca con conexión HubRise ──────────────────────
  let targets: LocationTarget[];
  let scopeDesc: string;

  if (requestedLocationId) {
    // Condición a: el local existe y pertenece a esta cuenta.
    const { data: loc, error: locErr } = await sb.from("locations")
      .select("id, name")
      .eq("id", requestedLocationId).eq("account_id", accountId)
      .maybeSingle();
    if (locErr) return json({ ok: false, error: `locations: ${locErr.message}` }, 500);
    if (!loc) {
      return json({
        ok: false,
        error: `location_id "${requestedLocationId}" no existe o no pertenece a esta cuenta.`,
      }, 200);
    }

    // Condición b: tiene conexión HubRise activa en external_location_map.
    const { data: elm, error: elmErr } = await sb.from("external_location_map")
      .select("external_location_id")
      .eq("account_id", accountId).eq("source", "hubrise").eq("is_active", true)
      .eq("location_id", requestedLocationId)
      .maybeSingle();
    if (elmErr) return json({ ok: false, error: `external_location_map: ${elmErr.message}` }, 500);
    if (!elm?.external_location_id) {
      return json({
        ok: false,
        error: `El local "${loc.name}" no tiene conexión HubRise activa (external_location_map).`,
      }, 200);
    }

    // Condición c: la marca está activa en ese local.
    const { data: bla, error: blaErr } = await sb.from("brand_location_availability")
      .select("location_id")
      .eq("account_id", accountId).eq("brand_id", brandId)
      .eq("location_id", requestedLocationId).eq("is_active", true)
      .maybeSingle();
    if (blaErr) return json({ ok: false, error: `brand_location_availability: ${blaErr.message}` }, 500);
    if (!bla) {
      return json({
        ok: false,
        error: `La marca "${brandName}" no está activa en el local "${loc.name}" (brand_location_availability).`,
      }, 200);
    }

    targets = [{
      locationId: requestedLocationId,
      externalLocationId: elm.external_location_id as string,
      locationName: loc.name as string,
    }];
    scopeDesc = `ACOTADO a 1 local (location_id=${requestedLocationId}, "${loc.name}")`;
  } else {
    // Error de cliente != "cero resultados": si alguna de estas falla, se
    // corta con 500 en vez de reportar "marca sin locales" (mensaje engañoso).
    const { data: blaRows, error: blaErr } = await sb.from("brand_location_availability")
      .select("location_id")
      .eq("account_id", accountId).eq("brand_id", brandId).eq("is_active", true);
    if (blaErr) return json({ ok: false, error: `brand_location_availability: ${blaErr.message}` }, 500);
    const locationIds = (blaRows ?? []).map((r) => r.location_id as string).filter(Boolean);
    if (locationIds.length === 0) {
      return json({
        ok: false,
        error: "La marca no está activa en ningún local (brand_location_availability).",
      }, 200);
    }

    const { data: locRows, error: locErr } = await sb.from("locations")
      .select("id, name")
      .in("id", locationIds);
    if (locErr) return json({ ok: false, error: `locations: ${locErr.message}` }, 500);
    const nameByLocation = new Map((locRows ?? []).map((l) => [l.id as string, l.name as string]));

    const { data: elmRows, error: elmErr } = await sb.from("external_location_map")
      .select("location_id, external_location_id")
      .eq("account_id", accountId).eq("source", "hubrise").eq("is_active", true)
      .in("location_id", locationIds);
    if (elmErr) return json({ ok: false, error: `external_location_map: ${elmErr.message}` }, 500);

    targets = (elmRows ?? [])
      .filter((r) => r.external_location_id)
      .map((r) => ({
        locationId: r.location_id as string,
        externalLocationId: r.external_location_id as string,
        locationName: nameByLocation.get(r.location_id as string) ?? "?",
      }));
    scopeDesc = `BARRIDO COMPLETO de ${targets.length} local(es) mapeados`;
  }

  console.log(`hubrise-brand-connect: brand=${brandId} account=${accountId} -- ${scopeDesc}`);

  if (targets.length === 0) {
    return json({
      ok: false,
      error: "Ninguno de los locales de la marca tiene conexión HubRise (external_location_map).",
    }, 200);
  }

  // ── Idempotente: catálogos ya registrados para esta marca ────────────────
  const { data: existingRows, error: existErr } = await sb.from("brand_hubrise_catalog")
    .select("external_location_id, external_catalog_id")
    .eq("account_id", accountId).eq("brand_id", brandId);
  if (existErr) return json({ ok: false, error: `brand_hubrise_catalog: ${existErr.message}` }, 500);
  const existingByLoc = new Map(
    (existingRows ?? []).map((r) => [r.external_location_id as string, r.external_catalog_id as string]));

  const results: CatalogResult[] = [];

  for (const t of targets) {
    const already = existingByLoc.get(t.externalLocationId);
    if (already) {
      results.push({
        location_id: t.locationId, external_location_id: t.externalLocationId,
        location_name: t.locationName, status: "ya_conectada", external_catalog_id: already,
      });
      continue;
    }

    try {
      // Los nombres de catálogo son únicos por local en HubRise: comprobar
      // antes de crear (evita duplicar si ya existe fuera de nuestra tabla,
      // p.ej. un alta manual previo con el mismo nombre de marca).
      const listRes = await fetch(`${HUBRISE_BASE}/locations/${t.externalLocationId}/catalogs`, {
        headers: { "X-Access-Token": writerToken },
      });
      let catalogId: string | null = null;
      let reused = false;
      if (listRes.ok) {
        const list = await listRes.json();
        const found = Array.isArray(list)
          ? list.find((c: { name?: string; id?: string }) => c.name === brandName)
          : null;
        if (found?.id) { catalogId = found.id as string; reused = true; }
      }

      if (!catalogId) {
        const createRes = await fetch(`${HUBRISE_BASE}/locations/${t.externalLocationId}/catalogs`, {
          method: "POST",
          headers: { "X-Access-Token": writerToken, "Content-Type": "application/json" },
          body: JSON.stringify({ name: brandName }),
        });
        if (!createRes.ok) {
          results.push({
            location_id: t.locationId, external_location_id: t.externalLocationId,
            location_name: t.locationName, status: "error",
            error: (await createRes.text()).slice(0, 300),
          });
          continue;
        }
        const created = await createRes.json();
        catalogId = (created?.id as string | undefined) ?? null;
        if (!catalogId) {
          results.push({
            location_id: t.locationId, external_location_id: t.externalLocationId,
            location_name: t.locationName, status: "error",
            error: "HubRise no devolvió id de catálogo",
          });
          continue;
        }
      }

      const { error: upErr } = await sb.from("brand_hubrise_catalog").upsert({
        account_id: accountId, brand_id: brandId, location_id: t.locationId,
        external_location_id: t.externalLocationId, external_catalog_id: catalogId,
        hubrise_catalog_name: brandName, created_by: user.id,
      }, { onConflict: "account_id,brand_id,external_location_id" });
      if (upErr) {
        results.push({
          location_id: t.locationId, external_location_id: t.externalLocationId,
          location_name: t.locationName, status: "error",
          error: `catálogo ${reused ? "reusado" : "creado"} (${catalogId}) pero no se pudo guardar el mapping: ${upErr.message}`,
        });
        continue;
      }

      results.push({
        location_id: t.locationId, external_location_id: t.externalLocationId,
        location_name: t.locationName, status: reused ? "reusada_por_nombre" : "creada",
        external_catalog_id: catalogId,
      });
    } catch (e) {
      results.push({
        location_id: t.locationId, external_location_id: t.externalLocationId,
        location_name: t.locationName, status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const anyCatalogReady = results.some((r) => r.status !== "error");

  // ── Publicar la carta -- REUSA hubrise-catalog-publish (mismo JWT de usuario) ──
  let publish: unknown = null;
  if (anyCatalogReady) {
    try {
      const pubRes = await fetch(`${SUPABASE_URL}/functions/v1/hubrise-catalog-publish`, {
        method: "POST",
        headers: { "Authorization": authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ brand_id: brandId }),
      });
      publish = await pubRes.json();
    } catch (e) {
      publish = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return json({
    ok: results.every((r) => r.status !== "error"),
    brand_id: brandId,
    // El alcance nunca queda implícito en el tamaño de `locations`: se dice
    // explícitamente si fue acotado (y a qué local) o barrido completo.
    scope: requestedLocationId ? "single" : "all",
    requested_location_id: requestedLocationId,
    locations: results,
    publish,
  }, 200);
});
