// src/modules/conta/lib/opcionesFicha.ts
//
// C00, tarea 7: la ficha de proveedor del C01 LEE de las tablas generales el
// IVA, la retención, la forma y el plazo de pago. Desde el C01b el IVA
// habitual se GUARDA como referencia a la fila de `tax_rate`
// (`usual_tax_rate_ids`); la retención, la forma y el plazo siguen en las
// columnas del C01 (`irpf_withholding_pct`, `payment_method`,
// `payment_terms_days`). Funciones puras: el servicio lee y esto decide.
//
// Dos reglas que no se negocian:
//   · La lista con la que se ELIGE no es la lista con la que se LEE (regla 30):
//     lo que el proveedor ya tiene guardado sale siempre, aunque la fila esté
//     oculta o ya no esté vigente, y dice por qué.
//   · Una fila oculta no se ofrece al elegir (para eso se oculta), pero no
//     desaparece de lo guardado.

import { cuentaDeApunte, cuentaPgc } from '@/modules/conta/lib/pgc'
import type { PaymentMethod } from '@/modules/conta/types'

export type Territorio = 'peninsula_baleares' | 'canarias' | 'ceuta_melilla'

/** El impuesto de las facturas que recibe una empresa, por dónde está. */
export const IMPUESTO_DEL_TERRITORIO: Record<Territorio, 'iva' | 'igic' | 'ipsi'> = {
  peninsula_baleares: 'iva', canarias: 'igic', ceuta_melilla: 'ipsi',
}

export interface FilaImpuesto {
  id: string; name: string; taxSystem: string; territory: string; treatment: string
  rate: number; validFrom: string; validTo: string | null; sortOrder: number
}
export interface FilaRetencion { id: string; name: string; rate: number; validFrom: string; validTo: string | null; sortOrder: number }
export interface FilaFormaPago { id: string; name: string; kind: string; sortOrder: number }
export interface FilaPlazo { id: string; name: string; days: number[]; fixedDays: number[]; sortOrder: number }

export interface FilasFicha {
  impuestos: FilaImpuesto[]
  retenciones: FilaRetencion[]
  formasPago: FilaFormaPago[]
  plazos: FilaPlazo[]
}

export interface Opcion<V> { valor: V; nombre: string }

/** Una fila de IVA (o IGIC/IPSI) por su id: lo que guarda la ficha desde el C01b. */
export interface FilaIva {
  id: string
  rate: number
  nombre: string
  /** ¿Se ofrece HOY al elegir? (de su territorio, vigente, no oculta, con impuesto o exenta) */
  ofrecida: boolean
}

export interface OpcionesFicha {
  /** La empresa de la que salen (sus filas propias y lo que ocultó), o null: solo las de serie. */
  empresa: { id: string; nombre: string } | null
  territorio: Territorio
  tiposIva: Opcion<number>[]
  /**
   * Todas las filas de impuesto leídas, por id, ofrecidas o no: con ellas se
   * ELIGE (las ofrecidas) y se LEE lo guardado (todas), regla 30.
   */
  iva: FilaIva[]
  retenciones: Opcion<number>[]
  formasPago: Opcion<PaymentMethod>[]
  plazos: Opcion<number>[]
  /** La longitud de las cuentas de la empresa; null sin empresa o sin perfil (respuesta 3, punto 3). */
  digitos: number | null
}

const vigente = (desde: string, hasta: string | null, hoy: string) => desde <= hoy && (hasta === null || hasta >= hoy)
const porOrden = <T extends { sortOrder: number }>(a: T, b: T) => a.sortOrder - b.sortOrder

/** Las cuatro formas que admite la ficha del C01 (su CHECK). «Otra» no tiene dónde guardarse. */
const FORMAS_DE_LA_FICHA: readonly PaymentMethod[] = ['transfer', 'direct_debit', 'card', 'cash']

/**
 * Las opciones de la ficha, de las filas leídas.
 * `ocultas`: ids que la empresa ocultó (general_row_setting.hidden).
 */
