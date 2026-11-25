// tests/conta/x14/negativos.test.ts
//
// X14 · 2 (Julio, 25/11): Sumied admite asientos en negativo, como ERP10. Lo de la pantalla que lo da por hecho:
//   · Traer (paraLaBase): una línea de IVA en negativo se parte por tipos CON SU SIGNO; las sumas del debe y del haber
//     siguen siendo las de ERP10 al céntimo.
//   · El asiento a mano (asientoGeneral): una línea en negativo sube a la lista.
// Datos inventados (T11): el ejemplo de ERP10 de tests/conta/fixtures/importar/erp10, con la B-7 dada la vuelta a negativo.

import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { abrirExcel, leerCarga, paraLaBase, type FicheroExcel } from '@/modules/conta/lib/traer'
import { apunteVacio, problemasDeLaLinea, subirLinea } from '@/modules/conta/nucleo/asiento/asientoGeneral'
import { sumaDeControl } from '@/modules/conta/nucleo/piezas/logica'

const D = 'tests/conta/fixtures/importar/erp10'
const EJEMPLO: readonly FicheroExcel[] = readdirSync(D).filter((f) => f.endsWith('.xlsx')).sort().map((f) => abrirExcel(f, readFileSync(`${D}/${f}`)))

describe('X14 · 2 · Traer: un asiento en negativo entra con su signo', () => {
  // La B-7 (2/2 del 05/02) en negativo, como un abono apuntado en negativo en ERP10; su factura sigue con la cuota en positivo.
  const carga = leerCarga(EJEMPLO)
  const b7 = carga.diario!.asientos.find((a) => a.serie === '2' && a.documento === '2')!
  b7.apuntes = b7.apuntes.map((x) => ({ ...x, debe: -x.debe, haber: -x.haber }))
  const datos = paraLaBase(carga)
  const asiento = datos.asientos.find((a) => a.serie === '2' && a.documento === '2')!

  it('su 472 de −41,00 se parte en −21,00 al 21 % (base −100,00) y −20,00 al 10 % (base −200,00)', () => {
    expect(asiento.apuntes.filter((x) => x.cuenta === '47200000').map((x) => [x.debe, x.haber, x.iva])).toEqual([
      [-2100, 0, { tipo: 21, base: -10000, libro: 'received' }],
      [-2000, 0, { tipo: 10, base: -20000, libro: 'received' }],
    ])
  })

  it('las sumas del debe y del haber de cada cuenta son las de lo leído, al céntimo', () => {
    const sumar = (xs: readonly { cuenta: string; debe: number; haber: number }[]) => {
      const m = new Map<string, [number, number]>()
      for (const x of xs) { const v = m.get(x.cuenta) ?? [0, 0]; m.set(x.cuenta, [v[0] + x.debe, v[1] + x.haber]) }
      return [...m.entries()].sort()
    }
    expect(sumar(asiento.apuntes)).toEqual(sumar(b7.apuntes.map((x) => ({ cuenta: x.subcuenta, debe: x.debe, haber: x.haber }))))
    expect(asiento.apuntes.reduce((s, x) => s + x.debe - x.haber, 0)).toBe(0)
  })
})

describe('X14 · 2 · El asiento a mano admite un importe en negativo', () => {
  const linea = (debe: string, haber: string) => ({ ...apunteVacio('Inventado'), cuentaId: 'c1', codigo: '62800000', debe, haber })
  it('«−70,00» al debe o al haber sube; 0 y 0, o los dos lados, no; lo que no es un número, tampoco', () => {
    expect(problemasDeLaLinea(linea('-70,00', ''))).toEqual([])
    expect(problemasDeLaLinea(linea('', '-70,00'))).toEqual([])
    expect(problemasDeLaLinea(linea('', ''))).toEqual(['un importe, al debe o al haber'])
    expect(problemasDeLaLinea(linea('-1', '-1'))).toEqual(['un importe, al debe o al haber'])
    expect(problemasDeLaLinea(linea('-x', ''))).toEqual(['un importe que sea un número'])
  })
})

describe('X14 · 2 · El asiento a mano en negativo cuadra y propone en negativo', () => {
  const linea = (debe: string, haber: string) => ({ ...apunteVacio('Inventado'), cuentaId: 'c1', codigo: '41000001', debe, haber })
  it('−63,60 al debe propone −63,60 al haber; 63,60 al debe, como siempre, 63,60 al haber', () => {
    expect(subirLinea([], linea('-63,60', ''), null)).toMatchObject({ nueva: { haber: '-63,60', debe: '' }, propuesto: 'haber' })
    expect(subirLinea([], linea('', '-63,60'), null)).toMatchObject({ nueva: { debe: '-63,60', haber: '' }, propuesto: 'debe' })
    expect(subirLinea([], linea('63,60', ''), null)).toMatchObject({ nueva: { haber: '63,60' }, propuesto: 'haber' })
  })
  it('−63,60 al debe y −63,60 al haber cuadra; sin importes, no', () => {
    expect(sumaDeControl([{ debe: -63.6, haber: 0 }, { debe: 0, haber: -63.6 }])).toEqual({ debe: -63.6, haber: -63.6, descuadre: 0, cuadra: true })
    expect(sumaDeControl([{ debe: 0, haber: 0 }]).cuadra).toBe(false)
    expect(sumaDeControl([{ debe: 63.6, haber: 0 }, { debe: 0, haber: 63.6 }]).cuadra).toBe(true)
  })
})
