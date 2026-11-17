// tests/unit/modules/conta/k02/interruptor.test.ts
//
// K02 · Con el interruptor `conta_nucleo` apagado, el marco que se pinta es el
// de hoy (decisión 2 de Julio, 17/11). También mientras no se sabe, y en el
// móvil aunque esté encendido. Y module.tsx elige el marco con MarcoSegun, que
// pinta el Marco de hoy tal cual en esos casos.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cualMarco, INTERRUPTOR_NUCLEO } from '@/modules/conta/nucleo/interruptor'
import { conEjercicio, ejercicioAEnsenar } from '@/modules/conta/nucleo/ejercicio'
import { frasesDeEstado } from '@/modules/conta/nucleo/estado'

describe('K02 · qué marco se pinta', () => {
  it('apagado: el de hoy', () => {
    expect(cualMarco({ encendido: false, movil: false })).toBe('hoy')
  })
  it('sin saber todavía: el de hoy (lo de hoy no espera a nadie)', () => {
    expect(cualMarco({ encendido: null, movil: false })).toBe('hoy')
  })
  it('encendido en el móvil: el de hoy, hasta que haya maqueta de móvil', () => {
    expect(cualMarco({ encendido: true, movil: true })).toBe('hoy')
  })
  it('encendido en el ordenador: el del núcleo', () => {
    expect(cualMarco({ encendido: true, movil: false })).toBe('nucleo')
  })
  it('el interruptor se llama conta_nucleo', () => {
    expect(INTERRUPTOR_NUCLEO).toBe('conta_nucleo')
  })
  it('module.tsx pasa por MarcoSegun, y MarcoSegun pinta el Marco de hoy cuando no es el núcleo', () => {
    const modulo = readFileSync('src/modules/conta/module.tsx', 'utf8')
    expect(modulo).toMatch(/<EmpresasProveedor><MarcoSegun sinPregunta=\{sinPregunta\}>\{pagina\}<\/MarcoSegun><\/EmpresasProveedor>/)
    const segun = readFileSync('src/modules/conta/nucleo/MarcoSegun.tsx', 'utf8')
    expect(segun).toMatch(/=== 'nucleo'\s*\?\s*<MarcoNucleo[\s\S]*:\s*<Marco sinPregunta=\{sinPregunta\}>\{children\}<\/Marco>/)
  })
})

describe('K02 · el ejercicio de arriba', () => {
  const E = [
    { codigo: '2025', desde: '2025-01-01', hasta: '2025-12-31', estado: 'closed' as const },
    { codigo: '2026', desde: '2026-01-01', hasta: '2026-12-31', estado: 'open' as const },
  ]
  it('el de la dirección manda; si no, el elegido; si no, el de hoy; si no, el más reciente', () => {
    expect(ejercicioAEnsenar('2025', '2026', E, '2026-11-17')?.codigo).toBe('2025')
    expect(ejercicioAEnsenar(null, '2025', E, '2026-11-17')?.codigo).toBe('2025')
    expect(ejercicioAEnsenar(null, null, E, '2026-11-17')?.codigo).toBe('2026')
    expect(ejercicioAEnsenar(null, null, E, '2030-01-01')?.codigo).toBe('2026')
    expect(ejercicioAEnsenar('1999', null, E, '2026-11-17')?.codigo).toBe('2026')
    expect(ejercicioAEnsenar(null, null, [], '2026-11-17')).toBeNull()
  })
  it('se escribe en la dirección sin tocar lo demás', () => {
    expect(conEjercicio('?ver=revisar', '2025')).toBe('?ver=revisar&ejercicio=2025')
    expect(conEjercicio('?ejercicio=2026&mes=2026-10', '2025')).toBe('?ejercicio=2025&mes=2026-10')
  })
})

describe('K02 · la línea de estado (decisión 8)', () => {
  const rutas = { recibidas: '/r', bancos: '/b', asientos: '/a' }
  it('lo que no se ha contado no sale', () => {
    expect(frasesDeEstado({}, rutas)).toEqual([])
    expect(frasesDeEstado({ recibidas: null, bancos: null, libros: null }, rutas)).toEqual([])
  })
  it('lo contado sale como una frase: en ámbar lo que espera, en verde «al día» (arreglo 3)', () => {
    const frase = (c: Parameters<typeof frasesDeEstado>[0]) => frasesDeEstado(c, rutas).map((x) => [x.tono, `${x.fuerte} ${x.resto}`])
    expect(frase({ recibidas: 9, bancos: 14, libros: 3 })).toEqual([
      ['mira', '14 movimientos del banco por revisar'], ['mira', '3 asientos por revisar'], ['mira', '9 facturas por revisar'],
    ])
    expect(frase({ recibidas: 0, bancos: 0, libros: 0 })).toEqual([['bien', 'Bancos al día'], ['bien', 'Asientos al día'], ['bien', 'Facturas al día']])
    expect(frase({ recibidas: 1, bancos: 1, libros: 1 })).toEqual([
      ['mira', '1 movimiento del banco por revisar'], ['mira', '1 asiento por revisar'], ['mira', '1 factura por revisar'],
    ])
  })
  it('no dice nada de lo que hoy no se cuenta: ni bancos cuadrados ni el IVA', () => {
    const textos = frasesDeEstado({ recibidas: 1, bancos: 1, libros: 1 }, rutas).map((x) => `${x.fuerte} ${x.resto}`).join(' ')
    expect(textos).not.toMatch(/cuadrad|IVA/)
  })
})