export function construirOpciones(filas: FilasFicha, ocultas: ReadonlySet<string>, territorio: Territorio, hoy: string,
  empresa: OpcionesFicha['empresa'], digitos: number | null = null): OpcionesFicha {
  const visible = (id: string) => !ocultas.has(id)
  const impuesto = IMPUESTO_DEL_TERRITORIO[territorio]

  // IVA: los porcentajes que se pueden poner HOY en una factura de su territorio
  // (sujetos o exentos; la inversión del sujeto pasivo y la compra en la UE son
  // un tratamiento, no un tipo que te cobre el proveedor).
  const tiposIva = new Map<number, string>()
  const iva: FilaIva[] = []
  for (const t of [...filas.impuestos].sort(porOrden)) {
    const ofrecida = t.taxSystem === impuesto && t.territory === territorio && visible(t.id)
      && (t.treatment === 'taxed' || t.treatment === 'exempt') && vigente(t.validFrom, t.validTo, hoy)
    iva.push({ id: t.id, rate: t.rate, nombre: t.name, ofrecida })
    if (!ofrecida) continue
    const previo = tiposIva.get(t.rate)
    tiposIva.set(t.rate, previo ? `${previo} · ${t.name}` : t.name)
  }

  const retenciones = new Map<number, string>()
  for (const r of [...filas.retenciones].sort(porOrden)) {
    if (!visible(r.id) || !vigente(r.validFrom, r.validTo, hoy)) continue
    const previo = retenciones.get(r.rate)
    retenciones.set(r.rate, previo ? `${previo} · ${r.name}` : r.name)
  }

  // La ficha guarda la forma por su tipo: dos filas del mismo tipo se guardarían
  // igual. Se ofrece la primera; el resto sale en el PR como lo que hace sobrar
  // la columna `payment_method` (hace falta guardar la fila, no el tipo).
  const formas = new Map<PaymentMethod, string>()
  for (const m of [...filas.formasPago].sort(porOrden)) {
    const kind = m.kind as PaymentMethod
    if (!visible(m.id) || !FORMAS_DE_LA_FICHA.includes(kind) || formas.has(kind)) continue
    formas.set(kind, m.name)
  }

  // El plazo de la ficha es UN número de días: los plazos de varios
  // vencimientos («30 y 60 días») no caben todavía (D6: solo definidos).
  const plazos = new Map<number, string>()
  for (const p of [...filas.plazos].sort(porOrden)) {
    if (!visible(p.id) || p.days.length !== 1 || p.fixedDays.length > 0 || plazos.has(p.days[0])) continue
    plazos.set(p.days[0], p.name)
  }

  const lista = <V>(m: Map<V, string>) => [...m.entries()].map(([valor, nombre]) => ({ valor, nombre }))
  return {
    empresa, territorio,
    tiposIva: lista(tiposIva).sort((a, b) => a.valor - b.valor),
    iva,
    retenciones: lista(retenciones).sort((a, b) => a.valor - b.valor),
    formasPago: lista(formas),
    plazos: lista(plazos).sort((a, b) => a.valor - b.valor),
    digitos,
  }
}

export interface Casilla {
  /** El id de la fila de `tax_rate`: lo que se guarda. */
  id: string
  rate: number | null
  nombre: string | null
  ofrecida: boolean
}

/**
 * Las casillas de IVA de la ficha: las filas que ofrece la tabla y, además,
 * las que el proveedor ya tiene guardadas aunque la tabla ya no las ofrezca
 * (regla 30: la lista con la que se elige no es la lista con la que se lee).
 * Un id guardado que ni siquiera está entre las filas leídas sale igual, sin
 * porcentaje: existe, y la pantalla lo dice.
 */
export function casillasIva(o: OpcionesFicha, guardadas: readonly string[]): Casilla[] {
  const porId = new Map(o.iva.map((f) => [f.id, f]))
  const out = new Map<string, Casilla>()
  for (const f of o.iva) if (f.ofrecida) out.set(f.id, { id: f.id, rate: f.rate, nombre: f.nombre, ofrecida: true })
  for (const g of guardadas) {
    if (out.has(g)) continue
    const f = porId.get(g)
    out.set(g, { id: g, rate: f?.rate ?? null, nombre: f?.nombre ?? null, ofrecida: false })
  }
  return [...out.values()].sort((a, b) => (a.rate ?? 999) - (b.rate ?? 999) || (a.nombre ?? '').localeCompare(b.nombre ?? ''))
}

/** Los porcentajes de los IVA guardados, ordenados y sin repetir. Los que no se encuentran no suman. */
export function porcentajesIva(o: Pick<OpcionesFicha, 'iva'> | null, guardadas: readonly string[]): number[] {
  if (!o) return []
  const porId = new Map(o.iva.map((f) => [f.id, f.rate]))
  return [...new Set(guardadas.map((g) => porId.get(g)).filter((r): r is number => r !== undefined))].sort((a, b) => a - b)
}

/** Las formas de pago del desplegable: las de la tabla y, si la guardada no está, también. */
export function formasDelDesplegable(o: OpcionesFicha, guardada: PaymentMethod | null, nombreDeReserva: Record<PaymentMethod, string>): (Opcion<PaymentMethod> & { ofrecida: boolean })[] {
  const out = o.formasPago.map((f) => ({ ...f, ofrecida: true }))
  if (guardada && !out.some((f) => f.valor === guardada)) out.push({ valor: guardada, nombre: nombreDeReserva[guardada], ofrecida: false })
  return out
}

/** El nombre de una forma de pago guardada, de la tabla si está; si no, el de siempre. */
export function nombreFormaPago(o: OpcionesFicha | null, valor: PaymentMethod, nombreDeReserva: Record<PaymentMethod, string>): string {
  return o?.formasPago.find((f) => f.valor === valor)?.nombre ?? nombreDeReserva[valor]
}

/**
 * La cuenta donde se apuntan las facturas, en la ficha: con la longitud de la
 * empresa («62500000 · Primas de seguros»). Sin empresa no hay longitud: el
 * código del plan, que es lo único que se sabe (respuesta 3, punto 3).
 */
export function cuentaEnLaFicha(o: Pick<OpcionesFicha, 'digitos'>, codigoPlan: string): string {
  return o.digitos === null ? cuentaPgc(codigoPlan) : cuentaDeApunte(codigoPlan, o.digitos)
}
