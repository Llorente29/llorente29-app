// src/modules/conta/documentos/recibidas.ts
//
// S02 · Compras y gastos › Facturas recibidas, con la plantilla Lista
// (tableros 2 y 4): lo que la pantalla decide, sin React ni red.
//
//   · Las pestañas de estado SUMAN «Todas» (encargo S02): cada fila cae en
//     una sola. «Por revisar», «Por pagar» y «Pagadas» son las del patrón (en
//     palabras de oficina, regla 6) y salen siempre; «Por aclarar» (falta algo:
//     el proveedor, el PDF, el NIF) y «Otras» (repetidas, descartadas y las de
//     antes del corte que llevó Diez) solo si tienen algo. Ninguna fila se
//     queda fuera de una pestaña (regla 7).
//   · «Por revisar» cuenta lo mismo que el chip de la barra (las facturas
//     «para mirar» de los últimos 12 meses, recibidasParaRevisar): la ventana de
//     serie de la lista es esa, y el filtro de fecha la estrecha a un mes.
//   · Los filtros (buscar, fecha, proveedor, local y cómo llegó), el orden y la
//     fila donde ibas viven en la dirección (diseno/plantillas/lista.ts).

import type { PestanaEstado } from '@/modules/conta/diseno/plantillas'
import { leerOrden, ordenar, type Sentido } from '@/modules/conta/diseno/plantillas'
import { etiquetaSoporte, faltaElPdf, limites, ventanaParaRevisar, type Canal, type FilaDocumento } from './documentos'
import type { ExtraFactura } from '@/modules/conta/services/documentosService'

export type IdPestana = 'todas' | 'por-revisar' | 'por-aclarar' | 'por-pagar' | 'pagadas' | 'otras'

export const PESTANAS: { id: Exclude<IdPestana, 'todas'>; etiqueta: string; siempre: boolean }[] = [
  { id: 'por-revisar', etiqueta: 'Por revisar', siempre: true },
  { id: 'por-aclarar', etiqueta: 'Por aclarar', siempre: false },
  { id: 'por-pagar', etiqueta: 'Por pagar', siempre: true },
  { id: 'pagadas', etiqueta: 'Pagadas', siempre: true },
  { id: 'otras', etiqueta: 'Otras', siempre: false },
]

/** D04 · Lo que cuenta la cola de la ficha («1 de 77 por revisar»): el nombre de su pestaña, en minúscula. */
export function queCuentaLaCola(p: IdPestana): string {
  return p === 'todas' ? 'en total' : (PESTANAS.find((x) => x.id === p)?.etiqueta ?? '').toLowerCase()
}

/** La pestaña de la dirección; las de antes del S02 (?ver=para-mirar…) caen en la suya. */
export function pestanaDe(ver: string | null): IdPestana {
  if (ver === 'para-mirar') return 'por-revisar'
  if (ver === 'apuntadas') return 'todas'
  if (ver === 'todas' || PESTANAS.some((p) => p.id === ver)) return ver as IdPestana
  return 'por-revisar'
}

/** En qué pestaña cae una fila. Una sola. */
export function pestanaDeFila(f: FilaDocumento, extra: ExtraFactura | undefined): Exclude<IdPestana, 'todas'> {
  if (f.estado === 'para_mirar') return 'por-revisar'
  if (f.estado === 'por_aclarar') return 'por-aclarar'
  if (f.estado === 'apuntada') return extra?.pagada ? 'pagadas' : 'por-pagar'
  return 'otras'
}

/** Lo que dice el chip de estado de la fila, con su tono (los del patrón: Por revisar ámbar, Hecho verde). */
export function estadoDeFila(f: FilaDocumento, extra: ExtraFactura | undefined): { texto: string; tono: 'duda' | 'seguro' | 'neutro' | 'falta' } {
  switch (f.estado) {
    case 'para_mirar': return { texto: 'Por revisar', tono: 'duda' }
    case 'por_aclarar':
      if (f.tipo === 'llegada') return { texto: faltaElPdf(f) ? 'Falta el PDF' : 'Sin leer', tono: 'duda' }
      if (f.tipo === 'recepcion') return { texto: 'Aún no es factura', tono: 'duda' }
      if (!f.proveedor.id) return { texto: 'Proveedor nuevo', tono: 'duda' }
      return { texto: 'Por aclarar', tono: 'duda' }
    case 'apuntada': return extra?.pagada ? { texto: 'Pagada', tono: 'seguro' } : { texto: 'Por pagar', tono: 'neutro' }
    case 'repetida': return { texto: 'Repetida', tono: 'neutro' }
    case 'descartada': return { texto: 'No es una factura', tono: 'neutro' }
    case 'en_diez': return { texto: 'En Diez', tono: 'neutro' }
    case 'soporte': return { texto: f.soporte ? etiquetaSoporte(f.soporte) : 'Soporte de una liquidación', tono: 'neutro' }
    default: return { texto: 'Por aclarar', tono: 'duda' }
  }
}

