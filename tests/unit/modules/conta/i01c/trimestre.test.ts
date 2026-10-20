// tests/unit/modules/conta/i01c/trimestre.test.ts
//
// I01c · Impuestos › Trimestre: lo que dice la tira y la cartera de cuotas a
// compensar, con la forma que devuelve conta_impuesto_trimestre (0280). La
// cadena es la de Foodint el 19/10 (regla 31: la población de verdad, aquí en
// cifras porque son de la empresa y no salen de su 303): 1.500,00 pendientes de
// antes, el 1T sale a compensar 1.200,50 y el 2T aplica 400,25; la [110] del 3T
// tiene que ser 2.300,25. Las demás cifras de las tarjetas son inventadas.

import { describe, expect, it } from 'vitest'
import {
  fraseDesfasada, fraseRecalculado, importeConSigno, lineasCartera, nombreTarjeta, numeroTrimestre, presentadorEnPalabras, tarjeta,
  tituloTrimestre, trimestrePorDefecto,
  type Cartera, type DeclaracionTrimestre, type FilaCartera, type ModeloTrimestre, type Trimestre,
} from '@/modules/conta/impuestos/trimestre'

const fila = (periodo: string, x: Partial<FilaCartera> = {}): FilaCartera => ({
  periodo, declaracion: null, estado: null, presentada: null, resultado: null, importe: null, c110: null, c78: null, c87: null, origen110: null, ...x,
})
const F1T = fila('1T', { declaracion: 'd1', estado: 'filed', presentada: true, resultado: 'to_offset', importe: 1200.50, c110: 1500.00, c78: 0, c87: 1500.00, origen110: 'justificante' })
const F2T = fila('2T', { declaracion: 'd2', estado: 'filed', presentada: true, resultado: 'zero', importe: 0, c110: 2700.50, c78: 400.25, c87: 2300.25, origen110: 'justificante' })

const cartera = (x: Partial<Cartera> = {}): Cartera => ({
  filas: [F1T, F2T, fila('3T'), fila('4T')],
  pendiente_al_empezar: { importe: 1500.00, de: '1T/2026' },
  esperada_110: { importe: 2300.25, de: '2T/2026' },
  borrador: null,
  desfasada: false,
  ...x,
})
const t3 = (c: Cartera) => ({ ejercicio: 2026, trimestre: '3T', cartera: c })

const decl = (x: Partial<DeclaracionTrimestre> = {}): DeclaracionTrimestre => ({
  id: 'd', cuenta: 'c', estado: 'draft', estado_texto: 'Borrador', resultado: 'to_pay', importe: 812.4, presentada: null, presentada_por: null,
  por: null, csv: null, justificante: null, justificante_pdf: null, traido: null, expediente: null, presentador: null, casillas: [], ...x,
})
const modelo = (x: Partial<ModeloTrimestre> = {}): ModeloTrimestre => ({
  modelo: '111', nombre: 'Retenciones e ingresos a cuenta', cadencia: 'quarterly', periodo: '3T', no_toca: false,
  presentacion: '2026-10-20', domiciliacion: '2026-10-15', declaracion: null, ...x,
})

describe('el trimestre que se abre', () => {
  it('es el último acabado', () => {
    expect(trimestrePorDefecto('2026-10-19')).toEqual({ ejercicio: 2026, trimestre: '3T' })
    expect(trimestrePorDefecto('2026-04-01')).toEqual({ ejercicio: 2026, trimestre: '1T' })
    expect(trimestrePorDefecto('2026-12-31')).toEqual({ ejercicio: 2026, trimestre: '3T' })
    expect(trimestrePorDefecto('2027-01-15')).toEqual({ ejercicio: 2026, trimestre: '4T' })
    expect(trimestrePorDefecto('2027-03-31')).toEqual({ ejercicio: 2026, trimestre: '4T' })
  })
  it('lee el trimestre de la ruta y le pone título', () => {
    expect(numeroTrimestre('3T')).toBe(3)
    expect(numeroTrimestre('5T')).toBeNull()
    expect(numeroTrimestre('1P')).toBeNull()
    expect(tituloTrimestre(2026, '3T')).toBe('3.er trimestre 2026')
    expect(tituloTrimestre(2026, '2T')).toBe('2.º trimestre 2026')
  })
})

