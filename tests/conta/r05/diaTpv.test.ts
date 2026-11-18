// R05 · Un día del TPV en Cierres del día: la fila de la lista (lib/cierres.ts),
// su PDF «Resumen de ventas» (lib/resumenVentasTpvPdf.ts) y la condición de la
// barra (esqueleto/productos.ts). Contra el ejemplo INVENTADO de Revo (el del
// R04, tests/conta/r04/revo_ejemplo), leído con el lector de verdad.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { jsPDF } from 'jspdf'
import { leerRevo } from '../../../src/modules/conta/lib/lectorRevo'
import { cierreTpvDeFila, cobradoTpv, listos, numeracionTpv, resumenDeAyer, subidoTpv, filtrarCierres } from '../../../src/modules/conta/lib/cierres'
import { comprobarResumenTpv, datosResumenTpv, nombreFicheroTpv, resumenVentasTpvPdf, type ParaValidarTpv } from '../../../src/modules/conta/lib/resumenVentasTpvPdf'
import { PRODUCTOS, cumple, pestanasVisibles, type Contexto } from '../../../src/modules/conta/esqueleto/productos'

const DIR = resolve(__dirname, '../r04/revo_ejemplo')
const lectura = (() => {
  const r = leerRevo(['Ordenes', 'Documentos', 'Impuestos', 'Pagos'].map((n) => ({ nombre: `${n}_2026-11-09.csv`, contenido: new Uint8Array(readFileSync(resolve(DIR, `${n}_2026-11-09.csv`))) })))
  if (!r.ok) throw new Error(r.problemas.join(' | '))
  return r.lectura.dias[0].lectura
})()

/** Lo que devolvería conta_tpv_dia_para_validar para el día del ejemplo (las líneas, las de la prueba de staging del R05). */
const paraValidar = (): ParaValidarTpv => ({
  account_id: 'cuenta', numero_previsto: 12, empresa: { nombre: 'Prueba TPV, S.L.', nif: 'B00000000' },
  dia: {
    id: 'dia', dia: '2026-11-09', programa: 'revo', primero: 5001, ultimo: 5048, base: 999.99, cuota: 100.01, total: 1100,
    facturas: lectura.documentos.map((d) => ({
      numero: d.numero, fecha: d.fecha, canal: d.canal === '--' ? 'local' : d.canal, nif: d.nif, base: d.base, cuota: d.cuota, total: d.total,
      impuestos: lectura.impuestos.filter((i) => i.orden === d.orden).map((i) => ({ tipo: i.tipo, base: i.base, cuota: i.cuota })),
    })),
  },
  lineas: [
    { cuenta: '43000001', nombre: 'Glovo', debe: 300, haber: 0, concepto: 'Cobra Deliverect · Glovo' },
    { cuenta: '43000002', nombre: 'Uber Eats', debe: 200, haber: 0, concepto: 'Cobra Deliverect · UberEats' },
    { cuenta: '57000000', nombre: 'Caja, efectivo', debe: 180, haber: 0, concepto: 'Cobra Efectivo' },
    { cuenta: '57200001', nombre: 'Banco, tarjeta', debe: 420, haber: 0, concepto: 'Cobra Tarjeta' },
    { cuenta: '47700000', nombre: 'IVA repercutido', debe: 0, haber: 100.01, concepto: 'IVA repercutido 10 %', tipo: 10 },
    { cuenta: '70000000', nombre: 'Ventas', debe: 0, haber: 999.99, concepto: 'Ventas del día · TPV Revo' },
  ],
})

const fila = {
  id: 'd1', dia: '2026-11-09', programa: 'revo', programa_nombre: 'Revo', facturas: 48, primero: 5001, ultimo: 5048, base: 999.99, cuota: 100.01, total: 1100,
  formas: [{ forma: 'Deliverect', importe: 500 }, { forma: 'Efectivo', importe: 180 }, { forma: 'Tarjeta', importe: 420 }], con_nif: 2,
  subido_por: 'Prueba', subido_en: '2026-11-16T10:00:00Z', asiento_id: null, estado_asiento: null, numero_asiento: null, documento: null,
  estado: 'por_validar', motivo: null, aviso: null,
}

