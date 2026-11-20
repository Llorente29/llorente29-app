// src/modules/conta/lib/lectorRevo.ts
//
// R04 · El lector de las ventas de Revo XEF (respuesta R03 · 1, 17/11). Núcleo
// puro: ni red ni base. Los ficheros entran (nombre y contenido) y sale una
// lectura por día, en la forma exacta de `p_lectura` de conta_tpv_dia_guardar
// (R03, 0951), con un resumen al lado para enseñarlo antes de guardar.
//
// Dos pasos, como catcherQuincena:
//   1. reconocer(ficheros): qué es cada uno POR SUS TÍTULOS DE COLUMNA, no por
//      su nombre (órdenes, documentos, impuestos o pagos), y lo que no cuadra:
//      falta uno, hay dos del mismo, o uno no es de Revo.
//   2. leer(reconocidos): una lectura por día.
//
// Lo que se sabe de los ficheros (el ejemplo inventado de Julio, 16/11, con la
// forma de los reales): separados por punto y coma, coma decimal, fechas
// «AAAA-MM-DD hh:mm:ss», UTF-8 con o sin marca de inicio, finales CRLF o LF,
// espacios delante de la primera columna. La primera columna de los pagos no
// tiene título y repite la orden: no identifica nada.
//
// Las reglas (respuesta R03 · 1, §2):
//   · El día de cada cosa es la FECHA DE SU DOCUMENTO: las órdenes, los
//     impuestos y los pagos van al día del documento de su orden. Una
//     exportación por rango de fechas trae varios días: salen varias lecturas.
//   · El canal es lo que dice «Entrega», tal cual (sin espacios). La base
//     guarda «--» o vacío como «local» (conta_tpv_dia_guardar); el resumen lo
//     llama «en el local».
//   · Una factura lleva NIF y nombre solo si trae NIF: de un tique sin NIF no
//     se manda nombre ninguno (decisión 5).
//   · Cada cobro lleva su LÍNEA en el fichero de pagos (la 1 es la de los
//     títulos), la misma que ve quien abre el fichero.
//   · Las formas de pago se leen como vengan: la lista no está cerrada.
//   · Los importes, con su signo: una devolución es una factura en negativo.
//   · R10 (20/11): los importes pueden traer hasta 3 decimales (los de verdad: «28,909»,
//     «2,891» en Impuestos). Se leen en milésimas; los de Impuestos y Pagos se suman así por
//     día (y tipo de IVA, en Impuestos) y se redondea a céntimos al final, repartiendo esos
//     céntimos entre las líneas para que su suma sea la del día. En Impuestos y Documentos se
//     reparten el IVA y el total, y la base es el total menos el IVA: base + IVA = total en cada
//     línea y en el día.
//   · El lector NO decide si el día cuadra (eso lo dice la base al guardar).
//     Dice lo que no ha podido leer, sin esconder nada (regla 7): una línea con
//     un importe, una fecha o un número que no entiende, o una orden con pagos
//     o con IVA y sin documento. Con una sola línea así, ese día no se da por
//     leído. Lo que no impide leer el día (una orden sin documento ni pagos,
//     una propina, un pago con motivo de cancelación) va como aviso.

import { eurosExactos } from '@/modules/conta/lib/formato'

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Un fichero tal como lo suelta el usuario: su nombre y su contenido. */
export interface FicheroRevo {
  nombre: string
  contenido: string | Uint8Array
}

export type ClaseRevo = 'ordenes' | 'documentos' | 'impuestos' | 'pagos'

/** Cómo lo nombra Revo en su menú. */
export const NOMBRE_CLASE: Record<ClaseRevo, string> = {
  ordenes: 'órdenes', documentos: 'documentos', impuestos: 'impuestos', pagos: 'pagos',
}

interface Tabla {
  nombre: string
  /** Los títulos de columna, normalizados (sin espacios a los lados, en minúscula y sin tildes). */
  titulos: string[]
  /** Cada fila con su número de línea en el fichero (la 1 es la de los títulos). */
  filas: { linea: number; celdas: string[] }[]
}

