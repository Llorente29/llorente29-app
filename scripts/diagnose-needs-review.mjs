#!/usr/bin/env node
// scripts/diagnose-needs-review.mjs
//
// Diagnóstico: cruza los dish con needs_review=true de Folvy contra el coste
// de referencia de tspoon (CSV tspoon_puente_todos.csv). SOLO LECTURA en BBDD.
//
// Uso (PowerShell):
//   $env:SUPABASE_URL = "https://....supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "..."
//   node scripts/diagnose-needs-review.mjs
//   node scripts/diagnose-needs-review.mjs --account 00000000-0000-0000-0000-000000000001
//
// Flujo:
//   1) Lee CSV tspoon (plu normalizado quitando prefijo 'o.').
//   2) Lee lastapp_product_map -> organization_product_id (plu) <-> recipe_item_id.
//   3) Lee recipe_item con type='dish', needs_review=true, computed_cost NOT NULL.
//   4) Cruza por plu, calcula delta (folvy - tspoon_avg), agrupa por centros.
//   5) Vuelca tabla en consola ordenada por |delta_pct| DESC + resumen.
//   6) Guarda CSV completo en tspoon_needs_review_diagnosis.csv (raíz).
//
// No instala dependencias: @supabase/supabase-js ya está en package.json.

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// CLI args + env
// ============================================================
function parseArgs(argv) {
  const out = {
    csvPath: "tspoon_puente_todos.csv",
    outPath: "tspoon_needs_review_diagnosis.csv",
    accountId: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv")          out.csvPath   = argv[++i];
    else if (a === "--out")     out.outPath   = argv[++i];
    else if (a === "--account") out.accountId = argv[++i];
    else { console.error(`Argumento desconocido: ${a}`); process.exit(2); }
  }
  return out;
}
const args = parseArgs(process.argv);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL) { console.error("ERROR: falta env SUPABASE_URL");                 process.exit(2); }
if (!SUPABASE_SERVICE_ROLE_KEY) { console.error("ERROR: falta env SUPABASE_SERVICE_ROLE_KEY"); process.exit(2); }

// ============================================================
// Helpers (copia del patrón usado en import-escandallos.mjs)
// ============================================================
const normPlu = (p) => {
  p = (p || "").trim();
  return p.startsWith("o.") ? p.slice(2) : p;
};

function parseCsvLine(line) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ============================================================
// 1) Cargar CSV tspoon
// ============================================================
function loadTspoonCsv(path) {
  console.log(`Cargando ${path}...`);
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV vacío o sin filas de datos");
  const header = parseCsvLine(lines[0]);
  const ix = {
    center: header.indexOf("center"),
    component: header.indexOf("component"),
    plu: header.indexOf("plu"),
    costComponent: header.indexOf("costComponent"),
    idMenu: header.indexOf("idMenu"),
    menu: header.indexOf("menu"),
  };
  for (const [k, v] of Object.entries(ix)) {
    if (v === -1) throw new Error(`Columna '${k}' no encontrada en CSV header. Encontrado: ${header.join(",")}`);
  }

  const byPlu = new Map(); // plu_normalizado -> [{center, component, costComponent, idMenu, menu}]
  let rowsOk = 0, rowsNoPlu = 0, rowsNoCost = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = parseCsvLine(lines[i]);
    const plu = normPlu(c[ix.plu]);
    if (!plu) { rowsNoPlu++; continue; }
    const cost = parseFloat(c[ix.costComponent]);
    if (!Number.isFinite(cost)) { rowsNoCost++; continue; }
    const entry = {
      center: c[ix.center] ?? "",
      component: c[ix.component] ?? "",
      costComponent: cost,
      idMenu: c[ix.idMenu] ?? "",
      menu: c[ix.menu] ?? "",
    };
    if (!byPlu.has(plu)) byPlu.set(plu, []);
    byPlu.get(plu).push(entry);
    rowsOk++;
  }
  console.log(`  filas válidas: ${rowsOk}  |  plu únicos: ${byPlu.size}  |  sin plu: ${rowsNoPlu}  |  sin cost: ${rowsNoCost}`);
  return byPlu;
}

