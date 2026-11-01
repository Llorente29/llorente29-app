// tests/conta/s01j2/correoYFicha.test.ts
//
// S01j·2 · Lo que dice Correo de facturas de cada llegada y lo que dice la
// ficha de una liquidación. Las formas son las de la base (conta_correo_facturas
// y conta_liquidacion_ficha) y las cifras, las de casos medidos en Foodint el
// 01/11 (regla 31), sin nombres: una de Glovo que cuadra (ventas 183,50,
// comisión −56,10, otros 36, neto 163,40) y una de Just Eat con saldo negativo
// (ventas 0, comisión −5,98, otros −5,98, neto 0), que no suma y se dice.

import { describe, expect, it } from 'vitest'
import { accionesDeLlegada, frasePago, periodoCorto, queSalio } from '@/modules/conta/lib/correoFacturas'
import { deDondeSalio, deLaBase, sumaFicha, tituloFicha, type FichaLiquidacion } from '@/modules/conta/lib/fichaLiquidacion'
import type { LlegadaCorreo } from '@/modules/conta/services/comprasService'

const base: LlegadaCorreo = {
  fecha: '2026-10-20T07:12:00Z', de: 'facturas@glovoapp.test', asunto: 'Factura', resultado: 'recibido', llegada: 'leida', motivo: null,
  factura: { id: 'f1', codigo: 'FAC-00171', numero: 'FAC-00171', total: 43.23, proveedor: 'Plataforma Inventada', casada: false }, dicho: null,
  email_id: 'e1', plataforma: 'glovo', excel: 'leido',
  liquidaciones: [{ id: 'l1', plataforma: 'Glovo', tienda: 'Marca Inventada', local: 'Local Inventado', desde: '2026-10-01', hasta: '2026-10-15', neto: 236.27, pago_el: '2026-10-22' }],
  factura_comision: null,
}

describe('qué salió de cada correo', () => {
  it('la factura y la liquidación de Glovo, ligadas, con lo que te ingresa', () => {
    const q = queSalio(base)
    expect(q.titulo).toBe('Factura FAC-00171 y liquidación de Glovo · Marca Inventada · Local Inventado · 1–15/10')
    expect(q.texto).toBe('te ingresa 236,27 €')
    expect(q.chip).toEqual({ texto: 'Ligadas · se paga el 22/10', tono: 'bien' })
  })
  it('el mismo Excel reenviado: dice que ya había entrado, no que falta', () => {
    const q = queSalio({ ...base, liquidaciones: [{ ...base.liquidaciones![0], otro_correo: true }] })
    expect(q.texto).toBe('Ya había entrado con otro correo: no se ha creado otra. Te ingresa 236,27 €.')
  })
  it('el Excel que se quedó sin leer: lo dice y cómo arreglarlo, sin esconderlo', () => {
    const q = queSalio({ ...base, excel: 'sin_leer', liquidaciones: [] })
    expect(q.chip).toEqual({ texto: 'Falta leer el Excel', tono: 'falta' })
    expect(q.texto).toContain('Vuelve a leerlo desde el ⋯')
  })
  it('el correo que solo traía el PDF: la liquidación sigue faltando', () => {
    const q = queSalio({ ...base, excel: 'no_traia', liquidaciones: [] })
    expect(q.titulo).toBe('Factura FAC-00171 de Glovo')
    expect(q.chip).toEqual({ texto: 'Falta la liquidación', tono: 'falta' })
  })
  it('Just Eat con su factura de comisión en revisión: lo dice con su nota', () => {
    const q = queSalio({ ...base, plataforma: 'justeat', excel: null, factura: null,
      factura_comision: { id: 'f2', codigo: null, numero: 'JE-0000001', total: 32.9, en_revision: true, nota: 'La factura no suma: queda en revisión.' },
      liquidaciones: [{ ...base.liquidaciones![0], plataforma: 'Just Eat', neto: 53.74 }] })
    expect(q.chip).toEqual({ texto: 'En revisión · la factura', tono: 'mira' })
    expect(q.texto).toBe('La factura no suma: queda en revisión.')
  })
  it('lo que no es de una plataforma sigue diciendo lo de siempre', () => {
    const q = queSalio({ ...base, plataforma: null, excel: null, liquidaciones: [], factura: { ...base.factura!, casada: true } })
    expect(q.titulo).toContain('Factura leída y casada')
  })
  it('un saldo negativo dice que le debes, no que te ingresa', () => {
    expect(frasePago(-5.98)).toBe('le debes 5,98 €')
    expect(frasePago(null)).toBeNull()
  })
  it('el periodo, corto', () => {
    expect(periodoCorto('2026-10-01', '2026-10-15')).toBe('1–15/10')
    expect(periodoCorto('2026-09-16', '2026-10-15')).toBe('16/09–15/10')
    expect(periodoCorto(null, null)).toBeNull()
  })
  it('el ⋯ solo ofrece lo que tiene sentido', () => {
    expect(accionesDeLlegada(base)).toEqual(['releer', 'releer_plataforma', 'factura', 'liquidacion'])
    expect(accionesDeLlegada({ ...base, resultado: 'confirmacion', plataforma: null, factura: null, liquidaciones: [] })).toEqual([])
  })
})

