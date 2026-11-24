// tests/unit/modules/conta/erp10/salida.test.ts
//
// X04 · Lo que la pantalla «Salida a ERP10» enseña y baja (src/modules/conta/erp10/salida.ts),
// con lo que devuelven conta_erp10_por_salir, conta_erp10_recibidas_por_salir y (X05)
// conta_erp10_emitidas_por_salir en las pruebas de staging del X04 y del X05 (empresas
// inventadas, datos que se ven inventados: T11).

import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import * as XLSX from 'xlsx'
import { armarSalida, comprimirPdfs, importe, mesEnPalabras, mesesDesde, prepararDescarga, repartirPdfs, soloUna } from '@/modules/conta/erp10/salida'
import { aEmitidas, aPorSalir, aRecibidas, carpetaDeLaSalida } from '@/modules/conta/services/erp10Service'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const partida = (n: number, clase: string, o: Record<string, unknown> = {}) => ({
  entry_id: id(n), serie: clase === 'emitida' ? 1 : clase === 'asiento' ? 4 : 2, numero: n, fecha: '2026-10-05', concepto: `Inventado X04 ${n}`,
  origen: 'manual', clase, importe: 121, base_iva: 100, numero_factura: `X04-${n}`, nif: 'B00000000', tercero: 'Proveedor Inventado X04, S.L.',
  cuentas_base: 1, tiene_pdf: true, de_otro_mes: false, sale: true, avisos: [], ...o,
})
const L = (cuenta: string, plantilla: string, debe: number, haber: number, iva: [number, number] | null = null) =>
  ({ cuenta, plantilla, debe, haber, tipoIva: iva?.[0] ?? null, baseIva: iva?.[1] ?? null, deducible: iva ? 'yes' : null, recargo: null, modeloRetencion: null })
const recibida = (n: number, o: Record<string, unknown> = {}) => ({
  entryId: id(n), fecha: '2026-10-05', factura: { numero: `X04-${n}`, fecha: '2026-10-03' }, proveedor: { nombre: 'Proveedor Inventado X04, S.L.', nif: 'B00000000' },
  operacion: 'interior', lineas: [L('62900000', '629', 100, 0), L('47200000', '472', 21, 0, [21, 100]), L('40000001', '4000', 0, 121)],
  tienePdf: true, pdf: { ruta: `inventado/x04/${n}.pdf`, nombre: `${n}.pdf` }, ...o,
})

const PS = aPorSalir({
  mes: '2026-10-01', desde: '2026-10-01', codigo: '0007', largo: 8,
  partidas: [
    partida(1, 'recibida'), partida(2, 'recibida', { tiene_pdf: false, de_otro_mes: true }), partida(3, 'recibida'),
    partida(4, 'recibida', { sale: false, avisos: ['Esta factura reparte el gasto en 3 cuentas y ERP10 admite 2 al importar. Métela a mano en ERP10.', 'No tiene su PDF en Sumied: sale igual, y el PDF se pone después.'] }),
    partida(5, 'emitida', { importe: 121, origen: 'customer_invoice', numero_factura: 'F-2026/0001', tercero: 'Cliente Inventado X05, S.L.' }),
    partida(6, 'asiento', { importe: 30, numero_factura: null }), partida(7, 'asiento', { importe: 1000, numero_factura: null }),
    partida(8, 'emitida', { importe: 500, origen: 'sales_day', numero_factura: null, tercero: null, concepto: 'Ventas del día inventado' }),
    partida(9, 'emitida', { importe: 24.2, origen: 'customer_invoice', numero_factura: 'R-2026/0001', tercero: 'Cliente Inventado X05, S.L.' }),
    partida(10, 'emitida', { importe: 110, origen: 'customer_invoice', numero_factura: 'F-2026/0002', tercero: 'Cliente Inventado X05, S.L.', tiene_pdf: false }),
  ],
  cuentas_nuevas: [],
})
const RS = aRecibidas({
  recibidas: [
    recibida(1),
    recibida(2, { tienePdf: false, pdf: null }),
    // Una de bienes de la UE: no sale, con la frase del X03.
    recibida(3, { operacion: 'intra_bienes', lineas: [L('60000000', '600', 100, 0), L('47200000', '472', 21, 0, [21, 100]), L('47700000', '477', 0, 21), L('40000002', '4000', 0, 100)] }),
  ],
  cuentas: [
    { codigo: '40000001', plantilla: '4000', nombre: 'Proveedor Inventado X04', nif: 'B00000000', gastoHabitual: '62900000' },
    { codigo: '47200000', plantilla: '472', nombre: 'IVA soportado', nif: null, gastoHabitual: null },
    { codigo: '62900000', plantilla: '629', nombre: 'Otros servicios', nif: null, gastoHabitual: null },
  ],
  yaSalidas: { '62900000': '62900000' },
})
const E = (cuenta: string, plantilla: string, debe: number, haber: number, iva: [number, number] | null = null) =>
  ({ cuenta, plantilla, debe, haber, tipoIva: iva?.[0] ?? null, baseIva: iva?.[1] ?? null })
