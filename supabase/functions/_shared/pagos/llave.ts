// supabase/functions/_shared/pagos/llave.ts
//
// B01 Revolut · PR 2b · LA SEGUNDA APROBACIÓN: la llave de acceso (WebAuthn) y
// el PIN de pago, comprobados en el SERVIDOR. Sin Deno ni red: solo WebCrypto,
// así que lo prueba Node igual (tests/unit/modules/conta/pagos/llave.test.ts).
//
// Lo que se comprueba de una firma con la llave (W3C WebAuthn, nivel 2):
//   · clientDataJSON: type («webauthn.get» o «webauthn.create»), el reto que
//     dio Sumied (un solo uso, su huella en conta_pago_reto) y el origen exacto
//     de la página (https://app.sumied.com…);
//   · authenticatorData: la huella de la dirección (rpIdHash = sha256(rpId)),
//     que la persona estaba (UP) y que se verificó con huella, cara o PIN del
//     dispositivo (UV: «userVerification: required»);
//   · la firma, sobre authenticatorData ‖ sha256(clientDataJSON), con la clave
//     pública guardada (ES256 o RS256).
// Al registrar, además, la clave pública que trae attestationObject («none»:
// no se pide al fabricante que certifique el dispositivo).
//
// El PIN de pago: 6 cifras, nunca triviales; se cifra con HMAC-SHA256 y una
// clave que solo tiene la función (PAGO_PIN_CLAVE), con la sal de la persona.
// La base guarda el resultado y lo compara; nunca ve el PIN.

const te = new TextEncoder()

