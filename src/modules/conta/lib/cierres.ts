// src/modules/conta/lib/cierres.ts
//
// V01 · Entrega 2 · Ventas › Cierres del día: lo que se decide sin React.
//
//   · Un cierre es lo que propone el cierre del día cada hora: un día, un
//     local y un canal (y una marca, si el canal va por marca). Solo marcas
//     propias: las cedidas no se proponen, así que no salen.
//   · Pestañas que suman «Todos» (regla 7): Por validar, En espera, Validados
//     (y Anulados, solo si los hay). Nada se esconde: un día que el cierre del
//     día no ha podido proponer sale en «En espera» con su porqué.
//   · «Ayer»: lo vendido el último día con cierres, para el resumen de arriba.
//   · Los cambios de los pedidos antes de guardar (quitar, pasar a otro día,
//     ajustar el importe y deshacer): nada se guarda solo.

export type EstadoCierre = 'por_validar' | 'en_espera' | 'validado' | 'anulado'
export type PestanaCierres = 'por-validar' | 'en-espera' | 'validados' | 'anulados' | 'todos'

export interface Cierre {
  /** El sales_day_summary; null para un día que el cierre no ha podido proponer. */
  id: string | null
  localId: string
  local: string
  dia: string
  unidad: string | null
  canalId: string | null
  canal: string
  canalSlug: string | null
  marca: string | null
  tiques: number
  total: number
  asientoId: string | null
  estadoAsiento: string | null
  numeroAsiento: number | null
  facturaId: string | null
  factura: string | null
  documento: string | null
  ajustes: number
  estado: EstadoCierre
  motivo: string | null
  esperaAMano: boolean
}

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

export function cierreDeFila(f: Fila): Cierre {
  const estado = String(f.estado) as EstadoCierre
  return {
    id: s(f.id), localId: String(f.local_id), local: String(f.local ?? 'su local'), dia: String(f.dia), unidad: s(f.unidad),
    canalId: s(f.canal_id), canal: String(f.canal ?? 'Sin canal'), canalSlug: s(f.canal_slug), marca: s(f.marca),
    tiques: n(f.tiques), total: n(f.total), asientoId: s(f.asiento_id), estadoAsiento: s(f.estado_asiento),
    numeroAsiento: f.numero_asiento == null ? null : n(f.numero_asiento), facturaId: s(f.factura_id), factura: s(f.factura),
    documento: s(f.documento), ajustes: n(f.ajustes), estado: ['por_validar', 'en_espera', 'validado', 'anulado'].includes(estado) ? estado : 'en_espera',
    motivo: s(f.motivo), esperaAMano: f.espera_a_mano === true,
  }
}

export const NOMBRE_ESTADO_CIERRE: Record<EstadoCierre, { texto: string; tono: 'propuesto' | 'duda' | 'seguro' | 'neutro' }> = {
  por_validar: { texto: 'Por validar', tono: 'propuesto' },
  en_espera: { texto: 'En espera', tono: 'duda' },
  validado: { texto: 'Validado', tono: 'seguro' },
  anulado: { texto: 'Anulado', tono: 'neutro' },
}

const DE_PESTANA: Record<Exclude<PestanaCierres, 'todos'>, EstadoCierre> = {
  'por-validar': 'por_validar', 'en-espera': 'en_espera', validados: 'validado', anulados: 'anulado',
}

export function pestanaDe(v: string | null): PestanaCierres {
  return v === 'por-validar' || v === 'en-espera' || v === 'validados' || v === 'anulados' || v === 'todos' ? v : 'por-validar'
}

/** Las pestañas con su cuenta. «Anulados» solo si los hay; las demás siempre (suman «Todos»). */
export function pestanasCierres(xs: readonly Cierre[]): { id: PestanaCierres; etiqueta: string; n: number; siempre?: boolean }[] {
  const c = (e: EstadoCierre) => xs.filter((x) => x.estado === e).length
  return [
    { id: 'por-validar' as const, etiqueta: 'Por validar', n: c('por_validar'), siempre: true },
    { id: 'en-espera' as const, etiqueta: 'En espera', n: c('en_espera'), siempre: true },
    { id: 'validados' as const, etiqueta: 'Validados', n: c('validado'), siempre: true },
    ...(c('anulado') ? [{ id: 'anulados' as const, etiqueta: 'Anulados', n: c('anulado') }] : []),
    { id: 'todos' as const, etiqueta: 'Todos', n: xs.length, siempre: true },
  ]
}

