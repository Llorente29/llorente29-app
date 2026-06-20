// supabase/functions/lastapp-catalog-import/index.ts
//
// Importa el CATÁLOGO COMERCIAL de Last.app hacia las tablas de catálogo de
// marca de Folvy (Fase A). Trae solo lo que está EN USO (filtra la basura de
// Last.app: marcas sin catálogo, canal "informes", objetos huérfanos).
//
// ALCANCE v1 (deuda explícita, no oculta):
//   - Trae el catálogo CANÓNICO (brand.catalogs.default) de cada marca.
//   - NO crea recipe_items: menu_item.recipe_item_id = NULL. El escandallo lo
//     hace el cocinero después (enlaza/crea el recipe_item en ese momento).
//   - NO crea recipe_lines, NO costes, NO modifier_recipe_impact.
//   - Las VARIANTES POR CANAL (p.ej. el catálogo Glovo distinto de Scandal/
//     Bendito) son Fase B (menu_item_override) — tramo separado.
//   - Idempotente por external_id (soporta re-ejecución). En v1 inserta lo nuevo
//     y conserva lo existente; el diff/actualización es el frente "sync viva".
//
// Entrada (POST JSON): { account_id, lastapp_organization_id, dry_run? }
// Auth: platform admin (JWT folvy.is_platform_admin) o x-internal-key.
// Patrón calcado de lastapp-sync-catalog.

import { corsHeaders } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const LASTAPP_BASE = "https://api.last.app/v2";

// Canales que NO son de venta real (reporting interno). Reservado para Fase B
// (variantes por canal); en v1 solo importamos el catálogo "default".
const EXCLUDED_CHANNELS = new Set(["informes"]);
void EXCLUDED_CHANNELS;

interface FolvyClaims {
  is_platform_admin?: boolean;
  full_name?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeFolvyClaims(jwt: string): FolvyClaims {
  try {
    const payload = jwt.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(json);
    return (parsed.folvy ?? {}) as FolvyClaims;
  } catch {
    return {};
  }
}

// Normalización para casar nombres de marca Last.app <-> Folvy.
function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\.$/, "")
    .replace(/\s+/g, " ");
}

// Alias de marca: desajustes conocidos de nombre Last.app -> Folvy.
// Clave y valor en forma NORMALIZADA. (Deuda futura: brand.lastapp_brand_name
// para resolución determinista por id, en vez de por nombre.)
const BRAND_ALIAS: Record<string, string> = {
  "dirty burgers": "dirty burger", // Last (plural) -> Folvy (singular)
};

// Marcas DESCARTADAS a propósito: existen en Last pero NO se importan a Folvy
// ni se reportan como "sin resolver". Clave en forma NORMALIZADA.
//   - "foodint": es la "marca" que Last usa para la VENTA DIRECTA / tienda online
//     (shop: domicilio propio, takeaway, local, sin Glovo/Uber). Hoy solo tiene
//     pruebas, sin ventas reales. El cliente abandonará Last en breve y Folvy
//     tendrá su PROPIA shop de venta directa (canal 'shop', no una marca). Por eso
//     no se importa como marca: la venta directa es un CANAL transversal a las
//     marcas, no una marca en sí.
const DISCARDED_BRANDS: Set<string> = new Set(["foodint"]);

// Infiere el tipo de grupo de modificadores por su nombre (heurística).
function inferGroupType(name: string): string {
  const n = normalize(name);
  if (/\b(extra|anade|anadir|add|topping|adicional)\b/.test(n)) return "extras";
  if (/\b(sin|quitar|quita|remove|no\s)\b/.test(n)) return "removal";
  if (/\b(postre|bebida|drink|dessert|acompan|side|complemento)\b/.test(n)) return "cross_sell";
  if (/\b(punto|coccion|hecho|temperatura|nota|note)\b/.test(n)) return "info";
  // base / elige / escoge / selecciona + por defecto -> choice
  return "choice";
}

