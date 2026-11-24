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

/**
 * El Bitrix24 de pruebas de antes. R18 (24/11): su prueba gratuita se acabó (Bitrix24 contesta
 * «FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN») y deja de usarse: ya no está en PORTALES. Se queda el
 * nombre para la red y la sección del GBd, que solo actuaban en él (red.ts, seccion.ts): ahí no hacen nada.
 */
export const PORTAL_DE_PRUEBAS = 'b24-s3mr2y.bitrix24.es'
/** R18 · El Bitrix24 de QBO (su dominio propio). */
export const PORTAL_QBO = 'crm.asesoriaqbo.es'
/** Los portales donde está la pestaña. Uno nuevo entra aquí solo cuando QBO y Julio digan sí (R18, 24/11: el de QBO). */
export const PORTALES = new Set<string>([PORTAL_QBO])

/**
 * R18 · Las únicas fichas en las que Sumied puede ESCRIBIR, por portal. En el de QBO, solo la empresa
 * de prueba «EMPRESA PRUEBA SUMIED» (ID 1495, la creó Julio el 24/11): ninguna ficha de un cliente de
 * verdad se toca hasta que Julio diga sí. Ampliarla es cambiar esta lista, en su propio PR.
 */
export const FICHAS_ESCRIBIBLES: Readonly<Record<string, readonly string[]>> = { [PORTAL_QBO]: ['1495'] }

/** Lo que solo lee en Bitrix24: se llama siempre (en un portal permitido). */
const SOLO_LEEN = new Set(['app.info', 'user.current', 'user.get', 'crm.company.get', 'crm.company.fields', 'crm.company.list',
  'crm.contact.get', 'crm.contact.fields', 'crm.contact.list', 'crm.company.userfield.list', 'crm.company.details.configuration.get'])

/**
 * R18 · ¿Puede Sumied hacer esta llamada a Bitrix24? Todo pasa por aquí antes de salir:
 *   · solo en un portal de PORTALES;
 *   · lo que solo lee, siempre;
 *   · enganchar la pestaña (placement.bind) al instalar o reinstalar, que lo pulsa el administrador del portal;
 *   · cualquier otra cosa escribe, y entonces hacen falta las dos llaves: el interruptor «Actualizar Bitrix24»
 *     encendido (lo enciende Julio en Ajustes; apagado de serie) y que la ficha sea una de FICHAS_ESCRIBIBLES.
 *     Una llamada que escribe sin decir en qué ficha, no sale.
 */
export function puedeLlamar(x: { portal: string | null; metodo: string; cuerpo: Record<string, unknown>; actualizar: boolean }):
  { ok: true } | { ok: false; porque: string } {
  if (!portalPermitido(x.portal)) return { ok: false, porque: 'portal no permitido' }
  if (SOLO_LEEN.has(x.metodo)) return { ok: true }
  if (x.metodo === 'placement.bind') return { ok: true }
  if (!x.actualizar) return { ok: false, porque: 'Bitrix24 no se actualiza: lo enciende Julio en Ajustes' }
  const ficha = fichaDeLaLlamada(x.metodo, x.cuerpo)
  if (!ficha) return { ok: false, porque: 'una escritura sin su ficha no sale' }
  if (ficha.tipo !== 'empresa') return { ok: false, porque: 'solo se escribe en fichas de empresa' }
  if (!(FICHAS_ESCRIBIBLES[x.portal as string] ?? []).includes(ficha.id)) return { ok: false, porque: `la ficha ${ficha.id} no es la de prueba: no se toca` }
  return { ok: true }
}

/** La ficha que toca una llamada que escribe: crm.company.update (id) o una nota en el historial (ENTITY_TYPE/ENTITY_ID). */
export function fichaDeLaLlamada(metodo: string, cuerpo: Record<string, unknown>): { tipo: 'empresa' | 'otra'; id: string } | null {
  const f = (cuerpo.fields && typeof cuerpo.fields === 'object' ? cuerpo.fields : {}) as Record<string, unknown>
  const limpio = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && /^[0-9]{1,18}$/.test(v)) ? String(v) : null)
  if (metodo === 'crm.company.update') { const id = limpio(cuerpo.id); return id ? { tipo: 'empresa', id } : null }
  if (metodo === 'crm.timeline.comment.add') {
    const id = limpio(f.ENTITY_ID)
    if (!id) return null
    return { tipo: String(f.ENTITY_TYPE ?? '').toLowerCase() === 'company' ? 'empresa' : 'otra', id }
  }
  return null
}

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
  if (!('EMAIL' in r)) return `user.current: no trae EMAIL: falta el permiso user_basic en la aplicación (campos: ${Object.keys(r).sort().join(',')})`
  if (!(r.ACTIVE === true || r.ACTIVE === 'Y' || r.ACTIVE === '1' || r.ACTIVE === undefined)) return 'user.current: el usuario no está activo'
  return 'user.current: el EMAIL está vacío o no es un correo'
}
