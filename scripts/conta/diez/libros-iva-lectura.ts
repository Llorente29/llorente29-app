// scripts/conta/diez/libros-iva-lectura.ts
//
// I01b · Los libros de IVA de Diez (18/10). PRIMER PASO, SOLO LEYENDO.
//
// La importación del histórico (C04b) trajo el diario de Diez (/api/apuntes)
// pero no sus libros registro de IVA (/api/facturas): en Sumied, el libro de
// IVA de Foodint empieza el 01/10/2026 y el 303 de un trimestre traído no se
// puede calcular. Antes de escribir nada, esto mide en C0008, trimestre a
// trimestre de 2026, lo que hay en las facturas de Diez:
//   · cuántas hay por libro (serie 1 expedidas, serie 2 recibidas, otras) y por
//     tipo de factura (1 normal; 6 y 7, abonos);
//   · cuántas veces sale repetida la misma (Ejercicio/Serie/Documento) en el
//     listado, y si las repetidas son idénticas;
//   · los tipos de IVA que usan, cuántos tipos lleva cada una, y si hay
//     recargo o retención;
//   · cuántas recibidas son de otro trimestre por su fecha de factura;
//   · los NOMBRES de los campos que trae una factura (para el mapeo);
//   · la suma de cuotas de cada libro y trimestre, como HUELLA (md5 de los
//     céntimos, 16 cifras): se compara fuera con la misma huella de la 477 y la
//     472 del diario de Sumied, sin sacar ningún importe.
//
// Frenos (los de patrones-ventas-c0008.ts):
//   · el cliente se crea con escribir: false: no puede escribir nada;
//   · TODA la salida es «@@ clave número|huella» y pasa por
//     scripts/conta/salida-segura.mjs: ni números de factura, ni NIF, ni
//     nombres, ni importes.
//
//   DIEZ_LECTURA='{…}' npx tsx scripts/conta/diez/libros-iva-lectura.ts

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ClienteDiez, type AlmacenToken, type Factura } from '../../../supabase/functions/_shared/diezCliente.ts'
import { cent, cuotaFactura, diasEntre, leerFacturas, tramos, tramosDocumento, trimestre } from './libros-iva-mapeo.ts'

// Las piezas puras viven en libros-iva-mapeo.ts (las usa también el importador).
export { cent, cuotaFactura, diasEntre, tramos, tramosDocumento, trimestre }

const BD = 'C0008'
const MESES = ['202601', '202602', '202603', '202604', '202605', '202606', '202607', '202608', '202609']

/** Una huella publicable (16 cifras hexadecimales). */
export const huella = (f: string) => createHash('md5').update(f).digest('hex').slice(0, 16)
const libro = (f: Factura) => (String(f.Serie) === '1' ? 'expedidas' : String(f.Serie) === '2' ? 'recibidas' : 'otras')
const nombreCampo = (k: string) => k.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40)

const sale = (k: string, v: number | string) => process.stdout.write(`@@ ${k} ${v}\n`)
const seccion = (k: string) => process.stdout.write(`@@ # ${k}\n`)

