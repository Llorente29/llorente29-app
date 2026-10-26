// tests/unit/modules/conta/v02/liquidacionesPantalla.test.ts
//
// V02 · Pantallas · Ventas › Liquidaciones (tableros 28 y 29): las piezas, el
// botón, la banda del mes, «Este mes» y «Cuándo te pagan». Los casos son los de
// Foodint medidos en producción el 26/10 (regla 31): el ritmo de Uber (cada
// semana, 1 día), Glovo (cada quincena, 20 días) y Just Eat (cada quincena, 4
// días) de su ficha, y las filas del motor con sus cifras de verdad: Meraki Pita
// Alcalá del 12 al 18/10 (Uber paga 46 pedidos y en caja hay 44: liquida 52,59 €
// de más), una semana cuadrada a falta de su factura y una que aún no ha llegado.

import { describe, expect, it } from 'vitest'
import { filaMotor, type FilaMotor } from '@/modules/conta/lib/liquidacionesMotor'
import {
  accion, banda, cadaCuanto, cuandoPaga, delMes, esteMes, importe, inicial, mesDe, ordenar, periodoCorto, piezas, situacion,
} from '@/modules/conta/lib/liquidacionesPantalla'

const UBER = '1e4057a7-8e30-4398-8797-c17b6c6be49c'
const fila = (x: Record<string, unknown>): FilaMotor => filaMotor({
  clave: String(x.clave ?? Math.random()), intermediario_id: UBER, intermediario: 'Uber Eats', canal_id: 'c', canal: 'Uber', local_id: 'l', local: 'Foodint Alcalá',
  marca_id: 'm', marca: 'Meraki Pita', desde: '2026-10-12', hasta: '2026-10-18', estado: 'cuadra', frase: '', avisos: [], resoluciones: [], liquidaciones: [],
  reclamado_sin_llegar: 0, ...x,
})

// Meraki Pita · Alcalá · 12–18/10: las cifras del motor (0125) en Foodint.
const MERAKI = fila({
  clave: 'meraki', estado: 'diferencia', diferencia: -52.59,
  frase: 'La liquidación dice 1.079,28 € y vendiste 1.026,69 €: liquida 52,59 € de más.',
  piezas: {
    vendido: { via: 'pedidos', total: 1026.69, pedidos: { total: 1026.69, pedidos: 44, dias: 7 } },
    liquidacion: { n: 1, ventas: 1614, pedidos_total: 1079.28, comision: 153.17, pagan: 782.16, otros: 678.67, referencia: false },
    factura: { faltan: 0 }, cobro: { esperado: 782.16, llegado: null, por_cobrar: 1 },
  },
})
// Mila's Sandwiches · Alcalá · 12–18/10: cuadra con la caja, falta su factura de comisión.
const MILAS = fila({
  clave: 'milas', marca: "Mila's Sandwiches", estado: 'falta_factura', frase: 'Falta su factura de comisión: cuando llegue a Compras, se engancha.',
  piezas: {
    vendido: { via: 'pedidos', total: 98.2, pedidos: { total: 98.2, pedidos: 6, dias: 4 } },
    liquidacion: { n: 1, ventas: 98.2, pedidos_total: 98.2, comision: 37.6, pagan: 49.3, otros: 11.3, referencia: false },
    factura: { faltan: 1 }, cobro: { esperado: 49.3, llegado: null, por_cobrar: 1 },
  },
})
// Glovo · Carabanchel · 1–15/10: aún no ha llegado su liquidación.
const GLOVO = fila({
  clave: 'glovo', intermediario: 'Glovo', marca: 'Lovers Burgers', local: 'Foodint Carabanchel', desde: '2026-10-01', hasta: '2026-10-15', estado: 'esperando_liquidacion',
  frase: 'Aún a tiempo: Glovo suele pagar hacia el 04/11.',
  piezas: { vendido: { via: 'pedidos', total: 2310.8, pedidos: { pedidos: 90 } }, liquidacion: { n: 0, ventas: 0, pedidos_total: 0, comision: 0, pagan: null }, factura: { faltan: 0 }, cobro: { por_cobrar: 0 } },
})
// Una de antes del corte: de referencia (la lleva Diez).
const REF = fila({
  clave: 'ref', desde: '2026-09-07', hasta: '2026-09-13', estado: 'cuadra', marca: 'Scandal Burgers',
  piezas: { vendido: { via: 'pedidos', total: 20.4 }, liquidacion: { n: 1, ventas: 15.9, pedidos_total: 20.4, comision: 4, pagan: 12, referencia: true }, factura: { faltan: 0 }, cobro: { por_cobrar: 0 } },
})
const CUADRADA = fila({
  clave: 'ok', marca: 'The Urban Kebab', estado: 'cuadra',
  piezas: { vendido: { via: 'pedidos', total: 51.05 }, liquidacion: { n: 1, ventas: 86, pedidos_total: 51.05, comision: 19.01, pagan: 29.07 }, factura: { faltan: 0 }, cobro: { llegado: 29.07, por_cobrar: 0 } },
})