export function filtrarCierres(xs: readonly Cierre[], pestana: PestanaCierres, q: string): Cierre[] {
  const t = q.trim().toLowerCase()
  return xs.filter((x) => (pestana === 'todos' || x.estado === DE_PESTANA[pestana])
    && (!t || [x.local, x.canal, x.marca ?? '', x.factura ?? '', x.dia, x.motivo ?? ''].some((v) => v.toLowerCase().includes(t))
      || (Number(t.replace(',', '.')) > 0 && Math.abs(x.total - Number(t.replace(',', '.'))) < 0.005)))
}

/** Los que se pueden validar de una vez: por validar, con su asiento y sin nada que lo frene. */
export const listos = (xs: readonly Cierre[]): Cierre[] => xs.filter((x) => x.estado === 'por_validar' && !!x.asientoId && !!x.id)

/** El resumen de «ayer»: el último día con cierres (de cualquier estado), por canal. */
export function resumenDeAyer(xs: readonly Cierre[]): { dia: string; total: number; tiques: number; porCanal: { canal: string; total: number }[]; porValidar: number } | null {
  const conCierre = xs.filter((x) => x.id)
  if (!conCierre.length) return null
  const dia = conCierre.map((x) => x.dia).sort().at(-1)!
  const delDia = conCierre.filter((x) => x.dia === dia && x.estado !== 'anulado')
  const porCanal = new Map<string, number>()
  for (const x of delDia) porCanal.set(x.canal, Math.round(((porCanal.get(x.canal) ?? 0) + x.total) * 100) / 100)
  return {
    dia, total: Math.round(delDia.reduce((t, x) => t + x.total, 0) * 100) / 100, tiques: delDia.reduce((t, x) => t + x.tiques, 0),
    porCanal: [...porCanal].map(([canal, total]) => ({ canal, total })).sort((a, b) => b.total - a.total),
    porValidar: delDia.filter((x) => x.estado === 'por_validar').length,
  }
}

/** El siguiente y el anterior de la misma lista (‹ ›), en el orden en que se ve. */
export function vecinos(xs: readonly Cierre[], id: string): { anterior: Cierre | null; siguiente: Cierre | null } {
  const conId = xs.filter((x) => x.id)
  const i = conId.findIndex((x) => x.id === id)
  if (i < 0) return { anterior: null, siguiente: null }
  return { anterior: conId[i - 1] ?? null, siguiente: conId[i + 1] ?? null }
}

/** El que toca después de validar uno: el siguiente por validar, o null. */
export function siguientePorValidar(xs: readonly Cierre[], id: string): Cierre | null {
  const conId = xs.filter((x) => x.id)
  const i = conId.findIndex((x) => x.id === id)
  return [...conId.slice(i + 1), ...conId.slice(0, Math.max(i, 0))].find((x) => x.estado === 'por_validar' && x.id !== id) ?? null
}

// ── Los pedidos de un cierre y sus cambios ─────────────────────────────────────

export interface AjustePedido {
  quitado: boolean
  dia: string | null
  importe: number | null
  importeAntes: number
  motivo: string | null
  quien: string | null
  deOtroDia: boolean
}

export interface PedidoCierre {
  id: string
  codigo: string
  hora: string
  dia: string
  marca: string | null
  propia: boolean
  estado: string
  total: number
  totalPedido: number
  cuenta: boolean
  ajuste: AjustePedido | null
}

