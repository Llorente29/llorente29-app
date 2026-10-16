#!/usr/bin/env node
// scripts/conta/staging/comparar.mjs — ¿se ha quedado staging atrás de producción?
//
// W02 (16/10). C encontró a mano que a staging le faltaba una migración de
// producción (20261113T0100, el céntimo del IVA) y que había funciones con
// otro cuerpo, una firma distinta y tablas y columnas de más o de menos. Esto
// lo hace cada noche y antes de cada tanda, con su método: la huella de prosrc
// de cada función de public, las columnas de cada tabla y los disparadores.
//
//   node scripts/conta/staging/comparar.mjs produccion.tsv staging.tsv [aceptadas.txt] [detalle.md]
//
// Las dos fotos las saca scripts/conta/staging/comparar.sql, la MISMA consulta
// a los dos lados (regla 31). Lo que sale por la salida estándar va por la
// puerta de salida (scripts/conta/salida-segura.mjs): solo «@@ clave valor»,
// con el nombre del objeto del esquema en la clave y su huella en el valor.
// Nombres de tablas, columnas, funciones y disparadores: estructura, no datos.
// El detalle (las firmas enteras) va a un fichero que no se publica.
//
// Una diferencia que no está aceptada POR SU NOMBRE en aceptadas.txt es roja, y
// el proceso sale con 1. Aceptada no es escondida (regla 7): sale igual, en su
// sección, con su recuento.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

export const OBJETOS = ['tabla', 'columna', 'funcion', 'disparador']
export const DIFERENCIAS = ['solo_produccion', 'solo_staging', 'distinta', 'cuerpo', 'atributos']

/** Una foto: «tipo\tnombre\thuella» por línea → Map(tipo → Map(nombre → huella)). */
export function leerFoto(texto) {
  const foto = new Map(OBJETOS.map((o) => [o, new Map()]))
  for (const l of String(texto).split('\n')) {
    if (!l.trim()) continue
    const [tipo, nombre, huella] = l.split('\t')
    if (!foto.has(tipo) || !nombre || !huella) throw new Error(`foto: línea que no se entiende (${l.slice(0, 80)})`)
    foto.get(tipo).set(nombre, huella)
  }
  return foto
}

/**
 * Las aceptadas: «objeto | diferencia | nombre exacto | motivo» por línea. El
 * motivo es obligatorio: una aceptada sin porqué es un filtro, no una decisión.
 */
export function leerAceptadas(texto) {
  const out = new Map()
  String(texto ?? '').split('\n').forEach((bruta, i) => {
    const l = bruta.trim()
    if (!l || l.startsWith('#')) return
    const partes = l.split('|').map((x) => x.trim())
    const [objeto, diferencia, nombre, motivo] = partes
    if (partes.length !== 4 || !OBJETOS.includes(objeto) || !DIFERENCIAS.includes(diferencia) || !nombre || !motivo) {
      throw new Error(`aceptadas, línea ${i + 1}: «objeto | diferencia | nombre | motivo» (${l.slice(0, 80)})`)
    }
    out.set(`${objeto}|${diferencia}|${nombre}`, motivo)
  })
  return out
}

/** La tabla de un «tabla.columna» o «tabla.disparador». */
const tablaDe = (n) => n.slice(0, n.indexOf('.'))

/**
 * Las diferencias, una por objeto. Una tabla que solo está en un lado es UNA
 * diferencia (sus columnas y disparadores no se cuentan otra vez). Una función
 * en los dos lados con la misma firma: «cuerpo» si cambia prosrc, «atributos»
 * si cambia lo demás (lo que devuelve, security definer, volatilidad, config).
 */
export function comparar(prod, stag) {
  const difs = []
  const soloEn = (lado) => (lado === 'produccion' ? prod : stag)
  const tablasSolo = { produccion: new Set(), staging: new Set() }
  for (const [lado, otro] of [['produccion', 'staging'], ['staging', 'produccion']]) {
    for (const t of soloEn(lado).get('tabla').keys()) {
      if (!soloEn(otro).get('tabla').has(t)) { tablasSolo[lado].add(t); difs.push({ objeto: 'tabla', diferencia: `solo_${lado}`, nombre: t }) }
    }
  }
  const tablaSuelta = (n) => tablasSolo.produccion.has(tablaDe(n)) || tablasSolo.staging.has(tablaDe(n))
  for (const objeto of ['columna', 'disparador', 'funcion']) {
    const p = prod.get(objeto), s = stag.get(objeto)
    for (const [n, h] of p) {
      if (objeto !== 'funcion' && tablaSuelta(n)) continue
      if (!s.has(n)) difs.push({ objeto, diferencia: 'solo_produccion', nombre: n })
      else if (s.get(n) !== h) {
        if (objeto !== 'funcion') difs.push({ objeto, diferencia: 'distinta', nombre: n })
        else {
          const [cp, ap] = h.split('|'), [cs, as] = s.get(n).split('|')
          // Las dos huellas viajan con la diferencia: «staging tiene la de
          // antes» se escribe pegándolas, no recordando otra foto (16/10).
          if (cp !== cs) difs.push({ objeto, diferencia: 'cuerpo', nombre: n, prod: cp, stag: cs })
          if (ap !== as) difs.push({ objeto, diferencia: 'atributos', nombre: n, prod: ap, stag: as })
        }
      }
    }
    for (const n of s.keys()) {
      if (objeto !== 'funcion' && tablaSuelta(n)) continue
      if (!p.has(n)) difs.push({ objeto, diferencia: 'solo_staging', nombre: n })
    }
  }
  return difs.sort((a, b) => (a.objeto + a.diferencia + a.nombre).localeCompare(b.objeto + b.diferencia + b.nombre))
}

