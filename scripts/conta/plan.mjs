#!/usr/bin/env node
// scripts/conta/plan.mjs
//
// C02 · GENERA la serie del plan contable desde el BOE descargado por Actions
// (docs/conta/fuentes/textos/), nunca de memoria:
//
//   · el cuadro de cuentas (cuarta parte) de cada plan;
//   · más supabase/conta/pgc/correcciones.json (D1: nada se corrige sin cita
//     literal de la quinta parte del mismo texto; se comprueba aquí);
//   · más supabase/conta/pgc/en-la-calle.json («qué se apunta aquí», de Folvy).
//
// Y comprueba, antes de escribir nada, que el artículo del RD 1/2021 que
// modifica el plan de pymes (artículo segundo) sigue sin tocar el cuadro de
// cuentas ni la quinta parte: si algún día lo hace, la serie de pymes tiene
// que recogerlo citando el artículo, y esto falla hasta entonces.
//
// Escribe:
//   · supabase/conta/pgc/serie.json — cada cuenta con su fuente, huella y,
//     si la hay, su corrección (el «fichero de referencia» del agente).
//   · supabase/migrations/20261007T0110_c02_pgc_serie.sql
//
//   node scripts/conta/plan.mjs             → genera
//   node scripts/conta/plan.mjs comprobar   → regenera en memoria y falla si
//                                              los ficheros no son idénticos

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PLANES, construirSerie, equivalencias, textoVigente } from './lib/planContable.mjs'

const FUENTES = 'docs/conta/fuentes'
const PGC = 'supabase/conta/pgc'
const SERIE = join(PGC, 'serie.json')
const MIGRACION = 'supabase/migrations/20261007T0110_c02_pgc_serie.sql'
const EQUIVALENCIAS = join(PGC, 'equivalencias.json')
const modo = process.argv[2] ?? 'generar'

const registro = JSON.parse(readFileSync(join(FUENTES, 'registro.json'), 'utf8'))
const correcciones = JSON.parse(readFileSync(join(PGC, 'correcciones.json'), 'utf8'))
const calle = JSON.parse(readFileSync(join(PGC, 'en-la-calle.json'), 'utf8')).cuentas
const fallos = []

function fuente(clave) {
  const f = registro.fuentes[clave]
  if (!f || !f.fichero) throw new Error(`La fuente «${clave}» no está descargada: no se puede generar la serie.`)
  return { ...f, texto: readFileSync(join(FUENTES, f.fichero), 'utf8') }
}

// ── RD 1/2021, artículo segundo: ¿toca el cuadro de pymes? ─────────────────
const rd2021 = fuente('rd-1-2021')
const art2 = textoVigente(rd2021.texto, 'as')
if (art2 === null) fallos.push('RD 1/2021: no encuentro el artículo segundo (bloque [as]).')
else {
  if (!art2.startsWith('Artículo segundo. Modificación del Plan General de Contabilidad de Pequeñas y Medianas Empresas')) {
    fallos.push('RD 1/2021: el bloque [as] ya no es el artículo segundo sobre el plan de pymes.')
  }
  const puntos = art2.match(/^(Uno|Dos|Tres|Cuatro|Cinco|Seis|Siete|Ocho|Nueve|Diez)\. En la (\S+) parte/gm) ?? []
  const toca = /cuarta parte|quinta parte|cuadro de cuentas/i.test(art2)
  if (toca) fallos.push('RD 1/2021, artículo segundo: ahora menciona el cuadro de cuentas o la quinta parte. La serie de pymes tiene que recogerlo, citando el artículo.')
  var rd2021Nota = `RD 1/2021, artículo segundo: ${puntos.length} puntos (${puntos.map((p) => p.replace(/\. En la /, ': ').replace(/ parte$/, '')).join(', ')}); ninguno toca la cuarta parte (cuadro de cuentas) ni la quinta.`
}

// ── La serie de cada plan ───────────────────────────────────────────────────
const usadasCalle = new Set()
const construidas = {}
const salida = []
const resumen = {}
for (const plan of Object.keys(PLANES)) {
  const f = fuente(PLANES[plan].fuente)
  const { cuentas, hallazgos } = construirSerie(f.texto, plan, correcciones)
  fallos.push(...hallazgos)
  construidas[plan] = cuentas
  const verificado = f.fecha.slice(0, 10)
  for (const c of cuentas) {
    const pn = calle[c.code] ?? null
    if (pn) usadasCalle.add(c.code)
    const reforma = c.norma && c.norma !== PLANES[plan].idBoe ? `, redacción vigente desde ${c.desde} (${c.norma})` : ''
    const corr = c.correccion ? `; título corregido con cita de la quinta parte (${c.correccion}, supabase/conta/pgc/correcciones.json)` : ''
    salida.push({
      plan, code: c.code, name: c.name, boe_name: c.boeName, correction_kind: c.correccion, plain_name: pn,
      group_code: c.group, parent_code: c.parent, is_leaf: c.hoja,
      legal_ref: `${PLANES[plan].norma}, cuarta parte (cuadro de cuentas), grupo ${c.group}${reforma}${corr}`,
      valid_from: c.desde, boe_version_id: c.norma, source_key: PLANES[plan].fuente, source_sha256: f.sha256, verified_at: verificado,
    })
  }
  const sinGrupos = cuentas.filter((c) => c.code.length > 1)
  resumen[plan] = {
    filas: cuentas.length, codigosSinGrupos: sinGrupos.length, hojas: cuentas.filter((c) => c.hoja).length,
    porDigitos: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, cuentas.filter((c) => c.code.length === n).length])),
    corregidas: cuentas.filter((c) => c.correccion).length,
  }
}
for (const code of Object.keys(calle)) if (!usadasCalle.has(code)) fallos.push(`en-la-calle.json: la cuenta ${code} no existe en ningún plan.`)

