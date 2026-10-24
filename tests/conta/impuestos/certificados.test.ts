// I01a · 4 · El almacén de certificados por dentro: leer y validar un .p12 al
// subirlo, la llamada con certificado que termina siempre, y el almacén.
//
// Los certificados son INVENTADOS y se generan al vuelo con node-forge (claves
// RSA de 1024 bits, para que vaya rápido): ni un certificado ni una clave en el
// repositorio. Los NIF son de prueba (00000000T, B00000000).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import forge from 'node-forge'
import { CertificadoNoVale, leerP12, nifDelCertificado, TAMANO_MAXIMO } from '../../../supabase/functions/_shared/certificados/leerP12'
import { LlamadaFallida, llamarConCertificado, type ClienteHttp } from '../../../supabase/functions/_shared/certificados/mtls'
import { AlmacenKms, AlmacenNoDeja, AlmacenVault, almacenPara, enmascarar, KMS_NO_PREPARADO, type ClienteBase } from '../../../supabase/functions/_shared/certificados/almacen'

const AHORA = new Date('2026-10-17T12:00:00Z')
const CONTRASENA = 'contraseña-de-prueba'

type Atributo = { name?: string; shortName?: string; type?: string; value: string }
function certificado(clave: forge.pki.rsa.KeyPair, sujeto: Atributo[], desde: Date, hasta: Date, firma = clave, emisor: Atributo[] = [{ name: 'organizationName', value: 'EMISOR DE PRUEBA' }, { name: 'commonName', value: 'AC DE PRUEBA' }]) {
  const c = forge.pki.createCertificate()
  c.publicKey = clave.publicKey
  c.serialNumber = '0a1b2c3d'
  c.validity.notBefore = desde
  c.validity.notAfter = hasta
  c.setSubject(sujeto)
  c.setIssuer(emisor)
  c.sign(firma.privateKey, forge.md.sha256.create())
  return c
}
function p12(clave: forge.pki.PrivateKey | null, certs: forge.pki.Certificate[], contrasena: string, algoritmo: 'aes256' | '3des') {
  const asn1 = forge.pkcs12.toPkcs12Asn1(clave, certs, contrasena, { algorithm: algoritmo })
  return Uint8Array.from(forge.asn1.toDer(asn1).getBytes(), (ch) => ch.charCodeAt(0))
}

let titular: forge.pki.rsa.KeyPair
let otra: forge.pki.rsa.KeyPair
let ac: forge.pki.rsa.KeyPair
const PERSONA: Atributo[] = [{ name: 'commonName', value: 'PERSONA DE PRUEBA' }, { type: '2.5.4.5', value: 'IDCES-00000000T' }]
const REPRESENTANTE: Atributo[] = [
  { name: 'commonName', value: '00000000T PERSONA DE PRUEBA (R: B00000000)' }, { type: '2.5.4.5', value: 'IDCES-00000000T' },
  { name: 'organizationName', value: 'EMPRESA DE PRUEBA SL' }, { type: '2.5.4.97', value: 'VATES-B00000000' },
]
const DESDE = new Date('2025-01-01T00:00:00Z')
const HASTA = new Date('2028-01-01T00:00:00Z')

beforeAll(() => {
  titular = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 })
  otra = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 })
  ac = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 })
})

