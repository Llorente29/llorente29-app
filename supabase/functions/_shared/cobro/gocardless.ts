// supabase/functions/_shared/cobro/gocardless.ts
//
// G05 · Tarea 2 (09/11/2026). EL COBRO DE UN RECIBO EN GOCARDLESS, sin red: la
// petición que se manda, cómo se lee lo que contesta y qué estado de oficina
// es cada estado suyo. La llamada la hace la función del servidor (tarea 3),
// SOLO con una conexión del entorno de pruebas (sandbox) mientras Julio no
// encienda otra cosa. Puro.
//
// Lo que dice la documentación de GoCardless (docs.gocardless.com, leída el
// 09/11: api-reference/payment, limits y responses-and-errors):
//   · POST /payments con { payments: { amount (céntimos), currency, links:
//     { mandate } } } y opcionales charge_date, description, reference
//     (SEPA: hasta 140), metadata (3 claves; nombre ≤ 50, valor ≤ 500).
//     Contesta 201 con el cobro en «pending_submission».
//   · Se puede cobrar con mandatos pending_customer_approval,
//     pending_submission, submitted y active; con otro, «mandate_is_inactive».
//   · La cabecera Idempotency-Key (≤ 128) hace que la misma clave solo cree un
//     cobro; si ya lo creó, contesta 409 «idempotent_creation_conflict» con
//     links.conflicting_resource_id. Se respeta «al menos 30 días»: por eso la
//     clave única de verdad es la del recibo en la base.
//   · Un token de solo lectura contesta 403 «insufficient_permissions».
//
// En pantalla, palabras de oficina: recibo, cobro, devuelto. Nunca «payment»,
// «payout», «charge» ni «idempotencia».
//
// Lo prueban tests/unit/modules/conta/gestoria/g05/gocardless.test.ts.

import { euros } from '../tarifa/precio.ts'
import { mesEnPalabras } from './recibo.ts'
import type { Recibo } from './recibo.ts'

/** La versión de la API que ya usa la lectura del G01 (conta-gocardless-leer). */
export const VERSION_GOCARDLESS = '2015-07-06'

/** Los estados del mandato con los que GoCardless deja crear un cobro. */
export const MANDATO_QUE_COBRA = ['pending_customer_approval', 'pending_submission', 'submitted', 'active'] as const

/** Si se puede cobrar con este mandato y, si no, por qué (en palabras). */
export function mandatoParaCobrar(estado: string | null | undefined): { vale: true } | { vale: false; porque: string } {
  if (!estado) return { vale: false, porque: 'Sin mandato SEPA en GoCardless: no se le puede cobrar' }
  if ((MANDATO_QUE_COBRA as readonly string[]).includes(estado)) return { vale: true }
  const palabra: Record<string, string> = { cancelled: 'cancelado', failed: 'fallido', expired: 'caducado', consumed: 'ya usado', blocked: 'bloqueado' }
  return { vale: false, porque: `El mandato SEPA está ${palabra[estado] ?? estado}: no se le puede cobrar` }
}

export interface PeticionDeCobro {
  metodo: 'POST'
  ruta: '/payments'
  cabeceras: { 'Idempotency-Key': string; 'GoCardless-Version': string }
  cuerpo: {
    payments: {
      amount: number
      currency: 'EUR'
      charge_date?: string
      description: string
      metadata: { recibo: string }
      links: { mandate: string }
    }
  }
}

/**
 * Lo que se manda a GoCardless para cobrar un recibo. El importe es el TOTAL DE
 * SU FACTURA (factura.ts · facturaDelRecibo), para que el cobro y la factura
 * digan lo mismo al céntimo. Lanza si algo no cuadra: mejor no mandar que mandar mal.
 */
