#!/usr/bin/env node
// scripts/backfill-sales.mjs
//
// Backfill local de ventas Last.app -> Folvy (sale + sale_line).
// Corre en terminal sin límite de tiempo (la Edge Function se queda corta
// con cargas masivas). Idempotente por sale.external_ref = bill.id.
//
// Uso:
//   SUPABASE_URL=... \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   LASTAPP_TOKEN=... \
//   node scripts/backfill-sales.mjs \
//     --account <uuid> --org <uuid> --last-location <uuid> \
//     --start 2026-05-01 --end 2026-05-27 [--dry-run]
//
// Lógica de resolución (todo en memoria, dos vías):
//   Vía 1 — por ID (replica resolve_lastapp_line):
//     catalog_product_id -> organization_product_id (lastapp_catalog_product)
//     organization_product_id -> recipe_item_id     (lastapp_product_map)
//     (channel_id, recipe_item_id) -> [menu_items]
//       - 1 candidato: marca del propio menu_item.
//       - N candidatos: desambigua por lastapp_brand_name (alias 'Dirty
//         Burgers' -> 'Dirty Burger', exclusión 'FOODINT').
//   Vía 2 — fallback por nombre (si la vía 1 no resuelve):
//     (channel_id, normalize(product.name)) -> [menu_items]
//       - 1 candidato: directo. - N: desambigua igual que la vía 1.
//     Útil para histórico con catalogProductId obsoleto pero mismo nombre.
// El campo `via` ("id" | "name" | null) se cuenta en el resumen final.

import { createClient } from "@supabase/supabase-js";

// ============================================================
// CLI args
// ============================================================
function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") { out.dryRun = true; continue; }
    if (a === "--account")        out.account       = argv[++i];
    else if (a === "--org")        out.org           = argv[++i];
    else if (a === "--last-location") out.lastLocation = argv[++i];
    else if (a === "--start")      out.start         = argv[++i];
    else if (a === "--end")        out.end           = argv[++i];
    else {
      console.error(`Argumento desconocido: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function usage(msg) {
  console.error(msg);
  console.error("Uso: node scripts/backfill-sales.mjs --account <uuid> --org <uuid> --last-location <uuid> --start YYYY-MM-DD --end YYYY-MM-DD [--dry-run]");
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args.account)      usage("Falta --account");
if (!args.org)          usage("Falta --org");
if (!args.lastLocation) usage("Falta --last-location");
if (!args.start)        usage("Falta --start");
if (!args.end)          usage("Falta --end");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
if (!ISO_DATE.test(args.start) || !ISO_DATE.test(args.end)) {
  usage("--start y --end deben ser YYYY-MM-DD");
}

// ============================================================
// Env vars
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LASTAPP_TOKEN = process.env.LASTAPP_TOKEN;

if (!SUPABASE_URL)             { console.error("ERROR: falta env SUPABASE_URL");             process.exit(2); }
if (!SUPABASE_SERVICE_ROLE_KEY){ console.error("ERROR: falta env SUPABASE_SERVICE_ROLE_KEY"); process.exit(2); }
if (!LASTAPP_TOKEN)            { console.error("ERROR: falta env LASTAPP_TOKEN");             process.exit(2); }

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ============================================================
// Helpers
// ============================================================
const LASTAPP_BASE = "https://api.last.app/v2";
// Last.app: 1500 req cada 10 min por token+entidad (~2.5 req/s sostenido).
// 450ms ≈ 2.22 req/s, queda con margen frente al cap. Si aun así llega un
// 429, lastGet reintenta esperando 60s (hasta 3 intentos).
const RATE_LIMIT_MS = 450;
const RATE_LIMIT_RETRY_WAIT_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalize(s) {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\.$/, "")
    .replace(/\s+/g, " ");
}

function channelSlug(paymentType) {
  if (!paymentType) return null;
  const t = paymentType.toLowerCase();
  if (t.includes("glovo")) return "glovo";
  if (t.includes("uber"))  return "uber";
  if (t.includes("justeat") || t.includes("just_eat") || t.includes("just eat")) return "justeat";
  if (t.includes("shop") || t.includes("local") || t.includes("onsite")) return "shop";
  return null;
}

function nextDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function lastGet(path, locationId) {
  for (let attempt = 1; attempt <= RATE_LIMIT_MAX_ATTEMPTS; attempt++) {
    await sleep(RATE_LIMIT_MS);
    const res = await fetch(`${LASTAPP_BASE}${path}`, {
      headers: {
        "Authorization": `Bearer ${LASTAPP_TOKEN}`,
        "locationID": locationId,
      },
    });
    if (res.status === 429 && attempt < RATE_LIMIT_MAX_ATTEMPTS) {
      console.log(`⏳ rate limit (429), esperando 60s antes de reintentar (intento ${attempt}/${RATE_LIMIT_MAX_ATTEMPTS})...`);
      await sleep(RATE_LIMIT_RETRY_WAIT_MS);
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Last.app ${path} -> ${res.status} ${body.slice(0, 300)}`);
    }
    return res.json();
  }
  // Inalcanzable: la última iteración cae al throw de !res.ok cuando sigue 429.
  throw new Error(`Last.app ${path}: agotados ${RATE_LIMIT_MAX_ATTEMPTS} intentos sin éxito`);
}

