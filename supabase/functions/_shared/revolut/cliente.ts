// supabase/functions/_shared/revolut/cliente.ts
//
// B01 Revolut · PR 1 · EL CLIENTE DE LA API DE REVOLUT BUSINESS. Sin Deno: la
// red entra por `fetch` (el de verdad en la función, uno simulado en las
// pruebas), y las claves llegan de quien llama (del Vault): aquí no se guarda
// nada ni se escribe ningún secreto en un registro.
//
// Entornos (W10: staging solo habla con el sandbox). El entorno lo decide la
// variable REVOLUT_ENTORNO de las funciones: «produccion» solo en el proyecto
// de producción; sin ella, o con cualquier otra cosa, el sandbox.
//
// De la especificación oficial (revolut-openapi, business.json, 30/10/2026):
// las direcciones de la API, GET /accounts, /accounts/{id}/bank-details,
// /transactions (from, to, account, count ≤ 1000) y los cuatro permisos.
// De las guías (aún sin confirmar, tras su control antibots): la página de
// autorizar (`/app-confirm`) y el token (`POST /auth/token` con la firma del
// cliente). Se confirman con la primera llamada al sandbox y van al parte.

import { dominioDeVuelta, firmaDelCliente } from './certificado.ts'
import type { ClienteLecturaRevolut, CuentaRevolut, DatosBancoRevolut, TransaccionRevolut } from './lectura.ts'

export type EntornoRevolut = 'sandbox' | 'produccion'

const DIRECCIONES: Record<EntornoRevolut, { api: string; web: string }> = {
  sandbox: { api: 'https://sandbox-b2b.revolut.com/api/1.0', web: 'https://sandbox-business.revolut.com' },
  produccion: { api: 'https://b2b.revolut.com/api/1.0', web: 'https://business.revolut.com' },
}

/** El entorno, de la variable de las funciones. Solo «produccion» escrito así es producción. */
export const entornoDe = (v: string | null | undefined): EntornoRevolut => ((v ?? '').trim().toLowerCase() === 'produccion' ? 'produccion' : 'sandbox')

export const direcciones = (e: EntornoRevolut) => DIRECCIONES[e]

/**
 * Los permisos que se piden al conectar (Julio, respuesta 5, 01/11): READ para
 * leer y WRITE para registrar el aviso de Revolut, que es lo que hace que lo
 * terminado entre al momento. WRITE también deja crear beneficiarios y
 * borradores de pago, pero NO pagar: PAY se pide aparte, solo con «Activar
 * pagos» (PR 2). En la página de Revolut van separados por comas (por
 * confirmar en el sandbox, como el resto de lo que vive en sus guías).
 */
export const PERMISOS_AL_CONECTAR = ['READ', 'WRITE'] as const
export const PERMISOS_AL_CONECTAR_TEXTO = PERMISOS_AL_CONECTAR.join(',')
/** ¿Estos permisos dejan registrar el aviso de Revolut? (pide WRITE). */
export const dejanAvisar = (permisos: string | null | undefined) => (permisos ?? '').split(/[,\s]+/).includes('WRITE')

/** La página de Revolut donde la persona pulsa «Activar acceso». */
export function paginaDeAutorizar(e: EntornoRevolut, d: { clientId: string; vuelta: string; permisos: string; estado: string }): string {
  const u = new URL('/app-confirm', DIRECCIONES[e].web)
  u.searchParams.set('client_id', d.clientId)
  u.searchParams.set('redirect_uri', d.vuelta)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', d.permisos)
  u.searchParams.set('state', d.estado)
  return u.toString()
}

export interface Tokens { acceso: string; renovacion: string | null; caducaAcceso: string }

