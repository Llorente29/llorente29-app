// src/modules/conta/lib/lectorLiquidacionMensual.ts
//
// Compras (10/10), §2.5 y §4.5 · Leer los documentos de una liquidación
// mensual: el proveedor que no factura las entregas manda cada mes, con una
// misma referencia, una factura suya, una factura tuya que extiende él en tu
// nombre, y unos detalles informativos (la transacción, las ventas, el
// inventario). Puro: recibe las celdas de texto ({x, y, texto}, celdasPdf.ts)
// y devuelve lo leído y lo que no cuadra. Nada se adivina.
//
// Cuál es cada documento lo dice su título. Las dos facturas se leen igual, y
// cuál es «la que tú emites» y cuál «la que te emite» lo decide el NIF de tu
// empresa (quién factura y a quién), no el título.
//
// Probado contra la forma de los cinco documentos reales de septiembre de
// Foodint (fuera del repositorio, regla 31); las pruebas del repositorio usan
// esa misma forma con nombres inventados.

import type { Celda, PaginaPdf } from '@/modules/conta/lib/lectorDiez'
import { normalizarNif } from '@/modules/conta/lib/nif'
import { eurosExactos } from '@/modules/conta/lib/formato'

export type TipoDocumento = 'factura' | 'transaccion' | 'ventas' | 'inventario' | 'desconocido'

export interface Fila { pagina: number; y: number; celdas: Celda[]; texto: string }

const NUM = '-?\\d{1,3}(?:\\.\\d{3})*,\\d{2}'
/** «1.234,56» → 1234.56. */
export const numero = (s: string): number => Number(s.replace(/\./g, '').replace(',', '.'))
const cent = (x: number) => Math.round(x * 100)

/** Las celdas, en filas: misma página y casi la misma altura (hasta 2,5 puntos: «Totales:» y su cifra llegan a 1 de diferencia). */
export function filasDe(paginas: readonly PaginaPdf[]): Fila[] {
  const filas: Fila[] = []
  paginas.forEach((p, i) => {
    const cs = [...p.celdas].filter((c) => c.texto.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x)
    let actual: Celda[] = []
    let y0 = Number.NaN
    const cerrar = () => {
      if (actual.length === 0) return
      const celdas = [...actual].sort((a, b) => a.x - b.x)
      filas.push({ pagina: i + 1, y: y0, celdas, texto: unir(celdas.map((c) => c.texto.trim())) })
      actual = []
    }
    for (const c of cs) {
      if (actual.length > 0 && Math.abs(c.y - y0) > 2.5) cerrar()
      if (actual.length === 0) y0 = c.y
      actual.push(c)
    }
    cerrar()
  })
  return filas
}

/** Junta las palabras: «- 9,28» → «-9,28» y «AF- 02927» → «AF-02927». */
function unir(ts: string[]): string {
  return ts.join(' ').replace(/(^|\s)- (?=\d)/g, '$1-').replace(/\b([A-Z]{1,4})- (\d)/g, '$1-$2').replace(/\s+/g, ' ').trim()
}