describe('las cuatro piezas de una tarjeta', () => {
  const tonos = (f: FilaMotor) => piezas(f).map((p) => p.tono)
  it('Meraki: lo vendido no cuadra con lo que suman los pedidos de la liquidación (roja la liquidación)', () => {
    expect(tonos(MERAKI)).toEqual(['ok', 'mal', 'ok', 'falta'])
    expect([situacion(MERAKI), accion(MERAKI)]).toEqual(['no_cuadra', 'ver_por_que'])
  })
  it("Mila's: cuadra con la caja; falta su factura y el cobro (ámbar), y se pide", () => {
    expect(tonos(MILAS)).toEqual(['ok', 'ok', 'falta', 'falta'])
    expect([situacion(MILAS), accion(MILAS)]).toEqual(['falta', 'pedirsela'])
  })
  it('sin liquidación, su factura y su cobro no salen en verde (no se sabe de ellos), y se sube', () => {
    expect(tonos(GLOVO)).toEqual(['ok', 'falta', 'falta', 'falta'])
    expect(accion(GLOVO)).toBe('subirla')
  })
  it('una de referencia, entera en verde, y «Ver»', () => {
    expect(tonos(REF)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect([situacion(REF), accion(REF)]).toEqual(['cuadrada', 'ver'])
  })
  it('el importe: lo que te pagan; sin liquidación, lo vendido', () => {
    expect([importe(MERAKI), importe(GLOVO)]).toEqual([782.16, 2310.8])
  })
})

describe('la banda del mes y «Este mes»', () => {
  const todas = [CUADRADA, MILAS, GLOVO, MERAKI, REF]
  const mes = mesDe('2026-10-26')
  it('las del mes son las de un periodo que toca octubre (la de septiembre, no)', () => {
    expect(mes).toEqual({ desde: '2026-10-01', hasta: '2026-10-31', nombre: 'octubre' })
    expect(delMes(todas, mes).map((f) => f.clave)).toEqual(['ok', 'milas', 'glovo', 'meraki'])
  })
  it('suman todas (regla 7): cuadradas, les falta una pieza y no cuadran; lo pagado, lo vendido y la comisión', () => {
    const b = banda(delMes(todas, mes))
    expect([b.total, b.cuadradas, b.falta, b.noCuadran]).toEqual([4, 1, 2, 1])
    expect([b.pagado, b.vendido, b.comision]).toEqual([860.53, 3486.74, 209.78])
    // La comisión, sobre las ventas de las liquidaciones: 209,78 / 1.798,20.
    expect(b.pct).toBe(11.7)
    // Se pueden pedir la que falta la factura (Mila's); la de Glovo aún está a tiempo.
    expect(b.porPedir).toBe(1)
  })
  it('primero lo que necesita algo: no cuadra, luego le falta una pieza, y al final las cuadradas', () => {
    expect(ordenar([CUADRADA, MILAS, GLOVO, MERAKI]).map((f) => f.clave)).toEqual(['meraki', 'glovo', 'milas', 'ok'])
  })
  it('las que necesitan algo salen todas; las cuadradas que no caben se cuentan («Y N cuadradas más»)', () => {
    const muchas = [MERAKI, MILAS, GLOVO, ...Array.from({ length: 6 }, (_, i) => fila({ ...CUADRADA, clave: `c${i}` }))]
    const e = esteMes(muchas, 5)
    expect(e.vistas.map((f) => f.clave).slice(0, 3)).toEqual(['meraki', 'glovo', 'milas'])
    expect([e.vistas.length, e.cuadradasMas]).toEqual([5, 4])
    // Aunque no quepan, las que necesitan algo no se esconden.
    expect(esteMes([MERAKI, MILAS, GLOVO], 2).vistas).toHaveLength(3)
  })
})

describe('«Cuándo te pagan», con el ritmo de la ficha de cada uno', () => {
  it('Uber Eats: cada semana, al día siguiente del domingo: el lunes', () => {
    expect([cadaCuanto({ cada: 'weekly', dias: 1 }), cuandoPaga({ cada: 'weekly', dias: 1 })]).toEqual(['cada semana', 'el lunes'])
  })
  it('Glovo: cada quincena, 20 días después, con una de retraso', () => {
    expect([cadaCuanto({ cada: 'fortnightly', dias: 20 }), cuandoPaga({ cada: 'fortnightly', dias: 20 })]).toEqual(['cada quincena, con una de retraso', 'hacia el 4 y el 20'])
  })
  it('Just Eat: cada quincena, 4 días después', () => {
    expect([cadaCuanto({ cada: 'fortnightly', dias: 4 }), cuandoPaga({ cada: 'fortnightly', dias: 4 })]).toEqual(['cada quincena', 'hacia el 4 y el 19'])
  })
  it('un mes y sin ritmo', () => {
    expect(cuandoPaga({ cada: 'monthly', dias: 10 })).toBe('hacia el día 10')
    expect([cadaCuanto({ cada: null, dias: null }), cuandoPaga({ cada: null, dias: null })]).toEqual(['sin ritmo todavía', '—'])
  })
})

describe('las palabras de la tarjeta', () => {
  it('el periodo: semana, quincena, mes entero, un día y entre dos meses', () => {
    expect([periodoCorto('2026-10-12', '2026-10-18'), periodoCorto('2026-10-01', '2026-10-15'), periodoCorto('2026-09-01', '2026-09-30'), periodoCorto('2026-10-24', '2026-10-24'), periodoCorto('2026-09-28', '2026-10-04')])
      .toEqual(['semana 12–18 oct', '1–15 oct', 'septiembre', '24 oct', 'semana 28 sep–4 oct'])
  })
  it('la inicial del círculo', () => {
    expect(['Uber Eats', 'Glovo', 'Just Eat', 'Cloudtown Brands', 'Datáfono BBVA'].map(inicial)).toEqual(['UE', 'GL', 'JE', 'CB', 'DB'])
  })
})
