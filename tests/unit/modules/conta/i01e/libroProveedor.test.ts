// tests/unit/modules/conta/i01e/libroProveedor.test.ts
//
// I01e · Lo que el libro sabe de un proveedor, en su ficha. La forma de los
// datos es la medida en producción el 20/10 (solo lectura, sin cifras aquí):
// los cinco proveedores extranjeros de Foodint tienen sus facturas en el libro
// de IVA a través de los asientos de su 410 —todos traídos de Diez
// (source_type 'migrated'), una factura y su pago por cada una—, ninguna fila
// del libro con su tercero, ninguna factura subida a Sumied; un asiento tiene
// hasta 3 filas del libro y nunca más de una factura; el total del libro es
// siempre base + cuota; una cuenta de proveedor llega a 2.602 asientos.
// Importes inventados.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cifrasConLibro, facturasDelLibro, origenDelAsiento, textoOrigen, textoOrigenFactura, type FilaLibroProveedor } from '@/modules/conta/lib/libroProveedor'
import type { Apunte } from '@/modules/conta/lib/cuentasProveedor'
import { calcularCifras } from '@/modules/conta/lib/cifras'

const apunte = (o: Partial<Apunte> & { id: string }): Apunte => ({
  fecha: '2026-08-05', documento: 'X', concepto: 'Factura', debe: 0, haber: 0,
  enlace: { tipo: 'asiento', id: o.id }, asiento: { serie: 1, numero: 10, anulado: false }, origen: 'diez', ...o,
})
const fila = (o: Partial<FilaLibroProveedor> & { entryId: string }): FilaLibroProveedor => ({
  serie: null, numero: 'INV-1', fecha: '2026-08-05', base: 100, cuota: 21, total: 121, isp: true, sourceType: 'migrated', sourceId: null, ...o,
})

// Una de fuera de la UE traída de Diez: tres facturas, cada una con su pago (seis asientos en la 410).
const apuntes: Apunte[] = [
  apunte({ id: 'f1', fecha: '2026-07-03', haber: 18.5, asiento: { serie: 1, numero: 101, anulado: false } }),
  apunte({ id: 'p1', fecha: '2026-07-04', debe: 18.5, concepto: 'Pago', asiento: { serie: 1, numero: 102, anulado: false } }),
  apunte({ id: 'f2', fecha: '2026-08-03', haber: 18.5, asiento: { serie: 1, numero: 201, anulado: false } }),
  apunte({ id: 'p2', fecha: '2026-08-04', debe: 18.5, concepto: 'Pago', asiento: { serie: 1, numero: 202, anulado: false } }),
  apunte({ id: 'f3', fecha: '2026-09-03', haber: 20, asiento: { serie: 1, numero: 301, anulado: false } }),
  apunte({ id: 'p3', fecha: '2026-09-04', debe: 20, concepto: 'Pago', asiento: { serie: 1, numero: 302, anulado: false } }),
]
const filas: FilaLibroProveedor[] = [
  fila({ entryId: 'f1', numero: 'INV-0701', fecha: '2026-07-03', base: 18.5, cuota: 3.89, total: 22.39 }),
  fila({ entryId: 'f2', numero: 'INV-0801', fecha: '2026-08-03', base: 18.5, cuota: 3.89, total: 22.39 }),
  fila({ entryId: 'f3', numero: 'INV-0901', fecha: '2026-09-03', base: 20, cuota: 4.2, total: 24.2 }),
]

