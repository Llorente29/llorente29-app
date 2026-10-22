// supabase/functions/_shared/diezApunte.ts
//
// C07 · Todo asiento de Sumied a Diez (Julio, 22/10) · EL ASIENTO QUE NO ES UNA
// FACTURA (banco, manual, liquidación de impuestos, pagos, nóminas…), tal como
// se escribe en Diez por /api/apuntes/add. Puro: sin red ni base.
//
// Lo medido en la C0009 (solo leyendo, run 143 de diez-prueba-c0009, 22/10):
//   · la gestoría mete estos asientos como GENERALES (TipoAsiento 0), casi
//     todos en la serie 4 (3.135; dos de cada tres con la 572) y alguno en la 9;
//     el catálogo de series de Diez es el de Sumied (1, 2, 3, 4 y 9). Por eso va
//     en la serie del asiento en Sumied, que para el banco es la 4, como allí;
//   · se anulan con un CONTRAASIENTO: las mismas cuentas con el debe y el haber
//     cambiados (112 con su gemelo al revés; 0 con importes en negativo). En
//     Sumied, anular ya hace eso (journal_entry_anular), así que el
//     contraasiento de Sumied se manda tal cual: es otro asiento general.
//   · el número (Documento) no se manda: lo pone Diez y se lee de su
//     respuesta. Si Diez respeta un número mandado no está medido
//     (docs/conta/c04b/T1_comprobaciones.md) y no hace falta.
//   · ApunteSimplificado no lleva IVA ni analítica: la liquidación de impuestos
//     va como asiento general, con sus 47.

import type { Apunte, ApunteSimplificado } from './diezCliente.ts'

/** Lo que conta_asiento_envio devuelve de un asiento. */
export type AsientoBD = {
  id: string
  account_id: string
  company_id: string
  estado: string
  /** journal_entry.source_type. */
  origen: string
  /** La serie de Sumied (1 ventas, 2 compras, 3 banco, 4 general, 9 nóminas). */
  serie: number
  numero: number | null
  /** AAAA-MM-DD. */
  fecha: string
  concepto: string
  /** El que anula, si es un contraasiento. */
  anula: string | null
  /** De lo que anula: su origen (para saber cómo se mandó). */
  anulaOrigen?: string | null
  lineas: { cuenta: string; debe: number; haber: number; concepto: string | null }[]
}

/**
 * Los orígenes que van a Diez como asiento general. Las ventas del día y las
 * facturas recibidas van como factura (diezEnviar.ts). No van: lo traído de
 * Diez (migrated), la apertura y el cierre (TipoAsiento 3 y 5, que Diez hace
 * solo) y las plantillas.
 */
export const ORIGENES_APUNTE = [
  'bank', 'manual', 'vat_settlement', 'supplier_payment', 'channel_settlement', 'licensed_settlement',
  'payroll', 'sales_adjustment', 'purchase_accrual', 'purchase_accrual_reversal',
] as const
export const NO_VAN = ['migrated', 'opening', 'closing', 'template'] as const

/** ¿Cómo va este asiento a Diez? */
export type ComoVa = 'ventas' | 'recibida' | 'apunte' | 'contra_ventas' | 'contra_recibida' | 'contra_apunte' | 'no_va'
export function comoVa(origen: string, anulaOrigen?: string | null): ComoVa {
  if (origen === 'sales_day') return 'ventas'
  if (origen === 'supplier_invoice') return 'recibida'
  if (origen === 'reversal') {
    if (anulaOrigen === 'sales_day') return 'contra_ventas'
    if (anulaOrigen === 'supplier_invoice') return 'contra_recibida'
    return anulaOrigen && (ORIGENES_APUNTE as readonly string[]).includes(anulaOrigen) ? 'contra_apunte' : 'no_va'
  }
  return (ORIGENES_APUNTE as readonly string[]).includes(origen) ? 'apunte' : 'no_va'
}

/** Por qué un origen no va a Diez, en palabras. */
export function porQueNoVa(origen: string): string {
  if (origen === 'migrated') return 'este asiento se trajo de Diez: ya está allí'
  if (origen === 'opening' || origen === 'closing') return 'la apertura y el cierre los hace Diez con su ejercicio: no se mandan'
  if (origen === 'template') return 'una plantilla no es un asiento: no se manda'
  return `los asientos de tipo «${origen}» aún no se saben mandar a Diez`
}

const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)
const deCent = (c: number) => Math.round(c) / 100
/** Diez guarda la descripción corta: se recorta (sin saltos de línea). */
export const MAX_DESCRIPCION = 100
const texto = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPCION)

/**
 * El asiento de Sumied como asiento general de Diez. Lanza, en palabras, si no
 * se puede: sin líneas, una línea sin cuenta, o el debe y el haber no cuadran.
 * Las líneas a cero no se mandan.
 */
export function apunteDeAsiento(a: AsientoBD): ApunteSimplificado {
  const ls = a.lineas.filter((l) => cent(l.debe) !== 0 || cent(l.haber) !== 0)
  if (!ls.length) throw new Error('el asiento no tiene líneas con importe')
  if (ls.some((l) => !String(l.cuenta ?? '').trim())) throw new Error('una línea no tiene cuenta')
  const d = ls.reduce((t, l) => t + cent(l.debe), 0)
  const h = ls.reduce((t, l) => t + cent(l.haber), 0)
  if (d !== h) throw new Error(`el debe (${deCent(d)}) y el haber (${deCent(h)}) no cuadran`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.fecha)) throw new Error('el asiento no tiene fecha')
  const concepto = texto(a.concepto) || `Asiento ${a.numero ?? ''}`.trim()
  return {
    Ejercicio: a.fecha.slice(0, 4),
    Serie: String(a.serie),
    Fecha: Number(a.fecha.replace(/-/g, '')),
    Descripcion: concepto,
    Detalles: ls.map((l, i) => ({
      Linea: i + 1,
      Cuenta: String(l.cuenta).trim(),
      Debe: deCent(cent(l.debe)),
      Haber: deCent(cent(l.haber)),
      Descripcion: texto(l.concepto) || concepto,
    })),
  }
}

/** Las líneas como se comparan: cuenta, debe y haber en céntimos, sin orden. */
const firma = (xs: readonly { Cuenta?: string; Debe?: number; Haber?: number }[]) =>
  xs.filter((l) => cent(l.Debe) !== 0 || cent(l.Haber) !== 0).map((l) => `${String(l.Cuenta ?? '').trim()}:${cent(l.Debe)}:${cent(l.Haber)}`).sort().join('|')

/**
 * ¿Es este asiento de Diez el que se va a mandar? Un general (TipoAsiento 0) del
 * mismo día con las mismas líneas, en cualquier serie: la gestoría puede
 * haberlo metido a mano en la suya.
 */
export function esElMismoApunte(ap: ApunteSimplificado): (d: Apunte) => boolean {
  const f = firma(ap.Detalles)
  return (d) => Number(d.TipoAsiento ?? 0) === 0 && Number(d.Fecha) === ap.Fecha && firma(d.Detalles ?? []) === f
}

/** El listado de Diez repite filas (una por línea): uno por ejercicio, serie y documento. */
export function unoPorAsiento(xs: readonly Apunte[]): Apunte[] {
  return [...new Map(xs.map((a) => [`${a.Ejercicio ?? ''}|${a.Serie}|${a.Documento}`, a])).values()]
}

/** Las cuentas distintas del asiento (para mirar antes que Diez las tiene). */
export const cuentasDe = (ap: ApunteSimplificado) => [...new Set(ap.Detalles.map((l) => l.Cuenta))]
