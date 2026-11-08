// tests/unit/modules/conta/g03/alta.test.ts
//
// G03 · Tarea 4 · En el alta: «gestoría» y «asesoría» se reconocen como
// actividad, y justo después de «A qué te dedicas» se pregunta el sector, con
// la propuesta marcada («Por lo que me cuentas, eres una gestoría. ¿Es así?»).

import { describe, expect, it } from 'vitest'
import { gruposDe } from '@/modules/conta/alta/actividades'
import { primeraDelPaso, todasLasPreguntas, type ContextoAlta } from '@/modules/conta/alta/guion'
import { PUNTOS } from '@/modules/conta/alta/llevamos'
import { enTexto, fraseSector } from '@/modules/conta/alta/frases'
import { propuestaGuardada } from '@/modules/conta/alta/sectorDelAlta'
import { gestoriaPorCodigos } from '@/modules/conta/sectores/sectores'
import { fraseDespuesDelCambio } from '@/modules/conta/sectores/cambio'

const CUENTA = { nombre: 'Gestoría', razonSocial: 'Gestoría de Prueba, S.L.', nif: 'B28000016',
  direccion: { calle: 'Calle de la Prueba 12', codigoPostal: '28001', poblacion: 'Madrid', provincia: 'Madrid' } }
const ctx = (c: Partial<ContextoAlta> = {}): ContextoAlta => ({
  cuenta: CUENTA, tipo: 'company', cp: '28001', clases: ['business'], respuestas: {}, hoy: '2026-11-07', marca: 'sumied', ...c,
})

describe('la actividad reconoce la gestoría', () => {
  it.each(['Somos una gestoría', 'asesoría fiscal y laboral para pymes', 'Gestor administrativo', 'llevamos la contabilidad de empresas', 'graduado social'])('«%s» → gestoría', (t) => {
    expect(gruposDe(t).map((g) => g.clave)).toContain('gestoria')
  })
  it('un restaurante no es gestoría', () => {
    expect(gruposDe('restaurante y reparto a domicilio').map((g) => g.clave)).not.toContain('gestoria')
  })
  it('busca en los títulos de los catálogos de la base', () => {
    const g = gruposDe('Somos una gestoría').find((x) => x.clave === 'gestoria')!
    expect(g.iae).toEqual(['financieros y contables', 'gestión administrativa'])
    expect(g.cnae).toEqual(['teneduría de libros'])
  })
})

describe('el IAE 1_8497 (servicios de gestión administrativa) propone gestoría; el resto del 849, no', () => {
  it('1_8497 sí', () => expect(gestoriaPorCodigos('1_8497', null)).toBe('si'))
  it.each(['1_849', '1_8491', '1_8495', '1_8499'])('%s no', (c) => expect(gestoriaPorCodigos(c, null)).toBe('no'))
})

describe('la pregunta del sector en el alta', () => {
  const claves = (c: ContextoAlta) => todasLasPreguntas('impuestos', c).map((p) => p.clave)

  it('con Sumied y la propuesta, la primera después de la actividad; sin ella o con Folvy, no sale', () => {
    expect(claves(ctx({ sector: { sector: 'gestoria', duda: false } }))[0]).toBe('sector')
    expect(claves(ctx({ sector: null }))).not.toContain('sector')
    expect(claves(ctx({ marca: 'folvy', sector: { sector: 'hosteleria', duda: false } }))).not.toContain('sector')
  })

  it('«Ahora, tus impuestos.» se queda en la del IVA, no en la del sector', () => {
    const c = ctx({ sector: { sector: 'gestoria', duda: false } })
    expect(primeraDelPaso('impuestos', c)).toBe('periodo')
    expect(todasLasPreguntas('impuestos', c)[0].transicion).toBeUndefined()
  })

  it('con la propuesta dicha y marcada (la primera opción)', () => {
    const p = todasLasPreguntas('impuestos', ctx({ sector: { sector: 'gestoria', duda: false } }))[0]
    expect(p.texto).toBe('Por lo que me cuentas, eres una gestoría. ¿Es así?')
    expect(p.opciones.map((o) => o.texto)).toEqual(['Gestoría o asesoría', 'General', 'Hostelería'])
    expect(p.normal).toBe('gestoria')
    const h = todasLasPreguntas('impuestos', ctx({ sector: { sector: 'hosteleria', duda: false } }))[0]
    expect(h.texto).toBe('Por lo que me cuentas, eres un negocio de hostelería. ¿Es así?')
    const g = todasLasPreguntas('impuestos', ctx({ sector: { sector: 'general', duda: false } }))[0]
    expect(g.texto).toBe('Por lo que me cuentas, tu negocio no es de hostelería ni una gestoría. ¿Es así?')
  })

  it('con duda (CNAE 69.10 o 70.20), la pregunta va abierta', () => {
    const p = todasLasPreguntas('impuestos', ctx({ sector: { sector: 'gestoria', duda: true } }))[0]
    expect(p.texto).toBe('Por lo que me cuentas, puede que seas una gestoría o una asesoría. ¿Lo eres?')
  })

  it('cuenta en «Tus impuestos» de lo que llevamos (es de ese paso)', () => {
    expect(PUNTOS.find((x) => x.clave === 'impuestos')!.preguntas[0]).toBe('sector')
  })
})

describe('al volver a entrar a medias, la propuesta es la guardada', () => {
  it('el sector de la empresa; sin él, la marca de hostelería', () => {
    expect(propuestaGuardada('gestoria', false, [])).toEqual({ sector: 'gestoria', duda: false })
    expect(propuestaGuardada(null, true, [])).toEqual({ sector: 'hosteleria', duda: false })
    expect(propuestaGuardada(undefined, null, [])).toEqual({ sector: 'general', duda: false })
  })
  it('con duda solo si sus actividades vivas solo dan duda', () => {
    expect(propuestaGuardada('gestoria', false, [{ iaeCode: null, cnaeCode: '6910', endedOn: null }])).toEqual({ sector: 'gestoria', duda: true })
    expect(propuestaGuardada('gestoria', false, [{ iaeCode: '2_722', cnaeCode: '6910', endedOn: null }])).toEqual({ sector: 'gestoria', duda: false })
  })
})

describe('lo que se dice (regla 8: con contenido)', () => {
  it('en el alta, qué sale y dónde se cambia', () => {
    expect(enTexto(fraseSector('gestoria'))).toBe('Apuntado: sector Gestoría o asesoría. Además de lo de siempre, salen Clientes y cuotas, Tarifa y paquetes, CRM y GoCardless en Ajustes › Cobros. Se cambia en Ajustes › Tu empresa.')
    expect(enTexto(fraseSector('general'))).toBe('Apuntado: sector General: lo de siempre. Se cambia en Ajustes › Tu empresa.')
  })
  it('en Ajustes, después de cambiar', () => {
    expect(fraseDespuesDelCambio('general', 'gestoria')).toBe('Hecho: tu negocio es ahora del sector Gestoría o asesoría. Ya salen: Clientes y cuotas, Tarifa y paquetes, CRM y GoCardless en Ajustes › Cobros. No se ha borrado nada.')
    expect(fraseDespuesDelCambio('hosteleria', 'general')).toMatch(/^Hecho: tu negocio es ahora del sector General\. Dejan de salir: Cierres del día, .*\. No se ha borrado nada\.$/)
  })
})