export function peticionDeCobro(r: Recibo, importeCent: number, mandatoId: string, cargoEl: string | null, concepto: string): PeticionDeCobro {
  if (r.parado.length) throw new Error(`El recibo no se puede enviar: ${r.parado.join('; ')}.`)
  if (!Number.isInteger(importeCent) || importeCent <= 0) throw new Error('El importe del cobro tiene que ser mayor que cero y en céntimos.')
  if (Math.abs(importeCent - r.totalCent) > 3) throw new Error('El importe del cobro no es el del recibo: no se envía.')
  if (!/^MD[0-9A-Z]+$/.test(mandatoId)) throw new Error('El mandato no tiene la forma de un mandato de GoCardless.')
  if (cargoEl !== null && !/^\d{4}-\d{2}-\d{2}$/.test(cargoEl)) throw new Error('La fecha de cargo tiene que ser AAAA-MM-DD.')
  if (r.clave.length > 128) throw new Error('La clave del recibo pasa de 128 caracteres.')
  const description = `${concepto} · ${mesEnPalabras(r.mes)}`.slice(0, 100)
  return {
    metodo: 'POST', ruta: '/payments',
    cabeceras: { 'Idempotency-Key': r.clave, 'GoCardless-Version': VERSION_GOCARDLESS },
    cuerpo: { payments: { amount: importeCent, currency: 'EUR', ...(cargoEl ? { charge_date: cargoEl } : {}), description, metadata: { recibo: r.clave.slice(0, 500) }, links: { mandate: mandatoId } } },
  }
}

/** Lo que significa la respuesta de GoCardless al crear el cobro. */
export type RespuestaDeCobro =
  | { tipo: 'creado'; cobroId: string; estado: string; cargoEl: string | null }
  | { tipo: 'ya_estaba'; cobroId: string }
  | { tipo: 'solo_lectura'; frase: string }
  | { tipo: 'sin_mandato'; frase: string }
  | { tipo: 'rechazado'; frase: string }
  | { tipo: 'reintentar'; frase: string }

interface ErrorDeGc { type?: string; message?: string; errors?: { reason?: string; field?: string; message?: string; links?: { conflicting_resource_id?: string } }[] }

export function leerRespuestaDeCobro(status: number, cuerpo: unknown): RespuestaDeCobro {
  const c = (cuerpo ?? {}) as { payments?: { id?: string; status?: string; charge_date?: string | null }; error?: ErrorDeGc }
  if (status === 201 && c.payments?.id) {
    return { tipo: 'creado', cobroId: c.payments.id, estado: c.payments.status ?? 'pending_submission', cargoEl: c.payments.charge_date ?? null }
  }
  const e = c.error ?? {}
  const razones = (e.errors ?? []).map((x) => x.reason).filter(Boolean)
  if (status === 409 && razones.includes('idempotent_creation_conflict')) {
    const id = (e.errors ?? []).map((x) => x.links?.conflicting_resource_id).find(Boolean)
    if (id) return { tipo: 'ya_estaba', cobroId: id }
  }
  if (status === 403 && razones.some((r) => r === 'insufficient_permissions' || r === 'insufficient_permissions_continue_on_dashboard')) {
    return { tipo: 'solo_lectura', frase: 'La conexión de GoCardless es de solo lectura: con ella no se puede cobrar.' }
  }
  if (razones.includes('mandate_is_inactive')) {
    return { tipo: 'sin_mandato', frase: 'El mandato SEPA ya no está activo en GoCardless: no se ha cobrado.' }
  }
  if (status === 429 || status >= 500 || e.type === 'gocardless') {
    return { tipo: 'reintentar', frase: 'GoCardless no ha contestado bien. Se vuelve a intentar con la misma clave: no se cobra dos veces.' }
  }
  const detalle = (e.errors ?? []).map((x) => [x.field, x.message].filter(Boolean).join(': ')).filter(Boolean).join('; ') || e.message || `respuesta ${status}`
  return { tipo: 'rechazado', frase: `GoCardless no ha aceptado el cobro: ${detalle}.` }
}

/**
 * El estado de un recibo, en palabras de oficina, con su color (la maqueta
 * Cobro.dc.html, 09/11): Preparado · Enviado · En el banco · Cobrado ·
 * Devuelto (sin fondos) · Retrocedido (lo reclamó el cliente) · Cancelado ·
 * Facturado.
 */
