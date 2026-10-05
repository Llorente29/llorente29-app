// Respuesta 3 del C00, punto 3: una cuenta de apunte se enseña con la longitud
// que eligió la empresa («47200000 · IVA soportado»); el código corto del plan
// (RD 1514/2007, hasta 4 dígitos) solo como título de grupo.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NOMBRE_CUENTA_PGC, codigoDeApunte, cuentaDeApunte, cuentaPgc } from '@/modules/conta/lib/pgc'
import { cuentaEnLaFicha } from '@/modules/conta/lib/opcionesFicha'

/** Las pistas de cuenta reales de la serie: las de impuestos, retenciones y tipos de gasto. */
const serie = JSON.parse(readFileSync('docs/conta/referencia/serie.json', 'utf8')).tablas
const PISTAS: string[] = [...new Set<string>([
  ...serie.tax_rate.filas.flatMap((f: Record<string, unknown>) => [f.pgc_input_hint, f.pgc_output_hint]),
  ...serie.withholding_rate.filas.map((f: Record<string, unknown>) => f.pgc_hint),
  ...serie.expense_category.filas.map((f: Record<string, unknown>) => f.pgc),
].filter((x): x is string => typeof x === 'string' && x !== ''))]

describe('la cuenta de apunte, con la longitud de la empresa', () => {
  it('el caso de la respuesta: 472 con 8 dígitos', () => {
    expect(cuentaDeApunte('472', 8)).toBe('47200000 · Hacienda Pública, IVA soportado')
    expect(cuentaPgc('472')).toBe('472 · Hacienda Pública, IVA soportado') // el título de grupo, como era
  })
  it('todas las pistas reales de la serie salen con exactamente los dígitos de la empresa, para cada longitud', () => {
    expect(PISTAS.length).toBeGreaterThan(10)
    for (const d of [6, 8, 10, 12]) {
      for (const p of PISTAS) {
        const c = codigoDeApunte(p, d)
        expect(c.length, `${p} con ${d}`).toBe(Math.max(d, p.length))
        expect(c.startsWith(p), `${p} con ${d}`).toBe(true)
      }
    }
  })
  it('cada pista real tiene nombre del PGC: ninguna cuenta sale sin decir qué es', () => {
    for (const p of PISTAS) expect(NOMBRE_CUENTA_PGC[p], p).toBeTruthy()
  })
  it('no corta lo que ya es largo, ni inventa con lo que no es un número', () => {
    expect(codigoDeApunte('47200001', 6)).toBe('47200001')
    expect(codigoDeApunte('abc', 8)).toBe('abc')
    expect(codigoDeApunte('4751', 99)).toBe('47510000') // longitud imposible: la normal, 8
  })
  it('en la ficha: con empresa, la completa; sin empresa, el código del plan (no se sabe la longitud)', () => {
    expect(cuentaEnLaFicha({ digitos: 10 }, '625')).toBe('6250000000 · Primas de seguros')
    expect(cuentaEnLaFicha({ digitos: null }, '625')).toBe('625 · Primas de seguros')
  })
})
