// tests/conta/erp10/desdeLaBase.test.ts — X10c · Lo que se escribe en ERP10 se arma en el servidor
// DESDE LA BASE (supabase/functions/_shared/erp10DesdeLaBase.ts), no desde lo que manda el
// navegador: del cuerpo solo se leen los asientos pedidos. Con lo que devuelven las funciones de la
// base de la salida (la misma forma que las unitarias de armarSalida). Datos inventados (T11).

import { describe, expect, it } from 'vitest'
import { loQueSaleDesdeLaBase, pedidasDelCuerpo, type BaseCruda } from '../../../supabase/functions/_shared/erp10DesdeLaBase'
import { facturaEmitidaErp10, facturaRecibidaErp10, sacarEmitida, sacarRecibida, type Envio, type PuertoEscribir } from '../../../supabase/functions/_shared/erp10Escribir'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const partida = (n: number, clase: string, o: Record<string, unknown> = {}) => ({
  entry_id: id(n), serie: clase === 'emitida' ? 1 : 2, numero: n, fecha: '2026-10-05', concepto: `Inventado X10c ${n}`,
  origen: 'manual', clase, importe: 121, base_iva: 100, numero_factura: `X10C-${n}`, nif: 'B00000000', tercero: 'Inventado X10c, S.L.',
  cuentas_base: 1, tiene_pdf: true, de_otro_mes: false, sale: true, avisos: [], ...o,
})
const L = (cuenta: string, plantilla: string, debe: number, haber: number, iva: [number, number] | null = null) =>
  ({ cuenta, plantilla, debe, haber, tipoIva: iva?.[0] ?? null, baseIva: iva?.[1] ?? null, deducible: iva ? 'yes' : null, recargo: null, modeloRetencion: null })

const BASE: BaseCruda = {
  carpeta: 'C:\\Sumied\\0007\\',
  porSalir: { mes: '2026-10-01', desde: '2026-10-01', codigo: '0007', largo: 8, cuentas_nuevas: [], partidas: [partida(1, 'recibida'), partida(2, 'emitida', { origen: 'customer_invoice' }), partida(3, 'recibida', { sale: false, avisos: ['No sale (inventado).'] })] },
  recibidas: {
    recibidas: [{
      entryId: id(1), fecha: '2026-10-05', factura: { numero: 'X10C-1', fecha: '2026-10-03' }, proveedor: { nombre: 'Proveedor Inventado X10c, S.L.', nif: 'B00000000' },
      operacion: 'interior', lineas: [L('6290001', '629', 100, 0), L('47200000', '472', 21, 0, [21, 100]), L('4000001', '400', 0, 121)],
      tienePdf: true, pdf: { ruta: 'inventado/x10c/1.pdf', nombre: '1.pdf' },
    }],
    cuentas: [
      { codigo: '4000001', plantilla: '400', nombre: 'Proveedor Inventado X10c', nif: 'B00000000', gastoHabitual: null },
      { codigo: '6290001', plantilla: '629', nombre: 'Otros servicios inventados', nif: null, gastoHabitual: null },
    ],
    yaSalidas: {},
  },
  emitidas: {
    emitidas: [{
      entryId: id(2), fecha: '2026-10-06', factura: { numero: 'F-X10C-2', fecha: '2026-10-06' }, cliente: { nombre: 'Cliente Inventado X10c, S.L.', nif: 'B11111111' },
      origen: 'a_mano', rectificativa: false, tipoFactura: 'F1', operacion: 'interior', recargo: 0, retencion: 0,
      lineas: [{ cuenta: '4300001', plantilla: '430', debe: 242, haber: 0, tipoIva: null, baseIva: null }, { cuenta: '7000000', plantilla: '700', debe: 0, haber: 200, tipoIva: null, baseIva: null }, { cuenta: '47700021', plantilla: '477', debe: 0, haber: 42, tipoIva: 21, baseIva: 200 }],
      tienePdf: false, pdf: null,
    }],
    cuentas: [{ codigo: '4300001', plantilla: '430', nombre: 'Cliente Inventado X10c', nif: 'B11111111', gastoHabitual: null }, { codigo: '7000000', plantilla: '700', nombre: 'Ventas', nif: null, gastoHabitual: null }],
    yaSalidas: {}, corregidas: [],
  },
  asientos: { asientos: [], cuentas: [], yaSalidas: {} },
  dias: { dias: [], contado: [], cuentas: [], yaSalidas: {} },
}

