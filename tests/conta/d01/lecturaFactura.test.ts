// D01 · Tarea 2 · La lectura de una factura recibida, sobre facturas INVENTADAS
// de varios formatos (lo que devolvería el modelo con el modo factura):
// mercancía a un tipo, varios tipos con recargo, profesional con retención,
// alquiler, rectificativa, ticket simplificado, sin desglose (solo líneas),
// intracomunitaria sin IVA, mal sumada, sin NIF, antigua y a más de 60 días.
// Ningún nombre ni NIF es de nadie: el repositorio es público.
import { describe, expect, it } from 'vitest'
import datosAlbaranes from '../../unit/modules/conta/datos/albaranes-fecha-importe-foodint-20261004.json'
import { buscarRepetida, claveNumero, leerFactura, normalizarNif, type LecturaModelo } from '../../../supabase/functions/_shared/lecturaFactura'

const HOY = '2026-10-13'
const mercancia = (o: Partial<LecturaModelo> = {}): LecturaModelo => ({
  document: { supplier_name: 'Mayorista Alfa, S.A.', supplier_tax_id: 'ES-A00000001', doc_number: 'F-2026/1022', doc_date: '2026-10-11', doc_type: 'factura', handwritten: false, tax_base_total: 1283.15, tax_total: 128.32, grand_total: 1411.47 },
  lines: [{ raw_text: 'Aceite 5 L', line_amount: 98, vat_pct: 10 }],
  factura: { invoice_kind: 'completa', due_date: '2026-11-10', tax_breakdown: [{ vat_pct: 10, base: 1283.15, vat_amount: 128.32 }] },
  confidence: 0.95,
  ...o,
})
const ids = (l: ReturnType<typeof leerFactura>) => l.comprobaciones.filter((x) => !x.ok).map((x) => x.id)

describe('leerFactura: los formatos', () => {
  it('mercancía a un tipo, todo bien → seguro, y el NIF y el número normalizados', () => {
    const l = leerFactura(mercancia(), { hoy: HOY })
    expect(l.confianza).toBe('seguro')
    expect(l.factura).toMatchObject({ numero: 'F-2026/1022', numeroClave: 'F20261022', fecha: '2026-10-11', vencimiento: '2026-11-10', base: 1283.15, cuota: 128.32, total: 1411.47, desgloseDe: 'papel' })
    expect(l.factura.proveedor.nif).toBe('A00000001')
    expect(l.comprobaciones.find((x) => x.id === 'suma')).toMatchObject({ ok: true })
    expect(l.porque).toEqual(['Todo cuadra y trae lo que pide la norma.'])
  })
  it('varios tipos con recargo de equivalencia (21 % + 5,2 %, 10 % + 1,4 %)', () => {
    const l = leerFactura(mercancia({
      document: { ...mercancia().document, grand_total: 100 + 21 + 5.2 + 50 + 5 + 0.7 },
      factura: { tax_breakdown: [{ vat_pct: 21, base: 100, vat_amount: 21, surcharge_pct: 5.2, surcharge_amount: 5.2 }, { vat_pct: 10, base: 50, vat_amount: 5, surcharge_pct: 1.4, surcharge_amount: 0.7 }] },
    }), { hoy: HOY })
    expect(l.factura.tipos.map((t) => [t.tipo, t.base, t.cuota, t.recargo])).toEqual([[21, 100, 21, 5.2], [10, 50, 5, 0.7]])
    expect(l.factura.recargo).toBe(5.9)
    expect(l.confianza).toBe('seguro')
  })
  it('profesional con retención del 15 %: base + IVA − retención = total', () => {
    const l = leerFactura(mercancia({
      document: { supplier_name: 'Asesora Ejemplo', supplier_tax_id: '00000000T', doc_number: '2026-031', doc_date: '2026-10-01', tax_base_total: 400, tax_total: 84, grand_total: 424 },
      factura: { tax_breakdown: [{ vat_pct: 21, base: 400, vat_amount: 84 }], withholding_pct: 15, withholding_amount: 60 },
    }), { hoy: HOY })
    expect(l.factura.retencion).toEqual({ tipo: 15, importe: 60 })
    expect(l.comprobaciones.find((x) => x.id === 'suma')?.ok).toBe(true)
    expect(l.confianza).toBe('seguro')
  })
  it('alquiler con retención del 19 % mal calculada → duda, y dice cuánto debería ser', () => {
    const l = leerFactura(mercancia({
      document: { supplier_name: 'Inmuebles Ejemplo', supplier_tax_id: 'B00000002', doc_number: 'ALQ-10', doc_date: '2026-10-01', grand_total: 1000 + 210 - 180 },
      factura: { tax_breakdown: [{ vat_pct: 21, base: 1000, vat_amount: 210 }], withholding_pct: 19, withholding_amount: 180 },
    }), { hoy: HOY })
    expect(ids(l)).toContain('retencion')
    expect(l.confianza).toBe('duda')
    expect(l.porque.join(' ')).toMatch(/retención al 19 % debería ser 190,00 €/)
  })
  it('rectificativa: negativa, y sin decir qué rectifica es duda', () => {
    const base = { supplier_name: 'Mayorista Alfa, S.A.', supplier_tax_id: 'A00000001', doc_number: 'R-7', doc_date: '2026-10-12', grand_total: -11 }
    const sin = leerFactura({ document: base, factura: { invoice_kind: 'rectificativa', tax_breakdown: [{ vat_pct: 10, base: -10, vat_amount: -1 }] }, confidence: 0.95 }, { hoy: HOY })
    expect(sin.factura.clase).toBe('rectificativa')
    expect(ids(sin)).toEqual(['rectifica'])
    const con = leerFactura({ document: base, factura: { invoice_kind: 'rectificativa', corrects_number: 'F-2026/1022', tax_breakdown: [{ vat_pct: 10, base: -10, vat_amount: -1 }] }, confidence: 0.95 }, { hoy: HOY })
    expect(con.confianza).toBe('seguro')
    expect(con.factura.rectificaA).toBe('F-2026/1022')
  })
  it('ticket simplificado: probable, con el aviso de lo que pide para deducir', () => {
    const l = leerFactura({ document: { supplier_name: 'Ferretería Ejemplo', supplier_tax_id: 'B00000003', doc_number: 'T-551', doc_date: '2026-10-07', grand_total: 47.07 }, factura: { invoice_kind: 'simplificada', tax_breakdown: [{ vat_pct: 21, base: 38.9, vat_amount: 8.17 }] }, confidence: 0.92 }, { hoy: HOY })
    expect(l.confianza).toBe('probable')
    expect(ids(l)).toEqual(['simplificada'])
  })
  it('sin desglose en el papel: las bases salen de las líneas, por tipo', () => {
    const l = leerFactura({
      document: { supplier_name: 'Distribuciones Ejemplo', supplier_tax_id: 'B00000004', doc_number: '889', doc_date: '2026-10-09', tax_total: 13.5, grand_total: 163.5 },
      lines: [{ raw_text: 'A', line_amount: 100, vat_pct: 10 }, { raw_text: 'B', line_amount: 50, vat_pct: 7 }], confidence: 0.9,
    }, { hoy: HOY })
    expect(l.factura.desgloseDe).toBe('lineas')
    expect(l.factura.tipos.map((t) => [t.tipo, t.base])).toEqual([[10, 100], [7, 50]])
    expect(ids(l)).toContain('tipo_7') // un 7 % no es de los de siempre
  })
  it('intracomunitaria sin IVA (0 %) y NIF de la UE: cuadra y no pide forma de NIF español', () => {
    const l = leerFactura({ document: { supplier_name: 'Lieferant Beispiel GmbH', supplier_tax_id: 'DE000000000', doc_number: 'RE-1', doc_date: '2026-10-02', grand_total: 500 }, factura: { tax_breakdown: [{ vat_pct: 0, base: 500, vat_amount: 0 }] }, confidence: 0.9 }, { hoy: HOY })
    expect(ids(l)).toEqual([])
    expect(l.confianza).toBe('seguro')
  })
})

