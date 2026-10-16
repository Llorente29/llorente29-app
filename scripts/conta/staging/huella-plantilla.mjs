#!/usr/bin/env node
// scripts/conta/staging/huella-plantilla.mjs — ¿ha cambiado la plantilla sin un fichero?
//
// W02 (16/10), la regla de la plantilla, punto 5. Compara la huella de esta
// noche (plantilla_huella.sql) con la de la anterior:
//
//   node scripts/conta/staging/huella-plantilla.mjs anterior.tsv actual.tsv
//
// · Sin anterior: es la primera foto. Verde.
// · Tablas con otra huella y el historial de staging (#registro) igual: alguien
//   ha cambiado la plantilla sin fichero registrado. ROJO (sale con 1).
// · Tablas con otra huella y el historial también distinto: ha entrado un
//   fichero. Se dice cuántas y cuáles, en verde: es lo que pide la regla.
//
// Mientras queden ramas con la e2e de antes (escribe en la plantilla, sin
// carril), esto saldrá en rojo cada noche que haya corrido una: es verdad, la
// plantilla ha cambiado sin fichero. Deja de pasar cuando todas usen carril.
//
// Por la puerta de salida: nombres de tablas y huellas, nada de datos.

import { existsSync, readFileSync } from 'node:fs'

export function leer(texto) {
  const m = new Map()
  for (const l of String(texto ?? '').split('\n')) {
    if (!l.trim()) continue
    const [k, h] = l.split('\t')
    if (k && h) m.set(k, h)
  }
  return m
}

/** Las tablas que cambian (o aparecen, o desaparecen) entre dos fotos; sin #registro. */
export function cambios(antes, ahora) {
  const t = new Set([...antes.keys(), ...ahora.keys()].filter((k) => !k.startsWith('#')))
  return [...t].filter((k) => antes.get(k) !== ahora.get(k)).sort()
}

export function veredicto(antes, ahora) {
  if (!antes.size) return { estado: 'primera', tablas: [] }
  const tablas = cambios(antes, ahora)
  if (!tablas.length) return { estado: 'igual', tablas }
  return { estado: antes.get('#registro') === ahora.get('#registro') ? 'sin_fichero' : 'con_fichero', tablas }
}

const h16 = (h) => (/^[0-9a-f]{32}$/.test(h ?? '') ? h.slice(0, 16) : '0'.repeat(16))

export function salida(antes, ahora) {
  const v = veredicto(antes, ahora)
  const out = ['@@ # plantilla', `@@ tablas ${[...ahora.keys()].filter((k) => !k.startsWith('#')).length}`, `@@ cambiadas ${v.tablas.length}`,
    `@@ primera_foto ${v.estado === 'primera' ? 1 : 0}`, `@@ sin_fichero ${v.estado === 'sin_fichero' ? 1 : 0}`]
  if (v.tablas.length) {
    out.push(`@@ # plantilla.${v.estado === 'sin_fichero' ? 'roja_sin_fichero' : 'con_fichero'}`)
    for (const t of v.tablas) out.push(`@@ p.${t} ${h16(ahora.get(t))}`)
  }
  return { texto: out.join('\n') + '\n', v }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [fAntes, fAhora] = process.argv.slice(2)
  const ahora = leer(readFileSync(fAhora, 'utf8'))
  if (!ahora.has('#registro') || ahora.size < 2) { console.log('@@ foto_vacia 1'); process.exit(2) }
  const antes = leer(fAntes && existsSync(fAntes) ? readFileSync(fAntes, 'utf8') : '')
  const r = salida(antes, ahora)
  process.stdout.write(r.texto)
  process.exitCode = r.v.estado === 'sin_fichero' ? 1 : 0
}
