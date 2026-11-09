// supabase/functions/_shared/portal/avisos.ts
//
// GP · Tarea 4 (Code 3, 09/11/2026) · LOS CINCO AVISOS POR CORREO DEL PORTAL,
// sin red ni Deno: lo que dice cada uno. Los manda conta-portal-avisos con lo
// que devuelve conta_portal_avisos_pendientes (la 2030). Lo prueban
// tests/unit/modules/conta/portal/avisos.test.ts.
//
//   · factura        «Tienes una factura nueva»: número, fecha e importe.
//   · recibo_proximo «Tu recibo de <mes>»: el desglose, cuánto y cuándo se carga,
//                    por qué cambia, y «No estoy de acuerdo».
//   · devuelto       «Tu recibo de <mes> no se ha podido cobrar»: cuánto, y pagar.
//   · mensaje        «<gestoría> te ha escrito»: el principio del último.
//   · peticion       «<gestoría> te pide…»: qué, y para cuándo.
//
// Todos llevan la marca de la gestoría y un botón al portal (a su pestaña). Ni
// un dato que no sea de la persona que lo recibe. Palabras de la calle: nunca
// «mandato», «payment» ni «SEPA».

import { marco, type Correo, type Marca } from '../cobroCorreos.ts'

/** La plantilla de los avisos, para el freno de Julio (CORREO_MARCA_ABIERTOS). */
export const PLANTILLA_AVISO = 'portal_aviso'

export const TIPOS_AVISO = ['factura', 'recibo_proximo', 'devuelto', 'mensaje', 'peticion'] as const
export type TipoAviso = typeof TIPOS_AVISO[number]

/** Una fila de conta_portal_avisos_pendientes. */
export interface Pendiente {
  tipo: TipoAviso
  clave: string
  acceso_id: string
  account_id: string
  party_id: string
  para: string
  nombre: string | null
  permiso: 'todo' | 'facturas_documentos'
  datos: Record<string, unknown>
}

export interface DatosAviso extends Marca {
  cliente: string
  /** La dirección del portal, sin la barra final: https://app.sumied.com */
  portal: string
  hoy?: Date
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** 18150 → «181,50 €». */
export function euros(cent: unknown): string {
  const n = typeof cent === 'number' ? cent : Number(cent)
  if (!Number.isFinite(n)) return ''
  const abs = Math.abs(Math.round(n))
  const entero = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 ? '-' : ''}${entero},${String(abs % 100).padStart(2, '0')} €`
}

/** 181.5 (euros, como customer_invoice.total) → «181,50 €». */
export const eurosDe = (e: unknown): string => euros(Math.round(Number(e) * 100))

/** «2026-11» → «noviembre» (o «noviembre de 2025» si no es de este año). */
export function nombreMes(m: unknown, hoy: Date = new Date()): string {
  const x = /^(\d{4})-(\d{2})$/.exec(String(m ?? ''))
  if (!x) return String(m ?? '')
  const n = MESES[Number(x[2]) - 1] ?? x[2]
  return Number(x[1]) === hoy.getUTCFullYear() ? n : `${n} de ${x[1]}`
}

/** «2026-11-05» → «5 de noviembre». */
export function fechaLarga(f: unknown): string {
  const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f ?? ''))
  if (!x) return ''
  return `${Number(x[3])} de ${MESES[Number(x[2]) - 1]}`
}

/** El desglose del recibo: «Contabilidad · 120,00 €». */
export function lineasRecibo(lineas: unknown): string[] {
  if (!Array.isArray(lineas)) return []
  return lineas.map((l) => {
    const x = (l ?? {}) as { texto?: unknown; importeCent?: unknown; importe_cent?: unknown }
    const cent = x.importeCent ?? x.importe_cent
    return `${String(x.texto ?? 'Servicio')} · ${typeof cent === 'number' ? euros(cent) : 'sin precio'}`
  })
}

function porQueCambia(cambios: unknown): string | null {
  if (!Array.isArray(cambios) || !cambios.length) return null
  const t = cambios.map((c) => String((c as { texto?: unknown })?.texto ?? '')).filter(Boolean)
  return t.length ? t.join(' · ') : null
}

const saludo = (nombre: string | null): string => {
  const pila = nombre && !nombre.includes('@') ? nombre.trim().split(/\s+/)[0] : ''
  return pila ? `Hola, ${pila}:` : 'Hola:'
}

function pie(): string {
  return '<p style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:12px;color:#4A5B73;margin:24px 0 0">Funciona con Sumied</p>'
}

const PESTANA: Record<TipoAviso, string> = { factura: 'facturas', recibo_proximo: 'inicio', devuelto: 'inicio', mensaje: 'mensajes', peticion: 'inicio' }

/** El botón de cada aviso: a la pestaña del portal donde se ve. */
export function enlaceAviso(portal: string, tipo: TipoAviso): string {
  return `${portal.replace(/\/+$/, '')}/portal.html#${PESTANA[tipo]}`
}

