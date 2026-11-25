// tests/conta/x14/sumasDeErp10.test.ts
//
// X14 · 2 (Julio, 25/11) · El falso verde de «Sumas y saldos: Cuadra · las 0 cuentas con saldo». Con la conexión, el sumas y
// saldos se calculaba de los mismos asientos y la base comparaba lo traído consigo mismo. Ahora:
//   · paraLaBase solo manda a la base el sumas y saldos que viene de ERP10 (su fichero), nunca el calculado;
//   · el fichero soltado se lee con sumasDelFichero (el ejemplo inventado de tests/conta/fixtures/importar/erp10);
//   · la fila dice «Sin comparar» si no se ha comparado, o si no se ha comparado ninguna cuenta: nunca «Cuadra».

import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { abrirExcel, filasUnBoton, leerCarga, leidoDeLaConexion, paraLaBase, sumasDelFichero, type AntesVisto, type EntradaUnBoton, type FicheroExcel } from '@/modules/conta/lib/traer'
import { PARADO } from '@/modules/conta/erp10/lectorTraer'

const D = 'tests/conta/fixtures/importar/erp10'
const fichero = (n: string): FicheroExcel => abrirExcel(n, readFileSync(`${D}/${n}`))
const EJEMPLO: readonly FicheroExcel[] = readdirSync(D).filter((f) => f.endsWith('.xlsx')).sort().map(fichero)

describe('X14 · 2 · el sumas y saldos de ERP10, de su fichero', () => {
  it('el del ejemplo: sus cuentas en céntimos; otro fichero no vale y lo dice', () => {
    const r = sumasDelFichero(fichero('sumas_y_saldos.xlsx'))
    expect('sumas' in r && r.cuentas).toBe(leerCarga([fichero('sumas_y_saldos.xlsx')]).sumas!.filas.length)
    expect('sumas' in r && r.sumas.every((x) => Number.isInteger(x.debe) && Number.isInteger(x.haber) && /^\d+$/.test(x.cuenta))).toBe(true)
    expect(sumasDelFichero(fichero('diario.xlsx'))).toEqual({ porque: '«diario.xlsx» no es el sumas y saldos de ERP10 (el del ejercicio, en Excel). No se ha comparado nada.' })
  })
  it('paraLaBase manda el del fichero, y el calculado de los asientos (la conexión), no', () => {
    expect(paraLaBase(leerCarga(EJEMPLO)).sumas.length).toBeGreaterThan(0)
    const soloDiario = leerCarga(EJEMPLO.filter((f) => f.nombre !== 'sumas_y_saldos.xlsx'))
    expect(soloDiario.ficheros.find((f) => f.tipo === 'sumas_saldos')?.origen ?? null).toBe(null)
    expect(paraLaBase(soloDiario).sumas).toEqual([])
    expect(typeof leidoDeLaConexion).toBe('function')
  })
})

describe('X14 · 2 · «Sumas y saldos» nunca dice «Cuadra» sin haber comparado', () => {
  const entrada = (antes: AntesVisto): EntradaUnBoton => ({ lector: null, carga: null, antes, meter: null, parado: PARADO,
    enPrueba: { id: 'c', programa: 'erp10', cuando: '2026-11-25T10:00:00Z', quien: null, desde: '2024-01-01', hasta: '2024-12-31', cuentas: { asientos: 4425 },
      soloCuentas: false, texto: null, mirar: [], sumas: [] } as unknown as EntradaUnBoton['enPrueba'] })
  const fila = (antes: AntesVisto) => filasUnBoton(entrada(antes)).find((f) => f.tipo === 'sumas_saldos')!
  const base = { puede: false, texto: 'x', diferencias: [] }
  it('sin comparar, o con 0 cuentas comparadas: «Sin comparar» y por qué', () => {
    for (const a of [{ ...base, comparado: false, cuentas: 0 }, { ...base, comparado: true, cuentas: 0 }]) {
      expect(fila(a)).toMatchObject({ cifra: 'Sin comparar', icono: 'mira', linea: 'No se ha podido comparar: suelta el sumas y saldos de ERP10' })
    }
  })
  it('comparado y sin diferencias: «Cuadra» con las cuentas que ha comparado', () => {
    expect(fila({ ...base, puede: true, comparado: true, cuentas: 412 })).toMatchObject({ cifra: 'Cuadra', icono: 'hecho', linea: 'las 412 cuentas, iguales en Sumied y en ERP10 al céntimo, debe y haber' })
  })
})