export type Reconocimiento =
  | { ok: true; ficheros: Record<ClaseRevo, Tabla>; clases: { clase: ClaseRevo; nombre: string }[] }
  | { ok: false; problemas: string[]; clases: { clase: ClaseRevo; nombre: string }[] }

/** Lo que espera conta_tpv_dia_guardar en p_lectura. Importes en euros, con su signo. */
export interface LecturaDia {
  documentos: { numero: number; contador: string; fecha: string; orden: string; canal: string; nif: string | null; cliente: string | null; base: number; cuota: number; total: number }[]
  impuestos: { orden: string; tipo: number; base: number; cuota: number }[]
  cobros: { fila: number; orden: string; forma: string; importe: number }[]
}

export interface ResumenDia {
  dia: string
  facturas: number
  primero: number | null
  ultimo: number | null
  contadores: string[]
  base: number
  cuota: number
  total: number
  porForma: { forma: string; importe: number }[]
  porCanal: { canal: string; importe: number }[]
  conNif: { numero: number; nif: string; cliente: string | null; total: number }[]
  devoluciones: { numero: number; total: number }[]
  /** El resumen en una frase, como se va a ver. */
  texto: string
}

export interface DiaLeido {
  /** AAAA-MM-DD */
  dia: string
  /** false si alguna línea de ese día no se ha entendido: así no se guarda. */
  leido: boolean
  problemas: string[]
  avisos: string[]
  lectura: LecturaDia
  resumen: ResumenDia
}

export interface Lectura {
  dias: DiaLeido[]
  /** Todos los problemas, en el orden de los ficheros. */
  problemas: string[]
  avisos: string[]
}

// ── 0 · El texto: CSV de punto y coma ──────────────────────────────────────

/** UTF-8 (con o sin marca de inicio); si no lo es, Windows-1252, que es lo que deja Excel. */
export function textoDe(contenido: string | Uint8Array): string {
  let t: string
  if (typeof contenido === 'string') t = contenido
  else {
    try { t = new TextDecoder('utf-8', { fatal: true }).decode(contenido) }
    catch { t = new TextDecoder('windows-1252').decode(contenido) }
  }
  return t.replace(/^\uFEFF/, '')
}

/** Filas de un texto separado por «;», con comillas dobles si las hay, y la línea en que empieza cada una. */
export function filasDe(texto: string): { linea: number; celdas: string[] }[] {
  const filas: { linea: number; celdas: string[] }[] = []
  let celdas: string[] = [], celda = '', comillas = false, linea = 1, inicio = 1
  const cerrar = () => {
    celdas.push(celda)
    if (celdas.some((c) => c.trim() !== '')) filas.push({ linea: inicio, celdas })
    celdas = []; celda = ''
  }
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { celda += '"'; i++ }
      else if (c === '"') comillas = false
      else { if (c === '\n') linea++; celda += c }
    } else if (c === '"' && celda.trim() === '') { comillas = true; celda = '' }
    else if (c === ';') { celdas.push(celda); celda = '' }
    else if (c === '\r') { /* CRLF: el \n cierra */ }
    else if (c === '\n') { cerrar(); linea++; inicio = linea }
    else celda += c
  }
  if (celda !== '' || celdas.length) cerrar()
  return filas
}

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// ── 1 · Reconocer ───────────────────────────────────────────────────────────

/** Los títulos que tiene que llevar cada fichero (normalizados). Lo que distingue a cada uno va el primero. */
const TITULOS: Record<ClaseRevo, string[]> = {
  ordenes: ['entrega', 'comensales', 'id', 'mesa', 'abierto', 'cerrado', 'total'],
  documentos: ['documento', 'contador', 'nif', 'orden', 'fecha', 'subtotal', 'impuesto total', 'total'],
  impuestos: ['impuesto', 'orden', 'subtotal', 'impuesto total', 'total', 'fecha'],
  pagos: ['forma de pago', 'importe', 'orden', 'fecha'],
}
const ORDEN_CLASES: ClaseRevo[] = ['ordenes', 'documentos', 'impuestos', 'pagos']

