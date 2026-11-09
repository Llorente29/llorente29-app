// supabase/functions/conta-bitrix-pestana/puro.ts
//
// GB · La pestaña «Sumied» en la ficha de Bitrix24 · lo que se decide sin
// llamar a nadie (lo prueban las unitarias: tests/unit/conta/gb/pestana.test.ts).
//
//   · De lo que manda Bitrix24 al abrir la pestaña (un formulario con el token
//     del usuario y la ficha) a la dirección de la página, con todo detrás del
//     «#» (no llega a ningún servidor ni a ningún registro).
//   · Qué portales pueden usar la pestaña: HOY SOLO EL DE PRUEBAS (encargo GB:
//     en el Bitrix24 real no se instala nada hasta que QBO y Julio digan sí).
//     Se llama a Bitrix24 solo en esos portales: si se aceptara cualquiera, un
//     servidor ajeno podría contestar «soy tal persona».
//   · Lo que contesta Bitrix24 (app.info y user.current): que el token es de la
//     aplicación de Sumied y de un usuario activo, con su correo.

export const PORTAL_DE_PRUEBAS = 'b24-s3mr2y.bitrix24.es'
/** Los portales donde está la pestaña. Uno nuevo entra aquí solo cuando QBO y Julio digan sí. */
export const PORTALES = new Set<string>([PORTAL_DE_PRUEBAS])

export type TipoFicha = 'empresa' | 'contacto'

/** Los huecos de la ficha del CRM donde va la pestaña. */
export const HUECOS: Record<string, TipoFicha> = {
  CRM_COMPANY_DETAIL_TAB: 'empresa',
  CRM_CONTACT_DETAIL_TAB: 'contacto',
}

export const TITULO_PESTANA = 'Sumied'

/** El nombre del portal, limpio: «B24-S3MR2Y.bitrix24.es» → «b24-s3mr2y.bitrix24.es». Nada que no sea un nombre de máquina. */
export function portalLimpio(x: unknown): string | null {
  if (typeof x !== 'string') return null
  const p = x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(p) ? p : null
}

export const portalPermitido = (p: string | null) => !!p && PORTALES.has(p)

/** Lo que manda Bitrix24 al abrir la pestaña (o al instalar): el formulario y la dirección. */
export interface Llegada {
  auth: string | null
  portal: string | null
  hueco: string | null
  tipo: TipoFicha | null
  id: string | null
}

export function leerLlegada(form: URLSearchParams, query: URLSearchParams): Llegada {
  const auth = form.get('AUTH_ID') ?? form.get('auth[access_token]')
  const portal = portalLimpio(query.get('DOMAIN') ?? form.get('DOMAIN') ?? form.get('auth[domain]'))
  const hueco = form.get('PLACEMENT')
  let id: string | null
  try {
    const o = JSON.parse(form.get('PLACEMENT_OPTIONS') ?? 'null') as { ID?: unknown } | null
    const v = o && (typeof o.ID === 'string' || typeof o.ID === 'number') ? String(o.ID) : null
    id = v && /^[0-9]{1,18}$/.test(v) ? v : null
  } catch { id = null }
  return {
    auth: auth && /^[A-Za-z0-9._-]{8,200}$/.test(auth) ? auth : null,
    portal, hueco, tipo: hueco ? HUECOS[hueco] ?? null : null, id,
  }
}

/** La dirección de la página de la pestaña, con lo de Bitrix24 detrás del «#». */
export function direccionDeLaPagina(pagina: string, l: Llegada, instalar = false): string {
  const h = new URLSearchParams()
  if (instalar) h.set('instalar', '1')
  if (l.auth) h.set('a', l.auth)
  if (l.portal) h.set('p', l.portal)
  if (l.tipo) h.set('t', l.tipo)
  if (l.id) h.set('id', l.id)
  return `${pagina}#${h.toString()}`
}

