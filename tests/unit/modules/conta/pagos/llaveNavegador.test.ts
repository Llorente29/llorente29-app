// B01 Revolut · PR 2c-1 · La llave y el PIN del lado del navegador
// (src/modules/conta/pagos/llaveNavegador.ts). Sin navegador: un
// navigator.credentials simulado que contesta como uno de verdad.
import { describe, expect, it } from 'vitest'
import { b64url, crearLlave, deB64url, motivoPin, nombreDelDispositivo, paraCrear, paraUsar, textoDeFalloLlave, usarLlave } from '@/modules/conta/pagos/llaveNavegador'
import { motivoPin as motivoPinServidor } from '../../../../../supabase/functions/_shared/pagos/llave.ts'

const bytes = (...x: number[]) => new Uint8Array(x)

describe('base64url', () => {
  it('ida y vuelta, sin «=» ni «+» ni «/»', () => {
    const b = bytes(251, 255, 191, 0, 1, 2, 62, 63)
    const s = b64url(b)
    expect(s).not.toMatch(/[=+/]/)
    expect([...deB64url(s)]).toEqual([...b])
    expect(b64url(new TextEncoder().encode('hola'))).toBe('aG9sYQ')
    expect(new TextDecoder().decode(deB64url('aG9sYQ'))).toBe('hola')
  })
})

describe('las opciones del servidor, para el navegador', () => {
  const reg = { challenge: b64url(bytes(1, 2, 3)), rp: { id: 'app.sumied.com', name: 'Sumied' }, user: { id: b64url(new TextEncoder().encode('u-1')), name: 'Ana Prueba', displayName: 'Ana Prueba' },
    pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }], excludeCredentials: [{ type: 'public-key' as const, id: b64url(bytes(9, 9)) }], attestation: 'none' }
  it('crear: el reto, el usuario y las excluidas pasan a bytes', () => {
    const o = paraCrear(reg).publicKey!
    expect([...(o.challenge as Uint8Array)]).toEqual([1, 2, 3])
    expect(new TextDecoder().decode(o.user.id as Uint8Array)).toBe('u-1')
    expect([...((o.excludeCredentials![0].id) as Uint8Array)]).toEqual([9, 9])
    expect(o.rp).toEqual({ id: 'app.sumied.com', name: 'Sumied' })
  })
  it('usar: el reto y las permitidas pasan a bytes; la persona, verificada', () => {
    const o = paraUsar({ challenge: b64url(bytes(4, 5)), rpId: 'app.sumied.com', allowCredentials: [{ type: 'public-key', id: b64url(bytes(7)), transports: ['internal'] }] }).publicKey!
    expect([...(o.challenge as Uint8Array)]).toEqual([4, 5])
    expect(o.userVerification).toBe('required')
    expect(o.allowCredentials![0].transports).toEqual(['internal'])
  })
})

describe('crearLlave y usarLlave', () => {
  const buf = (...x: number[]) => bytes(...x).buffer
  it('crear devuelve lo que comprueba el servidor, en base64url', async () => {
    const credenciales = { create: async () => ({ id: 'llave-1', response: { attestationObject: buf(1), clientDataJSON: buf(2), getTransports: () => ['internal'] } }) }
    const r = await crearLlave({ challenge: 'AQ', rp: { id: 'x', name: 'x' }, user: { id: 'AQ', name: 'a', displayName: 'a' }, pubKeyCredParams: [] }, credenciales as never)
    expect(r).toEqual({ id: 'llave-1', attestationObject: 'AQ', clientDataJSON: 'Ag', transports: ['internal'] })
  })
  it('usar devuelve la firma, en base64url', async () => {
    const credenciales = { get: async () => ({ id: 'llave-1', response: { authenticatorData: buf(3), clientDataJSON: buf(4), signature: buf(5) } }) }
    expect(await usarLlave({ challenge: 'AQ', rpId: 'x' }, credenciales as never)).toEqual({ id: 'llave-1', authenticatorData: 'Aw', clientDataJSON: 'BA', signature: 'BQ' })
  })
  it('cancelar se dice con palabras normales, y ofrece el PIN', async () => {
    const credenciales = { get: async () => null }
    const e = await usarLlave({ challenge: 'AQ', rpId: 'x' }, credenciales as never).catch((x: unknown) => x)
    expect(textoDeFalloLlave(e)).toMatch(/usa tu PIN de pago/)
    expect(textoDeFalloLlave(Object.assign(new Error('x'), { name: 'InvalidStateError' }))).toMatch(/ya tiene tu llave/)
  })
})

describe('nombreDelDispositivo', () => {
  it('sin datos de la persona', () => {
    expect(nombreDelDispositivo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iPhone')
    expect(nombreDelDispositivo('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('ordenador (Windows)')
    expect(nombreDelDispositivo('Mozilla/5.0 (Linux; Android 14; Pixel) Mobile')).toBe('móvil Android')
    expect(nombreDelDispositivo('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('Mac')
  })
})

describe('motivoPin', () => {
  it('es la misma función que la del servidor', () => {
    expect(motivoPin).toBe(motivoPinServidor)
    expect(motivoPin('123456')).toMatch(/seguidas/)
    expect(motivoPin('407219')).toBeNull()
  })
})
