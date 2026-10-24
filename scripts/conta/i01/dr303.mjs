#!/usr/bin/env node
// scripts/conta/i01/dr303.mjs
//
// I01a · 5 · EL DISEÑO DE REGISTRO DEL 303 DE 2026, sacado del Excel oficial de
// la AEAT (DR303e26v101.xlsx) y nunca escrito a mano. De cada hoja que hace
// falta para un 303 de régimen general se leen, fila a fila, el número, la
// posición, la longitud, el tipo, la descripción, la casilla ([NN]) y la
// constante si la hay:
//
//   · DP30300 · la cabecera (<T3030…> <AUX> … </AUX> … </T3030…>);
//   · DP30301 · la página 01 (identificación y régimen general);
//   · DP30303 · la página 03 (información adicional y resultado);
//   · DP303DID · la cuenta (domiciliación o devolución).
//
// Las páginas 02 (régimen simplificado), 04 (exonerados del 390) y 05
// (prorrata) no se generan: quien las necesite, de momento, no presenta desde
// Sumied (lo dice la comprobación del 303).
//
// Escribe:
//   · docs/conta/referencia/dr303e26v101.json — el diseño, con la huella del
//     Excel del que sale (el Excel no se sube: es de la AEAT);
//   · supabase/functions/_shared/impuestos/dr303e26v101.ts — el mismo diseño,
//     para el generador (Deno y las pruebas).
//
//   node scripts/conta/i01/dr303.mjs            → baja el Excel y genera
//   node scripts/conta/i01/dr303.mjs comprobar  → sin red: rehace el .ts desde
//                                                 el .json y falla si no es igual

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const URL_EXCEL = 'https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_300_399/archivos_26/DR303e26v101.xlsx'
export const INDICE = 'https://sede.agenciatributaria.gob.es/Sede/ayuda/disenos-registro/modelos-300-399.html'
export const REFERENCIA = 'docs/conta/referencia/dr303e26v101.json'
export const MODULO = 'supabase/functions/_shared/impuestos/dr303e26v101.ts'
export const HOJAS = ['DP30300', 'DP30301', 'DP30303', 'DP303DID']

const entidades = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const texto = (xml) => entidades([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''))
const columna = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1

