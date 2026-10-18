// I01a · 6 · Las llamadas a Hacienda, contra el DOBLE: ninguna llamada de
// verdad. Probar, presentar el 303 y «ya lo presenté fuera», con lo que puede
// salir mal en cada paso; y el freno de la puerta.
//
// Todo inventado: el certificado se genera al vuelo (NIF 00000000T, la empresa
// B00000000), y la cuenta y la declaración son ids de mentira.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import forge from 'node-forge'
import { createHash } from 'node:crypto'
import { firmanteDelPem } from '../../../supabase/functions/_shared/certificados/leerP12'
import { AlmacenNoDeja, type Almacen, type ClienteBase } from '../../../supabase/functions/_shared/certificados/almacen'
import { HaciendaDoble } from '../../../supabase/functions/_shared/hacienda/doble'
import {
  CERRADA, comprobarPuerta, HaciendaCerrada, leerConsulta, leerPresentacion, PuertaCerrada, RespuestaRara,
} from '../../../supabase/functions/_shared/hacienda/puerta'
import { contabilizarTrasPresentar, type Dependencias, presentar303, probar, yaPresentadoFuera } from '../../../supabase/functions/_shared/hacienda/acciones'

const CUENTA = 'c0000000-0000-4000-8000-00000000000a'
const DECL = 'd0000000-0000-4000-8000-0000000000d1'
const CONF = 'f0000000-0000-4000-8000-0000000000f1'

let pemPersona = ''
let pemRepresentante = ''
beforeAll(() => {
  const k = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 })
  const hacer = (sujeto: { name?: string; type?: string; value: string }[]) => {
    const c = forge.pki.createCertificate()
    c.publicKey = k.publicKey
    c.serialNumber = '01'
    c.validity.notBefore = new Date('2025-01-01T00:00:00Z')
    c.validity.notAfter = new Date('2028-01-01T00:00:00Z')
    c.setSubject(sujeto)
    c.setIssuer([{ name: 'commonName', value: 'AC DE PRUEBA' }])
    c.sign(k.privateKey, forge.md.sha256.create())
    return forge.pki.certificateToPem(c)
  }
  pemPersona = hacer([{ name: 'commonName', value: 'PERSONA DE PRUEBA' }, { type: '2.5.4.5', value: 'IDCES-00000000T' }])
  pemRepresentante = hacer([
    { name: 'commonName', value: '00000000T PERSONA DE PRUEBA (R: B00000000)' }, { type: '2.5.4.5', value: 'IDCES-00000000T' },
    { type: '2.5.4.42', value: 'PERSONA' }, { type: '2.5.4.4', value: 'DE PRUEBA' }, { type: '2.5.4.97', value: 'VATES-B00000000' },
  ])
})

// Lo que la base devuelve para preparar el fichero: un 3T a compensar (como dr303.test).
const DATOS = {
  ejercicio: 2026, periodo: '3T', nif: 'B00000000', nombre: 'Empresa de Prueba, S.L.', tipo: 'C', redeme: false, sii: false,
  iban: null, sin_actividad: false, declaracion: DECL, cuenta: CUENTA,
  casillas: { '04': 100, '06': 10, '27': 10, '28': 500, '29': 50, '45': 50, '46': -40, '64': -40, '65': 100, '66': -40, '69': -40, '71': -40 },
}