describe('las facturas del libro de un proveedor traído de Diez', () => {
  it('salen las tres, de la más reciente a la más antigua, con su origen y su asiento', () => {
    const r = facturasDelLibro(filas, apuntes, new Set())
    expect(r.map((f) => [f.numero, f.fecha, f.origen, f.asiento])).toEqual([
      ['INV-0901', '2026-09-03', 'diez', '1/301'], ['INV-0801', '2026-08-03', 'diez', '1/201'], ['INV-0701', '2026-07-03', 'diez', '1/101'],
    ])
  })
  it('con inversión del sujeto pasivo, lo que te factura es la base (la cuota la pones tú)', () => {
    const [f] = facturasDelLibro(filas, apuntes, new Set())
    expect([f.importe, f.base, f.cuota, f.isp]).toEqual([20, 20, 4.2, true])
  })
  it('una factura con dos tipos (dos filas del mismo asiento) es UNA factura, y sin inversión su importe es el total', () => {
    const r = facturasDelLibro([
      fila({ entryId: 'e', numero: 'F-7', base: 100, cuota: 10, total: 110, isp: false }),
      fila({ entryId: 'e', numero: 'F-7', base: 50, cuota: 10.5, total: 60.5, isp: false }),
    ], [apunte({ id: 'e' })], new Set())
    expect(r).toHaveLength(1)
    expect([r[0].base, r[0].cuota, r[0].importe]).toEqual([150, 20.5, 170.5])
  })
  it('las que ya salen como factura subida aquí no se repiten; las de otra ficha sí salen', () => {
    const r = facturasDelLibro([
      fila({ entryId: 'a', numero: 'S-1', sourceType: 'supplier_invoice', sourceId: 'inv-1', isp: false }),
      fila({ entryId: 'b', numero: 'S-2', sourceType: 'supplier_invoice', sourceId: 'inv-de-otra', isp: false }),
    ], [apunte({ id: 'a', origen: 'factura' }), apunte({ id: 'b', origen: 'factura' })], new Set(['inv-1']))
    expect(r.map((f) => [f.numero, f.origen])).toEqual([['S-2', 'factura']])
  })
  it('serie y número juntos; sin número, lo dice', () => {
    const r = facturasDelLibro([fila({ entryId: 'a', serie: 'A', numero: '12' }), fila({ entryId: 'b', numero: null, fecha: '2026-01-01' })], [], new Set())
    expect(r.map((f) => f.numero)).toEqual(['A 12', 'Sin número'])
  })
})

describe('el origen, en palabras', () => {
  it('de journal_entry: traído de Diez, una factura subida, el banco, las ventas o hecho aquí', () => {
    expect([
      origenDelAsiento('migrated', 'diez'), origenDelAsiento('migrated', null), origenDelAsiento(null, 'diez'),
      origenDelAsiento('supplier_invoice', null), origenDelAsiento('bank', null), origenDelAsiento('sales_day', null), origenDelAsiento('manual', null),
    ]).toEqual(['diez', 'diez', 'diez', 'factura', 'banco', 'ventas', 'sumied'])
    expect(['diez', 'factura', 'banco', 'ventas', 'sumied'].map((o) => textoOrigen(o as never, 'Sumied')))
      .toEqual(['Traído de Diez', 'Factura subida a Sumied', 'Del banco', 'Ventas del día', 'Apuntado en Sumied'])
    expect([textoOrigenFactura('diez', 'Sumied'), textoOrigenFactura('factura', 'Sumied')]).toEqual(['Traída de Diez', 'Apuntada en Sumied'])
  })
})

