// tests/unit/modules/configuracion/facturasPedidos.test.ts
//
// V04 · PR 1 · Lo que dice Ajustes › «Facturas de los pedidos» (tablero 4), a
// partir de lo que devuelve ticket_invoice_ajustes (2309), con los locales y
// las marcas de Foodint del 26/10.

import { describe, expect, it } from 'vitest'
import {
  codigoNoVale, estadoLocal, facturaDeMarca, leerAjustes, prefijo, textoVerifactu, ultimoTexto,
} from '@/modules/configuracion/lib/facturasPedidos'

const crudo = {
  'año': 2026,
  empresas: [{ company_id: 'e1', nombre: 'Llorente29 Food, S.L.', nif: 'B56496938', verifactu: 'apagado', conexion_probada: false }],
  locales: [
    { location_id: 'l1', nombre: 'Foodint Carabanchel', activo: true, codigo: 'CA', propuesto: 'CA', serie: 'CA26-000001', ultimo: 123, rectificativas: 'CA26-R-000001', ultimo_r: null, numeros: 123 },
    { location_id: 'l2', nombre: 'Foodint Alcalá', activo: true, codigo: null, propuesto: 'AL', serie: null, ultimo: null, numeros: 0 },
    { location_id: 'l3', nombre: 'Foodint Plaza Castilla', activo: false, codigo: 'PL', propuesto: 'PL', serie: 'PL26-000001', ultimo: null, numeros: 0 },
  ],
  marcas: [{ brand_id: 'b1', nombre: 'Meraki Pita', propia: true, emisor: null }, { brand_id: 'b2', nombre: 'Birria Burrito', propia: false, emisor: 'CLOUDTOWN BRANDS SL' }],
  cedidas_sin_factura_7d: 0,
}

describe('V04 · Ajustes › Facturas de los pedidos', () => {
  const a = leerAjustes(crudo)

  it('lee lo de la base sin perder nada (un local cerrado también sale: regla 7)', () => {
    expect(a.locales.map((l) => [l.nombre, l.activo, l.codigo])).toEqual([['Foodint Carabanchel', true, 'CA'], ['Foodint Alcalá', true, null], ['Foodint Plaza Castilla', false, 'PL']])
    expect(a.marcas.map((m) => m.propia)).toEqual([true, false])
    expect(a.año).toBe(2026)
  })

  it('la serie: el prefijo y el último número como se imprime', () => {
    expect(prefijo('CA26-000001')).toBe('CA26-')
    expect(prefijo('CA26-R-000001')).toBe('CA26-R-')
    expect(ultimoTexto('CA26-000001', 123)).toBe('CA26-000123')
    expect(ultimoTexto('CA26-000001', null)).toBeNull()
  })

  it('cada local dice qué pasa con sus tiques', () => {
    expect(estadoLocal(a.locales[0])).toBe('Último número: CA26-000123.')
    expect(estadoLocal(a.locales[1])).toMatch(/^Sin código: sus tiques salen como hoy/)
    expect(estadoLocal(a.locales[2])).toBe('Numera desde el próximo tique: PL26-000001.')
  })

  it('Verifactu: el estado y dónde se enciende (Sumied), y si falta la conexión', () => {
    expect(textoVerifactu(a.empresas[0])).toEqual({ chip: 'Verifactu: apagado', tono: 'neutro',
      frase: 'Se enciende en Sumied › Ajustes › Verifactu, para toda la empresa. Falta la prueba de conexión con Hacienda (el certificado).' })
    expect(textoVerifactu({ ...a.empresas[0], verifactu: 'real' }).chip).toBe('Verifactu: real')
  })

  it('el código: 2 o 3 letras, sin acentos ni números', () => {
    expect(codigoNoVale('ca')).toBeNull()
    expect(codigoNoVale('ALC')).toBeNull()
    expect(codigoNoVale('A1')).toMatch(/2 o 3 letras/)
    expect(codigoNoVale('ÁL')).toMatch(/2 o 3 letras/)
    expect(codigoNoVale('')).toBe('Escribe el código del local.')
  })

  it('las marcas: propias por nuestra serie, cedidas por el socio', () => {
    expect(facturaDeMarca(a.marcas[0])).toEqual({ deQuien: 'Propia', suFactura: 'Nuestra serie, la del local que la prepara' })
    expect(facturaDeMarca(a.marcas[1])).toEqual({ deQuien: 'Cedida · CLOUDTOWN BRANDS SL', suFactura: 'La emite CLOUDTOWN BRANDS SL desde Last' })
    expect(facturaDeMarca({ ...a.marcas[1], emisor: null }).suFactura).toBe('La emite el socio desde Last')
  })
})