const emitida = (n: number, o: Record<string, unknown> = {}) => ({
  entryId: id(n), fecha: '2026-10-05', factura: { numero: `F-2026/000${n === 5 ? 1 : 2}`, fecha: '2026-10-05' },
  cliente: { nombre: 'Cliente Inventado X05, S.L.', nif: 'B00000000' }, origen: 'a_mano', rectificativa: false, tipoFactura: 'F1',
  operacion: 'interior', recargo: 0, retencion: 0,
  lineas: [E('43000001', '4300', 121, 0), E('70000000', '700', 0, 100), E('47700021', '477', 0, 21, [21, 100])],
  tienePdf: true, pdf: { ruta: `inventado/ventas/${n}/factura.pdf`, nombre: 'factura.pdf' }, ...o,
})
const ES = aEmitidas({
  emitidas: [
    emitida(5),
    emitida(9, { factura: { numero: 'R-2026/0001', fecha: '2026-10-20' }, rectificativa: true, tipoFactura: 'R4',
      lineas: [E('43000001', '4300', 0, 24.2), E('70000000', '700', 20, 0), E('47700021', '477', 4.2, 0, [21, 20])] }),
    emitida(10, { tienePdf: false, pdf: null, lineas: [E('43000001', '4300', 110, 0), E('70500000', '705', 0, 100), E('47700010', '477', 0, 10, [10, 100])] }),
  ],
  cuentas: [
    { codigo: '43000001', plantilla: '4300', nombre: 'Cliente Inventado X05', nif: 'B00000000', gastoHabitual: null },
    { codigo: '70000000', plantilla: '700', nombre: 'Ventas', nif: null, gastoHabitual: null },
  ],
  yaSalidas: { '62900000': '62900000' },
  corregidas: [{ entryId: id(11), numero: 'F-2026/0000', salioEn: '2026-10-31T10:00:00Z', rectificativa: 'R-2026/0002', fecha: '2026-11-02', queHacer: 'Salió a ERP10 y después se corrigió con la R-2026/0002: métela a mano en ERP10. No se vuelve a mandar.' }],
})
const CARPETA = carpetaDeLaSalida({ carpeta: null, codigo: '0007' })

