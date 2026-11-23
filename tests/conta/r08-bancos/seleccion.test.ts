// tests/conta/r08-bancos/seleccion.test.ts
//
// R08 · Conciliar en un paso: el estado en una palabra y los mensajes en palabras. Datos inventados.
// X28: «marcar varios» y «Conciliar los N» se quitaron con su código (respuesta X28 · 1, decisión 3).
import { describe, expect, it } from 'vitest'
import { cuantos, enPalabras, palabraDe } from '@/modules/conta/nucleo/bancos/seleccion'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'

const m = (id: string, importe: number, estado: MovimientoBanco['estado'] = 'por_aclarar', concepto = `Movimiento ${id}`): MovimientoBanco => ({
  id, cuentaId: 'b', fecha: '2026-11-19', importeCent: Math.round(importe * 100), conceptoBanco: concepto.toUpperCase(), conceptoLimpio: concepto,
  estado, confianza: null, porque: null, propuesta: null, casado: null, tarjeta: null, ticket: null, motivoIgnorado: null,
})
const nominas = [m('a', -1012.06, 'por_aclarar', 'Nómina · Empleada A'), m('b', -1231.86, 'por_aclarar', 'Nómina · Empleado B'), m('c', -1126.42, 'por_aclarar', 'Nómina · Empleada C'),
  m('d', -1434.43, 'por_aclarar', 'Nómina · Empleada D'), m('e', -1314.94, 'por_aclarar', 'Nómina · Empleada E')]
const rejilla = [...nominas, m('t', 2325, 'casado', 'Traspaso desde la segunda cuenta'), m('r', -31.50, 'ignorado', 'Recibo Telefonía Ejemplo'), m('g', -35.70, 'casado', 'Restaurante Ejemplo')]

describe('el estado, en una palabra', () => {
  it('Por conciliar, Conciliado o Apartado', () => {
    expect(['pendiente', 'propuesto', 'por_aclarar', 'posible_repetido', 'antes_corte_sin_pareja', 'casado', 'ignorado'].map((e) => palabraDe({ estado: e as MovimientoBanco['estado'] })))
      .toEqual(['Por conciliar', 'Por conciliar', 'Por conciliar', 'Por conciliar', 'Por conciliar', 'Conciliado', 'Apartado'])
  })
  it('la cabecera: «5 por conciliar · 2 conciliados · 1 apartado»', () => {
    expect(cuantos(rejilla).texto).toBe('5 por conciliar · 2 conciliados · 1 apartado')
  })
})

describe('lo que se dice', () => {
  it('los mensajes de la base, sin nombres de función ni «casar» ni «ignorado»', () => {
    expect(enPalabras('bank_casar: Ese movimiento está ignorado.')).toBe('Ese movimiento está apartado.')
    expect(enPalabras('Este movimiento ya está casado: cada movimiento se casa una sola vez.')).toBe('Este movimiento ya está conciliado: cada movimiento se concilia una sola vez.')
    expect(enPalabras('bank_deshacer: Ese casado ya está deshecho.')).toBe('Ese movimiento conciliado ya está deshecho.')
    expect(enPalabras('La factura X ya tiene casados 10,00 € de 10,00 €: este pago la pasaría.')).toBe('La factura X ya tiene conciliados 10,00 € de 10,00 €: este pago la pasaría.')
  })
})
