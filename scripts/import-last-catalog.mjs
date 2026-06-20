#!/usr/bin/env node
// scripts/import-last-catalog.mjs
//
// Importador COMPLETO del catálogo de Last.app → Folvy, genérico por cuenta y org.
// Trae: categorías (emoji + orden), productos (nombre, descripción, foto, precio
// base, categoría, IVA), precios por canal (menu_item_override), modificadores
// (grupos + opciones + asignaciones) y combos (slots + opciones).
//
// PRINCIPIOS (regla de oro del proyecto):
//   · DRY-RUN POR DEFECTO. No escribe nada sin --run. El dry-run imprime QUÉ
//     traería y QUÉ cambiaría (crear/actualizar), nunca "Success".
//   · account_id en CADA operación (aislamiento multi-tenant estricto).
//   · Idempotente: casa por (account_id, external_source='lastapp', external_id).
//     NUEVO → inserta todo. EXISTENTE → SOLO rellena campos vacíos (foto, descripción,
//     categoría, emoji…); NO pisa lo que el cliente tocó a mano (nombre/precio/etc.).
//   · Casado por MATRÍCULA: catalogProduct.organizationProductId ↔
//     menu_item.external_id (external_source='lastapp'). NO rompe el casado de ventas.
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... LASTAPP_TOKEN=... \
//   node scripts/import-last-catalog.mjs \
//     --account <uuid> --org <uuid> [--brand "<nombre>"] [--catalog-overrides <file.json>] [--run]
//
//   --account  cuenta Folvy (obligatorio)
//   --org      organizationID de Last (obligatorio)
//   --brand    limita a UNA marca (para validar por fases; p.ej. "Meraki Pita")
//   --catalog-overrides  JSON { "<nombreMarcaLast>": "<catalogId>" } para forzar el
//              catálogo BASE de una marca cuando la heurística no acierte
//   --run      aplica de verdad (sin él = dry-run)
//
// El token NO se hardcodea: sale de env LASTAPP_TOKEN. Si el token no ve la org
// pedida en GET /organizations, el script PARA y lo dice (cedidas = otra credencial).

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// CLI + env
// ============================================================
function parseArgs(argv) {
  const out = { run: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run") { out.run = true; continue; }
    if (a === "--debug") { out.debug = true; continue; }
    else if (a === "--account") out.account = argv[++i];
    else if (a === "--org") out.org = argv[++i];
    else if (a === "--brand") out.brand = argv[++i];
    else if (a === "--catalog-overrides") out.overridesFile = argv[++i];
    else { console.error(`Argumento desconocido: ${a}`); process.exit(2); }
  }
  return out;
}
function usage(msg) {
  console.error(msg);
  console.error('Uso: node scripts/import-last-catalog.mjs --account <uuid> --org <uuid> [--brand "<nombre>"] [--catalog-overrides <file.json>] [--run]');
  process.exit(2);
}
const args = parseArgs(process.argv);
if (!args.account) usage("Falta --account");
if (!args.org) usage("Falta --org");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LASTAPP_TOKEN = process.env.LASTAPP_TOKEN;
if (!SUPABASE_URL) { console.error("ERROR: falta env SUPABASE_URL"); process.exit(2); }
if (!SUPABASE_SERVICE_ROLE_KEY) { console.error("ERROR: falta env SUPABASE_SERVICE_ROLE_KEY"); process.exit(2); }
if (!LASTAPP_TOKEN) { console.error("ERROR: falta env LASTAPP_TOKEN"); process.exit(2); }

const DRY = !args.run;
const DEBUG = args.debug === true;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let catalogOverrides = {}; // { nombreMarcaLast(normalizado): catalogId }
if (args.overridesFile) {
  try {
    const raw = JSON.parse(readFileSync(args.overridesFile, "utf8"));
    for (const [k, v] of Object.entries(raw)) catalogOverrides[normalize(k)] = v;
  } catch (e) { usage(`No se pudo leer --catalog-overrides: ${String(e.message ?? e)}`); }
}

// ============================================================
// Helpers comunes
// ============================================================
const LASTAPP_BASE = "https://api.last.app/v2";
const RATE_LIMIT_MS = 450;          // ~2.2 req/s (cap Last 1500/10min)
const RATE_LIMIT_RETRY_WAIT_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalize(s) {
  if (!s) return "";
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim().replace(/\.$/, "").replace(/\s+/g, " ");
}

// Clave compuesta marca+matrícula. Una matrícula (organizationProductId) compartida
// entre marcas (bebidas, postres, …) NO debe colisionar: cada marca tiene su propio
// menu_item apuntando al mismo producto físico. Por eso se keyea por (marca, matrícula).
function pkey(brandName, matricula) { return `${normalize(brandName)} ${matricula}`; }

// Separa el emoji inicial del nombre de categoría: "🥗 GOURMET PITA BOWLS" →
// { emoji: "🥗", name: "GOURMET PITA BOWLS" }. Sin emoji → { emoji: null, name }.
function splitEmoji(raw) {
  const s = (raw ?? "").trim();
  if (!s) return { emoji: null, name: "" };
  // Empareja 1+ caracteres de símbolo/emoji al principio (incluye ZWJ, variation selectors).
  const m = s.match(/^([\p{Extended_Pictographic}‍️⃣]+)\s*(.*)$/u);
  // Si hay emoji inicial, va a la columna y el name queda SIN él (aunque el resto
  // sea vacío → categoría "solo emoji": name "" → el caller pone "(sin nombre)").
  if (m) return { emoji: m[1].trim(), name: m[2].trim() };
  return { emoji: null, name: s };
}

// Alias y descartes (calcados de la edge lastapp-catalog-import, modelo probado).
const BRAND_ALIAS = { "dirty burgers": "dirty burger" };
const DISCARDED_BRANDS = new Set(["foodint"]);

