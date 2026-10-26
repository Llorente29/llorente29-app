#!/usr/bin/env node
// scripts/conta/produccion/cuentas-salida.mjs <antes.csv> <después.csv> [sección]
//
// W06 (26/10) · La tabla «Ensayo de la vuelta atrás», PARA EL REGISTRO DEL JOB.
// El informe (con los nombres de cada medida) va al resumen y al artefacto,
// que desde una sesión no se pueden leer: el #241 no se pudo leer. El registro
// sí, pero es público y el workflow lee producción (D01 R2): solo puede sacar
// números y huellas, por la puerta de salida (scripts/conta/salida-segura.mjs).
//
// Así que cada medida sale por su POSICIÓN, no por su nombre: «<cuenta>.<n>»
// es la fila n de esa cuenta (scripts/conta/produccion/cuentas/<cuenta>.sql,
// en su orden), con su valor de antes y el de después de deshacer cuando son
// números o huellas, y «distinta 1» si no coincide, sea lo que sea el valor.
//
//   node cuentas-salida.mjs antes.csv despues.csv | node scripts/conta/salida-segura.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { leerCuentas } from './cuentas-comparar.mjs'

const VALOR = /^(?:-?\d{1,15}|[0-9a-f]{16,64})$/
const corta = (f) => f.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'cuenta'

/** Líneas «@@ clave valor» para la puerta de salida. */
export function lineasDeSalida(antes, despues, seccion = 'ensayo_vuelta_atras') {
  const out = [`@@ # ${seccion}`]
  const porFichero = new Map()
  let distintas = 0
  for (const k of new Set([...antes.keys(), ...despues.keys()])) {
    const fichero = k.split(' · ')[0]
    const n = (porFichero.get(fichero) ?? 0) + 1
    porFichero.set(fichero, n)
    const base = `${corta(fichero)}.${n}`
    const a = antes.get(k)
    const d = despues.get(k)
    if (a !== undefined && VALOR.test(a)) out.push(`@@ ${base}.antes ${a}`)
    if (d !== undefined && VALOR.test(d)) out.push(`@@ ${base}.despues ${d}`)
    if (a !== d) { distintas++; out.push(`@@ ${base}.distinta 1`) }
  }
  out.push(`@@ medidas ${antes.size}`, `@@ distintas ${distintas}`)
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , fa, fd, seccion] = process.argv
  const leer = (f) => { try { return readFileSync(f, 'utf8') } catch { return '' } }
  console.log(lineasDeSalida(leerCuentas(leer(fa)), leerCuentas(leer(fd)), seccion).join('\n'))
}
