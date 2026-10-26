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
