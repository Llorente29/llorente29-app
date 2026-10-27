// supabase/functions/_shared/redsysSumied.ts
//
// S01 · PR 1 · EL COBRO CON TARJETA Y BIZUM DE SUMIED, por REDSYS (el TPV
// virtual del banco). El segundo proveedor del enlace de pago, al lado de
// Stripe: el enlace, la página (pagar.html) y el aviso de cobrado son los
// mismos; solo cambia a dónde se manda al cliente a pagar.
//
// Lo comparten conta-pago (prepara el pago) y conta-redsys-aviso (el aviso del
// banco). Todo es puro salvo `hmac` (Web Crypto, que tienen Deno y Node 20):
// lo prueban las unitarias (tests/unit/modules/conta/s01/redsysSumied.test.ts),
// que comparan el 3DES de aquí con el de Node y la firma con la de los datos
// de prueba que publica Redsys.
//
//   · La firma «HMAC_SHA256_V1» de Redsys: la clave del comercio (24 bytes en
//     base64) cifra el número de pedido con 3DES-CBC (vector cero, relleno con
//     ceros); con eso se firma, con HMAC SHA-256, el texto en base64 de los
//     parámetros. Web Crypto no tiene 3DES: va aquí, con sus tablas.
//   · El aviso del banco llega con la firma en base64 «de URL» (- y _): se
//     compara en tiempo constante después de normalizarla.
//   · Solo modo de prueba (sis-t) salvo las empresas que Julio pase a real
//     (REDSYS_COBRO_REAL, ids separados por comas), como STRIPE_COBRO_REAL.

/** La página de pago de Redsys: la de pruebas y la real. */
export const REDSYS_PRUEBAS = 'https://sis-t.redsys.es:25443/sis/realizarPago'
export const REDSYS_REAL = 'https://sis.redsys.es/sis/realizarPago'

/** Los datos de comercio de PRUEBA que publica Redsys (su guía de integración). No cobran nada. */
export const COMERCIO_PRUEBA = { comercio: '999008881', terminal: '1', clave: 'sq7HjrUOBfKmC576ILgskD5srU870gJ7' } as const

// ── base64 y bytes ──────────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function aBase64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=')
  }
  return s
}

/** De base64 (normal o «de URL», con o sin relleno) a bytes. Null si no es base64. */
export function deBase64(t: string): Uint8Array | null {
  const s = t.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (!/^[A-Za-z0-9+/]*$/.test(s) || s.length % 4 === 1) return null
  const out: number[] = []
  for (let i = 0; i < s.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64.indexOf(s[i + k]) : 0))
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3]
    out.push((n >> 16) & 255)
    if (i + 2 < s.length) out.push((n >> 8) & 255)
    if (i + 3 < s.length) out.push(n & 255)
  }
  return new Uint8Array(out)
}

const utf8 = (t: string) => new TextEncoder().encode(t)
const deUtf8 = (b: Uint8Array) => new TextDecoder().decode(b)

/** ¿Es una clave de comercio de Redsys? 24 bytes en base64 (32 caracteres). */
export const claveValida = (clave: string): boolean => /^[A-Za-z0-9+/]{32}$/.test(clave.trim()) && deBase64(clave)?.length === 24

// ── 3DES (DES-EDE3-CBC), con las tablas de la norma (FIPS 46-3) ────────────

const PC1 = [57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4]
const PC2 = [14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32]
const GIROS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
const IP = [58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7]
const FP = [40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25]
const E = [32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17,
  16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1]
const P = [16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25]
const S = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
]

/** Los bits de un bloque, en un array de 0 y 1 (bit 1 = el más alto del primer byte, como la norma). */
const aBits = (b: Uint8Array): number[] => Array.from({ length: b.length * 8 }, (_, i) => (b[i >> 3] >> (7 - (i & 7))) & 1)
const deBits = (bits: number[]): Uint8Array => {
  const out = new Uint8Array(bits.length / 8)
  bits.forEach((v, i) => { out[i >> 3] |= v << (7 - (i & 7)) })
  return out
}
const permutar = (bits: number[], tabla: number[]) => tabla.map((p) => bits[p - 1])

