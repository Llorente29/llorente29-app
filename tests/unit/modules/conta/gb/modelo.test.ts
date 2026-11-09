// GB · El modelo de la pestaña «Sumied» en Bitrix24 (src/publicas/bitrixPestanaModelo.ts).
// Lo que llega del servidor tiene la forma de conta_pantalla_clientes y
// conta_pantalla_ficha (en snake_case, como las devuelve la base). Pasa por
// el MISMO modelo de la ficha del G04: se comprueba que dice lo mismo.
// Clientes, NIF de ceros e importes inventados (T11).
import { describe, expect, it } from 'vitest'
import { datosDeClientes, datosDeFicha, FRASE_DE, leerAlmohadilla, modeloPestana } from '@/publicas/bitrixPestanaModelo'
import { modeloFicha } from '@/modules/conta/gestoria/g04/modelo'

import { clientes, ficha, Q, respuesta } from '../../../../e2e/conta/gb/respuesta'

const HOY = '2026-11-09'

describe('GB · la pestaña dice lo mismo que la ficha de Sumied', () => {
  it('el recibo de diciembre línea a línea, con el mismo total que el G04', () => {
    const p = modeloPestana(respuesta(), HOY)!
    const g04 = modeloFicha(datosDeClientes(clientes), datosDeFicha(ficha), [{ id: Q, nombre: 'QBO Prueba' }], '1', null, HOY,
      [{ id: 'd1', tipo: 'totales_distintos', porque: ficha.pendientes[0].porque }])!
    expect([p.mesRecibo, p.totalRecibo]).toEqual(['diciembre de 2026', '496,10 €'])
    expect(p.totalRecibo).toBe(g04.totalRecibo)
    expect(p.recibo.map((l) => [l.texto, l.importe])).toEqual(g04.recibo.map((l) => [l.texto, l.importe]))
    expect(p.recibo[1].detalle).toBe('18 × 24,20 € · este mes: ninguna alta, ninguna baja')
  })
  it('el cliente, su situación y quién le factura', () => {
    const p = modeloPestana(respuesta(), HOY)!
    expect([p.cliente, p.situacion, p.emisora, p.desde, p.personaDeContacto]).toEqual(['Cliente Prueba, S.L.', { texto: 'Activo', tono: 'bien' }, 'QBO Prueba', 'Cobra desde enero de 2020', false])
    expect(modeloPestana(respuesta({ de_empresa: '99001' }), HOY)!.personaDeContacto).toBe(true)
  })
  it('los últimos cobros (cuatro a la vista), el devuelto y el mandato', () => {
    const p = modeloPestana(respuesta(), HOY)!
    expect(p.cobros.map((c) => [c.fecha, c.estado])).toEqual([['4 nov. 2026', 'Cobrado'], ['4 oct. 2026', 'Devuelto'], ['4 sept. 2026', 'Cobrado'], ['4 ago. 2026', 'Cobrado']])
    expect(p.hayMasCobros).toBe(1)
    expect(p.mandato).toEqual({ texto: 'firmado', tono: 'bien' })
  })
  it('sus servicios, sus trabajadores y lo pendiente de revisar', () => {
    const p = modeloPestana(respuesta(), HOY)!
    expect(p.servicios.map((s) => [s.texto, s.importe])).toEqual([['Gestoría mensual', '60,50 €'], ['Gestión laboral', '435,60 €']])
    expect(p.trabajadores.length).toBe(18)
    expect(p.trabajadores[0]).toEqual({ nombre: 'Persona Prueba 00', desde: 'Desde enero de 2024', importe: '24,20 €' })
    expect(p.pendientes).toEqual([{ porque: 'GoCardless cobra 496,10 € y Sumied calcula otra cifra.' }])
  })
  it('un cliente con un recibo devuelto lo dice arriba', () => {
    const p = modeloPestana(respuesta({ cliente: '2', cliente_nombre: 'Cliente Dos' }), HOY)!
    expect(p.aviso?.tono).toBe('mal')
    expect(p.aviso?.texto).toMatch(/^Tiene un recibo devuelto sin cobrar: 108,90 €\.$/)
  })
  it('un cliente que no sale en Clientes: nada', () => {
    expect(modeloPestana(respuesta({ cliente: '99' }), HOY)).toBeNull()
    expect(modeloPestana(respuesta({ cliente: '' }), HOY)).toBeNull()
  })
})

describe('GB · lo que llega detrás del «#» y las frases', () => {
  it('el token, el portal y la ficha', () => {
    expect(leerAlmohadilla('#a=abcdef0123456789&p=b24-s3mr2y.bitrix24.es&t=empresa&id=123'))
      .toEqual({ a: 'abcdef0123456789', p: 'b24-s3mr2y.bitrix24.es', t: 'empresa', id: '123', instalar: null, que: null })
  })
  it('sin acceso, lo dice el encargo, palabra por palabra; y ningún código interno', () => {
    expect(FRASE_DE.sin_acceso).toBe('Pide acceso a Sumied a tu administrador.')
    for (const f of Object.values(FRASE_DE)) expect(f).not.toMatch(/_|rpc|jwt|token|uuid|placement/i)
  })
})