describe('leerFactura: lo que no puede pasar sin decirlo', () => {
  it('mal sumada → duda, diciendo cuánto falta', () => {
    const l = leerFactura(mercancia({ document: { ...mercancia().document, grand_total: 1411.57 } }), { hoy: HOY })
    expect(l.confianza).toBe('duda')
    expect(l.porque[0]).toMatch(/^No cuadra: .* \(faltan 0,10 €\)\.$/)
  })
  it('una cuota que no es base × tipo → duda', () => {
    const l = leerFactura(mercancia({ factura: { tax_breakdown: [{ vat_pct: 10, base: 1283.15, vat_amount: 130 }] }, document: { ...mercancia().document, grand_total: 1413.15 } }), { hoy: HOY })
    expect(ids(l)).toEqual(['cuota_10'])
  })
  it('sin NIF y con IVA → duda: así no se deduce', () => {
    const l = leerFactura(mercancia({ document: { ...mercancia().document, supplier_tax_id: null } }), { hoy: HOY })
    expect(ids(l)).toEqual(['nif'])
    expect(l.porque[0]).toMatch(/no se puede deducir su IVA/)
  })
  it('sin número, sin fecha, sin total: cada cosa por su nombre', () => {
    const l = leerFactura({ document: { supplier_tax_id: 'A00000001' }, factura: { tax_breakdown: [{ vat_pct: 10, base: 10, vat_amount: 1 }] }, confidence: 0.9 }, { hoy: HOY })
    expect(ids(l)).toEqual(expect.arrayContaining(['total', 'numero', 'fecha']))
  })
  it('de hace más de cuatro años → duda; vencimiento a más de 60 días → aviso; fecha futura → duda', () => {
    expect(ids(leerFactura(mercancia({ document: { ...mercancia().document, doc_date: '2022-10-10' }, factura: { ...mercancia().factura, due_date: null } }), { hoy: HOY }))).toEqual(['cuatro_anios'])
    const larga = leerFactura(mercancia({ factura: { ...mercancia().factura, due_date: '2027-01-10' } }), { hoy: HOY })
    expect(ids(larga)).toEqual(['morosidad'])
    expect(larga.confianza).toBe('probable')
    expect(ids(leerFactura(mercancia({ document: { ...mercancia().document, doc_date: '2026-10-20' }, factura: { ...mercancia().factura, due_date: null } }), { hoy: HOY }))).toEqual(['fecha_futura'])
  })
  it('manuscrita o con poca confianza del modelo → probable, nunca seguro', () => {
    expect(leerFactura(mercancia({ document: { ...mercancia().document, handwritten: true } }), { hoy: HOY }).confianza).toBe('probable')
    expect(leerFactura(mercancia({ confidence: 0.6 }), { hoy: HOY }).confianza).toBe('probable')
  })
})

