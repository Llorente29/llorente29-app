// tests/unit/modules/supply/ajusteALaBaja.test.ts
//
// La población de estas pruebas NO está inventada: son los OCHO ajustes a la
// baja que hay en Alcalá en 30 días, copiados de la base el 23/09/2026
// (`stock_adjustment`, account 51ad1792…, location 38158159…). Con ejemplos de
// mi cabeza esto sería un espejo (regla 31): confirmaría la regla que lo
// escribió. Con las filas de verdad, seis dan en rojo — y ése es el punto.

import { describe, it, expect } from 'vitest'
import { veredictoDeAjuste, NOTA_MINIMA } from '@/modules/supply/lib/ajusteALaBaja'

/** Una fila real de `stock_adjustment`, tal cual salió de la base. */
interface AjusteReal {
  cuando: string
  articulo: string
  habia: number
  conto: number
  eur: number
  motivo: string
  nota: string | null
}

const LOS_OCHO_DE_ALCALA: AjusteReal[] = [
  { cuando: '11/09 00:10', articulo: 'Bolsas Personalizadas Ay Mamita', habia: 55000, conto: 200, eur: -8891.21, motivo: 'count_correction', nota: null },
  { cuando: '11/09 00:11', articulo: 'Bolsas Personalizadas Birria Burrito', habia: 50000, conto: 200, eur: -8610.12, motivo: 'count_correction', nota: null },
  { cuando: '11/09 00:11', articulo: 'Bolsas Personalizadas Korean', habia: 31750, conto: 100, eur: -5513.36, motivo: 'count_correction', nota: null },
  { cuando: '11/09 00:12', articulo: 'Bolsas Dos Coyotes', habia: 22500, conto: 0, eur: -3835.80, motivo: 'count_correction', nota: null },
  { cuando: '11/09 00:12', articulo: 'Bolsas Personalizadas Chivuos', habia: 12500, conto: 40, eur: -2195.47, motivo: 'count_correction', nota: null },
  { cuando: '05/09 14:07', articulo: 'Coca-Cola Original Lata', habia: 1440, conto: 60, eur: -576.13, motivo: 'count_correction', nota: null },
  { cuando: '01/09 23:36', articulo: 'MARQUESA DULCE DE LECHE', habia: 552, conto: 23, eur: -1379.15, motivo: 'count_correction',
    nota: 'Dos ventas del 01/09 no descontaron: las líneas entraron sin casar con la ficha (alta del producto a medias). Ajuste manual, no es merma.' },
  { cuando: '01/09 23:36', articulo: 'MARQUESA CHOCO - AVELLANA', habia: 23, conto: 22, eur: -2.60, motivo: 'count_correction',
    nota: 'Dos ventas del 01/09 no descontaron: las líneas entraron sin casar con la ficha (alta del producto a medias). Ajuste manual, no es merma.' },
]

const delta = (a: AjusteReal) => a.conto - a.habia

describe('el ajuste a la baja, contra las ocho filas reales de Alcalá', () => {
  it('las SEIS sin nota se rechazan: 29.621,09 € que hoy no se distinguen de una pérdida', () => {
    const sinNota = LOS_OCHO_DE_ALCALA.filter(a => a.nota == null)
    expect(sinNota).toHaveLength(6)

    for (const a of sinNota) {
      const v = veredictoDeAjuste(delta(a), a.motivo, a.nota)
      expect(v.ok, `${a.cuando} ${a.articulo} tendría que pedir nota`).toBe(false)
      expect(v.vaAMerma).toBe(false)
      expect(v.motivo).toMatch(/nota|caracteres/i)
    }

    // Sin `.toFixed()`: la casa lo prohíbe sobre datos que pueden venir nulos
    // y no merece la pena un `eslint-disable` para una suma de literales.
    const eurTapados = sinNota.reduce((s, a) => s + a.eur, 0)
    expect(Math.round(eurTapados * 100) / 100).toBe(-29622.09)
  })

  it('las DOS que sí explicaron lo suyo pasan sin fricción', () => {
    const conNota = LOS_OCHO_DE_ALCALA.filter(a => a.nota != null)
    expect(conNota).toHaveLength(2)
    for (const a of conNota) {
      expect(veredictoDeAjuste(delta(a), a.motivo, a.nota).ok,
        `${a.cuando} ${a.articulo} ya decía por qué`).toBe(true)
    }
  })

  it('el caso que canta el error de unidad: 1.440 latas = 60 × 24', () => {
    const cola = LOS_OCHO_DE_ALCALA.find(a => a.articulo.startsWith('Coca-Cola'))!
    expect(cola.habia / cola.conto).toBe(24)          // una caja contada como unidades
    expect(veredictoDeAjuste(delta(cola), cola.motivo, null).ok).toBe(false)
    // Y con la explicación delante, pasa:
    expect(veredictoDeAjuste(delta(cola), cola.motivo,
      'Estaban en cajas de 24, no en unidades').ok).toBe(true)
  })
})

describe('las reglas preventivas: hoy no cambian ni una fila, y aun así van', () => {
  // Medido a 90 días: 0 bajadas con `other`, 0 movimientos con waste/expired.
  it('«Otro» no vale para bajar', () => {
    const v = veredictoDeAjuste(-10, 'other', 'lo que sea que escriba aquí')
    expect(v.ok).toBe(false)
    expect(v.motivo).toMatch(/motivo de verdad/i)
  })

  it('merma y caducado mandan a la pantalla de Merma, no se guardan como ajuste', () => {
    for (const m of ['waste', 'expired']) {
      const v = veredictoDeAjuste(-10, m, 'tirado a la basura')
      expect(v.ok).toBe(false)
      expect(v.vaAMerma, `${m} tiene que ir a Merma`).toBe(true)
    }
  })
})

describe('lo que NO se toca', () => {
  it('los ajustes al alza pasan siempre, con cualquier motivo y sin nota', () => {
    for (const m of ['other', 'waste', 'expired', 'count_correction', 'direct_receipt']) {
      expect(veredictoDeAjuste(+100, m, null).ok, `al alza con ${m}`).toBe(true)
    }
  })

  it('un ajuste sin cambio (delta 0) no exige nada', () => {
    expect(veredictoDeAjuste(0, 'other', null).ok).toBe(true)
  })

  it('sin cantidad todavía no se le grita al operario', () => {
    expect(veredictoDeAjuste(null, '', null).ok).toBe(true)
  })

  it('los otros motivos a la baja no piden nota: el encargo solo la pide en count_correction', () => {
    for (const m of ['recipe_error', 'staff_use', 'transfer', 'direct_receipt']) {
      expect(veredictoDeAjuste(-10, m, null).ok, `a la baja con ${m}`).toBe(true)
    }
  })
})

describe('el borde de la nota', () => {
  it(`${NOTA_MINIMA - 1} caracteres no bastan, ${NOTA_MINIMA} sí`, () => {
    expect(veredictoDeAjuste(-10, 'count_correction', 'a'.repeat(NOTA_MINIMA - 1)).ok).toBe(false)
    expect(veredictoDeAjuste(-10, 'count_correction', 'a'.repeat(NOTA_MINIMA)).ok).toBe(true)
  })

  it('los espacios no cuentan como explicación', () => {
    expect(veredictoDeAjuste(-10, 'count_correction', '              ').ok).toBe(false)
  })
})
