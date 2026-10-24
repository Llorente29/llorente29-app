// E05 · El asiento de una factura de lote de Catcher (riders y flotas).
//
// RIDERS es una ficha genérica (la 41000100, sin NIF): el NIF del emisor va en
// cada factura, la factura no tiene líneas (solo su IVA por tipo) y las de
// «Varios locales» se parten a partes iguales (Julio, 21/10).
//
// Cifras REALES de la 1.ª quincena de octubre de Foodint (regla 31), medidas
// en producción el 21/10, sin nombres ni NIF: las 83 cuadran (base + IVA =
// total, un tipo, el 21 %, y la cuota redondeada), y estas son las tres de
// «Varios locales» de RIDERS y la mayor de un solo local.
import { describe, expect, it } from 'vitest'
import { cuadre } from '@/modules/conta/lib/libro'
import { deLaFacturaDeLote, facturaProveedor, type EntradaFactura } from '@/modules/conta/lib/asientosPropuestos'

const ALCALA = '38158159-cd71-4056-950b-53425afac1ce'
const CARABANCHEL = '92d7656e-082e-452a-8ebc-236b2d6ebf5f'
const LOCALES: Record<string, string> = { [ALCALA]: 'Foodint Alcalá', [CARABANCHEL]: 'Foodint Carabanchel' }
const IVA = { cuenta: '47200021', tipoId: 't21' }
const cf = { proveedor: '41000100', retencion: '47510000', ivaSoportado: (p: number) => (p === 21 ? IVA : null) }
const tipoDe = (p: number) => (p === 21 ? { id: 't21', rate: 21 } : null)

/** Una factura de lote como la lee el servicio (supplier_invoice con sus relaciones). */
function fila(total: number, base: number, cuota: number, reparto: { localId: string; tienda: string }[] | null) {
  return {
    total,
    f: {
      issuer_name: 'Rider de la quincena', issuer_tax_id: 'Z0000000T',
      supplier_invoice_line: [], supplier_invoice_tax: [{ vat_pct: 21, base, vat_amount: cuota }],
      reading: { lote: { tipo: 'rider', ...(reparto ? { reparto: reparto.map((x) => ({ ...x, total: 1 })) } : {}) } },
    },
  }
}
function entrada(x: ReturnType<typeof fila>, localId: string | null): EntradaFactura {
  const l = deLaFacturaDeLote(x.f, '62400001', tipoDe, (id) => LOCALES[id] ?? null)
  return {
    id: 'si', numero: 'R-1', fecha: '2026-10-15', proveedor: l.proveedor ?? 'RIDERS', terceroId: null, esSocio: false,
    // La ficha RIDERS no tiene NIF: el que vale es el de la factura.
    tieneNif: l.tieneNif || false, localId, total: x.total, retencion: null, lineas: l.lineas!, cuotas: l.cuotas, reparto: l.reparto,
  }
}
const varios = [{ localId: CARABANCHEL, tienda: 'FoodInt Camichi' }, { localId: ALCALA, tienda: 'FoodInt Florencio Llorente' }]

describe('la factura de un rider de Catcher', () => {
  it('se propone con el NIF de la factura, aunque la ficha RIDERS no tenga NIF', () => {
    const r = facturaProveedor(entrada(fila(160.43, 132.59, 27.84, null), ALCALA), cf)
    expect(r.sinPropuesta).toBeNull()
    // Sin NIF en la factura (ni en la ficha), no: el IVA no se deduciría.
    const sinNif = fila(160.43, 132.59, 27.84, null); sinNif.f.issuer_tax_id = ''
    expect(facturaProveedor(entrada(sinNif, ALCALA), cf).sinPropuesta).toBe('A Rider de la quincena le falta el NIF: ponlo en su ficha. Sin él no se puede deducir el IVA.')
  })

  it('sin líneas: el gasto sale de su IVA por tipo, a la 62400001, con la cuota de la factura; cuadra', () => {
    const p = facturaProveedor(entrada(fila(160.43, 132.59, 27.84, null), ALCALA), cf).propuesta!
    expect(p.lineas.map((l) => [l.cuenta, l.debe, l.haber, l.localId])).toEqual([
      ['62400001', 132.59, 0, ALCALA], ['47200021', 27.84, 0, ALCALA], ['41000100', 0, 160.43, ALCALA]])
    expect(p.lineas[1].iva).toMatchObject({ base: 132.59, tipo: 21, libro: 'received' })
    expect([cuadre(p.lineas).cuadra, p.confianza, p.avisos]).toEqual([true, 'seguro', []])
    expect(p.concepto).toBe('Factura Rider de la quincena · R-1')
  })

  it('«Varios locales»: el gasto a partes iguales entre los dos locales del lote; el IVA y el proveedor, comunes', () => {
    for (const [total, base, cuota, mitad] of [[24.18, 19.98, 4.2, 9.99], [19.92, 16.46, 3.46, 8.23], [13.84, 11.44, 2.4, 5.72]] as const) {
      const p = facturaProveedor(entrada(fila(total, base, cuota, varios), null), cf).propuesta!
      expect(p.lineas.map((l) => [l.cuenta, l.debe, l.haber, l.localId ?? null, l.comun])).toEqual([
        ['62400001', mitad, 0, CARABANCHEL, false], ['62400001', mitad, 0, ALCALA, false],
        ['47200021', cuota, 0, null, true], ['41000100', 0, total, null, true]])
      expect(cuadre(p.lineas).cuadra).toBe(true)
      // Ya no es «Común: el informe la reparte», ni la baja a probable por eso.
      expect(p.razones.map((x) => x.decision)).toContain('Gasto a partes iguales: Foodint Carabanchel y Foodint Alcalá')
      expect(p.razones.map((x) => x.decision)).not.toContain('Común')
      expect(p.confianza).toBe('seguro')
    }
  })

  it('un céntimo que no se divide va al primer local (caso de borde, no está en la quincena real)', () => {
    const p = facturaProveedor(entrada(fila(12.11, 10.01, 2.1, varios), null), cf).propuesta!
    expect(p.lineas.filter((l) => l.cuenta === '62400001').map((l) => l.debe)).toEqual([5.01, 5])
    expect(cuadre(p.lineas).cuadra).toBe(true)
  })

  it('una factura con líneas (no de lote) no cambia: sus líneas mandan', () => {
    const l = deLaFacturaDeLote({ supplier_invoice_line: [{ line_amount: 1 }], supplier_invoice_tax: [] }, '62400001', tipoDe, () => null)
    expect(l.lineas).toBeUndefined()
  })
})