describe('Lo que sale de un mes', () => {
  const s = armarSalida(PS, RS, ES, CARPETA)

  it('la carpeta de siempre: C:\\Sumied\\<código>\\', () => {
    expect(CARPETA).toBe('C:\\Sumied\\0007\\')
    expect(carpetaDeLaSalida({ carpeta: 'D:\\ERP10\\Doc', codigo: '0007' })).toBe('D:\\ERP10\\Doc')
  })

  it('las filas de «Qué sale», con sus cifras de verdad; las emitidas salen como las recibidas; los asientos, sin sus apuntes (aquí no los trae), no van; X08: un día del TPV sin sus datos se cuenta y no sale', () => {
    expect(s.filas.map((f) => [f.que, f.cuantos, f.importe, f.estado, f.texto, f.sale])).toEqual([
      ['Cuentas nuevas', 4, null, 'Listo', 'ERP10 no las tiene todavía; van las primeras', true],
      ['Facturas recibidas', 2, 242, 'Mira esto', '1 sin PDF · 2 no pueden salir', true],
      ['Facturas emitidas', 2, 231, 'Mira esto', '1 sin PDF · 1 no puede salir', true],
      ['Asientos', 0, 0, 'Nada', 'Ninguno este mes', true],
      ['Días de ventas del TPV', 0, 0, 'Mira esto', '1 no puede salir', true],
      ['Los PDF', 2, null, 'Listo', 'Con el nombre de su factura, para que ERP10 los pegue solo', true],
    ])
  })

  it('las listas enteras: la recibida de otro mes, marcada', () => {
    expect(s.listas.recibidas.map((f) => [f.numero, f.importe, f.deOtroMes, f.pdf])).toEqual([
      ['X04-1', 121, false, '20261003_Proveedor-Inventado-X04-S-L_X04-1.pdf'],
      ['X04-2', 121, true, null],
    ])
    expect(s.listas.emitidas.map((f) => [f.numero, f.tercero, f.importe, f.pdf])).toEqual([
      ['F-2026/0001', 'Cliente Inventado X05, S.L.', 121, '20261005_Cliente-Inventado-X05-S-L_F-2026-0001.pdf'],
      ['F-2026/0002', 'Cliente Inventado X05, S.L.', 110, null],
    ])
    expect(s.listas.asientos).toHaveLength(0)
    expect(s.listas.tpv).toHaveLength(0)
  })

  it('«Qué mirar»: las sin PDF y las que no pueden salir, de cada clase, con su frase; y las corregidas después de salir', () => {
    expect(s.sinPdf.map((f) => [f.clase, f.numero])).toEqual([['emitida', 'F-2026/0002'], ['recibida', 'X04-2']])
    expect(s.noPuedenSalir.filter((x) => x.clase === 'dia').map((x) => x.porque)).toEqual(['No se ha leído el día del TPV: vuelve a cargar la página.'])
    expect(s.noPuedenSalir.filter((x) => x.clase !== 'dia').map((x) => [x.clase, x.numero, x.porque])).toEqual([
      ['recibida', 'X04-3', 'Es una compra de bienes en otro país de la UE, y ERP10 solo la admite al importar si es de servicios. Métela a mano en ERP10.'],
      ['recibida', 'X04-4', 'Esta factura reparte el gasto en 3 cuentas y ERP10 admite 2 al importar. Métela a mano en ERP10.'],
      ['emitida', 'R-2026/0001', 'Es una rectificativa, y ERP10 no la admite al importar. Métela a mano en ERP10.'],
    ])
    expect(s.corregidas.map((x) => x.rectificativa)).toEqual(['R-2026/0002'])
  })

  it('las cuentas nuevas: la del proveedor (la de gasto ya salió) y la del cliente, con su NIF; y las de ingreso', () => {
    expect(s.listas.cuentas).toEqual([
      { codigo: '40000001', codigoErp10: '40000001', nombre: 'Proveedor Inventado X04', nif: 'B00000000' },
      { codigo: '43000001', codigoErp10: '43000001', nombre: 'Cliente Inventado X05', nif: 'B00000000' },
      { codigo: '70000000', codigoErp10: '70000000', nombre: 'Ventas', nif: null },
      { codigo: '70500000', codigoErp10: '70500000', nombre: '70500000', nif: null },
    ])
    expect(s.ficheros.subcuentas).toEqual([
      ['40000001', 'Proveedor Inventado X04', 'B00000000', '62900000'], ['43000001', 'Cliente Inventado X05', 'B00000000', ''], ['70000000', 'Ventas', '', ''], ['70500000', '70500000', '', ''],
    ])
  })

  it('las comprobaciones que se afirman de lo que sale', () => {
    expect(s.comprobaciones).toEqual(['Cada factura lleva su registro de IVA', 'Ninguna repetida', 'Todas cuadran'])
    expect(armarSalida({ ...PS, partidas: [] }, { ...RS, recibidas: [] }, { ...ES, emitidas: [] }, CARPETA).comprobaciones).toEqual([])
  })

  it('la ruta del PDF en la fila es la carpeta y el nombre', () => {
    expect(s.ficheros.expedidas[0].fila).toContain(`C:\\Sumied\\0007\\${s.listas.pdf[0].nombre}`)
    expect(s.ficheros.recibidas[0].fila).toContain(`C:\\Sumied\\0007\\${s.listas.pdf[1].nombre}`)
    expect(s.ficheros.pdfs).toEqual([
      { nombre: s.listas.pdf[0].nombre, ruta: 'inventado/ventas/5/factura.pdf', entryId: id(5) },
      { nombre: s.listas.pdf[1].nombre, ruta: 'inventado/x04/1.pdf', entryId: id(1) },
    ])
  })

  it('la descarga: tres libros sin títulos, en el orden en que se importan, con su huella, y una huella por cada factura', async () => {
    const d = await prepararDescarga(s)
    expect(d.libros.map((l) => [l.nombre, l.filas])).toEqual([['subcuentas.xlsx', 4], ['expedidas.xlsx', 2], ['recibidas.xlsx', 2]])
    for (const l of d.libros) expect(l.huella).toMatch(/^[0-9a-f]{64}$/)
    const wb = XLSX.read(new Uint8Array(d.libros[1].bytes), { type: 'array' })
    expect(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })).toHaveLength(2)
    expect(d.partidas.map((p) => [p.entry_id, p.clase])).toEqual([[id(5), 'emitida'], [id(10), 'emitida'], [id(1), 'recibida'], [id(2), 'recibida']])
    expect(new Set(d.partidas.map((p) => p.huella)).size).toBe(4)
  })

})

