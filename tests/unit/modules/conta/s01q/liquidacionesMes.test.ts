// tests/unit/modules/conta/s01q/liquidacionesMes.test.ts
//
// S01q · PR C · Lo que enseña Ventas › Liquidaciones mes a mes
// (src/modules/conta/lib/liquidacionesMes.ts). Regla 31: contra el mes de
// verdad, octubre de 2026 de Foodint, leído de producción el 03/11 con
// conta_liquidaciones_mes y con los nombres cambiados (tiendas, marcas, locales
// y frases: T11). Sus cifras y sus estados son los de la base.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SIN_LOCAL, agrupar, barra, cuenta, filasExcel, fraseResumen, importe, mesDesdeBase, mesInicial, moverMes, nombreMes, opciones, periodoCorto, piezas,
} from '@/modules/conta/lib/liquidacionesMes'

const OCTUBRE = mesDesdeBase(JSON.parse(readFileSync('tests/unit/modules/conta/s01q/fixtures/octubre-2026.json', 'utf8')))
const TODO = { plataforma: null, local: null, soloTeNecesita: false }

describe('el mes de verdad: octubre de 2026', () => {
  it('lee las 72 filas con sus cuatro estados y el estado del motor (no el de cuatro)', () => {
    expect(OCTUBRE.filas).toHaveLength(72)
    const c = (e: string) => OCTUBRE.filas.filter((f) => f.estado === e).length
    expect([c('completa'), c('aun_no_toca'), c('te_necesita'), c('no_cuadra')]).toEqual([5, 19, 38, 10])
    // El motor guarda SU estado: una «completa» es «cuadra» en el motor, nunca «diferencia» por no reconocerlo.
    for (const f of OCTUBRE.filas.filter((x) => x.estado === 'completa')) expect(f.motor.estado).toBe('cuadra')
    for (const f of OCTUBRE.filas.filter((x) => x.estado === 'no_cuadra')) expect(f.motor.estado).toBe('diferencia')
  })

  it('cada fila que te necesita o no cuadra lleva su botón, y las demás ninguno', () => {
    for (const f of OCTUBRE.filas) {
      if (f.estado === 'te_necesita' || f.estado === 'no_cuadra') expect(f.accion, f.clave).not.toBeNull()
      else expect(f.accion, f.clave).toBeNull()
    }
    expect(OCTUBRE.filas.filter((f) => f.accion === 'pidela')).toHaveLength(31)
    expect(OCTUBRE.filas.filter((f) => f.accion === 'subela')).toHaveLength(7)
    expect(OCTUBRE.filas.filter((f) => f.accion === 'ver_por_que')).toHaveLength(10)
  })

  it('la frase y la barra cuentan el mes entero', () => {
    expect(fraseResumen(OCTUBRE.mes, OCTUBRE.resumen)).toBe('Octubre: 5 de 72 completas · 19 aún no toca · 38 te necesitan · 10 no cuadran')
    expect(barra(OCTUBRE.resumen).reduce((t, x) => t + x.n, 0)).toBe(72)
  })

  it('agrupar no pierde ninguna fila (regla 7) y pone primero lo peor', () => {
    const g = agrupar(OCTUBRE.filas, TODO)
    expect(g.reduce((t, x) => t + x.filas.length, 0)).toBe(72)
    expect(new Set(g.flatMap((x) => x.filas.map((f) => f.clave))).size).toBe(72)
    expect(g.map((x) => x.canal).sort()).toEqual(['Glovo', 'JustEat', 'Uber'])
    const orden = { no_cuadra: 0, te_necesita: 1, aun_no_toca: 2, completa: 3 }
    for (const p of g) {
      const peores = p.tiendas.map((t) => Math.min(...t.filas.map((f) => orden[f.estado])))
      expect(peores).toEqual([...peores].sort((a, b) => a - b))
    }
  })

  it('«Solo lo que te necesita» deja las 48 que piden algo', () => {
    const g = agrupar(OCTUBRE.filas, { ...TODO, soloTeNecesita: true })
    expect(g.reduce((t, x) => t + x.filas.length, 0)).toBe(48)
  })

  it('el filtro de local: cada local suma lo suyo, y todos juntos el mes', () => {
    const op = opciones(OCTUBRE.filas)
    const porLocal = op.locales.map((l) => agrupar(OCTUBRE.filas, { ...TODO, local: l.id }).reduce((t, x) => t + x.filas.length, 0))
    const sinLocal = agrupar(OCTUBRE.filas, { ...TODO, local: SIN_LOCAL }).reduce((t, x) => t + x.filas.length, 0)
    const sinLocalId = OCTUBRE.filas.filter((f) => !f.sinLocal && !f.motor.localId).length
    expect(porLocal.reduce((a, b) => a + b, 0) + sinLocal + sinLocalId).toBe(72)
  })

  it('las piezas: una completa tiene las cuatro, y ninguna pieza dice «?» si la tienda tiene local', () => {
    for (const f of OCTUBRE.filas) {
      const p = piezas(f)
      expect(p.map((x) => x.nombre)).toEqual(['Vendido', 'Liquidación', 'Factura', 'Cobro'])
      if (f.estado === 'completa') expect(p.map((x) => x.valor).slice(1)).toEqual(['✓', '✓', '✓'])
      if (!f.sinLocal) expect(p[0].valor).not.toBe('?')
      if (f.accion === 'pidela') expect(p[1].valor).toBe('falta')
      if (f.accion === 'subela') expect(p[2].valor).toBe('falta')
      if (f.estado === 'no_cuadra') expect(p[1].tono).toBe('mal')
    }
  })

  it('el importe es lo que te pagan, solo si ha llegado su liquidación', () => {
    for (const f of OCTUBRE.filas) {
      if (f.motor.liquidacion.n === 0) expect(importe(f)).toBeNull()
      else expect(importe(f)).toBe(f.motor.liquidacion.pagan)
    }
  })

  it('el Excel: una fila por periodo, con su cabecera', () => {
    const x = filasExcel(OCTUBRE)
    expect(x).toHaveLength(73)
    expect(x[0][0]).toBe('Plataforma')
    expect(new Set(x.slice(1).map((r) => r[6]))).toEqual(new Set(['Completa', 'Aún no toca', 'Te necesita', 'No cuadra']))
  })
})