export function pedidoDeFila(f: Fila): PedidoCierre {
  const a = f.ajuste as Fila | null
  return {
    id: String(f.id), codigo: String(f.codigo ?? ''), hora: String(f.hora ?? ''), dia: String(f.dia ?? ''), marca: s(f.marca), propia: f.propia !== false,
    estado: String(f.estado ?? ''), total: n(f.total), totalPedido: n(f.total_pedido), cuenta: f.cuenta === true,
    ajuste: a ? {
      quitado: a.quitado === true, dia: s(a.dia), importe: a.importe == null ? null : n(a.importe), importeAntes: n(a.importe_antes),
      motivo: s(a.motivo), quien: s(a.quien), deOtroDia: a.de_otro_dia === true,
    } : null,
  }
}

/** Lo que dice cada estado de un pedido, en palabras de la calle. */
export const NOMBRE_ESTADO_PEDIDO: Record<string, string> = {
  closed: 'Cerrado', open: 'Abierto', cancelled: 'Anulado', unconfirmed: 'Sin confirmar',
}

export type CambioPedido =
  | { pedido: string; accion: 'quitar'; motivo: string }
  | { pedido: string; accion: 'mover'; dia: string; motivo?: string }
  | { pedido: string; accion: 'importe'; importe: number; motivo?: string }
  | { pedido: string; accion: 'deshacer' }

/** Un cambio por pedido: el último manda. */
export function ponerCambio(cs: readonly CambioPedido[], c: CambioPedido): CambioPedido[] {
  return [...cs.filter((x) => x.pedido !== c.pedido), c]
}

const fechaCorta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const euros = (x: number) => `${x.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/** El cambio en una frase, para la barra de cambios y para confirmar. */
export function textoCambio(c: CambioPedido, p: PedidoCierre | undefined): string {
  const quien = p ? `el ${p.codigo}` : 'un pedido'
  switch (c.accion) {
    case 'quitar': return `Quitar ${quien} de este cierre: ${c.motivo}`
    case 'mover': return `Pasar ${quien} al ${fechaCorta(c.dia)}`
    case 'importe': return `${p ? `El ${p.codigo}` : 'Un pedido'} cuenta ${euros(c.importe)}${p ? ` (era ${euros(p.ajuste?.importeAntes ?? p.totalPedido)})` : ''}`
    case 'deshacer': return `Deshacer lo cambiado en ${quien}`
  }
}

/** Cómo quedará el total del cierre con los cambios sin guardar (lo que cuenta, nada más). */
export function totalConCambios(ps: readonly PedidoCierre[], cs: readonly CambioPedido[], dia: string): number {
  const por = new Map(cs.map((c) => [c.pedido, c]))
  let t = 0
  for (const p of ps) {
    if (!p.propia || p.estado !== 'closed') continue
    const c = por.get(p.id)
    if (!c) { if (p.cuenta) t += Math.round(p.total * 100); continue }
    if (c.accion === 'quitar') continue
    if (c.accion === 'mover') { if (c.dia === dia) t += Math.round(p.totalPedido * 100); continue }
    if (c.accion === 'importe') { t += Math.round(c.importe * 100); continue }
    // Deshacer: vuelve a su día con su importe; cuenta aquí si este es su día.
    if (p.dia === dia) t += Math.round(p.totalPedido * 100)
  }
  return t / 100
}

/** Lo que el menú «⋯» ofrece para un pedido. */
export function accionesDe(p: PedidoCierre): ('quitar' | 'mover' | 'importe' | 'deshacer' | 'ver')[] {
  const r: ('quitar' | 'mover' | 'importe' | 'deshacer' | 'ver')[] = []
  if (p.ajuste) r.push('deshacer')
  if (p.propia && p.estado === 'closed') {
    if (!p.ajuste?.quitado) r.push('quitar')
    r.push('mover')
    if (!p.ajuste?.quitado && !p.ajuste?.deOtroDia) r.push('importe')
  }
  r.push('ver')
  return r
}

/** La etiqueta de lo cambiado en un pedido ya guardado. */
export function etiquetaAjuste(a: AjustePedido): string {
  if (a.quitado) return 'QUITADO'
  if (a.deOtroDia) return 'DE OTRO DÍA'
  if (a.dia) return `PASADO AL ${fechaCorta(a.dia)}`
  return 'CAMBIADO'
}
