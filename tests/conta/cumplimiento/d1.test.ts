// D1 del C00 (respuesta 1 de Julio): una sola fuente de los porcentajes.
// El ANTES son las 6 filas reales de vat_rate de producción
// (vat_rate_produccion.json). El DESPUÉS es lo que dan el puente
// vat_category_tax y la tabla tax_rate tal como los genera
// scripts/conta/serie.mjs desde el BOE (docs/conta/referencia/serie.json),
// calculado con la MISMA regla que la vista vat_category_rate (intersección de
// vigencias). Tienen que ser idénticas: si no, vat_rate_for cambiaría.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const raiz = resolve(__dirname, '../../..')
const antes = JSON.parse(readFileSync(resolve(__dirname, 'vat_rate_produccion.json'), 'utf8')).filas
const serie = JSON.parse(readFileSync(resolve(raiz, 'docs/conta/referencia/serie.json'), 'utf8'))

type Fila = { category_code: string; rate: number; surcharge: number; valid_from: string; valid_to: string | null }

function despues(): Fila[] {
  const impuestos = serie.tablas.tax_rate.filas as { code: string; rate: number; surcharge_rate: number | null; valid_from: string; valid_to: string | null }[]
  const puente = serie.tablas.vat_category_tax.filas as { category_code: string; tax_code: string; valid_from: string; valid_to: string | null }[]
  const fin = (d: string | null) => d ?? '9999-12-31'
  const out: Fila[] = []
  for (const b of puente) {
    for (const t of impuestos.filter((x) => x.code === b.tax_code)) {
      if (b.valid_from > fin(t.valid_to) || t.valid_from > fin(b.valid_to)) continue
      const hasta = b.valid_to === null ? t.valid_to : t.valid_to === null ? b.valid_to : (b.valid_to < t.valid_to ? b.valid_to : t.valid_to)
      out.push({ category_code: b.category_code, rate: t.rate, surcharge: t.surcharge_rate ?? 0,
        valid_from: b.valid_from > t.valid_from ? b.valid_from : t.valid_from, valid_to: hasta })
    }
  }
  return out.sort((a, b) => a.category_code.localeCompare(b.category_code) || a.valid_from.localeCompare(b.valid_from))
}

/**
 * Lo que el puente da a propósito y vat_rate de producción no tenía. Respuesta 2
 * de Julio (C00): el 2 % del último trimestre de 2024 a TODOS los alimentos
 * básicos (RD-ley 4/2024, art. 1.Dos.2); producción solo lo tenía para el aceite.
 */
const DECIDIDO_DESPUES: Fila[] = [
  { category_code: 'alimento_basico', rate: 2, surcharge: 0.26, valid_from: '2024-10-01', valid_to: '2024-12-31' },
]

describe('D1 · el puente da lo mismo que vat_rate de producción', () => {
  it('las 6 filas, idénticas (categoría, %, recargo, vigencia), más SOLO el tramo decidido', () => {
    const esperado = [...antes, ...DECIDIDO_DESPUES]
      .sort((a: Fila, b: Fila) => a.category_code.localeCompare(b.category_code) || a.valid_from.localeCompare(b.valid_from))
    expect(despues()).toEqual(esperado)
  })

  it('fuera del 4.º trimestre de 2024 no cambia nada', () => {
    const fuera = (f: Fila) => !(f.valid_from >= '2024-10-01' && (f.valid_to ?? '9999') <= '2024-12-31')
    expect(despues().filter(fuera)).toEqual(antes.filter(fuera))
  })

  it('la pasta y los aceites de semillas (7,5 %) están cargados como impuesto, sin puente: no hay categoría para ellos', () => {
    const t = (serie.tablas.tax_rate.filas as { code: string; rate: number; surcharge_rate: number }[]).find((x) => x.code === 'iva_pasta_semillas_4t2024')
    expect(t).toMatchObject({ rate: 7.5, surcharge_rate: 1 })
    expect((serie.tablas.vat_category_tax.filas as { tax_code: string }[]).some((b) => b.tax_code === 'iva_pasta_semillas_4t2024')).toBe(false)
  })
})

describe('los valores de serie salen de las fuentes, sin retoques a mano', () => {
  it('scripts/conta/serie.mjs comprobar: migración y referencia idénticas a lo generado', () => {
    expect(() => execFileSync('node', ['scripts/conta/serie.mjs', 'comprobar'], { cwd: raiz, stdio: 'pipe' })).not.toThrow()
  })
})
