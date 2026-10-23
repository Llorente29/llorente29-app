#!/usr/bin/env node
// scripts/conta/produccion/nombres.mjs — el nombre de una migración (C10, Julio, 23/10).
//
// Hasta el C10 el nombre era «el siguiente por encima del más alto»: dos
// sesiones a la vez cogían el mismo (la 0840 la quisieron el C08 y la D07a el
// 23/10). Ahora el nombre lleva la fecha, la hora, el minuto y la sesión:
//
//   AAAAMMDDTHHMM_<sesión>_<qué>.sql      p. ej. 20261023T1812_c10_tandas_por_rama.sql
//     <sesión>: letras y números, en minúscula (c10, d08, s03…)
//     <qué>:    letras, números y «_», en minúscula
//
// Y nunca repetido: ni el nombre entero ni su «AAAAMMDDTHHMM_<sesión>» pueden
// estar ya en main, en otro PR abierto o en el historial de producción.
// Las migraciones de antes del C10 (y las que ya estaban en PR abiertos ese día,
// ANTIGUAS_ABIERTAS) se quedan como están.
//
//   node nombres.mjs revisar <nuevas.txt> <main.txt> <prs.txt>      (pr-a-main.yml)
//   node nombres.mjs produccion <versiones.txt> <ficheros…>         (aplicar-produccion-conta.yml)
// Cada .txt: un nombre o una ruta por línea. Sale con 1 y las frases si algo no cumple.

import { readFileSync } from 'node:fs'

export const FORMATO = /^(\d{8}T\d{4})_([a-z0-9]+)_([a-z0-9_]+)\.sql$/

/** Las de formato antiguo que estaban en PR abiertos el día del C10 (23/10): se quedan con su nombre. */
export const ANTIGUAS_ABIERTAS = new Set([
  '20261208T0850_d07_iva_no_deducible_y_periodo_cerrado.sql',
  '20261208T0860_d07_uber_liquidaciones.sql',
  '20261208T0870_d07_uber_quitar_provisionales.sql',
  '20261208T0880_d07a_respaldo_antes_de_reenviar.sql',
])

const base = (f) => String(f).trim().replace(/^.*\//, '')
/** La versión (el nombre sin «.sql») y su llave sin el «qué» (fecha, hora, minuto y sesión). */
export function llave(f) {
  const n = base(f)
  const m = FORMATO.exec(n)
  return { version: n.replace(/\.sql$/, ''), prefijo: m ? `${m[1]}_${m[2]}` : null }
}

/**
 * Lo que no cumple de las migraciones NUEVAS de un PR, en frases.
 * main y prs: nombres que ya existen (en main; en los demás PR abiertos).
 */
export function revisar(nuevas, { main = [], prs = [] } = {}) {
  const fallos = []
  const llavesDe = (lista) => lista.map(base).filter((n) => /\.sql$/.test(n)).map((n) => ({ n, ...llave(n) }))
  const enMain = llavesDe(main)
  const enPrs = llavesDe(prs)
  const vistas = new Map()
  for (const f of nuevas.map(base).filter((n) => /\.sql$/.test(n))) {
    const k = llave(f)
    if (!k.prefijo && !ANTIGUAS_ABIERTAS.has(f)) {
      fallos.push(`${f}: el nombre no es «AAAAMMDDTHHMM_<sesión>_<qué>.sql» (C10), p. ej. 20261023T1812_c10_tandas_por_rama.sql`)
      continue
    }
    for (const [donde, lista] of [['main', enMain], ['otro PR abierto', enPrs]]) {
      const choca = lista.find((x) => x.n !== f && (x.version === k.version || (k.prefijo && x.prefijo === k.prefijo)))
      if (choca) fallos.push(`${f}: ya hay ${choca.n} en ${donde} con el mismo nombre (o la misma fecha, hora y sesión). Cámbiale el minuto.`)
    }
    const otra = k.prefijo && vistas.get(k.prefijo)
    if (otra) fallos.push(`${f}: tiene la misma fecha, hora y sesión que ${otra}, en este mismo PR. Cámbiale el minuto.`)
    if (k.prefijo) vistas.set(k.prefijo, f)
  }
  return fallos
}

/** Lo que choca con el historial de producción: la misma fecha, hora y sesión con otro nombre. */
export function contraProduccion(ficheros, versiones) {
  const fallos = []
  const registradas = versiones.map((v) => String(v).trim()).filter(Boolean)
  for (const f of ficheros) {
    const k = llave(f)
    if (!k.prefijo) continue
    const choca = registradas.find((v) => v !== k.version && v.startsWith(`${k.prefijo}_`))
    if (choca) fallos.push(`${base(f)}: producción ya tiene ${choca}, con la misma fecha, hora y sesión. Cámbiale el minuto.`)
  }
  return fallos
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [orden, ...args] = process.argv.slice(2)
  const leer = (f) => readFileSync(f, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean)
  let fallos
  if (orden === 'revisar') {
    const [fNuevas, fMain, fPrs] = args
    fallos = revisar(leer(fNuevas), { main: fMain ? leer(fMain) : [], prs: fPrs ? leer(fPrs) : [] })
  } else if (orden === 'produccion') {
    const [fVersiones, ...ficheros] = args
    fallos = contraProduccion(ficheros, leer(fVersiones))
  } else {
    console.error('uso: nombres.mjs revisar <nuevas> <main> <prs> | produccion <versiones> <ficheros…>'); process.exit(2)
  }
  for (const f of fallos) console.log(`::error::${f}`)
  if (fallos.length) process.exit(1)
  console.log('Nombres de las migraciones: en su formato y sin repetir.')
}
