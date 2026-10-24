// src/modules/conta/lib/liquidacionesPlataforma.ts
//
// V01 · Entrega 3 · Ventas › Hostelería › Liquidaciones › Plataformas: lo que
// se decide sin React.
//
// Una fila por periodo, plataforma y local (Uber liquida por tienda, es decir,
// por marca y local; los cierres del día van por local y canal: se suman las
// tiendas del mismo local y periodo). Con sus cifras:
//   · Ventas: lo que liquida la plataforma (sus ventas brutas);
//   · Comisión y Otros (lo demás que se queda: promociones, anuncios,
//     cargos…), de forma que Ventas − Comisión − Otros = Pagan;
//   · Pagan: lo que dice la liquidación que te ingresa;
//   · Banco: lo que llegó, casado en Bancos;
//   · su factura de comisión (de Compras: la comisión y su IVA van como gasto
//     con ella; aquí solo se comprueba que está).
// Y lo que se compara:
//   · las ventas de la liquidación contra las de tus cierres más las de las
//     marcas cedidas (la plataforma las paga, pero no son ventas tuyas);
//   · lo que llegó al banco contra lo que dice que paga;
//   · los pedidos cerrados sin confirmar que no cobra (C11b): una diferencia
//     cada uno (dejan de salir en el Libro diario: están aquí).
// El estado, en este orden: Diferencia (algo sin resolver) · Falta su factura
// · Por cobrar · Cuadra. Una diferencia se resuelve en una frase: gasto (con
// su asiento) o reclamación. Regla 7: el estado ordena y etiqueta; no esconde
// ninguna fila.

import { eurosExactos } from './formato'

export type EstadoPlataforma = 'diferencia' | 'falta-factura' | 'por-cobrar' | 'cuadra'
export type PestanaPlataformas = EstadoPlataforma | 'todas'

export interface LiquidacionDePlataforma {
  id: string
  tienda: string | null
  /** La calle de la tienda, la de los últimos paréntesis («Calle de Camichi 4»): de ahí sale su local (la 2031). */
  direccion: string | null
  ref: string | null
  fecha: string | null
  ventas: number
  comision: number
  neto: number | null
  cobrado: number | null
  cobradoEl: string | null
  casadaEnBanco: boolean
  /** De antes del corte: sirve para contrastar y casar el cobro; no lleva factura ni asiento. */
  referencia: boolean
  porAclarar: string | null
  /** Lo que su factura de comisión tiene que sumar (la parte de esta liquidación); null si no hay nada que facturar. */
  aFacturar: number | null
  factura: { id: string; numero: string | null; total: number | null } | null
  asiento: { id: string; estado: string; numero: number | null } | null
}

export interface PedidoSinCobrar { saleId: string; codigo: string | null; dia: string; total: number }

export interface Resolucion {
  id: string
  saleId: string | null
  tipo: 'gasto' | 'reclamacion'
  importe: number
  frase: string
  asientoId: string | null
  quien: string | null
  cuando: string | null
  codigo: string | null
  dia: string | null
  total: number | null
}

export interface GrupoPlataforma {
  /** La clave de la fila (y de su ficha): canal, local (o «sin»), desde y hasta. */
  clave: string
  canalId: string
  canal: string
  localId: string | null
  local: string | null
  desde: string
  hasta: string
  liquidaciones: LiquidacionDePlataforma[]
  cierres: { total: number; dias: number; validados: number; porValidar: number }
  cedidas: { total: number; pedidos: number }
  sinConfirmar: PedidoSinCobrar[]
  resoluciones: Resolucion[]
}

type Fila = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const n = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v))
const nn = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
export const r2 = (x: number): number => Math.round(x * 100) / 100
const cent = (x: number) => Math.round(x * 100)

/** La clave de una fila, para su dirección: «canal:local:desde:hasta» (local «sin» si no se sabe). */
export const claveGrupo = (canalId: string, localId: string | null, desde: string, hasta: string): string => `${canalId}:${localId ?? 'sin'}:${desde}:${hasta}`
export function deClave(clave: string): { canalId: string; localId: string | null; desde: string; hasta: string } | null {
  const m = /^([0-9a-f-]{36}):([0-9a-f-]{36}|sin):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(clave)
  return m ? { canalId: m[1], localId: m[2] === 'sin' ? null : m[2], desde: m[3], hasta: m[4] } : null
}

/** «Meraki Pita (Calle de Camichi 4) (Calle de Camichi 4, Madrid, ES, 28025)» → «Calle de Camichi 4». */
export function direccionDe(tienda: string | null): string | null {
  const m = tienda?.match(/\(([^()]*)\)\s*$/)
  const calle = m ? m[1].split(',')[0].trim() : ''
  return calle || null
}

