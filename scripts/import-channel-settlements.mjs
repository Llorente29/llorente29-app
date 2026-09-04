#!/usr/bin/env node
/**
 * import-channel-settlements.mjs
 * Importa liquidaciones de plataforma (folvy_glovo.csv / folvy_justeat.csv / folvy_uber.csv)
 * a la tabla channel_settlement (Capa B del módulo Ventas). Idempotente por import_key.
 *
 * Patrón hermano de scripts/import-last-catalog.mjs (dry-run por defecto).
 *
 *   node import-channel-settlements.mjs --account <uuid> \
 *        --glovo folvy_glovo.csv --je folvy_justeat.csv --uber folvy_uber.csv [--run]
 *
 * Env (solo con --run): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Sin --run = DRY RUN: parsea, mapea e imprime; NO toca la BBDD ni requiere red.
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val  = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const RUN = flag('--run');
const ACCOUNT = val('--account');
const paths = { glovo: val('--glovo'), je: val('--je'), uber: val('--uber') };

if (!ACCOUNT) { console.error('Falta --account <uuid>'); process.exit(1); }

// --- CSV mínimo (delimitador ';', comillas opcionales) ---
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ';') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
}
function readCSV(path) {
  const txt = fs.readFileSync(path, 'utf8').replace(/^﻿/, '');
  const rows = parseCSV(txt); const head = rows[0];
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
// B59 (04/09/2026): `parseFloat` a secas SE COMIA LOS CENTIMOS. Estos CSV usan
// ';' como delimitador, que es la convencion de Excel en español — y va SIEMPRE
// con la coma como decimal. parseFloat('909,09') devuelve 909, sin avisar.
// Probado: base_10 909,09 -> 909 · coste_incidencias -25,50 -> -25. Cada importe
// perdia sus centimos en silencio, que es la peor forma de perderlos.
// Se aceptan los dos formatos: 1.234,56 (español) y 1,234.56 (ingles).
const n = (x) => {
  if (x == null || x === '') return null;
  let s = String(x).trim();
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.');
  if (coma > punto) s = s.replace(/\./g, '').replace(',', '.');  // decimal = coma
  else              s = s.replace(/,/g, '');                       // decimal = punto (o sin decimales)
  const v = parseFloat(s);
  return Number.isNaN(v) ? null : v;
};
const dmy = (s) => { if (!s) return null; const m = s.split('/'); return m.length === 3 ? `${m[2]}-${m[1].padStart(2,'0')}-${m[0].padStart(2,'0')}` : null; };
const monthRange = (ym) => { const [y, m] = ym.split('-').map(Number); const last = new Date(y, m, 0).getDate(); return [`${ym}-01`, `${ym}-${String(last).padStart(2,'0')}`]; };

const base = { account_id: ACCOUNT, currency: 'EUR', needs_review: false };
const out = [];

if (paths.glovo && fs.existsSync(paths.glovo)) for (const r of readCSV(paths.glovo)) {
  const num = (r.numero || '').trim(); if (!num) continue;
  out.push({ ...base, source: 'import_csv_glovo', import_key: `glovo:${num}`,
    external_brand_text: r.local, settlement_ref: num, settlement_date: dmy(r.fecha), period_grain: 'quincena',
    gross_sales: n(r.venta_neta), base_amount: n(r.base_10), vat_amount: n(r.iva_10),
    commission: n(r.comision_base) ?? 0, delivery_transport: n(r.entrega) ?? 0,
    promo_product: n(r.promo_producto) ?? 0, promo_flash: n(r.promo_flash) ?? 0,
    offer_flash_credit: n(r.oferta_flash) ?? 0, access_fee: n(r.tasa_acceso) ?? 0,
    prime_fee: n(r.glovo_prime) ?? 0, recurring_fee: n(r.tarifa_recurrente) ?? 0,
    incidents_cost: n(r.coste_incidencias) ?? 0, incidents_refund: n(r.devol_incidencias) ?? 0,
    net_payout: n(r.liquidacion), accumulated_debt: n(r.deuda_acumulada), raw: r });
}
if (paths.je && fs.existsSync(paths.je)) for (const r of readCSV(paths.je)) {
  const num = (r.numero || '').trim(); if (!num) continue;
  out.push({ ...base, source: 'import_csv_je', import_key: `je:${num}`,
    external_brand_text: r.local, settlement_ref: num, settlement_date: dmy(r.fecha), period_grain: 'quincena',
    gross_sales: n(r.venta_neta), base_amount: n(r.base_10), vat_amount: n(r.iva_10), raw: r });
}
if (paths.uber && fs.existsSync(paths.uber)) for (const r of readCSV(paths.uber)) {
  const ym = (r.mes || '').trim(); if (!ym) continue;
  const [from, to] = monthRange(ym);
  out.push({ ...base, source: 'import_csv_uber', import_key: `uber:${r.local}:${ym}`,
    external_brand_text: r.local, settlement_date: to, period_from: from, period_to: to, period_grain: 'mes',
    orders_count: n(r.pedidos), gross_sales: n(r.venta_con_iva), base_amount: n(r.base_10), vat_amount: n(r.iva_10), raw: r });
}

// ── B59 §2 (04/09/2026): DECIR QUE COLUMNAS NO SE ESTAN LEYENDO ──────────────
// El importador lee `coste_incidencias` de Glovo y NO LEE NADA equivalente en
// Uber ni en Just Eat: sus ramas no tienen esa linea. Por eso las 127
// liquidaciones de esas dos plataformas tienen 0,00 EUR de incidencias — no es
// que no las traigan, es que nadie las mira.
//
// El nombre de la columna en el CSV de Uber y en el de JE no se puede adivinar
// desde aqui, y adivinarlo seria justo lo que no se hace. Asi que el script lo
// PREGUNTA AL FICHERO: con un dry-run sobre una liquidacion real de cada una,
// esta lista dice como se llama el campo. Con eso se cierra §2 sin leer ninguna
// especificacion.
const LEIDAS = {
  glovo: ['numero','local','fecha','venta_neta','base_10','iva_10','comision_base','entrega',
          'promo_producto','promo_flash','oferta_flash','tasa_acceso','glovo_prime',
          'tarifa_recurrente','coste_incidencias','devol_incidencias','liquidacion','deuda_acumulada'],
  je:    ['numero','local','fecha','venta_neta','base_10','iva_10'],
  uber:  ['mes','local','pedidos','venta_con_iva','base_10','iva_10'],
};
for (const [plataforma, ruta] of Object.entries(paths)) {
  if (!ruta || !fs.existsSync(ruta)) continue;
  const filas = readCSV(ruta);
  if (!filas.length) { console.log(`\n[${plataforma}] fichero sin filas.`); continue; }
  const cabeceras = Object.keys(filas[0]);
  const sinLeer = cabeceras.filter((c) => !LEIDAS[plataforma].includes(c));
  console.log(`\n[${plataforma}] ${cabeceras.length} columnas; se leen ${cabeceras.length - sinLeer.length}.`);
  if (sinLeer.length) {
    console.log(`  SIN LEER (${sinLeer.length}): ${sinLeer.join(', ')}`);
    const sospechosas = sinLeer.filter((c) => /incid|refund|devol|error|ajust|compens|adjust/i.test(c));
    if (sospechosas.length) {
      console.log(`  >>> CANDIDATAS A INCIDENCIA (B59 §2): ${sospechosas.join(', ')}`);
    }
  }
}

const byKey = new Map(); for (const r of out) byKey.set(`${r.account_id}|${r.import_key}`, r); // dedupe local
const rows = [...byKey.values()];
const bySrc = rows.reduce((a, r) => (a[r.source] = (a[r.source] || 0) + 1, a), {});
console.log(`Filas mapeadas: ${rows.length}`, bySrc);
console.log('Muestra:', JSON.stringify({ ...rows[0], raw: '…' }, null, 1));

if (!RUN) { console.log('\nDRY RUN (nada escrito). Añade --run para upsert idempotente.'); process.exit(0); }

const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// resolver channel_id por nombre (glovo/uber/justeat) sin asumir el nombre exacto de columna
const { data: chans } = await sb.from('sales_channel').select('*');
const findChan = (needle) => (chans || []).find(c => Object.values(c).some(v => typeof v === 'string' && v.toLowerCase().includes(needle)))?.id ?? null;
const chanBySource = { import_csv_glovo: findChan('glovo'), import_csv_uber: findChan('uber'), import_csv_je: findChan('just') };
console.log('channel_id resuelto:', chanBySource);
for (const r of rows) r.channel_id = chanBySource[r.source] ?? null;

let ok = 0, err = 0;
for (let i = 0; i < rows.length; i += 200) {
  const chunk = rows.slice(i, i + 200);
  const { error } = await sb.from('channel_settlement').upsert(chunk, { onConflict: 'account_id,import_key' });
  if (error) { console.error('Error lote', i, error.message); err += chunk.length; } else ok += chunk.length;
}
console.log(`\nHecho: ${ok} upserted, ${err} con error.`);
