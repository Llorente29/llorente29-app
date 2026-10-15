// C04b · R15 · El estado «con Diez» de un asiento de ventas, en palabras (R13).
import { describe, expect, it } from 'vitest'
import { cobroDe, estadoDiez, motivoSinPatron, numerosFolvyDiez, resumenSeleccion, textoResultado, type ConDiez, type EnvioDiez } from '../../../src/modules/conta/lib/conDiez'

const doc = { ruta: 'a/e/x.pdf', nombre: 'x.pdf', bytes: 10, creadoEn: '2026-10-13T10:00:00Z', creadoPor: 'Julio' }
const envio = (o: Partial<EnvioDiez> = {}): EnvioDiez => ({ status: 'enviado', serie: '1', numero: 1801, factura: 'UBR-FLO-20261001', intentos: 1, error: null, documento: 'adjunto', errorDocumento: null, ...o })
const d = (o: Partial<ConDiez> = {}): ConDiez => ({ entryId: 'e', canal: 'uber', nombreCanal: 'Uber Eats', documento: doc, envio: envio(), ...o })
const v = { estado: 'validado' }

describe('estadoDiez (R13/R15)', () => {
  it('Propuesto; y validándose, «Validado · enviando a Diez»', () => {
    expect(estadoDiez({ estado: 'propuesto' }, d()).texto).toBe('Propuesto')
    expect(estadoDiez(v, d({ envio: null }), { enviando: true }).texto).toBe('Validado · enviando a Diez')
  })
  it('En Diez · 1/1801 solo con el documento ADJUNTO', () => {
    expect(estadoDiez(v, d())).toMatchObject({ texto: 'En Diez · 1/1801', enDiez: true, reintentar: false })
    expect(estadoDiez(v, d({ envio: envio({ status: 'enlazado' }) })).texto).toBe('En Diez · 1/1801')
  })
  it('SIN DOCUMENTO ADJUNTO NO ESTÁ EN DIEZ: la factura en Diez sin su PDF es «falta el documento», con Reintentar', () => {
    for (const documento of ['pendiente', 'fallo', null] as const) {
      expect(estadoDiez(v, d({ envio: envio({ documento }) }))).toMatchObject({ texto: 'No ha llegado a Diez: falta el documento', enDiez: false, reintentar: true })
    }
    expect(estadoDiez(v, d({ documento: null, envio: null })).texto).toBe('No ha llegado a Diez: falta el documento')
  })
  it('el motivo del servidor, tal cual; sin envío, «aún no se ha enviado»; a los 3 intentos, sin Reintentar', () => {
    expect(estadoDiez(v, d({ envio: envio({ status: 'pendiente', serie: null, numero: null, documento: null, error: 'la conexión con Diez no está configurada para esta empresa' }) })).texto)
      .toBe('No ha llegado a Diez: la conexión con Diez no está configurada para esta empresa')
    expect(estadoDiez(v, d({ envio: null })).texto).toBe('No ha llegado a Diez: aún no se ha enviado')
    expect(estadoDiez(v, d({ envio: envio({ status: 'pendiente', documento: null, error: 'x', intentos: 3 }) })).reintentar).toBe(false)
  })
})

describe('cuántos y cuánto (R13)', () => {
  it('el total es lo que cobra la plataforma (la 430, debe menos haber), al céntimo', () => {
    expect(cobroDe([{ cuenta: '43000002', debe: 33.1, haber: 0 }, { cuenta: '70000002', debe: 0, haber: 30.09 }, { cuenta: '43000002', debe: 0, haber: 5.5 }])).toBe(27.6)
    expect(resumenSeleccion([{ importe: 0.1 }, { importe: 0.2 }])).toEqual({ n: 2, total: 0.3 })
  })
  it('el resultado dice cuántos validados, con documento y en Diez', () => {
    expect(textoResultado([{ concepto: 'a', validado: true, documento: true, enDiez: true, texto: '' }, { concepto: 'b', validado: true, documento: true, enDiez: false, texto: '' }]))
      .toBe('2 de 2 validados · 2 con su documento guardado · 1 en Diez · 1 sin llegar a Diez (debajo, por qué).')
  })
})

// 15/10 · Folvy y Diez ya no numeran igual (el Glovo 1803 no llegó a Diez, y el
// siguiente Uber, el 1804 de Folvy, es el 1/1803 de Diez): el asiento enseña los dos.
describe('los dos números de un asiento (15/10)', () => {
  const env = (o: Partial<EnvioDiez>): EnvioDiez => ({ status: 'enviado', serie: '1', numero: 1803, factura: 'UBR-XXX-20261001', intentos: 1, error: null, documento: 'adjunto', errorDocumento: null, ...o })
  const con = (envio: EnvioDiez | null): ConDiez => ({ entryId: 'e', canal: 'uber', nombreCanal: 'Uber', documento: null, envio })
  it('enviado: «Folvy 1804 · Diez 1803»', () => {
    expect(numerosFolvyDiez({ numero: 1804 }, con(env({})))).toBe('Folvy 1804 · Diez 1803')
  })
  it('validado y sin llegar (el Glovo del 01/10): lo dice', () => {
    expect(numerosFolvyDiez({ numero: 1803 }, con(env({ status: 'pendiente', numero: null, serie: null })))).toBe('Folvy 1803 · aún no está en Diez')
    expect(numerosFolvyDiez({ numero: 1803 }, con(null))).toBe('Folvy 1803 · aún no está en Diez')
  })
  it('una recibida, en la serie 2 de Diez: con su serie', () => {
    expect(numerosFolvyDiez({ numero: 12 }, con(env({ serie: '2', numero: 3176 })))).toBe('Folvy 12 · Diez 2/3176')
  })
  it('sin número todavía, nada; sin Diez (no es de una plataforma), solo el propio', () => {
    expect(numerosFolvyDiez({ numero: null }, con(env({})))).toBeNull()
    expect(numerosFolvyDiez({ numero: 40 }, null)).toBe('Folvy 40')
  })
})

// 15/10 · Antes de validar se sabe si una plataforma se puede mandar a Diez (validar no se deshace).
describe('qué plataformas se pueden mandar hoy (15/10)', () => {
  it('Uber y Just Eat, sí; Glovo no, con su porqué; una sin medir, lo dice', () => {
    expect(motivoSinPatron('uber')).toBeNull()
    expect(motivoSinPatron('justeat')).toBeNull()
    expect(motivoSinPatron('glovo')).toMatch(/una factura por tienda de Glovo y día/)
    expect(motivoSinPatron('deliveroo')).toBe('la plataforma «deliveroo» no tiene su patrón de factura medido en Diez')
  })
})