describe('la tira: lo que vence, en rojo (Julio, 20/10, punto 5)', () => {
  const m303 = (x: Partial<DeclaracionTrimestre> | null) => modelo({ modelo: '303', presentacion: '2026-10-20', declaracion: x === null ? null : decl(x) })
  it('sin calcular y vence hoy', () => {
    expect(tarjeta(m303({ resultado: null, importe: null }), '2026-10-20').chip).toEqual({ tono: 'falta', texto: 'Sin calcular · vence hoy' })
  })
  it('para revisar y ya pasado el plazo', () => {
    expect(tarjeta(m303({}), '2026-10-21').chip).toEqual({ tono: 'falta', texto: 'Para revisar · fuera de plazo' })
  })
  it('sin declaración: «Vence hoy» en rojo en vez de la fecha', () => {
    expect(tarjeta(m303(null), '2026-10-20').chip).toEqual({ tono: 'falta', texto: 'Vence hoy' })
    expect(tarjeta(m303(null), '2026-10-19').chip).toEqual({ tono: 'neutro', texto: 'Hasta el 20/10' })
  })
  it('lo presentado no vence nunca', () => {
    expect(tarjeta(m303({ estado: 'filed', presentada: '2026-10-13T08:51:00+00:00' }), '2026-10-21').chip).toEqual({ tono: 'seguro', texto: 'Presentado 13/10' })
  })
})

describe('quién lo presentó', () => {
  it('la propia empresa, si el NIF es el suyo (con o sin guiones)', () => {
    expect(presentadorEnPalabras({ nif: 'B-28000016', nombre: 'TABERNA' }, 'B28000016')).toBe('La propia empresa')
  })
  it('la gestoría, con su nombre y su NIF; sin dato, nada', () => {
    expect(presentadorEnPalabras({ nif: '00000000T', nombre: 'GESTORIA INVENTADA' }, 'B28000016')).toBe('GESTORIA INVENTADA (00000000T)')
    expect(presentadorEnPalabras(null, 'B28000016')).toBeNull()
    expect(presentadorEnPalabras({ nif: null, nombre: null }, 'B28000016')).toBeNull()
  })
})

describe('la tira', () => {
  it('nombra cada modelo en corto', () => {
    expect(nombreTarjeta(modelo({ modelo: '303' }))).toBe('IVA · 303')
    expect(nombreTarjeta(modelo({ modelo: '111' }))).toBe('Retenciones · 111')
    expect(nombreTarjeta(modelo({ modelo: '115' }))).toBe('Alquiler · 115')
    expect(nombreTarjeta(modelo({ modelo: '202', periodo: '2P', cadencia: 'instalments_202' }))).toBe('Sociedades · 202')
    expect(nombreTarjeta(modelo({ modelo: '111', cadencia: 'monthly', periodo: '07' }))).toBe('Retenciones · 111 · mes 7')
  })
  it('a compensar y a devolver, en negativo; a pagar, en positivo', () => {
    expect(importeConSigno({ resultado: 'to_offset', importe: 900.00 })).toBe(-900.00)
    expect(importeConSigno({ resultado: 'to_refund', importe: 10 })).toBe(-10)
    expect(importeConSigno({ resultado: 'to_pay', importe: 812.4 })).toBe(812.4)
    expect(importeConSigno({ resultado: null, importe: 812.4 })).toBeNull()
  })
  it('el 202 del 2T dice que no toca, no desaparece (regla 7)', () => {
    const t = tarjeta(modelo({ modelo: '202', cadencia: 'instalments_202', periodo: null, no_toca: true, presentacion: null }))
    expect(t).toEqual({ titulo: 'Sociedades · 202', importe: '—', chip: { tono: 'neutro', texto: 'No toca este trimestre' } })
  })
  it('sin declaración, el plazo', () => {
    expect(tarjeta(modelo()).chip).toEqual({ tono: 'neutro', texto: 'Hasta el 20/10' })
    expect(tarjeta(modelo({ declaracion: decl({ estado: 'pending' }) })).chip.texto).toBe('Hasta el 20/10')
  })
  it('presentado, con su fecha e importe', () => {
    const t = tarjeta(modelo({ declaracion: decl({ estado: 'filed', presentada: '2026-10-14T09:12:00+00:00', importe: 1204.33 }) }))
    expect(t.importe).toBe('1.204,33 €')
    expect(t.chip).toEqual({ tono: 'seguro', texto: 'Presentado 14/10' })
  })
  it('borrador del 303 a compensar', () => {
    const t = tarjeta(modelo({ modelo: '303', declaracion: decl({ resultado: 'to_offset', importe: 900.00 }) }))
    expect(t.importe).toBe('−900,00 €')
    expect(t.chip).toEqual({ tono: 'accion', texto: 'Para revisar' })
  })
  it('revisado, sin calcular y no hace falta', () => {
    expect(tarjeta(modelo({ declaracion: decl({ estado: 'reviewed' }) })).chip.texto).toBe('Revisado · para presentar')
    expect(tarjeta(modelo({ declaracion: decl({ resultado: null, importe: null }) })).chip).toEqual({ tono: 'falta', texto: 'Sin calcular' })
    expect(tarjeta(modelo({ declaracion: decl({ estado: 'not_required' }) })).chip.texto).toBe('No hace falta')
  })
})