// ============================================================
// 2) Cargar BBDD (SOLO LECTURA)
// ============================================================
async function loadAllPaged(sb, table, select, filters) {
  const pageSize = 1000;
  const out = [];
  let offset = 0;
  while (true) {
    let q = sb.from(table).select(select).range(offset, offset + pageSize - 1);
    for (const f of (filters ?? [])) q = f(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function loadFolvyData(sb, accountId) {
  console.log("Consultando BBDD (solo lectura)...");

  // lastapp_product_map: organization_product_id -> recipe_item_id
  const mapFilters = [
    (q) => q.not("recipe_item_id", "is", null),
  ];
  if (accountId) mapFilters.push((q) => q.eq("account_id", accountId));
  const maps = await loadAllPaged(sb, "lastapp_product_map",
    "organization_product_id, recipe_item_id", mapFilters);

  const pluByRecipe = new Map(); // recipe_item_id -> [plu_normalizado, ...]
  for (const m of maps) {
    if (!m.recipe_item_id || !m.organization_product_id) continue;
    const plu = normPlu(m.organization_product_id);
    if (!plu) continue;
    if (!pluByRecipe.has(m.recipe_item_id)) pluByRecipe.set(m.recipe_item_id, []);
    pluByRecipe.get(m.recipe_item_id).push(plu);
  }

  // recipe_item: dishes con needs_review=true y computed_cost NOT NULL
  const dishFilters = [
    (q) => q.eq("type", "dish"),
    (q) => q.eq("needs_review", true),
    (q) => q.not("computed_cost", "is", null),
  ];
  if (accountId) dishFilters.push((q) => q.eq("account_id", accountId));
  const dishes = await loadAllPaged(sb, "recipe_item",
    "id, name, computed_cost, cost_updated_at, needs_review", dishFilters);

  console.log(`  lastapp_product_map filas con recipe_item_id: ${maps.length}  (recipes distintos: ${pluByRecipe.size})`);
  console.log(`  recipe_item dishes needs_review=true con coste:  ${dishes.length}`);
  return { dishes, pluByRecipe };
}

// ============================================================
// 3) Cruce dish <-> tspoon
// ============================================================
function cross(dishes, pluByRecipe, tspoonByPlu) {
  const rows = [];
  for (const d of dishes) {
    const plus = pluByRecipe.get(d.id) ?? [];
    const costs = [];
    const centers = new Set();
    const pluasMatch = [];
    for (const plu of plus) {
      const entries = tspoonByPlu.get(plu);
      if (!entries) continue;
      pluasMatch.push(plu);
      for (const e of entries) {
        costs.push(e.costComponent);
        if (e.center) centers.add(e.center);
      }
    }
    const folvyCost = Number(d.computed_cost);

    if (costs.length === 0) {
      const nota = plus.length === 0
        ? "sin lastapp_product_map"
        : "plu no encontrado en CSV tspoon";
      rows.push({
        dish_name: d.name,
        recipe_item_id: d.id,
        costo_folvy: folvyCost,
        costo_tspoon: null,
        delta_eur: null,
        delta_pct: null,
        centros: "",
        notas: nota,
      });
      continue;
    }

    const tspoonAvg = avg(costs);
    const deltaEur = folvyCost - tspoonAvg;
    const deltaPct = tspoonAvg !== 0 ? (deltaEur / tspoonAvg) * 100 : null;
    const extra = costs.length > 1 ? `${costs.length} muestras` : "";

    rows.push({
      dish_name: d.name,
      recipe_item_id: d.id,
      costo_folvy: folvyCost,
      costo_tspoon: tspoonAvg,
      delta_eur: deltaEur,
      delta_pct: deltaPct,
      centros: [...centers].join("|"),
      notas: extra,
    });
  }

  // Orden: |delta_pct| descendente, nulls al final
  rows.sort((a, b) => {
    const aa = a.delta_pct == null ? -Infinity : Math.abs(a.delta_pct);
    const bb = b.delta_pct == null ? -Infinity : Math.abs(b.delta_pct);
    return bb - aa;
  });
  return rows;
}

// ============================================================
// 4) OUTPUTS
// ============================================================
function fmt(v, dp) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return dp != null ? v.toFixed(dp) : String(v);
  return String(v);
}
function truncate(s, w) {
  const str = String(s ?? "");
  return str.length > w ? str.slice(0, w - 1) + "…" : str.padEnd(w);
}

function printTable(rows) {
  const widths = {
    dish_name:    Math.min(40, Math.max(9, ...rows.map((r) => (r.dish_name ?? "").length))),
    costo_folvy:  11,
    costo_tspoon: 12,
    delta_eur:    10,
    delta_pct:    9,
    centros:      26,
    notas:        30,
  };
  const headers = ["dish_name", "costo_folvy", "costo_tspoon", "delta_eur", "delta_pct", "centros", "notas"];

  console.log("");
  console.log(headers.map((h) => truncate(h, widths[h])).join(" | "));
  console.log(headers.map((h) => "-".repeat(widths[h])).join("-+-"));
  for (const r of rows) {
    console.log([
      truncate(r.dish_name,           widths.dish_name),
      truncate(fmt(r.costo_folvy, 4), widths.costo_folvy),
      truncate(fmt(r.costo_tspoon,4), widths.costo_tspoon),
      truncate(fmt(r.delta_eur, 4),   widths.delta_eur),
      truncate(fmt(r.delta_pct, 2),   widths.delta_pct),
      truncate(r.centros || "",       widths.centros),
      truncate(r.notas || "",         widths.notas),
    ].join(" | "));
  }
}

function writeOutCsv(path, rows) {
  const headers = ["dish_name", "recipe_item_id", "costo_folvy", "costo_tspoon", "delta_eur", "delta_pct", "centros", "notas"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => {
      const v = r[h];
      if (v === null || v === undefined) return "";
      if (typeof v === "number") return csvCell(v.toFixed(6));
      return csvCell(v);
    }).join(","));
  }
  writeFileSync(path, lines.join("\n"), "utf8");
}