describe('Los PDF, en ficheros comprimidos', () => {
  const pdf = (nombre: string, n: number) => ({ nombre, bytes: new Uint8Array(n).fill(7) })
  it('un mes que cabe: pdf.zip, con los nombres de las filas', () => {
    const z = comprimirPdfs([pdf('a.pdf', 10), pdf('b.pdf', 20)])
    expect(z.map((x) => [x.nombre, x.pdfs])).toEqual([['pdf.zip', 2]])
    expect(Object.keys(unzipSync(z[0].bytes)).sort()).toEqual(['a.pdf', 'b.pdf'])
    expect(unzipSync(z[0].bytes)['b.pdf']).toHaveLength(20)
  })
  it('si pasa del tope, en varios: pdf-1.zip, pdf-2.zip… sin partir ninguno', () => {
    expect(repartirPdfs([pdf('a', 60), pdf('b', 50), pdf('c', 30), pdf('d', 200)], 100).map((g) => g.map((p) => p.nombre))).toEqual([['a'], ['b', 'c'], ['d']])
    expect(comprimirPdfs([pdf('a.pdf', 60), pdf('b.pdf', 50)], 100).map((x) => x.nombre)).toEqual(['pdf-1.zip', 'pdf-2.zip'])
  })
})

describe('Las cifras y los meses', () => {
  it('importes con punto de miles y coma decimal, siempre con dos', () => {
    expect([importe(20730.65), importe(0), importe(-1234.5), importe(1000000)]).toEqual(['20.730,65', '0,00', '−1.234,50', '1.000.000,00'])
  })
  it('los meses desde el primero que sale hasta hoy, del más nuevo al más viejo', () => {
    expect(mesesDesde('2026-10-15', '2027-01-03')).toEqual(['2027-01-01', '2026-12-01', '2026-11-01', '2026-10-01'])
    expect(mesesDesde('2026-12-01', '2026-11-17')).toEqual(['2026-11-01'])
    expect(mesEnPalabras('2026-11-01')).toBe('noviembre de 2026')
  })
})

describe('X06 · Volver a sacar solo una', () => {
  const s = armarSalida(PS, RS, ES, CARPETA)
  it('la salida con una sola factura: su fila y su PDF, sin subcuentas', () => {
    const x = soloUna(s, id(1))!
    expect(x.ficheros.subcuentas).toEqual([])
    expect(x.ficheros.expedidas).toEqual([])
    expect(x.ficheros.recibidas.map((f) => f.entryId)).toEqual([id(1)])
    expect(x.ficheros.pdfs.map((p) => p.entryId)).toEqual([id(1)])
    expect([x.totalRecibidas, x.totalEmitidas]).toEqual([121, 0])
  })
  it('una que no está en lo que sale: nulo', () => {
    expect(soloUna(s, id(4))).toBeNull()
  })
})
