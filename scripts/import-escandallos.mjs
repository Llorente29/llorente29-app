#!/usr/bin/env node
/**
 * import-escandallos.mjs
 * -------------------------------------------------------------------------
 * Importa los escandallos de tspoon (Platos.xlsx) a Folvy como recipe_line.
 *
 * Estrategia:
 *   1. Lee Platos.xlsx -> mapa plato_tspoon -> [lineas{nombre, codigo, neto, bruto, unidad, alergenos, cunit_str, coste}]
 *   2. Lee tspoon_puente_todos.csv -> mapa component -> set(plu)
 *   3. Lee de Supabase: lastapp_product_map (plu->recipe_item_id), recipe_item type=raw (160), recipe_item_unit_conversion (4)
 *   4. Para cada plato del map cuyo plu cae en el puente y su component tiene escandallo:
 *        a) Resuelve dish_folvy_id
 *        b) Para cada linea del escandallo:
 *             - Casa ingrediente con raw (por código exacto, fallback nombre normalizado quitando "(corte)")
 *             - Normaliza cantidad neto/bruto a la unidad base del raw (g/ml/ud)
 *               * Si unidad línea = unidad base -> directo
 *               * Si unidad línea = unidad superior (Kg->g, Lt->ml) -> x1000
 *               * Si unidad línea = Uni y raw está en g/ml -> busca conversión en recipe_item_unit_conversion
 *               * Si no se puede convertir -> la línea entra con qty=NULL y comentario explicativo
 *             - Calcula coste de la línea = qty_neto_base * raw.fixed_cost
 *             - Extrae el "corte" del nombre (entre paréntesis) y lo mete en comment
 *
 * Modos:
 *   --validate  : valida 1 plato concreto (default: Doble Smash Cheeseburger) e imprime resultado vs coste tspoon
 *   --dry-run   : genera SQL completo (todos los platos) en import_escandallos.sql, NO inserta
 *   --commit    : inserta en BBDD directamente (con BEGIN/COMMIT)
 *
 * Env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Uso:
 *   node scripts/import-escandallos.mjs --validate
 *   node scripts/import-escandallos.mjs --validate --plato "Smash Cheeseburger"
 *   node scripts/import-escandallos.mjs --dry-run
 * -------------------------------------------------------------------------
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// XLSX vendrá vía dependencia. Si no está, fallback a parse simple del CSV exportado.
let XLSX;
try { XLSX = (await import("xlsx")).default; } catch { /* fallback abajo */ }

// ---------- CLI ----------
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valOf = (name) => { const i = args.indexOf(name); return i>=0 ? args[i+1] : null; };
const MODE = flag("--commit") ? "commit" : (flag("--dry-run") ? "dry-run" : "validate");
const VALIDATE_PLATO = valOf("--plato") || "Doble Smash Cheeseburger";

const ACCOUNT = "00000000-0000-0000-0000-000000000001";

// ---------- Env ----------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERROR: define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false }});

// ---------- Helpers ----------
const normTxt = (s) => (s||"").toString().toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .replace(/\s+/g," ").trim();

const stripParen = (s) => (s||"").replace(/\s*\([^)]*\)\s*$/,"").trim();

const normPlu = (p) => {
  p = (p||"").trim();
  return p.startsWith("o.") ? p.slice(2) : p;
};

function parseCunit(s) {
  if (!s) return { val:null, uni:null };
  const m = String(s).match(/([\d.,]+)\s*€\/(\w+)/);
  if (!m) return { val:null, uni:null };
  const raw = m[1];
  const val = raw.includes(",") ? parseFloat(raw.replace(/\./g,"").replace(",",".")) : parseFloat(raw);
  return { val, uni: m[2] };
}

