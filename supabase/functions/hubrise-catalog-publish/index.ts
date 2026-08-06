// supabase/functions/hubrise-catalog-publish/index.ts
//
// PUBLICADOR DE CATÁLOGO · Folvy -> HubRise (T2a, motor núcleo).
// ============================================================================
// Invocado por el USUARIO desde la carta (botón "Publicar"). Publica la carta de
// UNA marca (catalog_source='folvy') a su catálogo HubRise. Construye el payload
// completo a PRECIO BASE: categorías -> products/skus -> option_lists (modificadores)
// -> deals (combos). Variants por plataforma e imágenes son capas posteriores (T2b/T2c).
// T2d: objeto `nutrition` por producto (alérgenos EU -> HubRise + "puede contener"
//   en legal_name). Base legal: Rgto (UE) 1169/2011. Mapeo en _shared/hubriseAllergens.ts.
//
// AUTH: el usuario invoca con su sesión (functions.invoke manda su JWT). La
//   autorización la da RLS: se lee la marca con el cliente del USUARIO; si RLS la
//   deja ver, tiene acceso. El trabajo pesado va con service_role.
//   Deploy SIN --no-verify-jwt (no es webhook; el gateway valida el JWT).
//
// RESOLUCIÓN marca -> catálogo+token (Fase 2): PRIMARIO brand_hubrise_catalog
//   (creado por el asistente "Conectar a delivery" con el token escritor, sin
//   bridge). FALLBACK (compat) external_brand_map (source=hubrise, brand_id)
//   da (external_location_id, external_brand_id=connection_name) cruzado con
//   external_integration (source=hubrise) -> access_token + catálogo (el path
//   de siempre para marcas montadas a mano con bridge, p.ej. Bendito Burrito).
//   Una marca puede tener N catálogos (multi-local); se publica a cada uno.
//
// sku_ref = menu_item.external_id (la MISMA matrícula que usa el 86). Donde falte
//   (marcas nacidas en Folvy), se genera y PERSISTE 'fv_<id>' para que publicar y
//   el 86 coincidan en la ref.
//
// COMBOS -> deals: 1ª línea fixed_price = precio base del combo; resto líneas
//   fixed_price 0.00; cada opción premium lleva extra_charge = price_impact.
//   Total = base + Σ impactos (modelo de Folvy).
//
// Resultado: catalog_publish (pending->done/partial/failed) + catalog_publish_target
//   por conexión (ok/error). Devuelve 200 con {ok,...} también en fallos de negocio
//   (sin conexión, validación) para que el front los muestre; 401/500 solo auth/crash.
// ============================================================================

import { corsHeaders } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveWriterToken } from "../_shared/hubriseToken.ts";
import { hubriseSkuRef } from "../_shared/hubriseSku.ts";
import { buildNutrition, type AllergenRow } from "../_shared/hubriseAllergens.ts";

const HUBRISE_BASE = "https://api.hubrise.com/v1";
const CURRENCY = "EUR";
const UNCAT_REF = "__uncat__";

function eur(n: unknown): string {
  return `${Number(n ?? 0).toFixed(2)} ${CURRENCY}`;
}
function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
// ref estable y persistible para un menu_item sin external_id.
function genRef(id: string): string {
  return "fv_" + id.replace(/-/g, "");
}

// ── T2c: imágenes ───────────────────────────────────────────────────────────
// Cloudinary: insertar una transformación tras /upload/ para cumplir el límite de
// 1 MB de HubRise (y servir webp ligero). Si no es Cloudinary, se sube tal cual.
function cloudinaryResized(url: string): string {
  const marker = "/image/upload/";
  const i = url.indexOf(marker);
  if (i === -1) return url;
  const head = url.slice(0, i + marker.length);
  const tail = url.slice(i + marker.length);
  return `${head}c_limit,w_1200,q_auto,f_auto/${tail}`;
}
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

interface ImgTarget { itemId: string; photoUrl: string }