describe('repetidas: una sola regla', () => {
  const existentes = [
    { id: 'a', proveedorId: 'p1', nif: 'A00000001', numero: 'F 2026-1022', fecha: '2026-10-11', total: 1411.47 },
    { id: 'b', proveedorId: 'p1', nif: 'A00000001', numero: 'F-2026/0999', fecha: '2026-10-01', total: 50 },
    { id: 'z', proveedorId: 'p1', nif: 'A00000001', numero: 'F-2026/2000', fecha: '2026-10-12', total: 70, anulada: true },
  ]
  it('el mismo proveedor, el mismo número normalizado y el mismo total → repetida, venga por donde venga', () => {
    expect(buscarRepetida({ proveedorId: 'p1', nif: null, numero: 'f2026/1022', fecha: '2026-10-11', total: 1411.47 }, existentes)).toMatchObject({ nivel: 'repetida', con: 'a' })
    // sin ficha todavía: por el NIF
    expect(buscarRepetida({ proveedorId: null, nif: 'ES-A00000001', numero: 'F20261022', fecha: null, total: 1411.47 }, existentes)).toMatchObject({ nivel: 'repetida', con: 'a' })
  })
  it('el mismo número con otro total, o sin total leído → posible: pregunta, no bloquea', () => {
    expect(buscarRepetida({ proveedorId: 'p1', nif: null, numero: 'F-2026-1022', fecha: '2026-10-20', total: 99 }, existentes)).toMatchObject({ nivel: 'posible', con: 'a' })
    expect(buscarRepetida({ proveedorId: null, nif: 'ES-A00000001', numero: 'F20261022', fecha: null, total: null }, existentes)).toMatchObject({ nivel: 'posible', con: 'a' })
  })
  it('población real: el proveedor que pone «01» en dos albaranes distintos no se queda con el segundo fuera', () => {
    // datos/albaranes-fecha-importe-foodint-20261004.json: el único número repetido
    // entre los albaranes vivos es «01», del proveedor 4, con fecha e importe distintos.
    const filas = (datosAlbaranes as { filas: { p: number; n: string | null; f: string; i: number; anulado: boolean }[] }).filas.filter((x) => !x.anulado)
    const existentes: { id: string; proveedorId: string; nif: null; numero: string | null; fecha: string; total: number }[] = []
    const repetidas: string[] = []
    filas.forEach((x, j) => {
      const r = buscarRepetida({ proveedorId: String(x.p), nif: null, numero: x.n, fecha: x.f, total: x.i }, existentes)
      if (r?.nivel === 'repetida') repetidas.push(`${x.p}|${x.n}`)
      existentes.push({ id: String(j), proveedorId: String(x.p), nif: null, numero: x.n, fecha: x.f, total: x.i })
    })
    expect(repetidas).toEqual([])
  })
  it('otro número, misma fecha y mismo total → posible', () => {
    expect(buscarRepetida({ proveedorId: 'p1', nif: null, numero: 'F-2026/1023', fecha: '2026-10-01', total: 50 }, existentes)).toMatchObject({ nivel: 'posible', con: 'b' })
  })
  it('el mismo total en otra fecha no es posible repetida (es la factura del mes siguiente)', () => {
    expect(buscarRepetida({ proveedorId: 'p1', nif: null, numero: 'F-2026/1100', fecha: '2026-11-01', total: 50 }, existentes)).toBeNull()
  })
  it('otro proveedor, o una anulada, no cuentan', () => {
    expect(buscarRepetida({ proveedorId: 'p2', nif: 'B00000002', numero: 'F 2026-1022', fecha: '2026-10-11', total: 1411.47 }, existentes)).toBeNull()
    expect(buscarRepetida({ proveedorId: 'p1', nif: null, numero: 'F-2026/2000', fecha: '2026-10-12', total: 70 }, existentes)).toBeNull()
  })
  it('«s/n» o «0» no es número', () => {
    expect(claveNumero('s/n')).toBeNull()
    expect(claveNumero('000')).toBeNull()
    expect(normalizarNif(' es-b 0000 0002 ')).toBe('B00000002')
  })
})
