// S02 · La pantalla del año, lo que no es pantalla (src/modules/conta/impuestos/anual.ts).
import { describe, expect, it } from 'vitest'
import { arrendadoresEnOrden, claveEnPalabras, ejercicioPorDefecto, faltaEnInmueble, inmuebleEnPalabras, perceptoresEnOrden, porcentajeEnPalabras, porQueNoFichero, queFaltaAnual, sinTrabajadorEnPalabras, tarjetaAnual } from '@/modules/conta/impuestos/anual'
import type { ModeloTrimestre } from '@/modules/conta/impuestos/trimestre'
import type { Inmueble180, Perceptor180, Perceptor190 } from '@/modules/conta/services/impuestosService'

const modelo = (o: Partial<ModeloTrimestre> = {}, decl: Partial<NonNullable<ModeloTrimestre['declaracion']>> | null = null): ModeloTrimestre => ({
  modelo: '190', nombre: 'Resumen anual de retenciones', cadencia: 'annual', periodo: '0A', no_toca: false, presentacion: '2027-02-01', domiciliacion: null,
  declaracion: decl === null ? null : {
    id: 'd', cuenta: 'c', estado: 'draft', estado_texto: 'Borrador', resultado: 'zero', importe: 0, presentada: null, presentada_por: null, por: null,
    csv: null, justificante: null, justificante_pdf: null, traido: null, expediente: null, presentador: null, casillas: [], ...decl,
  },
  ...o,
})

describe('el año que se abre', () => {
  it('en enero y febrero, el anterior (es cuando se presentan); después, el de hoy', () => {
    expect(ejercicioPorDefecto('2027-01-15')).toBe(2026)
    expect(ejercicioPorDefecto('2027-02-28')).toBe(2026)
    expect(ejercicioPorDefecto('2026-10-28')).toBe(2026)
  })
})

describe('la tarjeta de un informativo', () => {
  it('no enseña «0,00 €»: en el 190, lo retenido en el año', () => {
    const t = tarjetaAnual(modelo({}, { casillas: [{ casilla: '03', valor: 1911.21, texto: null, origen: 'calculated', motivo: null }] }), '2026-10-28', 2026)
    expect(t.importe).toBe('1.911,21 € retenidos')
    expect(t.titulo).toBe('Retenciones del año · 190')
  })
  it('sin calcular, «—» y su plazo', () => {
    const t = tarjetaAnual(modelo(), '2026-10-28', 2026)
    expect(t.importe).toBe('—')
    expect(t.chip.texto).toMatch(/Hasta el/)
  })
})

describe('qué falta y el fichero', () => {
  it('el 190 lo calcula Sumied; el 347, aún no, y se dice', () => {
    expect(queFaltaAnual(modelo()).calcula).toBe(true)
    const f = queFaltaAnual(modelo({ modelo: '347' }))
    expect(f.calcula).toBe(false)
    expect(f.texto).toMatch(/CSV/)
  })
  it('el fichero espera a que no haya errores ni avisos sin mirar, y lo dice', () => {
    const m = modelo({}, {})
    expect(porQueNoFichero(modelo(), [])).toBe('Primero hay que calcularlo.')
    expect(porQueNoFichero(m, [{ resultado: 'error', aceptado: false }, { resultado: 'error', aceptado: false }])).toMatch(/2 cosas/)
    expect(porQueNoFichero(m, [{ resultado: 'warning', aceptado: false }])).toMatch(/el aviso/)
    expect(porQueNoFichero(m, [{ resultado: 'warning', aceptado: true }, { resultado: 'ok', aceptado: false }])).toBeNull()
  })
})

