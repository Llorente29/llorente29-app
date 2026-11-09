// supabase/functions/_shared/portal/portal.ts
//
// GP · Tarea 2b (Code 3, 09/11/2026) · LO PURO DEL PORTAL DEL CLIENTE, sin red
// ni Deno: los correos (el enlace para entrar y el código para firmar), cómo
// se enmascara un destino, el nombre de un fichero subido, y lo que se le pide a
// GoCardless para pagar un devuelto desde el banco, que lo pasen de nuevo o
// cambiar de cuenta, con cómo se lee lo que contesta. Lo prueban
// tests/unit/modules/conta/portal/portal.test.ts.
//
// Lo que dice la documentación de GoCardless (docs.gocardless.com, leída el
// 09/11: billing-requests, billing-request-flows, payments#retry-a-payment):
//   · POST /billing_requests con payment_request (importe en céntimos, EUR,
//     descripción) y/o mandate_request (scheme sepa_core), y links.customer
//     para que sea el cliente que ya existe. Contesta 201 con el BRQ… en
//     «pending».
//   · POST /billing_request_flows con links.billing_request, redirect_uri y
//     exit_uri: contesta authorisation_url, la página de GoCardless donde el
//     cliente paga desde su banco o firma la domiciliación.
//   · GET /billing_requests/{id}: status pending, ready_to_fulfil, fulfilling,
//     fulfilled, cancelled o failed; links.payment_request_payment (el pago) y
//     links.mandate_request_mandate (la domiciliación nueva).
//   · POST /payments/{id}/actions/retry: solo un pago «failed»; contesta 200 con
//     el pago en «pending_submission». Si no se puede, 422 con su motivo.
//   · La cabecera Idempotency-Key hace que la misma clave cree una sola cosa.
//
// En pantalla, palabras de la calle: recibo, devuelto, pagar, cambiar de
// cuenta. Nunca «mandate», «payment», «billing request» ni «SEPA».

import { VERSION_GOCARDLESS } from '../cobro/gocardless.ts'
import { marco, type Correo, type Marca } from '../cobroCorreos.ts'

// ── Los correos ────────────────────────────────────────────────────────────

/** Las plantillas del portal, para el freno de Julio (CORREO_MARCA_ABIERTOS). */
export const PLANTILLA_ENLACE = 'portal_enlace'
export const PLANTILLA_CODIGO = 'portal_codigo'

/** Cuántos enlaces puede pedir un correo en una hora. */
export const ENLACES_POR_HORA = 5

/** Lo que contesta «Entrar» siempre, haya acceso o no: no se dice quién está dentro. */
export const FRASE_ENTRAR = 'Si ese correo tiene acceso, te llega un enlace para entrar en un minuto. Mira también en el correo no deseado.'

export interface DatosEnlace extends Marca {
  cliente: string
  enlace: string
  /** true: es la primera vez (te han invitado); false: lo ha pedido la persona. */
  invitacion: boolean
  invita?: string | null
}

export function correoEnlace(d: DatosEnlace): Correo {
  const asunto = d.invitacion ? `${d.empresa} te invita a tu espacio de cliente` : `Tu enlace para entrar en ${d.empresa}`
  const lineas = d.invitacion
    ? [`Hola:`, '',
       `${d.invita ? `${d.invita}, de ${d.empresa},` : d.empresa} te ha dado acceso al espacio de ${d.cliente}.`,
       'Ahí ves tus facturas y tus recibos, subes papeles, pides altas y hablas con tu gestoría.',
       'Se entra con este botón, sin contraseña. El enlace vale una hora y una sola vez; cuando caduque, pide otro desde la misma página.']
    : [`Hola:`, '', `Aquí tienes tu enlace para entrar en el espacio de ${d.cliente}.`,
       'Vale una hora y una sola vez. Si no lo has pedido tú, no hagas nada: sin el enlace nadie entra.']
  const texto = [...lineas, '', d.enlace].join('\n')
  return { asunto, texto, html: marco(d, lineas, { texto: 'Entrar en mi espacio', url: d.enlace }) + pie() }
}