describe('leerP12: lo que se guarda y lo que se enseña', () => {
  it('un .p12 con AES-256 (lo de hoy): ficha, NIF en huella y cola, y el material en PEM con la cadena detrás', () => {
    const delTitular = certificado(titular, PERSONA, DESDE, HASTA, ac)
    const deLaAc = certificado(ac, [{ name: 'commonName', value: 'AC DE PRUEBA' }], DESDE, HASTA)
    const r = leerP12(forge, p12(titular.privateKey, [delTitular, deLaAc], CONTRASENA, 'aes256'), CONTRASENA, AHORA)
    expect(r.ficha).toMatchObject({
      titular: 'PERSONA DE PRUEBA', nif: '00000000T', nifCola: '00T', emisor: 'EMISOR DE PRUEBA', serie: '0a1b2c3d',
      validoDesde: '2025-01-01T00:00:00.000Z', validoHasta: '2028-01-01T00:00:00.000Z', tipo: 'natural_person',
    })
    expect(r.ficha.nifHuella).toBe(forge.md.sha256.create().update('00000000T').digest().toHex())
    expect(r.ficha.huella).toMatch(/^[0-9a-f]{64}$/)
    expect(r.material.key).toMatch(/^-----BEGIN PRIVATE KEY-----/)
    const pems = r.material.cert.match(/-----BEGIN CERTIFICATE-----/g) ?? []
    expect(pems).toHaveLength(2)
    // El del titular, el primero (lo que va en la conexión).
    expect(forge.pki.certificateFromPem(r.material.cert).subject.getField('CN').value).toBe('PERSONA DE PRUEBA')
  })

  it('un .p12 con 3DES (los antiguos) también se lee', () => {
    const r = leerP12(forge, p12(titular.privateKey, [certificado(titular, PERSONA, DESDE, HASTA)], CONTRASENA, '3des'), CONTRASENA, AHORA)
    expect(r.ficha.nif).toBe('00000000T')
  })

  it('el de representante: el NIF es el de la entidad, y el tipo, representante', () => {
    const r = leerP12(forge, p12(titular.privateKey, [certificado(titular, REPRESENTANTE, DESDE, HASTA)], CONTRASENA, 'aes256'), CONTRASENA, AHORA)
    expect(r.ficha).toMatchObject({ nif: 'B00000000', nifCola: '000', tipo: 'legal_representative' })
  })

  it('el NIF: sin prefijo, en mayúsculas; si es corto, no hay', () => {
    expect(nifDelCertificado('IDCES-00000000T', null)).toBe('00000000T')
    expect(nifDelCertificado('IDCES-00000000T', 'VATES-B00000000')).toBe('B00000000')
    expect(nifDelCertificado('idces-00000000t', null)).toBe('00000000T')
    expect(nifDelCertificado('123', null)).toBeNull()
    expect(nifDelCertificado(null, null)).toBeNull()
  })
})

describe('leerP12: lo que no se guarda, y por qué (en palabras de oficina)', () => {
  const motivo = (f: () => unknown) => {
    try { f() } catch (e) { if (e instanceof CertificadoNoVale) return { motivo: e.motivo, mensaje: e.message }; throw e }
    throw new Error('no ha rechazado')
  }

  it('contraseña mala: lo dice, y el mensaje no lleva la contraseña', () => {
    const r = motivo(() => leerP12(forge, p12(titular.privateKey, [certificado(titular, PERSONA, DESDE, HASTA)], CONTRASENA, 'aes256'), 'otra-cosa', AHORA))
    expect(r.motivo).toBe('contrasena')
    expect(r.mensaje).toBe('La contraseña no abre el certificado. Comprueba que es la que pusiste al exportarlo.')
    expect(r.mensaje).not.toContain('otra-cosa')
  })

  it('la clave no corresponde al certificado (lo que colgó la prueba mTLS): se rechaza al subirlo', () => {
    const r = motivo(() => leerP12(forge, p12(otra.privateKey, [certificado(titular, PERSONA, DESDE, HASTA)], CONTRASENA, 'aes256'), CONTRASENA, AHORA))
    expect(r).toEqual({ motivo: 'no_corresponde', mensaje: 'La clave del fichero no corresponde a su certificado. No se guarda: con él no se podría presentar.' })
  })

  it('caducado, con la fecha; y uno que aún no vale', () => {
    const viejo = p12(titular.privateKey, [certificado(titular, PERSONA, new Date('2022-01-01T00:00:00Z'), new Date('2026-03-31T00:00:00Z'))], CONTRASENA, 'aes256')
    expect(motivo(() => leerP12(forge, viejo, CONTRASENA, AHORA))).toEqual({ motivo: 'caducado', mensaje: 'El certificado caducó el 31/03/2026. No se guarda: pide uno nuevo.' })
    const futuro = p12(titular.privateKey, [certificado(titular, PERSONA, new Date('2027-02-01T00:00:00Z'), HASTA)], CONTRASENA, 'aes256')
    expect(motivo(() => leerP12(forge, futuro, CONTRASENA, AHORA))).toEqual({ motivo: 'aun_no_vale', mensaje: 'El certificado no vale hasta el 01/02/2027.' })
  })

  it('sin clave privada: se pide exportarlo con ella', () => {
    const r = motivo(() => leerP12(forge, p12(null, [certificado(titular, PERSONA, DESDE, HASTA)], CONTRASENA, 'aes256'), CONTRASENA, AHORA))
    expect(r.motivo).toBe('sin_clave')
  })

  it('vacío, demasiado grande o que no es un certificado', () => {
    expect(motivo(() => leerP12(forge, new Uint8Array(), CONTRASENA, AHORA)).motivo).toBe('vacio')
    expect(motivo(() => leerP12(forge, new Uint8Array(TAMANO_MAXIMO + 1), CONTRASENA, AHORA)).motivo).toBe('grande')
    expect(motivo(() => leerP12(forge, Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256), CONTRASENA, AHORA)).motivo).toBe('ilegible')
  })
})

