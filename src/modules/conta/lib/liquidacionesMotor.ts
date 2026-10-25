// src/modules/conta/lib/liquidacionesMotor.ts
//
// V02 · Entrega 2 · Lo que el navegador hace con el motor de liquidaciones
// (conta_liquidaciones): leer cada fila y decir su estado con las palabras de la
// calle. El estado y su frase los decide la base, en UN sitio; aquí solo se
// leen, se nombran y se cuentan para las cifras de arriba. Sin React.
//
// Una fila = un intermediario (Uber, Glovo, Just Eat, el datáfono, Stripe…), un
// local (si lo hay) y un periodo, con sus cuatro piezas: lo vendido, la
// liquidación, su factura de comisión y el cobro en el banco.

export type EstadoLiquidacion = 'cuadra' | 'esperando_liquidacion' | 'falta_liquidacion' | 'falta_factura' | 'esperando_cobro' | 'diferencia'

export interface LiquidacionDeFila {
  id: string
  tienda: string | null
  ref: string | null
  origen: string
  pedidos: number | null
  ventas: number
  comision: number
  neto: number | null
  cobrado: number | null
  cobradoEl: string | null
  referencia: boolean
  porAclarar: string | null
  aFacturar: number | null
  factura: { id: string; numero: string | null; total: number | null } | null
  casadaEnBanco: boolean
  facturasCobradas: string | null
  facturasNota: string | null
}

export interface ResolucionDeFila { id: string; tipo: 'gasto' | 'reclamacion'; importe: number; frase: string; llegoEl: string | null; llego: number | null }

export interface AvisoDeFila { tipo: 'local_cerrado' | 'tienda_cambiada'; texto: string; cambioId: string | null }

export interface FilaMotor {
  clave: string
  intermediarioId: string | null
  intermediario: string
  canalId: string | null
  localId: string | null
  local: string | null
  desde: string
  hasta: string
  estado: EstadoLiquidacion
  cerrada: boolean
  diferencia: number | null
  frase: string
  vendido: { via: 'cierres' | 'facturas' | 'liquidacion'; total: number | null }
  liquidacion: { n: number; ventas: number; comision: number; pagan: number | null; otros: number | null; referencia: boolean }
  faltanFacturas: number
  cobro: { esperado: number | null; llegado: number | null; porCobrar: number }
  liquidaciones: LiquidacionDeFila[]
  resoluciones: ResolucionDeFila[]
  reclamadoSinLlegar: number
  avisos: AvisoDeFila[]
  plazo: string | null
}

type J = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const n = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v))
const nn = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
const ESTADOS: readonly EstadoLiquidacion[] = ['cuadra', 'esperando_liquidacion', 'falta_liquidacion', 'falta_factura', 'esperando_cobro', 'diferencia']