// ---------- 1. Cargar escandallos del Excel ----------
function loadEscandallos(path) {
  if (!XLSX) throw new Error("falta dep xlsx: npm install xlsx (en el proyecto)");
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  // Layout real (0-indexed JS):
  //   Cabecera plato: r[0]=Descripción(nombre), r[5]=€/Pax, r[10]=Coste total
  //   Línea ingred.:  r[0]=null, r[1]=nombre, r[2]=código, r[3]=alérgenos,
  //                   r[4]=€/Unit, r[5]=Bruto, r[6]=Neto, r[7]=Unidad, r[10]=Coste línea
  const escs = {};
  let cur = null;
  for (let i = 11; i < rows.length; i++) { // desde fila 12 (idx 11) = cabecera plato
    const r = rows[i];
    if (!r) continue;
    const c0 = r[0], c1 = r[1], c2 = r[2], c3 = r[3], c4 = r[4], c5 = r[5], c6 = r[6], c7 = r[7], c10 = r[10];
    // Cabecera de plato: r[0] tiene texto y NO es "Descripción"
    if (c0 && c0 !== "Descripción") {
      cur = String(c0).trim();
      escs[cur] = { name: cur, coste_total: c10, lines: [] };
    }
    // Línea de ingrediente: r[0] vacío, r[1] tiene texto y NO es "Descripción"
    else if (!c0 && c1 && c1 !== "Descripción" && cur) {
      escs[cur].lines.push({
        name: String(c1).trim(),
        code: c2 ? String(c2).trim() : null,
        alergenos: c3 ? String(c3).trim() : null,
        cunit_str: c4 ? String(c4).trim() : null,
        bruto: c5, neto: c6,
        unidad: c7 ? String(c7).trim() : null,
        coste_linea: c10,
      });
    }
  }
  return escs;
}

// ---------- 2. Cargar puente ----------
function loadPuente(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(",");
  const idxComp = header.indexOf("component");
  const idxPlu  = header.indexOf("plu");
  const compByPlu = new Map();
  // CSV parsing simple respetando comillas dobles
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = parseCsvLine(lines[i]);
    const plu = normPlu(cells[idxPlu]);
    const comp = cells[idxComp];
    if (plu && comp) compByPlu.set(plu, comp);
  }
  return compByPlu;
}
function parseCsvLine(line) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// ---------- 3. Cargar BBDD ----------
async function loadBBDD() {
  console.log("Cargando BBDD...");
  // lastapp_product_map: plu -> recipe_item_id (solo dish)
  const { data: maps, error: e1 } = await sb
    .from("lastapp_product_map")
    .select("organization_product_id, recipe_item_id, recipe_item:recipe_item_id(id,name,type)")
    .eq("account_id", ACCOUNT);
  if (e1) throw e1;
  const pluToDish = new Map();
  const dishById = new Map();
  for (const m of maps) {
    if (m.recipe_item && m.recipe_item.type === "dish") {
      pluToDish.set(normPlu(m.organization_product_id), m.recipe_item_id);
      dishById.set(m.recipe_item_id, m.recipe_item.name);
    }
  }
  // raws
  const { data: raws, error: e2 } = await sb
    .from("recipe_item").select("id,name,code,base_unit_id,fixed_cost,notes")
    .eq("account_id", ACCOUNT).eq("type","raw");
  if (e2) throw e2;
  const rawByCode = new Map();
  const rawByNameNorm = new Map();
  const rawById = new Map();
  for (const r of raws) {
    if (r.code) rawByCode.set(r.code.trim(), r);
    rawByNameNorm.set(normTxt(r.name), r);
    rawById.set(r.id, r);
  }
  // unidades base
  const { data: units, error: e3 } = await sb
    .from("kitchen_unit").select("id,name,abbreviation");
  if (e3) throw e3;
  const unitById = new Map(units.map(u => [u.id, u]));
  const unitByAbbr = new Map(units.map(u => [u.abbreviation, u]));
  // conversiones: item_id -> {from_unit_id, qty_in_base}
  const { data: convs, error: e4 } = await sb
    .from("recipe_item_unit_conversion").select("item_id,from_unit_id,qty_in_base")
    .eq("account_id", ACCOUNT).eq("is_active", true);
  if (e4) throw e4;
  const convByItem = new Map();
  for (const c of convs) {
    if (!convByItem.has(c.item_id)) convByItem.set(c.item_id, []);
    convByItem.get(c.item_id).push(c);
  }
  console.log(`  ${pluToDish.size} plu->dish | ${raws.length} raws | ${units.length} units | ${convs.length} conversiones`);
  return { pluToDish, dishById, rawByCode, rawByNameNorm, rawById, unitById, unitByAbbr, convByItem };
}