if (fallos.length) {
  console.error('No se genera la serie del plan contable:\n' + fallos.map((x) => `  · ${x}`).join('\n'))
  process.exit(1)
}

const equiv = {
  _que_es: 'C02 · D4. GENERADO por scripts/conta/plan.mjs desde la serie: hojas de pymes que en el general no son hoja. Al pasar de pymes a general, Folvy enseña los candidatos (cada uno con su línea del cuadro) y la persona confirma uno a uno; solo hay propuesta cuando hay un único candidato.',
  pymes_a_general: equivalencias(construidas.pymes, construidas.general),
}
const equivJson = JSON.stringify(equiv, null, 1) + '\n'

// ── Ficheros ────────────────────────────────────────────────────────────────
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const b = (v) => (v ? 'true' : 'false')

const serie = {
  _que_es: 'C02 · Serie del plan contable GENERADA por scripts/conta/plan.mjs (no se edita a mano). Cuadro de cuentas del BOE + correcciones con cita + «qué se apunta aquí». Es la referencia del agente «Plan contable».',
  generado_desde: { 'rd-1514-2007': registro.fuentes['rd-1514-2007'].sha256, 'rd-1515-2007': registro.fuentes['rd-1515-2007'].sha256, 'rd-1-2021': rd2021.sha256 },
  rd_1_2021_pymes: rd2021Nota,
  resumen,
  cuentas: salida,
}
const json = '{\n' + Object.entries(serie).map(([k, v]) => k === 'cuentas'
  ? `  "cuentas": [\n${v.map((c) => '    ' + JSON.stringify(c)).join(',\n')}\n  ]`
  : `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n'

const fuentesSql = ['rd-1515-2007', 'rd-1-2021', 'rd-1514-2007'].map((k) => {
  const f = registro.fuentes[k]
  return `insert into public.official_source (key, name, url, sha256, downloaded_at) values (${q(k)}, ${q(f.nombre)}, ${q(f.url)}, ${q(f.sha256)}, ${q(f.fecha)}) on conflict (key) do nothing;`
})
const sql = [
  '-- ============================================================================',
  '-- C02 · Plan contable — 2 · LA SERIE (valores). GENERADA por scripts/conta/plan.mjs:',
  '-- no se edita a mano. Cuadro de cuentas del BOE (texto consolidado descargado',
  '-- por Actions) + supabase/conta/pgc/correcciones.json (cada una con cita de la',
  '-- quinta parte) + supabase/conta/pgc/en-la-calle.json.',
  '--',
  ...Object.entries(resumen).map(([p, r]) => `-- ${p}: ${r.filas} filas (${r.codigosSinGrupos} sin contar los grupos), ${r.hojas} hojas, ${r.corregidas} corregidas.`),
  `-- ${rd2021Nota}`,
  '--',
  '-- SOLO AÑADE filas a pgc_account (nueva en la 0100). Si ya están, no las toca.',
  '-- ============================================================================',
  '',
  ...fuentesSql,
  '',
  'insert into public.pgc_account (plan, code, name, boe_name, correction_kind, plain_name, group_code, parent_code, is_leaf, legal_ref, valid_from, boe_version_id, source_key, source_sha256, verified_at) values',
  salida.map((c) => `(${q(c.plan)}, ${q(c.code)}, ${q(c.name)}, ${q(c.boe_name)}, ${q(c.correction_kind)}, ${q(c.plain_name)}, ${c.group_code}, ${q(c.parent_code)}, ${b(c.is_leaf)}, ${q(c.legal_ref)}, ${q(c.valid_from)}, ${q(c.boe_version_id)}, ${q(c.source_key)}, ${q(c.source_sha256)}, ${q(c.verified_at)})`).join(',\n'),
  'on conflict (plan, code, valid_from) do nothing;',
  '',
].join('\n')

if (modo === 'comprobar') {
  const igual = (ruta, nuevo) => existsSync(ruta) && readFileSync(ruta, 'utf8') === nuevo
  const distintos = [[SERIE, json], [MIGRACION, sql], [EQUIVALENCIAS, equivJson]].filter(([r, t]) => !igual(r, t)).map(([r]) => r)
  if (distintos.length) { console.error(`La serie del plan contable no está al día (node scripts/conta/plan.mjs): ${distintos.join(', ')}`); process.exit(1) }
  console.log('Serie del plan contable al día.', JSON.stringify(resumen))
} else {
  writeFileSync(SERIE, json)
  writeFileSync(MIGRACION, sql)
  writeFileSync(EQUIVALENCIAS, equivJson)
  console.log('Serie del plan contable generada.', JSON.stringify(resumen, null, 1))
}