async function lastGet(
  path: string,
  token: string,
  entityHeader: Record<string, string>,
): Promise<any> {
  const res = await fetch(`${LASTAPP_BASE}${path}`, {
    headers: { "Authorization": `Bearer ${token}`, ...entityHeader },
  });
  if (!res.ok) {
    throw new Error(`Last.app ${path} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// ── Upsert idempotente por external_id ───────────────────────────────
// Devuelve un Map external_id -> folvy id (incluye preexistentes y nuevos).
// v1: inserta los que faltan, conserva los existentes (no actualiza campos).
async function upsertByExternalId(
  sb: SupabaseClient,
  table: string,
  accountId: string,
  rows: Array<Record<string, unknown> & { external_id: string }>,
  dryRun: boolean,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (rows.length === 0) return map;

  const extIds = [...new Set(rows.map((r) => r.external_id))];

  // 1) Preexistentes
  const { data: existing, error: selErr } = await sb
    .from(table)
    .select("id, external_id")
    .eq("account_id", accountId)
    .eq("external_source", "lastapp")
    .in("external_id", extIds);
  if (selErr) throw new Error(`select ${table}: ${selErr.message}`);
  for (const e of existing ?? []) map.set(e.external_id as string, e.id as string);

  // 2) Nuevos (los que no estaban)
  const seen = new Set<string>();
  const newRows = rows.filter((r) => {
    if (map.has(r.external_id) || seen.has(r.external_id)) return false;
    seen.add(r.external_id);
    return true;
  });

  if (newRows.length === 0) return map;

  // En dry_run NO escribimos, pero generamos ids sintéticos para que los pasos
  // hijos (opciones, slots, assignments) puedan contar correctamente.
  if (dryRun) {
    for (const r of newRows) map.set(r.external_id, `dry-${r.external_id}`);
    return map;
  }

  const { data: inserted, error: insErr } = await sb
    .from(table)
    .insert(newRows)
    .select("id, external_id");
  if (insErr) throw new Error(`insert ${table}: ${insErr.message}`);
  for (const i of inserted ?? []) map.set(i.external_id as string, i.id as string);

  return map;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // ── Auth dual ──
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalSecret = Deno.env.get("LASTAPP_INTERNAL_KEY") ?? "";
  const internalKey = req.headers.get("x-internal-key");
  const isInternal = internalSecret !== "" && internalKey === internalSecret;
  if (!isInternal) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);
    const claims = decodeFolvyClaims(authHeader.slice(7));
    if (claims.is_platform_admin !== true) {
      return jsonResponse({ error: "Forbidden: platform admin required" }, 403);
    }
  }

  // ── Body ──
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
  const accountId = body.account_id;
  const orgId = body.lastapp_organization_id;
  const dryRun = body.dry_run === true;
  if (!accountId || !orgId) {
    return jsonResponse({ error: "account_id and lastapp_organization_id required" }, 400);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  // ── Token de la integración ──
  const { data: integ, error: integErr } = await sb
    .from("external_integration")
    .select("token_secret_name")
    .eq("account_id", accountId)
    .eq("source", "lastapp")
    .eq("external_org_id", orgId)
    .single();
  if (integErr || !integ) return jsonResponse({ error: "Integration not found" }, 404);
  const token = Deno.env.get(integ.token_secret_name) ?? "";
  if (!token) return jsonResponse({ error: `Secret ${integ.token_secret_name} not set` }, 500);

  // ── Marcas de Folvy (resolución por nombre normalizado) ──
  const { data: folvyBrands, error: brErr } = await sb
    .from("brand").select("id, name").eq("account_id", accountId);
  if (brErr) return jsonResponse({ error: `brands: ${brErr.message}` }, 500);
  const brandByNorm = new Map<string, string>();
  for (const b of folvyBrands ?? []) brandByNorm.set(normalize(b.name), b.id as string);

  const report: any = {
    dry_run: dryRun,
    brands_in_use: [] as string[],
    brands_skipped_empty: [] as string[],
    brands_unresolved: [] as string[],
    brands_discarded: [] as string[],   // marcas descartadas a propósito (DISCARDED_BRANDS)
    categories: 0, products: 0, combos: 0,
    modifier_groups: 0, modifier_options: 0, assignments: 0,
    combo_slots: 0, combo_slot_options: 0,
    warnings: [] as string[],
  };

  try {
    // ════════════════ FASE 1: marca → catálogo canónico (default) ════════════════
    const locResp = await lastGet(`/locations?organizationId=${orgId}`, token, { "organizationID": orgId });
    const locations: any[] = Array.isArray(locResp) ? locResp : (locResp?.value ?? []);

    // brandByCatalog: catalogId -> nombre marca Last;  catalogLocation: catalogId -> locId
    const brandByCatalog = new Map<string, string>();
    const catalogLocation = new Map<string, string>();
    const canonicalCatalogs = new Set<string>();
    // Presencia de catálogo por marca (across locations): una marca está "en uso"
    // si tiene catálogo default no vacío en AL MENOS una location.
    const brandHasCatalog = new Map<string, boolean>();

    for (const loc of locations) {
      const detail = await lastGet(`/locations/${loc.id}`, token, { "LocationID": loc.id });
      for (const b of (detail?.brands ?? [])) {
        const brandName: string = b?.name ?? "";
        if (!brandName) continue;
        const cats = b?.catalogs ?? {};
        const def = typeof cats.default === "string" ? cats.default : "";
        if (!def) {
          // No marcar vacía aún: puede tener catálogo en otra location.
          if (!brandHasCatalog.has(brandName)) brandHasCatalog.set(brandName, false);
          continue;
        }
        brandHasCatalog.set(brandName, true);
        if (!canonicalCatalogs.has(def)) {
          canonicalCatalogs.add(def);
          brandByCatalog.set(def, brandName);
          catalogLocation.set(def, loc.id);
        }
      }
    }

    // Marcas vacías en TODAS las locations (deduplicado).
    report.brands_skipped_empty = [...brandHasCatalog.entries()]
      .filter(([, has]) => !has)
      .map(([name]) => name);

    // ════════════════ FASE 2: productos/combos EN USO por catálogo ════════════════
    // inUseProducts: orgProductId -> { brandName, catExtId, catName }
    // inUseCombos:   orgComboId   -> { brandName }
    // categoriesByBrand: clave brandNorm -> Map<catExtId, {name}>
    const inUseProducts = new Map<string, { brandName: string; catExtId: string | null; catName: string | null }>();
    const inUseCombos = new Map<string, { brandName: string }>();
    const categoryRows = new Map<string, { name: string; brandName: string }>(); // catExtId -> ...

    for (const catId of canonicalCatalogs) {
      const brandName = brandByCatalog.get(catId) ?? "";
      let catalog: any;
      try {
        catalog = await lastGet(`/catalogs/${catId}`, token, { "locationID": catalogLocation.get(catId) ?? "" });
      } catch (e) {
        report.warnings.push(`catalog ${catId} (${brandName}): ${String(e)}`);
        continue;
      }
      for (const cat of (catalog?.categories ?? [])) {
        const catExtId: string = cat?.id ?? "";
        const catName: string = cat?.name ?? "";
        if (catExtId && !categoryRows.has(catExtId)) {
          categoryRows.set(catExtId, { name: catName, brandName });
        }
        for (const p of (cat?.products ?? [])) {
          const type = (p?.type ?? "PRODUCT").toUpperCase();
          if (type === "COMBO") {
            const comboId = p?.organizationComboId ?? p?.organizationProductId ?? null;
            if (comboId && !inUseCombos.has(comboId)) inUseCombos.set(comboId, { brandName });
          } else {
            const prodId = p?.organizationProductId ?? null;
            if (prodId && !inUseProducts.has(prodId)) {
              inUseProducts.set(prodId, { brandName, catExtId: catExtId || null, catName: catName || null });
            }
          }
        }
      }
    }

    // ════════════════ FASE 3: catálogo rico de la organización ════════════════
    const orgCat = await lastGet(`/organizations/${orgId}/catalog`, token, { "organizationID": orgId });
    const orgProducts: any[] = orgCat?.products ?? [];
    const orgModifierGroups: any[] = orgCat?.modifierGroups ?? [];
    const orgModifiers: any[] = orgCat?.modifiers ?? [];
    const orgCombos: any[] = orgCat?.combos ?? [];

    const orgProductById = new Map<string, any>();
    for (const p of orgProducts) orgProductById.set(p.id, p);
    const orgGroupById = new Map<string, any>();
    for (const g of orgModifierGroups) orgGroupById.set(g.id, g);
    const orgModifierById = new Map<string, any>();
    for (const m of orgModifiers) orgModifierById.set(m.id, m);
    const orgComboById = new Map<string, any>();
    for (const c of orgCombos) orgComboById.set(c.id, c);

    // ════════════════ FASE 4: filtrar a "en uso" + cascada ════════════════

    // 4.0 Productos componente de COMBO también están "en uso" (aunque no se
    // vendan sueltos). Los añadimos con la marca del combo que los referencia,
    // para que los slots de combo queden completos (deuda 0).
    for (const [comboId, comboInfo] of inUseCombos) {
      const oc = orgComboById.get(comboId);
      if (!oc) continue;
      for (const cat of (oc.categories ?? [])) {
        for (const p of (cat.products ?? [])) {
          const pid = p?.productId;
          if (pid && !inUseProducts.has(pid) && orgProductById.has(pid)) {
            inUseProducts.set(pid, { brandName: comboInfo.brandName, catExtId: null, catName: null });
          }
        }
      }
    }

    // Grupos en uso = los asignados a productos en uso (org product.modifierGroups)
    const inUseGroupIds = new Set<string>();
    for (const prodId of inUseProducts.keys()) {
      const op = orgProductById.get(prodId);
      for (const gid of (op?.modifierGroups ?? [])) inUseGroupIds.add(gid);
    }

    // ════════════════ FASE 5: resolver marca + construir filas + upsert ════════════════

    // Helper: resuelve brand_id Folvy desde nombre Last; registra unresolved.
    const resolveBrand = (brandName: string): string | null => {
      const norm = normalize(brandName);
      // Marca descartada a propósito (p.ej. FOODINT = venta directa): ni se importa
      // ni se reporta como "sin resolver". Se registra aparte (informativo).
      if (DISCARDED_BRANDS.has(norm)) {
        if (!report.brands_discarded.includes(brandName)) report.brands_discarded.push(brandName);
        return null;
      }
      const aliased = BRAND_ALIAS[norm] ?? norm; // aplica alias conocido si existe
      const id = brandByNorm.get(aliased);
      if (!id) {
        if (!report.brands_unresolved.includes(brandName)) report.brands_unresolved.push(brandName);
      }
      return id ?? null;
    };

    // 5.1 menu_category
    const catRows: Array<any> = [];
    for (const [catExtId, info] of categoryRows) {
      const brandId = resolveBrand(info.brandName);
      if (!brandId) continue;
      catRows.push({
        account_id: accountId, brand_id: brandId, name: info.name || "(sin nombre)",
        external_source: "lastapp", external_id: catExtId,
      });
    }
    const catMap = await upsertByExternalId(sb, "menu_category", accountId, catRows, dryRun);
    report.categories = catRows.length;

    // 5.2 menu_item (productos)
    const itemRows: Array<any> = [];
    for (const [prodId, info] of inUseProducts) {
      const brandId = resolveBrand(info.brandName);
      if (!brandId) continue;
      const op = orgProductById.get(prodId);
      const name = op?.name ?? "(producto)";
      const priceCents = typeof op?.price === "number" ? op.price : 0;
      const catFolvyId = info.catExtId ? (catMap.get(info.catExtId) ?? null) : null;
      itemRows.push({
        account_id: accountId, brand_id: brandId, channel_id: null, recipe_item_id: null,
        name, price: priceCents / 100, product_type: "item",
        menu_category_id: catFolvyId,
        is_active: true,                       // está en la carta (estructural)
        is_available: op?.enabled !== false,   // agotado (enabled=false) -> no disponible, pero entra
        source: "import",
        external_source: "lastapp", external_id: prodId,
      });
    }
    // 5.3 menu_item (combos)
    for (const [comboId, info] of inUseCombos) {
      const brandId = resolveBrand(info.brandName);
      if (!brandId) continue;
      const oc = orgComboById.get(comboId);
      const name = oc?.name ?? "(combo)";
      const priceCents = typeof oc?.price === "number" ? oc.price : 0;
      itemRows.push({
        account_id: accountId, brand_id: brandId, channel_id: null, recipe_item_id: null,
        name, price: priceCents / 100, product_type: "combo",
        menu_category_id: null,
        is_active: true,
        is_available: oc?.enabled !== false,
        source: "import",
        external_source: "lastapp", external_id: comboId,
      });
    }
    const itemMap = await upsertByExternalId(sb, "menu_item", accountId, itemRows, dryRun);
    report.products = itemRows.filter((r) => r.product_type === "item").length;
    report.combos = itemRows.filter((r) => r.product_type === "combo").length;

    // 5.4 modifier_group
    const groupRows: Array<any> = [];
    const groupBrand = new Map<string, string>(); // groupExtId -> brandName (1ª marca que lo usa)
    for (const prodId of inUseProducts.keys()) {
      const op = orgProductById.get(prodId);
      const bn = inUseProducts.get(prodId)!.brandName;
      for (const gid of (op?.modifierGroups ?? [])) {
        if (!groupBrand.has(gid)) groupBrand.set(gid, bn);
      }
    }
    for (const gid of inUseGroupIds) {
      const g = orgGroupById.get(gid);
      if (!g) continue;
      const brandId = resolveBrand(groupBrand.get(gid) ?? "");
      if (!brandId) continue;
      groupRows.push({
        account_id: accountId, brand_id: brandId,
        name: g.name ?? "(grupo)",
        min_selections: typeof g.min === "number" ? g.min : 0,
        max_selections: typeof g.max === "number" ? g.max : 1,
        group_type: inferGroupType(g.name ?? ""),
        external_source: "lastapp", external_id: gid,
      });
    }
    const groupMap = await upsertByExternalId(sb, "modifier_group", accountId, groupRows, dryRun);
    report.modifier_groups = groupRows.length;

    // 5.5 modifier_option (de organizationModifiers: priceOverride manda)
    const optionRows: Array<any> = [];
    for (const gid of inUseGroupIds) {
      const g = orgGroupById.get(gid);
      const groupFolvyId = groupMap.get(gid);
      if (!g || !groupFolvyId) continue;
      let pos = 0;
      for (const om of (g.organizationModifiers ?? [])) {
        const mod = orgModifierById.get(om.modifierId);
        const optName = mod?.name ?? "(opción)";
        const priceImpact = typeof om.priceOverride === "number"
          ? om.priceOverride / 100
          : (typeof mod?.priceImpact === "number" ? mod.priceImpact / 100 : 0);
        optionRows.push({
          account_id: accountId, modifier_group_id: groupFolvyId,
          name: optName, price_impact: priceImpact, recipe_item_id: null,
          position: pos++,
          external_source: "lastapp", external_id: om.id, // id del organizationModifier (único en el grupo)
        });
      }
    }
    const optionMap = await upsertByExternalId(sb, "modifier_option", accountId, optionRows, dryRun);
    report.modifier_options = optionRows.length;

    // 5.6 modifier_group_assignment (producto -> grupo)
    const assignRows: Array<any> = [];
    for (const [prodId] of inUseProducts) {
      const menuItemId = itemMap.get(prodId);
      if (!menuItemId) continue;
      const op = orgProductById.get(prodId);
      let pos = 0;
      for (const gid of (op?.modifierGroups ?? [])) {
        const groupFolvyId = groupMap.get(gid);
        if (!groupFolvyId) continue;
        assignRows.push({
          account_id: accountId, modifier_group_id: groupFolvyId,
          menu_item_id: menuItemId, position: pos++,
        });
      }
    }
    // Insert con tolerancia al duplicado (UNIQUE group+item) — ignora conflictos.
    if (!dryRun && assignRows.length > 0) {
      const { error: aErr } = await sb
        .from("modifier_group_assignment")
        .upsert(assignRows, { onConflict: "modifier_group_id,menu_item_id", ignoreDuplicates: true });
      if (aErr) report.warnings.push(`assignments: ${aErr.message}`);
    }
    report.assignments = assignRows.length;

    // 5.7 combo_slot + 5.8 combo_slot_option
    const slotRows: Array<any> = [];
    for (const [comboId] of inUseCombos) {
      const comboFolvyId = itemMap.get(comboId);
      const oc = orgComboById.get(comboId);
      if (!comboFolvyId || !oc) continue;
      let spos = 0;
      for (const cat of (oc.categories ?? [])) {
        slotRows.push({
          account_id: accountId, combo_item_id: comboFolvyId,
          name: cat.name ?? "(slot)",
          min_selections: typeof cat.min === "number" ? cat.min : 1,
          max_selections: typeof cat.max === "number" ? cat.max : 1,
          position: spos++,
          external_source: "lastapp", external_id: cat.id,
        });
      }
    }
    const slotMap = await upsertByExternalId(sb, "combo_slot", accountId, slotRows, dryRun);
    report.combo_slots = slotRows.length;

    const slotOptRows: Array<any> = [];
    for (const [comboId] of inUseCombos) {
      const oc = orgComboById.get(comboId);
      if (!oc) continue;
      for (const cat of (oc.categories ?? [])) {
        const slotFolvyId = slotMap.get(cat.id);
        if (!slotFolvyId) continue;
        let opos = 0;
        for (const p of (cat.products ?? [])) {
          const menuItemId = itemMap.get(p.productId);
          if (!menuItemId) {
            report.warnings.push(`combo slot "${cat.name}": producto ${p.productId} no está en uso, opción omitida`);
            continue;
          }
          slotOptRows.push({
            account_id: accountId, combo_slot_id: slotFolvyId,
            menu_item_id: menuItemId, modifier_group_id: null,
            price_impact: typeof p.priceImpact === "number" ? p.priceImpact / 100 : 0,
            position: opos++,
            external_source: "lastapp", external_id: p.id, // id de la categoría-producto (único)
          });
        }
      }
    }
    const slotOptMap = await upsertByExternalId(sb, "combo_slot_option", accountId, slotOptRows, dryRun);
    report.combo_slot_options = slotOptRows.length;

    // Resumen de marcas en uso RESUELTAS (excluye las no resueltas, ya listadas aparte).
    report.brands_in_use = [...new Set([...inUseProducts.values()].map((v) => v.brandName))]
      .filter((bn) => !report.brands_unresolved.includes(bn));

    return jsonResponse({ ok: true, ...report });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e), partial: report }, 500);
  }
});
