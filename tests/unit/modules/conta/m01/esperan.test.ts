// tests/unit/modules/conta/m01/esperan.test.ts
//
// M01 · «Esperan» y lo que falta para Diez (Julio, 16/10, decisión 2: cada
// motivo con su texto). Los errores, los que de verdad escribe el envío
// (diezCliente.ts, diezFactura.ts, conDiezService.enviarADiez): producción no
// tiene ninguno el 16/10 (59 de 59 envíos de Foodint «enviado», con su PDF).

import { describe, expect, it } from 'vitest'
import { errorEnPalabras, localDelAsiento, porQueNoLlegaADiez, primerMotivo } from '@/modules/conta/lib/esperan'
import type { ConDiez, EnvioDiez } from '@/modules/conta/lib/conDiez'
import { CORRESPONDENCIA_LLORENTE29 } from '../../../../../supabase/functions/_shared/diezAnalitica'

const doc = { ruta: 'a/b.pdf', nombre: 'b.pdf', bytes: 10, creadoEn: '2026-10-14T10:00:00Z', creadoPor: null }
const envio = (x: Partial<EnvioDiez>): EnvioDiez => ({ status: 'pendiente', serie: null, numero: null, factura: null, intentos: 1, error: null, documento: null, errorDocumento: null, ...x } as EnvioDiez)
const con = (x: Partial<ConDiez>): ConDiez => ({ entryId: 'e', canal: 'glovo', nombreCanal: 'Glovo', documento: doc, envio: null, ...x })
const grupoDe = (l: string) => CORRESPONDENCIA_LLORENTE29.localAlEnviar[l]
const validado = { estado: 'validado' }

describe('lo validado que no llega a Diez, cada motivo con su texto', () => {
  it('en Diez, o sin validar: nada', () => {
    expect(porQueNoLlegaADiez(validado, con({ envio: envio({ status: 'enviado', serie: '1', numero: 1803, documento: 'adjunto' }) }), 'Foodint Alcalá', grupoDe)).toBeNull()
    expect(porQueNoLlegaADiez({ estado: 'propuesto' }, con({}), 'Foodint Alcalá', grupoDe)).toBeNull()
  })
  it('le falta su documento: tarea, «Adjuntar»', () => {
    const r = porQueNoLlegaADiez(validado, con({ documento: null }), 'Foodint Alcalá', grupoDe)
    expect(r).toEqual({ tipo: 'tarea', accion: 'adjuntar', texto: 'Le falta su documento, el «Resumen de ventas» de Glovo: sin él no se envía.' })
  })
  it('el envío falló: tarea, «Reintentar», con el error en palabras de oficina', () => {
    const r = porQueNoLlegaADiez(validado, con({ envio: envio({ error: 'Conexión con Diez caída: fetch failed' }) }), 'Foodint Alcalá', grupoDe)
    expect(r).toEqual({ tipo: 'tarea', accion: 'reintentar', texto: 'El envío falló: Diez no contestó (la conexión falló o tardó demasiado).' })
  })
  it('la plataforma sin su factura medida: espera, con su motivo', () => {
    const r = porQueNoLlegaADiez(validado, con({ canal: 'deliveroo', nombreCanal: 'Deliveroo' }), 'Foodint Alcalá', grupoDe)
    expect(r).toEqual({ tipo: 'espera', codigo: 'sin_factura_medida', motivo: 'No va a Diez hasta que Deliveroo tenga su factura medida: la plataforma «deliveroo» no tiene su patrón de factura medido en Diez.' })
  })
  it('el local sin su grupo en Diez: espera, con su motivo (los tres locales de Foodint sí lo tienen)', () => {
    for (const l of ['Foodint Carabanchel', 'Foodint Alcalá', 'Foodint Plaza Castilla']) expect(porQueNoLlegaADiez(validado, con({ documento: null }), l, grupoDe)?.tipo).toBe('tarea')
    const r = porQueNoLlegaADiez(validado, con({}), 'José del Hierro', grupoDe)
    expect(r).toEqual({ tipo: 'espera', codigo: 'local_sin_grupo', motivo: 'El local «José del Hierro» no tiene su grupo en Diez: sin él no se puede numerar la factura.' })
  })
  it('los cuatro textos son distintos: nunca uno para todo', () => {
    const textos = [
      porQueNoLlegaADiez(validado, con({ documento: null }), 'Foodint Alcalá', grupoDe),
      porQueNoLlegaADiez(validado, con({ envio: envio({ error: 'GET /api/asiento → 503' }) }), 'Foodint Alcalá', grupoDe),
      porQueNoLlegaADiez(validado, con({ canal: 'deliveroo' }), 'Foodint Alcalá', grupoDe),
      porQueNoLlegaADiez(validado, con({}), 'José del Hierro', grupoDe),
    ].map((r) => (r && (r.tipo === 'tarea' ? r.texto : r.motivo)))
    expect(new Set(textos).size).toBe(4)
  })
})

describe('el error del envío, en palabras de oficina', () => {
  it('lo técnico se traduce', () => {
    expect(errorEnPalabras('Conexión con Diez caída: fetch failed')).toBe('Diez no contestó (la conexión falló o tardó demasiado)')
    expect(errorEnPalabras('no se ha podido hablar con el envío a Diez (Failed to send a request to the Edge Function)')).toBe('Diez no contestó (la conexión falló o tardó demasiado)')
    expect(errorEnPalabras('GET /api/asiento → 503')).toBe('Diez estaba caído cuando se envió')
    expect(errorEnPalabras('la función ha contestado 500')).toBe('Diez estaba caído cuando se envió')
    expect(errorEnPalabras('Diez no deja entrar (401): invalid_grant')).toBe('Diez no dejó entrar con los datos de acceso de la empresa')
  })
  it('lo que ya va en palabras se deja, sin el punto', () => {
    expect(errorEnPalabras('IVA a otro tipo que el 10 % (21): no se envía hasta medirlo')).toBe('IVA a otro tipo que el 10 % (21): no se envía hasta medirlo')
    expect(errorEnPalabras('El envío a Diez aún no está publicado en este entorno.')).toBe('el envío a Diez aún no está publicado en este entorno')
    expect(errorEnPalabras('Diez ha abierto C0009 y se pidió C0008; no se lee nada')).toBe('Diez ha abierto C0009 y se pidió C0008; no se lee nada')
  })
})

describe('el local de un asiento y su primer motivo', () => {
  it('un solo local; varios o ninguno, null', () => {
    expect(localDelAsiento([{ local: 'Foodint Alcalá', comun: false }, { local: 'Foodint Alcalá', comun: false }, { local: null, comun: true }])).toBe('Foodint Alcalá')
    expect(localDelAsiento([{ local: 'A', comun: false }, { local: 'B', comun: false }])).toBeNull()
    expect(localDelAsiento([{ local: null, comun: true }])).toBeNull()
  })
  it('el primer motivo es el que dice la validación', () => {
    expect(primerMotivo([{ codigo: 'mes_cerrado', motivo: 'El mes de 03/2026 está cerrado…' }, { codigo: 'apuntes', motivo: 'otro' }])).toBe('El mes de 03/2026 está cerrado…')
    expect(primerMotivo(undefined)).toBeNull()
  })
})
