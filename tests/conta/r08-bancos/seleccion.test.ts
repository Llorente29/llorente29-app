// tests/conta/r08-bancos/seleccion.test.ts
//
// R08 · Conciliar en un paso: el estado en una palabra, marcar varios (Espacio, Mayús ↑ ↓, la
// cabecera), los asientos que van al diario (uno por movimiento), lo que dice al acabar y los
// mensajes en palabras. Datos inventados (nóminas «Empleada A»…).
import { describe, expect, it } from 'vitest'
import { alternar, asientosQueVan, avisoMezcla, contraElBanco, cuantos, enPalabras, losMarcados, marcarSeguidos, marcarTodos, palabraDe, sumaMarcados, textoConciliados } from '@/modules/conta/nucleo/bancos/seleccion'
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

describe('marcar varios', () => {
  it('Espacio marca y desmarca; lo conciliado o apartado no se marca', () => {
    let s = alternar(new Set(), nominas[0])
    expect([...s]).toEqual(['a'])
    s = alternar(s, nominas[0])
    expect(s.size).toBe(0)
    expect(alternar(new Set(), rejilla[5]).size).toBe(0)
    expect(alternar(new Set(), rejilla[6]).size).toBe(0)
  })
  it('Mayús ↓ desde la primera hasta la séptima marca las cinco nóminas y salta lo conciliado', () => {
    expect([...marcarSeguidos(new Set(), rejilla, 0, 6)]).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect([...marcarSeguidos(new Set(), rejilla, 3, 1)].sort()).toEqual(['b', 'c', 'd'])
  })
  it('la cabecera marca todos los que se pueden conciliar, y a la segunda, ninguno', () => {
    const todos = marcarTodos(new Set(), rejilla)
    expect([...todos]).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(marcarTodos(todos, rejilla).size).toBe(0)
  })
  it('lo marcado que ya se ha conciliado deja de contar', () => {
    const tras = rejilla.map((x) => (x.id === 'b' ? { ...x, estado: 'casado' as const } : x))
    expect(losMarcados(tras, new Set(['a', 'b', 'c'])).map((x) => x.id)).toEqual(['a', 'c'])
  })
})

describe('los asientos que van al diario', () => {
  it('cinco nóminas a la 46500000: cinco asientos, cada uno la cuenta al debe y el banco al haber, 6.119,71 entre todos', () => {
    const v = asientosQueVan(nominas, '46500000')
    expect(v).toHaveLength(5)
    expect(v.every((a) => a.lado === 'al debe' && a.cuenta === '46500000')).toBe(true)
    expect(v.reduce((t, a) => t + a.importeCent, 0)).toBe(611971)
    expect(v[0]).toMatchObject({ texto: 'Nómina · Empleada A', importeCent: 101206 })
    expect(contraElBanco(nominas, '57200001')).toBe('Cada uno, contra el banco (57200001) al haber.')
    expect(sumaMarcados(nominas)).toEqual({ cent: 611971, texto: '5 pagos marcados' })
  })
  it('pagos e ingresos mezclados: cada uno con su signo; a un proveedor o a un cliente, se dice antes', () => {
    const mezcla = [nominas[0], m('i', 100)]
    expect(asientosQueVan(mezcla, '55500000').map((a) => a.lado)).toEqual(['al debe', 'al haber'])
    expect(contraElBanco(mezcla, '57200001')).toBe('Cada uno, contra el banco (57200001): los pagos, al haber; los ingresos, al debe.')
    expect(avisoMezcla(mezcla, '40000501')).toMatch(/^Hay un ingreso entre los marcados y la 40000501 es de un proveedor/)
    expect(avisoMezcla(mezcla, '43000501')).toMatch(/^Hay un pago entre los marcados y la 43000501 es de un cliente/)
    expect(avisoMezcla(mezcla, '55500000')).toBe('Hay pagos e ingresos entre los marcados: cada uno va a la 55500000 con su signo.')
    expect(avisoMezcla(nominas, '40000501')).toBeNull()
  })
})

describe('lo que se dice', () => {
  it('al conciliar cinco: «5 movimientos a la 46500000 · 6.119,71 € · en el diario»', () => {
    expect(textoConciliados({ bien: 5, cuenta: '46500000', importeCent: 611971, mal: [] })).toBe('5 movimientos a la 46500000 · 6.119,71 € · en el diario.')
    expect(textoConciliados({ bien: 4, cuenta: '46500000', importeCent: 480529, mal: ['Nómina · Empleada E: no se puede'] }))
      .toBe('4 movimientos a la 46500000 · 4.805,29 € · en el diario. Uno no: Nómina · Empleada E: no se puede')
    expect(textoConciliados({ bien: 2, cuenta: '', importeCent: 2090, mal: [] })).toBe('2 movimientos, cada uno a su cuenta · 20,90 € · en el diario.')
    expect(textoConciliados({ bien: 1, cuenta: '', importeCent: 1250, mal: [] })).toBe('1 movimiento a su cuenta · 12,50 € · en el diario.')
  })
  it('los mensajes de la base, sin nombres de función ni «casar» ni «ignorado»', () => {
    expect(enPalabras('bank_casar: Ese movimiento está ignorado.')).toBe('Ese movimiento está apartado.')
    expect(enPalabras('Este movimiento ya está casado: cada movimiento se casa una sola vez.')).toBe('Este movimiento ya está conciliado: cada movimiento se concilia una sola vez.')
    expect(enPalabras('bank_deshacer: Ese casado ya está deshecho.')).toBe('Ese movimiento conciliado ya está deshecho.')
    expect(enPalabras('La factura X ya tiene casados 10,00 € de 10,00 €: este pago la pasaría.')).toBe('La factura X ya tiene conciliados 10,00 € de 10,00 €: este pago la pasaría.')
  })
})
