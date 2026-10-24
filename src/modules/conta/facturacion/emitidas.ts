// src/modules/conta/facturacion/emitidas.ts
//
// S02 · PR 2 · Facturación › Facturas emitidas: lo que decide la lista sin
// React (regla react-refresh: el componente solo exporta componentes).
//
//   · Las facturas salen del libro registro de expedidas (vat_book_entry,
//     book = 'issued'), el mismo que pinta Libros › Facturas expedidas, leído
//     con su servicio (leerLibroRegistro). Una factura es una anotación o,
//     si llevara varios tipos de IVA, las de su asiento con el mismo número:
//     se juntan (base, IVA y total sumados).
//   · El total de cada anotación es el suyo (total); si la base no lo tiene,
//     base + cuota + recargo (en producción, 22/10: 1.317 anotaciones de
//     expedidas, todas con total y todas iguales a esa suma).
//   · Pestañas que suman «Todas» (regla 7: ninguna fila sin pestaña): las
//     vigentes, las que les falta algo para un requerimiento y las anuladas.
//     Las anuladas salen en «Todas», con su chip, pero no suman en el pie:
//     se compensan con su contraasiento, como en el libro.
//   · Se lee mes a mes: la base devuelve como mucho MAX_FILAS filas por
//     consulta, y en 12 meses una empresa con TPV ya pasa de 1.300. Si un mes
//     llega al tope, la página lo dice (no se calla que pueden faltar).

import { faltaParaCompletar, etiquetaTipo, type AnotacionLibro } from '@/modules/conta/lib/libroRegistro'
import { leerOrden, ordenar, pestanasConTodas, type PestanaEstado, type Sentido } from '@/modules/conta/diseno/plantillas/lista'
import { limites } from '@/modules/conta/documentos/documentos'

/** El tope de filas que devuelve una consulta a la base (PostgREST, max_rows). */
export const MAX_FILAS = 1000

export type EstadoEmitida = 'vigente' | 'por-completar' | 'anulada'

export interface FacturaEmitida {
  /** Una clave por factura: el asiento, su tipo, su serie y su número. */
  id: string
  entryId: string
  fecha: string
  /** «A-12», «1-GLV655858-20260930»; un resumen de tiques, su rango si lo tiene. */
  numero: string | null
  tipo: string
  cliente: string | null
  nif: string | null
  base: number
  iva: number
  total: number
  estado: EstadoEmitida
  /** Lo que le falta para un requerimiento (si le falta algo). */
  falta: string[]
}

const c = (n: number | null | undefined) => Math.round((n ?? 0) * 100)

/** Las facturas emitidas de las anotaciones del libro de expedidas. */
export function facturasDeAnotaciones(anot: readonly AnotacionLibro[]): FacturaEmitida[] {
  const grupos = new Map<string, AnotacionLibro[]>()
  for (const a of anot) {
    if (a.book !== 'issued') continue
    const k = [a.entryId, a.invoiceType, a.series ?? '', a.number ?? '', a.numberTo ?? ''].join('|')
    grupos.set(k, [...(grupos.get(k) ?? []), a])
  }
  return [...grupos.entries()].map(([id, as]) => {
    const a = as[0]
    const base = as.reduce((t, x) => t + c(x.taxBase), 0)
    const iva = as.reduce((t, x) => t + c(x.taxAmount), 0)
    const total = as.reduce((t, x) => t + (x.total === null ? c(x.taxBase) + c(x.taxAmount) + c(x.surchargeAmount) : c(x.total)), 0)
    const numero = [a.series, a.number].filter(Boolean).join('-') + (a.numberTo ? `–${a.numberTo}` : '')
    const anulada = as.every((x) => !!x.voidedAt)
    const falta = [...new Set(as.flatMap((x) => faltaParaCompletar(x)))]
    return {
      id, entryId: a.entryId, fecha: a.issueDate, numero: numero || null, tipo: etiquetaTipo(a),
      cliente: a.counterpartName, nif: a.counterpartTaxId,
      base: base / 100, iva: iva / 100, total: total / 100,
      estado: anulada ? 'anulada' : falta.length ? 'por-completar' : 'vigente', falta,
    }
  })
}

export type IdPestanaEmitidas = 'todas' | EstadoEmitida
const PESTANAS: { id: EstadoEmitida; etiqueta: string; siempre: boolean }[] = [
  { id: 'vigente', etiqueta: 'Emitidas', siempre: true },
  { id: 'por-completar', etiqueta: 'Por completar', siempre: false },
  { id: 'anulada', etiqueta: 'Anuladas', siempre: false },
]
export const NOMBRE_ESTADO: Record<EstadoEmitida, { texto: string; tono: 'seguro' | 'duda' | 'neutro' }> = {
  vigente: { texto: 'Emitida', tono: 'seguro' },
  'por-completar': { texto: 'Por completar', tono: 'duda' },
  anulada: { texto: 'Anulada', tono: 'neutro' },
}

