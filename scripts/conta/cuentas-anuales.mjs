#!/usr/bin/env node
// scripts/conta/cuentas-anuales.mjs
//
// C05 · GENERA la serie de los modelos de cuentas anuales desde el BOE
// descargado por Actions (docs/conta/fuentes/textos/rd-1514-2007.txt y
// rd-1515-2007.txt), nunca de memoria:
//
//   · las líneas de cada modelo y sus cuentas: scripts/conta/modelos-pgc.mjs;
//   · las partidas «a crear», el resultado del ejercicio y las colocaciones por
//     defecto: scripts/conta/lib/cuentasAnuales.mjs (con su cita);
//   · y comprueba, antes de escribir nada, que TODA hoja del cuadro de cuentas
//     del C02 (supabase/conta/pgc/serie.json) cae en una y solo una línea de
//     cada estado (o en dos por el signo de su saldo). Regla 2: si una no
//     tiene sitio, no se genera.
//
// Escribe:
//   · supabase/conta/pgc/cuentas-anuales.json — la referencia (agente y pruebas).
//   · supabase/migrations/20261014T0110_c05_modelos_serie.sql
//
//   node scripts/conta/cuentas-anuales.mjs            → genera
//   node scripts/conta/cuentas-anuales.mjs comprobar  → regenera en memoria y
//                                                       falla si no son idénticos

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { extraer } from './modelos-pgc.mjs'
import { construirModelo, cobertura, MODELOS, PLAN_DE } from './lib/cuentasAnuales.mjs'

const FUENTES = 'docs/conta/fuentes'
const JSON_REF = 'supabase/conta/pgc/cuentas-anuales.json'
const MIGRACION = 'supabase/migrations/20261014T0110_c05_modelos_serie.sql'
const modo = process.argv[2] ?? 'generar'

const registro = JSON.parse(readFileSync(join(FUENTES, 'registro.json'), 'utf8'))
const serie = JSON.parse(readFileSync('supabase/conta/pgc/serie.json', 'utf8')).cuentas
const { fuente, modelos } = extraer()
const FUENTE_DE = { general: 'rd-1514-2007', pymes: 'rd-1515-2007' }
const NORMA = { general: 'RD 1514/2007', pymes: 'RD 1515/2007' }
const NOMBRE_ESTADO = { balance: 'balance', pyg: 'cuenta de pérdidas y ganancias', igrpn: 'estado de ingresos y gastos reconocidos' }

const fallos = []
for (const [k, f] of Object.entries(fuente)) {
  if (registro.fuentes[k]?.sha256 !== f.sha256) fallos.push(`${k}: el texto no es el del registro (huella ${f.sha256.slice(0, 12)} frente a ${registro.fuentes[k]?.sha256?.slice(0, 12)}).`)
}

const lineas = []
const mapeo = []
const resumen = {}
for (const modelo of MODELOS) {
  const plan = PLAN_DE[modelo]
  const est = modelos[modelo]
  const hojas = serie.filter((c) => c.plan === plan && c.is_leaf).map((c) => c.code)
  const cita = (estado) => `${NORMA[plan]}, tercera parte, II${modelo === 'normal' ? '' : modelo === 'abreviado' ? 'I' : ''}, modelo ${modelo === 'pymes' ? 'de pymes' : modelo} del ${NOMBRE_ESTADO[estado]} (texto consolidado, ${est[estado]?.vigente ?? '¿?'})`
  let r
  try { r = construirModelo(modelo, est, hojas, { citaModelo: cita }) } catch (e) { fallos.push(String(e.message)); continue }
  const candidatas = [...new Set([...hojas, ...hojas.filter((h) => h.length > 3).map((h) => h.slice(0, 3))])]
  const c = cobertura(modelo, r.mapeo, candidatas)
  for (const x of c.sinSitio) fallos.push(`${modelo}: la cuenta ${x.code} no tiene sitio en el ${x.estado} (regla 2).`)
  for (const x of c.varias) fallos.push(`${modelo}: la cuenta ${x.code} cae en varias líneas del ${x.estado} sin ir por signo: ${x.lineas.join(', ')}.`)
  lineas.push(...r.lineas.map((l) => ({ ...l, source_key: FUENTE_DE[plan], source_sha256: fuente[FUENTE_DE[plan]].sha256 })))
  mapeo.push(...r.mapeo)
  resumen[modelo] = {
    lineas: r.lineas.length, aCrear: r.lineas.filter((l) => l.to_create).length, mapeo: r.mapeo.length,
    porOrigen: Object.fromEntries(['boe', 'a_crear', 'resultado', 'defecto'].map((o) => [o, r.mapeo.filter((m) => m.origin === o).length])),
    porSigno: r.mapeo.filter((m) => m.by_balance).length, hojas: hojas.length,
  }
}
if (fallos.length) {
  console.error('No se genera la serie de cuentas anuales:\n' + fallos.map((x) => `  · ${x}`).join('\n'))
  process.exit(1)
}

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const b = (v) => (v ? 'true' : 'false')