describe('del navegador solo se leen los asientos pedidos', () => {
  it('pedidasDelCuerpo: las entradas (ids, sin repetir); lo demás del cuerpo, ni se mira', () => {
    expect(pedidasDelCuerpo({ entradas: [id(1), id(1), 'no-es-un-id', 7], recibidas: [{ api: { total: 999999 } }] })).toEqual([id(1)])
    expect(pedidasDelCuerpo({ recibidas: [{ api: { entryId: id(1) } }] })).toEqual([])
  })
})

describe('se arma desde la base, con las mismas reglas que el Excel', () => {
  it('la recibida y la emitida, con las cuentas convertidas a las de ERP10 (8 cifras), la huella de su fila y su PDF', async () => {
    const r = await loQueSaleDesdeLaBase(BASE, [id(1), id(2)])
    expect(r.salen.map((x) => [x.clase, x.numero, x.pdf?.ruta ?? null])).toEqual([['recibida', 'X10C-1', 'inventado/x10c/1.pdf'], ['emitida', 'F-X10C-2', null]])
    const rec = r.salen[0]
    expect(rec.clase === 'recibida' && rec.api).toMatchObject({ proveedor: '40000001', gastos: [{ cuenta: '62900001', importe: 10000 }], total: 12100 })
    expect(rec.huella).toMatch(/^[0-9a-f]{64}$/)
    const emi = r.salen[1]
    expect(emi.clase === 'emitida' && emi.api).toMatchObject({ cliente: '43000001', ingresos: [{ cuenta: '70000000', importe: 20000 }], total: 24200, nif: 'B11111111' })
  })
  it('una que no puede salir, o que no es de este mes, vuelve con su porqué y no se escribe', async () => {
    const r = await loQueSaleDesdeLaBase(BASE, [id(3), id(99)])
    expect(r.salen).toEqual([])
    expect(r.noSalen.map((x) => x.entryId)).toEqual([id(3), id(99)])
    expect(r.noSalen[1].porque).toContain('No está en lo que sale este mes')
  })
  it('SI EL NAVEGADOR MANDA UN IMPORTE DISTINTO, EN ERP10 ENTRA EL DE LA BASE', async () => {
    // Lo que mandaría un navegador manipulado: el asiento correcto, con un total de 999.999,00.
    const cuerpo = { company_id: id(50), mes: '2026-10-01', entradas: [id(1)], recibidas: [{ api: { entryId: id(1), total: 99999900, iva: [{ pct: 21, base: 1, cuota: 1 }] }, huella: 'x' }] }
    const r = await loQueSaleDesdeLaBase(BASE, pedidasDelCuerpo(cuerpo))
    const escritas: Record<string, unknown>[] = []
    const filas = new Map<string, Envio>()
    const p: PuertoEscribir = {
      hoy: '2026-11-19',
      tomar: async (entryId) => {
        const n: Envio = { id: `e-${entryId}`, entry_id: entryId, estado: 'enviando', erp10_ejercicio: null, erp10_serie: null, erp10_documento: null, enlazada: false, pdf: null, motivo: null, intentos: 1, lote_id: null }
        filas.set(entryId, n)
        return { tomado: true, envio: n }
      },
      poner: async () => {},
      pdf: async () => new Uint8Array([1]),
      erp10: {
        tieneSubcuenta: async () => true, crearSubcuenta: async () => {}, facturasDelMes: async () => [],
        altaFactura: async (fd) => { escritas.push(fd); return { ...fd, Documento: 7 } },
        subirDocumento: async () => ({ status: 200, motivo: null }),
      },
    }
    for (const x of r.salen) if (x.clase === 'recibida') await sacarRecibida(x.api, r.cuentasNuevas, x.pdf, p)
    expect(escritas).toHaveLength(1)
    expect(escritas[0]).toMatchObject({ TotalFactura: 121, BaseImponible1: 100, CuotaIVA1: 21, CuentaCliente: '40000001' })
  })
})

