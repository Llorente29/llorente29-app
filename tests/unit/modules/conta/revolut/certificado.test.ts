// B01 Revolut · PR 1 · La llave de la empresa: el certificado que se pega en
// Revolut se lee como X.509 de verdad, lleva la clave pública de la privada que
// se guarda, y la firma del cliente (JWT RS256) se verifica con él.
import { X509Certificate, createPrivateKey, createPublicKey, createVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ANOS_CERTIFICADO, crearLlave, dominioDeVuelta, firmaDelCliente } from '../../../../../supabase/functions/_shared/revolut/certificado.ts'

const de64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

describe('crearLlave', () => {
  it('el certificado es un X.509 válido, autofirmado, con la clave de la privada', async () => {
    const ahora = new Date('2026-10-31T12:00:00Z')
    const l = await crearLlave('Taberna de Prueba Norte S.L.', ahora)
    expect(l.certificadoPem).toMatch(/^-----BEGIN CERTIFICATE-----\n/)
    // La privada es una clave privada RSA de 2048 que Node carga (PKCS#8).
    const privada = createPrivateKey(l.privadaPem)
    expect(privada.type).toBe('private')
    expect(privada.asymmetricKeyDetails?.modulusLength).toBe(2048)
    const x = new X509Certificate(l.certificadoPem)
    expect(x.subject).toContain('CN=Sumied · Taberna de Prueba Norte S.L.')
    expect(x.issuer).toBe(x.subject)
    expect(x.verify(x.publicKey)).toBe(true)
    expect(new Date(x.validTo).getUTCFullYear()).toBe(2026 + ANOS_CERTIFICADO)
    const dePrivada = createPublicKey(l.privadaPem).export({ type: 'spki', format: 'der' })
    expect(Buffer.compare(x.publicKey.export({ type: 'spki', format: 'der' }), dePrivada)).toBe(0)
    expect(x.fingerprint256.replace(/:/g, '').toLowerCase()).toBe(l.huella)
    // El certificado no lleva la privada dentro.
    expect(l.certificadoPem).not.toContain('PRIVATE')
  })

  it('el número de serie nunca empieza por 0 (salía mal escrito en DER 1 de cada ~120 veces)', async () => {
    const llaves = await Promise.all(Array.from({ length: 50 }, () => crearLlave('Serie')))
    for (const l of llaves) {
      const x = new X509Certificate(l.certificadoPem) // con un 0 de más, aquí revienta: «illegal padding»
      expect(x.serialNumber).toMatch(/^[4-7][0-9A-F]{31}$/)
    }
  }, 60000)

  it('cada empresa, una llave distinta', async () => {
    const [a, b] = await Promise.all([crearLlave('A'), crearLlave('B')])
    expect(a.huella).not.toBe(b.huella)
  })
})

describe('firmaDelCliente', () => {
  it('es un JWT RS256 con iss, sub y aud de Revolut, que se verifica con el certificado', async () => {
    const l = await crearLlave('Prueba')
    const ahora = new Date('2026-10-31T12:00:00Z')
    const jwt = await firmaDelCliente(l.privadaPem, { iss: 'app.sumied.com', sub: 'client-id-de-prueba', ahora })
    const [c, p, f] = jwt.split('.')
    expect(JSON.parse(de64url(c).toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(JSON.parse(de64url(p).toString())).toEqual({ iss: 'app.sumied.com', sub: 'client-id-de-prueba', aud: 'https://revolut.com', iat: 1793448000, exp: 1793448300 })
    const v = createVerify('RSA-SHA256'); v.update(`${c}.${p}`)
    expect(v.verify(new X509Certificate(l.certificadoPem).publicKey, de64url(f))).toBe(true)
  })

  it('el iss es el dominio de la dirección de vuelta, sin https ni ruta', () => {
    expect(dominioDeVuelta('https://app.sumied.com/bancos/revolut/vuelta')).toBe('app.sumied.com')
    expect(dominioDeVuelta('https://app.folvy.app/bancos/revolut/vuelta')).toBe('app.folvy.app')
    expect(() => dominioDeVuelta('http://app.sumied.com/x')).toThrow(/https/)
  })
})