function inferGroupType(name) {
  const n = normalize(name);
  if (/\b(extra|anade|anadir|add|topping|adicional)\b/.test(n)) return "extras";
  if (/\b(sin|quitar|quita|remove|no\s)\b/.test(n)) return "removal";
  if (/\b(postre|bebida|drink|dessert|acompan|side|complemento)\b/.test(n)) return "cross_sell";
  if (/\b(punto|coccion|hecho|temperatura|nota|note)\b/.test(n)) return "info";
  return "choice";
}

// Canal Last (clave del objeto brand.catalogs) → slug Folvy de sales_channel.
function channelKeyToSlug(key) {
  const k = (key ?? "").toLowerCase();
  if (k === "default" || k === "informes") return null; // base / reporting, no es override
  if (k.includes("glovo")) return "glovo";
  if (k.includes("uber")) return "uber";
  if (k.includes("justeat") || k.includes("just_eat") || k.includes("just eat")) return "justeat";
  if (k.includes("shop") || k.includes("local") || k.includes("onsite") || k.includes("domicilio") || k.includes("takeaway")) return "shop";
  return null;
}

async function lastGet(path, entityHeader = {}) {
  for (let attempt = 1; attempt <= RATE_LIMIT_MAX_ATTEMPTS; attempt++) {
    await sleep(RATE_LIMIT_MS);
    const res = await fetch(`${LASTAPP_BASE}${path}`, {
      headers: { "Authorization": `Bearer ${LASTAPP_TOKEN}`, ...entityHeader },
    });
    if (res.status === 429 && attempt < RATE_LIMIT_MAX_ATTEMPTS) {
      console.log(`⏳ 429, espero 60s (intento ${attempt}/${RATE_LIMIT_MAX_ATTEMPTS})…`);
      await sleep(RATE_LIMIT_RETRY_WAIT_MS); continue;
    }
    if (!res.ok) throw new Error(`Last ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error(`Last ${path}: agotados ${RATE_LIMIT_MAX_ATTEMPTS} intentos`);
}

async function loadAllPaged(table, select, eqColumn, eqValue) {
  const pageSize = 1000; const out = []; let offset = 0;
  while (true) {
    const { data, error } = await sb.from(table).select(select).eq(eqColumn, eqValue)
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

// ============================================================
// Idempotencia: existentes por (account, external_source, external_id)
//   - mapExisting: external_id -> fila existente (con los campos que se enriquecen)
//   - inserta los nuevos; en EXISTENTES, solo rellena campos vacíos (patch)
// ============================================================
async function loadExisting(table, selectCols) {
  const rows = await loadAllPaged(table, selectCols, "account_id", args.account);
  const byExt = new Map();
  for (const r of rows) {
    if (r.external_source === "lastapp" && r.external_id) byExt.set(r.external_id, r);
  }
  return byExt;
}

// Variante para menu_item: clave (brand_id, external_id). Una matrícula compartida
// entre marcas tiene un menu_item por marca → no se puede keyear por external_id solo.
async function loadExistingByBrandExt(table, selectCols) {
  const rows = await loadAllPaged(table, selectCols, "account_id", args.account);
  const byKey = new Map();
  for (const r of rows) {
    if (r.external_source === "lastapp" && r.external_id) byKey.set(`${r.brand_id} ${r.external_id}`, r);
  }
  return byKey;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log(`Importador catálogo Last → Folvy  ${DRY ? "(DRY-RUN)" : "(RUN — ESCRIBE)"}`);
  console.log(`  account: ${args.account}`);
  console.log(`  org:     ${args.org}`);
  if (args.brand) console.log(`  brand:   ${args.brand} (solo esta marca)`);
  console.log("");

  // ── PASO 0: orgs accesibles con el token ─────────────────────────────────
  console.log("── PASO 0: orgs accesibles con el token (GET /organizations) ──");
  let orgs = [];
  try {
    const r = await lastGet(`/organizations`);
    orgs = Array.isArray(r) ? r : (r?.value ?? []);
  } catch (e) {
    console.error(`No se pudo leer /organizations: ${String(e.message ?? e)}`);
    process.exit(1);
  }
  for (const o of orgs) console.log(`   · ${o.id}  ${o.name ?? ""}`);
  const CLOUDTOWN = "b7bc4753-575c-42e1-bf97-ed61443f639b";
  console.log(`   ¿ve Cloudtown (${CLOUDTOWN})? ${orgs.some(o => o.id === CLOUDTOWN) ? "SÍ" : "NO"}`);
  if (!orgs.some((o) => o.id === args.org)) {
    console.error(`\n⛔ El token NO ve la org pedida (${args.org}). Para las cedidas haría falta otra credencial. PARO (decisión de Julio).`);
    process.exit(1);
  }
  console.log("");

  // ── Cargas Folvy (marcas, canales) ───────────────────────────────────────
  const folvyBrands = await loadAllPaged("brand", "id, name, is_active", "account_id", args.account);
  const brandByNorm = new Map();
  for (const b of folvyBrands) {
    if (b.is_active === false) continue;
    const k = normalize(b.name); if (k && !brandByNorm.has(k)) brandByNorm.set(k, b.id);
  }
  const channels = await loadAllPaged("sales_channel", "id, slug, is_active", "account_id", args.account);
  const channelIdBySlug = new Map();
  for (const c of channels) { if (c.is_active !== false && c.slug) channelIdBySlug.set(c.slug.toLowerCase(), c.id); }

  const report = {
    brands: [], unresolved: new Set(), discarded: new Set(),
    cat_new: 0, cat_update: 0, prod_new: 0, prod_update: 0, combo_new: 0, combo_update: 0,
    group_new: 0, option_new: 0, assign_new: 0, slot_new: 0, slot_opt_new: 0,
    overrides_new: 0, only_in_last: [], warnings: [],
  };
  const resolveBrand = (brandName) => {
    const norm = normalize(brandName);
    if (DISCARDED_BRANDS.has(norm)) { report.discarded.add(brandName); return null; }
    const id = brandByNorm.get(BRAND_ALIAS[norm] ?? norm);
    if (!id) report.unresolved.add(brandName);
    return id ?? null;
  };

  // ── PASO 1: catálogos por marca (base + por canal) ───────────────────────
  // brand.catalogs de /locations/{id} mapea claves de canal → catalogId.
  console.log("── PASO 1: catálogos por marca (GET /locations + /catalogs) ──");
  const locResp = await lastGet(`/locations?organizationId=${args.org}`, { "organizationID": args.org });
  const locations = Array.isArray(locResp) ? locResp : (locResp?.value ?? []);

  // Recorre TODAS las locations de la org (no solo la primera) y construye:
  //   · catalogMeta:     catId -> { name, destinos }  (de GET /catalogs?locationId)
  //   · catalogLocation: catId -> locId REAL donde vive (clave del 404: cada
  //                      catálogo se pide a SU location, no a una por marca).
  //   · brandCatalogs:   brandName -> { channelKey -> catId }
  //   · brandLoc:        brandName -> locId (respaldo)
  const catalogMeta = new Map();
  const catalogLocation = new Map();
  const brandCatalogs = new Map();
  const brandLoc = new Map();
  for (const loc of locations) {
    // Lista de catálogos de ESTA location (nombre/destinos para el informe).
    try {
      const cl = await lastGet(`/catalogs?locationId=${loc.id}`, { "organizationID": args.org, "locationID": loc.id });
      for (const c of (Array.isArray(cl) ? cl : (cl?.value ?? []))) {
        if (c?.id && !catalogMeta.has(c.id)) catalogMeta.set(c.id, {
          name: c.name ?? c.title ?? "",
          destinos: c.destinations ?? c.destinos ?? c.destination ?? null,
        });
        // Si la lista trae locationId por catálogo, también sirve de fuente.
        if (c?.id && !catalogLocation.has(c.id)) catalogLocation.set(c.id, c.locationId ?? c.location_id ?? loc.id);
      }
    } catch (e) { report.warnings.push(`GET /catalogs (loc ${loc.id}): ${String(e.message ?? e)}`); }

    const detail = await lastGet(`/locations/${loc.id}`, { "LocationID": loc.id });
    for (const b of (detail?.brands ?? [])) {
      const brandName = b?.name ?? ""; if (!brandName) continue;
      if (args.brand && normalize(brandName) !== normalize(args.brand)) continue;
      if (!brandCatalogs.has(brandName)) { brandCatalogs.set(brandName, {}); brandLoc.set(brandName, loc.id); }
      const map = brandCatalogs.get(brandName);
      // b.catalogs puede ser objeto {default, glovo,...} o anidado; aplanar a clave->catId.
      // Cada catId se ASOCIA a la location donde aparece (esto arregla el 404).
      const flatten = (obj, prefix = "") => {
        if (!obj) return;
        if (typeof obj === "string") {
          if (prefix) { map[prefix] = obj; if (!catalogLocation.has(obj)) catalogLocation.set(obj, loc.id); }
          return;
        }
        if (typeof obj === "object") for (const [k, v] of Object.entries(obj)) flatten(v, prefix || k);
      };
      flatten(b?.catalogs ?? {});
    }
  }

  // Elegir el catálogo BASE de cada marca (heurística + override manual).
  // Heurística: override explícito > clave 'default' > más destinos > más productos.
  // (En dry-run se LISTAN todos para que Julio confirme; NO se adivina en silencio.)
  function pickBaseCatalog(brandName, catMap) {
    const norm = normalize(brandName);
    if (catalogOverrides[norm]) return catalogOverrides[norm];
    if (catMap.default) return catMap.default;
    // si no hay 'default', el de más destinos entre los conocidos (meta), excluyendo promos
    const candidates = [...new Set(Object.values(catMap))]
      .filter((id) => !/promo|new|^\s*\d+\s*$|test/i.test(catalogMeta.get(id)?.name ?? ""));
    candidates.sort((a, b) => {
      const da = (catalogMeta.get(a)?.destinos?.length ?? 0), db = (catalogMeta.get(b)?.destinos?.length ?? 0);
      return db - da;
    });
    return candidates[0] ?? Object.values(catMap)[0] ?? null;
  }

  // ── PASO 2: catálogo rico de la org (detalle de productos/modificadores/combos)
  const orgCat = await lastGet(`/organizations/${args.org}/catalog`, { "organizationID": args.org });
  const orgProductById = new Map((orgCat?.products ?? []).map((p) => [p.id, p]));
  // Índice por MATRÍCULA (organizationProductId) — la clave con la que casan
  // inUseProducts y menu_item.external_id. (El bug de "0 productos" venía de cruzar
  // por p.id en vez de por matrícula.)
  const orgProductByMatricula = new Map();
  for (const p of (orgCat?.products ?? [])) {
    const mid = p?.organizationProductId ?? p?.organization_product_id;
    if (mid) orgProductByMatricula.set(mid, p);
  }
  const orgGroupById = new Map((orgCat?.modifierGroups ?? []).map((g) => [g.id, g]));
  const orgModifierById = new Map((orgCat?.modifiers ?? []).map((m) => [m.id, m]));
  const orgComboById = new Map((orgCat?.combos ?? []).map((c) => [c.id, c]));
  // Índice de combos por MATRÍCULA (organizationComboId), para resolver el combo
  // del catálogo base (que trae matrícula, no el id del org catalog).
  const orgComboByMatricula = new Map();
  for (const c of (orgCat?.combos ?? [])) {
    const mid = c?.organizationComboId ?? c?.organization_combo_id ?? c?.organizationProductId;
    if (mid) orgComboByMatricula.set(mid, c);
  }

  // Estructuras a construir
  const categoryRows = new Map();   // catExtId -> { name, emoji, position, brandName }
  const inUseProducts = new Map();  // "marca|matrícula" -> { brandName, matricula, catExtId, position, raw }
  const inUseCombos = new Map();    // "marca|matrícula" -> { brandName, matricula, catExtId, position, raw }
  // overrides: "marca|matrícula" -> { slug -> priceCents }
  const channelPrices = new Map();

  console.log("");
  // Recorre cada marca: lista catálogos, elige base, lee categorías/productos.
  let debugPrinted = false;
  for (const [brandName, catMap] of brandCatalogs) {
    const baseCat = pickBaseCatalog(brandName, catMap);
    // Dedup por catalogId: un catálogo único multi-canal aparece UNA vez con sus
    // claves de canal (Meraki = 1 catálogo para todos los destinos).
    const catById = new Map();
    for (const [k, id] of Object.entries(catMap)) {
      if (!catById.has(id)) catById.set(id, { id, keys: [], name: catalogMeta.get(id)?.name ?? "", destinos: catalogMeta.get(id)?.destinos ?? null, loc: catalogLocation.get(id) ?? null });
      catById.get(id).keys.push(k);
    }
    const brandInfo = {
      brand: brandName, resolved: !!resolveBrand(brandName),
      catalogs: [...catById.values()],
      base_catalog: baseCat, base_products: 0,
    };
    report.brands.push(brandInfo);
    if (!baseCat) { report.warnings.push(`${brandName}: sin catálogo base`); continue; }

    // Detalle del catálogo base: se pide a SU location real (arregla el 404).
    const baseLoc = catalogLocation.get(baseCat) ?? brandLoc.get(brandName) ?? "";
    let catalog;
    try { catalog = await lastGet(`/catalogs/${baseCat}`, { "locationID": baseLoc }); }
    catch (e) { report.warnings.push(`catálogo base ${baseCat} (${brandName}, loc ${baseLoc}): ${String(e.message ?? e)}`); continue; }

    if (DEBUG && !debugPrinted) {
      debugPrinted = true;
      console.log(`\n── DEBUG ${brandName} · catálogo base ${baseCat} · locationID usado: ${baseLoc} ──`);
      console.log(`ÁRBOL categories[] de /catalogs/{id} (membresía REAL producto→categoría):`);
      for (const cat of (catalog?.categories ?? [])) {
        const items = cat?.products ?? [];
        console.log(`  ▸ "${cat?.name ?? ""}"  (catId=${cat?.id})  [${items.length} items]`);
        for (const p of items) {
          const mat = p?.organizationProductId ?? p?.organizationComboId ?? p?.organization_product_id ?? "?";
          console.log(`       - ${(p?.type ?? "PRODUCT")}  matrícula=${mat}  "${p?.name ?? ""}"`);
        }
      }
      console.log("── 2 productos crudos completos de /catalogs/{id} (campos reales):");
      console.log(JSON.stringify((catalog?.categories ?? []).flatMap((c) => c?.products ?? []).slice(0, 2), null, 2));
      console.log("── org catalog product[0..1] (SOLO respaldo de datos; NO se usa para categoría):");
      console.log(JSON.stringify((orgCat?.products ?? []).slice(0, 2), null, 2));
      console.log("── org modifierGroup[0..1]:");
      console.log(JSON.stringify((orgCat?.modifierGroups ?? []).slice(0, 2), null, 2));
      console.log("──────────\n");
    }

    let catPos = 0;
    for (const cat of (catalog?.categories ?? [])) {
      const catExtId = cat?.id; if (!catExtId) continue;
      if (!categoryRows.has(catExtId)) {
        const { emoji, name } = splitEmoji(cat?.name);
        categoryRows.set(catExtId, { name: name || "(sin nombre)", emoji, position: catPos, brandName });
      }
      catPos++;
      let prodPos = 0;
      for (const p of (cat?.products ?? [])) {
        const type = (p?.type ?? "PRODUCT").toUpperCase();
        if (type === "COMBO") {
          const comboId = p?.organizationComboId ?? p?.organizationProductId ?? null;
          // Clave marca+matrícula (igual que los productos): un combo compartido no colisiona.
          if (comboId) {
            const key = pkey(brandName, comboId);
            if (!inUseCombos.has(key)) inUseCombos.set(key, { brandName, matricula: comboId, catExtId, position: prodPos, raw: p });
          }
        } else {
          const prodId = p?.organizationProductId ?? p?.organization_product_id ?? null;
          if (prodId) {
            // Clave marca+matrícula: el MISMO producto físico en varias marcas crea
            // un menu_item por marca (Coca Cola en Big Mike's Y en Dos Coyotes).
            const key = pkey(brandName, prodId);
            if (!inUseProducts.has(key)) {
              inUseProducts.set(key, { brandName, matricula: prodId, catExtId, position: prodPos, raw: p });
              brandInfo.base_products++;
            }
          }
        }
        prodPos++;
      }
    }

    // Precios por canal: para cada catálogo de canal real, leer precios por matrícula.
    for (const [key, catId] of Object.entries(catMap)) {
      const slug = channelKeyToSlug(key);
      if (!slug || catId === baseCat) continue;
      const chanLoc = catalogLocation.get(catId) ?? brandLoc.get(brandName) ?? "";
      let chanCat;
      try { chanCat = await lastGet(`/catalogs/${catId}`, { "locationID": chanLoc }); }
      catch (e) { report.warnings.push(`catálogo canal ${catId} (${brandName}/${slug}, loc ${chanLoc}): ${String(e.message ?? e)}`); continue; }
      for (const cat of (chanCat?.categories ?? [])) {
        for (const p of (cat?.products ?? [])) {
          const prodId = p?.organizationProductId; if (!prodId) continue;
          const priceCents = typeof p?.price === "number" ? p.price : null;
          if (priceCents == null) continue;
          const key = pkey(brandName, prodId);
          if (!channelPrices.has(key)) channelPrices.set(key, {});
          channelPrices.get(key)[slug] = priceCents;
        }
      }
    }
  }

  // (ELIMINADO 20/06) El antiguo "paso de componentes de combo" inyectaba aquí
  // productos sacados del ORG catalog (oc.categories[].products[].productId) con
  // catExtId=null → menu_items SIN categoría, keyed por id del org (no matrícula →
  // external_id incorrecto) y CRUZANDO marcas (el org combo referencia productos de
  // otras marcas). Era la causa de "sin categoría" + "por Chivuos en Dos Coyotes".
  // Los productos reales ya entran por la membresía del catálogo base (con su
  // categoría y su matrícula). Los internos de combo se resuelven en los slots
  // (combo_slot_option); si un componente no existe como producto del base, el slot
  // lo marca como aviso, en vez de contaminar la carta. (La resolución de slots por
  // id-space org↔matrícula se afina con el --debug, paso siguiente.)

  // ── PASO 3: existentes en Folvy (para diff idempotente) ──────────────────
  const exCat = await loadExisting("menu_category", "id, external_id, external_source, name, emoji, position");
  const exItem = await loadExistingByBrandExt("menu_item", "id, external_id, external_source, name, photo_url, description, menu_category_id, price, vat_rate, recipe_item_id, brand_id");
  const exGroup = await loadExisting("modifier_group", "id, external_id, external_source");
  const exOption = await loadExisting("modifier_option", "id, external_id, external_source");
  const exSlot = await loadExisting("combo_slot", "id, external_id, external_source");
  const exSlotOpt = await loadExisting("combo_slot_option", "id, external_id, external_source");

  // ── PASO 4: construir filas + escribir (o contar en dry-run) ─────────────
  // 4.1 menu_category (con emoji/position)
  const catMapFolvy = new Map(); // catExtId -> folvy id
  for (const [catExtId, info] of categoryRows) {
    const brandId = resolveBrand(info.brandName); if (!brandId) continue;
    const existing = exCat.get(catExtId);
    if (existing) {
      catMapFolvy.set(catExtId, existing.id);
      const patch = {};
      // Auto-sana el doble emoji: si el name guardado aún trae el emoji delante
      // (filas viejas de la edge: name="🥗 GOURMET", emoji=null), se separa →
      // emoji a su columna y name SIN el emoji. Regla: emoji → columna; texto → name.
      const split = splitEmoji(existing.name);
      if (split.emoji) {
        if ((existing.emoji ?? null) === null) patch.emoji = split.emoji;
        if (split.name && split.name !== existing.name) patch.name = split.name;
      } else if ((existing.emoji ?? null) === null && info.emoji) {
        patch.emoji = info.emoji;
      }
      if (Object.keys(patch).length) {
        report.cat_update++;
        if (!DRY) { const { error } = await sb.from("menu_category").update(patch).eq("id", existing.id).eq("account_id", args.account); if (error) report.warnings.push(`update cat ${catExtId}: ${error.message}`); }
      }
    } else {
      report.cat_new++;
      const row = {
        account_id: args.account, brand_id: brandId, name: info.name,
        emoji: info.emoji, position: info.position, is_active: true,
        external_source: "lastapp", external_id: catExtId,
      };
      if (!DRY) {
        const { data, error } = await sb.from("menu_category").insert(row).select("id").single();
        if (error) { report.warnings.push(`menu_category ${catExtId}: ${error.message}`); }
        else catMapFolvy.set(catExtId, data.id);
      } else catMapFolvy.set(catExtId, `dry-${catExtId}`);
    }
  }

  // 4.2 menu_item (productos) — base channel_id NULL, con foto/desc/categoría/IVA
  const itemMapFolvy = new Map(); // orgProductId/comboId -> folvy menu_item id
  for (const [key, info] of inUseProducts) {
    const brandId = resolveBrand(info.brandName); if (!brandId) continue;
    const mat = info.matricula;
    // Fuente rica = el producto crudo del catálogo (info.raw); respaldo: org catalog
    // por matrícula. (Antes cruzaba por p.id y salía undefined → 0 enriquecidos.)
    const op = info.raw ?? orgProductByMatricula.get(mat) ?? {};
    const name = op.name ?? "(producto)";
    const priceCents = typeof op.price === "number" ? op.price : 0;
    const photo = op.imageUrl ?? op.image_url ?? op.photoUrl ?? op.photo ?? null;
    const desc = op.description ?? null;
    const vat = typeof op.vatPercentage === "number" ? op.vatPercentage
      : (typeof op.vat === "number" ? op.vat : null);
    // CATEGORÍA: SIEMPRE de la membresía del catálogo base (info.catExtId, de
    // /catalogs/{id}). NUNCA del 'course' del org catalog (genérico + cruza marcas).
    const catFolvyId = info.catExtId ? (catMapFolvy.get(info.catExtId) ?? null) : null;
    // EXISTENTE por (marca, matrícula): una matrícula compartida tiene un menu_item
    // por marca; antes se buscaba por matrícula sola → encontraba el de otra marca y
    // no creaba el de esta (bug Coca Cola/Fanta solo en Big Mike's).
    const existing = exItem.get(`${brandId} ${mat}`);
    if (existing) {
      itemMapFolvy.set(key, existing.id);
      const patch = {};
      if ((existing.photo_url ?? null) === null && photo) patch.photo_url = photo;
      if ((existing.description ?? null) === null && desc) patch.description = desc;
      if ((existing.menu_category_id ?? null) === null && catFolvyId && !String(catFolvyId).startsWith("dry-")) patch.menu_category_id = catFolvyId;
      if (Object.keys(patch).length) {
        report.prod_update++;
        if (!DRY) { const { error } = await sb.from("menu_item").update(patch).eq("id", existing.id).eq("account_id", args.account); if (error) report.warnings.push(`update item ${mat}@${info.brandName}: ${error.message}`); }
      }
    } else {
      report.prod_new++;
      const row = {
        account_id: args.account, brand_id: brandId, channel_id: null, recipe_item_id: null,
        name, price: priceCents / 100, product_type: "item",
        menu_category_id: (catFolvyId && !String(catFolvyId).startsWith("dry-")) ? catFolvyId : null,
        position: info.position ?? 0,
        photo_url: photo, description: desc,
        ...(vat != null ? { vat_rate: vat } : {}),
        is_active: true, is_available: op?.enabled !== false,
        source: "import", needs_review: true,
        external_source: "lastapp", external_id: mat,
      };
      if (!DRY) {
        const { data, error } = await sb.from("menu_item").insert(row).select("id").single();
        if (error) { report.warnings.push(`menu_item ${mat}@${info.brandName}: ${error.message}`); }
        else itemMapFolvy.set(key, data.id);
      } else itemMapFolvy.set(key, `dry-${key}`);
    }
  }
  // 4.3 menu_item (combos) — CON su categoría del catálogo (igual que los productos)
  for (const [key, info] of inUseCombos) {
    const brandId = resolveBrand(info.brandName); if (!brandId) continue;
    const mat = info.matricula;
    // Fuente rica = el combo crudo del catálogo (info.raw); respaldo: org catalog.
    const oc = info.raw ?? orgComboById.get(mat) ?? {};
    // CATEGORÍA: SIEMPRE de la membresía del catálogo base (info.catExtId, de
    // /catalogs/{id}). NUNCA del 'course' del org catalog (genérico + cruza marcas).
    const catFolvyId = info.catExtId ? (catMapFolvy.get(info.catExtId) ?? null) : null;
    const cleanCat = (catFolvyId && !String(catFolvyId).startsWith("dry-")) ? catFolvyId : null;
    const photo = oc.imageUrl ?? oc.image_url ?? oc.photoUrl ?? oc.photo ?? null;
    const desc = oc.description ?? null;
    const existing = exItem.get(`${brandId} ${mat}`);
    if (existing) {
      itemMapFolvy.set(key, existing.id);
      // Enriquecer solo lo vacío (incluida la categoría, que faltaba).
      const patch = {};
      if ((existing.menu_category_id ?? null) === null && cleanCat) patch.menu_category_id = cleanCat;
      if ((existing.photo_url ?? null) === null && photo) patch.photo_url = photo;
      if ((existing.description ?? null) === null && desc) patch.description = desc;
      if (Object.keys(patch).length) {
        report.combo_update++;
        if (!DRY) { const { error } = await sb.from("menu_item").update(patch).eq("id", existing.id).eq("account_id", args.account); if (error) report.warnings.push(`update combo ${mat}@${info.brandName}: ${error.message}`); }
      }
      continue;
    }
    report.combo_new++;
    const row = {
      account_id: args.account, brand_id: brandId, channel_id: null, recipe_item_id: null,
      name: oc.name ?? "(combo)", price: (typeof oc.price === "number" ? oc.price : 0) / 100,
      product_type: "combo", menu_category_id: cleanCat, position: info.position ?? 0,
      photo_url: photo, description: desc,
      is_active: true, is_available: oc.enabled !== false, source: "import", needs_review: true,
      external_source: "lastapp", external_id: mat,
    };
    if (!DRY) {
      const { data, error } = await sb.from("menu_item").insert(row).select("id").single();
      if (error) report.warnings.push(`combo ${mat}@${info.brandName}: ${error.message}`); else itemMapFolvy.set(key, data.id);
    } else itemMapFolvy.set(key, `dry-${key}`);
  }

  // 4.4 menu_item_override (precio por canal que difiera del base) — solo NUEVOS
  for (const [key, perChannel] of channelPrices) {
    const menuItemId = itemMapFolvy.get(key); if (!menuItemId) continue;
    const baseRaw = inUseProducts.get(key)?.raw;
    const baseCents = typeof baseRaw?.price === "number" ? baseRaw.price : null;
    for (const [slug, cents] of Object.entries(perChannel)) {
      if (baseCents != null && cents === baseCents) continue; // igual al base, no override
      const channelId = channelIdBySlug.get(slug); if (!channelId) continue;
      // ¿ya existe override (menu_item, canal, sin local)? (idempotente)
      let exists = false;
      if (!DRY && !String(menuItemId).startsWith("dry-")) {
        const { data } = await sb.from("menu_item_override").select("id")
          .eq("account_id", args.account).eq("menu_item_id", menuItemId)
          .eq("channel_id", channelId).is("location_id", null).limit(1).maybeSingle();
        exists = !!data;
      }
      if (exists) continue;
      report.overrides_new++;
      if (!DRY && !String(menuItemId).startsWith("dry-")) {
        const { error } = await sb.from("menu_item_override").insert({
          account_id: args.account, menu_item_id: menuItemId, channel_id: channelId,
          location_id: null, price: cents / 100,
        });
        if (error) report.warnings.push(`override ${key}/${slug}: ${error.message}`);
      }
    }
  }

  // 4.5 modifier_group / 4.6 option / 4.7 assignment (solo nuevos; calcado de la edge)
  // Ids de grupos de modificadores de un producto, tolerante a la forma real
  // (info.raw del catálogo, respaldo org por matrícula; ids string u objetos {id}).
  const modGroupIdsOf = (info) => {
    const src = info?.raw ?? orgProductByMatricula.get(info?.matricula);
    return (src?.modifierGroups ?? [])
      .map((g) => (typeof g === "string" ? g : (g?.id ?? g?.modifierGroupId)))
      .filter(Boolean);
  };
  const inUseGroupIds = new Set();
  const groupBrand = new Map();
  for (const [, info] of inUseProducts) {
    for (const gid of modGroupIdsOf(info)) { inUseGroupIds.add(gid); if (!groupBrand.has(gid)) groupBrand.set(gid, info.brandName); }
  }
  const groupMapFolvy = new Map();
  for (const gid of inUseGroupIds) {
    const g = orgGroupById.get(gid); if (!g) continue;
    const existing = exGroup.get(gid);
    if (existing) { groupMapFolvy.set(gid, existing.id); continue; }
    const brandId = resolveBrand(groupBrand.get(gid) ?? ""); if (!brandId) continue;
    report.group_new++;
    const row = {
      account_id: args.account, brand_id: brandId, name: g.name ?? "(grupo)",
      min_selections: typeof g.min === "number" ? g.min : 0,
      max_selections: typeof g.max === "number" ? g.max : 1,
      group_type: inferGroupType(g.name ?? ""),
      external_source: "lastapp", external_id: gid,
    };
    if (!DRY) { const { data, error } = await sb.from("modifier_group").insert(row).select("id").single(); if (error) report.warnings.push(`group ${gid}: ${error.message}`); else groupMapFolvy.set(gid, data.id); }
    else groupMapFolvy.set(gid, `dry-${gid}`);
  }
  for (const gid of inUseGroupIds) {
    const g = orgGroupById.get(gid); const groupFolvyId = groupMapFolvy.get(gid);
    if (!g || !groupFolvyId) continue;
    let pos = 0;
    for (const om of (g.organizationModifiers ?? [])) {
      const mod = orgModifierById.get(om.modifierId);
      if (exOption.get(om.id)) { pos++; continue; }
      report.option_new++;
      const price = typeof om.priceOverride === "number" ? om.priceOverride / 100
        : (typeof mod?.priceImpact === "number" ? mod.priceImpact / 100 : 0);
      const row = {
        account_id: args.account, modifier_group_id: String(groupFolvyId).startsWith("dry-") ? null : groupFolvyId,
        name: mod?.name ?? "(opción)", price_impact: price, recipe_item_id: null, position: pos++,
        external_source: "lastapp", external_id: om.id,
      };
      if (!DRY && row.modifier_group_id) { const { error } = await sb.from("modifier_option").insert(row); if (error) report.warnings.push(`option ${om.id}: ${error.message}`); }
    }
  }
  // assignments (UNIQUE group+item; ignora duplicados)
  const assignRows = [];
  for (const [key, info] of inUseProducts) {
    const menuItemId = itemMapFolvy.get(key); if (!menuItemId || String(menuItemId).startsWith("dry-")) continue;
    let pos = 0;
    for (const gid of modGroupIdsOf(info)) {
      const groupFolvyId = groupMapFolvy.get(gid); if (!groupFolvyId || String(groupFolvyId).startsWith("dry-")) continue;
      assignRows.push({ account_id: args.account, modifier_group_id: groupFolvyId, menu_item_id: menuItemId, position: pos++ });
    }
  }
  report.assign_new = assignRows.length;
  if (!DRY && assignRows.length) {
    const { error } = await sb.from("modifier_group_assignment").upsert(assignRows, { onConflict: "modifier_group_id,menu_item_id", ignoreDuplicates: true });
    if (error) report.warnings.push(`assignments: ${error.message}`);
  }

  // 4.8 combo_slot + 4.9 combo_slot_option (calcado de la edge)
  const slotMapFolvy = new Map();
  for (const [key, info] of inUseCombos) {
    const comboFolvyId = itemMapFolvy.get(key);
    const oc = orgComboByMatricula.get(info.matricula) ?? orgComboById.get(info.matricula);
    if (!comboFolvyId || String(comboFolvyId).startsWith("dry-") || !oc) continue;
    let spos = 0;
    for (const cat of (oc.categories ?? [])) {
      if (exSlot.get(cat.id)) { spos++; continue; }
      report.slot_new++;
      const row = {
        account_id: args.account, combo_item_id: comboFolvyId, name: cat.name ?? "(slot)",
        min_selections: typeof cat.min === "number" ? cat.min : 1,
        max_selections: typeof cat.max === "number" ? cat.max : 1,
        position: spos++, external_source: "lastapp", external_id: cat.id,
      };
      if (!DRY) { const { data, error } = await sb.from("combo_slot").insert(row).select("id").single(); if (error) report.warnings.push(`slot ${cat.id}: ${error.message}`); else slotMapFolvy.set(cat.id, data.id); }
      else slotMapFolvy.set(cat.id, `dry-${cat.id}`);
    }
  }
  let comboDebugPrinted = false;
  for (const [, info] of inUseCombos) {
    const oc = orgComboByMatricula.get(info.matricula) ?? orgComboById.get(info.matricula);
    if (DEBUG && !comboDebugPrinted) {
      comboDebugPrinted = true;
      console.log(`\n── DEBUG COMBO ${info.brandName} · "${info.raw?.name ?? oc?.name ?? ""}" · matrícula ${info.matricula} ──`);
      console.log("info.raw (combo del catálogo BASE /catalogs/{id}) COMPLETO:");
      console.log(JSON.stringify(info.raw ?? null, null, 2));
      console.log("oc (combo del ORG catalog) — categories[]:");
      console.log(JSON.stringify(oc?.categories ?? oc ?? null, null, 2));
      console.log("Resolución por componente (recorriendo oc.categories[].products[]):");
      for (const cat of (oc?.categories ?? [])) {
        for (const p of (cat?.products ?? [])) {
          const viaOrg = orgProductById.get(p.productId);
          const directMat = p.organizationProductId ?? p.organization_product_id ?? null;
          const orgMat = viaOrg?.organizationProductId ?? viaOrg?.organization_product_id ?? null;
          console.log(`  · slot "${cat?.name}" comp crudo: ${JSON.stringify(p)}`);
          console.log(`      orgProductById.has(productId=${p.productId}) = ${orgProductById.has(p.productId)} ; matrícula vía org = ${orgMat ?? "∅"} ; matrícula DIRECTA = ${directMat ?? "∅"}`);
          console.log(`      itemMapFolvy(directa) = ${directMat ? (itemMapFolvy.get(pkey(info.brandName, directMat)) ?? "∅") : "∅"} ; itemMapFolvy(víaOrg) = ${orgMat ? (itemMapFolvy.get(pkey(info.brandName, orgMat)) ?? "∅") : "∅"}`);
        }
      }
      console.log("──────────\n");
    }
    if (!oc) continue;
    for (const cat of (oc.categories ?? [])) {
      const slotFolvyId = slotMapFolvy.get(cat.id) ?? exSlot.get(cat.id)?.id; if (!slotFolvyId || String(slotFolvyId).startsWith("dry-")) continue;
      let opos = 0;
      for (const p of (cat.products ?? [])) {
        // En oc.categories[].products[], p.productId YA ES la matrícula
        // (organizationProductId) — coincide con menu_item.external_id del catálogo base.
        // NO se convierte vía orgProductById (su objeto no trae ese campo → ∅ → 0 opciones).
        const compMat = p.productId ?? p.organizationProductId ?? p.organization_product_id ?? null;
        const menuItemId = compMat ? itemMapFolvy.get(pkey(info.brandName, compMat)) : undefined;
        if (!menuItemId || String(menuItemId).startsWith("dry-")) { report.warnings.push(`combo slot "${cat.name}" (${info.brandName}): componente ${compMat ?? p.id} no está en la carta de la marca`); continue; }
        if (exSlotOpt.get(p.id)) { opos++; continue; }
        report.slot_opt_new++;
        const row = {
          account_id: args.account, combo_slot_id: slotFolvyId, menu_item_id: menuItemId, modifier_group_id: null,
          price_impact: typeof p.priceImpact === "number" ? p.priceImpact / 100 : 0, position: opos++,
          external_source: "lastapp", external_id: p.id,
        };
        if (!DRY) { const { error } = await sb.from("combo_slot_option").insert(row); if (error) report.warnings.push(`slot_opt ${p.id}: ${error.message}`); }
      }
    }
  }

  // Discrepancias: matrículas en Folvy (external) que NO vienen en este catálogo =
  // posible descatalogado. ACOTADO a las marcas procesadas (si no, cuenta las otras
  // marcas de la cuenta como ruido).
  const processedBrandIds = new Set();
  for (const b of report.brands) {
    const id = brandByNorm.get(BRAND_ALIAS[normalize(b.brand)] ?? normalize(b.brand));
    if (id) processedBrandIds.add(id);
  }
  // Claves presentes en este catálogo, en el mismo esquema que exItem (brand_id|matrícula).
  const presentKeys = new Set();
  for (const [, info] of inUseProducts) { const bId = resolveBrand(info.brandName); if (bId) presentKeys.add(`${bId} ${info.matricula}`); }
  for (const [, info] of inUseCombos) { const bId = resolveBrand(info.brandName); if (bId) presentKeys.add(`${bId} ${info.matricula}`); }
  for (const [exKey, row] of exItem) {
    if (!processedBrandIds.has(row.brand_id)) continue;
    if (!presentKeys.has(exKey)) report.only_in_last.push({ id: row.id, name: row.name, external_id: row.external_id });
  }

  // ── INFORME ──────────────────────────────────────────────────────────────
  console.log("══════════════ INFORME ══════════════");
  console.log("Catálogos por marca (elige BASE; confirma antes de --run):");
  for (const b of report.brands) {
    console.log(`\n  ▸ ${b.brand}  ${b.resolved ? "" : "⚠ NO resuelve en Folvy"}`);
    for (const c of b.catalogs) {
      const mark = c.id === b.base_catalog ? "  ★ BASE" : "";
      const dest = Array.isArray(c.destinos) ? c.destinos.join("/") : (c.destinos ?? "");
      console.log(`      ${c.name || c.id}  [canales: ${c.keys.join(", ")}]  ${dest ? "("+dest+")" : ""}${c.loc ? "  loc="+c.loc : ""}${mark}`);
    }
    console.log(`      productos en base: ${b.base_products}`);
  }
  console.log("\nA escribir en Folvy:");
  console.log(`  categorías:    nuevas ${report.cat_new}, actualizadas ${report.cat_update}`);
  console.log(`  productos:     nuevos ${report.prod_new}, actualizados ${report.prod_update}`);
  console.log(`  combos:        nuevos ${report.combo_new}, actualizados ${report.combo_update}`);
  console.log(`  overrides canal: nuevos ${report.overrides_new}`);
  console.log(`  modif. grupos: ${report.group_new}  opciones: ${report.option_new}  asignaciones: ${report.assign_new}`);
  console.log(`  combo slots:   ${report.slot_new}  slot opciones: ${report.slot_opt_new}`);
  if (report.discarded.size) console.log(`  marcas descartadas (a propósito): ${[...report.discarded].join(", ")}`);
  if (report.unresolved.size) console.log(`  ⚠ marcas Last SIN marca Folvy: ${[...report.unresolved].join(", ")}`);
  if (report.only_in_last.length) console.log(`  ⚠ ${report.only_in_last.length} menu_item en Folvy (external) que NO vienen en este catálogo (¿descatalogados?).`);
  if (report.warnings.length) {
    console.log(`\n  Avisos (${report.warnings.length}):`);
    for (const w of report.warnings.slice(0, 40)) console.log(`    - ${w}`);
    if (report.warnings.length > 40) console.log(`    … y ${report.warnings.length - 40} más`);
  }
  console.log(DRY ? "\n(DRY-RUN: nada escrito. Revisa, confirma catálogos base, y relanza con --run.)"
                  : "\n(RUN: escrito. Verifica en BBDD y comprueba que el casado de ventas no baja con recast_lastapp_sales.)");
}

main().catch((e) => { console.error("FATAL:", e?.stack ?? String(e)); process.exit(1); });