/** Un fallo de Revolut, con lo que dijo y sin nada secreto. */
export class FalloRevolut extends Error {
  constructor(readonly status: number, readonly codigo: string | null, mensaje: string) { super(mensaje) }
  /** El permiso ya no vale: se retiró en Revolut o caducó. */
  get permisoRetirado() { return this.status === 401 || this.codigo === 'invalid_grant' || this.codigo === 'unauthorized_client' }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

async function leerFallo(r: Response): Promise<FalloRevolut> {
  let codigo: string | null = null, texto = ''
  try {
    const b = await r.json() as Record<string, unknown>
    codigo = typeof b.error === 'string' ? b.error : typeof b.code === 'string' ? b.code : b.code != null ? String(b.code) : null
    texto = String(b.error_description ?? b.message ?? '')
  } catch { /* sin cuerpo */ }
  const que = r.status === 429 ? 'Revolut pide esperar un poco (demasiadas peticiones).'
    : r.status === 401 ? 'Revolut no acepta el permiso: se ha retirado o ha caducado.'
    : r.status === 403 ? 'Revolut no deja hacer esto con el permiso que tiene Sumied.'
    : `Revolut ha contestado ${r.status}.`
  return new FalloRevolut(r.status, codigo, texto ? `${que} Dice: «${texto.slice(0, 200)}».` : que)
}

/** Cambiar el código de la vuelta (o el de renovación) por el token. */
export async function pedirToken(f: Fetch, e: EntornoRevolut, d: {
  privadaPem: string; clientId: string; vuelta: string; ahora?: Date
} & ({ codigo: string } | { renovacion: string })): Promise<Tokens> {
  const firma = await firmaDelCliente(d.privadaPem, { iss: dominioDeVuelta(d.vuelta), sub: d.clientId, ahora: d.ahora })
  const cuerpo = new URLSearchParams({
    client_id: d.clientId,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: firma,
    ...('codigo' in d ? { grant_type: 'authorization_code', code: d.codigo } : { grant_type: 'refresh_token', refresh_token: d.renovacion }),
  })
  const r = await f(`${DIRECCIONES[e].api}/auth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: cuerpo.toString() })
  if (!r.ok) throw await leerFallo(r)
  const b = await r.json() as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!b.access_token) throw new FalloRevolut(r.status, null, 'Revolut no ha dado el token.')
  const ahora = d.ahora ?? new Date()
  return { acceso: b.access_token, renovacion: b.refresh_token ?? null, caducaAcceso: new Date(ahora.getTime() + (b.expires_in ?? 2400) * 1000).toISOString() }
}

/** Lo que puede leer Sumied con un token de acceso. */
export function clienteRevolut(f: Fetch, e: EntornoRevolut, acceso: string): ClienteLecturaRevolut {
  const get = async <T>(ruta: string): Promise<T> => {
    for (let intento = 0; ; intento++) {
      const r = await f(`${DIRECCIONES[e].api}${ruta}`, { headers: { Authorization: `Bearer ${acceso}`, Accept: 'application/json' } })
      if (r.ok) return await r.json() as T
      // 429: se espera lo que diga Revolut (o 2 s) y se reintenta, como mucho tres veces.
      if (r.status === 429 && intento < 3) {
        const espera = Math.min(Number(r.headers.get('Retry-After') ?? '2') || 2, 10)
        await new Promise((ok) => setTimeout(ok, espera * 1000))
        continue
      }
      throw await leerFallo(r)
    }
  }
  return {
    cuentas: () => get<CuentaRevolut[]>('/accounts'),
    datosBanco: (cuenta) => get<DatosBancoRevolut[]>(`/accounts/${encodeURIComponent(cuenta)}/bank-details`),
    async transacciones(cuenta, desde, hasta) {
      // De 1.000 en 1.000, moviendo `to` hacia atrás hasta la más vieja de la página.
      const out: TransaccionRevolut[] = []
      const vistas = new Set<string>()
      let to = hasta
      for (let pagina = 0; pagina < 200; pagina++) {
        const q = new URLSearchParams({ account: cuenta, from: desde, to, count: '1000' })
        const lote = await get<TransaccionRevolut[]>(`/transactions?${q}`)
        for (const t of lote) if (!vistas.has(t.id)) { vistas.add(t.id); out.push(t) }
        if (lote.length < 1000) return out
        const masVieja = lote.reduce((m, t) => (t.created_at < m ? t.created_at : m), lote[0].created_at)
        if (masVieja >= to) return out
        to = masVieja
      }
      throw new Error('Demasiadas páginas de movimientos de Revolut: se para para no leer sin fin.')
    },
  }
}

/** Los eventos del aviso que pide Sumied (WebhookEventType, especificación oficial). */
export const EVENTOS_AVISO = ['TransactionCreated', 'TransactionStateChanged'] as const

/**
 * Registra el aviso de Revolut (POST /webhooks, v2) hacia `url`. Pide el
 * permiso WRITE: con solo READ, Revolut lo rechaza y la lectura de cada hora
 * hace de aviso. Devuelve su id y el secreto con que firma (al Vault, nunca a
 * un registro).
 */
export async function registrarAviso(f: Fetch, e: EntornoRevolut, acceso: string, url: string): Promise<{ id: string; secreto: string | null }> {
  const r = await f(`${DIRECCIONES[e].api.replace('/1.0', '/2.0')}/webhooks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${acceso}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ url, events: EVENTOS_AVISO }),
  })
  if (!r.ok) throw await leerFallo(r)
  const b = await r.json() as { id?: string; signing_secret?: string }
  if (!b.id) throw new FalloRevolut(r.status, null, 'Revolut no ha dado el id del aviso.')
  return { id: b.id, secreto: b.signing_secret ?? null }
}

/** Quita el aviso de Revolut (DELETE /webhooks/{id}). Si ya no estaba, da igual. */
export async function quitarAviso(f: Fetch, e: EntornoRevolut, acceso: string, id: string): Promise<void> {
  const r = await f(`${DIRECCIONES[e].api.replace('/1.0', '/2.0')}/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${acceso}` } })
  if (!r.ok && r.status !== 404) throw await leerFallo(r)
}