async function main() {
  const cred = JSON.parse(process.env.DIEZ_LECTURA || 'null')
  if (!cred) { sale('falta_secreto', 1); process.exit(1) }
  let guardado: { token: string; expiresAt: string } | null = null
  const almacen: AlmacenToken = { leer: async () => guardado, guardar: async (token, expiresAt) => { guardado = { token, expiresAt } }, caida: async () => { guardado = null } }
  const c = new ClienteDiez({
    base: String(cred.base_url || 'https://apicon.diezsoftware.com'), nombreBd: BD,
    credenciales: { grant_type: cred.grant_type, client_id: cred.client_id, client_secret: cred.client_secret, username: cred.username, password: cred.password },
    almacen, escribir: false, pausaMs: 150,
  })
  try { await c.asegurarToken() } catch (e) {
    const x = e as { name?: string; status?: number }
    sale('entra_c0008', 0)
    sale(`error_${String(x.name ?? 'error').toLowerCase().replace(/[^a-z]/g, '')}`, Number(x.status ?? 0))
    process.exit(1)
  }
  sale('entra_c0008', 1)

  // Día a día, y el día que llena la página en tramos de documento
  // (libros-iva-mapeo.ts: runs 39116056722 y 39117078574).
  const l = await leerFacturas(c, MESES[0], MESES[MESES.length - 1])
  for (const d of l.sinContestar) sale(`dia_sin_contestar.${d}`, 1)
  seccion('lectura')
  sale('dias_leidos', l.dias); sale('dias_sin_contestar', l.sinContestar.length); sale('dias_con_la_pagina_llena', l.diasLlenos); sale('tramos_de_documento_llenos', l.tramosLlenos); sale('filas', l.filas)
  const unicas = l.facturas
  sale('facturas_distintas', unicas.length); sale('claves_repetidas', l.repetidas); sale('claves_repetidas_con_contenido_distinto', l.repetidasDistintas)

  // Los nombres de los campos (no sus valores).
  seccion('campos')
  const campos = new Map<string, number>()
  for (const f of unicas) for (const [k, v] of Object.entries(f)) if (v !== null && v !== undefined && v !== '' && v !== 0) campos.set(nombreCampo(k), (campos.get(nombreCampo(k)) ?? 0) + 1)
  for (const [k, n] of [...campos].sort()) sale(`campo.${k}`, n)

  // Por libro y trimestre (del asiento, como el diario).
  for (const lib of ['expedidas', 'recibidas', 'otras']) {
    for (const q of [1, 2, 3]) {
      const fs = unicas.filter((f) => libro(f) === lib && trimestre(f.Fecha) === q)
      if (fs.length === 0 && lib === 'otras') continue
      seccion(`${lib}_${q}t`)
      const p = `${lib}.${q}t`
      sale(`${p}.facturas`, fs.length)
      const tiposFactura = new Map<number, number>()
      const tipos = new Map<number, number>()
      const nTramos = new Map<number, number>()
      let cuota = 0, base = 0, conRecargo = 0, conRetencion = 0, deOtroTrimestre = 0, sinTramos = 0
      for (const f of fs) {
        const tf = Number(f.TipoFactura ?? 0)
        tiposFactura.set(tf, (tiposFactura.get(tf) ?? 0) + 1)
        const t = tramos(f)
        if (t.length === 0) sinTramos++
        nTramos.set(t.length, (nTramos.get(t.length) ?? 0) + 1)
        for (const x of t) { cuota += x.cuota; base += x.base; tipos.set(x.tipo, (tipos.get(x.tipo) ?? 0) + 1) }
        if (Object.entries(f).some(([k, v]) => /recargo/i.test(k) && Number(v) !== 0 && !Number.isNaN(Number(v)))) conRecargo++
        if (Object.entries(f).some(([k, v]) => /retencion/i.test(k) && !/tipo/i.test(k) && Number(v) !== 0 && !Number.isNaN(Number(v)))) conRetencion++
        if (f.FechaFactura && trimestre(f.FechaFactura) !== q) deOtroTrimestre++
      }
      for (const [k, n] of [...tiposFactura].sort((a, b) => a[0] - b[0])) sale(`${p}.tipo_factura_${k}`, n)
      for (const [k, n] of [...tipos].sort((a, b) => a[0] - b[0])) sale(`${p}.tramos_al_${String(k).replace('.', '_')}`, n)
      for (const [k, n] of [...nTramos].sort((a, b) => a[0] - b[0])) sale(`${p}.con_${k}_tramos`, n)
      sale(`${p}.sin_tramos`, sinTramos); sale(`${p}.con_recargo`, conRecargo); sale(`${p}.con_retencion`, conRetencion)
      sale(`${p}.fecha_factura_de_otro_trimestre`, deOtroTrimestre)
      // Las sumas, solo como huella: se comparan fuera con la del diario de Sumied.
      sale(`${p}.huella_cuotas`, huella(String(cuota)))
      sale(`${p}.huella_bases`, huella(String(base)))
    }
  }
  // ¿En qué trimestre se dedujo cada recibida? Por la fecha del asiento, la
  // 472 del 1T es 19.349,75 y el 303 dedujo 18.012,96 (y el 2T, al revés):
  // la cuota de las recibidas por trimestre de otras fechas, como huella, para
  // compararla fuera con las casillas [29]+[37] declaradas.
  seccion('recibidas_por_otras_fechas')
  for (const campo of ['FechaIntroduccionFactura', 'FechaFactura', 'FechaOperacion']) {
    const porQ = new Map<number, number>()
    let sinFecha = 0
    for (const f of unicas.filter((x) => String(x.Serie) === '2')) {
      const v = Number((f as Record<string, unknown>)[campo] ?? 0)
      if (!v) { sinFecha++; continue }
      const q = Math.floor(v / 10000) === 2026 ? trimestre(v) : 0
      porQ.set(q, (porQ.get(q) ?? 0) + cuotaFactura(f))
    }
    // Claves cortas: la puerta de salida no deja pasar más de 48 caracteres
    // (run 39118625192: las de la fecha de introducción se quedaron fuera).
    const k = ({ FechaIntroduccionFactura: 'f_intro', FechaFactura: 'f_factura', FechaOperacion: 'f_operacion' } as Record<string, string>)[campo]
    sale(`recibidas.${k}.sin_fecha`, sinFecha)
    for (const [q, cuota] of [...porQ].sort((a, b) => a[0] - b[0])) sale(`recibidas.${k}.${q === 0 ? 'otro_anio' : `${q}t`}.huella`, huella(String(cuota)))
  }
  if (process.env.SUMIED_JSON) cruzar(unicas, JSON.parse(readFileSync(process.env.SUMIED_JSON, 'utf8')) as AsientoSumied[])
  sale('peticiones', c.metrica.peticiones)
}