/** La parte del nombre que va en la clave: sin los argumentos de una función. */
export const corto = (d) => (d.objeto === 'funcion' ? d.nombre.slice(0, d.nombre.indexOf('(')) : d.nombre)
const LETRA = { tabla: 't', columna: 'c', funcion: 'f', disparador: 'd' }
const huella16 = (s) => createHash('md5').update(s).digest('hex').slice(0, 16)

/**
 * Lo que pasa por la puerta: «@@ # rojas.funcion.cuerpo» y una línea por
 * objeto, «@@ f.journal_entry_validar <md5 de la firma entera, 16>». La letra
 * delante porque la clave tiene que empezar por letra (y hay funciones que
 * empiezan por «_»). Una clave de más de 48 caracteres no pasa, y por eso el
 * recuento va aparte: el total no lo esconde nadie.
 */
export function salida(difs, aceptadas, iguales) {
  const out = []
  const rojas = difs.filter((d) => !aceptadas.has(`${d.objeto}|${d.diferencia}|${d.nombre}`))
  const vistas = difs.filter((d) => aceptadas.has(`${d.objeto}|${d.diferencia}|${d.nombre}`))
  out.push('@@ # resumen')
  out.push(`@@ rojas ${rojas.length}`, `@@ aceptadas ${vistas.length}`)
  for (const o of OBJETOS) out.push(`@@ iguales.${o} ${iguales[o] ?? 0}`)
  const usadas = new Set(difs.map((d) => `${d.objeto}|${d.diferencia}|${d.nombre}`))
  out.push(`@@ aceptadas_que_ya_no_hacen_falta ${[...aceptadas.keys()].filter((k) => !usadas.has(k)).length}`)
  for (const [grupo, lista] of [['rojas', rojas], ['aceptadas', vistas]]) {
    let actual = ''
    for (const d of lista) {
      const sec = `${grupo}.${d.objeto}.${d.diferencia}`
      if (sec !== actual) { out.push(`@@ # ${sec}`); actual = sec }
      out.push(`@@ ${LETRA[d.objeto]}.${corto(d)} ${huella16(d.nombre)}`)
      // De una función roja, también lo largo de su firma: si una aceptada no
      // casa, dice en qué se diferencia el nombre sin enseñarlo.
      if (grupo === 'rojas' && d.objeto === 'funcion') out.push(`@@ ${LETRA[d.objeto]}.${corto(d)}.largo ${d.nombre.length}`)
      // De una función con otro cuerpo (o atributos), la huella a cada lado:
      // los 16 primeros de md5(prosrc), lo mismo que left(md5(prosrc), 16) a
      // mano. En las aceptadas también: aceptar no es dejar de mirar.
      if (d.prod && d.stag) out.push(`@@ ${LETRA[d.objeto]}.${corto(d)}.prod ${d.prod.slice(0, 16)}`, `@@ ${LETRA[d.objeto]}.${corto(d)}.stag ${d.stag.slice(0, 16)}`)
    }
  }
  return { texto: out.join('\n') + '\n', rojas, vistas }
}

/** El detalle, con las firmas enteras y el motivo de cada aceptada: a un fichero. */
export function detalle(difs, aceptadas) {
  const l = ['| objeto | diferencia | nombre | huella | producción | staging | aceptada |', '|---|---|---|---|---|---|---|']
  for (const d of difs) {
    const m = aceptadas.get(`${d.objeto}|${d.diferencia}|${d.nombre}`)
    l.push(`| ${d.objeto} | ${d.diferencia} | \`${d.nombre}\` | ${huella16(d.nombre)} | ${d.prod ? d.prod.slice(0, 16) : ''} | ${d.stag ? d.stag.slice(0, 16) : ''} | ${m ?? '**no: roja**'} |`)
  }
  return l.join('\n') + '\n'
}

/** Cuántos objetos de cada tipo son iguales a los dos lados (la otra mitad del número). */
export function iguales(prod, stag) {
  const out = {}
  for (const o of OBJETOS) {
    let n = 0
    for (const [k, h] of prod.get(o)) if (stag.get(o).get(k) === h) n++
    out[o] = n
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [fProd, fStag, fAcep = 'scripts/conta/staging/diferencias-aceptadas.txt', fDetalle] = process.argv.slice(2)
  const prod = leerFoto(readFileSync(fProd, 'utf8'))
  const stag = leerFoto(readFileSync(fStag, 'utf8'))
  // Una foto vacía no es «todo igual»: es que no se ha leído nada.
  for (const [lado, f] of [['produccion', prod], ['staging', stag]]) {
    if (f.get('funcion').size === 0 || f.get('tabla').size === 0) { console.log(`@@ foto_vacia.${lado} 1`); process.exit(2) }
  }
  const acep = leerAceptadas(existsSync(fAcep) ? readFileSync(fAcep, 'utf8') : '')
  const difs = comparar(prod, stag)
  const r = salida(difs, acep, iguales(prod, stag))
  process.stdout.write(r.texto)
  if (fDetalle) writeFileSync(fDetalle, detalle(difs, acep))
  process.exitCode = r.rojas.length ? 1 : 0
}