/** Las 16 subclaves de 48 bits de una clave DES de 8 bytes. */
function subclaves(clave: Uint8Array): number[][] {
  const k = permutar(aBits(clave), PC1)
  let c = k.slice(0, 28), d = k.slice(28)
  return GIROS.map((g) => {
    c = [...c.slice(g), ...c.slice(0, g)]; d = [...d.slice(g), ...d.slice(0, g)]
    return permutar([...c, ...d], PC2)
  })
}

/** Un bloque DES de 8 bytes, cifrando o descifrando. */
function bloqueDes(bloque: Uint8Array, ks: number[][], descifrar: boolean): Uint8Array {
  const b = permutar(aBits(bloque), IP)
  let l = b.slice(0, 32), r = b.slice(32)
  for (let i = 0; i < 16; i++) {
    const k = ks[descifrar ? 15 - i : i]
    const x = permutar(r, E).map((v, j) => v ^ k[j])
    const f: number[] = []
    for (let s = 0; s < 8; s++) {
      const t = x.slice(s * 6, s * 6 + 6)
      const v = S[s][((t[0] << 1) | t[5]) * 16 + ((t[1] << 3) | (t[2] << 2) | (t[3] << 1) | t[4])]
      f.push((v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1)
    }
    const nr = permutar(f, P).map((v, j) => v ^ l[j])
    l = r; r = nr
  }
  return deBits(permutar([...r, ...l], FP))
}

/**
 * 3DES-CBC (EDE, clave de 24 bytes) con vector cero y relleno con ceros hasta
 * múltiplo de 8: lo que pide Redsys para sacar la clave de cada pedido.
 */
export function tresDesCbc(clave: Uint8Array, datos: Uint8Array): Uint8Array {
  if (clave.length !== 24) throw new Error('La clave de 3DES tiene 24 bytes.')
  const [k1, k2, k3] = [0, 8, 16].map((i) => subclaves(clave.slice(i, i + 8)))
  const largo = Math.max(8, Math.ceil(datos.length / 8) * 8)
  const entrada = new Uint8Array(largo); entrada.set(datos)
  const salida = new Uint8Array(largo)
  let previo = new Uint8Array(8)
  for (let i = 0; i < largo; i += 8) {
    const x = entrada.slice(i, i + 8).map((v, j) => v ^ previo[j])
    const c = bloqueDes(bloqueDes(bloqueDes(x, k1, false), k2, true), k3, false)
    salida.set(c, i); previo = c
  }
  return salida
}

// ── La firma ────────────────────────────────────────────────────────────────

async function hmac(clave: Uint8Array, texto: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', clave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, utf8(texto)))
}

/** Los parámetros del comercio, en el base64 que viaja (Ds_MerchantParameters). */
export const parametrosEnBase64 = (p: Record<string, string>): string => aBase64(utf8(JSON.stringify(p)))

/** Los parámetros que manda el banco en un aviso, leídos. Null si no se pueden leer. */
export function leerParametros(b64: string): Record<string, string> | null {
  const b = deBase64(b64)
  if (!b) return null
  try {
    const o = JSON.parse(deUtf8(b)) as Record<string, unknown>
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null || v === undefined ? '' : decodeURIComponent(String(v))]))
  } catch { return null }
}

/** La firma de Redsys (base64) de unos parámetros en base64, para un pedido, con la clave del comercio. */
export async function firmar(claveComercio: string, pedido: string, parametrosB64: string): Promise<string> {
  const clave = deBase64(claveComercio)
  if (!clave || clave.length !== 24) throw new Error('La clave del comercio no es válida.')
  const derivada = tresDesCbc(clave, utf8(pedido))
  return aBase64(await hmac(derivada, parametrosB64))
}

/** Comparación en tiempo constante de dos firmas en base64, normalizando el base64 «de URL». */
function igualesB64(a: string, b: string): boolean {
  const x = a.trim().replace(/-/g, '+').replace(/_/g, '/'), y = b.trim().replace(/-/g, '+').replace(/_/g, '/')
  if (x.length !== y.length) return false
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return d === 0
}