type Llamada = { fn: string; params: Record<string, unknown> }
function entorno(o: { hacienda?: HaciendaDoble | HaciendaCerrada; datos?: Record<string, unknown>; preparar?: { message: string; code?: string } } = {}) {
  const rpcs: Llamada[] = []
  const usos: { usoId: string; resultado: string; mensaje: string; referencia?: string | null }[] = []
  const abiertos: string[] = []
  const pdfs: { ruta: string; pdf: Uint8Array }[] = []
  const base: ClienteBase = {
    rpc(fn, params) {
      rpcs.push({ fn, params })
      if (fn === 'conta_impuesto_303_preparar') {
        return Promise.resolve(o.preparar ? { data: null, error: o.preparar } : { data: { ...DATOS, ...o.datos }, error: null })
      }
      if (fn === 'conta_impuesto_presentada') return Promise.resolve({ data: { mensaje: `Presentado el 303 del 3T/2026. Justificante ${params.p_justificante}, CSV ${params.p_csv}.` }, error: null })
      if (fn === 'conta_impuesto_fuera') return Promise.resolve({ data: { mensaje: params.p_comprobada ? 'Apuntado como presentado fuera: Hacienda lo confirma.' : 'Apuntado como presentado fuera, con el CSV que has pegado. No se ha podido comprobar con Hacienda.' }, error: null })
      return Promise.resolve({ data: null, error: null })
    },
  }
  const almacen: Almacen = {
    almacenamiento: 'vault',
    guardar: () => Promise.reject(new Error('no')),
    abrir: ({ confirmacion }) => {
      abiertos.push(confirmacion)
      return Promise.resolve({ material: { cert: pemPersona, key: 'CLAVE-INVENTADA' }, usoId: 'uso-1', certificadoId: 'cert-1' })
    },
    terminarUso: (u) => { usos.push(u); return Promise.resolve() },
  }
  const hacienda = o.hacienda ?? new HaciendaDoble({ ahora: () => new Date('2026-10-19T08:30:00Z') })
  const d: Dependencias = {
    base, almacen, hacienda, forge,
    guardarPdf: (ruta, pdf) => { pdfs.push({ ruta, pdf }); return Promise.resolve() },
    sha256: (x) => Promise.resolve(createHash('sha256').update(typeof x === 'string' ? x : Buffer.from(x)).digest('hex')),
    programa: { version: '0001', nifDesarrollo: 'B11111111' },
  }
  return { d, rpcs, usos, abiertos, pdfs, hacienda, fns: () => rpcs.map((r) => r.fn) }
}

const espias = () => [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'info')]
afterEach(() => vi.restoreAllMocks())