/** Un asiento traído de Diez en Sumied, con su IVA (céntimos): lo vuelca el workflow con conta_lectura. */
export type AsientoSumied = { e: string; s: string; n: number; f: string; c477: number; c472: number }

/**
 * El cruce, factura a factura, por (ejercicio, serie, documento): la cuota de
 * Diez contra la 477 (expedidas) o la 472 (recibidas) de su asiento en Sumied.
 * Lo que no casa sale por su NÚMERO DE DOCUMENTO (un número interno de Diez,
 * no un dato de nadie): el detalle se mira luego en Sumied, solo leyendo.
 */
export function cruce(facturas: Record<string, unknown>[], asientos: AsientoSumied[]) {
  const porClave = new Map(asientos.map((a) => [`${a.e}/${a.s}/${a.n}`, a]))
  const usadas = new Set<string>()
  type Grupo = { casan: number; distinta: number[]; mismaEnValorAbsoluto: number; sinAsiento: number[]; asientoSinFactura: number[] }
  const g = new Map<string, Grupo>()
  const de = (k: string) => { if (!g.has(k)) g.set(k, { casan: 0, distinta: [], mismaEnValorAbsoluto: 0, sinAsiento: [], asientoSinFactura: [] }); return g.get(k)! }
  for (const f of facturas) {
    const lib = String(f.Serie) === '1' ? 'expedidas' : String(f.Serie) === '2' ? 'recibidas' : 'otras'
    const k = `${f.Ejercicio}/${f.Serie}/${f.Documento}`
    const x = de(`${lib}.${trimestre(f.Fecha)}t`)
    const a = porClave.get(k)
    if (!a) { x.sinAsiento.push(Number(f.Documento)); continue }
    usadas.add(k)
    const enSumied = lib === 'recibidas' ? a.c472 : a.c477
    const cuota = cuotaFactura(f)
    if (cuota === enSumied) x.casan++
    else { x.distinta.push(Number(f.Documento)); if (Math.abs(cuota) === Math.abs(enSumied)) x.mismaEnValorAbsoluto++ }
  }
  for (const a of asientos) {
    if (usadas.has(`${a.e}/${a.s}/${a.n}`) || (a.c477 === 0 && a.c472 === 0)) continue
    const lib = a.s === '1' ? 'expedidas' : a.s === '2' ? 'recibidas' : `serie${a.s}`
    de(`${lib}.${trimestre(a.f)}t`).asientoSinFactura.push(a.n)
  }
  return g
}

const MAX_LISTA = 40
function cruzar(facturas: Record<string, unknown>[], asientos: AsientoSumied[]) {
  seccion('cruce_con_sumied')
  sale('asientos_sumied', asientos.length)
  for (const [k, x] of [...cruce(facturas, asientos)].sort()) {
    sale(`${k}.casan`, x.casan)
    sale(`${k}.cuota_distinta`, x.distinta.length)
    sale(`${k}.distinta_solo_de_signo`, x.mismaEnValorAbsoluto)
    sale(`${k}.factura_sin_asiento`, x.sinAsiento.length)
    sale(`${k}.asiento_con_iva_sin_factura`, x.asientoSinFactura.length)
    const lista = (nombre: string, ns: number[]) => ns.sort((a, b) => a - b).slice(0, MAX_LISTA).forEach((n, i) => sale(`${k}.${nombre}.${String(i + 1).padStart(2, '0')}`, n))
    lista('doc_cuota_distinta', x.distinta); lista('doc_sin_asiento', x.sinAsiento); lista('doc_asiento_sin_factura', x.asientoSinFactura)
  }
}

// Solo corre como programa (la prueba importa las funciones puras).
if (process.argv[1] && process.argv[1].endsWith('libros-iva-lectura.ts')) await main()
