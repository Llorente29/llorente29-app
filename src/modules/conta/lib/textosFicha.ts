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

/**
 * «Pedírselo por correo» (N4): el borrador del correo al proveedor con lo que
 * le falta a su ficha y él puede dar. Lo de dentro de casa (en qué tipo de
 * gasto se apuntan sus facturas) no se le pide. Va al contacto de
 * administración; si no hay, al principal; si no, a cualquiera con email; y si
 * nadie tiene email, el borrador sale sin destinatario (lo escribe la
 * persona). Folvy no envía nada: abre el borrador.
 */
export function correoPedirDatos(
  f: Pick<FichaProveedor, 'name'>, contactos: ContactoProveedor[], faltan: { clave: string; texto: string }[], firma: string | null,
): { href: string; para: string | null; pide: string[] } | null {
  const QUE: Record<string, string> = {
    nif: 'vuestro NIF',
    razon_social: 'vuestra razón social, tal como sale en las facturas',
    direccion: 'vuestra dirección fiscal completa (calle, código postal, población y provincia)',
    regimen_iva: 'vuestro régimen de IVA',
    forma_pago: 'la forma y el plazo de pago que aplicáis',
    iban: 'el IBAN donde os pagamos',
    certificado_banco: 'un certificado de titularidad de esa cuenta, del banco',
    contacto_admin: 'una persona de administración (nombre, teléfono y email) para facturas y pagos',
    contacto_pedidos: 'una persona de pedidos (nombre y teléfono)',
  }
  const pide = faltan.map((x) => QUE[x.clave]).filter((x): x is string => !!x)
  if (pide.length === 0) return null
  const conEmail = (c: ContactoProveedor) => !!c.email?.trim()
  const para = contactos.find((c) => c.role === 'admin' && conEmail(c))
    ?? contactos.find((c) => c.isPrimary && conEmail(c))
    ?? contactos.find(conEmail)
    ?? null
  const asunto = `Datos para vuestra ficha de proveedor${firma ? ` en ${firma}` : ''}`
  const cuerpo = [
    'Hola:',
    '',
    `Estamos completando la ficha de ${f.name} y nos faltan estos datos:`,
    '',
    ...pide.map((p) => `- ${p}`),
    '',
    '¿Nos los podéis enviar respondiendo a este correo?',
    '',
    'Gracias.',
    ...(firma ? ['', firma] : []),
  ].join('\n')
  const q = `subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`
  return { href: `mailto:${para?.email ? encodeURIComponent(para.email.trim()) : ''}?${q}`, para: para?.email?.trim() ?? null, pide }
}
