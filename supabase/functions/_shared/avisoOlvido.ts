// supabase/functions/_shared/avisoOlvido.ts
//
// L1a · PR 3 · El aviso de olvido por WhatsApp, con respuesta en un toque.
// Lo que comparten clockout-reminder (manda el aviso) y whatsapp-webhook
// (recibe la respuesta de Meta). Todo puro, sin Deno: lo prueban las
// unitarias (tests/unit/laboral/avisoOlvido.test.ts).
//
//   · LA FIRMA DE META (firmaDeMeta): Meta firma el cuerpo TAL CUAL llega
//     (los bytes, no el texto ya leído) con el secreto de la app, en la
//     cabecera X-Hub-Signature-256 («sha256=<hex>»). Sin firma, o con una que
//     no cuadra, el mensaje no es de Meta y se rechaza.
//   · LOS BOTONES: la plantilla lleva tres respuestas rápidas con texto fijo
//     («Salí a esa hora», «Otra hora», «Sigo trabajando»); cada una manda de
//     vuelta su carga (olvido:<id del aviso>:<respuesta>), que es lo que dice
//     qué aviso se contesta. El texto del botón no puede llevar la hora: Meta
//     no deja botones de respuesta con variables; la hora va en el mensaje.
//   · LO QUE LLEGA (leerWebhook): botones, estados de entrega y textos.

export type Respuesta = 'a_su_hora' | 'otra_hora' | 'sigo'
export const RESPUESTAS: readonly Respuesta[] = ['a_su_hora', 'otra_hora', 'sigo']

// ── La firma ────────────────────────────────────────────────────────────────

const aBytes = (x: Uint8Array | string): Uint8Array => (typeof x === 'string' ? new TextEncoder().encode(x) : x)

