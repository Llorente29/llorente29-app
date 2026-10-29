// tests/conta/s01b2/releer.test.ts
//
// S01b2 · Volver a leer la factura al darla de alta (Julio, 28/10). La forma de
// los datos es la de la lectura de verdad de la R0672 en producción: su
// proveedor guardado tiene «nombre», «nif», «email» y «direccion», sin las
// claves «telefono» ni «web» (leída antes del 28/10). Las 85 lecturas de
// Foodint están así. Los valores, inventados (el repositorio es público).

import { describe, expect, it } from 'vitest'
import { fraseRelectura, hayQueReleer, NO_VIENE_EN_LA_FACTURA } from '../../../src/modules/conta/lib/proveedorDesdeFactura'
import { leerFactura, type LecturaModelo } from '../../../supabase/functions/_shared/lecturaFactura'

const DE_ANTES = { nombre: 'Suministros del Ejemplo S.L.U.', nif: 'B12345674', email: null, direccion: 'Pol. Ind. Inventado, C/ Ejemplo 9, 11160 Barbate (Cádiz)' }

describe('S01b2 · cuándo se vuelve a leer su PDF', () => {
  it('una lectura de antes (sin las claves del teléfono ni la web) y con PDF: sí', () => {
    expect(hayQueReleer(DE_ANTES, true)).toBe(true)
    expect(hayQueReleer({ ...DE_ANTES, telefono: null }, true)).toBe(true)
  })
  it('ya leída con el lector de hoy, aunque la factura no traiga ni teléfono ni web (claves vacías): no', () => {
    expect(hayQueReleer({ ...DE_ANTES, telefono: null, web: null }, true)).toBe(false)
    expect(hayQueReleer({ ...DE_ANTES, telefono: '956 000 000', web: 'ejemplo.es' }, true)).toBe(false)
  })
  it('sin PDF guardado, o sin lectura: no hay nada que volver a leer', () => {
    expect(hayQueReleer(DE_ANTES, false)).toBe(false)
    expect(hayQueReleer(null, true)).toBe(false)
  })
})

describe('S01b2 · lo que dice (regla 8)', () => {
  it('lo que añade, con contenido', () => {
    expect(fraseRelectura(['telefono', 'web'])).toBe('He vuelto a leer la factura: añado el teléfono y la web.')
    expect(fraseRelectura(['telefono'])).toBe('He vuelto a leer la factura: añado el teléfono.')
    expect(fraseRelectura([])).toBe('He vuelto a leer la factura: no trae nada más del proveedor.')
  })
  it('un campo que no viene: el texto, no un ejemplo', () => {
    expect(NO_VIENE_EN_LA_FACTURA).toBe('No viene en la factura')
  })
})

describe('S01b2 · el lector deja siempre las claves y aprovecha el teléfono que ya pedía', () => {
  const modelo = (doc: Record<string, unknown>, factura: Record<string, unknown> = {}): LecturaModelo => ({
    document: { supplier_name: DE_ANTES.nombre, supplier_tax_id: DE_ANTES.nif, doc_number: 'R0001', doc_date: '2026-09-07', tax_base: 100, grand_total: 121, ...doc },
    taxes: [{ rate_pct: 21, base: 100, amount: 21 }],
    factura,
  } as unknown as LecturaModelo)
  it('sin teléfono ni web en el papel: las claves están, vacías (y así no se vuelve a leer)', () => {
    const p = leerFactura(modelo({}), { hoy: '2026-10-28' }).factura.proveedor
    expect('telefono' in p && 'web' in p).toBe(true)
    expect(p.telefono).toBeNull()
    expect(p.web).toBeNull()
  })
  it('el teléfono de la parte de siempre (supplier_phone del documento) si la de factura no lo trae', () => {
    expect(leerFactura(modelo({ supplier_phone: '956 000 000' }), { hoy: '2026-10-28' }).factura.proveedor.telefono).toBe('956 000 000')
    expect(leerFactura(modelo({ supplier_phone: '956 000 000' }, { supplier_phone: '956 111 111', supplier_website: 'www.ejemplo.es' }), { hoy: '2026-10-28' }).factura.proveedor)
      .toMatchObject({ telefono: '956 111 111', web: 'www.ejemplo.es' })
  })
})

describe('S01b2 · el formulario de alta no lleva ejemplos en gris', () => {
  it('ni en «Subir factura», ni en Revisar factura, ni en la recibida a mano, ni en «Nuevo proveedor»: el mismo formulario, sin un solo placeholder', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of ['src/modules/conta/proveedor/NuevoProveedorDialogo.tsx', 'src/modules/conta/documentos/ProveedorDesdeFactura.tsx']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/placeholder=/)
    }
  })
})
