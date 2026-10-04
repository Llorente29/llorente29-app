// src/modules/conta/lib/textosFicha.ts
//
// Cómo se dice cada dato de la ficha en los bloques del Resumen. Funciones
// puras, fuera de los componentes (un fichero de componentes que exporta
// funciones rompe react-refresh; regla 31 de CLAUDE.md).

import type { ContactoProveedor, FichaProveedor } from '@/modules/conta/types'

/** «No aplica (sociedad)», «15 %»… null = autónomo sin retención anotada. */
export function textoRetencion(f: FichaProveedor): string | null {
  if (f.irpfWithholdingPct !== null) return `${String(f.irpfWithholdingPct).replace('.', ',')} %`
  if (f.entityKind === 'company') return 'No aplica (sociedad)'
  if (f.entityKind === 'self_employed') return null
  return 'No aplica'
}

/** «C/ Ejemplo 12, 28021 Madrid». */
export function textoDireccion(f: FichaProveedor): string | null {
  const resto = [f.fiscalPostalCode, f.fiscalCity].filter(Boolean).join(' ')
  const t = [f.fiscalStreet, resto].filter((x) => x && x.trim()).join(', ')
  return t || null
}

/** «30 días desde factura», «Al contado», «…, días fijos 5, 20». */
export function textoPlazo(f: FichaProveedor): string | null {
  const partes: string[] = []
  if (f.paymentTermsDays !== null) partes.push(f.paymentTermsDays === 0 ? 'Al contado' : `${f.paymentTermsDays} días desde factura`)
  if (f.paymentFixedDays.length > 0) partes.push(`días fijos ${[...f.paymentFixedDays].sort((a, b) => a - b).join(', ')}`)
  return partes.join(', ') || null
}

/** La acción de un contacto: llamar si hay teléfono; si no, escribir. */
export function accionContacto(c: ContactoProveedor): { href: string; texto: string } | null {
  if (c.phone) return { href: `tel:${c.phone.replace(/[^\d+]/g, '')}`, texto: 'Llamar' }
  if (c.email) return { href: `mailto:${c.email}`, texto: 'Escribir' }
  return null
}

/** El contacto al que llama el botón «Llamar» del móvil: el de pedidos, si no el principal. */
export function contactoParaLlamar(contactos: ContactoProveedor[]): ContactoProveedor | null {
  return contactos.find((c) => c.role === 'orders' && c.phone)
    ?? contactos.find((c) => c.isPrimary && c.phone)
    ?? contactos.find((c) => c.phone)
    ?? null
}

const ESTADO: Record<string, { texto: string; clase: string }> = {
  aprobada: { texto: 'Por pagar', clase: 'cf-estado-porpagar' },
  pagada: { texto: 'Pagada', clase: 'cf-estado-pagada' },
  borrador: { texto: 'Borrador', clase: 'cf-estado-otro' },
  en_revision: { texto: 'En revisión', clase: 'cf-estado-otro' },
  con_discrepancias: { texto: 'Con diferencias', clase: 'cf-estado-otro' },
}

/** «Por pagar» en ámbar, «Pagada» en verde; los demás estados, en gris. */
export function estadoFactura(status: string): { texto: string; clase: string } {
  return ESTADO[status] ?? { texto: status, clase: 'cf-estado-otro' }
}
