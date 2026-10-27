// src/native/print/fiscalTique.ts
//
// V04 · PR 1 · Lo fiscal del tique de la bolsa, en un solo sitio: lo que pintan
// la imagen que imprime la tablet (ticketImage.ts), el tique en texto
// (ticketRenderer.ts) y la vista previa de Pedidos (orders/lib/ticketRenderer).
//
// Decisión de Julio (26/10): el tique es la factura simplificada y no cambia;
// solo lleva lo mínimo que pide la ley (maqueta «Tique de bolsa con Verifactu»,
// tableros 1 y 2), justo debajo de la fecha:
//   · una línea con quién factura: «Llorente29 Food, S.L. · NIF B56496938»;
//   · en las cedidas, además, la dirección del socio (la que trae la factura
//     de Last);
//   · «Factura Simplificada» con su número: el de nuestra serie (CA26-000123),
//     el de la factura de Last en las cedidas, o el de antes. Una cedida que
//     llegó sin la factura de Last va SIN esa línea: nunca se inventa un número.
// Lo da la base (fiscal_for_print al imprimir, fiscal_for_preview al mirar).

/** Lo que devuelve fiscal_for_print / fiscal_for_preview. Todo opcional: una base de antes no trae lo nuevo. */
export interface FiscalTique {
  legalName?: string | null
  taxId?: string | null
  address?: string | null
  ticketNumber?: string | null
  /** propia: factura nuestra empresa; cedida: el socio (Last). */
  issuerKind?: 'propia' | 'cedida' | null
  /** Cedida sin la factura de Last: el tique va sin la línea de «Factura Simplificada». */
  sinFactura?: boolean | null
  /** El número es de nuestra serie. */
  serie?: boolean | null
  /** Vista previa: el local numera, pero este pedido aún no se ha impreso. */
  pendiente?: boolean | null
  /** V04 · PR 2: el entorno de Verifactu del tique (pruebas o real); null, apagado. */
  verifactu?: 'pruebas' | 'real' | null
  /** V04 · PR 2: la URL del QR de Hacienda. Solo la trae un tique de Verifactu en real. */
  verifactuQr?: string | null
}

export interface LineasFiscales {
  /** «Nombre · NIF X»; null si no hay nada que poner. */
  emisor: string | null
  /** La dirección del socio en una cedida; null en las propias. */
  direccion: string | null
  /** El número de «Factura Simplificada»; null: sin esa línea. */
  numero: string | null
}

const limpio = (s: string | null | undefined) => {
  const t = (s ?? '').trim()
  return t.length ? t : null
}

export function lineasFiscales(fiscal: FiscalTique | null | undefined, order: { external_tab_ref?: string | null; external_ref?: string | null }): LineasFiscales {
  const nombre = limpio(fiscal?.legalName)
  const nif = limpio(fiscal?.taxId)
  const emisor = nombre && nif ? `${nombre} · NIF ${nif}` : nombre ?? (nif ? `NIF ${nif}` : null)
  const direccion = fiscal?.issuerKind === 'cedida' ? limpio(fiscal?.address) : null
  let numero: string | null
  if (fiscal?.sinFactura) numero = null
  else if (fiscal?.pendiente) numero = 'al imprimir'
  else numero = limpio(fiscal?.ticketNumber) ?? limpio(order.external_tab_ref) ?? limpio(order.external_ref) ?? '—'
  return { emisor, direccion, numero }
}

// ── V04 · PR 2 · El QR de Hacienda ─────────────────────────────────────────
// Encargo V04, punto 4, y la especificación del QR de la AEAT (v0.5.0, §6;
// Orden HAC/1177/2024, art. 20 y 21), como el PDF de Sumied
// (src/modules/conta/lib/verifactu/qr.ts):
//   · solo con Verifactu en «real»: en «pruebas» el tique se registra y se
//     envía, pero el papel del cliente NO lleva un QR de pruebas;
//   · de 30 a 40 mm, corrección de errores M, con al menos 2 mm en blanco;
//   · encima «QR tributario:», debajo «VERI*FACTU»;
//   · encima del QR de la tienda (tablero 1).
// La URL la calcula la base con los datos del propio tique (NIF, número, fecha
// e importe): la impresora no espera a Hacienda.

export const QR_HACIENDA_REAL = 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?'
export const QR_HACIENDA_ENCIMA = 'QR tributario:'
export const QR_HACIENDA_DEBAJO = 'VERI*FACTU'
/** 80 mm a 203 ppp: 8 puntos por mm. */
export const PUNTOS_POR_MM = 8
export const QR_HACIENDA_MM = { minimo: 30, maximo: 40, elegido: 32, margen: 2 } as const

export interface QrHacienda {
  url: string
  encima: string
  debajo: string
}

/** El QR de Hacienda del tique, o null si no lleva (apagado, pruebas, cedida o sin URL de real). */
export function qrHacienda(fiscal: FiscalTique | null | undefined): QrHacienda | null {
  const url = limpio(fiscal?.verifactuQr)
  if (fiscal?.verifactu !== 'real' || !url || !url.startsWith(QR_HACIENDA_REAL)) return null
  return { url, encima: QR_HACIENDA_ENCIMA, debajo: QR_HACIENDA_DEBAJO }
}

/**
 * Cuántos puntos de impresora por módulo para que un QR de `modulos` módulos
 * quede entre 30 y 40 mm, lo más cerca posible de 32. Null si no cabe.
 */
export function puntosPorModulo(modulos: number): number | null {
  if (!Number.isInteger(modulos) || modulos < 21) return null
  const min = QR_HACIENDA_MM.minimo * PUNTOS_POR_MM, max = QR_HACIENDA_MM.maximo * PUNTOS_POR_MM
  const objetivo = QR_HACIENDA_MM.elegido * PUNTOS_POR_MM
  let mejor: number | null = null
  for (let p = 1; p <= 16; p++) {
    const lado = p * modulos
    if (lado < min || lado > max) continue
    if (mejor === null || Math.abs(lado - objetivo) < Math.abs(mejor * modulos - objetivo)) mejor = p
  }
  return mejor
}