const ref = {
  _que_es: 'C05 · Serie de los modelos de cuentas anuales GENERADA por scripts/conta/cuentas-anuales.mjs (no se edita a mano): líneas del BOE + partidas a crear + mapeo línea ↔ cuentas. Referencia del agente «Libro diario» y de las pruebas.',
  generado_desde: Object.fromEntries(Object.entries(fuente).map(([k, f]) => [k, f.sha256])),
  resumen,
  lineas,
  mapeo,
}
const json = '{\n' + Object.entries(ref).map(([k, v]) => Array.isArray(v)
  ? `  ${JSON.stringify(k)}: [\n${v.map((x) => '    ' + JSON.stringify(x)).join(',\n')}\n  ]`
  : `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n'

const sql = [
  '-- ============================================================================',
  '-- C05 · Libros y balances — 2 · LA SERIE DE LOS MODELOS (valores). GENERADA por',
  '-- scripts/conta/cuentas-anuales.mjs: no se edita a mano. Líneas y cuentas del',
  '-- texto consolidado del BOE (RD 1514/2007 y 1515/2007, tercera parte, última',
  '-- versión de cada bloque), más las partidas que las normas de elaboración',
  '-- mandan crear, el resultado del ejercicio (6 y 7 sin regularizar) y las',
  '-- colocaciones por defecto de las respuestas 1 y 2 del C05.',
  '--',
  ...Object.entries(resumen).map(([m, r]) => `-- ${m}: ${r.lineas} líneas (${r.aCrear} a crear), ${r.mapeo} filas de mapeo (${Object.entries(r.porOrigen).map(([o, n]) => `${n} ${o}`).join(', ')}; ${r.porSigno} por signo); las ${r.hojas} hojas de su plan, cada una con sitio.`),
  ...Object.entries(fuente).map(([k, f]) => `-- ${k}: sha256 ${f.sha256}`),
  '--',
  '-- SOLO AÑADE filas a annual_accounts_line y annual_accounts_mapping (nuevas en',
  '-- la 0100). Si ya están, no las toca.',
  '-- ============================================================================',
  '',
  'insert into public.annual_accounts_line (model, statement, code, parent_code, text, level, sort_order, side, is_total, to_create, legal_ref, source_key, source_sha256) values',
  lineas.map((l) => `(${[q(l.model), q(l.statement), q(l.code), q(l.parent_code), q(l.text), l.level, l.sort_order, q(l.side), b(l.is_total), b(l.to_create), q(l.legal_ref), q(l.source_key), q(l.source_sha256)].join(', ')})`).join(',\n'),
  'on conflict (model, statement, code) do nothing;',
  '',
  'insert into public.annual_accounts_mapping (model, statement, line_code, account_prefix, sign, by_balance, origin, any_sign, note, legal_ref) values',
  mapeo.map((m) => `(${[q(m.model), q(m.statement), q(m.line_code), q(m.account_prefix), q(m.sign), q(m.by_balance), q(m.origin), b(m.any_sign), q(m.note), q(m.legal_ref)].join(', ')})`).join(',\n'),
  'on conflict (model, statement, line_code, account_prefix) where company_id is null do nothing;',
  '',
].join('\n')

if (modo === 'comprobar') {
  const mal = [[JSON_REF, json], [MIGRACION, sql]].filter(([f, t]) => !existsSync(f) || readFileSync(f, 'utf8') !== t).map(([f]) => f)
  if (mal.length) { console.error(`Difiere de lo que sale del BOE: ${mal.join(', ')}. Vuelve a generar con node scripts/conta/cuentas-anuales.mjs`); process.exit(1) }
  console.log('Serie de cuentas anuales al día.', JSON.stringify(resumen))
} else {
  writeFileSync(JSON_REF, json)
  writeFileSync(MIGRACION, sql)
  console.log('Generado.', JSON.stringify(resumen))
}