export function grupoDeFila(f: Fila): GrupoPlataforma {
  const canalId = String(f.canal_id); const localId = s(f.local_id); const desde = String(f.desde).slice(0, 10); const hasta = String(f.hasta).slice(0, 10)
  const cierres = (f.cierres ?? {}) as Fila; const cedidas = (f.cedidas ?? {}) as Fila
  return {
    clave: claveGrupo(canalId, localId, desde, hasta), canalId, canal: String(f.canal ?? 'Plataforma'), localId, local: s(f.local), desde, hasta,
    liquidaciones: ((f.liquidaciones ?? []) as Fila[]).map((l) => {
      const fac = l.factura as Fila | null
      const as = l.asiento as Fila | null
      return {
        id: String(l.id), tienda: s(l.tienda) ? String(l.tienda).replace(/\s*\(.*\)\s*$/, '') : null, direccion: direccionDe(s(l.tienda)), ref: s(l.ref), fecha: s(l.fecha),
        ventas: n(l.ventas), comision: n(l.comision), neto: nn(l.neto), cobrado: nn(l.cobrado), cobradoEl: s(l.cobrado_el),
        casadaEnBanco: l.casada_en_banco === true, referencia: l.referencia === true, porAclarar: s(l.por_aclarar),
        aFacturar: nn(l.a_facturar), factura: fac ? { id: String(fac.id), numero: s(fac.numero), total: nn(fac.total) } : null,
        asiento: as ? { id: String(as.id), estado: String(as.estado), numero: nn(as.numero) } : null,
      }
    }),
    cierres: { total: n(cierres.total), dias: n(cierres.dias), validados: n(cierres.validados), porValidar: n(cierres.por_validar) },
    cedidas: { total: n(cedidas.total), pedidos: n(cedidas.pedidos) },
    sinConfirmar: ((f.sin_confirmar ?? []) as Fila[]).map((x) => ({ saleId: String(x.sale_id), codigo: s(x.codigo), dia: String(x.dia), total: n(x.total) })),
    resoluciones: ((f.resoluciones ?? []) as Fila[]).map((x) => ({
      id: String(x.id), saleId: s(x.sale_id), tipo: x.tipo === 'gasto' ? 'gasto' as const : 'reclamacion' as const, importe: n(x.importe), frase: String(x.frase ?? ''),
      asientoId: s(x.asiento_id), quien: s(x.quien), cuando: s(x.cuando), codigo: s(x.codigo), dia: s(x.dia), total: nn(x.total),
    })),
  }
}

/** Las cifras de la fila: lo que suman sus liquidaciones. Otros = Ventas − Comisión − Pagan (así siempre suma). */
export interface Cifras {
  ventas: number
  comision: number
  otros: number | null
  pagan: number | null
  /** Lo que llegó al banco; null si no ha llegado nada. */
  banco: number | null
  /** Las que tienen que pagar algo y aún no ha llegado (sin contar las de referencia). */
  porCobrar: number
  /** Las que tienen comisión que facturar y no tienen su factura enlazada. */
  faltanFacturas: number
}

export function cifras(g: GrupoPlataforma): Cifras {
  const ls = g.liquidaciones
  const ventas = r2(ls.reduce((t, l) => t + l.ventas, 0))
  const comision = r2(ls.reduce((t, l) => t + l.comision, 0))
  const conNeto = ls.every((l) => l.neto !== null)
  const pagan = conNeto ? r2(ls.reduce((t, l) => t + (l.neto ?? 0), 0)) : null
  const cobradas = ls.filter((l) => l.cobrado !== null)
  return {
    ventas, comision, pagan, otros: pagan === null ? null : r2(ventas - comision - pagan),
    banco: cobradas.length ? r2(cobradas.reduce((t, l) => t + (l.cobrado ?? 0), 0)) : null,
    porCobrar: ls.filter((l) => !l.referencia && l.cobrado === null && (l.neto ?? 0) > 0).length,
    faltanFacturas: ls.filter((l) => !l.referencia && (l.aFacturar ?? 0) > 0 && !l.factura).length,
  }
}

/** Una diferencia de la fila: sus cifras, su porqué y si ya se ha resuelto. */
export interface Diferencia {
  /** ventas · cobro · pedido (uno por cada cerrado sin confirmar que no cobra) · local (sin local no se puede comparar). */
  tipo: 'ventas' | 'cobro' | 'pedido' | 'local'
  /** Lo que falta (positivo: te pagan de menos). */
  importe: number
  texto: string
  saleId: string | null
  resuelta: Resolucion | null
}

