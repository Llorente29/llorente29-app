// tests/unit/modules/conta/v03/ventasSinIva.test.ts
//
// V03 · E2 · Las ventas sin IVA, sin pintar: dónde está el cliente, qué se le
// ofrece (tablero 27), la frase del PDF y lo que se manda a la base.
// Regla 31: la UE se lee de la BASE (_verifactu_es_ue, en la 2140), no de una
// copia: si el front y la base no dicen lo mismo, la pantalla ofrecería algo que
// la emisión rechaza. Los clientes de Foodint (26/10) son 3, los 3 de España; el
// de fuera es el de Suiza de la prueba de staging de la 0146.

import { readFileSync } from 'node:fs'
import { jsPDF } from 'jspdf'
import { describe, expect, it } from 'vitest'
import { asientoPrevio, cifrasDe, faltaParaEmitir, lineasLeidas, type LineaFactura } from '@/modules/conta/lib/facturasVenta'
import { MENCION_SIN_IVA, aTipoVenta, dePorque, opcionesSinIva, porqueNoVale, zonaDelCliente } from '@/modules/conta/lib/ventasSinIva'
import { facturaVentaPdf, type DatosFacturaPdf } from '../../../../../supabase/functions/_shared/facturaVentaPdf'

const UE_DE_LA_BASE = (() => {
  const sql = readFileSync('supabase/migrations/20261025T2140_v03_verifactu_motor.sql', 'utf8')
  const m = /function public\._verifactu_es_ue[\s\S]*?in \(([^)]*)\)/.exec(sql)
  if (!m) throw new Error('No encuentro _verifactu_es_ue en la 2140')
  return m[1].split(',').map((x) => x.trim().replace(/'/g, ''))
})()

describe('dónde está el cliente', () => {
  it('los de Foodint (España) y sin país: España', () => {
    expect(zonaDelCliente('ES')).toBe('espana')
    expect(zonaDelCliente(null)).toBe('espana')
    expect(zonaDelCliente('  es ')).toBe('espana')
  })
  it('Suiza (la de la prueba de staging): fuera de la UE', () => {
    expect(zonaDelCliente('CH')).toBe('fuera')
  })
  it('cada país que la base cuenta como UE es UE aquí (salvo los códigos que no son un país: EL y XI)', () => {
    const paises = UE_DE_LA_BASE.filter((p) => p !== 'ES' && p !== 'EL' && p !== 'XI')
    expect(paises.length).toBe(26) // los 27 Estados menos España, con Grecia como GR
    for (const p of paises) expect(zonaDelCliente(p), p).toBe('ue')
  })
})

describe('qué se le ofrece', () => {
  it('fuera de la UE, como el tablero 27: un servicio a una empresa, mercancía que sale, otra cosa', () => {
    expect(opcionesSinIva('fuera').map((o) => o.codigo)).toEqual(['N2', 'E2', 'E1'])
    expect(opcionesSinIva('fuera')[0]).toMatchObject({ titulo: 'Un servicio a una empresa', texto: 'No sujeta a IVA en España: se tributa donde está el cliente' })
    expect(opcionesSinIva('fuera')[1]).toMatchObject({ titulo: 'Mercancía que sale de España', texto: 'Exportación, exenta de IVA' })
  })
  it('en la UE, la entrega intracomunitaria en vez de la exportación; en España, solo el art. 20', () => {
    expect(opcionesSinIva('ue').map((o) => o.codigo)).toEqual(['N2', 'E5', 'E1'])
    expect(opcionesSinIva('espana').map((o) => o.codigo)).toEqual(['E1'])
  })
  it('lo que no vale se dice con la frase de la base', () => {
    expect(porqueNoVale('E2', 'espana')).toContain('Una exportación es una venta a fuera de la UE')
    expect(porqueNoVale('N2', 'espana')).toContain('es para un cliente de fuera de España')
    expect(porqueNoVale('E5', 'fuera')).toContain('Una entrega intracomunitaria es a otro país de la UE')
    expect(porqueNoVale('N2', 'fuera')).toBeNull()
    expect(porqueNoVale(null, 'fuera')).toBeNull()
  })
})

describe('lo que va a la base y lo que vuelve', () => {
  it('N2 es una calificación; E1, E2 y E5, exenciones', () => {
    expect(aTipoVenta('N2')).toEqual({ calificacion: 'N2' })
    expect(aTipoVenta('E2')).toEqual({ exenta: 'E2' })
    expect(aTipoVenta(null)).toBeNull()
    expect(dePorque('N2', null)).toBe('N2')
    expect(dePorque(null, 'E5')).toBe('E5')
    expect(dePorque('S1', null)).toBeNull()
  })
})

describe('el borrador con una línea sin IVA', () => {
  const tipos = [{ id: 't21', tipo: 21 }, { id: 't0', tipo: 0, sinIva: true }]
  const { lineas } = lineasLeidas([
    { concepto: 'Asesoría de cocina', cantidad: '1', precio: '2150', descuento: '', tipoId: 't0', cuentaId: 'c705' },
    { concepto: 'Comida del equipo (en España)', cantidad: '1', precio: '100', descuento: '', tipoId: 't21', cuentaId: 'c705' },
  ], tipos)
  it('falta decir por qué, y con un porqué que no vale, otro', () => {
    const base = { clienteId: 'x', nif: 'CHE123456789', lineas }
    expect(faltaParaEmitir({ ...base, sinIva: { hay: true, porque: null, noVale: null } })).toContain('decir por qué va sin IVA')
    expect(faltaParaEmitir({ ...base, sinIva: { hay: true, porque: 'E2', noVale: 'no' } })).toContain('otro porqué para ir sin IVA')
    expect(faltaParaEmitir({ ...base, sinIva: { hay: true, porque: 'N2', noVale: null } })).toEqual([])
  })
  it('el asiento previo, como la 0146 en staging: 430 2.271, la 705 partida (2.150 sin IVA y 100), una sola 477 de 21', () => {
    const a = asientoPrevio(cifrasDe(lineas as LineaFactura[], false, 0), lineas, 'Alpen Gastro AG', [{ id: 'c705', code: '70500000', nombre: 'Prestación de servicios' }])
    expect(a).toEqual([
      { codigo: '430', nombre: 'Clientes · Alpen Gastro AG', debe: 2271, haber: null },
      { codigo: '70500000', nombre: 'Prestación de servicios · sin IVA', debe: null, haber: 2150 },
      { codigo: '70500000', nombre: 'Prestación de servicios', debe: null, haber: 100 },
      { codigo: '477', nombre: 'IVA repercutido 21 %', debe: null, haber: 21 },
    ])
  })
})

describe('el PDF dice por qué va sin IVA', () => {
  const D: DatosFacturaPdf = {
    empresa: { nombre: 'Restaurante Prueba V03 SL', nif: 'B28000016', direccion: null },
    numero: 'F-2026/000005', fecha: '2026-10-26', vence: null, formaCobro: null,
    cliente: { nombre: 'Alpen Gastro AG', nif: 'CHE123456789', direccion: null },
    lineas: [{ concepto: 'Asesoría de cocina', cantidad: 1, precio: 2150, descuento: 0, tipo: 0, importe: 2150 }],
    porTipo: [{ tipo: 0, base: 2150, iva: 0, recargo: 0 }], base: 2150, iva: 0, recargo: 0, retencion: null, total: 2150, notas: null, rectifica: null,
  }
  const texto = (b: Uint8Array) => new TextDecoder('latin1').decode(b)
  it('con su artículo, y sin porqué no lo inventa', () => {
    expect(texto(facturaVentaPdf(jsPDF, { ...D, sinIva: MENCION_SIN_IVA.N2 }))).toContain('arts. 69 y 70 de la Ley 37/1992')
    expect(texto(facturaVentaPdf(jsPDF, D))).not.toContain('Ley 37/1992')
  })
})