describe('llamarConCertificado: termina siempre, y no escribe nada en el registro', () => {
  const MATERIAL = { cert: '-----BEGIN CERTIFICATE-----\nPRUEBA\n-----END CERTIFICATE-----\n', key: '-----BEGIN PRIVATE KEY-----\nPRUEBA\n-----END PRIVATE KEY-----\n' }
  const registro = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'info')]
  afterEach(() => { for (const r of registro) { expect(r).not.toHaveBeenCalled(); r.mockClear() } })

  const cliente = () => { const c = { cerrado: 0, close() { c.cerrado++ } }; return c }

  it('contesta: devuelve estado, cuerpo y tipo, y cierra el cliente', async () => {
    const c = cliente()
    const r = await llamarConCertificado(MATERIAL, 'https://ejemplo.invalid/', { method: 'POST' }, {
      crearCliente: (m) => { expect(m).toBe(MATERIAL); return c },
      pedir: async (_u, init) => { expect(init.client).toBe(c); return new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } }) },
    })
    expect(r).toMatchObject({ status: 200, cuerpo: '{"ok":1}', tipo: 'application/json' })
    expect(c.cerrado).toBe(1)
  })

  it('sin certificado el otro lado contesta HTTP (un 400): es una respuesta, no un fallo', async () => {
    const r = await llamarConCertificado(MATERIAL, 'https://ejemplo.invalid/', {}, { crearCliente: cliente, pedir: async () => new Response('No required SSL certificate was sent', { status: 400 }) })
    expect(r.status).toBe(400)
  })

  it('no contesta y NO hace caso de la señal (lo de la prueba mTLS): falla a tiempo, lo dice y cierra', async () => {
    const c = cliente()
    const empieza = Date.now()
    const e = await llamarConCertificado(MATERIAL, 'https://ejemplo.invalid/', {}, {
      crearCliente: () => c, pedir: () => new Promise<Response>(() => {}), limiteMs: 60,
    }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(LlamadaFallida)
    expect((e as LlamadaFallida).motivo).toBe('tiempo')
    expect((e as LlamadaFallida).message).toBe('Hacienda no ha contestado en 1 segundo. No sabemos si ha llegado: compruébalo antes de repetir.')
    expect(Date.now() - empieza).toBeLessThan(1000)
    expect(c.cerrado).toBe(1)
  })

  it('no contesta y sí hace caso de la señal: también «tiempo»', async () => {
    const e = await llamarConCertificado(MATERIAL, 'https://ejemplo.invalid/', {}, {
      crearCliente: cliente,
      pedir: (_u, init) => new Promise<Response>((_, mal) => init.signal?.addEventListener('abort', () => mal(new DOMException('abortada', 'AbortError')))),
      limiteMs: 1000 * 2,
    }).catch((x: unknown) => x)
    expect((e as LlamadaFallida).motivo).toBe('tiempo')
    expect((e as LlamadaFallida).message).toContain('en 2 segundos')
  })

  it('se corta la conexión: «conexion», sin prometer que no llegó', async () => {
    const e = await llamarConCertificado(MATERIAL, 'https://ejemplo.invalid/', {}, { crearCliente: cliente, pedir: () => Promise.reject(new TypeError('connection reset')) }).catch((x: unknown) => x)
    expect((e as LlamadaFallida).motivo).toBe('conexion')
    expect((e as LlamadaFallida).message).toBe('Se ha cortado la conexión con Hacienda. Compruébalo antes de repetir.')
  })

  it('no se puede preparar el cliente con ese material: «certificado», y el mensaje no lleva nada de él', async () => {
    const e = await llamarConCertificado(MATERIAL, 'https://ejemplo.invalid/', {}, {
      crearCliente: (): ClienteHttp => { throw new Error(`clave mala ${MATERIAL.key}`) }, pedir: async () => new Response(''),
    }).catch((x: unknown) => x)
    expect((e as LlamadaFallida).motivo).toBe('certificado')
    expect((e as LlamadaFallida).message).not.toContain('PRIVATE KEY')
  })
})