describe('presentar el 303', () => {
  it('bien: comprueba el fichero, consulta antes, presenta, apunta «Presentado» y guarda el justificante; nada al registro', async () => {
    const e = entorno()
    const consola = espias()
    const s = await presentar303(e.d, { usuario: 'u-1', confirmacion: CONF, declaracion: DECL })
    expect(s.ok).toBe(true)
    expect(s.mensaje).toMatch(/^Presentado el 303 del 3T\/2026\. Justificante 30326\d{8}, CSV DOBLE[A-Z0-9]{11}\. Justificante guardado\.$/)
    expect(e.fns()).toEqual(['conta_impuesto_303_preparar', 'conta_impuesto_303_fichero_comprobado', 'conta_impuesto_presentada',
      'conta_impuesto_justificante_guardar', 'conta_impuesto_hacienda_apunte'])
    const comprobado = e.rpcs[1].params
    expect(comprobado.p_ok).toBe(true)
    expect(comprobado.p_huella).toMatch(/^[0-9a-f]{64}$/)
    // Lo que se le manda a Hacienda: primero la consulta, después la presentación con el fichero y el firmante.
    const doble = e.hacienda as HaciendaDoble
    expect(doble.llamadas.map((l) => l.servicio)).toEqual(['consultar', 'presentar', 'pdf'])
    expect(doble.llamadas[0].peticion).toMatchObject({ NIF: 'B00000000', MOD: '303', EJF: 2026, PER: '3T' })
    expect(doble.llamadas[1].peticion).toMatchObject({ MODELO: '303', EJERCICIO: '2026', PERIODO: '3T', FIR: 'FirmaBasica', FIRNIF: '00000000T', FIRNOMBRE: 'PERSONA DE PRUEBA' })
    expect(String(doble.llamadas[1].peticion.F01)).toMatch(/^<T303020263T0000><AUX>/)
    // «Presentado» solo con el uso del certificado de esa persona.
    const presentada = e.rpcs[2].params
    expect(presentada).toMatchObject({ p_return: DECL, p_user: 'u-1', p_use: 'uso-1' })
    const csv = String(presentada.p_csv)
    // El uso se cierra con el CSV enmascarado, nunca entero.
    expect(e.usos).toHaveLength(1)
    expect(e.usos[0]).toMatchObject({ usoId: 'uso-1', resultado: 'ok' })
    expect(e.usos[0].referencia).toBe(`${'*'.repeat(12)}${csv.slice(-4)}`)
    // El PDF, en la carpeta de la declaración, con su huella de nombre.
    expect(e.pdfs).toHaveLength(1)
    expect(e.pdfs[0].ruta).toMatch(new RegExp(`^${CUENTA}/impuestos/${DECL}/[0-9a-f]{64}\\.pdf$`))
    expect(e.rpcs[3].params).toMatchObject({ p_return: DECL, p_ruta: e.pdfs[0].ruta, p_tamano: e.pdfs[0].pdf.length })
    for (const c of consola) expect(c).not.toHaveBeenCalled()
  })

  it('si Hacienda ya tiene ese 303 no se presenta otra vez (sería complementaria), y se dice', async () => {
    const doble = new HaciendaDoble({ presentadas: [{ ejercicio: '2026', modelo: '303', periodo: '3T', nif: 'B00000000', csv: 'ABCDEFGHIJKL1234', expediente: null, justificante: '3032600000099', justificanteAnterior: null, fechaHora: '2026-10-15T10:00:00Z' }] })
    const e = entorno({ hacienda: doble })
    const s = await presentar303(e.d, { usuario: 'u-1', confirmacion: CONF, declaracion: DECL })
    expect(s).toMatchObject({ ok: false, motivo: 'ya_presentada' })
    expect(s.mensaje).toBe('No se ha presentado: Hacienda ya tiene el 303 del 3T/2026 de esta empresa (presentado el 15/10/2026, justificante 3032600000099). Si es el tuyo, apúntalo con «Ya lo presenté» y su CSV; otra presentación sería complementaria.')
    expect(doble.llamadas.map((l) => l.servicio)).toEqual(['consultar'])
    expect(e.fns()).not.toContain('conta_impuesto_presentada')
    expect(e.usos[0].resultado).toBe('error')
  })

  it('con errores de Hacienda: no se ha presentado nada, se enseñan con su código y se apuntan', async () => {
    const e = entorno({ hacienda: new HaciendaDoble({ escenario: 'errores' }) })
    const s = await presentar303(e.d, { usuario: 'u-1', confirmacion: CONF, declaracion: DECL })
    expect(s).toMatchObject({ ok: false, motivo: 'errores' })
    expect(s.mensaje).toBe('Hacienda no lo ha aceptado: no se ha presentado nada. E00099: La casilla [71] no coincide con el resultado de la liquidación.')
    expect(e.fns()).not.toContain('conta_impuesto_presentada')
    const apunte = e.rpcs.find((r) => r.fn === 'conta_impuesto_hacienda_apunte')!.params
    expect(apunte).toMatchObject({ p_service: 'present', p_result: 'error', p_codes: ['E00099'] })
    expect(e.usos[0].resultado).toBe('error')
  })

  it('sin respuesta a tiempo: NO se sabe si llegó, y así se dice; no se apunta como presentada', async () => {
    const e = entorno({ hacienda: new HaciendaDoble({ escenario: 'tiempo' }) })
    const s = await presentar303(e.d, { usuario: 'u-1', confirmacion: CONF, declaracion: DECL })
    expect(s).toMatchObject({ ok: false, motivo: 'tiempo', incierto: true })
    expect(s.mensaje).toBe('Hacienda no ha contestado en 30 segundos. No sabemos si ha llegado: compruébalo antes de repetir. Si al comprobarlo ya está presentado, apúntalo con «Ya lo presenté» y su CSV.')
    expect(e.fns()).not.toContain('conta_impuesto_presentada')
    expect(e.usos).toEqual([expect.objectContaining({ resultado: 'error' })])
  })

  it('una respuesta que no se entiende tampoco se da por presentada', async () => {
    const e = entorno({ hacienda: new HaciendaDoble({ escenario: 'rara' }) })
    const s = await presentar303(e.d, { usuario: 'u-1', confirmacion: CONF, declaracion: DECL })
    expect(s).toMatchObject({ ok: false, motivo: 'rara', incierto: true })
    expect(e.fns()).not.toContain('conta_impuesto_presentada')
  })

  it('si el fichero no cumple el diseño, se apunta y NO se abre el certificado ni se llama a Hacienda', async () => {
    const e = entorno({ datos: { tipo: 'U' } }) // domiciliar sin cuenta
    const s = await presentar303(e.d, { usuario: 'u-1', confirmacion: CONF, declaracion: DECL })
    expect(s).toMatchObject({ ok: false, motivo: 'fichero' })
    expect(s.mensaje).toContain('No se presenta: el fichero no cumple el diseño de Hacienda.')
    expect(e.rpcs[1]).toMatchObject({ fn: 'conta_impuesto_303_fichero_comprobado', params: { p_ok: false } })
    expect(e.abiertos).toEqual([])
    expect((e.hacienda as HaciendaDoble).llamadas).toEqual([])
  })

  it('si la base no deja (token de otro, sin revisar…), ni fichero, ni certificado, ni Hacienda', async () => {
    const e = entorno({ preparar: { message: 'Esa confirmación no es para presentar esta declaración. Vuelve a pulsar y confirmar.', code: '42501' } })
    const s = await presentar303(e.d, { usuario: 'u-1', confirmacion: CONF, declaracion: DECL })
    expect(s).toEqual({ ok: false, motivo: 'no_deja', mensaje: 'Esa confirmación no es para presentar esta declaración. Vuelve a pulsar y confirmar.' })
    expect(e.fns()).toEqual(['conta_impuesto_303_preparar'])
    expect(e.abiertos).toEqual([])
  })

  it('presentado pero sin PDF: se dice que está presentado y se pide subir el justificante', async () => {
    const e = entorno({ hacienda: new HaciendaDoble({ escenario: 'pdf_no_responde' }) })
    const s = await presentar303(e.d, { usuario: 'u-1', confirmacion: CONF, declaracion: DECL })
    expect(s).toMatchObject({ ok: true, pide_pdf: true })
    expect(s.mensaje).toMatch(/El justificante no se ha podido bajar de Hacienda: súbelo en PDF\.$/)
    expect(e.fns()).toContain('conta_impuesto_presentada')
    expect(e.fns()).not.toContain('conta_impuesto_justificante_guardar')
  })

  it('con la puerta cerrada no sale nada: se dice, y el uso del certificado queda cerrado', async () => {
    const e = entorno({ hacienda: new HaciendaCerrada() })
    const s = await presentar303(e.d, { usuario: 'u-1', confirmacion: CONF, declaracion: DECL })
    expect(s).toMatchObject({ ok: false, motivo: 'cerrada', mensaje: CERRADA })
    expect(e.usos[0].resultado).toBe('error')
  })
})