export type EstadoDelRecibo = 'preparado' | 'enviado' | 'en_el_banco' | 'cobrado' | 'devuelto' | 'retrocedido' | 'cancelado' | 'facturado'

export const ESTADO_EN_PALABRAS: Record<EstadoDelRecibo, { texto: string; tono: 'neutro' | 'aviso' | 'bien' | 'mal' }> = {
  preparado: { texto: 'Preparado', tono: 'neutro' },
  enviado: { texto: 'Enviado', tono: 'aviso' },
  en_el_banco: { texto: 'En el banco', tono: 'aviso' },
  cobrado: { texto: 'Cobrado', tono: 'bien' },
  devuelto: { texto: 'Devuelto', tono: 'mal' },
  retrocedido: { texto: 'Retrocedido', tono: 'mal' },
  cancelado: { texto: 'Cancelado', tono: 'neutro' },
  facturado: { texto: 'Facturado', tono: 'bien' },
}

/** El estado del recibo según el estado del cobro en GoCardless (sin cobro: preparado). */
export function estadoDelRecibo(estadoGc: string | null | undefined, facturado: boolean): EstadoDelRecibo {
  if (!estadoGc) return 'preparado'
  if (estadoGc === 'charged_back') return 'retrocedido'
  if (['failed', 'customer_approval_denied'].includes(estadoGc)) return 'devuelto'
  if (estadoGc === 'cancelled') return 'cancelado'
  if (['confirmed', 'paid_out'].includes(estadoGc)) return facturado ? 'facturado' : 'cobrado'
  if (estadoGc === 'submitted') return 'en_el_banco'
  return 'enviado'
}

/** Si toca hacer la factura: solo con el cobro confirmado (no hay factura sin cobro) y si aún no la tiene. */
export const tocaFacturar = (estadoGc: string | null | undefined, facturado: boolean) => !facturado && ['confirmed', 'paid_out'].includes(estadoGc ?? '')

/**
 * Si el cambio de estado deshace un cobro ya contabilizado: un retrocedido
 * (o un fallo que llega después de confirmarse) con su asiento de cobro hecho.
 * Entonces va el asiento de la devolución (asientos.ts · asientoDeLaDevolucion).
 */
export const tocaDeshacerElCobro = (estadoGc: string | null | undefined, cobroContabilizado: boolean) =>
  cobroContabilizado && ['charged_back', 'failed'].includes(estadoGc ?? '')

/** Lo que dice el historial del recibo cuando cambia su cobro. */
export function fraseDelCambio(r: { totalCent: number; mes: string }, estado: EstadoDelRecibo, conFactura = false): string {
  const cuanto = `${euros(r.totalCent)} de ${mesEnPalabras(r.mes)}`
  switch (estado) {
    case 'enviado': return `Cobro de ${cuanto} enviado a GoCardless.`
    case 'en_el_banco': return `Cobro de ${cuanto} en el banco del cliente.`
    case 'cobrado': return `Cobro de ${cuanto} confirmado.`
    case 'facturado': return `Cobro de ${cuanto} confirmado y facturado.`
    case 'devuelto': return conFactura ? `Recibo de ${cuanto} devuelto después de cobrarse: se deshace el cobro y pasa a «Te deben»; la factura se queda.`
      : `Recibo de ${cuanto} devuelto sin fondos: pasa a «Te deben» y no tiene factura.`
    // Retrocedido: el cliente lo reclamó a su banco después de cobrarse. La factura ya existe y se queda; lo que se deshace es el cobro.
    case 'retrocedido': return `Recibo de ${cuanto} retrocedido: el cliente lo reclamó a su banco. Se deshace el cobro y pasa a «Te deben»${conFactura ? '; la factura se queda' : ''}.`
    case 'cancelado': return `Cobro de ${cuanto} cancelado en GoCardless: no se ha cobrado.`
    default: return `Recibo de ${cuanto} preparado.`
  }
}

// ── G05 · nº 55 · Cambiar de cuenta desde el portal ──────────────────────────────

