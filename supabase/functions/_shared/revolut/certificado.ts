// supabase/functions/_shared/revolut/certificado.ts
//
// B01 Revolut · PR 1 · LA LLAVE DE LA EMPRESA: Sumied crea el par de claves, la
// privada no sale nunca de Sumied (va al Vault, por empresa) y la persona solo
// ve el certificado público, que pega en Revolut › Ajustes › API.
//
// Solo WebCrypto (lo mismo en Deno y en Node, para las pruebas): RSA de 2048
// con SHA-256 (RSASSA-PKCS1-v1_5, RS256), y el certificado X.509 v3
// autofirmado escrito a mano en DER (lo justo: versión, número de serie,
// algoritmo, emisor = sujeto, validez, clave pública). Nada de librerías.
//
//   · `crearLlave(nombre, ahora)` → { privadaPem, certificadoPem, huella }
//   · `firmaDelCliente(privadaPem, { iss, sub, ahora })` → el JWT que pide
//     Revolut para cambiar el código y renovar el token («client assertion»):
//     iss = el dominio de la dirección de vuelta (sin https://), sub = el
//     client_id, aud = https://revolut.com (confirmado: paso 0 y respuesta 1).
//
// Pruebas: tests/unit/modules/conta/revolut/certificado.test.ts (que el
// certificado se lee con node:crypto X509Certificate, que su clave es la de la
// privada y que el JWT se verifica con ella).

const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const

// ── DER, lo mínimo ──────────────────────────────────────────────────────────

function largo(n: number): number[] {
  if (n < 0x80) return [n]
  const b: number[] = []
  while (n > 0) { b.unshift(n & 0xff); n >>= 8 }
  return [0x80 | b.length, ...b]
}
const tlv = (tag: number, cuerpo: Uint8Array) => new Uint8Array([tag, ...largo(cuerpo.length), ...cuerpo])
const junta = (...partes: Uint8Array[]) => { const t = new Uint8Array(partes.reduce((s, p) => s + p.length, 0)); let i = 0; for (const p of partes) { t.set(p, i); i += p.length } return t }
const secuencia = (...p: Uint8Array[]) => tlv(0x30, junta(...p))
const conjunto = (...p: Uint8Array[]) => tlv(0x31, junta(...p))
const entero = (b: Uint8Array) => tlv(0x02, b[0] & 0x80 ? junta(new Uint8Array([0]), b) : b)
const nulo = () => new Uint8Array([0x05, 0x00])
const texto = (s: string) => tlv(0x0c, new TextEncoder().encode(s)) // UTF8String
const bits = (b: Uint8Array) => tlv(0x03, junta(new Uint8Array([0]), b))
const explicito = (n: number, cuerpo: Uint8Array) => tlv(0xa0 + n, cuerpo)

function oid(s: string): Uint8Array {
  const n = s.split('.').map(Number)
  const out = [40 * n[0] + n[1]]
  for (const v of n.slice(2)) {
    const b: number[] = [v & 0x7f]
    let x = v >> 7
    while (x > 0) { b.unshift(0x80 | (x & 0x7f)); x >>= 7 }
    out.push(...b)
  }
  return tlv(0x06, new Uint8Array(out))
}
const SHA256_RSA = '1.2.840.113549.1.1.11'
const CN = '2.5.4.3'
const O = '2.5.4.10'

/** UTCTime (hasta 2049) en DER: AAMMDDHHMMSSZ. */
function hora(d: Date): Uint8Array {
  const p = (n: number) => String(n).padStart(2, '0')
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  return tlv(0x17, new TextEncoder().encode(s))
}

const b64 = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s) }
const b64url = (b: Uint8Array) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const pem = (tipo: string, der: Uint8Array) => `-----BEGIN ${tipo}-----\n${b64(der).match(/.{1,64}/g)!.join('\n')}\n-----END ${tipo}-----\n`
function dePem(p: string): Uint8Array {
  const s = atob(p.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

// ── La llave ────────────────────────────────────────────────────────────────

export interface LlaveRevolut {
  /** La privada, PKCS#8 en PEM. SOLO para el Vault: nunca a la pantalla ni a un registro. */
  privadaPem: string
  /** El certificado público, X.509 en PEM: lo que la persona pega en Revolut. */
  certificadoPem: string
  /** SHA-256 del certificado (hex), para reconocerlo sin enseñarlo entero. */
  huella: string
}

/** Años que vale el certificado (lo que admita Revolut; se cambia creando otro). */
export const ANOS_CERTIFICADO = 5

/** Crea el par de claves y el certificado autofirmado de una empresa. `nombre`: el de la empresa, para el sujeto del certificado. */
export async function crearLlave(nombre: string, ahora: Date = new Date()): Promise<LlaveRevolut> {
  const par = await crypto.subtle.generateKey({ ...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify']) as CryptoKeyPair
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', par.publicKey))
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', par.privateKey))
  const serie = crypto.getRandomValues(new Uint8Array(16)); serie[0] &= 0x7f
  const hasta = new Date(ahora); hasta.setUTCFullYear(hasta.getUTCFullYear() + ANOS_CERTIFICADO)
  const algoritmo = secuencia(oid(SHA256_RSA), nulo())
  const sujeto = secuencia(
    conjunto(secuencia(oid(CN), texto(`Sumied · ${nombre}`.slice(0, 64)))),
    conjunto(secuencia(oid(O), texto('Sumied'))),
  )
  const tbs = secuencia(
    explicito(0, entero(new Uint8Array([2]))), // v3
    entero(serie),
    algoritmo,
    sujeto,
    secuencia(hora(ahora), hora(hasta)),
    sujeto,
    spki,
  )
  const firma = new Uint8Array(await crypto.subtle.sign(ALG, par.privateKey, tbs))
  const cert = secuencia(tbs, algoritmo, bits(firma))
  const huella = [...new Uint8Array(await crypto.subtle.digest('SHA-256', cert))].map((x) => x.toString(16).padStart(2, '0')).join('')
  return { privadaPem: pem('PRIVATE KEY', pkcs8), certificadoPem: pem('CERTIFICATE', cert), huella }
}

/** Minutos que vale la firma del cliente: solo hace falta para una llamada. */
export const MINUTOS_FIRMA = 5

/**
 * La firma del cliente («client assertion») que Revolut pide para cambiar el
 * código por el token y para renovarlo: un JWT RS256 firmado con la privada.
 */
export async function firmaDelCliente(privadaPem: string, d: { iss: string; sub: string; ahora?: Date }): Promise<string> {
  const llave = await crypto.subtle.importKey('pkcs8', dePem(privadaPem), ALG, false, ['sign'])
  const ahora = Math.floor((d.ahora ?? new Date()).getTime() / 1000)
  const te = new TextEncoder()
  const cabecera = b64url(te.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const cuerpo = b64url(te.encode(JSON.stringify({ iss: d.iss, sub: d.sub, aud: 'https://revolut.com', iat: ahora, exp: ahora + MINUTOS_FIRMA * 60 })))
  const firma = new Uint8Array(await crypto.subtle.sign(ALG, llave, te.encode(`${cabecera}.${cuerpo}`)))
  return `${cabecera}.${cuerpo}.${b64url(firma)}`
}

/** El dominio que va en `iss`: el de la dirección de vuelta, sin https:// ni ruta. */
export function dominioDeVuelta(vuelta: string): string {
  const u = new URL(vuelta)
  if (u.protocol !== 'https:') throw new Error('La dirección de vuelta tiene que ser https.')
  return u.host
}