describe('probar con Hacienda', () => {
  it('si la consulta contesta, funciona, y queda dicho en el uso', async () => {
    const e = entorno()
    const s = await probar(e.d, { usuario: 'u-1', confirmacion: CONF })
    expect(s.ok).toBe(true)
    expect(s.mensaje).toMatch(/^Funciona · probado con Hacienda el \d{2}\/\d{2}\/\d{4}\.$/)
    expect((e.hacienda as HaciendaDoble).llamadas).toEqual([expect.objectContaining({ servicio: 'consultar', peticion: expect.objectContaining({ NIF: '00000000T' }) })])
    expect(e.usos[0]).toMatchObject({ resultado: 'ok', mensaje: s.mensaje })
  })

  it('si Hacienda no acepta el certificado, «No funciona» con el motivo', async () => {
    const e = entorno({ hacienda: new HaciendaDoble({ escenario: 'certificado' }) })
    const s = await probar(e.d, { usuario: 'u-1', confirmacion: CONF })
    expect(s).toMatchObject({ ok: false, motivo: 'certificado' })
    expect(s.mensaje).toMatch(/^No funciona: No se ha podido preparar la conexión con este certificado/)
    expect(e.usos[0].resultado).toBe('error')
  })
})

describe('«Ya lo presenté fuera»', () => {
  const fuera = { usuario: 'u-1', declaracion: DECL, nif: 'B00000000', modelo: '303', ejercicio: 2026, periodo: '3T', cuenta: CUENTA }
  const presentada = { ejercicio: '2026', modelo: '303', periodo: '3T', nif: 'B00000000', csv: 'ABCDEFGHIJKL1234', expediente: null, justificante: '3032600000099', justificanteAnterior: null, fechaHora: '2026-10-15T10:00:00Z' }

  it('con certificado: la consulta lo confirma, se apunta comprobado con su justificante y se trae el PDF del CSV', async () => {
    const e = entorno({ hacienda: new HaciendaDoble({ presentadas: [presentada] }) })
    const s = await yaPresentadoFuera(e.d, { ...fuera, csv: 'abcd efgh ijkl 1234', confirmacion: CONF })
    expect(s).toMatchObject({ ok: true, comprobada: true, pide_pdf: false })
    expect(e.rpcs.find((r) => r.fn === 'conta_impuesto_fuera')!.params).toMatchObject({
      p_csv: 'ABCDEFGHIJKL1234', p_comprobada: true, p_justificante: '3032600000099', p_fecha: '2026-10-15T10:00:00Z', p_use: 'uso-1',
    })
    expect(e.pdfs).toHaveLength(1)
    expect(e.usos[0]).toMatchObject({ resultado: 'ok', referencia: '************1234' })
  })

  it('si el CSV no es el de Hacienda, no se apunta nada y se dice', async () => {
    const e = entorno({ hacienda: new HaciendaDoble({ presentadas: [presentada] }) })
    const s = await yaPresentadoFuera(e.d, { ...fuera, csv: 'ZZZZZZZZZZZZ9999', confirmacion: CONF })
    expect(s).toEqual({ ok: false, motivo: 'no_coincide', mensaje: 'Hacienda tiene el 303 del 3T/2026 de esta empresa, pero con otro CSV. Revisa el que has pegado.' })
    expect(e.fns()).not.toContain('conta_impuesto_fuera')
  })

  it('sin certificado (y con la puerta cerrada): se apunta diciendo que no está comprobado, y se pide el PDF', async () => {
    const e = entorno({ hacienda: new HaciendaCerrada() })
    const s = await yaPresentadoFuera(e.d, { ...fuera, csv: 'ABCDEFGHIJKL1234' })
    expect(s).toMatchObject({ ok: true, comprobada: false, pide_pdf: true })
    expect(s.mensaje).toBe('Apuntado como presentado fuera, con el CSV que has pegado. No se ha podido comprobar con Hacienda. Hacienda no nos da el justificante desde aquí: súbelo en PDF.')
    expect(e.abiertos).toEqual([])
  })

  it('si el PDF del CSV no responde, se pide subirlo', async () => {
    const e = entorno({ hacienda: new HaciendaDoble({ presentadas: [presentada], escenario: 'pdf_no_responde' }) })
    const s = await yaPresentadoFuera(e.d, { ...fuera, csv: 'ABCDEFGHIJKL1234', confirmacion: CONF })
    expect(s).toMatchObject({ ok: true, comprobada: true, pide_pdf: true })
    expect(s.mensaje).toMatch(/súbelo en PDF\.$/)
  })

  it('un CSV con otra forma no llega ni a la base', async () => {
    const e = entorno()
    const s = await yaPresentadoFuera(e.d, { ...fuera, csv: '1234' })
    expect(s).toMatchObject({ ok: false, motivo: 'csv' })
    expect(e.rpcs).toEqual([])
  })
})