/** Las pestañas con su número (de lo que deja el buscador): suman «Todas». */
export function pestanasEmitidas(fs: readonly FacturaEmitida[]): PestanaEstado[] {
  return pestanasConTodas(PESTANAS.map((p) => ({ ...p, n: fs.filter((f) => f.estado === p.id).length })))
}

const ORDEN_DE_SERIE = { columna: 'fecha', sentido: 'desc' as Sentido }
export const COLUMNAS_ORDENABLES = ['fecha', 'numero', 'cliente', 'total'] as const

export interface FiltrosEmitidas { pestana: IdPestanaEmitidas; q: string; mes: string; orden: { columna: string; sentido: Sentido } }

/** Los filtros, de la dirección (?ver=&q=&mes=&orden=): se recarga y la lista queda igual. */
export function filtrosEmitidas(query: URLSearchParams): FiltrosEmitidas {
  const ver = query.get('ver')
  const orden = leerOrden(query.get('orden') ?? undefined, ORDEN_DE_SERIE)
  return {
    pestana: ver === 'vigente' || ver === 'por-completar' || ver === 'anulada' ? ver : 'todas',
    q: query.get('q') ?? '',
    mes: /^\d{4}-\d{2}$/.test(query.get('mes') ?? '') ? query.get('mes')! : '',
    orden: (COLUMNAS_ORDENABLES as readonly string[]).includes(orden.columna) ? orden : ORDEN_DE_SERIE,
  }
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * El buscador: cliente, NIF, número o importe. Un importe se busca como se
 * escribe («191,51», «191.51» o «191»): casa con la base, el IVA o el total.
 */
export function casaConBusqueda(f: FacturaEmitida, q: string): boolean {
  const t = sinAcentos(q.trim())
  if (!t) return true
  const texto = sinAcentos([f.cliente, f.nif, f.numero, f.tipo].filter(Boolean).join(' '))
  if (t.split(/\s+/).every((p) => texto.includes(p))) return true
  const importe = Number(t.replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
  if (!Number.isFinite(importe) || !/\d/.test(t)) return false
  const conDecimales = /[.,]\d{1,2}$/.test(t)
  return [f.base, f.iva, f.total].some((x) => (conDecimales ? c(x) === c(importe) : Math.trunc(x) === Math.trunc(importe)))
}

/** Lo que deja el buscador (y el mes, si lo hay: la lectura ya viene de ese mes, pero se asegura). */
export function filtrarSinPestana(fs: readonly FacturaEmitida[], f: Pick<FiltrosEmitidas, 'q' | 'mes'>): FacturaEmitida[] {
  return fs.filter((x) => (!f.mes || x.fecha.startsWith(f.mes)) && casaConBusqueda(x, f.q))
}

/** Las filas de la lista: buscador, pestaña y orden. */
export function filasEmitidas(fs: readonly FacturaEmitida[], f: FiltrosEmitidas): FacturaEmitida[] {
  const sin = filtrarSinPestana(fs, f)
  const con = f.pestana === 'todas' ? sin : sin.filter((x) => x.estado === f.pestana)
  const valor = (x: FacturaEmitida): string | number | null =>
    f.orden.columna === 'total' ? x.total : f.orden.columna === 'cliente' ? x.cliente : f.orden.columna === 'numero' ? x.numero : x.fecha
  return ordenar(con, valor, f.orden.sentido)
}

/** El pie: cuántas y sus sumas. Las anuladas se cuentan aparte y no suman. */
export function totalesEmitidas(fs: readonly FacturaEmitida[]): { n: number; anuladas: number; base: number; iva: number; total: number } {
  const vivas = fs.filter((f) => f.estado !== 'anulada')
  const s = (k: 'base' | 'iva' | 'total') => vivas.reduce((t, f) => t + c(f[k]), 0) / 100
  return { n: vivas.length, anuladas: fs.length - vivas.length, base: s('base'), iva: s('iva'), total: s('total') }
}

/** Los meses ('YYYY-MM') de una ventana, para leerla mes a mes. */
export function mesesDeLaVentana(desde: string, hasta: string): { desde: string; hasta: string }[] {
  const out: { desde: string; hasta: string }[] = []
  let y = Number(desde.slice(0, 4)), m = Number(desde.slice(5, 7))
  const fin = hasta.slice(0, 7)
  for (;;) {
    const mes = `${y}-${String(m).padStart(2, '0')}`
    if (mes > fin) break
    const l = limites(mes)
    out.push({ desde: l.desde < desde ? desde : l.desde, hasta: l.hasta > hasta ? hasta : l.hasta })
    m += 1; if (m === 13) { m = 1; y += 1 }
  }
  return out
}
