#!/usr/bin/env node
// scripts/e2e/inflacion.mjs <informe.json> [--tiempos <carpeta> | --nuevos <carpeta>]
//
// W02 (paso 1c): ¿aguanta staging (Micro) cuatro navegadores a la vez? Si no,
// lo primero que se nota es que las MISMAS pruebas tardan más. Esto compara lo
// que ha tardado cada fichero en este run (el informe JSON de Playwright, los
// trozos juntos) con lo que tardó en la entera en serie del 16/10
// (tests/e2e/tiempos/, uno por prueba), con la misma vara: la suma de las duraciones de
// sus pruebas, los dos tamaños.
//
// Con --tiempos <carpeta> escribe, en vez de la tabla, un fichero por prueba
// con lo de este run en esa carpeta (para cuando la suite cambie mucho).
//
// Con --nuevos <carpeta> (27/10, Respuesta 2 al V04; W12, 29/10): las pruebas de
// este run que aún no tienen tiempo en tests/e2e/tiempos/, medidas con la misma
// vara. Las pinta en una tabla y escribe en <carpeta> un fichero por prueba,
// con su ruta, para copiarlos tal cual en tests/e2e/tiempos/. Así un PR con una
// e2e nueva no apunta nada en ningún sitio compartido: la entera la mide y
// propone sacarla de «sin medir».

import { readFileSync, writeFileSync } from 'node:fs'
import { escribirTiempo, tiemposDelRepo } from './trozos.mjs'

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

/** Lo de este run que no tenía tiempo: { nuevos: {fichero: s} }, con la misma vara (los dos tamaños sumados). */
export function nuevos(ahora, antes) {
  const n = {}
  for (const k of Object.keys(ahora).sort()) if (typeof antes[k] !== 'number' && ahora[k] > 0) n[k] = Math.round(ahora[k] * 10) / 10
  return { nuevos: n }
}

/** De qué run sale una medida (en el workflow: el run y el commit). */
export const deDonde = () => (process.env.GITHUB_RUN_ID ? `e2e ${process.env.GITHUB_RUN_ID} en verde, ${String(process.env.GITHUB_SHA ?? '').slice(0, 8)}` : 'a mano')

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
    // W12: el artefacto «tiempos-propuestos» es una carpeta con un fichero por prueba nueva,
    // con su ruta: se copia tal cual en tests/e2e/tiempos/. Ningún fichero compartido.
    const carpeta = process.argv[iNuevos + 1]
    const r = nuevos(ahora, tiemposDelRepo())
    const k = Object.keys(r.nuevos)
    for (const f of k) escribirTiempo(f, r.nuevos[f], deDonde(), carpeta)
    console.log(`### Medidos ahora, que no tenían tiempo (${k.length})\n`)
    if (!k.length) console.log('Ninguno: todo lo que ha corrido ya tenía su tiempo en tests/e2e/tiempos/.')
    else {
      console.log('| fichero | s, los dos tamaños |'); console.log('|---|---:|')
      for (const f of k) console.log(`| ${f} | ${r.nuevos[f].toFixed(1)} |`)
      console.log('\nPara sacarlos de «sin medir»: el artefacto «tiempos-propuestos» trae un fichero por prueba, con su ruta. Cópialos tal cual en tests/e2e/tiempos/: cada uno es suyo y no choca con nadie.')
    }
  } else if (process.argv.includes('--tiempos')) {
    // Rehacerlo entero desde una entera: un fichero por prueba en la carpeta que se diga (el techo no se toca).
    const carpeta = process.argv[process.argv.indexOf('--tiempos') + 1]
    if (!carpeta) throw new Error('--tiempos <carpeta>: dónde escribir un fichero por prueba.')
    for (const k of Object.keys(ahora).sort()) escribirTiempo(k, Math.round(ahora[k] * 10) / 10, deDonde(), carpeta)
    console.log(`Escritos ${Object.keys(ahora).length} tiempos en ${carpeta}.`)
  } else {
    const c = comparar(ahora, tiemposDelRepo())
    const m = (s) => (s / 60).toFixed(1)
    console.log(`### ¿Aguanta staging? Las mismas pruebas, en serie (16/10) y ahora\n`)
    console.log(`En los ${c.filas.length} ficheros que estaban en la entera en serie: **${m(c.antes)} min** entonces, **${m(c.ahora)} min** ahora sumando los trozos (× ${c.x?.toFixed(2)}).\n`)
    console.log('| fichero | 16/10, en serie (s) | ahora (s) | × |'); console.log('|---|---:|---:|---:|')
    for (const r of c.filas.slice(0, 12)) console.log(`| ${r.f} | ${r.antes.toFixed(0)} | ${r.ahora.toFixed(0)} | ${r.x.toFixed(2)} |`)
  }
}