/** app.info: el token es de la aplicación de Sumied (su client_id, «local.…»). */
export function esNuestraAplicacion(respuesta: unknown, clientId: string): boolean {
  if (!clientId) return false
  const r = (respuesta as { result?: Record<string, unknown> } | null)?.result
  if (!r || typeof r !== 'object') return false
  return r.CODE === clientId || r.client_id === clientId || r.CLIENT_ID === clientId
}

/** user.current: el usuario, activo, con su correo (en minúsculas). */
export function usuarioDeBitrix(respuesta: unknown): { id: string; correo: string; nombre: string } | null {
  const r = (respuesta as { result?: Record<string, unknown> } | null)?.result
  if (!r || typeof r !== 'object') return null
  const activo = r.ACTIVE === true || r.ACTIVE === 'Y' || r.ACTIVE === '1' || r.ACTIVE === undefined
  const correo = typeof r.EMAIL === 'string' ? r.EMAIL.trim().toLowerCase() : ''
  if (!activo || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return null
  const nombre = [r.NAME, r.LAST_NAME].filter((x) => typeof x === 'string' && x.trim()).join(' ')
  return { id: String(r.ID ?? ''), correo, nombre }
}

/** Lo que dice la pestaña en cada caso que no enseña nada. Palabras de oficina, ningún código. */
export const FRASES: Record<string, string> = {
  sin_acceso: 'Pide acceso a Sumied a tu administrador.',
  portal_desconocido: 'Este Bitrix24 no está conectado con ninguna cuenta de Sumied.',
  portal_no_permitido: 'La pestaña de Sumied no está activada en este Bitrix24.',
  no_es_sumied: 'No se ha podido comprobar que eres tú. Cierra la ficha y vuelve a abrirla.',
  ficha_rara: 'Esta pestaña solo funciona en la ficha de una empresa o de un contacto.',
  varias_cuentas: 'Tu correo está en más de una cuenta de Sumied con este Bitrix24. Pide a tu administrador que lo revise.',
  sin_enlazar: 'Esta ficha no está enlazada con ningún cliente de Sumied.',
}

/**
 * GB (nº 5) · Por qué no se ha podido comprobar a quien mira, para el registro de
 * la función. SIN DATOS PERSONALES NI SECRETOS: solo códigos de error de
 * Bitrix24, nombres de campo y formas (si hay código, cuánto mide, si empieza
 * por «local.»). Nunca el token, el correo, el nombre ni el código entero.
 */
export function porqueApp(respuesta: unknown, clientId: string): string | null {
  if (!clientId) return 'falta BITRIX_PESTANA_CLIENT_ID en la función'
  const x = respuesta as { result?: Record<string, unknown>; error?: unknown } | null
  if (!x) return 'app.info: sin respuesta o no es JSON'
  if (x.error) return `app.info: error ${String(x.error).slice(0, 60)}`
  const r = x.result
  if (!r || typeof r !== 'object') return 'app.info: sin «result»'
  if (esNuestraAplicacion(respuesta, clientId)) return null
  const codigo = typeof r.CODE === 'string' ? r.CODE : ''
  return `app.info: el código no coincide (campos: ${Object.keys(r).sort().join(',')}; CODE ${codigo ? `de ${codigo.length} letras, ${codigo.startsWith('local.') ? 'empieza por local.' : 'no empieza por local.'}` : 'vacío'}; el esperado, de ${clientId.length})`
}

export function porqueUsuario(respuesta: unknown): string | null {
  const x = respuesta as { result?: Record<string, unknown>; error?: unknown } | null
  if (!x) return 'user.current: sin respuesta o no es JSON'
  if (x.error) return `user.current: error ${String(x.error).slice(0, 60)}`
  const r = x.result
  if (!r || typeof r !== 'object') return 'user.current: sin «result»'
  if (usuarioDeBitrix(respuesta)) return null
  if (!('EMAIL' in r)) return `user.current: no trae EMAIL (campos: ${Object.keys(r).sort().join(',')})`
  if (!(r.ACTIVE === true || r.ACTIVE === 'Y' || r.ACTIVE === '1' || r.ACTIVE === undefined)) return 'user.current: el usuario no está activo'
  return 'user.current: el EMAIL está vacío o no es un correo'
}