/** Hasta dónde se da por igual: 1 céntimo por liquidación (los redondeos de cada una). */
const tolerancia = (g: GrupoPlataforma) => Math.max(1, g.liquidaciones.length)

export function diferencias(g: GrupoPlataforma): Diferencia[] {
  const c = cifras(g)
  const deGrupo = g.resoluciones.find((r) => !r.saleId) ?? null
  const out: Diferencia[] = []
  if (!g.localId) {
    // El local sale solo de la dirección de la tienda (la 2031). Si aquí no hay
    // local es que su dirección no es la de ningún local tuyo (y se avisó al
    // llegar), o que la liquidación no trae tienda.
    const calles = [...new Set(g.liquidaciones.map((l) => l.direccion).filter((d): d is string => !!d))]
    out.push({ tipo: 'local', importe: 0, saleId: null, resuelta: null,
      texto: calles.length
        ? `La dirección de ${calles.length === 1 ? 'su tienda' : 'sus tiendas'} (${calles.map((c) => `«${c}»`).join(', ')}) no es la de ningún local tuyo: sin local no se comparan con tus cierres. Revisa la dirección del local.`
        : 'Estas liquidaciones no traen su tienda ni su local: sin local no se comparan con tus cierres.' })
  } else {
    // Ventas: la plataforma liquida también las marcas cedidas; tus cierres, no.
    const tuyas = r2(g.cierres.total + g.cedidas.total)
    const dif = r2(tuyas - c.ventas)
    if (Math.abs(cent(dif)) > tolerancia(g)) {
      out.push({ tipo: 'ventas', importe: dif, saleId: null, resuelta: deGrupo,
        texto: dif > 0
          ? `Tus cierres${g.cedidas.total ? ' y las marcas cedidas' : ''} suman ${eurosExactos(tuyas)} y la liquidación ${eurosExactos(c.ventas)}: liquida ${eurosExactos(dif)} de menos.`
          : `La liquidación suma ${eurosExactos(c.ventas)} y tus cierres${g.cedidas.total ? ' y las marcas cedidas' : ''} ${eurosExactos(tuyas)}: liquida ${eurosExactos(-dif)} de más.` })
    }
  }
  // Cobro: solo cuando ha llegado todo lo que se espera (si falta alguna, es «Por cobrar»).
  if (c.banco !== null && c.pagan !== null && c.porCobrar === 0) {
    const dif = r2(c.pagan - c.banco)
    if (Math.abs(cent(dif)) > tolerancia(g)) {
      out.push({ tipo: 'cobro', importe: dif, saleId: null, resuelta: deGrupo,
        texto: dif > 0 ? `Dice que paga ${eurosExactos(c.pagan)} y al banco llegaron ${eurosExactos(c.banco)}: faltan ${eurosExactos(dif)}.`
          : `Dice que paga ${eurosExactos(c.pagan)} y al banco llegaron ${eurosExactos(c.banco)}: ${eurosExactos(-dif)} de más.` })
    }
  }
  for (const p of g.sinConfirmar) {
    out.push({ tipo: 'pedido', importe: p.total, saleId: p.saleId, resuelta: null,
      texto: `Pedido ${p.codigo ?? 'sin código'} del ${p.dia.split('-').reverse().join('/')}: cerrado sin confirmar y la liquidación no lo cobra (${eurosExactos(p.total)}).` })
  }
  // Los pedidos ya resueltos aquí siguen a la vista (regla 7), resueltos.
  for (const r of g.resoluciones.filter((x) => x.saleId)) {
    out.push({ tipo: 'pedido', importe: r.total ?? r.importe, saleId: r.saleId, resuelta: r,
      texto: `Pedido ${r.codigo ?? 'sin código'}${r.dia ? ` del ${r.dia.split('-').reverse().join('/')}` : ''}: cerrado sin confirmar y la liquidación no lo cobra (${eurosExactos(r.total ?? r.importe)}).` })
  }
  return out
}

/** Las diferencias que aún esperan una decisión. */
export const pendientes = (g: GrupoPlataforma): Diferencia[] => diferencias(g).filter((d) => !d.resuelta)

export function estado(g: GrupoPlataforma): EstadoPlataforma {
  if (pendientes(g).length) return 'diferencia'
  const c = cifras(g)
  if (c.faltanFacturas) return 'falta-factura'
  if (c.porCobrar) return 'por-cobrar'
  return 'cuadra'
}