export const b64url = (b: Uint8Array) => {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const deB64url = (s: string): Uint8Array => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', b))
export const sha256Hex = async (s: string) => hex(await sha256(te.encode(s)))
const iguales = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

/** Un fallo de la llave o del PIN, con una frase para la pantalla (nada secreto). */
export class FalloLlave extends Error {}

// ── El reto ─────────────────────────────────────────────────────────────────
/** Un reto nuevo (32 bytes al azar) y su huella, que es lo único que se guarda. */
export async function retoNuevo(): Promise<{ reto: string; huella: string }> {
  const reto = b64url(crypto.getRandomValues(new Uint8Array(32)))
  return { reto, huella: await sha256Hex(reto) }
}

// ── Lo que se le pasa al navegador ──────────────────────────────────────────
export const ESPERA_MS = 120_000

/** Opciones para navigator.credentials.get: confirmar con la llave. */
export function opcionesDeConfirmar(d: { reto: string; rpId: string; llaves: { credential_id: string; transports?: string[] }[] }) {
  return {
    challenge: d.reto, rpId: d.rpId, timeout: ESPERA_MS, userVerification: 'required',
    allowCredentials: d.llaves.map((k) => ({ type: 'public-key', id: k.credential_id, ...(k.transports?.length ? { transports: k.transports } : {}) })),
  }
}

/** Opciones para navigator.credentials.create: activar la llave en este dispositivo. */
export function opcionesDeRegistrar(d: { reto: string; rpId: string; rpNombre: string; userId: string; nombre: string; excluir: string[] }) {
  return {
    challenge: d.reto, timeout: ESPERA_MS, attestation: 'none',
    rp: { id: d.rpId, name: d.rpNombre },
    user: { id: b64url(te.encode(d.userId)), name: d.nombre, displayName: d.nombre },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: d.excluir.map((id) => ({ type: 'public-key', id })),
  }
}

// ── CBOR, lo justo para WebAuthn (RFC 8949: enteros, bytes, texto, listas, mapas) ──
type Cbor = number | Uint8Array | string | Cbor[] | Map<number | string, Cbor> | boolean | null
function leerCbor(b: Uint8Array, i = 0): [Cbor, number] {
  const ini = b[i], tipo = ini >> 5, info = ini & 31
  let n = info, p = i + 1
  if (info === 24) { n = b[p]; p += 1 } else if (info === 25) { n = (b[p] << 8) | b[p + 1]; p += 2 }
  else if (info === 26) { n = ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; p += 4 }
  else if (info > 26) throw new FalloLlave('La llave ha mandado algo que Sumied no entiende.')
  switch (tipo) {
    case 0: return [n, p]
    case 1: return [-1 - n, p]
    case 2: return [b.slice(p, p + n), p + n]
    case 3: return [new TextDecoder().decode(b.slice(p, p + n)), p + n]
    case 4: { const out: Cbor[] = []; for (let k = 0; k < n; k++) { const [v, q] = leerCbor(b, p); out.push(v); p = q } return [out, p] }
    case 5: { const out = new Map<number | string, Cbor>(); for (let k = 0; k < n; k++) { const [c, q] = leerCbor(b, p); const [v, r] = leerCbor(b, q); out.set(c as number | string, v); p = r } return [out, p] }
    case 7: return [info === 21 ? true : info === 20 ? false : null, p]
    default: throw new FalloLlave('La llave ha mandado algo que Sumied no entiende.')
  }
}

// ── authenticatorData ───────────────────────────────────────────────────────
interface DatosAutenticador { rpIdHash: Uint8Array; up: boolean; uv: boolean; signCount: number; credencial?: { id: Uint8Array; coseKey: Uint8Array } }
function leerAuthData(a: Uint8Array): DatosAutenticador {
  if (a.length < 37) throw new FalloLlave('La llave ha mandado una respuesta incompleta.')
  const flags = a[32]
  const signCount = ((a[33] << 24) >>> 0) + (a[34] << 16) + (a[35] << 8) + a[36]
  const out: DatosAutenticador = { rpIdHash: a.slice(0, 32), up: (flags & 0x01) !== 0, uv: (flags & 0x04) !== 0, signCount }
  if (flags & 0x40) {
    const largo = (a[53] << 8) | a[54]
    const id = a.slice(55, 55 + largo)
    const [, fin] = leerCbor(a, 55 + largo)
    out.credencial = { id, coseKey: a.slice(55 + largo, fin) }
  }
  return out
}

/** El algoritmo de una clave COSE (-7 ES256, -257 RS256). */
export function algoritmoDe(coseKey: Uint8Array): number {
  const [m] = leerCbor(coseKey)
  const alg = (m as Map<number, Cbor>).get(3)
  if (alg !== -7 && alg !== -257) throw new FalloLlave('Esta llave usa un tipo de firma que Sumied no admite. Prueba con otro dispositivo o usa tu PIN de pago.')
  return alg
}

async function claveDe(coseKey: Uint8Array): Promise<{ clave: CryptoKey; alg: number }> {
  const [m0] = leerCbor(coseKey)
  const m = m0 as Map<number, Cbor>
  const alg = algoritmoDe(coseKey)
  if (alg === -7) {
    const jwk = { kty: 'EC', crv: 'P-256', x: b64url(m.get(-2) as Uint8Array), y: b64url(m.get(-3) as Uint8Array), ext: true }
    return { alg, clave: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']) }
  }
  const jwk = { kty: 'RSA', n: b64url(m.get(-1) as Uint8Array), e: b64url(m.get(-2) as Uint8Array), alg: 'RS256', ext: true }
  return { alg, clave: await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']) }
}

// Una firma ECDSA de WebAuthn viene en DER; WebCrypto la quiere en crudo (r ‖ s, 32 + 32).
export function derACrudo(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new FalloLlave('La firma de la llave no tiene la forma esperada.')
  let p = 2
  const parte = () => {
    if (der[p] !== 0x02) throw new FalloLlave('La firma de la llave no tiene la forma esperada.')
    const n = der[p + 1]; let v = der.slice(p + 2, p + 2 + n); p += 2 + n
    while (v.length > 32 && v[0] === 0) v = v.slice(1)
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out
  }
  const r = parte(), s = parte()
  const crudo = new Uint8Array(64); crudo.set(r); crudo.set(s, 32); return crudo
}

async function comprobarCliente(clientDataJSON: Uint8Array, tipo: string, reto: string, origen: string) {
  let c: { type?: string; challenge?: string; origin?: string }
  try { c = JSON.parse(new TextDecoder().decode(clientDataJSON)) } catch { throw new FalloLlave('La llave ha mandado una respuesta que no se entiende.') }
  if (c.type !== tipo) throw new FalloLlave('La respuesta de la llave no es para esto.')
  if (c.challenge !== reto) throw new FalloLlave('La llave no ha firmado este pago. Vuelve a pulsar el botón.')
  if (c.origin !== origen) throw new FalloLlave('La llave ha firmado desde otra dirección. Abre Sumied desde su dirección de siempre.')
}

async function comprobarAutenticador(a: DatosAutenticador, rpId: string) {
  if (!iguales(a.rpIdHash, await sha256(te.encode(rpId)))) throw new FalloLlave('Esta llave es de otra dirección.')
  if (!a.up) throw new FalloLlave('La llave no ha confirmado que estabas ahí. Vuelve a intentarlo.')
  if (!a.uv) throw new FalloLlave('La llave no ha pedido tu huella, tu cara ni el PIN del dispositivo. Vuelve a intentarlo, o usa tu PIN de pago.')
}

/** Registrar una llave nueva: lo que trae navigator.credentials.create, comprobado. */
export async function comprobarRegistro(d: { attestationObject: string; clientDataJSON: string; reto: string; origen: string; rpId: string }) {
  await comprobarCliente(deB64url(d.clientDataJSON), 'webauthn.create', d.reto, d.origen)
  const [att] = leerCbor(deB64url(d.attestationObject))
  const authData = (att as Map<string, Cbor>).get('authData')
  if (!(authData instanceof Uint8Array)) throw new FalloLlave('La llave no ha mandado sus datos.')
  const a = leerAuthData(authData)
  await comprobarAutenticador(a, d.rpId)
  if (!a.credencial) throw new FalloLlave('La llave no ha mandado su clave pública.')
  const alg = algoritmoDe(a.credencial.coseKey)
  await claveDe(a.credencial.coseKey) // que se pueda leer
  return { credentialId: b64url(a.credencial.id), publicKey: b64url(a.credencial.coseKey), algoritmo: alg, signCount: a.signCount }
}

/** Confirmar con la llave: lo que trae navigator.credentials.get, con la firma comprobada. */
export async function comprobarFirma(d: { authenticatorData: string; clientDataJSON: string; signature: string; reto: string; origen: string; rpId: string; publicKey: string }) {
  const cd = deB64url(d.clientDataJSON)
  await comprobarCliente(cd, 'webauthn.get', d.reto, d.origen)
  const ad = deB64url(d.authenticatorData)
  const a = leerAuthData(ad)
  await comprobarAutenticador(a, d.rpId)
  const { clave, alg } = await claveDe(deB64url(d.publicKey))
  const firmado = new Uint8Array(ad.length + 32); firmado.set(ad); firmado.set(await sha256(cd), ad.length)
  const firma = deB64url(d.signature)
  const ok = alg === -7
    ? await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, clave, derACrudo(firma), firmado)
    : await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, clave, firma, firmado)
  if (!ok) throw new FalloLlave('La firma de la llave no es buena. Vuelve a pulsar el botón, o usa tu PIN de pago.')
  return { signCount: a.signCount }
}

// ── El PIN de pago ──────────────────────────────────────────────────────────
export { motivoPin } from './pin.ts'

/** Una sal nueva para el PIN de una persona (16 bytes, en hexadecimal). */
export const salNueva = () => hex(crypto.getRandomValues(new Uint8Array(16)))

/** El PIN cifrado: HMAC-SHA256 con la clave del servidor, sobre la sal y el PIN. */
export async function cifrarPin(pin: string, sal: string, clave: string): Promise<string> {
  if (!clave || clave.length < 32) throw new Error('Falta la clave del PIN de pago (PAGO_PIN_CLAVE), o es demasiado corta.')
  const k = await crypto.subtle.importKey('raw', te.encode(clave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, te.encode(`${sal}:${pin}`)))
}

// ── El código del correo ────────────────────────────────────────────────────
/** Un código de 6 cifras al azar, sin sesgo (rechaza lo que no cabe en 10⁶). */
export function codigoNuevo(): string {
  const tope = Math.floor(0xffffffff / 1_000_000) * 1_000_000
  for (;;) {
    const [x] = crypto.getRandomValues(new Uint32Array(1))
    if (x < tope) return String(x % 1_000_000).padStart(6, '0')
  }
}