/** Una fila del motor, tal como la devuelve la base. */
export function filaMotor(x: J): FilaMotor {
  const p = (x.piezas ?? {}) as J
  const v = (p.vendido ?? {}) as J; const l = (p.liquidacion ?? {}) as J; const f = (p.factura ?? {}) as J; const c = (p.cobro ?? {}) as J
  const estado = ESTADOS.includes(x.estado as EstadoLiquidacion) ? (x.estado as EstadoLiquidacion) : 'diferencia'
  return {
    clave: String(x.clave), intermediarioId: s(x.intermediario_id), intermediario: String(x.intermediario ?? x.canal ?? 'Intermediario'),
    canalId: s(x.canal_id), localId: s(x.local_id), local: s(x.local), desde: String(x.desde).slice(0, 10), hasta: String(x.hasta).slice(0, 10),
    estado, cerrada: x.cerrada === true, diferencia: nn(x.diferencia), frase: String(x.frase ?? ''),
    vendido: { via: v.via === 'facturas' || v.via === 'liquidacion' ? v.via : 'cierres', total: nn(v.total) },
    liquidacion: { n: n(l.n), ventas: n(l.ventas), comision: n(l.comision), pagan: nn(l.pagan), otros: nn(l.otros), referencia: l.referencia === true },
    faltanFacturas: n(f.faltan),
    cobro: { esperado: nn(c.esperado), llegado: nn(c.llegado), porCobrar: n(c.por_cobrar) },
    liquidaciones: ((x.liquidaciones ?? []) as J[]).map((q) => {
      const fac = q.factura as J | null
      return {
        id: String(q.id), tienda: s(q.tienda), ref: s(q.ref), origen: String(q.origen ?? ''), pedidos: nn(q.pedidos), ventas: n(q.ventas), comision: n(q.comision),
        neto: nn(q.neto), cobrado: nn(q.cobrado), cobradoEl: s(q.cobrado_el), referencia: q.referencia === true, porAclarar: s(q.por_aclarar),
        aFacturar: nn(q.a_facturar), factura: fac ? { id: String(fac.id), numero: s(fac.numero), total: nn(fac.total) } : null,
        casadaEnBanco: q.casada_en_banco === true, facturasCobradas: s(q.facturas_cobradas), facturasNota: s(q.facturas_nota),
      }
    }),
    resoluciones: ((x.resoluciones ?? []) as J[]).map((r) => ({
      id: String(r.id), tipo: r.tipo === 'gasto' ? 'gasto' as const : 'reclamacion' as const, importe: n(r.importe), frase: String(r.frase ?? ''),
      llegoEl: s(r.llego_el), llego: nn(r.llego),
    })),
    reclamadoSinLlegar: n(x.reclamado_sin_llegar),
    avisos: ((x.avisos ?? []) as J[]).map((a) => ({ tipo: a.tipo === 'tienda_cambiada' ? 'tienda_cambiada' as const : 'local_cerrado' as const, texto: String(a.texto ?? ''), cambioId: s(a.cambio_id) })),
    plazo: s(x.plazo),
  }
}

/** Las palabras de la calle: el chip de cada estado (la diferencia, con su importe). */
export function nombreEstado(f: Pick<FilaMotor, 'estado' | 'diferencia'>): string {
  switch (f.estado) {
    case 'cuadra': return 'Cuadra'
    case 'esperando_liquidacion': return 'Esperando liquidación'
    case 'falta_liquidacion': return 'Falta su liquidación'
    case 'falta_factura': return 'Falta su factura'
    case 'esperando_cobro': return 'Esperando el cobro'
    case 'diferencia': return f.diferencia ? `Diferencia de ${Math.abs(f.diferencia).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : 'Diferencia'
  }
}

/** El tono del chip: verde lo cerrado, ámbar lo que espera o falta, rojo la diferencia. */
export const TONO: Record<EstadoLiquidacion, 'seguro' | 'propuesto' | 'duda' | 'falta'> = {
  cuadra: 'seguro', esperando_liquidacion: 'propuesto', esperando_cobro: 'propuesto', falta_factura: 'duda', falta_liquidacion: 'falta', diferencia: 'falta',
}

/** Las cifras de arriba: cuántas en cada estado (suman todas: regla 7) y lo que suman las diferencias. */
export function cifrasMotor(fs: readonly FilaMotor[]): { total: number; cuadran: number; esperando: number; faltan: number; diferencias: number; importeDiferencias: number; reclamado: number } {
  const c = (e: EstadoLiquidacion) => fs.filter((f) => f.estado === e).length
  return {
    total: fs.length,
    cuadran: c('cuadra'),
    esperando: c('esperando_liquidacion') + c('esperando_cobro'),
    faltan: c('falta_liquidacion') + c('falta_factura'),
    diferencias: c('diferencia'),
    importeDiferencias: Math.round(fs.filter((f) => f.estado === 'diferencia').reduce((t, f) => t + Math.abs(f.diferencia ?? 0), 0) * 100) / 100,
    reclamado: Math.round(fs.reduce((t, f) => t + f.reclamadoSinLlegar, 0) * 100) / 100,
  }
}