describe('X10c · las emitidas', () => {
  it('la serie 1, con el cliente, su NIF, el IVA y los ingresos en Apuntes', () => {
    const f = facturaEmitidaErp10({ entryId: id(2), numero: 'F-X10C-2', fechaFactura: '2026-10-06', fechaAsiento: '2026-10-06', nif: 'B11111111', nombre: 'Cliente Inventado X10c, S.L.', cliente: '43000001', ingresos: [{ cuenta: '70000000', importe: 20000 }], iva: [{ pct: 21, base: 20000, cuota: 4200 }], total: 24200 }, { hoy: '2026-11-19' })
    expect('factura' in f && f.factura).toEqual({
      Ejercicio: '2026', Serie: '1', TipoAsiento: 1, TipoFactura: 1, Fecha: 20261006, FechaFactura: 20261006, FechaIntroduccionFactura: 20261119,
      CuentaCliente: '43000001', CifCliente: 'B11111111', NombreCliente: 'Cliente Inventado X10c, S.L.', NumeroFactura: 'F-X10C-2',
      Descripcion: 'F-X10C-2-Cliente Inventado X10c, S.L.', BaseImponible1: 200, PorcentajeIVA1: 21, CuotaIVA1: 42,
      TotalFactura: 242, TotalGastosIngresos: 200,
      Apuntes: [{ Linea: 1, Cuenta: '70000000', Concepto: 'F-X10C-2-Cliente Inventado X10c, S.L.', Fecha: 20261006, Importe: 200 }],
    })
  })
  it('lo que no cuadra no sale; la recibida y la emitida no se confunden al buscar en ERP10 (serie)', async () => {
    const mal = facturaEmitidaErp10({ entryId: id(2), numero: 'F', fechaFactura: '2026-10-06', fechaAsiento: '2026-10-06', nif: '', nombre: 'C', cliente: '43000001', ingresos: [{ cuenta: '70000000', importe: 100 }], iva: [{ pct: 21, base: 200, cuota: 42 }], total: 242 }, { hoy: '2026-11-19' })
    expect('porque' in mal && mal.porque).toContain('suma de las bases')
    // En ERP10 hay una RECIBIDA (serie 2) con el mismo número y la misma cuenta: la emitida no se enlaza a ella.
    const r = await loQueSaleDesdeLaBase(BASE, [id(2)])
    const x = r.salen[0]
    let altas = 0
    const p: PuertoEscribir = {
      hoy: '2026-11-19',
      tomar: async (entryId) => ({ tomado: true, envio: { id: 'e', entry_id: entryId, estado: 'enviando', erp10_ejercicio: null, erp10_serie: null, erp10_documento: null, enlazada: false, pdf: null, motivo: null, intentos: 1, lote_id: null } }),
      poner: async () => {}, pdf: async () => new Uint8Array([1]),
      erp10: {
        tieneSubcuenta: async () => true, crearSubcuenta: async () => {},
        facturasDelMes: async () => [{ Ejercicio: '2026', Serie: '2', Documento: 5, NumeroFactura: 'F-X10C-2', CuentaCliente: '43000001' }],
        altaFactura: async (fd) => { altas++; return { ...fd, Documento: 9 } }, subirDocumento: async () => ({ status: 200, motivo: null }),
      },
    }
    expect(x.clase === 'emitida' && await sacarEmitida(x.api, [], null, p)).toMatchObject({ estado: 'en_erp10', serie: '1', documento: 9, enlazada: false })
    expect(altas).toBe(1)
    expect(facturaRecibidaErp10).toBeTypeOf('function')
  })
})