export function reconocer(filas: readonly Fila[]): TipoDocumento {
  const titulo = filas.slice(0, 3).map((f) => f.texto).join(' ').toUpperCase()
  if (/\b(AUTO)?FACTURA\b/.test(titulo) && !/DETALLE/.test(titulo)) return 'factura'
  if (/DETALLE DE TRANSACCI/.test(titulo)) return 'transaccion'
  if (/DETALLE DE VENTAS/.test(titulo)) return 'ventas'
  if (/RELACI.N COMPRAS Y VENTAS|MOVIMIENTOS DE INVENTARIO/.test(titulo)) return 'inventario'
  return 'desconocido'
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «domingo, 4 de octubre de 2026» → 2026-10-04. */
function fechaLarga(t: string): string | null {
  const m = t.match(/(\d{1,2}) de ([a-záéíóú]+) de (\d{4})/i)
  if (!m) return null
  const mes = MESES.indexOf(m[2].toLowerCase())
  return mes < 0 ? null : `${m[3]}-${String(mes + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
}
const corta = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`

function periodo(filas: readonly Fila[]): { desde: string; hasta: string } | null {
  for (const f of filas) {
    const m = f.texto.match(/Desde (\d{2}\/\d{2}\/\d{4}) Hasta (\d{2}\/\d{2}\/\d{4})/)
    if (m) return { desde: corta(m[1]), hasta: corta(m[2]) }
  }
  return null
}
function referencia(filas: readonly Fila[]): string | null {
  for (const f of filas.slice(0, 6)) {
    const m = f.texto.match(/(?:N[º°o] de [A-Za-zÁ-ú]+|Ref):\s*([A-Z]{1,4}-\d+)/)
    if (m) return m[1]
  }
  return null
}
const fechaCabecera = (filas: readonly Fila[]) => {
  const f = filas.slice(0, 4).find((x) => /^Fecha:/.test(x.texto))
  return f ? fechaLarga(f.texto) : null
}

// ── Las facturas ────────────────────────────────────────────────────────────

export interface Parte { nombre: string | null; nif: string | null }
export interface LineaFacturaLeida { concepto: string; base: number; tipo: number; total: number }
export interface FacturaLeida {
  numero: string | null
  fecha: string | null
  periodo: { desde: string; hasta: string } | null
  desde: Parte
  a: Parte
  lineas: LineaFacturaLeida[]
  total: number | null
}

const NIF_EN = /\b([A-HJ-NP-SUVW]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/

export function leerFactura(filas: readonly Fila[]): FacturaLeida {
  // Las dos columnas «Facturar desde» y «Facturar a»: la x de la segunda parte en dos.
  const i = filas.findIndex((f) => /Facturar desde:/.test(f.texto) && /Facturar a:/.test(f.texto))
  const desde: string[] = []; const a: string[] = []
  if (i >= 0) {
    const etiquetaA = filas[i].celdas.find((c, k, cs) => c.texto.trim() === 'Facturar' && k > 0 && cs.slice(0, k).some((d) => d.texto.trim() === 'Facturar'))
    const corte = etiquetaA ? etiquetaA.x - 5 : 300
    for (const f of filas.slice(i + 1)) {
      if (/^Periodo:/.test(f.texto)) break
      desde.push(unir(f.celdas.filter((c) => c.x < corte).map((c) => c.texto.trim())))
      a.push(unir(f.celdas.filter((c) => c.x >= corte).map((c) => c.texto.trim())))
    }
  }
  const parte = (ls: string[]): Parte => {
    const nif = ls.map((l) => l.match(NIF_EN)?.[1] ?? null).find((x) => x) ?? null
    return { nombre: ls.find((l) => l !== '') ?? null, nif: nif ? normalizarNif(nif) : null }
  }
  const lineas: LineaFacturaLeida[] = []
  let total: number | null = null
  const reLinea = new RegExp(`^(.+?) (${NUM}) € (\\d{1,2}(?:,\\d{1,2})?) % (${NUM}) €$`)
  const reTotal = new RegExp(`^Total: (${NUM}) €$`)
  for (const f of filas) {
    const m = f.texto.match(reLinea)
    if (m) { lineas.push({ concepto: m[1], base: numero(m[2]), tipo: numero(m[3]), total: numero(m[4]) }); continue }
    const t = f.texto.match(reTotal)
    if (t) total = numero(t[1])
  }
  return { numero: referencia(filas), fecha: fechaCabecera(filas), periodo: periodo(filas), desde: parte(desde), a: parte(a), lineas, total }
}

// ── La transacción ──────────────────────────────────────────────────────────

export interface TransaccionLeida {
  fecha: string | null
  periodo: { desde: string; hasta: string } | null
  lineas: { concepto: string; importe: number; referencia: string | null }[]
  saldo: { concepto: string; importe: number } | null
}

export function leerTransaccion(filas: readonly Fila[]): TransaccionLeida {
  const lineas: TransaccionLeida['lineas'] = []
  let saldo: TransaccionLeida['saldo'] = null
  const i = filas.findIndex((f) => /^Concepto( Total)?$/.test(f.texto))
  const re = new RegExp(`^(.+?) (${NUM})( €)?$`)
  for (const f of filas.slice(i < 0 ? 0 : i + 1)) {
    if (/^Términos|^El presente/.test(f.texto)) break
    if (/^Total$/.test(f.texto)) continue
    const m = f.texto.match(re)
    if (!m) continue
    if (/^Saldo\b/i.test(m[1])) { saldo = { concepto: m[1], importe: numero(m[2]) }; continue }
    lineas.push({ concepto: m[1], importe: numero(m[2]), referencia: m[1].match(/\b([A-Z]{1,4}-\d+)\b/)?.[1] ?? null })
  }
  return { fecha: fechaCabecera(filas), periodo: periodo(filas), lineas, saldo }
}

// ── Las ventas ──────────────────────────────────────────────────────────────

export interface VentasPlataforma {
  plataforma: string
  marcas: { marca: string; ventas: number; devoluciones: number; total: number }[]
  totales: { ventas: number; devoluciones: number; total: number } | null
  reparto: { tipo: string; base: number; monto: number }[]
}
export interface VentasLeidas { referencia: string | null; periodo: { desde: string; hasta: string } | null; plataformas: VentasPlataforma[] }

export function leerVentas(filas: readonly Fila[]): VentasLeidas {
  const plataformas: VentasPlataforma[] = []
  let p: VentasPlataforma | null = null
  let enReparto = false
  const reMarca = new RegExp(`^(.+?) (${NUM}) € (${NUM}) € (${NUM}) €$`)
  const reTotales = new RegExp(`^Totales: (${NUM}) € (${NUM}) € (${NUM}) €$`)
  const reReparto = new RegExp(`^(Reparto .+?|Costo de Env.o) \\(\\d\\) (${NUM}) € (${NUM}) €$`)
  for (const f of filas) {
    const cab = f.texto.match(/^(.+?) Detalle de Ventas$/)
    if (cab) { p = { plataforma: cab[1], marcas: [], totales: null, reparto: [] }; plataformas.push(p); enReparto = false; continue }
    if (!p) continue
    if (/^Desagregación de Ventas/.test(f.texto)) { enReparto = true; continue }
    const r = f.texto.match(reReparto)
    if (r) { p.reparto.push({ tipo: r[1], base: numero(r[2]), monto: numero(r[3]) }); continue }
    const t = f.texto.match(reTotales)
    if (t && !enReparto) { p.totales = { ventas: numero(t[1]), devoluciones: numero(t[2]), total: numero(t[3]) }; continue }
    const m = f.texto.match(reMarca)
    if (m && !enReparto && !/^Totales/.test(m[1])) p.marcas.push({ marca: m[1], ventas: numero(m[2]), devoluciones: numero(m[3]), total: numero(m[4]) })
  }
  return { referencia: referencia(filas), periodo: periodo(filas), plataformas }
}

// ── El inventario ───────────────────────────────────────────────────────────

export interface ProductoLeido { nombre: string; precio: number; compras: number; unidad: string; consumo: number; saldo: number; total: number }
export interface InventarioLeido {
  referencia: string | null
  periodo: { desde: string; hasta: string } | null
  productos: ProductoLeido[]
  /** Filas idénticas que el documento repite (al saltar de página): se quitan, y se dice cuántas. */
  repetidas: number
  totalDocumento: number | null
}

export function leerInventario(filas: readonly Fila[]): InventarioLeido {
  const re = new RegExp(`^(.+?) (${NUM}) € (${NUM}) (\\S+) (${NUM}) (\\S+) (${NUM}) (\\S+) (${NUM})$`)
  const productos: ProductoLeido[] = []
  const vistas = new Set<string>()
  let repetidas = 0
  let totalDocumento: number | null = null
  for (const f of filas) {
    const t = f.texto.match(new RegExp(`^Totales: (${NUM})$`))
    if (t) { totalDocumento = numero(t[1]); continue }
    const m = f.texto.match(re)
    if (!m) continue
    const clave = f.texto
    if (vistas.has(clave)) { repetidas += 1; continue }
    vistas.add(clave)
    productos.push({ nombre: m[1], precio: numero(m[2]), compras: numero(m[3]), unidad: m[4], consumo: numero(m[5]), saldo: numero(m[7]), total: numero(m[9]) })
  }
  return { referencia: referencia(filas), periodo: periodo(filas), productos, repetidas, totalDocumento }
}

// ── Todo junto ──────────────────────────────────────────────────────────────

export interface LiquidacionLeida {
  /** La que extiende él en tu nombre: tú le facturas. */
  emitida: FacturaLeida | null
  /** La suya: él te factura. */
  recibida: FacturaLeida | null
  transaccion: TransaccionLeida | null
  ventas: VentasLeidas | null
  inventario: InventarioLeido | null
  periodo: { desde: string; hasta: string } | null
  /** Lo que impide proponer los asientos, en palabras. */
  bloqueos: string[]
  /** Lo que se dice pero no impide. */
  avisos: string[]
  /** Los ficheros que no se han reconocido. */
  noReconocidos: string[]
}

export interface DocumentoLiquidacion { nombre: string; paginas: readonly PaginaPdf[] }

const eur = eurosExactos

export function leerLiquidacion(docs: readonly DocumentoLiquidacion[], nifEmpresa: string): LiquidacionLeida {
  const nif = normalizarNif(nifEmpresa)
  const r: LiquidacionLeida = { emitida: null, recibida: null, transaccion: null, ventas: null, inventario: null, periodo: null, bloqueos: [], avisos: [], noReconocidos: [] }
  for (const d of docs) {
    const filas = filasDe(d.paginas)
    const tipo = reconocer(filas)
    if (tipo === 'factura') {
      const f = leerFactura(filas)
      if (f.desde.nif === nif) r.emitida = f
      else if (f.a.nif === nif) r.recibida = f
      else r.bloqueos.push(`«${d.nombre}» es una factura, pero ni la emite ni va a nombre de tu empresa (${nif}).`)
    } else if (tipo === 'transaccion') r.transaccion = leerTransaccion(filas)
    else if (tipo === 'ventas') r.ventas = leerVentas(filas)
    else if (tipo === 'inventario') r.inventario = leerInventario(filas)
    else r.noReconocidos.push(d.nombre)
  }
  if (!r.emitida) r.bloqueos.push('Falta la factura que le haces tú (la extiende él en tu nombre).')
  if (!r.recibida) r.bloqueos.push('Falta su factura.')
  for (const [f, que] of [[r.emitida, 'La factura que le haces'], [r.recibida, 'Su factura']] as const) {
    if (!f) continue
    const suma = f.lineas.reduce((t, l) => t + cent(l.total), 0)
    if (f.total === null) r.bloqueos.push(`${que} no dice su total.`)
    else if (Math.abs(suma - cent(f.total)) > 1) r.bloqueos.push(`${que} suma ${eur(suma / 100)} por líneas y dice ${eur(f.total)} de total.`)
    else if (suma !== cent(f.total)) r.avisos.push(`${que} suma ${eur(suma / 100)} por líneas y dice ${eur(f.total)}: 1 céntimo de redondeo del IVA. Manda el total.`)
    if (f.lineas.length === 0) r.bloqueos.push(`${que} no trae líneas que se puedan leer.`)
  }
  r.periodo = r.emitida?.periodo ?? r.recibida?.periodo ?? r.transaccion?.periodo ?? null
  for (const [p, que] of [[r.recibida?.periodo, 'su factura'], [r.transaccion?.periodo, 'la transacción'], [r.ventas?.periodo, 'las ventas'], [r.inventario?.periodo, 'el inventario']] as const) {
    if (p && r.periodo && (p.desde !== r.periodo.desde || p.hasta !== r.periodo.hasta)) r.bloqueos.push(`El periodo de ${que} no es el mismo que el de la factura que le haces.`)
  }
  // La transacción: cada línea, a su factura; una línea que no se sabe qué es y trae importe, para.
  if (r.transaccion) {
    let neto = 0
    for (const l of r.transaccion.lineas) {
      neto += cent(l.importe)
      if (l.referencia && l.referencia === r.emitida?.numero) {
        if (r.emitida.total !== null && cent(l.importe) !== cent(r.emitida.total)) r.bloqueos.push(`La transacción dice ${eur(l.importe)} de ${l.referencia}, y la factura ${eur(r.emitida.total)}.`)
      } else if (l.referencia && l.referencia === r.recibida?.numero) {
        if (r.recibida.total !== null && cent(l.importe) !== -cent(r.recibida.total)) r.bloqueos.push(`La transacción dice ${eur(l.importe)} de ${l.referencia}, y su factura ${eur(r.recibida.total)}.`)
      } else if (cent(l.importe) !== 0) {
        r.bloqueos.push(`«${l.concepto}» trae ${eur(l.importe)} y Folvy no sabe qué es: dímelo antes de proponer nada.`)
      } else {
        r.avisos.push(`«${l.concepto}» viene a cero.`)
      }
    }
    if (!r.transaccion.saldo) r.bloqueos.push('La transacción no dice el saldo.')
    else if (cent(r.transaccion.saldo.importe) !== neto) r.bloqueos.push(`La transacción dice ${eur(r.transaccion.saldo.importe)} de saldo y sus líneas suman ${eur(neto / 100)}.`)
  } else r.avisos.push('No está el detalle de la transacción: el saldo sale de las dos facturas.')
  if (r.inventario?.repetidas) r.avisos.push(`El inventario repite ${r.inventario.repetidas} fila(s) idéntica(s): se cuentan una vez.`)
  if (r.inventario && r.inventario.totalDocumento !== null) {
    const suma = r.inventario.productos.reduce((t, p) => t + cent(p.total), 0)
    if (suma !== cent(r.inventario.totalDocumento)) r.avisos.push(`El inventario dice ${eur(r.inventario.totalDocumento)} de total; producto a producto, sin repetir, suman ${eur(suma / 100)}.`)
  }
  return r
}