describe('la fila de un día del TPV en la lista', () => {
  it('se lee como un cierre más, de fuente TPV, con su numeración y cómo se cobró', () => {
    const x = cierreTpvDeFila(fila)
    expect([x.fuente, x.canal, x.tiques, x.total, x.estado, x.id]).toEqual(['tpv', 'TPV · Revo', 48, 1100, 'por_validar', null])
    expect(numeracionTpv(x.tpv!)).toBe('5001 a 5048')
    expect(cobradoTpv(x.tpv!.formas)).toBe('Efectivo, tarjeta y plataformas')
    expect(cobradoTpv([{ forma: 'Efectivo' }, { forma: 'Too Good To Go' }])).toBe('Efectivo y too good to go')
    expect(cobradoTpv([])).toBe('—')
    expect(subidoTpv(x.tpv!, '2026-11-17')).toBe('Subido ayer por Prueba')
    expect(subidoTpv(x.tpv!, '2026-11-16')).toBe('Subido hoy por Prueba')
    expect(subidoTpv(x.tpv!, '2026-11-20')).toBe('Subido el 16/11 por Prueba')
  })
  it('por validar sin asiento entra en «los listos» (se propone al validar); en espera, no', () => {
    const x = cierreTpvDeFila(fila)
    const y = cierreTpvDeFila({ ...fila, id: 'd2', estado: 'en_espera', motivo: 'Falta decir a qué cuenta va «Too Good To Go».' })
    expect(listos([x, y]).map((c) => c.tpv?.diaId)).toEqual(['d1'])
  })
  it('cuenta en «ayer» y se busca por su numeración', () => {
    const x = cierreTpvDeFila(fila)
    expect(resumenDeAyer([x])).toMatchObject({ dia: '2026-11-09', total: 1100, tiques: 48, porCanal: [{ canal: 'TPV · Revo', total: 1100 }] })
    expect(filtrarCierres([x], 'todos', '5001 a 5048')).toHaveLength(1)
  })
})

describe('el PDF «Resumen de ventas» de un día del TPV', () => {
  const d = datosResumenTpv(paraValidar(), 12, new Date('2026-11-17T10:00:00Z'))
  it('los datos: 48 facturas de la 5001 a la 5048, el IVA por tipo y cómo se cobró, y cuadran', () => {
    expect([d.facturas.length, d.primero, d.ultimo, d.asiento]).toEqual([48, 5001, 5048, 'Ventas nº 12'])
    expect(d.porTipo).toEqual([{ tipo: 10, facturas: 48, base: 999.99, cuota: 100.01 }])
    expect(d.cobros.map((c) => [c.cuenta, c.importe])).toEqual([['43000001', 300], ['43000002', 200], ['57000000', 180], ['57200001', 420]])
    expect(d.facturas.filter((f) => f.nif).map((f) => f.numero)).toEqual([5007, 5020])
    expect(d.facturas.filter((f) => f.total < 0).map((f) => f.numero)).toEqual([5047])
    expect(comprobarResumenTpv(d)).toEqual([])
    expect(nombreFicheroTpv('2026-11-09', 12)).toMatch(/^[A-Za-z0-9._-]+\.pdf$/)
  })
  it('sale un PDF', () => {
    const b = resumenVentasTpvPdf(jsPDF, d)
    expect(new TextDecoder().decode(b.slice(0, 5))).toBe('%PDF-')
    expect(b.length).toBeGreaterThan(3000)
  })
  it('si no cuadra, no hay PDF: lo cobrado no es el total', () => {
    const mal = { ...d, cobros: d.cobros.slice(1) }
    expect(comprobarResumenTpv(mal)).toEqual(['lo cobrado (800,00 €) no es el total del día (1.100,00 €)'])
    expect(() => resumenVentasTpvPdf(jsPDF, mal)).toThrow(/no cuadra con su asiento: lo cobrado/)
  })
  it('sin el NIF de la empresa, no hay PDF', () => {
    expect(() => datosResumenTpv({ ...paraValidar(), empresa: { nombre: 'X', nif: '' } }, 12, new Date())).toThrow(/NIF/)
  })
})

describe('Cierres del día en la barra (decisión 9)', () => {
  const ctx = (hosteleria: boolean, ventasPorDia: boolean): Contexto => ({ hosteleria, ventasPorDia, diez: false, interruptores: new Set() })
  it('sale si es de hostelería o tiene «ventas por día» encendido; lo demás de hostelería, solo con hostelería', () => {
    expect([cumple('ventas_por_dia', ctx(true, false)), cumple('ventas_por_dia', ctx(false, true)), cumple('ventas_por_dia', ctx(false, false))]).toEqual([true, true, false])
    expect(cumple('hosteleria', ctx(false, true))).toBe(false)
  })
  it('en Ventas: con «ventas por día» y sin hostelería sale Cierres del día, y no Liquidaciones', () => {
    const ventas = PRODUCTOS.find((p) => p.pestanas.some((t) => t.id === 'cierres'))!
    const ids = (c: Contexto) => pestanasVisibles(ventas, c).map((t) => t.id)
    expect(ids(ctx(false, true))).toContain('cierres')
    expect(ids(ctx(false, false))).not.toContain('cierres')
    expect(ids(ctx(true, false))).toContain('cierres')
    expect(ventas.pestanas.find((t) => t.id === 'cierres')?.solo).toBe('hosteleria')   // sigue siendo de hostelería (aviso de sector)
    expect(ids(ctx(false, true)).filter((id) => ventas.pestanas.find((t) => t.id === id)?.solo === 'hosteleria')).toEqual(['cierres'])
  })
})