describe('la cartera, 3T 2026', () => {
  it('con el borrador al día: la cadena de los presentados da la [110] y el total suma lo que sale a compensar', () => {
    const c = cartera({
      filas: [F1T, F2T, fila('3T', { declaracion: 'd3', estado: 'draft', presentada: false, resultado: 'to_offset', importe: 900.00, c110: 2300.25, c78: 0, c87: 2300.25, origen110: 'calculated' }), fila('4T')],
      borrador: { id: 'd3', estado: 'draft', c110: 2300.25, origen110: 'calculated' },
    })
    const r = lineasCartera(t3(c))
    expect(r.lineas.map((l) => [l.texto, l.casilla ?? null, l.importe])).toEqual([
      ['Pendiente de 2025', null, 1500.00],
      ['1T 2026 · salió a compensar', null, 1200.50],
      ['2T 2026 · aplicado', null, -400.25],
      ['Pendiente al empezar el 3T', '110', 2300.25],
      ['Se aplica ahora', '78', 0],
      ['Queda de antes', '87', 2300.25],
    ])
    expect(r.total.texto).toBe('Total a compensar después del 3T')
    expect(r.total.importe).toBeCloseTo(3200.25, 2)
    expect(r.cuadra).toBe(true)
  })

  it('con el borrador desfasado ([110] a 0,00): enseña la que le toca y no inventa el resto', () => {
    const c = cartera({
      filas: [F1T, F2T, fila('3T', { declaracion: 'd3', estado: 'draft', presentada: false, resultado: 'zero', importe: 0, c110: 0, c78: 0, c87: 0, origen110: 'calculated' }), fila('4T')],
      borrador: { id: 'd3', estado: 'draft', c110: 0, origen110: 'calculated' },
      desfasada: true,
    })
    const r = lineasCartera(t3(c))
    expect(r.lineas.find((l) => l.casilla === '110')?.importe).toBe(2300.25)
    expect(r.lineas.find((l) => l.casilla === '78')?.importe).toBeNull()
    expect(r.lineas.find((l) => l.casilla === '87')?.importe).toBeNull()
    expect(r.total.importe).toBeNull()
    expect(r.cuadra).toBe(true)
    expect(fraseDesfasada(t3(c))).toBe('El borrador del 3T se calculó antes de tener el 2T/2026 presentado: tiene la [110] en 0,00 € y le tocan 2.300,25 €.')
  })

  it('si falta el 2T presentado, se dice y la cadena no se cierra', () => {
    const c = cartera({ filas: [F1T, fila('2T'), fila('3T'), fila('4T')], esperada_110: null })
    const r = lineasCartera(t3(c))
    expect(r.lineas.some((l) => l.texto === '2T 2026 · no está presentado en Sumied' && l.importe === null)).toBe(true)
    expect(r.cuadra).toBeNull()
    expect(r.lineas.find((l) => l.casilla === '110')?.importe).toBeNull()
  })

  it('sin el 1T ni el 4T de antes, «Pendiente de 2025» no se sabe', () => {
    const r = lineasCartera(t3(cartera({ pendiente_al_empezar: null })))
    expect(r.lineas[0]).toMatchObject({ texto: 'Pendiente de 2025', importe: null })
    expect(r.lineas[0].nota).toContain('falta el 303 del 4T de 2025')
    expect(r.cuadra).toBeNull()
  })

  it('una cadena que no casa lo dice', () => {
    const c = cartera({ esperada_110: { importe: 3000, de: '2T/2026' } })
    expect(lineasCartera(t3(c)).cuadra).toBe(false)
  })

  it('en el 1T no hay cadena que comprobar', () => {
    const r = lineasCartera({ ejercicio: 2026, trimestre: '1T', cartera: cartera() })
    expect(r.lineas.map((l) => l.texto)).toEqual(['Pendiente de 2025', 'Pendiente al empezar el 1T', 'Se aplica ahora', 'Queda de antes'])
    expect(r.lineas[1].importe).toBe(1500.00)
    expect(r.total.importe).toBeCloseTo(1500.00 + 1200.50, 2)
    expect(r.cuadra).toBeNull()
  })
})

describe('las frases', () => {
  it('el recálculo dice su cifra (regla 8)', () => {
    // Como la maqueta (Julio, 20/10): la cifra, de dónde viene y, sin libro, que el resultado aún no se sabe.
    expect(fraseRecalculado('3T', '2T/2026', 2300.25)).toBe('Vuelto a calcular el 3T: trae 2.300,25 € a compensar del 2T.')
    expect(fraseRecalculado('3T', '2T/2026', 2300.25, false)).toBe('Vuelto a calcular el 3T: trae 2.300,25 € a compensar del 2T. El resultado del IVA aún no se sabe: falta el libro de IVA del trimestre.')
    expect(fraseRecalculado('3T', '2T/2026', null)).toContain('sigue sin la [110]')
  })
  it('sin desfase, no hay frase', () => {
    const t: Pick<Trimestre, 'trimestre' | 'cartera'> = { trimestre: '3T', cartera: cartera() }
    expect(fraseDesfasada(t)).toBeNull()
  })
})
