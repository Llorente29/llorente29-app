// G01 · Tarea 2. El casado Bitrix24 ↔ cada cuenta de GoCardless: por NIF y,
// si no, por correo; el emisor lo dice la cuenta; lo que no casa sale con su
// porqué. Todo inventado (T11).
import { describe, expect, it } from 'vitest'
import { casar, type ClienteParaCasar, type FichaParaCasar } from '../../../../../supabase/functions/conta-gocardless-leer/casado'

const ficha = (bitrixId: string, extra: Partial<FichaParaCasar> = {}): FichaParaCasar => ({
  bitrixId, nombre: `CLIENTE PRUEBA ${bitrixId}`, nif: null, correos: [], situacion: 'activo', formaPago: null, emisorSegunBitrix: null, ...extra,
})
const cliente = (emisor: string, id: string, extra: Partial<ClienteParaCasar> = {}): ClienteParaCasar => ({
  emisor, id, nombre: `Cliente ${id}`, nif: null, correo: null, mandatosVivos: 1, suscripcionesActivas: 1, ...extra,
})
const NOMBRES: Record<string, string> = { a: 'EMISOR A DE PRUEBA, S.L.', b: 'Emisor B de prueba' }
const nombre = (e: string) => NOMBRES[e] ?? e

describe('G01 · casado de clientes', () => {
  it('casa por NIF', () => {
    const r = casar([ficha('1', { nif: 'B00000001' })], [cliente('a', 'CU1', { nif: 'B00000001' })], nombre)
    expect(r.parejas).toEqual([{ bitrixId: '1', emisor: 'a', clienteGcId: 'CU1', por: 'nif' }])
    expect(r.diferencias).toEqual([])
  })

  it('un NIF que no casa y un correo que sí: casa por el correo y dice que los NIF no coinciden', () => {
    const r = casar(
      [ficha('1', { nif: 'B00000001', correos: ['uno@prueba.test'] })],
      [cliente('a', 'CU1', { nif: 'B00000002', correo: 'uno@prueba.test' })], nombre)
    expect(r.parejas).toEqual([{ bitrixId: '1', emisor: 'a', clienteGcId: 'CU1', por: 'correo' }])
    expect(r.diferencias).toEqual([{ tipo: 'nif_distinto', bitrixId: '1', emisor: 'a', clienteGcId: 'CU1',
      porque: 'Casado por el correo: Bitrix24 dice NIF B00000001 y GoCardless B00000002.' }])
  })

  it('un cliente en la cuenta de B que en Bitrix24 dice A: el emisor es B y sale la diferencia', () => {
    const r = casar(
      [ficha('1', { nif: 'B00000001', formaPago: 'Emisor A', emisorSegunBitrix: 'a' })],
      [cliente('b', 'CU7', { nif: 'B00000001' })], nombre)
    expect(r.parejas[0]).toMatchObject({ emisor: 'b' })
    expect(r.diferencias).toEqual([{ tipo: 'emisor_distinto', bitrixId: '1', emisor: 'b', clienteGcId: 'CU7',
      porque: 'Bitrix24 dice que paga a EMISOR A DE PRUEBA, S.L. («Emisor A») y GoCardless le cobra desde Emisor B de prueba.' }])
  })

  it('un cliente que paga a los dos emisores casa con los dos', () => {
    const r = casar([ficha('1', { nif: 'B00000001' })], [cliente('a', 'CU1', { nif: 'B00000001' }), cliente('b', 'CU9', { nif: 'B00000001' })], nombre)
    expect(r.parejas.map((p) => p.emisor)).toEqual(['a', 'b'])
  })

  it('en Bitrix24 sin cobro y en GoCardless sin ficha; lo de baja no espera cobro', () => {
    const r = casar(
      [ficha('1', { nif: 'B00000001' }), ficha('2', { nif: 'B00000002', situacion: 'baja' })],
      [cliente('a', 'CU5', { nif: 'B00000005' }), cliente('a', 'CU6', { nif: 'B00000006', mandatosVivos: 0, suscripcionesActivas: 0 })], nombre)
    expect(r.parejas).toEqual([])
    expect(r.diferencias.map((d) => [d.tipo, d.bitrixId ?? d.clienteGcId])).toEqual([
      ['gocardless_sin_ficha', 'CU5'],
      ['bitrix_sin_cobro', '1'],
    ])
  })

  it('casado pero sin cobro mensual también es «en Bitrix24 sin cobro», con otra frase', () => {
    const r = casar([ficha('1', { nif: 'B00000001' })], [cliente('a', 'CU1', { nif: 'B00000001', suscripcionesActivas: 0 })], nombre)
    expect(r.diferencias).toEqual([{ tipo: 'bitrix_sin_cobro', bitrixId: '1', emisor: null, clienteGcId: null,
      porque: '«CLIENTE PRUEBA 1» está activo en Bitrix24 y está en GoCardless, pero sin ningún cobro mensual.' }])
  })

  it('un NIF en dos fichas no casa con ninguna: lo dice una vez', () => {
    const r = casar([ficha('1', { nif: 'B00000001' }), ficha('2', { nif: 'B00000001' })],
      [cliente('a', 'CU1', { nif: 'B00000001' }), cliente('b', 'CU2', { nif: 'B00000001' })], nombre)
    expect(r.parejas).toEqual([])
    expect(r.diferencias.filter((d) => d.tipo === 'nif_repetido_en_bitrix')).toHaveLength(1)
  })
})