/** Un mandato de los guardados (conta_gc_mandato): su id, su cliente de GoCardless y su estado. */
export interface MandatoGuardado { gcId: string; gcCliente: string | null; estado: string | null }

/**
 * Los mandatos que se cancelan cuando el cliente cambia de cuenta: los vivos
 * (los que cobrarían) de su cliente de GoCardless de antes y del de ahora,
 * menos el nuevo. Puro.
 */
export function mandatosACancelar(guardados: readonly MandatoGuardado[], clienteAntes: string | null, clienteNuevo: string, nuevo: string): string[] {
  const clientes = new Set([clienteAntes, clienteNuevo].filter((x): x is string => !!x))
  return guardados
    .filter((m) => m.gcId !== nuevo && m.gcCliente !== null && clientes.has(m.gcCliente) && (MANDATO_QUE_COBRA as readonly string[]).includes(m.estado ?? ''))
    .map((m) => m.gcId)
    .sort()
}

/** El mandato nuevo, leído de GoCardless (GET /mandates/:id): si ya cobra y de qué cliente es. */
export function leerMandatoNuevo(respuesta: unknown): { vale: true; cliente: string } | { vale: false; porque: string } {
  const m = (respuesta as { mandates?: { status?: unknown; links?: { customer?: unknown } } } | null)?.mandates
  const estado = typeof m?.status === 'string' ? m.status : null
  const cliente = typeof m?.links?.customer === 'string' ? m.links.customer : null
  if (!estado || !cliente) return { vale: false, porque: 'GoCardless no ha devuelto ese mandato.' }
  if (estado !== 'active') return { vale: false, porque: `La domiciliación nueva aún no está activa en GoCardless (${estado}): la vieja no se cancela todavía.` }
  return { vale: true, cliente }
}

/** La respuesta de cancelar un mandato: cancelado ahora, o ya lo estaba (no es un fallo). */
export function leerCancelacion(status: number, respuesta: unknown): { cancelado: true } | { cancelado: false; porque: string } {
  if (status >= 200 && status < 300) return { cancelado: true }
  const e = (respuesta as { error?: { errors?: { reason?: string }[]; message?: string } } | null)?.error
  const motivos = (e?.errors ?? []).map((x) => x.reason ?? '')
  if (motivos.includes('mandate_already_cancelled')) return { cancelado: true }
  return { cancelado: false, porque: e?.message ?? `HTTP ${status}` }
}

/** nº 70 · Una suscripción de GoCardless, como se leyó (conta_gc_suscripcion). */
export interface SuscripcionGuardada { importeCent: number; intervalo: string; cada: number; estado: string; proximoCobro: string | null; inicio: string | null }

const mesesDesde = (de: string, a: string) => (Number(a.slice(0, 4)) - Number(de.slice(0, 4))) * 12 + Number(a.slice(5, 7)) - Number(de.slice(5, 7))

/**
 * nº 70 · Lo que GoCardless le cobra a un cliente EN un mes, para compararlo con
 * el recibo de ese mes. Una mensual entra todos los meses; una anual (o cada
 * varios meses), solo en el mes en que la cobra, que sale de su próximo cobro (o
 * de su inicio). No se reparte entre doce: la de 300 € al año no son 25 € en
 * diciembre, son 300 € en su mes. Las semanales no se comparan con un mes.
 * Null si no tiene ninguna activa.
 */
export function gocardlessEnElMes(suscripciones: readonly SuscripcionGuardada[], mes: string): number | null {
  const activas = suscripciones.filter((s) => s.estado === 'active')
  if (!activas.length) return null
  let total = 0
  for (const s of activas) {
    const cada = Math.max(1, s.cada || 1)
    const meses = s.intervalo === 'monthly' ? cada : s.intervalo === 'yearly' ? 12 * cada : null
    if (meses === null) continue
    if (meses === 1) { total += s.importeCent; continue }
    const ref = s.proximoCobro ?? s.inicio
    if (!ref) continue
    const d = mesesDesde(ref.slice(0, 7), mes)
    if (((d % meses) + meses) % meses === 0) total += s.importeCent
  }
  return total
}