describe('la puerta: cerrada salvo que Julio la abra', () => {
  const lunes10 = new Date('2026-10-19T08:00:00Z') // lunes, 10:00 en Madrid
  it('sin nada, cerrada; y cerrada se niega a todo con su mensaje', async () => {
    expect(comprobarPuerta({ entorno: undefined, autorizacion: undefined, ahora: lunes10, esProduccion: true })).toBe('cerrada')
    await expect(new HaciendaCerrada().consultar()).rejects.toThrow(CERRADA)
  })
  it('el doble, nunca contra producción', () => {
    expect(comprobarPuerta({ entorno: 'doble', autorizacion: undefined, ahora: lunes10, esProduccion: false })).toBe('doble')
    expect(() => comprobarPuerta({ entorno: 'doble', autorizacion: undefined, ahora: lunes10, esProduccion: true })).toThrow(PuertaCerrada)
  })
  it('el entorno de pruebas: con la autorización de ESE día, y en laborable de 8 a 15 (Madrid)', () => {
    const p = (ahora: Date, autorizacion?: string) => () => comprobarPuerta({ entorno: 'pruebas', autorizacion, ahora, esProduccion: false })
    expect(p(lunes10, 'pruebas:2026-10-19')()).toBe('pruebas')
    expect(p(lunes10)).toThrow('El entorno de pruebas de Hacienda no está autorizado para hoy (2026-10-19). No se ha enviado nada.')
    expect(p(lunes10, 'pruebas:2026-10-16')).toThrow(PuertaCerrada)
    expect(p(new Date('2026-10-19T13:00:00Z'), 'pruebas:2026-10-19')).toThrow('El entorno de pruebas de Hacienda solo se usa en laborable, de 8:00 a 15:00. No se ha enviado nada.')
    expect(p(new Date('2026-10-19T05:30:00Z'), 'pruebas:2026-10-19')).toThrow(PuertaCerrada) // 7:30
    expect(p(new Date('2026-10-17T08:00:00Z'), 'pruebas:2026-10-17')).toThrow(PuertaCerrada) // sábado
  })
  it('producción: solo con su autorización', () => {
    expect(() => comprobarPuerta({ entorno: 'produccion', autorizacion: undefined, ahora: lunes10, esProduccion: true })).toThrow('Presentar en Hacienda de verdad no está autorizado. No se ha enviado nada.')
    expect(comprobarPuerta({ entorno: 'produccion', autorizacion: 'produccion', ahora: lunes10, esProduccion: true })).toBe('produccion')
    expect(() => comprobarPuerta({ entorno: 'www1', autorizacion: 'produccion', ahora: lunes10, esProduccion: true })).toThrow(PuertaCerrada)
  })
})