/** Las filas con contenido de cada hoja, como listas de celdas de texto. */
export function leerExcel(ruta) {
  const unzip = (dentro) => execFileSync('unzip', ['-p', ruta, dentro], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const compartidas = [...unzip('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texto(m[1]))
  const libro = unzip('xl/workbook.xml')
  const rels = unzip('xl/_rels/workbook.xml.rels')
  const hojas = {}
  for (const m of libro.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g)) {
    const destino = rels.match(new RegExp(`Id="${m[2]}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${m[2]}"`))?.[1]
    if (!destino) continue
    const xml = unzip(`xl/${destino.replace(/^\/?xl\//, '')}`)
    const filas = []
    for (const f of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const celdas = []
      for (const c of f[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const atr = c[1]
        const ref = atr.match(/\br="([A-Z]+\d+)"/)?.[1]
        if (!ref) continue
        const tipo = atr.match(/\bt="([^"]+)"/)?.[1]
        const cuerpo = c[2] ?? ''
        let v = null
        if (tipo === 's') v = compartidas[Number(cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1])]
        else if (tipo === 'inlineStr') v = texto(cuerpo)
        else v = cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? null
        if (v !== null && v !== undefined && String(v).trim() !== '') celdas[columna(ref)] = entidades(String(v)).replace(/\s+/g, ' ').trim()
      }
      if (celdas.some((x) => x)) filas.push(celdas)
    }
    hojas[m[1]] = filas
  }
  return hojas
}

/** Los campos de una hoja: las filas que empiezan por un número de orden. */
export function campos(filas) {
  const cab = filas.findIndex((f) => f.includes('Nº') && f.includes('Posic.'))
  if (cab < 0) throw new Error('Sin cabecera «Nº · Posic.»')
  const col = (nombre) => filas[cab].indexOf(nombre)
  const [cN, cP, cL, cT, cD] = [col('Nº'), col('Posic.'), col('Lon'), col('Tipo'), col('Descripción')]
  const cV = col('Validación'), cC = col('Contenido')
  const out = []
  const fin = filas.findIndex((f, i) => i > cab && /^total$/i.test(f[cN] ?? ''))
  for (const f of filas.slice(cab + 1, fin < 0 ? undefined : fin)) {
    if (!/^\d+$/.test(f[cN] ?? '')) continue
    const desc = f[cD] ?? ''
    const resto = [cV >= 0 ? f[cV] : null, cC >= 0 ? f[cC] : null].filter(Boolean).join(' ')
    const constante = (resto.match(/Constante\s*"([^"]*)"/i) ?? desc.match(/Constante[.\s]*"([^"]*)"/i) ?? resto.match(/^"([^"]*)"$/)
      // Los «Tipo %» de algunas casillas (el [169]) traen el valor sin la palabra «Constante».
      ?? (/Tipo %/.test(desc) ? resto.match(/^"([^"]*)"/) : null) ?? [])[1] ?? null
    const casilla = (desc.match(/\[(\d{2,3})\]\s*$/) ?? [])[1] ?? null
    out.push({
      n: Number(f[cN]),
      pos: /^\d+$/.test(f[cP] ?? '') ? Number(f[cP]) : null,
      lon: /^\d+$/.test(f[cL] ?? '') ? Number(f[cL]) : null,
      tipo: f[cT] ?? null,
      descripcion: desc,
      casilla,
      constante,
      validacion: resto || null,
    })
  }
  // La fila TOTAL lleva el número en la primera celda numérica (en la hoja, bajo «Lon»).
  const numero = fin < 0 ? undefined : filas[fin].slice(1).find((c) => /^\d+$/.test(c ?? ''))
  return { campos: out, total: numero ? Number(numero) : null }
}

export function moduloTs(ref) {
  return `// ${MODULO}
//
// NO SE TOCA A MANO: lo escribe scripts/conta/i01/dr303.mjs desde
// ${REFERENCIA} (y este, desde el Excel oficial de la AEAT
// DR303e26v101.xlsx, sha256 ${ref.sha256}).

export interface CampoDr { n: number; pos: number | null; lon: number | null; tipo: string | null; descripcion: string; casilla: string | null; constante: string | null; validacion: string | null }
export interface HojaDr { campos: CampoDr[]; total: number | null }

export const DR303E26V101 = ${JSON.stringify({ version: ref.version, sha256: ref.sha256, hojas: ref.hojas }, null, 2)} as const satisfies { version: string; sha256: string; hojas: Record<string, HojaDr> }
`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === 'comprobar') {
    const ref = JSON.parse(readFileSync(REFERENCIA, 'utf8'))
    if (readFileSync(MODULO, 'utf8') !== moduloTs(ref)) { console.error(`${MODULO} no es el que sale de ${REFERENCIA}.`); process.exit(1) }
    console.log(`${MODULO} = ${REFERENCIA} (${Object.keys(ref.hojas).length} hojas).`)
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'dr303-'))
    const ruta = join(dir, 'DR303e26v101.xlsx')
    const r = await fetch(URL_EXCEL)
    if (!r.ok) throw new Error(`El Excel no se ha podido bajar: HTTP ${r.status}`)
    const bytes = Buffer.from(await r.arrayBuffer())
    writeFileSync(ruta, bytes)
    const hojas = leerExcel(ruta)
    const ref = {
      fuente: URL_EXCEL, indice: INDICE, descargado: new Date().toISOString(),
      version: (hojas.DP30300?.flat().join(' ').match(/versión\s*([\d.]+)/i) ?? [])[1] ?? null,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      hojas: Object.fromEntries(HOJAS.map((h) => { if (!hojas[h]) throw new Error(`Falta la hoja ${h}`); return [h, campos(hojas[h])] })),
    }
    writeFileSync(REFERENCIA, JSON.stringify(ref, null, 2) + '\n')
    writeFileSync(MODULO, moduloTs(ref))
    console.log(`Diseño ${ref.version} (sha256 ${ref.sha256.slice(0, 12)}…): ${HOJAS.map((h) => `${h} ${ref.hojas[h].campos.length} campos`).join(', ')}.`)
  }
}
