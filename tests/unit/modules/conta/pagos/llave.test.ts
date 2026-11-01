// B01 Revolut · PR 2b · La segunda aprobación en el servidor: la llave de
// acceso (WebAuthn) y el PIN de pago. Las llaves son de verdad (ES256 y RS256,
// creadas con node:crypto) y la respuesta del navegador se construye byte a
// byte como la da un autenticador: si Sumied acepta lo que no debe, o rechaza
// una firma buena, esto lo dice.
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  FalloLlave, algoritmoDe, b64url, cifrarPin, codigoNuevo, comprobarFirma, comprobarRegistro, derACrudo, motivoPin,
  opcionesDeConfirmar, retoNuevo, salNueva, sha256Hex,
} from '../../../../../supabase/functions/_shared/pagos/llave.ts'

// ── CBOR, lo justo para construir lo que manda un autenticador ──
const cab = (tipo: number, n: number) => (n < 24 ? [(tipo << 5) | n] : n < 256 ? [(tipo << 5) | 24, n] : [(tipo << 5) | 25, n >> 8, n & 255])
type V = number | Uint8Array | string | Map<number | string, V>
function cbor(v: V): number[] {
  if (typeof v === 'number') return v >= 0 ? cab(0, v) : cab(1, -1 - v)
  if (v instanceof Uint8Array) return [...cab(2, v.length), ...v]
  if (typeof v === 'string') { const b = Buffer.from(v); return [...cab(3, b.length), ...b] }
  const out = cab(5, v.size); for (const [k, x] of v) out.push(...cbor(k), ...cbor(x)); return out
}
const de64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'))
const sha = (b: Uint8Array | string) => new Uint8Array(createHash('sha256').update(b).digest())

const RP = 'app.sumied.com', ORIGEN = 'https://app.sumied.com'

function llaveEC() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const j = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
  const cose = new Map<number, V>([[1, 2], [3, -7], [-1, 1], [-2, de64(j.x)], [-3, de64(j.y)]])
  return { privateKey, cose: new Uint8Array(cbor(cose)) }
}
function llaveRSA() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const j = publicKey.export({ format: 'jwk' }) as { n: string; e: string }
  const cose = new Map<number, V>([[1, 3], [3, -257], [-1, de64(j.n)], [-2, de64(j.e)]])
  return { privateKey, cose: new Uint8Array(cbor(cose)) }
}
function authData(o: { rp?: string; flags: number; contador: number; cred?: { id: Uint8Array; cose: Uint8Array } }) {
  const c = Buffer.alloc(4); c.writeUInt32BE(o.contador)
  const partes = [sha(o.rp ?? RP), Uint8Array.of(o.flags), c]
  if (o.cred) { const l = Buffer.alloc(2); l.writeUInt16BE(o.cred.id.length); partes.push(new Uint8Array(16), l, o.cred.id, o.cred.cose) }
  return new Uint8Array(Buffer.concat(partes))
}
const clientData = (tipo: string, reto: string, origen = ORIGEN) => new Uint8Array(Buffer.from(JSON.stringify({ type: tipo, challenge: reto, origin: origen, crossOrigin: false })))

function registro(cose: Uint8Array, reto: string, o: { flags?: number; rp?: string; origen?: string } = {}) {
  const id = new Uint8Array(Buffer.from('llave-de-prueba-0001'))
  const ad = authData({ rp: o.rp, flags: o.flags ?? 0x45, contador: 0, cred: { id, cose } })
  const att = new Map<string, V>([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]])
  return { attestationObject: b64url(new Uint8Array(cbor(att))), clientDataJSON: b64url(clientData('webauthn.create', reto, o.origen)), reto, origen: ORIGEN, rpId: RP }
}
function firma(clave: KeyObject, publicKey: string, reto: string, o: { flags?: number; contador?: number; tipo?: string; origen?: string; rp?: string } = {}) {
  const ad = authData({ rp: o.rp, flags: o.flags ?? 0x05, contador: o.contador ?? 7 })
  const cd = clientData(o.tipo ?? 'webauthn.get', reto, o.origen)
  const s = sign('sha256', Buffer.concat([ad, sha(cd)]), clave)
  return { authenticatorData: b64url(ad), clientDataJSON: b64url(cd), signature: b64url(new Uint8Array(s)), reto, origen: ORIGEN, rpId: RP, publicKey }
}

