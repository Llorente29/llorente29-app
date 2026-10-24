// src/modules/conta/lib/loQueDejaElCierre.ts
//
// N2 · Lo que deja el cierre del día (C11 y C11b, Julio, 23/10). Núcleo puro:
// el estado de cada pedido que el cierre apuntó, su acción, el orden y lo que
// dice la pantalla. Se prueba sin base ni React.
//
// Lo que apunta el cierre (sales_day_close_log.accion):
//   · 'revisar': un pedido del TPV o de la tienda que seguía abierto a la hora
//     de cierre. El cierre no lo toca: se cierra o se anula donde se cobró.
//   · 'cerrado_sin_confirmar': un pedido de plataforma abierto que el cierre
//     cerró como vendido sin que la plataforma lo confirmara. Si la liquidación
//     de su canal ya cubre su día y no lo trae cobrado, hay que decidir:
//     proponer la devolución (no se cobró) o descartarlo (se cobró por otro lado).
//
// Regla 7: la pantalla se abre a propósito y NO esconde filas. Lo que espera
// una decisión va primero; lo demás sigue a la vista, con su estado.

export type EstadoCierre =
  | 'revisar'               // TPV o tienda, sigue abierto: ciérralo o anúlalo en el TPV
  | 'revisar_resuelto'      // TPV o tienda que ya no está abierto (se cerró o anuló después)
  | 'sin_cobrar'            // de plataforma: su liquidación cubre el día y no lo cobra
  | 'devolucion_propuesta'  // su devolución ya está en el libro (propuesta o validada)
  | 'descartado'            // se dijo que se cobró por otro lado
  | 'cobrado'               // su liquidación lo trae cobrado
  | 'sin_liquidacion'       // aún no ha llegado la liquidación que cubre su día

export interface FilaCierre {
  saleId: string
  dia: string                 // AAAA-MM-DD, el día de venta
  codigo: string | null
  total: number
  accion: 'revisar' | 'cerrado_sin_confirmar'
  /** El estado de la venta hoy (sale.status). */
  estadoVenta: string
  origen: string | null       // sale.source: folvy_pos, folvy_shop, hubrise…
  canal: string               // el nombre del canal, o del origen
  local: string
  /** La liquidación que cubre su día y no lo cobra (de conta_sin_confirmar_no_cobrados). */
  liquidacion: { ref: string | null; fecha: string | null } | null
  cobrado: boolean
  descartado: boolean
  devolucion: boolean
}

export function estadoDe(f: FilaCierre): EstadoCierre {
  if (f.accion === 'revisar') return f.estadoVenta === 'open' ? 'revisar' : 'revisar_resuelto'
  if (f.devolucion) return 'devolucion_propuesta'
  if (f.descartado) return 'descartado'
  if (f.cobrado) return 'cobrado'
  if (f.liquidacion) return 'sin_cobrar'
  return 'sin_liquidacion'
}

/** ¿Espera una decisión tuya? (lo que cuenta la cabecera y va primero). */
export const esperaDecision = (e: EstadoCierre): boolean => e === 'revisar' || e === 'sin_cobrar'

const ORDEN: Record<EstadoCierre, number> = {
  revisar: 0, sin_cobrar: 1, sin_liquidacion: 2, devolucion_propuesta: 3, descartado: 4, cobrado: 5, revisar_resuelto: 6,
}

/** Lo que espera decisión primero; dentro, del día más antiguo al más reciente. Nada se quita. */
export function ordenar(filas: readonly FilaCierre[]): FilaCierre[] {
  return [...filas].sort((a, b) => ORDEN[estadoDe(a)] - ORDEN[estadoDe(b)] || a.dia.localeCompare(b.dia) || (a.codigo ?? '').localeCompare(b.codigo ?? ''))
}

const fecha = (d: string) => d.split('-').reverse().join('/')
const euros = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n)

/** El título de la fila: «Pedido X de Uber Eats del 06/10 · 25,90 €». */
export function tituloDe(f: FilaCierre): string {
  return `Pedido ${f.codigo ?? 'sin código'} de ${f.canal} del ${fecha(f.dia)} · ${euros(f.total)}`
}

/** El porqué de la fila, en palabras. */
export function porqueDe(f: FilaCierre): string {
  const liq = f.liquidacion?.ref ? `la liquidación ${f.liquidacion.ref}${f.liquidacion.fecha ? ` del ${fecha(f.liquidacion.fecha)}` : ''}` : 'su liquidación'
  switch (estadoDe(f)) {
    case 'revisar': return `Seguía abierto a la hora de cierre en ${f.local}. El cierre no toca lo del TPV ni de la tienda: ciérralo (si se cobró) o anúlalo donde se hizo. Mientras siga abierto, su día no se asienta.`
    case 'revisar_resuelto': return `Seguía abierto a la hora de cierre; ya está ${f.estadoVenta === 'closed' ? 'cerrado' : f.estadoVenta === 'cancelled' ? 'anulado' : f.estadoVenta}. No hay nada que hacer.`
    case 'sin_cobrar': return `Se cerró como vendido al cierre del día sin que ${f.canal} lo confirmara, y ${liq} no lo trae cobrado. Si no se cobró, propón la devolución; si se cobró por otro lado, dilo y no vuelvo a avisar.`
    case 'devolucion_propuesta': return 'Su devolución está en el libro: valídala allí si no lo está.'
    case 'descartado': return 'Se cobró por otro lado: no hay ajuste que hacer.'
    case 'cobrado': return `Se cerró como vendido sin confirmar, y ${f.canal} lo ha cobrado en su liquidación: está bien.`
    case 'sin_liquidacion': return `Se cerró como vendido sin confirmar. Aún no ha llegado la liquidación de ${f.canal} que cubre su día: cuando llegue, se mira si lo cobra.`
  }
}

/** La etiqueta corta del estado (el chip de la fila). */
export const ETIQUETA: Record<EstadoCierre, string> = {
  revisar: 'Para revisar', revisar_resuelto: 'Resuelto', sin_cobrar: 'Sin cobrar', devolucion_propuesta: 'Devolución propuesta',
  descartado: 'Cobrado por otro lado', cobrado: 'Cobrado', sin_liquidacion: 'Esperando liquidación',
}

/** Las cifras de arriba: lo que espera decisión, y lo cerrado sin confirmar con su importe. */
export function cifras(filas: readonly FilaCierre[]): { revisar: number; sinCobrar: { n: number; total: number }; sinConfirmar: { n: number; total: number } } {
  const sum = (xs: readonly FilaCierre[]) => Math.round(xs.reduce((t, x) => t + Math.round(x.total * 100), 0)) / 100
  const sinCobrar = filas.filter((f) => estadoDe(f) === 'sin_cobrar')
  const sinConfirmar = filas.filter((f) => f.accion === 'cerrado_sin_confirmar')
  return {
    revisar: filas.filter((f) => estadoDe(f) === 'revisar').length,
    sinCobrar: { n: sinCobrar.length, total: sum(sinCobrar) },
    sinConfirmar: { n: sinConfirmar.length, total: sum(sinConfirmar) },
  }
}

/** El motivo que se guarda al descartar (journal_dismissal.reason). */
export const MOTIVO_COBRADO_POR_OTRO_LADO = 'Cerrado sin confirmar al cierre del día: se cobró por otro lado (no hace falta la devolución).'
