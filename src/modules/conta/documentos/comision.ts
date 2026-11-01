// src/modules/conta/documentos/comision.ts
//
// S01i · La factura de comisión de una plataforma (Uber, Glovo, Just Eat) se
// liga a su liquidación y se paga por compensación con ella: no pasa por
// Pagos ni por Bancos. Aquí, lo que la ficha dice de eso, sin pantalla: lo
// prueban las unitarias (tests/conta/s01i). Lo que decide con qué liquidación
// va lo hace la base (_conta_comision_estado), con la misma regla para las que
// llegan solas y para las de antes.
import { eurosExactos } from '@/modules/conta/lib/formato'

export interface CandidataComision {
  id: string
  desde: string
  hasta: string
  tienda: string | null
  marca: string | null
  local: string | null
  aFacturar: number | null
  yaFacturado: number
  tePago: number | null
  referencia: boolean
  coincide: boolean
}

export interface LiquidacionLigada {
  id: string
  desde: string
  hasta: string
  tienda: string | null
  marca: string | null
  local: string | null
  aFacturar: number | null
  tePago: number | null
  fecha: string | null
  facturas: { id: string; codigo: string | null; numero: string | null; total: number }[]
}

export type EstadoComision =
  | { estado: 'no' }
  | { estado: 'ligada'; plataforma: string; liq: LiquidacionLigada }
  | { estado: 'fuera'; plataforma: string; porque: string }
  | { estado: 'sin_periodo' | 'varias' | 'una' | 'falta'; plataforma: string; porque: string; candidatas: CandidataComision[]; sugerida: string | null }

type J = Record<string, unknown>
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const ddmmaaaa = (iso: string) => `${ddmm(iso)}/${iso.slice(0, 4)}`

function candidata(x: J): CandidataComision {
  return {
    id: String(x.id), desde: String(x.desde), hasta: String(x.hasta), tienda: s(x.tienda), marca: s(x.marca), local: s(x.local),
    aFacturar: n(x.a_facturar), yaFacturado: n(x.ya_facturado) ?? 0, tePago: n(x.te_pago), referencia: x.referencia === true, coincide: x.coincide === true,
  }
}

/** Lo que devuelve conta_comision_de_la_factura, en la forma de la ficha. */
export function estadoComision(r: unknown): EstadoComision {
  const x = (r ?? {}) as J
  const plataforma = s(x.plataforma) ?? 'la plataforma'
  const e = s(x.estado)
  if (e === 'ligada' && x.liq) {
    const l = x.liq as J
    return {
      estado: 'ligada', plataforma,
      liq: {
        id: String(l.id), desde: String(l.desde), hasta: String(l.hasta), tienda: s(l.tienda), marca: s(l.marca), local: s(l.local),
        aFacturar: n(l.a_facturar), tePago: n(l.te_pago), fecha: s(l.fecha),
        facturas: ((l.facturas ?? []) as J[]).map((f) => ({ id: String(f.id), codigo: s(f.codigo), numero: s(f.numero), total: n(f.total) ?? 0 })),
      },
    }
  }
  if (e === 'fuera') return { estado: 'fuera', plataforma, porque: s(x.porque) ?? 'Se compensó fuera de Sumied.' }
  if (e === 'sin_periodo' || e === 'varias' || e === 'una' || e === 'falta') {
    const candidatas = ((x.candidatas ?? []) as J[]).map(candidata)
    // «una» en la ficha es que la base sabe cuál es pero aún no la ha ligado (se liga al guardar): se ofrece la misma.
    const sugerida = e === 'una' ? s(x.liquidacion) : candidatas.filter((c) => c.coincide).length === 1 ? candidatas.find((c) => c.coincide)!.id : null
    const porque = s(x.porque) ?? (e === 'una' ? `Encaja una sola liquidación de ${plataforma}: confírmala.` : '')
    return { estado: e, plataforma, porque, candidatas, sugerida }
  }
  return { estado: 'no' }
}

/** Lo que suman sus facturas contra lo que factura la liquidación (regla 7: la diferencia se ve). */
export function cuadreLiquidacion(l: LiquidacionLigada): { suma: number; diferencia: number | null; texto: string } {
  const suma = Math.round(l.facturas.reduce((t, f) => t + f.total, 0) * 100) / 100
  if (l.aFacturar === null) return { suma, diferencia: null, texto: `Sus facturas de comisión suman ${eurosExactos(suma)}.` }
  const diferencia = Math.round((suma - l.aFacturar) * 100) / 100
  const cuantas = l.facturas.length === 1 ? 'Su factura de comisión' : `Sus ${l.facturas.length} facturas de comisión`
  return {
    suma, diferencia,
    texto: diferencia === 0
      ? `${cuantas}: ${eurosExactos(suma)}, lo mismo que factura la liquidación.`
      : `${cuantas} ${l.facturas.length === 1 ? 'es de' : 'suman'} ${eurosExactos(suma)} y la liquidación factura ${eurosExactos(l.aFacturar)}: diferencia de ${eurosExactos(diferencia)}.`,
  }
}

/** El chip de la cabecera: solo cuando ya está pagada por compensación. */
export function chipComision(e: EstadoComision | null, pagada: boolean): string | null {
  if (!e || !pagada) return null
  if (e.estado === 'ligada') return `Pagada · compensada con la liquidación del ${ddmm(e.liq.fecha ?? e.liq.hasta)}`
  if (e.estado === 'fuera') return 'Pagada · compensada fuera de Sumied'
  return null
}

/** Lo que dice «Estado» en el bloque de pago: nunca «se casará sola con el banco». */
export function estadoPagoComision(e: EstadoComision | null, pagada: boolean): string | undefined {
  if (!e || e.estado === 'no') return undefined
  if (e.estado === 'ligada') return pagada ? `Compensada con la liquidación del ${ddmmaaaa(e.liq.fecha ?? e.liq.hasta)}, no se paga por banco.` : 'Se paga por compensación con su liquidación al validarla: no se paga por banco.'
  if (e.estado === 'fuera') return pagada ? 'Compensada fuera de Sumied, no se paga por banco.' : 'Se compensó fuera de Sumied: al validarla queda pagada, no se paga por banco.'
  return 'Se paga por compensación con su liquidación cuando esté ligada: no se paga por banco.'
}

/** El título del bloque y su tono, por estado. */
export function tituloComision(e: EstadoComision): { titulo: string; tono: 'ok' | 'duda' } {
  if (e.estado === 'ligada') return { titulo: `Liquidación de ${e.plataforma} del ${ddmm(e.liq.desde)} al ${ddmmaaaa(e.liq.hasta)}`, tono: 'ok' }
  if (e.estado === 'fuera') return { titulo: 'Compensada fuera de Sumied', tono: 'ok' }
  if (e.estado === 'falta') return { titulo: 'Falta la liquidación', tono: 'duda' }
  return { titulo: 'No sé con qué liquidación va', tono: 'duda' }
}

/** Una candidata en una línea: tienda, periodo y lo que factura. */
export function lineaCandidata(c: CandidataComision): string {
  const quien = [c.marca, c.local].filter(Boolean).join(' · ') || c.tienda || 'Sin tienda'
  const lleva = c.yaFacturado > 0 ? ` · ya lleva ${eurosExactos(c.yaFacturado)}` : ''
  return `${quien} · del ${ddmm(c.desde)} al ${ddmm(c.hasta)} · factura ${c.aFacturar === null ? '—' : eurosExactos(c.aFacturar)}${lleva}`
}
