// tests/unit/modules/conta/i01d/impuestos2025.test.ts
//
// I01d · Cargar los impuestos de 2025 (Julio, 21/10). En el Trimestre, cada
// periodo de antes de llevar aquí los impuestos y sin declaración sale «Sin
// cargar · Pegar CSV», no «Fuera de plazo»; y la cartera del 1T dice de qué 303
// sale lo pendiente del año anterior: del 4T, o de la [110] del 1T si falta el 4T.
// Importes inventados.

import { describe, expect, it } from 'vitest'
import {
  anteriorASumied, lineasCartera, sinCargar, tarjeta, TEXTO_SIN_CARGAR,
  type Cartera, type DeclaracionTrimestre, type FilaCartera, type ModeloTrimestre,
} from '@/modules/conta/impuestos/trimestre'

// Como una empresa que lleva aquí sus impuestos desde el 18/10/2026.
const DESDE = '2026-10-18'
const HOY = '2026-10-21'

const modelo = (x: Partial<ModeloTrimestre> = {}): ModeloTrimestre => ({
  modelo: '303', nombre: 'IVA', cadencia: 'quarterly', periodo: '4T', no_toca: false,
  presentacion: '2026-01-30', domiciliacion: '2026-01-27', declaracion: null, ...x,
})
const decl = (x: Partial<DeclaracionTrimestre> = {}): DeclaracionTrimestre => ({
  id: 'd', cuenta: 'c', estado: 'filed', estado_texto: 'Presentada', resultado: 'to_offset', importe: 500, presentada: '2026-01-30T09:15:07+01:00', presentada_por: null,
  por: 'outside', csv: 'PRUEBAI01D4T2025', justificante: null, justificante_pdf: null, traido: true, expediente: null, presentador: null, casillas: [], ...x,
})

describe('qué periodo es de antes de Sumied', () => {
  it('con plazo: el que acabó antes de «desde»', () => {
    expect(anteriorASumied(2025, '2026-01-30', DESDE)).toBe(true)
    expect(anteriorASumied(2026, '2026-07-20', DESDE)).toBe(true)
    // El 3T de 2026 vence el 20/10, después de empezar: es de Sumied.
    expect(anteriorASumied(2026, '2026-10-20', DESDE)).toBe(false)
  })
  it('sin plazo (sin festivos de ese año): el de un año anterior', () => {
    expect(anteriorASumied(2025, null, DESDE)).toBe(true)
    expect(anteriorASumied(2026, null, DESDE)).toBe(false)
  })
  it('sin «desde» (sin la 0420) no se sabe, y no se dice', () => {
    expect(anteriorASumied(2025, '2026-01-30', null)).toBe(false)
    expect(anteriorASumied(2025, null, undefined)).toBe(false)
  })
})

describe('«Sin cargar · Pegar CSV» en la tarjeta', () => {
  it('el 4T de 2025 sin declaración: sin cargar, no «Fuera de plazo»', () => {
    const m = modelo()
    expect(sinCargar(m, 2025, DESDE)).toBe(true)
    expect(tarjeta(m, HOY, 2025, DESDE)).toEqual({ titulo: expect.any(String), importe: '—', chip: { tono: 'accion', texto: TEXTO_SIN_CARGAR } })
    expect(TEXTO_SIN_CARGAR).toBe('Sin cargar · Pegar CSV')
  })
  it('el 1T de 2025, sin plazo, y el 202 del 1P: también', () => {
    expect(tarjeta(modelo({ periodo: '1T', presentacion: null, domiciliacion: null }), HOY, 2025, DESDE).chip.texto).toBe(TEXTO_SIN_CARGAR)
    expect(tarjeta(modelo({ modelo: '202', cadencia: 'instalments_202', periodo: '1P', presentacion: null, domiciliacion: null }), HOY, 2025, DESDE).chip.texto).toBe(TEXTO_SIN_CARGAR)
  })
  it('ya cargado: presentado, como siempre', () => {
    const m = modelo({ declaracion: decl() })
    expect(sinCargar(m, 2025, DESDE)).toBe(false)
    expect(tarjeta(m, HOY, 2025, DESDE).chip.tono).toBe('seguro')
  })
  it('lo de Sumied que se pasó de plazo sigue en rojo', () => {
    const m = modelo({ periodo: '3T', presentacion: '2026-10-20' })
    expect(sinCargar(m, 2026, DESDE)).toBe(false)
    expect(tarjeta(m, HOY, 2026, DESDE).chip).toEqual({ tono: 'falta', texto: 'Fuera de plazo' })
  })
  it('sin «desde», como antes de la 0420: «Fuera de plazo»', () => {
    expect(tarjeta(modelo(), HOY, 2025, undefined).chip).toEqual({ tono: 'falta', texto: 'Fuera de plazo' })
  })
  it('el 202 del 2T no toca, cargado o no', () => {
    expect(sinCargar(modelo({ modelo: '202', periodo: null, no_toca: true }), 2025, DESDE)).toBe(false)
  })
})