describe('leer lo que contesta Hacienda', () => {
  it('una presentación correcta, con los nombres de las Especificaciones v3.0', () => {
    const r = leerPresentacion(JSON.stringify({
      CodigoSeguroVerificacion: 'ABCDEFGHIJKL1234', Fecha: '19-10-2026', Hora: '10:00:00', Expediente: '303-0001', NIFPresentador: '00000000T',
      TipoRepresentacion: 'Nombre propio', NIFDeclarante: 'B00000000', Justificante: '3032600000001', NRCPago: '', ImporteAIngresar: '0,00',
      urlPdf: 'https://www2.agenciatributaria.gob.es/x', avisos: ['A1'], advertencias: [],
    }))
    expect(r).toMatchObject({ ok: true, csv: 'ABCDEFGHIJKL1234', justificante: '3032600000001', nrc: null, urlPdf: 'https://www2.agenciatributaria.gob.es/x', avisos: ['A1'] })
  })
  it('con errores: cada uno con su código, y sin CSV', () => {
    expect(leerPresentacion(JSON.stringify({ errores: ['E00012 El NIF no está identificado', { codigo: 'E00045', descripcion: 'Casilla [27] incorrecta' }] })))
      .toEqual({ ok: false, errores: [{ codigo: 'E00012', texto: 'El NIF no está identificado' }, { codigo: 'E00045', texto: 'Casilla [27] incorrecta' }] })
  })
  it('lo que no se entiende es «no sabemos si se ha presentado», nunca un sí ni un no', () => {
    expect(() => leerPresentacion('<html>error</html>')).toThrow(RespuestaRara)
    expect(() => leerPresentacion('{}')).toThrow('Hacienda ha contestado sin CSV y sin errores. No sabemos si se ha presentado: compruébalo antes de repetir.')
  })
  it('la consulta (consultas.xsd): las declaraciones con su CSV', () => {
    const xml = '<respuesta><declaraciones><declaracion><ejercicio>2026</ejercicio><modelo>303</modelo><periodo>3T</periodo><nif>B00000000</nif>' +
      '<csv>ABCDEFGHIJKL1234</csv><expediente>E1</expediente><justificante>3032600000001</justificante><just_anterior></just_anterior>' +
      '<fechaYHoraPresentacion>2026-10-15 10:00:00</fechaYHoraPresentacion></declaracion></declaraciones></respuesta>'
    expect(leerConsulta(xml)).toEqual([{ ejercicio: '2026', modelo: '303', periodo: '3T', nif: 'B00000000', csv: 'ABCDEFGHIJKL1234', expediente: 'E1',
      justificante: '3032600000001', justificanteAnterior: null, fechaHora: '2026-10-15 10:00:00' }])
    expect(leerConsulta('<respuesta><declaraciones/></respuesta>')).toEqual([])
    expect(() => leerConsulta('no es xml')).toThrow(RespuestaRara)
  })
})