export interface DatosCodigo extends Marca {
  codigo: string
  titulo: string
  minutos: number
}

export function correoCodigo(d: DatosCodigo): Correo {
  if (!/^\d{6}$/.test(d.codigo)) throw new Error('El código son 6 cifras.')
  const asunto = `${d.codigo} es tu código para firmar`
  const lineas = [`Hola:`, '', `Para firmar «${d.titulo}», escribe este código en tu espacio:`, '', d.codigo, '',
    `Vale ${d.minutos} minutos. Si no estás firmando nada, no hagas nada: sin el código no se firma.`]
  return { asunto, texto: lineas.join('\n'), html: marco(d, lineas, null) + pie() }
}

function pie(): string {
  return '<p style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:12px;color:#4A5B73;margin:24px 0 0">Funciona con Sumied</p>'
}

/** «antonio@talleres.example» → «a•••@talleres.example». Lo que se guarda y se enseña del destino del código. */
export function enmascararCorreo(c: string): string {
  const [u, d] = c.trim().split('@')
  if (!u || !d) return '•••'
  return `${u[0]}•••@${d}`
}

/** El nombre de un fichero para guardarlo: sin carpetas, sin raros, con su extensión y como mucho 80 letras. */
export function nombreSeguro(nombre: string): string {
  const base = (nombre.split(/[\\/]/).pop() ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  const limpio = base.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')
  if (!limpio) return 'documento'
  if (limpio.length <= 80) return limpio
  const punto = limpio.lastIndexOf('.')
  const ext = punto > 0 && limpio.length - punto <= 6 ? limpio.slice(punto) : ''
  return limpio.slice(0, 80 - ext.length) + ext
}

/** Los tipos que se pueden subir (los del almacén conta-portal). */
export const TIPOS_SUBIDA = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const
export const BYTES_SUBIDA = 15 * 1024 * 1024

// ── GoCardless ─────────────────────────────────────────────────────────────

export interface Peticion {
  metodo: 'POST' | 'GET'
  ruta: string
  cabeceras: Record<string, string>
  cuerpo?: unknown
}

const cabeceras = (clave?: string): Record<string, string> =>
  ({ 'GoCardless-Version': VERSION_GOCARDLESS, ...(clave ? { 'Idempotency-Key': clave.slice(0, 128) } : {}) })

const CLIENTE = /^CU[0-9A-Z]+$/
const PAGO = /^PM[0-9A-Z]+$/
const BRQ = /^BRQ[0-9A-Z]+$/

/** Pagar un recibo devuelto, ahora, desde la app del banco. */
export function peticionPagarAhora(p: { clienteGc: string; importeCent: number; descripcion: string; clave: string }): Peticion {
  if (!CLIENTE.test(p.clienteGc)) throw new Error('El cliente no tiene la forma de un cliente de GoCardless.')
  if (!Number.isInteger(p.importeCent) || p.importeCent <= 0) throw new Error('El importe tiene que ser mayor que cero y en céntimos.')
  return {
    metodo: 'POST', ruta: '/billing_requests', cabeceras: cabeceras(p.clave),
    cuerpo: { billing_requests: { payment_request: { amount: p.importeCent, currency: 'EUR', description: p.descripcion.slice(0, 100) }, links: { customer: p.clienteGc } } },
  }
}

/** Cambiar la cuenta de cargo: una domiciliación nueva, del mismo cliente. */
export function peticionCambiarCuenta(p: { clienteGc: string; clave: string }): Peticion {
  if (!CLIENTE.test(p.clienteGc)) throw new Error('El cliente no tiene la forma de un cliente de GoCardless.')
  return {
    metodo: 'POST', ruta: '/billing_requests', cabeceras: cabeceras(p.clave),
    cuerpo: { billing_requests: { mandate_request: { scheme: 'sepa_core' }, links: { customer: p.clienteGc } } },
  }
}

/** La página de GoCardless para completar lo pedido, y adónde vuelve el cliente. */
export function peticionFlujo(p: { brq: string; vuelta: string; salida: string; clave: string }): Peticion {
  if (!BRQ.test(p.brq)) throw new Error('No tiene la forma de una petición de GoCardless.')
  for (const u of [p.vuelta, p.salida]) if (!/^https:\/\//.test(u)) throw new Error('La vuelta tiene que ser una dirección https.')
  return {
    metodo: 'POST', ruta: '/billing_request_flows', cabeceras: cabeceras(p.clave),
    cuerpo: { billing_request_flows: { redirect_uri: p.vuelta, exit_uri: p.salida, links: { billing_request: p.brq } } },
  }
}

/** Que el banco lo pase de nuevo. */
export function peticionReintento(pagoGc: string, clave: string): Peticion {
  if (!PAGO.test(pagoGc)) throw new Error('El cobro no tiene la forma de un cobro de GoCardless.')
  return { metodo: 'POST', ruta: `/payments/${pagoGc}/actions/retry`, cabeceras: cabeceras(clave), cuerpo: { data: {} } }
}

export function peticionLeer(brq: string): Peticion {
  if (!BRQ.test(brq)) throw new Error('No tiene la forma de una petición de GoCardless.')
  return { metodo: 'GET', ruta: `/billing_requests/${brq}`, cabeceras: cabeceras() }
}

/** En qué ha quedado lo pedido, en el estado de conta_portal_operacion. */
export type Estado = 'esperando' | 'hecha' | 'fallida' | 'caducada'

export function leerPeticion(j: unknown): { id: string; estado: Estado; pago: string | null; mandato: string | null } {
  const b = (j as { billing_requests?: Record<string, unknown> })?.billing_requests
  const id = String(b?.id ?? '')
  if (!BRQ.test(id)) throw new Error('GoCardless no ha devuelto la petición.')
  const links = (b?.links ?? {}) as Record<string, unknown>
  const status = String(b?.status ?? '')
  const estado: Estado = status === 'fulfilled' ? 'hecha' : status === 'cancelled' ? 'caducada' : status === 'failed' ? 'fallida' : 'esperando'
  return { id, estado, pago: (links.payment_request_payment as string) ?? null, mandato: (links.mandate_request_mandate as string) ?? null }
}

export function leerFlujo(j: unknown): string {
  const url = String((j as { billing_request_flows?: { authorisation_url?: unknown } })?.billing_request_flows?.authorisation_url ?? '')
  if (!/^https:\/\//.test(url)) throw new Error('GoCardless no ha devuelto la página para completar.')
  return url
}

/** Lo que dice un error de GoCardless, en palabras del cliente. */
export function fraseError(status: number, j: unknown, que: 'pagar' | 'reintentar' | 'cambiar'): string {
  const e = (j as { error?: { message?: string; errors?: { reason?: string; message?: string }[] } })?.error
  const motivo = e?.errors?.[0]?.reason ?? ''
  if (status === 403) return 'Tu gestoría aún no tiene encendido esto en su banco de cobros: escríbele desde Mensajes.'
  if (que === 'reintentar') {
    if (/retry|retried|not_retryable|invalid_state|mandate/i.test(motivo)) return 'Este recibo ya no se puede pasar de nuevo. Págalo desde tu banco o escribe a tu gestoría.'
  }
  if (que === 'pagar' && /scheme|currency|instant|not_supported|unsupported/i.test(motivo + (e?.message ?? ''))) {
    return 'Tu banco no deja pagar al momento desde aquí. Pide que te lo pasen de nuevo o escribe a tu gestoría.'
  }
  if (status >= 500 || status === 0) return 'El banco de cobros no contesta ahora. Prueba en unos minutos.'
  return 'No se ha podido hacer ahora. Prueba en unos minutos o escribe a tu gestoría.'
}