/** El HMAC-SHA256 en hexadecimal (Web Crypto: Deno y Node 20). */
export async function hmacHex(secreto: string, cuerpo: Uint8Array | string): Promise<string> {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const firma = await crypto.subtle.sign('HMAC', clave, aBytes(cuerpo))
  return [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Comparación en tiempo constante. */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export type Firma = 'valida' | 'sin_firma' | 'firma_mala' | 'sin_secreto'

/**
 * ¿Viene de Meta? `cabecera` es X-Hub-Signature-256. Admite el secreto
 * anterior durante un cambio (`secretoAnterior`, el _PREV del W10a): así se
 * cambia sin cortar el servicio.
 */
export async function firmaDeMeta(cuerpo: Uint8Array | string, cabecera: string | null, secreto: string, secretoAnterior = ''): Promise<Firma> {
  if (!secreto) return 'sin_secreto'
  const m = /^sha256=([0-9a-f]{64})$/i.exec((cabecera ?? '').trim())
  if (!m) return 'sin_firma'
  const recibida = m[1].toLowerCase()
  if (iguales(recibida, await hmacHex(secreto, cuerpo))) return 'valida'
  if (secretoAnterior && iguales(recibida, await hmacHex(secretoAnterior, cuerpo))) return 'valida'
  return 'firma_mala'
}

// ── Los botones ─────────────────────────────────────────────────────────────

/** La carga de un botón: olvido:<id>:<respuesta>. */
export const cargaBoton = (avisoId: string, r: Respuesta): string => `olvido:${avisoId}:${r}`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Lee la carga de un botón. Null si no es de un aviso de olvido. */
export function leerCarga(carga: string | null | undefined): { avisoId: string; respuesta: Respuesta } | null {
  const p = String(carga ?? '').split(':')
  if (p.length !== 3 || p[0] !== 'olvido' || !UUID.test(p[1]) || !(RESPUESTAS as readonly string[]).includes(p[2])) return null
  return { avisoId: p[1].toLowerCase(), respuesta: p[2] as Respuesta }
}

/** El teléfono como lo quiere Meta: solo dígitos, con el 34 delante si son 9. */
export function telefonoMeta(raw: string | null | undefined): string {
  let p = String(raw ?? '').replace(/[^\d+]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (p.startsWith('00')) p = p.slice(2)
  if (!p.startsWith('34') && p.length === 9) p = '34' + p
  return /^\d{8,15}$/.test(p) ? p : ''
}

export interface DatosAviso {
  id: string
  nombre: string
  localNombre: string
  finHora: string | null      // HH:MM del fin del turno
  entradaHora: string | null  // HH:MM de la entrada (sin turno)
  conTurno: boolean
}

export interface Plantillas {
  conTurno: string     // WHATSAPP_PLANTILLA_OLVIDO
  sinTurno: string     // WHATSAPP_PLANTILLA_OLVIDO_SIN_TURNO
}

/**
 * El mensaje de la plantilla nueva. Con turno (tablero 6 de la maqueta):
 *   «Hola {{1}}, tu turno en {{2}} acababa a las {{3}} y no has fichado la
 *    salida. ¿A qué hora saliste?» [Salí a esa hora] [Otra hora] [Sigo trabajando]
 * Sin turno:
 *   «Hola {{1}}, fichaste la entrada en {{2}} a las {{3}} y no has fichado la
 *    salida. ¿A qué hora saliste?» [Otra hora] [Sigo trabajando]
 * Null si falta la plantilla que toca (se manda la de antes).
 */
export function mensajePlantilla(a: DatosAviso, p: Plantillas, idioma: string): Record<string, unknown> | null {
  const conTurno = a.conTurno && !!a.finHora
  const nombre = conTurno ? p.conTurno : p.sinTurno
  if (!nombre) return null
  const hora = (conTurno ? a.finHora : a.entradaHora) ?? ''
  if (!hora) return null
  const botones: Respuesta[] = conTurno ? ['a_su_hora', 'otra_hora', 'sigo'] : ['otra_hora', 'sigo']
  return {
    name: nombre,
    language: { code: idioma },
    components: [
      { type: 'body', parameters: [a.nombre, a.localNombre, hora].map((t) => ({ type: 'text', text: t })) },
      ...botones.map((r, i) => ({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload: cargaBoton(a.id, r) }] })),
    ],
  }
}

// ── Lo que llega ────────────────────────────────────────────────────────────

export type Entrada =
  | { tipo: 'boton'; de: string; wamid: string; contexto: string | null; carga: string; texto: string }
  | { tipo: 'estado'; wamid: string; estado: string; at: string | null; error: string | null }
  | { tipo: 'texto'; de: string; wamid: string }
  | { tipo: 'otro'; de: string | null; wamid: string | null }

/** Las piezas de un aviso de Meta (entry[].changes[].value.messages / statuses). */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function leerWebhook(cuerpo: any): Entrada[] {
  const fuera: Entrada[] = []
  for (const entry of Array.isArray(cuerpo?.entry) ? cuerpo.entry : []) {
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = ch?.value ?? {}
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        const de = String(m?.from ?? '')
        const wamid = String(m?.id ?? '')
        if (m?.type === 'button' && m?.button) {
          fuera.push({ tipo: 'boton', de, wamid, contexto: m?.context?.id ? String(m.context.id) : null, carga: String(m.button.payload ?? ''), texto: String(m.button.text ?? '') })
        } else if (m?.type === 'interactive' && m?.interactive?.button_reply) {
          fuera.push({ tipo: 'boton', de, wamid, contexto: m?.context?.id ? String(m.context.id) : null, carga: String(m.interactive.button_reply.id ?? ''), texto: String(m.interactive.button_reply.title ?? '') })
        } else if (m?.type === 'text') {
          fuera.push({ tipo: 'texto', de, wamid })
        } else {
          fuera.push({ tipo: 'otro', de: de || null, wamid: wamid || null })
        }
      }
      for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
        const ts = Number(s?.timestamp)
        const err = Array.isArray(s?.errors) && s.errors.length ? JSON.stringify({ code: s.errors[0]?.code ?? null, message: s.errors[0]?.title ?? s.errors[0]?.message ?? null }) : null
        fuera.push({ tipo: 'estado', wamid: String(s?.id ?? ''), estado: String(s?.status ?? ''), at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null, error: err })
      }
    }
  }
  return fuera
}

/** Los 4 últimos dígitos: lo único del teléfono que se guarda de lo que llega. */
export const finTelefono = (t: string | null | undefined): string | null => {
  const d = String(t ?? '').replace(/\D/g, '')
  return d ? d.slice(-4) : null
}

/** El texto con el que se contesta. «Otra hora» lleva el enlace al portal. */
export function textoRespuesta(texto: string, enlace: string | null): string {
  return enlace ? `${texto}\n${enlace}` : texto
}

/** El correo de un aviso a la empresa (texto plano y HTML sencillo). */
export function correoAviso(titulo: string, texto: string, enlaceEquipo: string): { asunto: string; html: string; texto: string } {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
  return {
    asunto: titulo,
    texto: `${texto}\n\nEquipo: ${enlaceEquipo}\n\nFolvy`,
    html: `<p style="font:15px/1.5 system-ui,sans-serif;color:#1d1d1b">${esc(texto)}</p>`
      + `<p style="font:15px/1.5 system-ui,sans-serif"><a href="${esc(enlaceEquipo)}" style="color:#16624f">Abrir Equipo</a></p>`
      + `<p style="font:13px/1.5 system-ui,sans-serif;color:#6b6b66">Folvy</p>`,
  }
}