describe('quién firma (FIRNIF, FIRNOMBRE)', () => {
  it('el titular del certificado; si es de representante, la entidad aparte', () => {
    expect(firmanteDelPem(forge, pemPersona)).toEqual({ nif: '00000000T', nombre: 'PERSONA DE PRUEBA', nifEntidad: null })
    expect(firmanteDelPem(forge, pemRepresentante)).toEqual({ nif: '00000000T', nombre: 'PERSONA DE PRUEBA', nifEntidad: 'B00000000' })
  })
  it('el almacén que no deja abrir: se dice con su texto', async () => {
    const e = entorno()
    e.d.almacen.abrir = () => Promise.reject(new AlmacenNoDeja('Esa confirmación ya se usó. Vuelve a pulsar y confirmar.', '42501'))
    expect(await probar(e.d, { usuario: 'u-1', confirmacion: CONF })).toEqual({ ok: false, motivo: 'no_deja', mensaje: 'Esa confirmación ya se usó. Vuelve a pulsar y confirmar.' })
  })
})

describe('I01b · contabilizar después de presentar', () => {
  const persona = (r: { data?: unknown; error?: { message: string } | null; lanza?: boolean }): ClienteBase & { llamadas: unknown[] } => {
    const llamadas: unknown[] = []
    return {
      llamadas,
      rpc(fn, params) {
        llamadas.push([fn, params])
        if (r.lanza) return Promise.reject(new Error('red'))
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
      },
    }
  }
  it('llama a contabilizar con la declaración y devuelve su mensaje', async () => {
    const p = persona({ data: { ok: true, mensaje: 'Contabilizado: asiento 4/12 del 30/09/2026, 477 contra 472 y 6.360,00 € a la 4750.' } })
    const r = await contabilizarTrasPresentar(p, 'd-1')
    expect(p.llamadas).toEqual([['conta_impuesto_303_contabilizar', { p_return: 'd-1' }]])
    expect(r).toEqual({ ok: true, mensaje: 'Contabilizado: asiento 4/12 del 30/09/2026, 477 contra 472 y 6.360,00 € a la 4750.' })
  })
  it('si la base no deja, queda presentado y dice por qué', async () => {
    const r = await contabilizarTrasPresentar(persona({ error: { message: 'El asiento de liquidación lo hace un administrador o un encargado de la empresa.' } }), 'd-1')
    expect(r.ok).toBe(false)
    expect(r.mensaje).toBe('Queda «Presentado» sin contabilizar: El asiento de liquidación lo hace un administrador o un encargado de la empresa.')
  })
  it('si la red falla, no lanza: lo dice', async () => {
    const r = await contabilizarTrasPresentar(persona({ lanza: true }), 'd-1')
    expect(r).toEqual({ ok: false, mensaje: 'Queda «Presentado» sin contabilizar: no se ha podido hablar con la base. Contabilízalo desde la declaración.' })
  })
})