export const NOMBRE_ESTADO: Record<EstadoPlataforma, { texto: string; tono: 'falta' | 'duda' | 'propuesto' | 'seguro' }> = {
  diferencia: { texto: 'Diferencia', tono: 'falta' },
  'falta-factura': { texto: 'Falta su factura', tono: 'duda' },
  'por-cobrar': { texto: 'Por cobrar', tono: 'propuesto' },
  cuadra: { texto: 'Cuadra', tono: 'seguro' },
}

/** Debajo del estado, en una frase: qué pasa y qué hacer. */
export function fraseEstado(g: GrupoPlataforma): string {
  const e = estado(g)
  const c = cifras(g)
  if (e === 'diferencia') {
    const ps = pendientes(g)
    return ps.length === 1 ? ps[0].texto : `${ps.length} diferencias por resolver: ábrela.`
  }
  if (e === 'falta-factura') return c.faltanFacturas === 1 ? 'Falta su factura de comisión (llega a Compras y gastos).' : `Faltan ${c.faltanFacturas} facturas de comisión (llegan a Compras y gastos).`
  if (e === 'por-cobrar') return c.porCobrar === 1 ? `Aún no ha llegado al banco${c.pagan !== null ? ` (${eurosExactos(c.pagan)})` : ''}.` : `${c.porCobrar} liquidaciones aún no han llegado al banco.`
  const resueltas = g.resoluciones.length
  return resueltas ? `Cuadra, con ${resueltas === 1 ? 'una diferencia resuelta' : `${resueltas} diferencias resueltas`}.` : 'Cuadra: ventas, cobro y factura.'
}

export function pestanaDe(v: string | null): PestanaPlataformas {
  return v === 'diferencia' || v === 'falta-factura' || v === 'por-cobrar' || v === 'cuadra' || v === 'todas' ? v : 'todas'
}

/** Las pestañas, con su cuenta; suman «Todas» (regla 7). */
export function pestanas(gs: readonly GrupoPlataforma[]): { id: PestanaPlataformas; etiqueta: string; n: number; siempre: boolean }[] {
  const c = (e: EstadoPlataforma) => gs.filter((g) => estado(g) === e).length
  return [
    { id: 'diferencia', etiqueta: 'Diferencia', n: c('diferencia'), siempre: true },
    { id: 'falta-factura', etiqueta: 'Falta su factura', n: c('falta-factura'), siempre: true },
    { id: 'por-cobrar', etiqueta: 'Por cobrar', n: c('por-cobrar'), siempre: true },
    { id: 'cuadra', etiqueta: 'Cuadra', n: c('cuadra'), siempre: true },
    { id: 'todas', etiqueta: 'Todas', n: gs.length, siempre: true },
  ]
}

export function filtrar(gs: readonly GrupoPlataforma[], p: PestanaPlataformas, q: string): GrupoPlataforma[] {
  const t = q.trim().toLowerCase()
  return gs.filter((g) => (p === 'todas' || estado(g) === p)
    && (!t || [g.canal, g.local ?? '', g.desde, g.hasta, ...g.liquidaciones.map((l) => `${l.tienda ?? ''} ${l.ref ?? ''}`)].some((v) => v.toLowerCase().includes(t))))
}

/** El periodo en palabras: «12–18/10/2026» (o «01/09–18/10/2026»). */
export function periodo(desde: string, hasta: string): string {
  const d = desde.split('-').reverse(); const h = hasta.split('-').reverse()
  if (desde === hasta) return h.join('/')
  if (desde.slice(0, 7) === hasta.slice(0, 7)) return `${d[0]}–${h.join('/')}`
  if (desde.slice(0, 4) === hasta.slice(0, 4)) return `${d[0]}/${d[1]}–${h.join('/')}`
  return `${d.join('/')}–${h.join('/')}`
}

/**
 * El asiento de un gasto: la diferencia que no se va a cobrar, a la cuenta de
 * gasto contra la 430 de la plataforma. Solo si te pagan de menos (importe > 0):
 * lo que pagan de más no es un gasto.
 */
export function asientoDeGasto(importe: number, cuentas: { gasto: string; cliente430: string }, c: { localId: string | null; concepto: string; terceroId: string | null }):
  { cuenta: string; debe: number; haber: number; concepto: string; local_id?: string; comun?: boolean; tercero_id?: string }[] | null {
  if (!(importe > 0)) return null
  const lado = c.localId ? { local_id: c.localId } : { comun: true }
  return [
    { cuenta: cuentas.gasto, debe: r2(importe), haber: 0, concepto: c.concepto, ...lado },
    { cuenta: cuentas.cliente430, debe: 0, haber: r2(importe), concepto: c.concepto, ...lado, ...(c.terceroId ? { tercero_id: c.terceroId } : {}) },
  ]
}
