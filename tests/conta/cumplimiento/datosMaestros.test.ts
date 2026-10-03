// tests/conta/cumplimiento/datosMaestros.test.ts
//
// Pruebas fijas del agente «Datos maestros e impuestos» (C00 §9.2,
// scripts/conta/lib/datosMaestros.mjs). Los casos salen de la referencia REAL
// (docs/conta/referencia/serie.json, generada de las fuentes oficiales), no de
// la cabeza de quien escribió el agente (regla 31): se toma la base tal como
// debería estar y se le hace a una fila real lo que puede pasarle de verdad.
//
// CADA FALLO NUEVO QUE ENCUENTRE EL AGENTE EN STAGING SE AÑADE A `FALLOS_REALES`
// con su fecha, para que no vuelva sin que nadie se entere.

import { describe, expect, it } from 'vitest'
import ref from '../../../docs/conta/referencia/serie.json'
import { CATALOGOS, TABLAS_FILA_A_FILA, informe, mismo, revisar } from '../../../scripts/conta/lib/datosMaestros.mjs'

type Fila = Record<string, unknown>
const HOY = '2026-10-03'
const NO_SON_DATOS = ['pruebas', 'desdeAuto', 'desde_por', 'fuenteOrden', 'literal', 'pgc']

/** La base tal como debería estar: cada fila de la referencia, con su norma y su fecha. */
function baseCorrecta(): { tablas: Record<string, Fila[]>; recuentos: Record<string, number> } {
  const tablas: Record<string, Fila[]> = {}
  for (const t of Object.keys(TABLAS_FILA_A_FILA)) {
    tablas[t] = ((ref.tablas as Record<string, { filas: unknown }>)[t].filas as Fila[]).map((f) => {
      const b: Fila = { legal_ref: 'norma', verified_at: '2026-10-02' }
      for (const [k, v] of Object.entries(f)) if (!NO_SON_DATOS.includes(k)) b[k] = v
      if (t === 'expense_category') b.legal_ref = `RD 1514/2007, cuadro de cuentas, ${String(f.pgc)}`
      return b
    })
  }
  const recuentos: Record<string, number> = {}
  for (const c of Object.keys(CATALOGOS)) recuentos[c] = (ref.tablas as Record<string, { filas: unknown }>)[c].filas as number
  return { tablas, recuentos }
}

const fila = (bd: ReturnType<typeof baseCorrecta>, t: string, code: string) => bd.tablas[t].find((f) => f.code === code)!

describe('agente «Datos maestros e impuestos»', () => {
  it('la base tal como dice la fuente: nada que avisar', () => {
    expect(revisar(baseCorrecta(), ref, HOY)).toEqual([])
  })

  it('una fila sin norma o sin fecha de comprobación', () => {
    const bd = baseCorrecta()
    fila(bd, 'tax_rate', 'iva_general').legal_ref = null
    fila(bd, 'payment_term', '30_dias').verified_at = null
    // Y además, en los dos campos, la base ya no dice lo que dice la fuente.
    expect(revisar(bd, ref, HOY).map((h) => h.tipo).sort()).toEqual(['distinto', 'distinto', 'sin_fecha', 'sin_norma'])
  })

  it('un porcentaje que no es el de la fuente', () => {
    const bd = baseCorrecta()
    fila(bd, 'withholding_rate', 'profesional').rate = 19
    const h = revisar(bd, ref, HOY)
    expect(h).toHaveLength(1)
    expect(h[0].detalle).toBe('Retenciones · profesional|2023-01-26 · rate: la base dice 19 y la fuente, 15.')
  })

  it('una vigencia nueva que no cierra la anterior: dos a la vez', () => {
    const bd = baseCorrecta()
    bd.tablas.withholding_rate.push({ ...fila(bd, 'withholding_rate', 'profesional'), rate: 17, valid_from: '2026-07-01' })
    const tipos = revisar(bd, ref, HOY).map((h) => h.tipo)
    expect(tipos).toContain('solape')
    expect(tipos).toContain('sobra') // y además no sale de ninguna fuente
  })

  it('el tipo temporal del 2 % (RDL 4/2024) se cerró: no choca con nada', () => {
    const bd = baseCorrecta()
    expect(fila(bd, 'tax_rate', 'iva_basicos_4t2024').valid_to).toBe('2024-12-31')
    expect(revisar(bd, ref, '2024-11-15')).toEqual([])
  })

  it('falta una fila, o un catálogo llega cortado', () => {
    const bd = baseCorrecta()
    bd.tablas.payment_term = bd.tablas.payment_term.filter((f) => f.code !== 'contado')
    bd.recuentos.iae_heading = 1000
    expect(revisar(bd, ref, HOY).map((h) => h.detalle)).toEqual([
      'Plazos de pago · contado: está en la fuente oficial y no en la base.',
      'Epígrafes del IAE: la fuente trae 1432 y en la base hay 1000.',
    ])
  })

  it('compara como la base devuelve los datos: 21.00 es 21 y una lista vacía es nada', () => {
    expect(mismo('21.00', 21)).toBe(true)
    expect(mismo([], null)).toBe(true)
    expect(mismo(['303'], ['303'])).toBe(true)
    expect(mismo(0.26, '0.26')).toBe(true)
    expect(mismo(15, 19)).toBe(false)
  })

  it('el informe dice lo que pasa en palabras y no esconde nada', () => {
    const bd = baseCorrecta()
    bd.recuentos.cnae_code = 1000
    const t = informe(revisar(bd, ref, HOY), { donde: 'staging-conta', hoy: HOY, referencia: '2026-10-02', filasMiradas: 10 })
    expect(t).toContain('**Hay una cosa que no cuadra.** No se ha cambiado nada: esto es un aviso.')
    expect(t).toContain('- Códigos CNAE-2025: la fuente trae 1060 y en la base hay 1000.')
    expect(informe([], { donde: 'staging-conta', hoy: HOY, referencia: '2026-10-02', filasMiradas: 10 })).toContain('**Todo cuadra.**')
  })
})

/**
 * Los fallos que el agente ha encontrado DE VERDAD, convertidos en prueba fija.
 * Cada uno: cuándo se vio, dónde, y qué le pasaba a la base.
 */
const FALLOS_REALES: { fecha: string; donde: string; que: string; romper: (bd: ReturnType<typeof baseCorrecta>) => void; espera: string }[] = [
  {
    fecha: '2026-10-03', donde: 'el clúster local de ensayo (con una 0130 anterior)',
    que: 'faltaban los plazos de pago y el modelo 130, que se añadieron después a la serie',
    romper: (bd) => { bd.tablas.payment_term = []; bd.tablas.tax_form = bd.tablas.tax_form.filter((f) => f.code !== '130') },
    espera: 'Modelos de impuestos · 130: está en la fuente oficial y no en la base.',
  },
]

describe('fallos reales, fijados', () => {
  for (const f of FALLOS_REALES) {
    it(`${f.fecha} · ${f.donde}: ${f.que}`, () => {
      const bd = baseCorrecta()
      f.romper(bd)
      expect(revisar(bd, ref, HOY).map((h) => h.detalle)).toContain(f.espera)
    })
  }
})
