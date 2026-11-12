// supabase/functions/_shared/avisos/leerAviso.ts
//
// G01d · Tarea 2 · Lo que dice un aviso, ya leído, y su clave para tratarlo
// una sola vez. Puro.
//
//   · Del CRM (Bitrix24 es el primer adaptador): un formulario
//     (application/x-www-form-urlencoded) con event, data[FIELDS][ID], ts y
//     auth[domain], auth[member_id], auth[application_token]. No trae un id de
//     aviso propio: su clave es CRM + evento + id de la ficha + ts.
//   · De GoCardless: JSON { events: [{ id, created_at, resource_type, action,
//     links, details }], meta: { webhook_id } }. Cada aviso trae su id (EV…):
//     ésa es su clave.
//
// Lo que se registra de un aviso no lleva datos personales: el CRM solo manda
// el id de la ficha, y de GoCardless se guardan los ids de lo enlazado, nunca
// nombres, correos ni cuentas.

/** Un aviso del CRM, ya neutro (el adaptador de cada CRM lo deja así). */
export interface AvisoCrm {
  clave: string
  crm: string
  tipoFicha: 'empresa' | 'contacto'
  accion: 'alta' | 'cambio' | 'baja'
  idExterno: string
  /** Cuándo lo mandó el CRM (segundos Unix), para quedarse con el último de cada ficha. */
  ts: number
}

export type LecturaDeAviso<T> = { ok: true; avisos: T[]; codigo: string | null } | { ok: false; porque: string }

const EVENTOS_BITRIX: Record<string, { tipoFicha: AvisoCrm['tipoFicha']; accion: AvisoCrm['accion'] }> = {
  ONCRMCOMPANYADD: { tipoFicha: 'empresa', accion: 'alta' },
  ONCRMCOMPANYUPDATE: { tipoFicha: 'empresa', accion: 'cambio' },
  ONCRMCOMPANYDELETE: { tipoFicha: 'empresa', accion: 'baja' },
  ONCRMCONTACTADD: { tipoFicha: 'contacto', accion: 'alta' },
  ONCRMCONTACTUPDATE: { tipoFicha: 'contacto', accion: 'cambio' },
  ONCRMCONTACTDELETE: { tipoFicha: 'contacto', accion: 'baja' },
}

/** Los eventos que hay que marcar en el webhook saliente de Bitrix24 (los pasos para el administrador). */
export const EVENTOS_DE_BITRIX = Object.keys(EVENTOS_BITRIX)

/**
 * Bitrix24: el formulario del webhook saliente. Devuelve el aviso y el código
 * que trae (auth[application_token]), que se comprueba aparte (autenticidad.ts).
 */
export function leerAvisoBitrix(cuerpo: string): LecturaDeAviso<AvisoCrm> {
  const f = new URLSearchParams(cuerpo)
  const evento = (f.get('event') ?? '').trim().toUpperCase()
  const codigo = f.get('auth[application_token]')
  const que = EVENTOS_BITRIX[evento]
  if (!evento) return { ok: false, porque: 'El aviso no dice qué ha pasado.' }
  if (!que) return { ok: false, porque: `Sumied no atiende el aviso «${evento}» (solo empresas y contactos del CRM).` }
  const id = (f.get('data[FIELDS][ID]') ?? '').trim()
  if (!/^\d+$/.test(id)) return { ok: false, porque: 'El aviso no trae el número de la ficha.' }
  const ts = Number(f.get('ts'))
  if (!Number.isFinite(ts) || ts <= 0) return { ok: false, porque: 'El aviso no trae cuándo se mandó.' }
  return { ok: true, codigo, avisos: [{ clave: `bitrix24:${evento}:${id}:${ts}`, crm: 'bitrix24', tipoFicha: que.tipoFicha, accion: que.accion, idExterno: id, ts }] }
}

/** Un aviso de GoCardless. Solo ids y palabras de GoCardless: nada personal. */
export interface AvisoGc {
  clave: string
  id: string
  recurso: string
  accion: string
  creado: string | null
  /** Los ids de lo enlazado (payment, mandate, subscription, customer…). */
  enlaces: Record<string, string>
  /** El motivo, si lo trae (details.cause), para el registro. */
  causa: string | null
}

/** Los recursos que mueven algo de lo que lee Sumied: un cobro, un mandato, una suscripción o un cliente. */
export const RECURSOS_GC = ['payments', 'mandates', 'subscriptions', 'customers'] as const

/**
 * GoCardless: el cuerpo JSON (ya comprobada su firma). Un envío puede traer
 * varios avisos; los de recursos que Sumied no lee se quedan fuera, y lo dice.
 */
export function leerAvisoGoCardless(cuerpo: string): LecturaDeAviso<AvisoGc> & { fuera?: number } {
  let json: unknown
  try { json = JSON.parse(cuerpo) } catch { return { ok: false, porque: 'El aviso no se puede leer (no es JSON).' } }
  const eventos = (json as { events?: unknown })?.events
  if (!Array.isArray(eventos)) return { ok: false, porque: 'El aviso no trae ninguna novedad (events).' }
  const avisos: AvisoGc[] = []
  let fuera = 0
  for (const e of eventos as Record<string, unknown>[]) {
    const id = typeof e?.id === 'string' ? e.id : ''
    const recurso = typeof e?.resource_type === 'string' ? e.resource_type : ''
    if (!id || !(RECURSOS_GC as readonly string[]).includes(recurso)) { fuera++; continue }
    const enlaces: Record<string, string> = {}
    for (const [k, v] of Object.entries((e.links ?? {}) as Record<string, unknown>)) if (typeof v === 'string') enlaces[k] = v
    const det = (e.details ?? {}) as Record<string, unknown>
    avisos.push({ clave: `gocardless:${id}`, id, recurso, accion: typeof e.action === 'string' ? e.action : '',
      creado: typeof e.created_at === 'string' ? e.created_at : null, enlaces, causa: typeof det.cause === 'string' ? det.cause : null })
  }
  return { ok: true, codigo: null, avisos, fuera }
}