/**
 * ¿Es del banco este aviso? Se firma con el pedido que dicen los propios
 * parámetros (Ds_Order) y se compara con Ds_Signature. Sin versión buena,
 * sin pedido o con la firma mal, no.
 */
export async function avisoValido(claveComercio: string, aviso: { version: string | null; parametros: string | null; firma: string | null }): Promise<boolean> {
  if (aviso.version !== 'HMAC_SHA256_V1' || !aviso.parametros || !aviso.firma) return false
  const p = leerParametros(aviso.parametros)
  const pedido = p?.Ds_Order ?? p?.DS_ORDER
  if (!pedido) return false
  try { return igualesB64(await firmar(claveComercio, pedido, aviso.parametros), aviso.firma) } catch { return false }
}

// ── El pago ─────────────────────────────────────────────────────────────────

/** Céntimos, como los pide Redsys (sin coma). */
export const importeRedsys = (euros: number): string => String(Math.round(Number(euros) * 100))

/** ¿Autorizado? Redsys responde 0000 a 0099 cuando el pago está hecho. */
export const autorizado = (respuesta: string | null | undefined): boolean => /^\d{1,4}$/.test(String(respuesta ?? '').trim()) && Number(respuesta) <= 99

/**
 * Con qué se pagó. Redsys dice el método en Ds_ProcessedPayMethod; Bizum es el
 * 68 (guía de Bizum de Redsys). Lo demás es tarjeta. Se comprueba con el
 * primer cobro de prueba en sis-t (el parte lo dice si no coincide).
 */
export const metodoRedsys = (p: Record<string, string>): 'tarjeta' | 'bizum' =>
  String(p.Ds_ProcessedPayMethod ?? p.DS_PROCESSEDPAYMETHOD ?? '').trim() === '68' ? 'bizum' : 'tarjeta'

export interface PagoRedsys {
  comercio: string; terminal: string; pedido: string; euros: number; descripcion: string; titular: string
  aviso: string; vuelta: string; otraVez: string; bizum: boolean
}

/**
 * Los parámetros del pago (pago normal, euros). Con Bizum en el TPV, Redsys
 * enseña todo lo que el banco tiene encendido (tarjeta y Bizum); sin él, solo
 * tarjeta.
 */
export function parametrosPago(d: PagoRedsys): Record<string, string> {
  return {
    DS_MERCHANT_AMOUNT: importeRedsys(d.euros),
    DS_MERCHANT_ORDER: d.pedido,
    DS_MERCHANT_MERCHANTCODE: d.comercio,
    DS_MERCHANT_CURRENCY: '978',
    DS_MERCHANT_TRANSACTIONTYPE: '0',
    DS_MERCHANT_TERMINAL: d.terminal,
    DS_MERCHANT_MERCHANTURL: d.aviso,
    DS_MERCHANT_URLOK: d.vuelta,
    DS_MERCHANT_URLKO: d.otraVez,
    DS_MERCHANT_PRODUCTDESCRIPTION: d.descripcion.slice(0, 125),
    DS_MERCHANT_MERCHANTNAME: d.titular.slice(0, 25),
    DS_MERCHANT_CONSUMERLANGUAGE: '001',
    ...(d.bizum ? {} : { DS_MERCHANT_PAYMETHODS: 'C' }),
  }
}

/** El formulario que la página manda a Redsys: su dirección y los tres campos firmados. */
export async function formularioPago(claveComercio: string, d: PagoRedsys, real: boolean) {
  const parametros = parametrosEnBase64(parametrosPago(d))
  return {
    url: real ? REDSYS_REAL : REDSYS_PRUEBAS,
    campos: { Ds_SignatureVersion: 'HMAC_SHA256_V1', Ds_MerchantParameters: parametros, Ds_Signature: await firmar(claveComercio, d.pedido, parametros) },
  }
}

/** ¿Esta empresa cobra de verdad con Redsys? Solo si Julio la ha pasado a real (REDSYS_COBRO_REAL). */
export const empresaEnReal = (lista: string | undefined | null, empresa: string): boolean =>
  String(lista ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).includes(empresa.toLowerCase())