// ---------- 4. Lógica de conversión a unidad base ----------
// Devuelve { qty, ok, reason } -> qty en la unidad base del raw, o ok=false si no se puede
function toBaseQty(qty, lineUnitStr, raw, db) {
  if (qty == null) return { qty: null, ok: false, reason: "qty nula" };
  const rawBase = db.unitById.get(raw.base_unit_id);
  if (!rawBase) return { qty: null, ok: false, reason: "raw sin unidad base" };
  const baseAbbr = rawBase.abbreviation; // "g" | "ml" | "ud"
  const u = (lineUnitStr||"").toLowerCase();
  // mismas unidades
  if ((u === "gr" || u === "g") && baseAbbr === "g") return { qty, ok: true };
  if (u === "ml" && baseAbbr === "ml") return { qty, ok: true };
  if ((u === "uni" || u === "ud" || u === "u") && baseAbbr === "ud") return { qty, ok: true };
  // unidad de compra superior -> x1000
  if (u === "kg" && baseAbbr === "g") return { qty: qty*1000, ok: true };
  if ((u === "lt" || u === "l") && baseAbbr === "ml") return { qty: qty*1000, ok: true };
  // unidad "Uni" en raw que está en g/ml -> usar conversión
  if ((u === "uni" || u === "ud" || u === "u") && (baseAbbr === "g" || baseAbbr === "ml")) {
    const convs = db.convByItem.get(raw.id);
    if (convs && convs.length) {
      // buscar conversión desde "Unidad"
      const ud = db.unitByAbbr.get("ud");
      const conv = convs.find(c => c.from_unit_id === ud?.id);
      if (conv) return { qty: qty * Number(conv.qty_in_base), ok: true };
    }
    return { qty: null, ok: false, reason: `falta conversión Uni->${baseAbbr} para ${raw.name}` };
  }
  return { qty: null, ok: false, reason: `conversión no soportada: ${u} -> ${baseAbbr}` };
}

// ---------- 5. Casar línea con raw ----------
function findRaw(line, db) {
  // 1. por código exacto
  if (line.code) {
    const r = db.rawByCode.get(line.code.trim());
    if (r) return { raw: r, by: "code" };
  }
  // 2. por nombre normalizado (con paréntesis)
  let r = db.rawByNameNorm.get(normTxt(line.name));
  if (r) return { raw: r, by: "name" };
  // 3. por nombre sin paréntesis (los cortes los fusionamos al importar raw)
  r = db.rawByNameNorm.get(normTxt(stripParen(line.name)));
  if (r) return { raw: r, by: "name-noparen" };
  return null;
}

// ---------- 6. Procesar 1 plato ----------
function processPlato(esc, dishId, db) {
  const result = { dishId, plato: esc.name, coste_total_tspoon: esc.coste_total, lines: [], coste_calc: 0, faltan: [], castos: 0 };
  for (let i = 0; i < esc.lines.length; i++) {
    const line = esc.lines[i];
    const hit = findRaw(line, db);
    const cunit = parseCunit(line.cunit_str);
    // Extraer corte del nombre original
    const m = line.name.match(/\(([^)]+)\)\s*$/);
    const corte = m ? m[1] : null;
    if (!hit) {
      result.lines.push({ position: i+1, name: line.name, status: "NO_RAW", neto: line.neto, unidad: line.unidad, corte });
      result.faltan.push(line.name);
      continue;
    }
    const raw = hit.raw;
    const conv = toBaseQty(Number(line.neto), line.unidad, raw, db);
    const convB = toBaseQty(Number(line.bruto), line.unidad, raw, db);
    let coste = null;
    // El coste se calcula sobre el BRUTO (lo que pagas en compra, incluye merma),
    // no sobre el neto (lo que llega al plato). Es como lo hace tspoon y como
    // es correcto en food cost profesional.
    const qtyParaCoste = convB.ok ? convB.qty : (conv.ok ? conv.qty : null);
    if (qtyParaCoste != null && raw.fixed_cost != null) coste = qtyParaCoste * Number(raw.fixed_cost);
    if (coste != null) result.coste_calc += coste;
    if (hit.by !== "code") result.castos++;
    result.lines.push({
      position: i+1, name: line.name, raw_id: raw.id, raw_name: raw.name, matched_by: hit.by,
      neto: line.neto, bruto: line.bruto, unidad: line.unidad,
      neto_base: conv.qty, bruto_base: convB.qty, conv_ok: conv.ok, conv_reason: conv.reason,
      raw_cost: raw.fixed_cost ? Number(raw.fixed_cost) : null,
      coste, corte,
      comment: corte || null,
    });
  }
  return result;
}

