// tests/unit/modules/conta/v01/cuotasGuardadas.test.ts
//
// V01b · El IVA del libro manda en los PDF de las facturas. Regla 31: las
// facturas son REALES, de las 108 traídas de Diez que «Hacer los PDF que
// faltan» no pudo hacer el 25/10 (producción, solo lectura: número, base, tipo
// e IVA del libro; ninguna lleva datos de nadie, son ventas a consumidor
// final). En las 108, Diez truncó el medio céntimo: 18,05 × 10 % = 1,805 → 1,80,
// y el cálculo redondeado da 1,81. Y tres que sí se hicieron, y la devolución
// GLV655836-20260913 (en negativo), de control.
//
// Por el camino de verdad: datosDelPdf (lo que pinta el PDF, de la factura
// guardada) → comprobarFactura → facturaVentaPdf.

import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import { comprobarFactura, facturaVentaPdf } from '../../../../../supabase/functions/_shared/facturaVentaPdf'
import { datosDelPdf, type FacturaGuardada } from '@/modules/conta/services/ventasService'
import { cifrasDe, cifrasGuardadas, type LineaFactura } from '@/modules/conta/lib/facturasVenta'

/** [número, base, IVA del libro (= el de la factura)] — todas al 10 %, una línea. */
const FALLARON: [string, number, number][] = [
  ['UBER-20260106', 1228.55, 122.85],
  ['3859910', 19.65, 1.96],
  ['3882008', 88.85, 8.88],
  ['3882064', 60.55, 6.05],
  ['3882176', 37.95, 3.79],
  ['3905892', 135.65, 13.56],
  ['3905921', 73.15, 7.31],
  ['3927311', 116.35, 11.63],
  ['3950189', 52.55, 5.25],
  ['GLV626666-20260913', 18.05, 1.80],
  ['GLV655836-20260819', 18.55, 1.85],
]
const SALIERON: [string, number, number][] = [
  ['UBR-FLO-20260927', 99.09, 9.91],
  ['UBR-FLO-20260926', 82.64, 8.26],
  ['UBR-FLO-20260925', 178.0, 17.8],
  ['GLV655836-20260913', -3.55, -0.35],
]

const EMPRESA = { nombre: 'Empresa de prueba', nif: 'B00000000', direccion: null }
const r2 = (x: number) => Math.round(x * 100) / 100

function traida(numero: string, base: number, iva: number, cuota: number | null): FacturaGuardada {
  return {
    id: `id-${numero}`, estado: 'emitida', rectificativa: false, corrige: null, origen: 'cierre_dia', serie: 'DIEZ', numero,
    fecha: '2026-09-13', vence: '2026-09-13', clienteId: null,
    cliente: { nombre: 'Ventas a consumidor final', nif: null, calle: null, cp: null, ciudad: null, provincia: null, correo: null, nifComprobado: false },
    localId: null, formaCobroId: null, notas: null, correo: null, retencionId: null, recargo: false,
    base, iva, recargoImporte: 0, retencion: 0, total: r2(base + iva), entryId: `asiento-${numero}`, pdf: null,
    enviadaEl: null, emitidaEl: null, emitidaPor: null, creadaPor: null,
    lineas: [{ id: `l-${numero}`, concepto: 'Ventas a consumidor final al 10 %', cantidad: 1, precio: base, descuento: 0, tipoId: 't10', tipo: 10, recargo: null, cuentaId: 'c705', importe: base, cuota }],
    eventos: [], cobros: [], rectificativas: [],
  }
}
const conNif = (d: ReturnType<typeof datosDelPdf>) => ({ ...d, cliente: { ...d.cliente, nif: 'consumidor final' } })