export interface Filtros {
  pestana: IdPestana
  /** S01g · En «Otras», qué es (su etiqueta: «Repetidas», «Soporte · … · oct 2026 · …»), o ''. */
  que?: string
  /** Texto: proveedor, número o importe. */
  q: string
  /** 'YYYY-MM', o '' para los últimos 12 meses. */
  mes: string
  /** El proveedor (id), o ''. */
  prov: string
  /** El local (su nombre), o ''. «comun»: sin local. */
  local: string
  /** Cómo llegó, o ''. */
  canal: string
  orden: { columna: string; sentido: Sentido }
}

export const ORDEN_DE_SERIE: Filtros['orden'] = { columna: 'fecha', sentido: 'desc' }

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** ¿Casa la fila con lo buscado? Por proveedor, número o importe («110,87», «110.87», «110»). */
export function casaBusqueda(f: FilaDocumento, q: string): boolean {
  const t = q.trim()
  if (!t) return true
  const n = sinAcentos(t)
  if (sinAcentos(f.proveedor.nombre ?? '').includes(n)) return true
  if (sinAcentos(f.numero ?? '').includes(n)) return true
  const importe = Number(t.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''))
  if (f.total !== null && Number.isFinite(importe) && /\d/.test(t)) {
    if (Math.abs(f.total - importe) < 0.005) return true
    const escrito = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(f.total)
    if (escrito.includes(t.replace('.', ','))) return true
  }
  return false
}

/** El nombre del local de una fila: el de la factura o el de su recepción. */
export const localDeFila = (f: FilaDocumento, extra: ExtraFactura | undefined): string | null => extra?.local ?? f.recepcion?.local ?? null

/** Las filas que pasan los filtros (todos menos la pestaña): de aquí salen los números de las pestañas. */
export function filtrarSinPestana(filas: readonly FilaDocumento[], extras: ReadonlyMap<string, ExtraFactura>, f: Omit<Filtros, 'pestana' | 'orden'>): FilaDocumento[] {
  return filas.filter((x) => {
    const e = extras.get(x.id)
    if (f.mes && (x.fecha ?? x.llego.slice(0, 10)).slice(0, 7) !== f.mes) return false
    if (f.prov && x.proveedor.id !== f.prov) return false
    if (f.local) {
      const l = localDeFila(x, e)
      if (f.local === 'comun' ? l !== null : l !== f.local) return false
    }
    if (f.canal && x.canal !== f.canal) return false
    return casaBusqueda(x, f.q)
  })
}

/** Cuántas hay en cada pestaña, con «Todas» primero (la suma). */
export function pestanasConNumero(filas: readonly FilaDocumento[], extras: ReadonlyMap<string, ExtraFactura>): PestanaEstado[] {
  const n = new Map<string, number>()
  for (const x of filas) { const p = pestanaDeFila(x, extras.get(x.id)); n.set(p, (n.get(p) ?? 0) + 1) }
  const resto = PESTANAS.map((p) => ({ id: p.id, etiqueta: p.etiqueta, n: n.get(p.id) ?? 0, siempre: p.siempre }))
  return [{ id: 'todas', etiqueta: 'Todas', n: filas.length, siempre: true }, ...resto.filter((p) => p.siempre || p.n > 0)]
}

/** S01g · Qué es una fila de «Otras»: su etiqueta, para el filtro «Qué es». */
export function queEsOtra(f: FilaDocumento): string {
  switch (f.estado) {
    case 'soporte': return f.soporte ? etiquetaSoporte(f.soporte) : 'Soporte de una liquidación'
    case 'repetida': return 'Repetidas'
    case 'descartada': return 'No es una factura'
    case 'en_diez': return 'En Diez'
    default: return 'Otras'
  }
}

/** S01g · Las opciones del filtro «Qué es» de «Otras», con su número: solo las que hay. */
export function opcionesOtras(filas: readonly FilaDocumento[], extras: ReadonlyMap<string, ExtraFactura>): { etiqueta: string; n: number }[] {
  const n = new Map<string, number>()
  for (const x of filas) if (pestanaDeFila(x, extras.get(x.id)) === 'otras') n.set(queEsOtra(x), (n.get(queEsOtra(x)) ?? 0) + 1)
  return [...n.entries()].map(([etiqueta, k]) => ({ etiqueta, n: k })).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'))
}

