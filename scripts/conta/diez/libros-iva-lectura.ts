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

const BD = 'C0008'
const MESES = ['202601', '202602', '202603', '202604', '202605', '202606', '202607', '202608', '202609']

/** Lo que trae una página del listado de Diez ($top del cliente). */
const PAGINA = 200
/** El número de documento más alto que se pide al trocear un día (en 2026 Foodint va por el 3.100). */
const DOCUMENTO_MAX = 9999
const TRAMO = 150
/** Los tramos [desde, hasta] de documento, de 1 a max, de n en n. */
export function tramosDocumento(max: number, n: number): [number, number][] {
  const out: [number, number][] = []
  for (let a = 1; a <= max; a += n) out.push([a, Math.min(a + n - 1, max)])
  return out
}
/** Los días AAAAMMDD de un mes AAAAMM a otro, ambos incluidos. */
export function diasEntre(desde: string, hasta: string): number[] {
  const out: number[] = []
  const d = new Date(Date.UTC(Number(desde.slice(0, 4)), Number(desde.slice(4, 6)) - 1, 1))
  const fin = new Date(Date.UTC(Number(hasta.slice(0, 4)), Number(hasta.slice(4, 6)), 0))
  for (; d <= fin; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate())
  return out
}
/** Una huella publicable (16 cifras hexadecimales). */
export const huella = (f: string) => createHash('md5').update(f).digest('hex').slice(0, 16)
/** Los céntimos de un importe de Diez (double), redondeados. */
export const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)
/** El trimestre (1–4) de una fecha AAAAMMDD. */
export const trimestre = (aaaammdd: unknown) => Math.floor((Math.floor(Number(aaaammdd) / 100) % 100 - 1) / 3) + 1
/** Los tramos de IVA de una factura: hasta 8 (BaseImponibleN, PorcentajeIVAN, CuotaIVAN). */
export function tramos(f: Record<string, unknown>) {
  const t: { base: number; tipo: number; cuota: number }[] = []
  for (let n = 1; n <= 8; n++) {
    const base = cent(f[`BaseImponible${n}`]), cuota = cent(f[`CuotaIVA${n}`]), tipo = Number(f[`PorcentajeIVA${n}`] ?? 0)
    if (base !== 0 || cuota !== 0) t.push({ base, tipo, cuota })
  }
  return t
}
const libro = (f: Factura) => (String(f.Serie) === '1' ? 'expedidas' : String(f.Serie) === '2' ? 'recibidas' : 'otras')
const clave = (f: Factura) => `${f.Ejercicio}/${f.Serie}/${f.Documento}`
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

  // Día a día (run 39116056722): leído por meses, el listado de Diez pagina
  // con $top/$skip sin orden fijo y devolvió 431 facturas repetidas en lugar
  // de 431 que se saltó (198 + 160 + 73, justo los «asientos sin factura»). Un
  // día cabe en una página (TAM_PAGINA): sin pasar de página, no se repite ni
  // se salta nada. Si un día llenara la página, se dice.
  const filas: Factura[] = []
  let dias = 0, sinContestar = 0, diasLlenos = 0, tramosLlenos = 0
  for (const d of diasEntre(MESES[0], MESES[MESES.length - 1])) {
    try {
      let del = await c.todas<Factura>(`/api/facturas?$filter=${encodeURIComponent(`Fecha ge ${d} and Fecha le ${d}`)}`)
      if (del.length >= PAGINA) {
        // Run 39117078574: un día del 3T llenó la página y repitió 134 en lugar
        // de otras 134. Ese día se vuelve a pedir en tramos de documento, cada
        // uno en una página.
        diasLlenos++
        del = []
        for (const [a, b] of tramosDocumento(DOCUMENTO_MAX, TRAMO)) {
          const t = await c.todas<Factura>(`/api/facturas?$filter=${encodeURIComponent(`Fecha ge ${d} and Fecha le ${d} and Documento ge ${a} and Documento le ${b}`)}`)
          if (t.length >= PAGINA) tramosLlenos++
          del.push(...t)
        }
      }
      filas.push(...del); dias++
    } catch { sinContestar++; sale(`dia_sin_contestar.${d}`, 1) }
  }
  seccion('lectura')
  sale('dias_leidos', dias); sale('dias_sin_contestar', sinContestar); sale('dias_con_la_pagina_llena', diasLlenos); sale('tramos_de_documento_llenos', tramosLlenos); sale('filas', filas.length)

  // Repetidas en el listado: ¿la misma o distinta?
  const porClave = new Map<string, Factura[]>()
  for (const f of filas) porClave.set(clave(f), [...(porClave.get(clave(f)) ?? []), f])
  let repetidas = 0, repetidasDistintas = 0
  for (const fs of porClave.values()) {
    if (fs.length < 2) continue
    repetidas++
    if (new Set(fs.map((f) => JSON.stringify(f))).size > 1) repetidasDistintas++
  }
  const unicas = [...porClave.values()].map((fs) => fs[0])
  sale('facturas_distintas', unicas.length); sale('claves_repetidas', repetidas); sale('claves_repetidas_con_contenido_distinto', repetidasDistintas)

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
    const k = nombreCampo(campo)
    sale(`recibidas.por_${k}.sin_fecha`, sinFecha)
    for (const [q, cuota] of [...porQ].sort((a, b) => a[0] - b[0])) sale(`recibidas.por_${k}.${q === 0 ? 'otro_anio' : `${q}t`}.huella_cuotas`, huella(String(cuota)))
  }
  if (process.env.SUMIED_JSON) cruzar(unicas, JSON.parse(readFileSync(process.env.SUMIED_JSON, 'utf8')) as AsientoSumied[])
  sale('peticiones', c.metrica.peticiones)
}

/** Un asiento traído de Diez en Sumied, con su IVA (céntimos): lo vuelca el workflow con conta_lectura. */
export type AsientoSumied = { e: string; s: string; n: number; f: string; c477: number; c472: number }

/** La cuota de una factura de Diez, en céntimos (todos sus tramos). */
export const cuotaFactura = (f: Record<string, unknown>) => tramos(f).reduce((t, x) => t + x.cuota, 0)

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
