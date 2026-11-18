// tests/conta/n06b/darloPorBueno.test.ts
//
// N06b · Lo que manda la pantalla para darlo por bueno lleva el sumas y saldos de allí, y la prueba de
// staging (supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql) lleva EXACTAMENTE lo que sale
// de paraLaBase con el ejemplo de ERP10 (las cifras del LEEME).

import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { abrirExcel, leerCarga, paraLaBase, type FicheroExcel } from '@/modules/conta/lib/traer'

const D = 'tests/conta/fixtures/importar/erp10'
const EJEMPLO: readonly FicheroExcel[] = readdirSync(D).filter((f) => f.endsWith('.xlsx')).sort().map((f) => abrirExcel(f, readFileSync(`${D}/${f}`)))
const datos = paraLaBase(leerCarga(EJEMPLO))

describe('N06b · el sumas y saldos, para compararlo al darlo por bueno', () => {
  it('15 subcuentas con movimiento, 11.499,00 al debe y al haber (en céntimos), sin la fila de totales', () => {
    expect(datos.sumas).toHaveLength(15)
    expect(datos.sumas.reduce((s, x) => s + x.debe, 0)).toBe(1149900)
    expect(datos.sumas.reduce((s, x) => s + x.haber, 0)).toBe(1149900)
    expect(datos.sumas.some((x) => /total/i.test(x.cuenta))).toBe(false)
  })
  it('cuadra, cuenta a cuenta, con lo que se trae del diario', () => {
    const traido = new Map<string, { debe: number; haber: number }>()
    for (const x of datos.asientos.flatMap((a) => a.apuntes)) {
      const t = traido.get(x.cuenta) ?? { debe: 0, haber: 0 }
      traido.set(x.cuenta, { debe: t.debe + x.debe, haber: t.haber + x.haber })
    }
    for (const s of datos.sumas) expect([s.cuenta, traido.get(s.cuenta)]).toEqual([s.cuenta, { debe: s.debe, haber: s.haber }])
    expect(traido.size).toBe(datos.sumas.length)
  })
  it('la prueba de staging lleva exactamente esto', () => {
    const sql = readFileSync('supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql', 'utf8')
    const m = /'n06b\.datos', \$carga\$(.*?)\$carga\$/s.exec(sql)
    expect(m).not.toBeNull()
    expect(JSON.parse(m![1])).toEqual(datos)
  })
})