describe('la llave de acceso', () => {
  it('ES256: se registra y su firma se comprueba, con el contador', async () => {
    const { privateKey, cose } = llaveEC()
    const { reto } = await retoNuevo()
    const r = await comprobarRegistro(registro(cose, reto))
    expect(r.algoritmo).toBe(-7)
    expect(r.credentialId).toBe(b64url(new Uint8Array(Buffer.from('llave-de-prueba-0001'))))
    const reto2 = (await retoNuevo()).reto
    expect(await comprobarFirma(firma(privateKey, r.publicKey, reto2, { contador: 8 }))).toEqual({ signCount: 8 })
  })

  it('RS256 (Windows Hello): también', async () => {
    const { privateKey, cose } = llaveRSA()
    const { reto } = await retoNuevo()
    const r = await comprobarRegistro(registro(cose, reto))
    expect(r.algoritmo).toBe(-257)
    await expect(comprobarFirma(firma(privateKey, r.publicKey, reto))).resolves.toEqual({ signCount: 7 })
  })

  it('rechaza: otro reto, otra dirección, otro origen, sin huella ni cara, otro tipo, otra llave', async () => {
    const { privateKey, cose } = llaveEC()
    const pub = b64url(cose)
    const { reto } = await retoNuevo()
    const otro = (await retoNuevo()).reto
    const casos: [ReturnType<typeof firma>, RegExp][] = [
      [{ ...firma(privateKey, pub, otro), reto }, /no ha firmado este pago/],
      [firma(privateKey, pub, reto, { rp: 'app.folvy.app' }), /otra dirección/],
      [firma(privateKey, pub, reto, { origen: 'https://app.sumied.com.ejemplo.invalid' }), /desde otra dirección/],
      [firma(privateKey, pub, reto, { flags: 0x01 }), /huella, tu cara ni el PIN del dispositivo/],
      [firma(privateKey, pub, reto, { flags: 0x04 }), /no ha confirmado que estabas ahí/],
      [firma(privateKey, pub, reto, { tipo: 'webauthn.create' }), /no es para esto/],
      [firma(llaveEC().privateKey, pub, reto), /La firma de la llave no es buena/],
    ]
    for (const [d, frase] of casos) await expect(comprobarFirma(d)).rejects.toThrow(frase)
  })

  it('una firma tocada no vale: un byte cambiado en lo firmado', async () => {
    const { privateKey, cose } = llaveEC()
    const { reto } = await retoNuevo()
    const d = firma(privateKey, b64url(cose), reto)
    const ad = Buffer.from(d.authenticatorData, 'base64url'); ad[36] ^= 1
    await expect(comprobarFirma({ ...d, authenticatorData: b64url(new Uint8Array(ad)) })).rejects.toBeInstanceOf(FalloLlave)
  })

  it('al registrar: sin huella ni cara, desde otro origen o con otro algoritmo, no', async () => {
    const { cose } = llaveEC()
    const { reto } = await retoNuevo()
    await expect(comprobarRegistro(registro(cose, reto, { flags: 0x41 }))).rejects.toThrow(/huella, tu cara/)
    await expect(comprobarRegistro(registro(cose, reto, { origen: 'https://otra.ejemplo.invalid' }))).rejects.toThrow(/otra dirección/)
    const ed = new Uint8Array(cbor(new Map<number, V>([[1, 1], [3, -8], [-1, 6], [-2, new Uint8Array(32)]])))
    expect(() => algoritmoDe(ed)).toThrow(/no admite/)
  })

  it('la firma ECDSA de DER a crudo, también con el cero de delante', () => {
    const r = [0x00, 0xff, ...new Array(31).fill(1)], s = new Array(32).fill(2)
    const der = Uint8Array.of(0x30, 4 + r.length + s.length, 0x02, r.length, ...r, 0x02, s.length, ...s)
    const c = derACrudo(der)
    expect(c.length).toBe(64); expect(c[0]).toBe(0xff); expect(c[63]).toBe(2)
  })

  it('pide la llave con verificación de la persona, y solo las suyas', () => {
    const o = opcionesDeConfirmar({ reto: 'abc', rpId: RP, llaves: [{ credential_id: 'id1', transports: ['internal'] }] })
    expect(o).toMatchObject({ userVerification: 'required', rpId: RP, allowCredentials: [{ type: 'public-key', id: 'id1', transports: ['internal'] }] })
  })

  it('el reto: 32 bytes al azar, y solo su huella va a la base', async () => {
    const a = await retoNuevo(), b = await retoNuevo()
    expect(a.reto).not.toBe(b.reto)
    expect(Buffer.from(a.reto, 'base64url').length).toBe(32)
    expect(a.huella).toBe(await sha256Hex(a.reto))
    expect(a.huella).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('el PIN de pago', () => {
  it('6 cifras, nunca triviales', () => {
    for (const p of ['123456', '654321', '000000', '999999', '890123', '121212', '123123', '12345', '12345a']) expect(motivoPin(p), p).not.toBeNull()
    for (const p of ['482913', '305118', '771204', '190827']) expect(motivoPin(p), p).toBeNull()
  })

  it('cifrado con la clave del servidor: otra clave u otra sal dan otro; sin clave, no se cifra', async () => {
    const clave = 'k'.repeat(48), sal = salNueva()
    expect(sal).toMatch(/^[0-9a-f]{32}$/)
    const a = await cifrarPin('482913', sal, clave)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await cifrarPin('482913', sal, clave)).toBe(a)
    expect(await cifrarPin('482913', salNueva(), clave)).not.toBe(a)
    expect(await cifrarPin('482913', sal, 'j'.repeat(48))).not.toBe(a)
    expect(await cifrarPin('482914', sal, clave)).not.toBe(a)
    await expect(cifrarPin('482913', sal, '')).rejects.toThrow(/PAGO_PIN_CLAVE/)
  })
})

describe('el código del correo', () => {
  it('6 cifras, también con ceros delante', () => {
    const vistos = new Set<string>()
    for (let i = 0; i < 2000; i++) { const c = codigoNuevo(); expect(c).toMatch(/^\d{6}$/); vistos.add(c) }
    expect(vistos.size).toBeGreaterThan(1990)
  })
})