const ficha = (x: Partial<Record<string, unknown>>): FichaLiquidacion => deLaBase({
  id: 'l1', plataforma: 'Glovo', canal_id: 'c1', marca: 'Marca Inventada', local: 'Local Inventado', local_id: 'lo1', tienda: 'Marca Inventada',
  referencia: null, desde: '2026-07-16', hasta: '2026-07-31', sin_periodo: false, origen: 'excel_glovo',
  pedidos: 8, ventas: '183.5', comision: '-56.1', otros: '36', neto: '163.4', pago_el: '2026-08-01', cobrado_el: null, cobrado: null,
  factura: null, correo: null, revisar: null, ...x,
})

describe('la ficha de una liquidación', () => {
  it('la de Glovo medida suma: ventas + comisión + otros = lo que te ingresa', () => {
    expect(sumaFicha(ficha({}))).toEqual({ suma: true, texto: null })
    expect(tituloFicha(ficha({}))).toBe('Glovo · Marca Inventada · Local Inventado · del 16/07 al 31/07/2026')
  })
  it('la de Just Eat con saldo negativo no suma, y lo dice con los números (no se esconde)', () => {
    const s = sumaFicha(ficha({ ventas: '0', comision: '-5.98', otros: '-5.98', neto: '0', origen: 'correo_justeat' }))
    expect(s.suma).toBe(false)
    expect(s.texto).toBe('Las cifras no suman: ventas 0,00 €, comisión −5,98 € y otros −5,98 € dan −11,96 €, y la liquidación dice 0,00 €. Míralo en su correo.')
  })
  it('sin ventas no se puede saber si suma, y no se inventa', () => {
    expect(sumaFicha(ficha({ ventas: null }))).toEqual({ suma: null, texto: null })
  })
  it('la antigua: «Sin periodo: vino de un fichero antiguo»', () => {
    const f = ficha({ sin_periodo: true, desde: null, hasta: null, origen: 'import_csv_glovo' })
    expect(tituloFicha(f)).toBe('Glovo · Marca Inventada · Local Inventado · sin periodo')
    expect(deDondeSalio(f)).toMatch(/^Sin periodo: vino de un fichero antiguo/)
  })
  it('la del correo dice de qué correo salió; si su Excel se quedó sin leer, también', () => {
    const f = ficha({ correo: { email_id: 'e1', fecha: '2026-10-20T07:12:00Z', de: 'facturas@glovoapp.test', asunto: 'Factura', a: 'facturas-prueba@entrada.test',
      adjuntos: [{ nombre: 'invoice-000000000001.XLSX', porque: 'no es un PDF ni una foto' }], company_id: null } })
    expect(deDondeSalio(f)).toBe('Del correo «Factura» que llegó a facturas-prueba@entrada.test de facturas@glovoapp.test. Su Excel invoice-000000000001.XLSX se quedó sin leer al llegar: vuelve a leer el correo.')
  })
})