describe('el almacén: una pieza, dos implementaciones', () => {
  const ficha = {
    titular: 'EMPRESA DE PRUEBA SL', nif: 'B00000000', nifHuella: 'a'.repeat(64), nifCola: '000', emisor: 'EMISOR DE PRUEBA', serie: '0a',
    validoDesde: '2025-01-01T00:00:00.000Z', validoHasta: '2028-01-01T00:00:00.000Z', huella: 'b'.repeat(64), tipo: 'legal_representative' as const,
  }
  const material = { cert: 'C', key: 'K' }
  const base = (respuestas: Record<string, { data: unknown; error: { message: string; code?: string } | null }>) => {
    const llamadas: { fn: string; params: Record<string, unknown> }[] = []
    const b: ClienteBase = { rpc: (fn, params) => { llamadas.push({ fn, params }); return Promise.resolve(respuestas[fn]) } }
    return { b, llamadas }
  }

  it('Vault · guardar: la ficha con los nombres de la base y el material como texto; nunca el NIF entero', async () => {
    const { b, llamadas } = base({ conta_cert_guardar: { data: { id: 'id-1', custodia: 'texto' }, error: null } })
    expect(await new AlmacenVault(b).guardar({ usuario: 'u', cuenta: 'c', ficha, material })).toEqual({ id: 'id-1', custodia: 'texto' })
    expect(llamadas[0].params).toMatchObject({ p_user: 'u', p_account: 'c', p_material: '{"cert":"C","key":"K"}' })
    expect(JSON.stringify(llamadas[0].params.p_ficha)).not.toContain('B00000000')
  })

  it('Vault · lo que la base no deja llega con su texto', async () => {
    const { b } = base({ conta_cert_guardar: { data: null, error: { message: 'Todavía no se pueden guardar certificados en esta cuenta…', code: '42501' } } })
    const e = await new AlmacenVault(b).guardar({ usuario: 'u', cuenta: 'c', ficha, material }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(AlmacenNoDeja)
    expect((e as AlmacenNoDeja).codigo).toBe('42501')
  })

  it('Vault · abrir con el token: el material, o el porqué de la base', async () => {
    const bien = base({ conta_cert_abrir: { data: { ok: true, material: '{"cert":"C","key":"K"}', uso_id: 'uso', certificate_id: 'cert' }, error: null } })
    expect(await new AlmacenVault(bien.b).abrir({ confirmacion: 't', usuario: 'u' })).toEqual({ material, usoId: 'uso', certificadoId: 'cert' })
    const mal = base({ conta_cert_abrir: { data: { ok: false, mensaje: 'Esa confirmación ya se usó. Vuelve a pulsar y confirmar.' }, error: null } })
    await expect(new AlmacenVault(mal.b).abrir({ confirmacion: 't', usuario: 'u' })).rejects.toThrow('Esa confirmación ya se usó')
  })

  it('KMS · preparado, pero hoy se niega y lo dice', async () => {
    const k = almacenPara('kms', base({}).b)
    expect(k).toBeInstanceOf(AlmacenKms)
    await expect(k.guardar({ usuario: 'u', cuenta: 'c', ficha, material })).rejects.toThrow(KMS_NO_PREPARADO)
    await expect(k.abrir({ confirmacion: 't', usuario: 'u' })).rejects.toThrow(KMS_NO_PREPARADO)
    expect(almacenPara('vault', base({}).b)).toBeInstanceOf(AlmacenVault)
  })

  it('las referencias de Hacienda, con solo sus 4 últimos', () => {
    expect(enmascarar('ABCD1234EFGH5678')).toBe('************5678')
    expect(enmascarar('123')).toBe('****')
    expect(enmascarar(null)).toBeNull()
  })
})
