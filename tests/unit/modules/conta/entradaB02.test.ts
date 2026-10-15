// tests/unit/modules/conta/entradaB02.test.ts
//
// B02 · Lo que entra, legible: la contraparte limpia (igual en el front y en la
// base), el tipo de movimiento aparte y el aviso cuando el Norma 43 no trae el
// detalle. Datos INVENTADOS.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { limpiarContraparte } from '@/modules/conta/lib/extractoBanco'
import { avisoSinDetalle, escribirNorma43, leerNorma43 } from '@/modules/conta/lib/norma43'

/** Los ejemplos de la prueba de staging de la 0200: la MISMA regla en la base y aquí. */
function ejemplosDeStaging(): [string, string | null][] {
  const sql = readFileSync('supabase/staging/sql/20261101_b02_entrada_prueba.sql', 'utf8')
  const bloque = sql.slice(sql.indexOf('insert into _ejemplos values'), sql.indexOf(';', sql.indexOf('insert into _ejemplos values')))
  return [...bloque.matchAll(/\('((?:[^']|'')*)', (?:'((?:[^']|'')*)'|null)\)/g)].map((m) => [m[1].replace(/''/g, "'"), m[2] === undefined ? null : m[2].replace(/''/g, "'")])
}

describe('la contraparte limpia: la misma regla que _bank_contraparte_limpia (0200)', () => {
  const ejemplos = ejemplosDeStaging()
  it('lee los ejemplos de la prueba de staging (si no, no prueba nada)', () => {
    expect(ejemplos.length).toBeGreaterThanOrEqual(10)
  })
  it.each(ejemplos)('«%s» → %s', (entrada, salida) => {
    expect(limpiarContraparte(entrada)).toBe(salida)
  })
})

const cuenta = (movimientos: { fecha: string; importeCent: number; comun: string; propio?: string; concepto: string }[]) =>
  escribirNorma43([{ entidad: '0182', oficina: '0937', cuenta: '0200000001', nombre: 'PRUEBA', desde: '2026-10-01', hasta: '2026-10-09', saldoInicialCent: 100_000, movimientos }])

describe('Norma 43: el tipo aparte, la contraparte de los 23 y el aviso sin detalle', () => {
  it('con complementarios: la contraparte sale del 23; el tipo, del concepto común; el concepto nunca se rellena con el tipo', () => {
    const e = leerNorma43(cuenta([
      { fecha: '2026-10-02', importeCent: -24_861, comun: '04', propio: '163', concepto: 'DISTRIBUCIONES INVENTADAS PAGO FACT 101' },
      { fecha: '2026-10-03', importeCent: -1_000, comun: '17', concepto: '' },
    ]))
    const [a, b] = e.cuentas[0].movimientos
    expect(a).toMatchObject({ conceptoBanco: 'DISTRIBUCIONES INVENTADAS PAGO FACT 101', contraparte: 'Distribuciones Inventadas Pago Fact 101', tipoMovimiento: 'Giros, transferencias, traspasos, cheques' })
    expect(b).toMatchObject({ conceptoBanco: '', contraparte: null, tipoMovimiento: 'Intereses, comisiones, custodia, gastos e impuestos' })
    expect(avisoSinDetalle(e)).toBe('1 de 2 movimientos no dice a quién pagas o quién te paga. Pide a tu banco la Norma 43 con conceptos complementarios; en BBVA, descárgalo desde Firmas.')
  })
  it('cuando los 23 solo repiten la etiqueta del banco (el de «extracto» de BBVA): esa etiqueta es el tipo, y no hay contraparte', () => {
    const movs = Array.from({ length: 6 }, (_, i) => ({ fecha: `2026-10-0${i + 1}`, importeCent: -1_000 - i, comun: '99', propio: '956', concepto: 'COMPRA TARJ. COMERCIO' }))
    const e = leerNorma43(cuenta(movs))
    for (const m of e.cuentas[0].movimientos) expect(m).toMatchObject({ conceptoBanco: '', contraparte: null, tipoMovimiento: 'COMPRA TARJ. COMERCIO' })
    expect(avisoSinDetalle(e)).toBe('6 de 6 movimientos no dicen a quién pagas o quién te paga. Pide a tu banco la Norma 43 con conceptos complementarios; en BBVA, descárgalo desde Firmas.')
  })
  it('con textos distintos en el mismo código (el de «Firmas»), es detalle de verdad', () => {
    const e = leerNorma43(cuenta([
      { fecha: '2026-10-01', importeCent: -1_000, comun: '99', propio: '956', concepto: 'RECARGAS INVENTADAS' },
      { fecha: '2026-10-02', importeCent: -2_000, comun: '99', propio: '956', concepto: 'KIOSCO DE LA ESQUINA' },
      { fecha: '2026-10-03', importeCent: -3_000, comun: '99', propio: '956', concepto: 'RECARGAS INVENTADAS' },
    ]))
    expect(e.cuentas[0].movimientos.map((m) => m.contraparte)).toEqual(['Recargas Inventadas', 'Kiosco de la Esquina', 'Recargas Inventadas'])
    expect(avisoSinDetalle(e)).toBeNull()
  })
})