function summary(rows) {
  const buckets = {
    lessNeg10: 0,        // delta < -10%
    neg10toNeg3: 0,      // -10% <= delta < -3%
    cuadran: 0,          // -3% <= delta <= 3%
    pos3toPos10: 0,      //  3% < delta <= 10%
    moreThan10: 0,       // delta > 10%
    noRef: 0,
  };
  const abss = [];
  for (const r of rows) {
    if (r.delta_pct === null || r.delta_pct === undefined) { buckets.noRef++; continue; }
    abss.push(Math.abs(r.delta_pct));
    if      (r.delta_pct < -10) buckets.lessNeg10++;
    else if (r.delta_pct <  -3) buckets.neg10toNeg3++;
    else if (r.delta_pct <=  3) buckets.cuadran++;
    else if (r.delta_pct <= 10) buckets.pos3toPos10++;
    else                         buckets.moreThan10++;
  }

  console.log("");
  console.log("===== Resumen =====");
  console.log(`  Folvy infravalora (delta < -10%):           ${buckets.lessNeg10}`);
  console.log(`  Folvy un poco bajo  (-10% <= delta < -3%):  ${buckets.neg10toNeg3}`);
  console.log(`  Cuadran             (-3% <= delta <= 3%):   ${buckets.cuadran}`);
  console.log(`  Folvy un poco alto  ( 3% < delta <= 10%):   ${buckets.pos3toPos10}`);
  console.log(`  Folvy sobrevalora   (delta > 10%):          ${buckets.moreThan10}`);
  console.log(`  Sin referencia tspoon:                       ${buckets.noRef}`);
  if (abss.length) {
    console.log("");
    console.log(`  |delta_pct| media:    ${avg(abss).toFixed(2)}%`);
    console.log(`  |delta_pct| mediana:  ${median(abss).toFixed(2)}%`);
  }
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log(`Diagnose needs_review vs tspoon`);
  console.log(`  csv:     ${args.csvPath}`);
  console.log(`  out:     ${args.outPath}`);
  console.log(`  account: ${args.accountId ?? "(todas, service-role)"}`);
  console.log("");

  const tspoonByPlu = loadTspoonCsv(args.csvPath);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { dishes, pluByRecipe } = await loadFolvyData(sb, args.accountId);

  const rows = cross(dishes, pluByRecipe, tspoonByPlu);
  printTable(rows);
  writeOutCsv(args.outPath, rows);
  summary(rows);
  console.log("");
  console.log(`  CSV guardado en: ${args.outPath}`);
}

main().catch((e) => {
  console.error("FATAL:", e?.stack ?? String(e));
  process.exit(1);
});