// ============================================================
// Carga de caches en memoria
// ============================================================
async function loadAllPaged(table, select, eqColumn, eqValue) {
  const pageSize = 1000;
  const out = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from(table).select(select)
      .eq(eqColumn, eqValue)
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function loadCaches(accountId, lastLocationId) {
  console.log("Cargando caches en memoria...");

  // 1) lastapp_catalog_product: catalog_product_id -> {organization_product_id, lastapp_brand_name}
  const catalog = await loadAllPaged(
    "lastapp_catalog_product",
    "catalog_product_id, organization_product_id, lastapp_brand_name",
    "account_id", accountId,
  );
  const catalogByCatProd = new Map();
  for (const r of catalog) {
    if (r.catalog_product_id) catalogByCatProd.set(r.catalog_product_id, {
      organization_product_id: r.organization_product_id,
      lastapp_brand_name: r.lastapp_brand_name,
    });
  }

  // 2) lastapp_product_map: organization_product_id -> recipe_item_id
  const productMap = await loadAllPaged(
    "lastapp_product_map",
    "organization_product_id, recipe_item_id",
    "account_id", accountId,
  );
  const recipeByOrgProd = new Map();
  for (const r of productMap) {
    if (r.organization_product_id && r.recipe_item_id) {
      recipeByOrgProd.set(r.organization_product_id, r.recipe_item_id);
    }
  }

  // 3) menu_item: dos índices a partir de la misma carga.
  //    a) menuItemsByChannelRecipe: (channel_id, recipe_item_id) -> [{menu_item_id, brand_id}]
  //       Vía principal (resolución por ID).
  //    b) menuItemsByChannelName:   (channel_id, normalize(name)) -> [{menu_item_id, brand_id}]
  //       Fallback por nombre: histórico con catalogProductId obsoleto pero
  //       mismo nombre que el menu_item actual. Medido que el 100% de las
  //       líneas no resueltas por ID casan por nombre exacto.
  //    Arrays porque un recipe/nombre puede vivir en N marcas (bebidas).
  const menuItems = await loadAllPaged(
    "menu_item",
    "id, brand_id, channel_id, recipe_item_id, name, archived_at",
    "account_id", accountId,
  );
  const menuItemsByChannelRecipe = new Map();
  const menuItemsByChannelName = new Map();
  for (const m of menuItems) {
    if (m.archived_at) continue;
    if (!m.brand_id || !m.channel_id) continue;
    if (m.recipe_item_id) {
      const k = `${m.channel_id}|${m.recipe_item_id}`;
      if (!menuItemsByChannelRecipe.has(k)) menuItemsByChannelRecipe.set(k, []);
      menuItemsByChannelRecipe.get(k).push({ menu_item_id: m.id, brand_id: m.brand_id });
    }
    const nk = normalize(m.name);
    if (nk) {
      const k = `${m.channel_id}|${nk}`;
      if (!menuItemsByChannelName.has(k)) menuItemsByChannelName.set(k, []);
      menuItemsByChannelName.get(k).push({ menu_item_id: m.id, brand_id: m.brand_id });
    }
  }

  // 4) sales_channel: slug -> channel_id (filtrado por account)
  const channels = await loadAllPaged(
    "sales_channel", "id, slug, is_active", "account_id", accountId,
  );
  const channelBySlug = new Map();
  for (const c of channels) {
    if (c.is_active === false) continue;
    if (c.slug) channelBySlug.set(c.slug.toLowerCase(), c.id);
  }

  // 5) brand: normalize(name) -> brand_id (solo para DESAMBIGUAR cuando un
  //    recipe_item está compartido entre marcas). Excluye FOODINT (no es marca
  //    real) y añade alias 'Dirty Burgers' -> 'Dirty Burger' (Last.app usa plural).
  const brands = await loadAllPaged(
    "brand", "id, name, is_active", "account_id", accountId,
  );
  const brandByName = new Map();
  for (const b of brands) {
    if (b.is_active === false) continue;
    if (b.name && b.name.trim().toUpperCase() === "FOODINT") continue;
    const k = normalize(b.name);
    if (k && !brandByName.has(k)) brandByName.set(k, b.id);
  }
  const dirtyBurgerId = brandByName.get(normalize("Dirty Burger"));
  if (dirtyBurgerId) brandByName.set(normalize("Dirty Burgers"), dirtyBurgerId);

  // 6) lastapp_location_map: el location_id de Folvy para esta last-location
  const { data: locMap, error: locErr } = await sb
    .from("lastapp_location_map")
    .select("location_id")
    .eq("account_id", accountId)
    .eq("lastapp_location_id", lastLocationId)
    .maybeSingle();
  if (locErr) throw new Error(`lastapp_location_map: ${locErr.message}`);
  const folvyLocationId = locMap?.location_id ?? null;

  console.log(`  catalogByCatProd:           ${catalogByCatProd.size}`);
  console.log(`  recipeByOrgProd:            ${recipeByOrgProd.size}`);
  console.log(`  menuItemsByChannelRecipe:   ${menuItemsByChannelRecipe.size}`);
  console.log(`  menuItemsByChannelName:     ${menuItemsByChannelName.size}`);
  console.log(`  channelBySlug:              ${channelBySlug.size}`);
  console.log(`  brandByName (alias inc.):   ${brandByName.size}`);
  console.log(`  folvyLocationId:            ${folvyLocationId ?? "(null)"}`);
  console.log("");

  return {
    catalogByCatProd, recipeByOrgProd,
    menuItemsByChannelRecipe, menuItemsByChannelName,
    channelBySlug, brandByName, folvyLocationId,
  };
}

// ============================================================
// Resolución de una línea en memoria
// ============================================================
function resolveLine(product, channelId, caches) {
  if (!channelId) {
    return { menuItemId: null, brandId: null, via: null, reason: "no channel" };
  }
  // catEntry (si existe) sirve tanto para la vía ID como para desambiguar
  // por marca en el fallback por nombre cuando hay >1 candidato.
  const catEntry = product.catalogProductId
    ? caches.catalogByCatProd.get(product.catalogProductId)
    : null;

  // --- Vía 1: por ID ---
  // catalog_product_id -> organization_product_id -> recipe_item_id -> menu_item(channel,recipe)
  if (catEntry) {
    const recipeId = caches.recipeByOrgProd.get(catEntry.organization_product_id);
    if (recipeId) {
      const candidates = caches.menuItemsByChannelRecipe.get(`${channelId}|${recipeId}`);
      if (candidates && candidates.length === 1) {
        return { menuItemId: candidates[0].menu_item_id, brandId: candidates[0].brand_id, via: "id", reason: null };
      }
      if (candidates && candidates.length > 1) {
        const brandIdFromName = caches.brandByName.get(normalize(catEntry.lastapp_brand_name));
        const match = brandIdFromName ? candidates.find((c) => c.brand_id === brandIdFromName) : null;
        if (match) {
          return { menuItemId: match.menu_item_id, brandId: match.brand_id, via: "id", reason: null };
        }
        // Cae al fallback por nombre si la desambiguación por marca falla.
      }
    }
  }

  // --- Vía 2: fallback por nombre ---
  // (channel_id, normalize(product.name)) -> menu_item.
  const nameKey = normalize(product.name ?? "");
  if (!nameKey) {
    return { menuItemId: null, brandId: null, via: null,
      reason: catEntry ? "ID no resuelto y línea sin nombre" : "sin catalog_product_id ni nombre" };
  }
  const nameCands = caches.menuItemsByChannelName.get(`${channelId}|${nameKey}`);
  if (!nameCands || nameCands.length === 0) {
    return { menuItemId: null, brandId: null, via: null,
      reason: `nombre '${product.name}' no en menu_item del canal` };
  }
  if (nameCands.length === 1) {
    return { menuItemId: nameCands[0].menu_item_id, brandId: nameCands[0].brand_id, via: "name", reason: null };
  }
  // >1 candidato por nombre: desambiguar por lastapp_brand_name (igual que la vía ID).
  const brandIdFromName = catEntry
    ? caches.brandByName.get(normalize(catEntry.lastapp_brand_name))
    : null;
  const match = brandIdFromName ? nameCands.find((c) => c.brand_id === brandIdFromName) : null;
  if (match) {
    return { menuItemId: match.menu_item_id, brandId: match.brand_id, via: "name", reason: null };
  }
  return { menuItemId: null, brandId: null, via: null,
    reason: `nombre compartido entre marcas y no desambiguable ('${catEntry?.lastapp_brand_name ?? "?"}')` };
}

// ============================================================
// Procesado de un bill
// ============================================================
async function processBill(billHeader, accountId, lastLocationId, caches, dryRun) {
  const billId = billHeader.id;
  if (!billId) return { skipped: true, reason: "no bill id" };

  // Idempotencia: ¿ya existe?
  if (!dryRun) {
    const { data: exists, error: exErr } = await sb
      .from("sale").select("id")
      .eq("account_id", accountId).eq("source", "lastapp")
      .eq("external_ref", String(billId))
      .limit(1).maybeSingle();
    if (exErr) throw new Error(`exists check ${billId}: ${exErr.message}`);
    if (exists) return { skipped: true, reason: "already exists" };
  }

  // Detalle
  const bill = await lastGet(`/bills/${billId}`, lastLocationId);
  const payType = bill?.payments?.[0]?.type ?? null;
  const slug = channelSlug(payType);
  const channelId = slug ? (caches.channelBySlug.get(slug) ?? null) : null;
  const products = Array.isArray(bill?.products) ? bill.products : [];

  const resolvedLines = [];
  let saleBrandId = null;
  let linesUnresolved = 0, resolvedById = 0, resolvedByName = 0;
  for (const p of products) {
    const r = resolveLine(p, channelId, caches);
    if (r.brandId && !saleBrandId) saleBrandId = r.brandId;
    resolvedLines.push({
      raw_text: p.name ?? "",
      product_name: p.name ?? "",
      quantity: typeof p.quantity === "number" ? p.quantity : 1,
      unit_price: typeof p.price === "number" ? p.price / 100 : null,
      menu_item_id: r.menuItemId,
      map_source: r.menuItemId ? "manual" : "unmapped",
      map_needs_review: r.menuItemId ? false : true,
    });
    if (!r.menuItemId) linesUnresolved++;
    else if (r.via === "id") resolvedById++;
    else if (r.via === "name") resolvedByName++;
  }

  if (dryRun) {
    return { written: true, lines: resolvedLines.length, unresolved: linesUnresolved,
      resolvedById, resolvedByName, billId };
  }

  // Insert sale
  const { data: saleRow, error: saleErr } = await sb.from("sale").insert({
    account_id: accountId,
    source: "lastapp",
    external_ref: String(billId),
    external_channel_text: payType,
    channel_id: channelId,
    brand_id: saleBrandId,
    location_id: caches.folvyLocationId,
    sold_at: bill?.creationTime ?? bill?.finalizingTime ?? new Date().toISOString(),
    total: typeof bill?.total === "number" ? bill.total / 100 : 0,
    delivery_cost: typeof bill?.deliveryFee === "number" ? bill.deliveryFee / 100 : null,
    discount_amount: typeof bill?.discountTotal === "number" ? bill.discountTotal / 100 : null,
    raw_products: JSON.stringify(products),
    is_active: true,
  }).select("id").single();
  if (saleErr || !saleRow) throw new Error(`sale insert ${billId}: ${saleErr?.message ?? "unknown"}`);

  // Insert sale_line
  if (resolvedLines.length > 0) {
    const lineRows = resolvedLines.map((l) => ({ ...l, account_id: accountId, sale_id: saleRow.id }));
    const { error: lineErr } = await sb.from("sale_line").insert(lineRows);
    if (lineErr) {
      // Rollback manual: borrar sale si fallan sus líneas (no huerfanas)
      const { error: delErr } = await sb.from("sale").delete().eq("id", saleRow.id);
      const note = delErr ? ` (rollback falló: ${delErr.message})` : "";
      throw new Error(`sale_line insert ${billId}: ${lineErr.message}${note}`);
    }
  }

  return { written: true, lines: resolvedLines.length, unresolved: linesUnresolved,
    resolvedById, resolvedByName, billId };
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log(`Backfill Last.app -> Folvy`);
  console.log(`  account:        ${args.account}`);
  console.log(`  org:            ${args.org}`);
  console.log(`  last-location:  ${args.lastLocation}`);
  console.log(`  rango:          ${args.start} → ${args.end}`);
  console.log(`  dry-run:        ${args.dryRun ? "SÍ" : "no"}`);
  console.log("");

  const caches = await loadCaches(args.account, args.lastLocation);

  const totals = {
    days: 0, bills_seen: 0,
    sales_written: 0, sales_skipped: 0,
    lines_written: 0, lines_unresolved: 0,
    resolved_by_id: 0, resolved_by_name: 0,
    day_overflows: [], errors: [],
  };

  let day = args.start;
  while (day <= args.end) {
    totals.days++;
    const from = `${day} 00:00:00`;
    const to   = `${day} 23:59:59`;

    let billsResp;
    try {
      billsResp = await lastGet(
        `/bills?locationId=${args.lastLocation}&startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}&limit=100`,
        args.lastLocation,
      );
    } catch (e) {
      totals.errors.push(`day ${day} list: ${String(e.message ?? e)}`);
      console.log(`[${day}] ERROR listando bills: ${String(e.message ?? e)}`);
      day = nextDay(day); continue;
    }

    const bills = Array.isArray(billsResp) ? billsResp : (billsResp?.value ?? []);
    if (bills.length >= 100) totals.day_overflows.push(day);

    let dayBillsSeen = 0, dayWritten = 0, daySkipped = 0, dayLines = 0, dayUnresolved = 0;
    let dayResolvedById = 0, dayResolvedByName = 0;
    for (const bh of bills) {
      totals.bills_seen++; dayBillsSeen++;
      try {
        const r = await processBill(bh, args.account, args.lastLocation, caches, args.dryRun);
        if (r.skipped) { totals.sales_skipped++; daySkipped++; }
        else if (r.written) {
          totals.sales_written++; dayWritten++;
          totals.lines_written  += r.lines;       dayLines       += r.lines;
          totals.lines_unresolved += r.unresolved; dayUnresolved  += r.unresolved;
          totals.resolved_by_id   += r.resolvedById;   dayResolvedById   += r.resolvedById;
          totals.resolved_by_name += r.resolvedByName; dayResolvedByName += r.resolvedByName;
        }
      } catch (e) {
        totals.errors.push(String(e.message ?? e));
        console.log(`  bill ${bh?.id ?? "?"}: ${String(e.message ?? e)}`);
      }
    }

    console.log(`[${day}] ${dayBillsSeen} bills, ${dayWritten} ventas, ${dayLines} líneas ` +
      `(${dayResolvedById} por ID, ${dayResolvedByName} por nombre, ${dayUnresolved} sin mapear)` +
      (daySkipped ? `, ${daySkipped} ya existían` : ""));
    day = nextDay(day);
  }

  console.log("");
  console.log("===== Resumen =====");
  console.log(`  Días procesados:        ${totals.days}`);
  console.log(`  Bills vistos:           ${totals.bills_seen}`);
  console.log(`  Ventas escritas:        ${totals.sales_written}`);
  console.log(`  Ventas ya existían:    ${totals.sales_skipped}`);
  console.log(`  Líneas escritas:       ${totals.lines_written}`);
  console.log(`    └ resueltas por ID:     ${totals.resolved_by_id}`);
  console.log(`    └ resueltas por nombre: ${totals.resolved_by_name}`);
  console.log(`    └ sin mapear:           ${totals.lines_unresolved}`);
  if (totals.day_overflows.length) {
    console.log(`  Días con ≥100 bills:   ${totals.day_overflows.join(", ")}`);
    console.log(`    (Last.app limita a 100/página sin cursor: revisa esos días a mano)`);
  }
  if (totals.errors.length) {
    console.log("");
    console.log(`  Errores (${totals.errors.length}):`);
    for (const e of totals.errors.slice(0, 30)) console.log(`    - ${e}`);
    if (totals.errors.length > 30) console.log(`    ... y ${totals.errors.length - 30} más`);
  }
  if (args.dryRun) console.log("\n  (DRY-RUN: nada se escribió en BBDD)");
}

main().catch((e) => {
  console.error("FATAL:", e?.stack ?? String(e));
  process.exit(1);
});
