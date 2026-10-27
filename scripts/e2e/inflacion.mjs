#!/usr/bin/env node
// scripts/e2e/inflacion.mjs <informe.json> [--tiempos]
//
// W02 (paso 1c): ¿aguanta staging (Micro) cuatro navegadores a la vez? Si no,
// lo primero que se nota es que las MISMAS pruebas tardan más. Esto compara lo
// que ha tardado cada fichero en este run (el informe JSON de Playwright, los
// trozos juntos) con lo que tardó en la entera en serie del 16/10
// (tests/e2e/tiempos.json), con la misma vara: la suma de las duraciones de
// sus pruebas, los dos tamaños.
//
// Con --tiempos escribe, en vez de la tabla, un tiempos.json nuevo con lo de
// este run (para cuando la suite cambie mucho).
//
// Con --nuevos <salida.json> (27/10, Respuesta 2 al V04): los ficheros de este
// run que aún no tienen tiempo en tiempos.json, medidos con la misma vara. Los
// pinta en una tabla y escribe en <salida.json> el tiempos.json de hoy con
// ellos dentro, para cambiarlo de un golpe en un commit que solo toque ese
// fichero. Así un PR con una e2e nueva no apunta nada en ningún sitio: la
// entera la mide y propone sacarla de «sin medir».

import { readFileSync, writeFileSync } from 'node:fs'
import { tiemposDelRepo } from './trozos.mjs'

export function porFichero(informe) {
  const t = {}
  const andar = (s, fichero) => {
    const f = s.file ?? fichero
    for (const spec of s.specs ?? []) {
      const ff = (spec.file ?? f ?? '').replace(/^tests\/e2e\//, '')
      for (const test of spec.tests ?? []) for (const r of test.results ?? []) t[ff] = (t[ff] ?? 0) + (r.duration ?? 0) / 1000
    }
    for (const h of s.suites ?? []) andar(h, f)
  }
  for (const s of informe.suites ?? []) andar(s, s.file)
  return t
}

/** Lo de este run que no tenía tiempo: { nuevos: {fichero: s}, propuesto: tiempos.json con ellos }. */
export function nuevos(ahora, antes) {
  const n = {}
  for (const k of Object.keys(ahora).sort()) if (typeof antes[k] !== 'number' && ahora[k] > 0) n[k] = Math.round(ahora[k] * 10) / 10
  const propuesto = { ...antes, ...n }
  const orden = Object.keys(propuesto).sort((a, b) => (a.startsWith('_') === b.startsWith('_') ? a.localeCompare(b) : a.startsWith('_') ? -1 : 1))
  return { nuevos: n, propuesto: Object.fromEntries(orden.map((k) => [k, propuesto[k]])) }
}

export function comparar(ahora, antes) {
  const filas = Object.keys(ahora).filter((f) => typeof antes[f] === 'number' && antes[f] > 0)
    .map((f) => ({ f, antes: antes[f], ahora: ahora[f], x: ahora[f] / antes[f] }))
    .sort((a, b) => b.antes - a.antes)
  const sa = filas.reduce((s, r) => s + r.antes, 0), sn = filas.reduce((s, r) => s + r.ahora, 0)
  return { filas, antes: sa, ahora: sn, x: sa ? sn / sa : null }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const informe = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const ahora = porFichero(informe)
  const iNuevos = process.argv.indexOf('--nuevos')
  if (iNuevos > 0) {
    const r = nuevos(ahora, tiemposDelRepo())
    writeFileSync(process.argv[iNuevos + 1], JSON.stringify(r.propuesto, null, 1) + '\n')
    const k = Object.keys(r.nuevos)
    console.log(`### Medidos ahora, que no tenían tiempo (${k.length})\n`)
    if (!k.length) console.log('Ninguno: todo lo que ha corrido ya tenía su tiempo en tests/e2e/tiempos.json.')
    else {
      console.log('| fichero | s, los dos tamaños |'); console.log('|---|---:|')
      for (const f of k) console.log(`| ${f} | ${r.nuevos[f].toFixed(1)} |`)
      console.log('\nPara sacarlos de «sin medir»: el artefacto «tiempos-propuestos» es tests/e2e/tiempos.json con ellos dentro. Va en un commit que solo cambia ese fichero.')
    }
  } else if (process.argv.includes('--tiempos')) {
    const viejo = tiemposDelRepo()
    const o = Object.fromEntries(Object.keys(viejo).filter((k) => k.startsWith('_')).map((k) => [k, viejo[k]]))
    for (const k of Object.keys(ahora).sort()) o[k] = Math.round(ahora[k] * 10) / 10
    console.log(JSON.stringify(o, null, 1))
  } else {
    const c = comparar(ahora, tiemposDelRepo())
    const m = (s) => (s / 60).toFixed(1)
    console.log(`### ¿Aguanta staging? Las mismas pruebas, en serie (16/10) y ahora\n`)
    console.log(`En los ${c.filas.length} ficheros que estaban en la entera en serie: **${m(c.antes)} min** entonces, **${m(c.ahora)} min** ahora sumando los trozos (× ${c.x?.toFixed(2)}).\n`)
    console.log('| fichero | 16/10, en serie (s) | ahora (s) | × |'); console.log('|---|---:|---:|---:|')
    for (const r of c.filas.slice(0, 12)) console.log(`| ${r.f} | ${r.antes.toFixed(0)} | ${r.ahora.toFixed(0)} | ${r.x.toFixed(2)} |`)
  }
}