describe('el mes y sus palabras', () => {
  it('abre el mes de hoy, o el anterior del 1 al 5', () => {
    expect(mesInicial('2026-11-03')).toBe('2026-10-01')
    expect(mesInicial('2026-11-05')).toBe('2026-10-01')
    expect(mesInicial('2026-11-06')).toBe('2026-11-01')
    expect(mesInicial('2026-01-02')).toBe('2025-12-01')
  })
  it('mueve el mes, también de un año a otro', () => {
    expect(moverMes('2026-01-01', -1)).toBe('2025-12-01')
    expect(moverMes('2026-12-01', 1)).toBe('2027-01-01')
    expect(nombreMes('2026-10-01')).toBe('Octubre 2026')
  })
  it('el periodo corto', () => {
    expect(periodoCorto('2026-10-01', '2026-10-15')).toBe('1–15 oct')
    expect(periodoCorto('2026-09-28', '2026-10-04')).toBe('28 sep–4 oct')
    expect(periodoCorto('2026-10-03', '2026-10-03')).toBe('3 oct')
  })
  it('la frase de un mes completo y la de uno vacío', () => {
    expect(fraseResumen('2026-10-01', { total: 42, completa: 42, aunNoToca: 0, teNecesita: 0, noCuadra: 0 })).toBe('Octubre: completo · 42 de 42 periodos con sus cuatro piezas')
    expect(fraseResumen('2026-10-01', { total: 0, completa: 0, aunNoToca: 0, teNecesita: 0, noCuadra: 0 })).toBe('Octubre: aún no hay ningún periodo')
  })
  it('la cuenta de una tienda y de una plataforma, como en la maqueta', () => {
    const f = (estado: 'completa' | 'aun_no_toca' | 'te_necesita') => ({ ...OCTUBRE.filas[0], estado })
    expect(cuenta([f('completa'), f('completa')])).toBe('2 de 2')
    expect(cuenta([f('completa'), f('completa')], true)).toBe('2 de 2 completas')
    expect(cuenta([f('completa'), f('aun_no_toca')])).toBe('1 completa · 1 aún no toca')
    expect(cuenta([f('te_necesita'), f('te_necesita')])).toBe('0 de 2 · 2 te necesitan')
  })
})
