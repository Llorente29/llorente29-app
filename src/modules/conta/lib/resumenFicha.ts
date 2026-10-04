// src/modules/conta/lib/resumenFicha.ts
//
// Las frases cortas de la ficha: la etiqueta de pago de la cabecera
// («Transferencia a 30 días») y el resumen de cada apartado de la lista del
// móvil («General · 10 % y 21 %», «Falta el de administración»…).
//
// Lo que falta se escribe en ámbar y sale de la MISMA completitud que la barra
// del %: la lista del móvil y la barra no pueden contar cosas distintas.

import type { ContactoProveedor, FichaProveedor } from '@/modules/conta/types'
import { PAYMENT_METHOD_LABEL, VAT_REGIME_LABEL } from '@/modules/conta/types'
import { nombreFormaPago, porcentajesIva, type OpcionesFicha } from '@/modules/conta/lib/opcionesFicha'
import { codigoDeApunte } from '@/modules/conta/lib/pgc'
import type { Falta } from '@/modules/conta/lib/completitud'
import { diaMesCorto, eurosExactos, listaPorcentajes } from '@/modules/conta/lib/formato'

/** Las pantallas de la ficha. En ordenador son pestañas; en el móvil, apartados. */
export type Apartado =
  | 'resumen' | 'datos-fiscales' | 'contactos' | 'pago' | 'contabilidad' | 'documentos' | 'historial' | 'facturas' | 'articulos'

export const NOMBRE_APARTADO: Record<Apartado, string> = {
  resumen: 'Resumen',
  'datos-fiscales': 'Datos fiscales',
  contactos: 'Contactos',
  pago: 'Pago',
  contabilidad: 'Contabilidad',
  documentos: 'Documentos',
  historial: 'Historial',
  facturas: 'Facturas',
  articulos: 'Artículos que le compras',
}

/** En el móvil, «Pago» se dice como en la maqueta M4. */
export const NOMBRE_APARTADO_MOVIL: Partial<Record<Apartado, string>> = { pago: 'Cómo le pagas' }

/**
 * Pestañas de edición del ordenador (N4: «Datos fiscales · Contactos · Pago ·
 * Contabilidad · Documentos»). «Historial» va detrás: lo traía la ficha del
 * C01 y no se pierde.
 */
export const PESTANAS: Apartado[] = ['datos-fiscales', 'contactos', 'pago', 'contabilidad', 'documentos', 'historial']
/** Apartados de la lista del móvil, en el orden de la maqueta M4. «Artículos» solo si la cuenta compra con Cocina. */
export const APARTADOS_MOVIL: Apartado[] = ['datos-fiscales', 'contactos', 'pago', 'contabilidad', 'documentos', 'facturas', 'articulos']

/** La pestaña de la completitud (`Falta.destino.pestana`) → el apartado de la URL. */
export function apartadoDe(pestana: Falta['destino']['pestana']): Apartado {
  return pestana === 'fiscal' ? 'datos-fiscales' : pestana
}

export function esApartado(s: string | undefined): s is Apartado {
  return !!s && s in NOMBRE_APARTADO
}

/** «Transferencia a 30 días», «Domiciliación, días 5 y 20», «Efectivo». null si no hay forma. */
export function etiquetaPago(f: FichaProveedor, opciones: OpcionesFicha | null = null): string | null {
  if (!f.paymentMethod) return null
  // El nombre, de las tablas generales (tarea 7 del C00); si no, el de siempre.
  const forma = nombreFormaPago(opciones, f.paymentMethod, PAYMENT_METHOD_LABEL)
  const partes: string[] = []
  if (f.paymentTermsDays !== null) partes.push(f.paymentTermsDays === 0 ? 'al contado' : `a ${f.paymentTermsDays} días`)
  if (f.paymentFixedDays.length > 0) {
    const d = [...f.paymentFixedDays].sort((a, b) => a - b)
    partes.push(`días ${d.length === 1 ? d[0] : `${d.slice(0, -1).join(', ')} y ${d[d.length - 1]}`}`)
  }
  return partes.length === 0 ? forma : `${forma} ${partes.join(', ')}`
}

