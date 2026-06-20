#!/usr/bin/env node
// scripts/backfill-sales.mjs
//
// Backfill local de ventas Last.app -> Folvy. Corre en terminal sin límite de
// tiempo (la Edge se queda corta con cargas masivas). Idempotente por
// sale.external_ref = bill.id.
//
// CANÓNICO (20/06): escribe la venta CRUDA y DELEGA el casado en reprocess_sale
// (el mismo motor agnóstico del webhook en vivo): resuelve marca por
// external_brand_map, arma líneas por menu_item.external_id=matrícula, costea y
// consume. Ya NO resuelve líneas en memoria (fuera caches + resolve_lastapp_line)
// ni las marca 'manual': las arma adapt_lastapp_order como 'pos'/'unmapped'
// (normales, RE-CASABLES). 'manual' = solo correcciones humanas (inmunes al recast).
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... LASTAPP_TOKEN=... \
//   node scripts/backfill-sales.mjs \
//     --account <uuid> --org <uuid> --last-location <uuid> \
//     --start 2026-05-01 --end 2026-05-27 [--dry-run]

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
const RATE_LIMIT_MS = 450;
const RATE_LIMIT_RETRY_WAIT_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  throw new Error(`Last.app ${path}: agotados ${RATE_LIMIT_MAX_ATTEMPTS} intentos sin éxito`);
}

// channel_id por slug (cache simple).
const channelIdBySlug = new Map();
async function resolveChannelId(slug) {
  if (!slug) return null;
  if (channelIdBySlug.has(slug)) return channelIdBySlug.get(slug);
  const { data } = await sb.from("sales_channel").select("id")
    .eq("account_id", args.account).eq("slug", slug).maybeSingle();
  const id = data?.id ?? null;
  channelIdBySlug.set(slug, id);
  return id;
}

// Local Folvy desde el mapa agnóstico (source='lastapp').
async function resolveFolvyLocationId(lastLocationId) {
  const { data, error } = await sb
    .from("external_location_map").select("location_id")
    .eq("account_id", args.account).eq("source", "lastapp")
    .eq("external_location_id", lastLocationId).maybeSingle();
  if (error) throw new Error(`external_location_map: ${error.message}`);
  return data?.location_id ?? null;
}

// ============================================================
// Procesado de un bill (canónico: venta cruda + reprocess_sale)
// ============================================================
async function processBill(billHeader, folvyLocationId, dryRun) {
  const billId = billHeader.id;
  if (!billId) return { skipped: true, reason: "no bill id" };

  if (!dryRun) {
    const { data: exists, error: exErr } = await sb
      .from("sale").select("id")
      .eq("account_id", args.account).eq("source", "lastapp")
      .eq("external_ref", String(billId))
      .limit(1).maybeSingle();
    if (exErr) throw new Error(`exists check ${billId}: ${exErr.message}`);
    if (exists) return { skipped: true, reason: "already exists" };
  }

  const bill = await lastGet(`/bills/${billId}`, args.lastLocation);
  const payType = bill?.payments?.[0]?.type ?? null;
  const slug = channelSlug(payType);
  const products = Array.isArray(bill?.products) ? bill.products : [];
  const externalBrandText = bill?.locationBrandId ?? bill?.brandId ?? null;

  if (dryRun) {
    return { written: true, lines: products.length, unresolved: 0, billId };
  }

  const channelId = await resolveChannelId(slug);

  const { data: saleRow, error: saleErr } = await sb.from("sale").insert({
    account_id: args.account,
    source: "lastapp",
    external_ref: String(billId),
    external_channel_text: payType,
    channel_id: channelId,
    external_brand_text: externalBrandText,
    external_location_text: args.lastLocation,
    location_id: folvyLocationId,
    sold_at: bill?.creationTime ?? bill?.finalizingTime ?? new Date().toISOString(),
    total: typeof bill?.total === "number" ? bill.total / 100 : 0,
    delivery_cost: typeof bill?.deliveryFee === "number" ? bill.deliveryFee / 100 : null,
    discount_amount: typeof bill?.discountTotal === "number" ? bill.discountTotal / 100 : null,
    raw_products: JSON.stringify(products),
    is_active: true,
  }).select("id").single();
  if (saleErr || !saleRow) throw new Error(`sale insert ${billId}: ${saleErr?.message ?? "unknown"}`);

  // Casado canónico (mismo motor que el webhook): marca + líneas + coste + consumo.
  const { error: rpErr } = await sb.rpc("reprocess_sale", { p_sale_id: saleRow.id });
  if (rpErr) {
    const { error: delErr } = await sb.from("sale").delete().eq("id", saleRow.id);
    const note = delErr ? ` (rollback falló: ${delErr.message})` : "";
    throw new Error(`reprocess_sale ${billId}: ${rpErr.message}${note}`);
  }

  // Stats de líneas de producto resultantes.
  const { data: lns } = await sb.from("sale_line")
    .select("menu_item_id, line_type").eq("sale_id", saleRow.id);
  const prod = (lns ?? []).filter((l) => (l.line_type ?? "product") === "product");
  const unresolved = prod.filter((l) => !l.menu_item_id).length;

  return { written: true, lines: prod.length, unresolved, billId };
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log(`Backfill Last.app -> Folvy (canónico: reprocess_sale)`);
  console.log(`  account:        ${args.account}`);
  console.log(`  org:            ${args.org}`);
  console.log(`  last-location:  ${args.lastLocation}`);
  console.log(`  rango:          ${args.start} → ${args.end}`);
  console.log(`  dry-run:        ${args.dryRun ? "SÍ" : "no"}`);
  console.log("");

  const folvyLocationId = await resolveFolvyLocationId(args.lastLocation);
  console.log(`  folvyLocationId: ${folvyLocationId ?? "(null)"}`);
  console.log("");

  const totals = {
    days: 0, bills_seen: 0,
    sales_written: 0, sales_skipped: 0,
    lines_written: 0, lines_unresolved: 0,
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
    for (const bh of bills) {
      totals.bills_seen++; dayBillsSeen++;
      try {
        const r = await processBill(bh, folvyLocationId, args.dryRun);
        if (r.skipped) { totals.sales_skipped++; daySkipped++; }
        else if (r.written) {
          totals.sales_written++; dayWritten++;
          totals.lines_written    += r.lines;       dayLines      += r.lines;
          totals.lines_unresolved += r.unresolved;  dayUnresolved += r.unresolved;
        }
      } catch (e) {
        totals.errors.push(String(e.message ?? e));
        console.log(`  bill ${bh?.id ?? "?"}: ${String(e.message ?? e)}`);
      }
    }

    console.log(`[${day}] ${dayBillsSeen} bills, ${dayWritten} ventas, ${dayLines} líneas ` +
      `(${dayUnresolved} sin casar)` +
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
  console.log(`    └ sin casar:            ${totals.lines_unresolved}`);
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