describe('las cifras de arriba con las dos fuentes', () => {
  const hoy = '2026-10-20'
  it('sin ninguna factura subida aquí: lo comprado sale del libro y «Le debes», del saldo de su cuenta', () => {
    const libro = facturasDelLibro(filas, apuntes, new Set())
    const c = cifrasConLibro(calcularCifras([], hoy), libro, apuntes, hoy)
    expect(c).toMatchObject({ compradoEsteAnio: 57, facturasEsteAnio: 3, delLibroEsteAnio: 3, leDebes: 0, leDebesDe: 'cuenta', hayFacturas: true })
  })
  it('una factura sin pagar en la cuenta: le debes su importe', () => {
    const c = cifrasConLibro(calcularCifras([], hoy), facturasDelLibro(filas, apuntes, new Set()), apuntes.slice(0, 5), hoy)
    expect([c.leDebes, c.leDebesDe]).toEqual([20, 'cuenta'])
  })
  it('un pago de más: el saldo queda a tu favor (negativo); la pantalla lo llama «Te debe»', () => {
    const c = cifrasConLibro(null, [], [...apuntes, apunte({ id: 'p4', fecha: '2026-10-01', debe: 5 })], hoy)
    expect(c.leDebes).toBe(-5)
  })
  it('con facturas subidas aquí, «Le debes» sigue saliendo de ellas; lo comprado suma las dos', () => {
    const sumied = calcularCifras([{ id: 's1', invoiceNumber: 'S-1', status: 'aprobada', invoiceDate: '2026-10-02', grandTotal: 100, dueDate: null, paidAt: null }], hoy)
    const c = cifrasConLibro(sumied, facturasDelLibro(filas, apuntes, new Set()), apuntes, hoy)
    expect(c).toMatchObject({ compradoEsteAnio: 157, facturasEsteAnio: 4, delLibroEsteAnio: 3, leDebes: 100, leDebesDe: 'facturas' })
  })
  it('las del libro de otro año no cuentan en «este año»', () => {
    const c = cifrasConLibro(null, facturasDelLibro([fila({ entryId: 'f1', fecha: '2025-12-30' })], apuntes, new Set()), [], hoy)
    expect([c.compradoEsteAnio, c.facturasEsteAnio, c.hayFacturas]).toEqual([null, 0, true])
  })
  it('sin nada en ningún lado: todo null, nunca un 0 € que parezca dato', () => {
    const c = cifrasConLibro(calcularCifras([], hoy), [], [], hoy)
    expect([c.compradoEsteAnio, c.leDebes, c.leDebesDe, c.hayFacturas]).toEqual([null, null, null, false])
  })
})

// ── La lectura: por trozos (una cuenta con 2.602 asientos) ──────────────────

type Llamada = { tabla: string; rango?: [number, number]; enIds?: string[] }
const llamadas: Llamada[] = []
let respuesta: (l: Llamada) => unknown[] = () => []

vi.mock('@/modules/conta/services/bd', () => ({
  mensaje: (p: string) => p,
  rpc: async () => null,
  tabla: (nombre: string) => {
    const l: Llamada = { tabla: nombre }
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'order', 'limit']) q[m] = () => q
    q.in = (_c: string, ids: string[]) => { l.enIds = ids; return q }
    q.range = (a: number, b: number) => { l.rango = [a, b]; return q }
    q.then = (ok: (r: { data: unknown[]; error: null }) => unknown) => { llamadas.push(l); return Promise.resolve({ data: respuesta(l), error: null }).then(ok) }
    return q
  },
}))

describe('la lectura del libro de un proveedor', () => {
  beforeEach(() => { llamadas.length = 0 })
  it('los apuntes se piden de 1.000 en 1.000 hasta el último trozo: 2.602 → 3 lecturas, ninguno perdido', async () => {
    const { apuntesDeCuentas } = await import('@/modules/conta/services/libroService')
    const total = 2602
    respuesta = (l) => {
      const [a, b] = l.rango ?? [0, total - 1]
      return Array.from({ length: Math.max(0, Math.min(b, total - 1) - a + 1) }, (_, i) => ({
        entry_id: `e${a + i}`, series: 1, number: a + i, entry_date: '2026-01-01', debit: 1, credit: 0, status: 'validado', source_type: 'migrated', external_program: 'diez',
      }))
    }
    const r = await apuntesDeCuentas('cuenta', 'empresa', ['ca'])
    expect(r).toHaveLength(total)
    expect(llamadas.map((l) => l.rango)).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(r[0].origen).toBe('diez')
  })
  it('el libro de IVA se pide de 100 asientos en 100 (la lista va en la dirección), sin repetir ninguno', async () => {
    const { libroDeLosAsientos } = await import('@/modules/conta/services/libroService')
    respuesta = (l) => (l.enIds ?? []).map((id) => ({ entry_id: id, number: id, issue_date: '2026-01-01', tax_base: 1, tax_amount: 0.21, total: 1.21, reverse_charge: false }))
    const ids = Array.from({ length: 1301 }, (_, i) => `e${i % 1301}`)
    const r = await libroDeLosAsientos('cuenta', 'empresa', [...ids, 'e0', 'e1'])
    expect(r).toHaveLength(1301)
    expect(llamadas.map((l) => l.enIds!.length)).toEqual([...Array(13).fill(100), 1])
  })
})