// Resuelve los image_id de HubRise para un catálogo: reusa los ya subidos (si la
// foto no cambió) o sube los nuevos (POST /catalogs/:id/images) y los persiste en
// catalog_image_map. Devuelve menu_item_id -> image_id (clave por REF/item, no
// por posición: productos y deals son dos arrays distintos, un idx compartido
// entre ambos colisionaría — ver ENCARGO fotos-combos 06/08). Las imágenes son
// POR CATÁLOGO, por eso se resuelve dentro del bucle de conexiones.
async function resolveCatalogImages(
  sb: SupabaseClient, accountId: string, catalogId: string, token: string,
  targets: ImgTarget[], warnings: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (targets.length === 0) return out;

  const itemIds = targets.map((t) => t.itemId);
  const { data: existing } = await sb.from("catalog_image_map")
    .select("menu_item_id, image_id, source_url")
    .eq("account_id", accountId).eq("external_catalog_id", catalogId)
    .in("menu_item_id", itemIds);
  const byItem = new Map<string, { image_id: string; source_url: string }>();
  for (const r of existing ?? []) {
    byItem.set(r.menu_item_id as string, { image_id: r.image_id as string, source_url: r.source_url as string });
  }

  for (const t of targets) {
    const prev = byItem.get(t.itemId);
    if (prev && prev.source_url === t.photoUrl) { out.set(t.itemId, prev.image_id); continue; } // reuso
    try {
      const imgResp = await fetch(cloudinaryResized(t.photoUrl));
      if (!imgResp.ok) { warnings.push(`Foto inaccesible (HTTP ${imgResp.status}), omitida.`); continue; }
      const ctype = imgResp.headers.get("content-type") || "image/jpeg";
      const buf = await imgResp.arrayBuffer();
      if (buf.byteLength > 1_000_000) { warnings.push(`Foto > 1 MB tras redimensionar (${Math.round(buf.byteLength/1024)} KB), omitida.`); continue; }
      const up = await fetch(`${HUBRISE_BASE}/catalogs/${catalogId}/images`, {
        method: "POST", headers: { "X-Access-Token": token, "Content-Type": ctype }, body: buf,
      });
      if (!up.ok) { warnings.push(`Subida de imagen fallida: ${(await up.text()).slice(0, 150)}`); continue; }
      const uj = await up.json();
      const imageId = uj.id as string | undefined;
      if (!imageId) { warnings.push("Subida de imagen sin id devuelto, omitida."); continue; }
      await sb.from("catalog_image_map").upsert({
        account_id: accountId, menu_item_id: t.itemId, external_catalog_id: catalogId,
        image_id: imageId, source_url: t.photoUrl, source_hash: fnv1a(t.photoUrl),
        updated_at: new Date().toISOString(),
      }, { onConflict: "menu_item_id,external_catalog_id" });
      out.set(t.itemId, imageId);
    } catch (e) {
      warnings.push(`Error con una foto: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
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

  let body: { brand_id?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const brandId = body.brand_id;
  if (!brandId) return json({ ok: false, error: "brand_id requerido" }, 400);

  // ── Autorización por RLS: leer la marca con el cliente del USUARIO ─────────
  const { data: brand, error: brErr } = await sbUser
    .from("brand")
    .select("id, account_id, name, catalog_source, slug")
    .eq("id", brandId)
    .maybeSingle();
  if (brErr) return json({ ok: false, error: `acceso a marca: ${brErr.message}` }, 403);
  if (!brand) return json({ ok: false, error: "marca no encontrada o sin acceso" }, 403);
  if ((brand.catalog_source as string) !== "folvy") {
    return json({
      ok: false,
      error: "Esta marca no la gobierna Folvy (catalog_source != 'folvy'): su carta la manda el TPV. No se publica.",
    }, 200);
  }
  const accountId = brand.account_id as string;

  // ── service_role para el trabajo ──────────────────────────────────────────
  const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

  // ── Token ESCRITOR (Fase 1): 1 por cuenta, en Vault. PRIMARIO para resolver
  // conexiones (Fase 2, ver abajo) y para publicar. Sin fallo mudo: si no
  // hay, se avisa y solo queda el path de bridge (transicional).
  const writerToken = await resolveWriterToken(sb, accountId);
  if (!writerToken) {
    console.warn(`hubrise-catalog-publish: sin token escritor para cuenta ${accountId}, fallback a token de bridge (transicional)`);
  }

  // ── Resolver conexiones HubRise de la marca ───────────────────────────────
  // PRIMARIO (Fase 2): brand_hubrise_catalog -- catálogo creado por el
  // asistente "Conectar a delivery" con el token escritor, sin bridge. Solo
  // tiene sentido con token escritor (es el único que puede escribir ahí).
  // FALLBACK (compat): external_brand_map->external_integration -- el path
  // de siempre para marcas montadas a mano con bridge (Bendito Burrito).
  const conns: Array<{ catalogId: string; token: string; connName: string; extLoc: string }> = [];
  const primaryCatalogIds = new Set<string>();

  if (writerToken) {
    const { data: primaryRows } = await sb.from("brand_hubrise_catalog")
      .select("external_catalog_id, external_location_id, hubrise_catalog_name")
      .eq("account_id", accountId).eq("brand_id", brandId);
    for (const r of primaryRows ?? []) {
      if (!r.external_catalog_id || !r.external_location_id) continue;
      conns.push({
        catalogId: r.external_catalog_id as string,
        token: writerToken,
        connName: (r.hubrise_catalog_name as string) ?? "Folvy (autoservicio)",
        extLoc: r.external_location_id as string,
      });
      primaryCatalogIds.add(r.external_catalog_id as string);
    }
  }

  const { data: maps } = await sb.from("external_brand_map")
    .select("external_location_id, external_brand_id, is_ignored")
    .eq("account_id", accountId).eq("source", "hubrise").eq("brand_id", brandId);
  for (const m of maps ?? []) {
    if (m.is_ignored === true) continue;
    const { data: integ } = await sb.from("external_integration")
      .select("access_token, external_catalog_id, connection_name, is_active, push_status_enabled")
      .eq("account_id", accountId).eq("source", "hubrise")
      .eq("external_location_id", m.external_location_id)
      .eq("connection_name", m.external_brand_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!integ || !integ.access_token || !integ.external_catalog_id) continue;
    if (integ.push_status_enabled === false) continue;
    if (primaryCatalogIds.has(integ.external_catalog_id as string)) continue; // ya cubierto por brand_hubrise_catalog
    conns.push({
      catalogId: integ.external_catalog_id as string,
      token: integ.access_token as string,
      connName: (integ.connection_name as string) ?? "",
      extLoc: m.external_location_id as string,
    });
  }
  if (conns.length === 0) {
    return json({
      ok: false,
      error: "La marca no tiene catálogo HubRise (revisa brand_hubrise_catalog / external_brand_map).",
    }, 200);
  }

  // ── Crear el trabajo de publicación ───────────────────────────────────────
  const { data: pub, error: pubErr } = await sb.from("catalog_publish")
    .insert({ account_id: accountId, brand_id: brandId, requested_by: user.id, status: "pending" })
    .select("id").single();
  if (pubErr || !pub) return json({ ok: false, error: `no se pudo registrar la publicación: ${pubErr?.message}` }, 500);
  const publishId = pub.id as string;

  try {
    // ── Cargar la carta (service_role) ──────────────────────────────────────
    const [{ data: cats }, { data: items }] = await Promise.all([
      sb.from("menu_category")
        .select("id, name, emoji, position, parent_id, is_active")
        .eq("account_id", accountId).eq("brand_id", brandId),
      sb.from("menu_item")
        .select("id, name, description, price, product_type, menu_category_id, external_id, is_active, photo_url, stock_group_id, recipe_item_id")
        .eq("account_id", accountId).eq("brand_id", brandId),
    ]);

    // Canales delivery -> variants de HubRise (T2b). shop/takeaway NO se publica
    // (canal directo, lo consume la tienda propia).
    const { data: channels } = await sb.from("sales_channel")
      .select("id, slug, name, channel_type, archived_at, is_active")
      .eq("account_id", accountId);
    const deliveryChannels = (channels ?? []).filter(
      (c) => c.channel_type === "delivery" && !c.archived_at && c.is_active !== false);
    const slugByChannelId = new Map((channels ?? []).map((c) => [c.id as string, c.slug as string]));
    const deliverySlugs = deliveryChannels.map((c) => c.slug as string);

    const activeItems = (items ?? []).filter((i) => i.is_active !== false);

    // external_id donde falte: generar y PERSISTIR (para que publicar y el 86
    // sigan teniendo una matrícula que casar). NO namespaced todavía: eso lo
    // hace hubriseSkuRef justo debajo, misma fuente que availability-dispatch.
    const rawExternalIdById = new Map<string, string>();
    const toPersist: Array<{ id: string; ref: string }> = [];
    for (const it of activeItems) {
      let ref = (it.external_id as string | null) ?? null;
      if (!ref) { ref = genRef(it.id as string); toPersist.push({ id: it.id as string, ref }); }
      rawExternalIdById.set(it.id as string, ref);
    }
    for (const p of toPersist) {
      await sb.from("menu_item").update({ external_id: p.ref, external_source: "folvy" }).eq("id", p.id);
    }

    // Fase B: ref de HubRise namespaced (grupo compartido o {brandSlug}:{external_id}).
    // ÚNICA fuente (_shared/hubriseSku.ts) — la MISMA que usa availability-dispatch.
    const stockGroupIds = Array.from(new Set(
      activeItems.map((i) => i.stock_group_id as string | null).filter((x): x is string => !!x),
    ));
    const groupRefById = new Map<string, string>();
    if (stockGroupIds.length > 0) {
      const { data: groupRows } = await sb.from("stock_group").select("id, hubrise_ref").in("id", stockGroupIds);
      for (const g of groupRows ?? []) groupRefById.set(g.id as string, g.hubrise_ref as string);
    }
    const brandSlug = (brand.slug as string) ?? (brand.id as string);
    const refById = new Map<string, string>();
    for (const it of activeItems) {
      const rawExternalId = rawExternalIdById.get(it.id as string)!;
      const groupRef = it.stock_group_id ? (groupRefById.get(it.stock_group_id as string) ?? null) : null;
      const ref = hubriseSkuRef({ externalId: rawExternalId, brandSlug, stockGroupHubriseRef: groupRef });
      refById.set(it.id as string, ref ?? rawExternalId);
    }

    const products = activeItems.filter((i) => i.product_type !== "combo");
    const combos = activeItems.filter((i) => i.product_type === "combo");
    const productIds = products.map((p) => p.id as string);
    const comboIds = combos.map((c) => c.id as string);
    const warnings: string[] = [];

    // ── T2d: nutrition (alérgenos + "puede contener") por producto ──────────
    // El alérgeno del plato vive en recipe_item_allergen, colgado del
    // menu_item.recipe_item_id (motor de herencia ya aplicado). Publicamos la
    // UNIÓN de fuentes (manual + inherited + ai_enrich): decisión de seguridad
    // (omitir un alérgeno real es peor que sobre-declararlo). 'contains' -> lista
    // de presencia; 'may_contain' -> texto en legal_name; gluten/nuts -> tags
    // allergen_gluten/allergen_nuts que HubRise expande a sus subtipos. NUNCA se
    // emite [] sin conocimiento positivo (para HubRise [] = "no contiene ninguno";
    // omitir = "no informado"). Lógica en _shared/hubriseAllergens.ts.
    const recipeItemIdByProduct = new Map<string, string>();
    for (const p of products) {
      const ri = (p.recipe_item_id as string | null) ?? null;
      if (ri) recipeItemIdByProduct.set(p.id as string, ri);
    }
    const recipeItemIds = Array.from(new Set(recipeItemIdByProduct.values()));
    const allergenRowsByRecipeItem = new Map<string, AllergenRow[]>();
    if (recipeItemIds.length > 0) {
      const { data: allergenRows } = await sb.from("recipe_item_allergen")
        .select("recipe_item_id, allergen_code, state")
        .in("recipe_item_id", recipeItemIds);
      for (const r of allergenRows ?? []) {
        const k = r.recipe_item_id as string;
        (allergenRowsByRecipeItem.get(k) ?? allergenRowsByRecipeItem.set(k, []).get(k)!)
          .push({ allergen_code: r.allergen_code as string, state: r.state as string });
      }
    }
    // menu_item_id -> { nutrition, tags } listo para inyectar en el producto.
    const nutByProductId = new Map<string, { nutrition: Record<string, unknown> | null; tags: string[] }>();
    for (const [productId, ri] of recipeItemIdByProduct.entries()) {
      const rows = allergenRowsByRecipeItem.get(ri) ?? [];
      if (rows.length === 0) continue; // sin dato -> no se declara nada (no informado)
      nutByProductId.set(productId, buildNutrition(rows));
    }

    // Overrides por canal (T2b): precio/disponibilidad propios por canal delivery.
    // Nivel marca/canal (location_id null), que es lo que escribe el editor de precios.
    const { data: overrides } = productIds.length && deliveryChannels.length
      ? await sb.from("menu_item_override")
          .select("menu_item_id, channel_id, price, is_available")
          .eq("account_id", accountId).in("menu_item_id", productIds).is("location_id", null)
      : { data: [] as Array<Record<string, unknown>> };
    const deliverySlugSet = new Set(deliverySlugs);
    const ovByItem = new Map<string, Array<{ slug: string; price: number | null; avail: boolean }>>();
    for (const o of overrides ?? []) {
      const slug = slugByChannelId.get(o.channel_id as string);
      if (!slug || !deliverySlugSet.has(slug)) continue; // solo canales delivery (variants)
      const k = o.menu_item_id as string;
      (ovByItem.get(k) ?? ovByItem.set(k, []).get(k)!).push({
        slug,
        price: o.price === null || o.price === undefined ? null : Number(o.price),
        avail: o.is_available !== false,
      });
    }

    // Modificadores: asignaciones -> grupos -> opciones
    const { data: asg } = productIds.length
      ? await sb.from("modifier_group_assignment")
          .select("menu_item_id, modifier_group_id, position")
          .eq("account_id", accountId).in("menu_item_id", productIds)
      : { data: [] as Array<Record<string, unknown>> };
    const groupIds = Array.from(new Set((asg ?? []).map((a) => a.modifier_group_id as string)));
    const { data: groups } = groupIds.length
      ? await sb.from("modifier_group")
          .select("id, name, min_selections, max_selections, allow_repetition, external_id, is_active")
          .eq("account_id", accountId).in("id", groupIds)
      : { data: [] as Array<Record<string, unknown>> };
    const { data: opts } = groupIds.length
      ? await sb.from("modifier_option")
          .select("id, modifier_group_id, name, price_impact, is_default, external_id, position, is_active")
          .eq("account_id", accountId).in("modifier_group_id", groupIds)
      : { data: [] as Array<Record<string, unknown>> };

    const groupRef = (g: Record<string, unknown>) => (g.external_id as string) ?? ("mg_" + (g.id as string));
    const optRef = (o: Record<string, unknown>) => (o.external_id as string) ?? ("mo_" + (o.id as string));

    const optsByGroup = new Map<string, Array<Record<string, unknown>>>();
    for (const o of (opts ?? []).filter((x) => x.is_active !== false)) {
      const k = o.modifier_group_id as string;
      (optsByGroup.get(k) ?? optsByGroup.set(k, []).get(k)!).push(o);
    }

    // option_lists válidas (>=1 opción). Las vacías se descartan con aviso.
    const optionLists: Array<Record<string, unknown>> = [];
    const validGroupRefs = new Set<string>();
    for (const g of (groups ?? []).filter((x) => x.is_active !== false)) {
      const gOpts = (optsByGroup.get(g.id as string) ?? []).sort(
        (a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
      if (gOpts.length === 0) {
        warnings.push(`Grupo de modificadores "${g.name}" sin opciones: omitido.`);
        continue;
      }
      const ref = groupRef(g);
      validGroupRefs.add(ref);
      optionLists.push({
        ref,
        name: g.name,
        min_selections: Number(g.min_selections ?? 0),
        max_selections: g.max_selections === null || g.max_selections === undefined
          ? null : Number(g.max_selections),
        multiple_selection: g.allow_repetition === true,
        options: gOpts.map((o) => ({
          ref: optRef(o),
          name: o.name,
          price: eur(o.price_impact),
          default: o.is_default === true,
        })),
      });
    }

    // option_list_refs por producto (solo grupos válidos)
    const groupsByItem = new Map<string, string[]>();
    const grpById = new Map((groups ?? []).map((g) => [g.id as string, g]));
    for (const a of (asg ?? []).sort((x, y) => Number(x.position ?? 0) - Number(y.position ?? 0))) {
      const g = grpById.get(a.modifier_group_id as string);
      if (!g) continue;
      const ref = groupRef(g);
      if (!validGroupRefs.has(ref)) continue;
      const k = a.menu_item_id as string;
      (groupsByItem.get(k) ?? groupsByItem.set(k, []).get(k)!).push(ref);
    }

    // Combos: slots + opciones
    const { data: slots } = comboIds.length
      ? await sb.from("combo_slot")
          .select("id, combo_item_id, name, min_selections, max_selections, position, is_active")
          .eq("account_id", accountId).in("combo_item_id", comboIds)
      : { data: [] as Array<Record<string, unknown>> };
    const slotIds = (slots ?? []).filter((s) => s.is_active !== false).map((s) => s.id as string);
    const { data: slotOpts } = slotIds.length
      ? await sb.from("combo_slot_option")
          .select("combo_slot_id, menu_item_id, modifier_group_id, price_impact, position, is_active")
          .eq("account_id", accountId).in("combo_slot_id", slotIds)
      : { data: [] as Array<Record<string, unknown>> };
    const slotOptsBySlot = new Map<string, Array<Record<string, unknown>>>();
    for (const so of (slotOpts ?? []).filter((x) => x.is_active !== false)) {
      const k = so.combo_slot_id as string;
      (slotOptsBySlot.get(k) ?? slotOptsBySlot.set(k, []).get(k)!).push(so);
    }
    const slotsByCombo = new Map<string, Array<Record<string, unknown>>>();
    for (const s of (slots ?? []).filter((x) => x.is_active !== false)) {
      const k = s.combo_item_id as string;
      (slotsByCombo.get(k) ?? slotsByCombo.set(k, []).get(k)!).push(s);
    }

    // ── Construir categorías ────────────────────────────────────────────────
    const catSet = new Set((cats ?? []).filter((c) => c.is_active !== false).map((c) => c.id as string));
    let usesUncat = false;
    const categories: Array<Record<string, unknown>> = (cats ?? [])
      .filter((c) => c.is_active !== false)
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map((c) => {
        const parent = (c.parent_id as string | null) ?? null;
        const row: Record<string, unknown> = { ref: c.id as string, name: c.name };
        if (parent && catSet.has(parent)) row.parent_ref = parent;
        return row;
      });

    const catRefFor = (menuCategoryId: string | null): string => {
      if (menuCategoryId && catSet.has(menuCategoryId)) return menuCategoryId;
      usesUncat = true;
      return UNCAT_REF;
    };

    // ref (HubRise) -> menu_item_id, para inyectar image_ids por REF tras
    // resolver las imágenes (productos y deals son dos arrays distintos: un
    // idx compartido entre ambos colisionaría — ver ENCARGO fotos-combos 06/08).
    const refToItemId = new Map<string, string>();

    // ── Construir products (skus) ───────────────────────────────────────────
    const sortedProducts = products
      .sort((a, b) => Number((a as Record<string, unknown>).position ?? 0) - Number((b as Record<string, unknown>).position ?? 0));
    const productsPayload: Array<Record<string, unknown>> = sortedProducts
      .map((p) => {
        const ref = refById.get(p.id as string)!;
        const olRefs = groupsByItem.get(p.id as string) ?? [];
        const sku: Record<string, unknown> = { ref, price: eur(p.price) };
        if (olRefs.length > 0) sku.option_list_refs = olRefs;
        // T2b: precio por canal (price_overrides) y 86 por canal (restrictions).
        const ovs = ovByItem.get(p.id as string) ?? [];
        const basePrice = Number(p.price ?? 0);
        const priceOverrides: Array<Record<string, unknown>> = [];
        const disabledSlugs: string[] = [];
        for (const ov of ovs) {
          if (ov.price !== null && Math.abs(ov.price - basePrice) > 0.0001) {
            priceOverrides.push({ variant_refs: [ov.slug], price: eur(ov.price) });
          }
          if (!ov.avail) disabledSlugs.push(ov.slug);
        }
        if (priceOverrides.length > 0) sku.price_overrides = priceOverrides;
        if (disabledSlugs.length > 0) {
          // restrictions.variant_refs es LISTA BLANCA (item disponible solo en esos
          // variants). Para 86 de un canal: dejamos los canales delivery NO apagados.
          // Si todos están apagados -> excluido del catálogo (enabled:false).
          const enabled = deliverySlugs.filter((s) => !disabledSlugs.includes(s));
          sku.restrictions = enabled.length === 0 ? { enabled: false } : { variant_refs: enabled };
        }
        const prodRef = "p_" + (p.id as string);
        refToItemId.set(prodRef, p.id as string);
        const prod: Record<string, unknown> = {
          ref: prodRef,
          category_ref: catRefFor((p.menu_category_id as string | null) ?? null),
          name: p.name,
          skus: [sku],
        };
        // T2d: nutrition (alérgenos + "puede contener") y tags de gluten/nuts.
        const nut = nutByProductId.get(p.id as string);
        if (nut) {
          if (nut.nutrition) prod.nutrition = nut.nutrition;
          if (nut.tags.length > 0) prod.tags = nut.tags;
        }
        if (p.description) prod.description = p.description;
        return prod;
      });

    // Productos Y combos con foto (ENCARGO fotos-combos 06/08 — antes solo
    // productos, ningún combo publicaba foto en ninguna de las 9 marcas).
    const imgTargets: ImgTarget[] = [];
    for (const p of sortedProducts) {
      const url = (p.photo_url as string | null) ?? null;
      if (url) imgTargets.push({ itemId: p.id as string, photoUrl: url });
    }
    for (const c of combos) {
      const url = (c.photo_url as string | null) ?? null;
      if (url) imgTargets.push({ itemId: c.id as string, photoUrl: url });
    }

    // ── Construir deals (combos) ────────────────────────────────────────────
    const dealsPayload: Array<Record<string, unknown>> = [];
    for (const c of combos) {
      const cSlots = (slotsByCombo.get(c.id as string) ?? [])
        .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
      const lines: Array<Record<string, unknown>> = [];
      let lineIdx = 0;
      for (const s of cSlots) {
        const sOpts = (slotOptsBySlot.get(s.id as string) ?? [])
          .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
        const skus: Array<Record<string, unknown>> = [];
        for (const so of sOpts) {
          const mid = (so.menu_item_id as string | null) ?? null;
          if (!mid) { warnings.push(`Combo "${c.name}": opción por grupo (no producto) omitida.`); continue; }
          const oref = refById.get(mid);
          if (!oref) { warnings.push(`Combo "${c.name}": opción fuera de la carta de la marca, omitida.`); continue; }
          const sk: Record<string, unknown> = { ref: oref };
          const imp = Number(so.price_impact ?? 0);
          if (imp > 0) sk.extra_charge = eur(imp);
          skus.push(sk);
        }
        if (skus.length === 0) { warnings.push(`Combo "${c.name}": slot "${s.name}" sin opciones válidas, omitido.`); continue; }
        // 1ª línea fija el precio base del combo; el resto a 0 (los extras suman por extra_charge).
        lines.push({
          label: s.name,
          skus,
          pricing_effect: "fixed_price",
          pricing_value: lineIdx === 0 ? eur(c.price) : eur(0),
        });
        lineIdx++;
      }
      if (lines.length === 0) { warnings.push(`Combo "${c.name}" sin líneas válidas: omitido.`); continue; }
      const dealRef = (c.external_id as string) ?? ("dl_" + (c.id as string));
      refToItemId.set(dealRef, c.id as string);
      const deal: Record<string, unknown> = {
        ref: dealRef,
        name: c.name,
        category_ref: catRefFor((c.menu_category_id as string | null) ?? null),
        lines,
      };
      dealsPayload.push(deal);
    }

    if (usesUncat) categories.push({ ref: UNCAT_REF, name: "Sin categoría" });

    if (productsPayload.length === 0 && dealsPayload.length === 0) {
      await sb.from("catalog_publish").update({ status: "failed", note: "carta vacía (sin productos ni combos publicables)" }).eq("id", publishId);
      return json({ ok: false, error: "La carta no tiene productos ni combos publicables.", warnings }, 200);
    }

    const variants = deliveryChannels.map((c) => ({ ref: c.slug as string, name: c.name as string }));

    const catalogData = {
      name: brand.name as string,
      data: {
        ...(variants.length > 0 ? { variants } : {}),
        categories,
        products: productsPayload,
        option_lists: optionLists,
        deals: dealsPayload,
      },
    };

    // ── Targets a publicar ─────────────────────────────────────────────────
    // Con token escritor: 1 target POR CATÁLOGO DISTINTO (dedup — las N
    // conexiones/plataformas de una marca comparten el mismo catálogo en
    // HubRise, así que hoy se hacían N PUT idénticos, con N-1 de más en 403).
    // Sin escritor (fallback transicional): 1 target por conexión, cada uno
    // con su propio token de bridge — comportamiento IDÉNTICO al de siempre.
    interface PublishTargetJob { catalogId: string; token: string; connName: string }
    let publishTargets: PublishTargetJob[];
    if (writerToken) {
      const namesByCatalog = new Map<string, string[]>();
      for (const c of conns) {
        (namesByCatalog.get(c.catalogId) ?? namesByCatalog.set(c.catalogId, []).get(c.catalogId)!).push(c.connName);
      }
      publishTargets = Array.from(namesByCatalog.entries()).map(([catalogId, names]) => ({
        catalogId,
        token: writerToken,
        connName: names.filter(Boolean).join(" + "),
      }));
    } else {
      publishTargets = conns.map((c) => ({ catalogId: c.catalogId, token: c.token, connName: c.connName }));
    }

    // ── Publicar (PUT reemplaza el catálogo) ──────────────────────────────────
    // Las imágenes son POR CATÁLOGO: se resuelven (reuso/subida) una vez por
    // target y se inyectan en productos Y deals antes del PUT, por REF (via
    // refToItemId) — no por posición, productos y deals son arrays distintos.
    let okCount = 0, errCount = 0, imagesTotal = 0;
    for (const t of publishTargets) {
      let targetStatus = "ok", errorText: string | null = null;
      try {
        const imgMap = await resolveCatalogImages(sb, accountId, t.catalogId, t.token, imgTargets, warnings);
        if (imgMap.size > imagesTotal) imagesTotal = imgMap.size;
        const injectImage = (o: Record<string, unknown>): Record<string, unknown> => {
          const itemId = refToItemId.get(o.ref as string);
          const imageId = itemId ? imgMap.get(itemId) : undefined;
          return imageId ? { ...o, image_ids: [imageId] } : o;
        };
        const productsForConn = productsPayload.map(injectImage);
        const dealsForConn = dealsPayload.map(injectImage);
        const catalogDataForConn = {
          ...catalogData,
          data: { ...catalogData.data, products: productsForConn, deals: dealsForConn },
        };
        const res = await fetch(`${HUBRISE_BASE}/catalogs/${t.catalogId}`, {
          method: "PUT",
          headers: { "X-Access-Token": t.token, "Content-Type": "application/json" },
          body: JSON.stringify(catalogDataForConn),
        });
        if (!res.ok) { targetStatus = "error"; errorText = (await res.text()).slice(0, 400); errCount++; }
        else okCount++;
      } catch (e) {
        targetStatus = "error"; errorText = e instanceof Error ? e.message : String(e); errCount++;
      }
      await sb.from("catalog_publish_target").insert({
        publish_id: publishId,
        external_catalog_id: t.catalogId,
        connection_name: t.connName,
        status: targetStatus,
        error_text: errorText,
        published_at: targetStatus === "ok" ? new Date().toISOString() : null,
      });
    }

    const finalStatus = errCount === 0 ? "done" : (okCount === 0 ? "failed" : "partial");
    const note = warnings.length ? `${warnings.length} aviso(s): ${warnings.slice(0, 6).join(" · ")}` : null;
    await sb.from("catalog_publish").update({ status: finalStatus, note }).eq("id", publishId);

    // Estado por conexión para el front
    const { data: targets } = await sb.from("catalog_publish_target")
      .select("connection_name, external_catalog_id, status, error_text")
      .eq("publish_id", publishId);

    const priceOverridesApplied = productsPayload.reduce((acc, p) => {
      const skus = (p.skus as Array<Record<string, unknown>>) ?? [];
      return acc + skus.reduce((a, s) => a + (((s.price_overrides as unknown[] | undefined)?.length) ?? 0), 0);
    }, 0);

    // T2d: cuántos productos salieron con declaración de alérgenos (nutrition o tag).
    const nutritionApplied = productsPayload.filter((p) => p.nutrition || p.tags).length;

    return json({
      ok: errCount === 0,
      publish_id: publishId,
      status: finalStatus,
      products: productsPayload.length,
      deals: dealsPayload.length,
      option_lists: optionLists.length,
      variants: variants.length,
      price_overrides: priceOverridesApplied,
      nutrition: nutritionApplied,
      images: imagesTotal,
      warnings,
      targets: targets ?? [],
    }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("catalog_publish").update({ status: "failed", note: msg.slice(0, 300) }).eq("id", publishId);
    return json({ ok: false, error: msg, publish_id: publishId }, 500);
  }
});