// ---------- 7. Generar INSERT SQL ----------
function lineToInsert(plato_id, line) {
  const esc = (v) => v == null ? "NULL" : `'${String(v).replace(/'/g,"''")}'`;
  const num = (v) => v == null ? "NULL" : Number(v);
  return `INSERT INTO public.recipe_line (account_id, parent_item_id, child_item_id, quantity_net, quantity_gross, unit_id, comment, position) VALUES ('${ACCOUNT}', '${plato_id}', '${line.raw_id}', ${num(line.neto_base)}, ${num(line.bruto_base)}, (SELECT base_unit_id FROM public.recipe_item WHERE id='${line.raw_id}'), ${esc(line.comment)}, ${line.position});`;
}

// ---------- MAIN ----------
async function main() {
  const escs = loadEscandallos("Platos.xlsx");
  const compByPlu = loadPuente("tspoon_puente_todos.csv");
  const db = await loadBBDD();

  // Cruzar: para cada plu del map, buscar component, buscar su escandallo
  const matches = []; // {dish_id, dish_name, component, esc}
  // DIAGNÓSTICO
  console.log(`\n[diag] pluToDish size: ${db.pluToDish.size}`);
  console.log(`[diag] compByPlu size: ${compByPlu.size}`);
  console.log(`[diag] escs size: ${Object.keys(escs).length}`);
  // Probar intersección directa
  let interOk = 0, interSinComp = 0;
  const samples = [];
  for (const [plu, dishId] of db.pluToDish) {
    const comp = compByPlu.get(plu);
    if (comp) {
      interOk++;
      if (samples.length < 5) samples.push({plu, dish: db.dishById.get(dishId), comp, escExists: !!escs[comp]});
    } else {
      interSinComp++;
    }
  }
  console.log(`[diag] plu del map que SÍ tienen component en puente: ${interOk}`);
  console.log(`[diag] plu del map que NO están en puente: ${interSinComp}`);
  console.log(`[diag] muestra: ${JSON.stringify(samples, null, 2)}`);
  // Si interOk=0, mostrar tipos de las claves
  if (interOk === 0 && db.pluToDish.size > 0 && compByPlu.size > 0) {
    const k1 = [...db.pluToDish.keys()][0];
    const k2 = [...compByPlu.keys()][0];
    console.log(`[diag] muestra clave map: '${k1}' (len ${k1.length})`);
    console.log(`[diag] muestra clave puente: '${k2}' (len ${k2.length})`);
  }

  for (const [plu, dishId] of db.pluToDish) {
    const comp = compByPlu.get(plu);
    if (!comp) continue;
    let esc = escs[comp];
    if (!esc) {
      // fallback por nombre normalizado
      const n = normTxt(comp);
      esc = Object.values(escs).find(e => normTxt(e.name) === n);
    }
    if (esc && esc.lines.length > 0) {
      // evitar duplicar el mismo dish con varios plu (puede haber varios plu del mismo dish)
      if (!matches.find(m => m.dish_id === dishId)) {
        matches.push({ dish_id: dishId, dish_name: db.dishById.get(dishId), component: comp, esc });
      }
    }
  }
  console.log(`\nDish con escandallo casado: ${matches.length}`);

  if (MODE === "validate") {
    const target = matches.find(m => normTxt(m.dish_name) === normTxt(VALIDATE_PLATO))
                || matches.find(m => normTxt(m.component) === normTxt(VALIDATE_PLATO))
                || matches.find(m => normTxt(m.dish_name).includes(normTxt(VALIDATE_PLATO).split(" ").pop()));
    if (!target) {
      console.error(`No se encontró plato de validación '${VALIDATE_PLATO}' entre los casados.`);
      console.log("Algunos disponibles:", matches.slice(0,10).map(m => m.dish_name).join(" | "));
      process.exit(1);
    }
    const res = processPlato(target.esc, target.dish_id, db);
    console.log(`\n========== VALIDACIÓN ==========`);
    console.log(`Plato Folvy:   ${target.dish_name}`);
    console.log(`Plato tspoon:  ${target.component}`);
    console.log(`Coste tspoon:  ${target.esc.coste_total}`);
    console.log(`\nLíneas (${res.lines.length}):`);
    for (const l of res.lines) {
      if (l.status === "NO_RAW") {
        console.log(`  ${String(l.position).padStart(2)}. ${l.name.slice(0,40).padEnd(40)} | NO CASA con ningún raw`);
      } else {
        const okMark = l.conv_ok ? "✓" : "✗";
        const cost = l.coste != null ? l.coste.toFixed(5) : "  (n/a)";
        console.log(`  ${String(l.position).padStart(2)}. ${l.name.slice(0,38).padEnd(38)} | ${String(l.neto).padStart(6)} ${l.unidad.padEnd(3)} -> ${l.neto_base ?? "-"}${l.conv_ok?"":` (${l.conv_reason})`} ${okMark} | €${cost} | corte:${l.corte||"-"} | by:${l.matched_by}`);
      }
    }
    console.log(`\nCoste calculado Folvy: ${res.coste_calc.toFixed(5)}`);
    console.log(`Coste declarado tspoon: ${target.esc.coste_total}`);
    const diff = res.coste_calc - Number(target.esc.coste_total);
    console.log(`Diferencia: ${diff.toFixed(5)} (${(diff/Number(target.esc.coste_total)*100).toFixed(2)}%)`);
    if (res.faltan.length) console.log(`Líneas sin raw: ${res.faltan.length} -> ${res.faltan.slice(0,3).join(", ")}`);
    return;
  }

  // dry-run / commit -> procesar TODOS y generar SQL
  console.log(`\nProcesando los ${matches.length} platos...`);
  const inserts = [];
  const updates = [];  // UPDATE recipe_item SET computed_cost=... WHERE id=...
  const reportLines = [];
  let okPlatos = 0, conReview = 0;
  for (const m of matches) {
    const r = processPlato(m.esc, m.dish_id, db);
    const costeTspoon = Number(m.esc.coste_total);
    const diff = r.coste_calc - costeTspoon;
    const diffPct = costeTspoon > 0 ? (diff / costeTspoon) * 100 : 0;
    // needs_review si: falta algún raw, conversión falló, o diferencia con tspoon >1% (absoluto)
    const needsReview = r.faltan.length > 0
                     || r.lines.some(l => l.status !== "NO_RAW" && !l.conv_ok)
                     || Math.abs(diffPct) > 1;
    for (const l of r.lines) {
      if (l.status === "NO_RAW") continue;
      if (l.neto_base == null) continue; // no insertar líneas sin cantidad calculable
      inserts.push(lineToInsert(m.dish_id, l));
    }
    updates.push(`UPDATE public.recipe_item SET computed_cost=${r.coste_calc.toFixed(5)}, cost_updated_at=now(), needs_review=${needsReview} WHERE id='${m.dish_id}';`);
    reportLines.push(`${needsReview?"⚠":" "} ${m.dish_name} | tspoon=${costeTspoon.toFixed(5)} | folvy=${r.coste_calc.toFixed(5)} | diff=${diffPct.toFixed(2)}% | lineas=${r.lines.length} | sin_raw=${r.faltan.length} | needs_review=${needsReview}`);
    okPlatos++;
    if (needsReview) conReview++;
  }

  const sqlHeader = `-- import-escandallos generado ${new Date().toISOString()}
-- ${okPlatos} platos, ${conReview} con needs_review, ${inserts.length} recipe_line
BEGIN;

`;
  const sqlBody = inserts.join("\n") + "\n\n-- UPDATES de computed_cost\n" + updates.join("\n");
  const sqlFooter = `\n\nROLLBACK; -- cambiar a COMMIT tras verificar
`;
  writeFileSync("import_escandallos.sql", sqlHeader + sqlBody + sqlFooter, "utf8");
  writeFileSync("import_escandallos_report.txt", reportLines.join("\n"), "utf8");
  console.log(`\n✓ Generado import_escandallos.sql (${inserts.length} INSERT + ${updates.length} UPDATE)`);
  console.log(`✓ Generado import_escandallos_report.txt (resumen por plato)`);
  console.log(`  Platos: ${okPlatos} (${conReview} marcados needs_review)`);

  if (MODE === "commit") {
    console.log("\nMODE=commit: NO ejecuta directamente — revisa import_escandallos.sql y ejecútalo en el SQL Editor.");
  }
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