function claseDe(titulos: string[]): ClaseRevo | null {
  const hay = new Set(titulos)
  const son = ORDEN_CLASES.filter((k) => TITULOS[k].every((t) => hay.has(t)))
  // Documentos lleva también «impuesto total» pero no «impuesto»: no se confunden.
  return son.length === 1 ? son[0] : null
}

const lista = (xs: string[]) => xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`

/** Qué es cada fichero, por sus títulos de columna. Dice qué falta, qué sobra y qué no es de Revo. */
export function reconocer(ficheros: FicheroRevo[]): Reconocimiento {
  const por: Partial<Record<ClaseRevo, Tabla[]>> = {}
  const ajenos: string[] = []
  const clases: { clase: ClaseRevo; nombre: string }[] = []
  for (const f of ficheros) {
    const filas = filasDe(textoDe(f.contenido))
    const titulos = (filas[0]?.celdas ?? []).map(norm)
    const clase = claseDe(titulos)
    if (!clase) { ajenos.push(f.nombre); continue }
    ;(por[clase] ??= []).push({ nombre: f.nombre, titulos, filas: filas.slice(1) })
    clases.push({ clase, nombre: f.nombre })
  }
  const problemas: string[] = []
  for (const n of ajenos) problemas.push(`No reconozco el fichero «${n}»: no es ninguno de los cuatro de Revo (órdenes, documentos, impuestos y pagos).`)
  for (const k of ORDEN_CLASES) {
    const v = por[k] ?? []
    if (v.length > 1) problemas.push(`Has subido ${v.length === 2 ? 'dos' : v.length} ficheros de ${NOMBRE_CLASE[k]}: ${lista(v.map((x) => `«${x.nombre}»`))}. Sube solo uno.`)
  }
  for (const k of ORDEN_CLASES) if (!(por[k]?.length)) problemas.push(`Falta el fichero de ${NOMBRE_CLASE[k]}.`)
  if (problemas.length) return { ok: false, problemas, clases }
  return { ok: true, clases, ficheros: { ordenes: por.ordenes![0], documentos: por.documentos![0], impuestos: por.impuestos![0], pagos: por.pagos![0] } }
}

// ── 2 · Leer ────────────────────────────────────────────────────────────────

/** «33,25», «-11», «1.234,56», «28,909» → milésimas de euro. Null si no es un importe así (p. ej. «12,5,0», «12.5» o «1,2345»). */
export function milesimasRevo(bruto: string): number | null {
  const s = bruto.trim().replace(/−/g, '-')
  const m = s.match(/^([+-]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,3}))?$/)
  if (!m) return null
  const v = Number(m[2].replace(/\./g, '')) * 1000 + Number((m[3] ?? '').padEnd(3, '0') || '0')
  return m[1] === '-' ? -v : v
}

/** Milésimas → céntimos, redondeando la mitad hacia fuera del cero (28,905 → 28,91; −2,895 → −2,90). */
export const aCentimos = (mil: number): number => Math.sign(mil) * Math.round(Math.abs(mil) / 10)

/** «33,25», «-11», «1.234,56» → céntimos; con 3 decimales, redondeado («28,909» → 2891). Null si no es un importe. */
export function importeRevo(bruto: string): number | null {
  const v = milesimasRevo(bruto)
  return v === null ? null : aCentimos(v)
}

/**
 * Céntimos de unas líneas en milésimas, de modo que sumen exactamente el redondeo de su suma
 * (el reparto de los restos mayores): «28,909» y «28,909» suman 57,818 → 57,82, y no 28,91 + 28,91.
 */
export function repartirCentimos(milesimas: readonly number[]): number[] {
  const objetivo = aCentimos(milesimas.reduce((a, b) => a + b, 0))
  const suelo = milesimas.map((m) => Math.floor(m / 10))
  let falta = objetivo - suelo.reduce((a, b) => a + b, 0)
  const orden = milesimas.map((m, i) => ({ i, resto: m - Math.floor(m / 10) * 10 })).sort((a, b) => b.resto - a.resto || a.i - b.i)
  const out = [...suelo]
  for (const { i } of orden) { if (falta <= 0) break; out[i] += 1; falta -= 1 }
  for (const { i } of [...orden].reverse()) { if (falta >= 0) break; out[i] -= 1; falta += 1 }
  return out
}

/** «2026-11-09 12:40:30» → el mismo texto, si es una fecha y hora de verdad. Null si no. */
export function fechaRevo(bruto: string): string | null {
  const s = bruto.trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return null
  const [a, mes, d, h, mi, se] = m.slice(1).map(Number)
  const f = new Date(Date.UTC(a, mes - 1, d))
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d || h > 23 || mi > 59 || se > 59) return null
  return s
}

/** «IVA 10%», «IVA 21 %», «10,5%» → 10, 21, 10.5. Null si no lleva un porcentaje. */
export function tipoRevo(bruto: string): number | null {
  const m = bruto.match(/(\d+(?:[.,]\d+)?)\s*%/)
  return m ? Number(m[1].replace(',', '.')) : null
}

const euros = (c: number) => c / 100
/**
 * R10 · Líneas con base, IVA y (si lo traen) total en milésimas → en euros con céntimos, por grupos
 * (el día, o el día y el tipo): el IVA y el total de cada grupo, redondeados al final y repartidos
 * entre sus líneas; la base, el total menos el IVA. Las líneas, en su orden.
 */
function enCentimos<T extends { base: number; cuota: number; total?: number }>(xs: readonly T[], grupoDe: (x: T) => string): T[] {
  const out: T[] = []
  for (const grupo of agruparPor(xs.map((x, n) => ({ x, n })), (y) => grupoDe(y.x))) {
    const cuotas = repartirCentimos(grupo.map((y) => y.x.cuota))
    const totales = repartirCentimos(grupo.map((y) => y.x.total ?? y.x.base + y.x.cuota))
    grupo.forEach((y, k) => {
      out[y.n] = { ...y.x, base: euros(totales[k] - cuotas[k]), cuota: euros(cuotas[k]), ...('total' in y.x ? { total: euros(totales[k]) } : {}) }
    })
  }
  return out
}

/** Los grupos de una lista, en el orden en que aparece cada uno. */
function agruparPor<T>(xs: readonly T[], clave: (x: T) => string): T[][] {
  const m = new Map<string, T[]>()
  for (const x of xs) { const k = clave(x); const g = m.get(k) ?? []; g.push(x); m.set(k, g) }
  return [...m.values()]
}
const fechaDia = (f: string) => f.slice(0, 10)
const diaTexto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const esLocal = (canal: string) => canal === '' || canal === '--'
/** La fila sin el día al que se ha repartido (no va en p_lectura). */
function sinDia<T extends { dia: string }>(x: T): Omit<T, 'dia'> {
  const r: Partial<T> = { ...x }
  delete r.dia
  return r as Omit<T, 'dia'>
}

/** Una lectura por día, con su resumen, y lo que no se ha podido leer. */
export function leer(ficheros: Record<ClaseRevo, Tabla>): Lectura {
  const problemas: { dia: string | null; texto: string }[] = []
  const avisos: { dia: string | null; texto: string }[] = []
  const col = (k: ClaseRevo, t: string) => ficheros[k].titulos.indexOf(t)
  const celda = (k: ClaseRevo, celdas: string[], t: string) => (celdas[col(k, t)] ?? '').trim()
  const donde = (k: ClaseRevo, linea: number) => `Línea ${linea} del fichero de ${NOMBRE_CLASE[k]} («${ficheros[k].nombre}»)`
  const noEntiendo = (k: ClaseRevo, linea: number, que: string, bruto: string, dia: string | null) =>
    problemas.push({ dia, texto: `${donde(k, linea)}: no entiendo ${que} «${bruto}».` })

  // Órdenes: su canal y su fecha de apertura (para situar lo que no tenga documento).
  const ordenes = new Map<string, { canal: string; abierto: string | null; total: number | null; linea: number }>()
  for (const { linea, celdas } of ficheros.ordenes.filas) {
    const id = celda('ordenes', celdas, 'id')
    if (!id) { problemas.push({ dia: null, texto: `${donde('ordenes', linea)}: no tiene número de orden.` }); continue }
    const abierto = fechaRevo(celda('ordenes', celdas, 'abierto'))
    ordenes.set(id, { canal: celda('ordenes', celdas, 'entrega'), abierto, total: importeRevo(celda('ordenes', celdas, 'total')), linea })
  }

  // Documentos: el día de todo.
  type Doc = LecturaDia['documentos'][number] & { dia: string }
  const docs: Doc[] = []
  const docsMil: Doc[] = []
  const diaDeOrden = new Map<string, string>()
  for (const { linea, celdas } of ficheros.documentos.filas) {
    const fechaBruta = celda('documentos', celdas, 'fecha')
    const fecha = fechaRevo(fechaBruta)
    const dia = fecha ? fechaDia(fecha) : null
    const orden = celda('documentos', celdas, 'orden')
    const numBruto = celda('documentos', celdas, 'documento')
    const numero = /^\d+$/.test(numBruto) ? Number(numBruto) : null
    const base = milesimasRevo(celda('documentos', celdas, 'subtotal'))
    const cuota = milesimasRevo(celda('documentos', celdas, 'impuesto total'))
    const total = milesimasRevo(celda('documentos', celdas, 'total'))
    if (orden && dia && !diaDeOrden.has(orden)) diaDeOrden.set(orden, dia)
    let mal = false
    if (!fecha) { noEntiendo('documentos', linea, 'la fecha', fechaBruta, null); mal = true }
    if (numero === null) { noEntiendo('documentos', linea, 'el número de documento', numBruto, dia); mal = true }
    if (!orden) { problemas.push({ dia, texto: `${donde('documentos', linea)}: no tiene número de orden.` }); mal = true }
    for (const [que, v, t] of [['la base', base, 'subtotal'], ['el IVA', cuota, 'impuesto total'], ['el total', total, 'total']] as const)
      if (v === null) { noEntiendo('documentos', linea, que, celda('documentos', celdas, t), dia); mal = true }
    if (mal) continue
    const o = ordenes.get(orden)
    if (!o) problemas.push({ dia, texto: `La factura ${numero} es de la orden ${orden}, que no está en el fichero de órdenes («${ficheros.ordenes.nombre}»): no sé su canal.` })
    const nif = celda('documentos', celdas, 'nif').toUpperCase().replace(/[\s.-]/g, '') || null
    docsMil.push({
      dia: dia!, numero: numero!, contador: celda('documentos', celdas, 'contador'), fecha: fecha!, orden, canal: o?.canal ?? '',
      nif, cliente: nif ? (celda('documentos', celdas, 'cliente') || null) : null,
      base: base!, cuota: cuota!, total: total!,
    })
  }
  // R10 · En milésimas por día; el IVA y el total, redondeados al final y repartidos; la base, total − IVA.
  docs.push(...enCentimos(docsMil, (d) => d.dia))

  // Impuestos: un renglón por orden y tipo, al día del documento de su orden.
  type Imp = LecturaDia['impuestos'][number] & { dia: string }
  const imps: Imp[] = []
  const impsMil: Imp[] = []
  for (const { linea, celdas } of ficheros.impuestos.filas) {
    const orden = celda('impuestos', celdas, 'orden')
    const propio = fechaRevo(celda('impuestos', celdas, 'fecha'))
    const dia = diaDeOrden.get(orden) ?? (propio ? fechaDia(propio) : null)
    const tipoBruto = celda('impuestos', celdas, 'impuesto')
    const tipo = tipoRevo(tipoBruto)
    const base = milesimasRevo(celda('impuestos', celdas, 'subtotal'))
    const cuota = milesimasRevo(celda('impuestos', celdas, 'impuesto total'))
    let mal = false
    if (tipo === null) { noEntiendo('impuestos', linea, 'el impuesto', tipoBruto, dia); mal = true }
    if (base === null) { noEntiendo('impuestos', linea, 'la base', celda('impuestos', celdas, 'subtotal'), dia); mal = true }
    if (cuota === null) { noEntiendo('impuestos', linea, 'el IVA', celda('impuestos', celdas, 'impuesto total'), dia); mal = true }
    if (!diaDeOrden.has(orden)) {
      problemas.push({ dia, texto: `${donde('impuestos', linea)}: el IVA es de la orden ${orden || '(sin número)'}, que no tiene ningún documento.` })
      mal = true
    }
    if (mal) continue
    impsMil.push({ dia: dia!, orden, tipo: tipo!, base: base!, cuota: cuota! })
  }
  // R10 · Sumadas en milésimas por día y tipo, y redondeadas a céntimos al final, repartidos entre sus líneas.
  imps.push(...enCentimos(impsMil, (i) => `${i.dia}|${i.tipo}`))

  // Pagos: cada uno con su línea, al día del documento de su orden.
  type Cob = LecturaDia['cobros'][number] & { dia: string }
  const cobs: Cob[] = []
  const cobsMil: Cob[] = []
  const conPagos = new Set<string>()
  for (const { linea, celdas } of ficheros.pagos.filas) {
    const orden = celda('pagos', celdas, 'orden')
    const propio = fechaRevo(celda('pagos', celdas, 'fecha'))
    const dia = diaDeOrden.get(orden) ?? (propio ? fechaDia(propio) : null)
    const forma = celda('pagos', celdas, 'forma de pago')
    const importeBruto = celda('pagos', celdas, 'importe')
    const importe = milesimasRevo(importeBruto)
    if (orden) conPagos.add(orden)
    let mal = false
    if (importe === null) { noEntiendo('pagos', linea, 'el importe', importeBruto, dia); mal = true }
    if (!forma) { problemas.push({ dia, texto: `${donde('pagos', linea)}: no dice la forma de pago.` }); mal = true }
    if (!diaDeOrden.has(orden)) {
      problemas.push({ dia, texto: `La orden ${orden || '(sin número)'} tiene pagos (línea ${linea} del fichero de pagos) y ningún documento.` })
      mal = true
    }
    const propina = col('pagos', 'propina') >= 0 ? importeRevo(celda('pagos', celdas, 'propina')) : 0
    if (propina) avisos.push({ dia, texto: `${donde('pagos', linea)}: lleva ${eurosExactos(euros(propina))} de propina. Todavía no sé si va dentro del importe: mira ese pago.` })
    const motivo = col('pagos', 'motivo de cancelacion') >= 0 ? celda('pagos', celdas, 'motivo de cancelacion') : ''
    if (motivo) avisos.push({ dia, texto: `${donde('pagos', linea)}: tiene motivo de cancelación («${motivo}»), y se cuenta como cobrado. Mira ese pago.` })
    if (mal) continue
    cobsMil.push({ dia: dia!, fila: linea, orden, forma, importe: importe! })
  }
  // R10 · Lo cobrado, igual: en milésimas por día, redondeado al final.
  for (const grupo of agruparPor(cobsMil, (x) => x.dia)) {
    const cents = repartirCentimos(grupo.map((x) => x.importe))
    grupo.forEach((x, k) => cobs.push({ ...x, importe: euros(cents[k]) }))
  }
  cobs.sort((a, b) => a.fila - b.fila)

  // Órdenes sin documento: con pagos ya salió arriba; sin pagos y con importe, aviso.
  for (const [id, o] of ordenes) {
    if (diaDeOrden.has(id) || conPagos.has(id) || !o.total) continue
    avisos.push({ dia: o.abierto ? fechaDia(o.abierto) : null, texto: `La orden ${id} (${eurosExactos(euros(o.total))}) no tiene documento ni pagos: no entra en ningún día.` })
  }

  // Un día por fecha de documento (y los que solo salen en un problema).
  const dias = [...new Set([...docs.map((d) => d.dia), ...problemas.flatMap((p) => p.dia ? [p.dia] : [])])].sort()
  const problemasSinDia = problemas.filter((p) => !p.dia).map((p) => p.texto)
  const resultado: DiaLeido[] = dias.map((dia) => {
    const lectura: LecturaDia = {
      documentos: docs.filter((d) => d.dia === dia).map(sinDia),
      impuestos: imps.filter((i) => i.dia === dia).map(sinDia),
      cobros: cobs.filter((c) => c.dia === dia).map(sinDia),
    }
    const suyos = [...problemas.filter((p) => p.dia === dia).map((p) => p.texto), ...problemasSinDia]
    return {
      dia, lectura, leido: suyos.length === 0, problemas: suyos,
      avisos: avisos.filter((a) => a.dia === dia || !a.dia).map((a) => a.texto),
      resumen: resumenDe(dia, lectura),
    }
  })
  return { dias: resultado, problemas: problemas.map((p) => p.texto), avisos: avisos.map((a) => a.texto) }
}

/** Reconocer y leer de una vez: lo que hará la pantalla al soltar los ficheros. */
export function leerRevo(ficheros: FicheroRevo[]): { ok: true; lectura: Lectura } | { ok: false; problemas: string[] } {
  const r = reconocer(ficheros)
  return r.ok ? { ok: true, lectura: leer(r.ficheros) } : { ok: false, problemas: r.problemas }
}

// ── 3 · El resumen de un día ─────────────────────────────────────────────────

const suma = (xs: number[]) => xs.reduce((a, b) => a + Math.round(b * 100), 0)
const porOrden = (a: string, b: string) => a.localeCompare(b, 'es')

export function resumenDe(dia: string, l: LecturaDia): ResumenDia {
  const docs = l.documentos
  const nums = docs.map((d) => d.numero)
  const formas = new Map<string, number>()
  for (const c of l.cobros) formas.set(c.forma, (formas.get(c.forma) ?? 0) + Math.round(c.importe * 100))
  const canales = new Map<string, number>()
  for (const d of docs) {
    const k = esLocal(d.canal) ? 'en el local' : d.canal
    canales.set(k, (canales.get(k) ?? 0) + Math.round(d.total * 100))
  }
  const porForma = [...formas].sort(([a], [b]) => porOrden(a, b)).map(([forma, c]) => ({ forma, importe: euros(c) }))
  const porCanal = [...canales].sort(([a], [b]) => (a === 'en el local' ? -1 : b === 'en el local' ? 1 : porOrden(a, b))).map(([canal, c]) => ({ canal, importe: euros(c) }))
  const conNif = docs.filter((d) => d.nif).map((d) => ({ numero: d.numero, nif: d.nif!, cliente: d.cliente, total: d.total })).sort((a, b) => a.numero - b.numero)
  const devoluciones = docs.filter((d) => d.total < 0).map((d) => ({ numero: d.numero, total: d.total })).sort((a, b) => a.numero - b.numero)
  const r = {
    dia, facturas: docs.length,
    primero: nums.length ? Math.min(...nums) : null, ultimo: nums.length ? Math.max(...nums) : null,
    contadores: [...new Set(docs.map((d) => d.contador))].sort(porOrden),
    base: euros(suma(docs.map((d) => d.base))), cuota: euros(suma(docs.map((d) => d.cuota))), total: euros(suma(docs.map((d) => d.total))),
    porForma, porCanal, conNif, devoluciones,
  }
  const rango = r.primero === null ? '' : r.primero === r.ultimo ? `, la ${r.primero}` : `, de la ${r.primero} a la ${r.ultimo}`
  const partes = [
    `${diaTexto(dia)}: ${r.facturas} factura${r.facturas === 1 ? '' : 's'}${rango}, ${eurosExactos(r.total)} (base ${eurosExactos(r.base)} e IVA ${eurosExactos(r.cuota)}).`,
    porForma.length ? `Por forma de pago: ${porForma.map((x) => `${x.forma} ${eurosExactos(x.importe)}`).join(' · ')}.` : 'Sin pagos.',
    porCanal.length ? `Por canal: ${porCanal.map((x) => `${x.canal} ${eurosExactos(x.importe)}`).join(' · ')}.` : '',
    conNif.length ? `Con NIF: ${lista(conNif.map((x) => `la ${x.numero}`))}.` : '',
    devoluciones.length ? `${devoluciones.length === 1 ? 'Una devolución' : `${devoluciones.length} devoluciones`}: ${lista(devoluciones.map((x) => `la ${x.numero} (${eurosExactos(x.total)})`))}.` : '',
  ]
  return { ...r, texto: partes.filter(Boolean).join(' ') }
}