export interface LineaApartado {
  detalle: string
  /** true = falta algo: se pinta en ámbar. */
  falta: boolean
}

export interface DatosResumen {
  ficha: FichaProveedor
  contactos: ContactoProveedor[]
  faltan: Falta[]
  tipoGasto: { name: string; pgcAccountHint: string } | null
  ultimaFactura: { invoiceDate: string | null; grandTotal: number | null } | null
  numDocumentos: number
  /** Las tablas generales (tarea 7 del C00): de ahí el nombre de la forma de pago. */
  opciones?: OpcionesFicha | null
}

const FALTA_EN: Record<Exclude<Apartado, 'resumen' | 'historial' | 'facturas' | 'articulos'>, Partial<Record<string, string>>> = {
  'datos-fiscales': { nif: 'Falta comprobar el NIF', razon_social: 'Falta la razón social', direccion: 'Falta la dirección fiscal', regimen_iva: 'Falta el régimen de IVA' },
  contactos: { contacto_pedidos: 'Falta el de pedidos', contacto_admin: 'Falta el de administración' },
  pago: { forma_pago: 'Falta la forma y el plazo de pago', iban: 'Falta el IBAN comprobado' },
  contabilidad: { tipo_gasto: 'Falta el tipo de gasto' },
  documentos: { certificado_banco: 'Falta el certificado del banco' },
}

/** El primer «falta» de ese apartado, en el orden de pesos de la completitud. */
function faltaDe(ap: keyof typeof FALTA_EN, faltan: Falta[]): string | null {
  for (const f of faltan) {
    const t = FALTA_EN[ap][f.clave]
    if (t) return t
  }
  return null
}

export function lineaApartado(ap: Apartado, d: DatosResumen): LineaApartado {
  const f = d.ficha
  if (ap === 'datos-fiscales' || ap === 'contactos' || ap === 'pago' || ap === 'contabilidad' || ap === 'documentos') {
    const falta = faltaDe(ap, d.faltan)
    if (falta) return { detalle: falta, falta: true }
  }
  switch (ap) {
    case 'datos-fiscales': {
      const regimen = f.vatRegime ? VAT_REGIME_LABEL[f.vatRegime] : null
      const rates = porcentajesIva(d.opciones ?? null, f.usualTaxRateIds)
      const iva = rates.length > 0 ? listaPorcentajes(rates) : null
      return { detalle: [regimen, iva].filter(Boolean).join(' · ') || 'Completos', falta: false }
    }
    case 'contactos': {
      const n = d.contactos.length
      return { detalle: n === 1 ? '1 contacto' : `${n} contactos`, falta: false }
    }
    case 'pago':
      return { detalle: etiquetaPago(f, d.opciones ?? null) ?? 'Sin forma de pago', falta: false }
    case 'contabilidad':
      return {
        // La cuenta de apunte, con la longitud de la empresa si se sabe (respuesta 3, punto 3).
        detalle: d.tipoGasto ? `${d.tipoGasto.name} · ${d.opciones?.digitos ? codigoDeApunte(d.tipoGasto.pgcAccountHint, d.opciones.digitos) : d.tipoGasto.pgcAccountHint}` : 'Sin tipo de gasto',
        falta: false,
      }
    case 'documentos':
      return { detalle: d.numDocumentos === 1 ? '1 documento' : `${d.numDocumentos} documentos`, falta: false }
    case 'facturas': {
      const u = d.ultimaFactura
      if (!u) return { detalle: 'Aún no hay facturas suyas', falta: false }
      const fecha = u.invoiceDate ? diaMesCorto(u.invoiceDate) : 'sin fecha'
      const importe = u.grandTotal !== null ? eurosExactos(u.grandTotal) : 'sin importe'
      return { detalle: `Última: ${fecha} · ${importe}`, falta: false }
    }
    default:
      return { detalle: '', falta: false }
  }
}
