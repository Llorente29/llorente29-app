// tests/unit/modules/conta/k10b/cabecera.test.ts
//
// K10b · La cabecera de la recibida (src/modules/conta/nucleo/recibida/cabecera.ts): el trimestre en que se
// deduce (abierto, presentado y elegido), el origen del tipo de operación y la clase con que se propone el asiento.
import { describe, expect, it } from 'vitest'
import {
  OPERACIONES, claseParaElAsiento, operacionDeLaClase, origenOperacion, presentadosDe, trimestrePropuesto, trimestresParaElegir,
} from '@/modules/conta/nucleo/recibida/cabecera'
import { etiquetaDelAsiento } from '@/modules/conta/nucleo/recibida/estado'

const nada = new Set<string>()
const tresT = new Set(['2026-3T'])

describe('el trimestre en que se deduce', () => {
  it('abierto: el de su fecha, sin aviso', () => {
    expect(trimestrePropuesto({ fecha: '2026-09-15', deduceEn: null, presentados: nada }))
      .toEqual({ trimestre: { inicio: '2026-07-01', texto: '3T de 2026', corto: '3T', presentado: false }, aviso: null, elegido: false })
  })
  it('presentado: el primero abierto, y lo dice con una frase', () => {
    const p = trimestrePropuesto({ fecha: '2026-09-15', deduceEn: null, presentados: tresT })
    expect(p.trimestre?.texto).toBe('4T de 2026')
    expect(p.aviso).toBe('El 3T ya está presentado: va al 4T.')
    expect(p.elegido).toBe(false)
  })
  it('elegido: el que se eligió, si no está presentado', () => {
    const p = trimestrePropuesto({ fecha: '2026-10-16', deduceEn: '2027-01-01', presentados: nada })
    expect(p).toEqual({ trimestre: { inicio: '2027-01-01', texto: '1T de 2027', corto: '1T', presentado: false }, aviso: null, elegido: true })
  })
  it('elegido uno que después se presentó: vuelve al propuesto, nunca a uno presentado', () => {
    const p = trimestrePropuesto({ fecha: '2026-09-15', deduceEn: '2026-07-01', presentados: tresT })
    expect(p.trimestre?.texto).toBe('4T de 2026')
    expect(p.elegido).toBe(false)
  })
  it('los que se ven: el suyo y los cuatro siguientes, pasando de año, con el presentado marcado', () => {
    expect(trimestresParaElegir('2026-09-15', tresT).map((t) => `${t.texto}${t.presentado ? ' · presentado' : ''}`))
      .toEqual(['3T de 2026 · presentado', '4T de 2026', '1T de 2027', '2T de 2027', '3T de 2027'])
  })
  it('un 303 mensual cuenta para su trimestre solo con los tres meses', () => {
    expect([...presentadosDe([{ ejercicio: 2026, periodo: '07' }, { ejercicio: 2026, periodo: '08' }])]).toEqual([])
    expect([...presentadosDe([{ ejercicio: 2026, periodo: '07' }, { ejercicio: 2026, periodo: '08' }, { ejercicio: 2026, periodo: '09' }, { ejercicio: 2026, periodo: '2T' }])].sort())
      .toEqual(['2026-2T', '2026-3T'])
  })
})

describe('el tipo de operación: «De su ficha» o «Cambiado en esta factura»', () => {
  it('sin tipo en la factura, el de su ficha', () => {
    expect(origenOperacion(null, 'interior')).toBe('De su ficha')
  })
  it('el mismo que su ficha, escrito en la factura, sigue siendo «De su ficha»', () => {
    expect(origenOperacion('interior', 'interior')).toBe('De su ficha')
  })
  it('otro: «Cambiado en esta factura»', () => {
    expect(origenOperacion('intra_servicios', 'interior')).toBe('Cambiado en esta factura')
  })
  it('sin ficha y sin tipo, nada', () => {
    expect(origenOperacion(null, null)).toBeNull()
  })
})

describe('la clase con que se propone el asiento', () => {
  it('el de su ficha si la factura no tiene', () => {
    expect(claseParaElAsiento(null, 'isp_extranjero')).toBe('isp_extranjero')
    expect(operacionDeLaClase('nacional')).toBe('interior')
    expect(operacionDeLaClase('ue_sin_nif_iva')).toBeNull()
  })
  it('el de la factura manda: intracomunitaria de servicios a uno de España se autoliquida', () => {
    expect(claseParaElAsiento('intra_servicios', 'nacional')).toBe('intracomunitaria')
    expect(claseParaElAsiento('exenta', 'intracomunitaria')).toBe('nacional')
  })
  it('los nombres cortos caben en la casilla (como mucho 19 letras) y los seis tipos de ERP10 están', () => {
    expect(OPERACIONES.map((o) => o.valor)).toEqual(['interior', 'isp_interior', 'intra_bienes', 'intra_servicios', 'fuera_ue', 'exenta'])
    for (const o of OPERACIONES) expect(o.corto.length, o.corto).toBeLessThanOrEqual(19)
  })
})

describe('sin propuesta, la ficha lo dice (regla 8)', () => {
  it('sin propuesta y sin nada escrito: «Sin propuesta» en ámbar, nunca «Se forma al escribir»', () => {
    expect(etiquetaDelAsiento({ debe: 0, haber: 0, cuadra: false, faltan: [], lineas: 0, sinPropuesta: 'A Proveedor de Prueba le falta el NIF.' }))
      .toEqual({ texto: 'Sin propuesta', tono: 'ambar' })
  })
  it('sin propuesta pero con lo escrito a mano: manda lo escrito (regla 30)', () => {
    expect(etiquetaDelAsiento({ debe: 100, haber: 100, cuadra: true, faltan: [], lineas: 2, sinPropuesta: 'A Proveedor de Prueba le falta el NIF.' }).texto).toMatch(/^Cuadra/)
  })
  it('con propuesta y nada escrito, lo de siempre', () => {
    expect(etiquetaDelAsiento({ debe: 0, haber: 0, cuadra: false, faltan: [], lineas: 0 })).toEqual({ texto: 'Se forma al escribir', tono: 'vacio' })
  })
})
