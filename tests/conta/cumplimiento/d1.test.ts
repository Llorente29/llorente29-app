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

describe('D1 · el puente da lo mismo que vat_rate de producción', () => {
  it('las 6 filas, idénticas (categoría, %, recargo, vigencia)', () => {
    expect(despues()).toEqual(antes)
  })
})

describe('los valores de serie salen de las fuentes, sin retoques a mano', () => {
  it('scripts/conta/serie.mjs comprobar: migración y referencia idénticas a lo generado', () => {
    expect(() => execFileSync('node', ['scripts/conta/serie.mjs', 'comprobar'], { cwd: raiz, stdio: 'pipe' })).not.toThrow()
  })
})