/** El correo de un aviso. Lanza si el tipo no es uno de los cinco. */
export function correoAviso(p: Pendiente, d: DatosAviso): Correo {
  const x = p.datos ?? {}
  const url = enlaceAviso(d.portal, p.tipo)
  let asunto: string
  let lineas: string[]
  let boton: string
  switch (p.tipo) {
    case 'factura': {
      const num = String(x.numero ?? '')
      asunto = `Tienes una factura nueva de ${d.empresa}${num ? ` (${num})` : ''}`
      lineas = [saludo(p.nombre), '', `${d.empresa} ha emitido una factura a ${d.cliente}:`, '',
        `Factura ${num}${x.fecha ? ` · ${fechaLarga(x.fecha)}` : ''}${x.total != null ? ` · ${eurosDe(x.total)}` : ''}`, '',
        'La tienes en tu espacio, para verla o descargarla.']
      boton = 'Ver mis facturas'
      break
    }
    case 'recibo_proximo': {
      const m = nombreMes(x.mes, d.hoy)
      const total = Number(x.total_cent ?? 0)
      const anterior = x.anterior_cent == null ? null : Number(x.anterior_cent)
      const cambia = anterior != null && anterior !== total
        ? [`El mes pasado fueron ${euros(anterior)}: ${total > anterior ? 'sube' : 'baja'} ${euros(Math.abs(total - anterior))}.`
            + (porQueCambia(x.cambios) ? ` Por qué cambia: ${porQueCambia(x.cambios)}.` : '')]
        : []
      asunto = `Tu recibo de ${m}: ${euros(total)}`
      lineas = [saludo(p.nombre), '', `Este es el recibo de ${m} de ${d.cliente}${x.cargo_el ? `, que se carga en tu cuenta el ${fechaLarga(x.cargo_el)}` : ''}:`, '',
        ...lineasRecibo(x.lineas), `Total · ${euros(total)}`, '', ...cambia, ...(cambia.length ? [''] : []),
        'No tienes que hacer nada. Si algo no te cuadra, entra y pulsa «No estoy de acuerdo»: tu gestoría lo mira antes de cobrarlo.']
      boton = 'Ver mi recibo'
      break
    }
    case 'devuelto': {
      const m = nombreMes(x.mes, d.hoy)
      asunto = `Tu recibo de ${m} no se ha podido cobrar`
      lineas = [saludo(p.nombre), '', `El banco ha devuelto el recibo de ${m} de ${d.cliente}, de ${euros(x.importe_cent)}.`,
        'Puedes pagarlo ahora desde tu espacio, en un minuto. Si ya lo has hablado con tu gestoría, no hagas nada.']
      boton = 'Pagar el recibo'
      break
    }
    case 'mensaje': {
      const n = Number(x.cuantos ?? 1)
      const autor = String(x.autor ?? '') || d.empresa
      const texto = String(x.texto ?? '').replace(/\s+/g, ' ').trim()
      asunto = n > 1 ? `${d.empresa} te ha escrito ${n} mensajes` : `${d.empresa} te ha escrito`
      lineas = [saludo(p.nombre), '', `${autor}${autor === d.empresa ? '' : `, de ${d.empresa},`} te ha escrito${n > 1 ? ` (${n} mensajes)` : ''}:`, '',
        `«${texto.length > 240 ? texto.slice(0, 239) + '…' : texto}»`, '', 'Contesta desde tu espacio: así queda todo en el mismo sitio.']
      boton = 'Leer y contestar'
      break
    }
    case 'peticion': {
      const tipo = String(x.tipo ?? '')
      const que = tipo === 'firmar' ? 'que firmes' : tipo === 'subir' ? 'que subas' : 'que contestes'
      const titulo = String(x.titulo ?? '')
      asunto = `${d.empresa} te pide ${que}: ${titulo}`
      lineas = [saludo(p.nombre), '', `${d.empresa} te pide ${que} «${titulo}».`,
        ...(x.detalle ? [String(x.detalle)] : []), ...(x.fecha_limite ? [`Para el ${fechaLarga(x.fecha_limite)}.`] : []), '',
        tipo === 'firmar' ? 'Se firma desde tu espacio con un código que te llega por correo.' : 'Se hace desde tu espacio, en Inicio.']
      boton = tipo === 'firmar' ? 'Firmar' : tipo === 'subir' ? 'Subirlo' : 'Contestar'
      break
    }
    default:
      throw new Error(`Aviso desconocido: ${String((p as { tipo?: unknown }).tipo)}`)
  }
  return { asunto, texto: [...lineas, '', url].join('\n'), html: marco(d, lineas, { texto: boton, url }) + pie() }
}

/** Los ids que hay que marcar como avisados después de mandar (mensajes y peticiones). */
export function avisados(p: Pendiente): { mensajes: string[]; peticiones: string[] } {
  if (p.tipo === 'mensaje') return { mensajes: Array.isArray(p.datos?.ids) ? (p.datos.ids as unknown[]).map(String) : [], peticiones: [] }
  if (p.tipo === 'peticion' && p.datos?.id) return { mensajes: [], peticiones: [String(p.datos.id)] }
  return { mensajes: [], peticiones: [] }
}