const fila = (periodo: string, x: Partial<FilaCartera> = {}): FilaCartera => ({
  periodo, declaracion: null, estado: null, presentada: null, resultado: null, importe: null, c110: null, c78: null, c87: null, origen110: null, ...x,
})
const cartera = (x: Partial<Cartera> = {}): Cartera => ({
  filas: [fila('1T'), fila('2T'), fila('3T'), fila('4T')], pendiente_al_empezar: null, esperada_110: null, borrador: null, desfasada: false, ...x,
})
const F1T = fila('1T', { declaracion: 'd1', estado: 'filed', presentada: true, resultado: 'zero', importe: 0, c110: 1631.96, c78: 300, c87: 1331.96, origen110: 'justificante' })

describe('la cartera del 1T de 2026 sale del 4T de 2025', () => {
  it('con el 4T cargado: lo dice, y la [110] del 1T casa con él', () => {
    const c = cartera({ filas: [F1T, fila('2T'), fila('3T'), fila('4T')], pendiente_al_empezar: { importe: 1631.96, de: '4T/2025', c110_1t: 1631.96 }, esperada_110: { importe: 1631.96, de: '4T/2025' } })
    const r = lineasCartera({ ejercicio: 2026, trimestre: '1T', cartera: c, desde: DESDE })
    expect(r.lineas[0]).toEqual({ texto: 'Pendiente de 2025', importe: 1631.96, nota: 'Lo que dejó el 303 del 4T de 2025.' })
    expect(r.lineas.find((l) => l.casilla === '110')?.importe).toBe(1631.96)
    expect(r.cuadra).toBe(true)
  })
  it('si la [110] del 1T no es lo que dejó el 4T, no casa y se dice', () => {
    const c = cartera({ filas: [F1T, fila('2T'), fila('3T'), fila('4T')], pendiente_al_empezar: { importe: 2000, de: '4T/2025', c110_1t: 1631.96 }, esperada_110: { importe: 2000, de: '4T/2025' } })
    expect(lineasCartera({ ejercicio: 2026, trimestre: '1T', cartera: c, desde: DESDE }).cuadra).toBe(false)
  })
  it('sin el 4T: sale de la [110] del 1T, lo dice, y no se compara consigo misma', () => {
    const c = cartera({ filas: [F1T, fila('2T'), fila('3T'), fila('4T')], pendiente_al_empezar: { importe: 1631.96, de: '1T/2026' } })
    const r = lineasCartera({ ejercicio: 2026, trimestre: '1T', cartera: c, desde: DESDE })
    expect(r.lineas[0].nota).toBe('Sale de la [110] del 1T de 2026: falta cargar el 303 del 4T de 2025.')
    expect(r.cuadra).toBeNull()
  })
  it('con el 1T sin cargar: la [110] que le toca es la del 4T, sin «casa» (no hay con qué comparar)', () => {
    const c = cartera({ pendiente_al_empezar: { importe: 1631.96, de: '4T/2025' }, esperada_110: { importe: 1631.96, de: '4T/2025' } })
    const r = lineasCartera({ ejercicio: 2026, trimestre: '1T', cartera: c, desde: DESDE })
    expect(r.lineas.find((l) => l.casilla === '110')?.importe).toBe(1631.96)
    expect(r.cuadra).toBeNull()
  })
})

describe('los trimestres de 2025 sin cargar, en la cartera', () => {
  it('«sin cargar», con lo que falta, y la cadena no se cierra', () => {
    const r = lineasCartera({ ejercicio: 2025, trimestre: '4T', cartera: cartera(), desde: DESDE })
    expect(r.lineas.filter((l) => l.texto.endsWith('· sin cargar')).map((l) => l.texto)).toEqual(['1T 2025 · sin cargar', '2T 2025 · sin cargar', '3T 2025 · sin cargar'])
    expect(r.lineas[1].nota).toBe('Pega su CSV para que la cartera siga.')
    expect(r.cuadra).toBeNull()
  })
  it('lo de Sumied sin presentar sigue diciendo «no está presentado en Sumied»', () => {
    const r = lineasCartera({ ejercicio: 2027, trimestre: '2T', cartera: cartera(), desde: DESDE })
    expect(r.lineas[1].texto).toBe('1T 2027 · no está presentado en Sumied')
  })
})

describe('ningún texto dice «papel»', () => {
  it('ni la tarjeta ni la cartera', () => {
    const textos = [TEXTO_SIN_CARGAR, ...lineasCartera({ ejercicio: 2025, trimestre: '4T', cartera: cartera(), desde: DESDE }).lineas.flatMap((l) => [l.texto, l.nota ?? ''])]
    for (const t of textos) expect(t.toLowerCase()).not.toContain('papel')
  })
})