/** Las filas de la lista, ya filtradas y ordenadas. */
export function filasDeLaLista(filas: readonly FilaDocumento[], extras: ReadonlyMap<string, ExtraFactura>, f: Filtros): FilaDocumento[] {
  const base = filtrarSinPestana(filas, extras, f)
  const enPestana = f.pestana === 'todas' ? base : base.filter((x) => pestanaDeFila(x, extras.get(x.id)) === f.pestana)
  // S01g · El filtro «Qué es», solo en «Otras»: se elige entre las etiquetas que hay (regla 30) y la fila nunca se esconde sin él (regla 7).
  const deLaPestana = f.pestana === 'otras' && f.que ? enPestana.filter((x) => queEsOtra(x) === f.que) : enPestana
  const valor = (x: FilaDocumento): string | number | null => {
    switch (f.orden.columna) {
      case 'proveedor': return x.proveedor.nombre ?? null
      case 'total': return x.total
      case 'numero': return x.numero
      default: return x.fecha ?? x.llego.slice(0, 10)
    }
  }
  // Con empate, la última que llegó primero; y el id desempata (el mismo orden en la lista y en «3 de 9»).
  const estable = [...deLaPestana].sort((a, b) => (a.llego === b.llego ? (a.id < b.id ? -1 : 1) : a.llego < b.llego ? 1 : -1))
  return ordenar(estable, valor, f.orden.sentido)
}

/** Las facturas de la cola, en el orden de la lista: para «3 de 9» y «Validar y siguiente». */
export const colaDeFacturas = (filas: readonly FilaDocumento[]): string[] => filas.filter((x) => x.tipo === 'factura').map((x) => x.id)

/**
 * Ficha completa, punto 11 («la barra dice 78 y la ficha 1 de 77»): la cola
 * «Por revisar» de serie, la de la lista sin filtros. De aquí sale el número
 * de la barra (inicioService.recibidasParaRevisar) y la ficha cuenta su «1 de
 * N» con la misma regla (colaDeFacturas ∘ filasDeLaLista): una sola cola. La
 * barra se vuelve a contar cuando la ficha valida, descarta o guarda
 * (refrescarCuentasMenu); antes no se le avisaba y se quedaba con el número de
 * antes de validar.
 */
export function colaPorRevisar(filas: readonly FilaDocumento[]): string[] {
  return colaDeFacturas(filasDeLaLista(filas, new Map(), filtrosDe(new URLSearchParams())))
}

/** El pie: «9 facturas por revisar · Base … · IVA … · Total …». */
export function totales(filas: readonly FilaDocumento[], extras: ReadonlyMap<string, ExtraFactura>): { n: number; base: number; iva: number; total: number; sinImporte: number } {
  let base = 0, iva = 0, total = 0, sinImporte = 0
  for (const x of filas) {
    const e = extras.get(x.id)
    if (x.total === null) { sinImporte += 1; continue }
    total += x.total
    base += e?.base ?? 0
    iva += e?.iva ?? 0
  }
  const r = (v: number) => Math.round(v * 100) / 100
  return { n: filas.length, base: r(base), iva: r(iva), total: r(total), sinImporte }
}

/** «Las facturas de tus proveedores…»: la frase de debajo del título, con lo que de verdad pasa. */
export function fraseDeLaLista(o: { correo: boolean; recibeMercancia: boolean; solo: boolean }): string {
  const entran = o.correo && o.recibeMercancia && !o.solo ? ' Las que llegan por correo o desde el local entran solas.'
    : o.correo ? ' Las que llegan por correo entran solas.'
      : o.recibeMercancia && !o.solo ? ' Las que se reciben en el local entran solas.'
        : ' Súbelas aquí y las leo yo.'
  return `Las facturas de tus proveedores.${entran}`
}

export const NOMBRE_CANAL: Record<Canal, string> = {
  correo: 'Por correo', subida: 'Subida', cocina: 'Del local', portal: 'Del portal', compras: 'Leída en Compras', a_mano: 'Escrita a mano',
}

/** La clave con la que se recuerda la última lista (diseno/plantillas/lista.ts). */
export const LISTA_RECIBIDAS = 'recibidas'

/** Los filtros de la dirección. Lo de serie: «Por revisar», los últimos 12 meses, por fecha. */
export function filtrosDe(query: URLSearchParams): Filtros {
  return {
    pestana: pestanaDe(query.get('ver')),
    q: query.get('q') ?? '',
    mes: /^\d{4}-\d{2}$/.test(query.get('mes') ?? '') ? query.get('mes')! : '',
    prov: query.get('prov') ?? '',
    local: query.get('local') ?? '',
    canal: query.get('canal') ?? '',
    que: query.get('que') ?? '',
    orden: leerOrden(query.get('orden') ?? undefined, ORDEN_DE_SERIE),
  }
}

/** La ventana que se lee: un mes, o los últimos 12 (la misma que el chip de la barra). */
export const ventanaDe = (mes: string, hoy: string): { desde: string; hasta: string } => (mes ? limites(mes) : ventanaParaRevisar(hoy))