describe('los perceptores', () => {
  const p = (o: Partial<Perceptor190>): Perceptor190 => ({ clave: 'G', subclave: '01', nif: '00000000T', nombre: 'B', provincia: '28', nif_valido: true, integra: 1, retenciones: 1, origen: 'diario', ...o })
  it('los que tienen algo que corregir, arriba y con su etiqueta; no se esconde ninguno (regla 7)', () => {
    const l = perceptoresEnOrden([p({ nombre: 'Bien' }), p({ nombre: 'Sin provincia', provincia: null }), p({ clave: 'A', sin_trabajador: true, nombre: null, nif: null })])
    expect(l.map((x) => x.falta)).toEqual([['sin trabajador'], ['sin provincia'], []])
    expect(l).toHaveLength(3)
  })
  it('un NIF que no vale se distingue de uno que falta', () => {
    expect(perceptoresEnOrden([p({ nif_valido: false })])[0].falta).toEqual(['NIF que no vale'])
    expect(perceptoresEnOrden([p({ nif: null, nif_valido: false })])[0].falta).toEqual(['sin NIF'])
  })
  it('la clave en palabras', () => {
    expect(claveEnPalabras('G', '03')).toBe('Actividad profesional · tipo reducido de inicio')
    expect(claveEnPalabras('A', null)).toBe('Empleado por cuenta ajena')
    expect(claveEnPalabras('L', '05')).toBe('Rentas exentas · indemnización por despido o cese exenta')
  })
  it('lo «sin trabajador»: las nóminas (640) y las indemnizaciones (641) se dicen por separado', () => {
    expect(sinTrabajadorEnPalabras({ clave: 'A', subclave: null }).titulo).toBe('Nóminas sin trabajador')
    expect(sinTrabajadorEnPalabras({ clave: 'L', subclave: '05' })).toEqual({
      titulo: 'Indemnizaciones sin trabajador',
      apoyo: 'Las indemnizaciones exentas del diario (la 641) que no están en ninguna nómina por trabajador',
    })
  })
})

describe('el 180: los arrendadores y su local', () => {
  const local: Inmueble180 = { situacion: '1', catastral: '0000000AA0000A0001AA', tipo_via: 'CL', nombre_via: 'Calle de Prueba', tipo_numeracion: 'NUM', numero: '12',
    planta: 'BJ', puerta: null, municipio: 'Madrid', codigo_municipio: null, provincia: '28', cp: '28001' }
  const a = (o: Partial<Perceptor180>): Perceptor180 => ({ perceptor: 'x', proveedor: 'p', nif: '00000000T', nombre: 'Uno', provincia: '28', nif_valido: true,
    base: 1000, porcentaje: 19, retenciones: 190, inmueble: local, ...o })
  it('el que no tiene local va arriba, con su etiqueta; no se esconde ninguno', () => {
    const r = arrendadoresEnOrden([a({ nombre: 'Bien' }), a({ nombre: 'Sin local', inmueble: null })])
    expect(r.map((x) => x.nombre)).toEqual(['Sin local', 'Bien'])
    expect(r[0].falta).toEqual(['sin el local'])
  })
  it('el local en una línea, y el porcentaje con coma', () => {
    expect(inmuebleEnPalabras(local)).toBe('CL Calle de Prueba 12, planta BJ, 28001 Madrid · con referencia catastral 0000000AA0000A0001AA')
    expect(inmuebleEnPalabras({ ...local, situacion: '4', catastral: null, planta: null })).toBe('CL Calle de Prueba 12, 28001 Madrid · sin referencia catastral')
    expect(porcentajeEnPalabras(19)).toBe('19 %')
    expect(porcentajeEnPalabras(19.5)).toBe('19,5 %')
  })
  it('lo que falta para guardar el local, como lo comprueba la base', () => {
    expect(faltaEnInmueble(local)).toEqual([])
    expect(faltaEnInmueble({ situacion: '1', nombre_via: 'X', municipio: 'Y', provincia: '28', cp: '2800' })).toEqual(['la referencia catastral (20 letras y cifras)', 'el código postal'])
    expect(faltaEnInmueble({ situacion: '4', nombre_via: 'X', municipio: 'Y', provincia: '54', cp: '28001' })).toEqual(['la provincia'])
  })
})
