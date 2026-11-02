// src/modules/conta/pagos/llaveNavegador.ts
//
// B01 Revolut · PR 2c-1 · LA LLAVE Y EL PIN, DEL LADO DEL NAVEGADOR. Sin React:
//   · `pagar(accion, cuerpo)`: llama a conta-pagar, con el origen de la página
//     (la llave va atada a su dirección). Nunca lanza: si falla, su `texto`
//     dice por qué (regla 8).
//   · `crearLlave` / `usarLlave`: navigator.credentials.create / get, con las
//     opciones que da el servidor (en base64url) y la respuesta en base64url,
//     como la comprueba _shared/pagos/llave.ts.
//   · `nombreDelDispositivo`: «este ordenador (Windows)», «este iPhone»…
//   · `motivoPin`: la del servidor, para decirlo antes de mandar.
// La firma la comprueba el servidor: aquí no se decide nada.
// Pruebas: tests/unit/modules/conta/pagos/llaveNavegador.test.ts.

import { supabase } from '@/lib/supabase'

export type SalidaPago<T = Record<string, unknown>> = ({ ok: true; texto?: string } & T) | ({ ok: false; texto: string } & Partial<T>)

/** Llama a conta-pagar. Nunca lanza. */
export async function pagar<T = Record<string, unknown>>(accion: string, cuerpo: Record<string, unknown> = {}): Promise<SalidaPago<T>> {
  if (!supabase) return { ok: false, texto: 'Sin conexión con la base.' } as SalidaPago<T>
  const origen = typeof window === 'undefined' ? '' : window.location.origin
  const { data, error } = await supabase.functions.invoke('conta-pagar', { body: { accion, origen, ...cuerpo } })
  if (!error && data && typeof data === 'object' && 'ok' in data) return data as SalidaPago<T>
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    const c = await ctx.clone().json().catch(() => null) as { texto?: string } | null
    if (c && typeof c.texto === 'string') return { ok: false, texto: c.texto } as SalidaPago<T>
    if (ctx.status === 404) return { ok: false, texto: 'Los pagos con Revolut aún no están publicados en este entorno.' } as SalidaPago<T>
    return { ok: false, texto: `Los pagos han contestado ${ctx.status}. Inténtalo otra vez en un momento.` } as SalidaPago<T>
  }
  return { ok: false, texto: `No se ha podido hablar con los pagos${error ? ` (${error.message})` : ''}.` } as SalidaPago<T>
}

// ── base64url ⇄ bytes ───────────────────────────────────────────────────────

export function b64url(b: ArrayBuffer | Uint8Array): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b)
  let s = ''
  for (const x of u) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function deB64url(s: string): Uint8Array<ArrayBuffer> {
  const t = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ── Las opciones del servidor, para el navegador ────────────────────────────

interface Cred { type: 'public-key'; id: string; transports?: string[] }
export interface OpcionesRegistrar {
  challenge: string; timeout?: number; attestation?: string
  rp: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: { type: 'public-key'; alg: number }[]
  authenticatorSelection?: Record<string, unknown>
  excludeCredentials?: Cred[]
}
export interface OpcionesConfirmar { challenge: string; rpId: string; timeout?: number; userVerification?: string; allowCredentials?: Cred[] }

const credDe = (c: Cred) => ({ type: c.type, id: deB64url(c.id), ...(c.transports ? { transports: c.transports } : {}) })

export function paraCrear(o: OpcionesRegistrar): CredentialCreationOptions {
  return {
    publicKey: {
      challenge: deB64url(o.challenge), timeout: o.timeout, attestation: (o.attestation ?? 'none') as AttestationConveyancePreference,
      rp: o.rp, user: { ...o.user, id: deB64url(o.user.id) }, pubKeyCredParams: o.pubKeyCredParams,
      authenticatorSelection: o.authenticatorSelection as AuthenticatorSelectionCriteria | undefined,
      excludeCredentials: (o.excludeCredentials ?? []).map(credDe) as PublicKeyCredentialDescriptor[],
    },
  }
}

export function paraUsar(o: OpcionesConfirmar): CredentialRequestOptions {
  return {
    publicKey: {
      challenge: deB64url(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: (o.userVerification ?? 'required') as UserVerificationRequirement,
      allowCredentials: (o.allowCredentials ?? []).map(credDe) as PublicKeyCredentialDescriptor[],
    },
  }
}

/** Si este navegador sabe usar llaves de acceso. */
export const hayLlaves = (): boolean => typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials

/** Lo que dice el navegador cuando la persona cancela o no hay llave, en palabras normales. */
export function textoDeFalloLlave(e: unknown): string {
  const n = (e as { name?: string } | null)?.name
  if (n === 'NotAllowedError') return 'No se ha confirmado con la llave (cancelado o se ha pasado el tiempo). Vuelve a pulsar, o usa tu PIN de pago.'
  if (n === 'InvalidStateError') return 'Este dispositivo ya tiene tu llave activada en Sumied.'
  if (n === 'SecurityError') return 'Este navegador no deja usar la llave en esta dirección. Abre Sumied desde su dirección de siempre.'
  if (n === 'NotSupportedError') return 'Este dispositivo no tiene llaves de acceso. Usa tu PIN de pago.'
  return `La llave no ha contestado: ${e instanceof Error ? e.message : String(e)}`
}

/** Activar la llave: navigator.credentials.create, y lo que pide el servidor. */
export async function crearLlave(o: OpcionesRegistrar, credenciales: Pick<CredentialsContainer, 'create'> = navigator.credentials) {
  const c = await credenciales.create(paraCrear(o)) as PublicKeyCredential | null
  if (!c) throw Object.assign(new Error('Sin llave'), { name: 'NotAllowedError' })
  const r = c.response as AuthenticatorAttestationResponse
  const transports = typeof r.getTransports === 'function' ? r.getTransports() : []
  return { id: c.id, attestationObject: b64url(r.attestationObject), clientDataJSON: b64url(r.clientDataJSON), transports }
}

/** Confirmar con la llave: navigator.credentials.get, y la firma para el servidor. */
export async function usarLlave(o: OpcionesConfirmar, credenciales: Pick<CredentialsContainer, 'get'> = navigator.credentials) {
  const c = await credenciales.get(paraUsar(o)) as PublicKeyCredential | null
  if (!c) throw Object.assign(new Error('Sin llave'), { name: 'NotAllowedError' })
  const r = c.response as AuthenticatorAssertionResponse
  return { id: c.id, authenticatorData: b64url(r.authenticatorData), clientDataJSON: b64url(r.clientDataJSON), signature: b64url(r.signature) }
}

/** Cómo se llama este dispositivo en la lista de llaves: sin datos de la persona. */
export function nombreDelDispositivo(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'móvil Android' : 'tableta Android'
  if (/Windows/.test(ua)) return 'ordenador (Windows)'
  if (/Mac OS X|Macintosh/.test(ua)) return 'Mac'
  if (/Linux/.test(ua)) return 'ordenador (Linux)'
  return 'este dispositivo'
}

/** El PIN de pago: las mismas reglas y palabras que el servidor (la misma función). */
export { motivoPin } from '../../../../supabase/functions/_shared/pagos/pin.ts'