describe('las 11 traídas que fallaron el 25/10', () => {
  it.each(FALLARON)('%s: sin la cuota guardada, el PDF recalcula y no cuadra por un céntimo (lo de hoy)', (numero, base, iva) => {
    const mal = comprobarFactura(datosDelPdf(EMPRESA, traida(numero, base, iva, null), null, null))
    expect(mal).toEqual([`el IVA por tipos (${(iva + 0.01).toLocaleString('es-ES', { minimumFractionDigits: 2 })}) no es el IVA (${iva.toLocaleString('es-ES', { minimumFractionDigits: 2 })})`])
  })
  it.each(FALLARON)('%s: con la del libro guardada, cuadra y sale su PDF con el IVA declarado', (numero, base, iva) => {
    const d = datosDelPdf(EMPRESA, traida(numero, base, iva, iva), null, null)
    expect(d.porTipo).toEqual([{ tipo: 10, base, iva, recargo: 0 }])
    expect(comprobarFactura(d)).toEqual([])
    expect(new TextDecoder().decode(facturaVentaPdf(jsPDF, conNif(d)).slice(0, 5))).toBe('%PDF-')
  })
})

describe('las que ya salían', () => {
  it.each(SALIERON)('%s: igual con la cuota guardada que sin ella', (numero, base, iva) => {
    const sin = datosDelPdf(EMPRESA, traida(numero, base, iva, null), null, null)
    const con = datosDelPdf(EMPRESA, traida(numero, base, iva, iva), null, null)
    expect(con.porTipo).toEqual(sin.porTipo)
    expect(comprobarFactura(con)).toEqual([])
  })
})

describe('lo que no cuadra por otra cosa sigue sin PDF, con su motivo (regla 7)', () => {
  it('una cuota guardada que no suma el IVA de la factura: no se pinta, y dice cuál', () => {
    const d = datosDelPdf(EMPRESA, traida('UBER-20260106', 1228.55, 122.85, 120), null, null)
    expect(comprobarFactura(d)).toEqual(['el IVA por tipos (120,00) no es el IVA (122,85)'])
    expect(() => facturaVentaPdf(jsPDF, conNif(d))).toThrow(/UBER-20260106 no cuadra/)
  })
})

describe('la rectificativa de una traída resta lo declarado, no lo recalculado', () => {
  it('anular la GLV626666-20260913: −1,80 de IVA', () => {
    const original = traida('GLV626666-20260913', 18.05, 1.8, 1.8)
    const rect: FacturaGuardada = {
      ...traida('R5-2026/00001', 0, 0, null), rectificativa: true, base: -18.05, iva: -1.8, total: -19.85,
      corrige: { id: original.id, numero: original.numero, tipo: 'anular', motivo: 'Pedido devuelto' }, lineas: [],
    }
    const d = datosDelPdf(EMPRESA, rect, original, null)
    expect(d.porTipo).toEqual([{ tipo: 10, base: -18.05, iva: -1.8, recargo: 0 }])
    expect(comprobarFactura(d)).toEqual([])
  })
})

describe('cifrasGuardadas', () => {
  const L = (o: Partial<LineaFactura> & { cuota: number | null }): LineaFactura & { cuota: number | null } =>
    ({ concepto: 'x', cantidad: 1, precio: 0, descuento: 0, tipoId: 't10', tipo: 10, recargo: null, cuentaId: 'c705', ...o })
  it('un borrador (sin cuotas) da lo mismo que cifrasDe', () => {
    const ls = [L({ precio: 10.35, cantidad: 3, cuota: null }), L({ precio: 12.45, tipo: 21, tipoId: 't21', cuota: null })]
    expect(cifrasGuardadas(ls)).toEqual(cifrasDe(ls, false, 0))
  })
  it('si una línea del tipo no la lleva, ese tipo se calcula; el otro, el guardado', () => {
    const ls = [L({ precio: 18.05, cuota: 1.8 }), L({ precio: 18.05, tipo: 21, tipoId: 't21', cuota: null }), L({ precio: 1, tipo: 21, tipoId: 't21', cuota: 0.21 })]
    const c = cifrasGuardadas(ls)
    expect(c.porTipo).toEqual([{ tipo: 21, base: 19.05, iva: 4, recargo: 0 }, { tipo: 10, base: 18.05, iva: 1.8, recargo: 0 }])
    expect(c.iva).toBe(5.8)
    expect(c.total).toBe(42.9)
  })
  it('con retención: el total resta la retención, como cifrasDe', () => {
    const ls = [L({ precio: 1000, tipo: 21, tipoId: 't21', cuota: 210 })]
    expect(cifrasGuardadas(ls, 15)).toEqual(cifrasDe(ls, false, 15))
  })
})
