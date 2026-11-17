// tests/unit/modules/conta/erp10/salida.test.ts
//
// X04 · Lo que la pantalla «Salida a ERP10» enseña y baja (src/modules/conta/erp10/salida.ts),
// con lo que devuelven conta_erp10_por_salir y conta_erp10_recibidas_por_salir en la prueba de
// staging del X04 (empresa inventada, datos que se ven inventados: T11).

import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import * as XLSX from 'xlsx'
import { armarSalida, comprimirPdfs, importe, mesEnPalabras, mesesDesde, prepararDescarga, repartirPdfs } from '@/modules/conta/erp10/salida'
import { aPorSalir, aRecibidas, carpetaDeLaSalida } from '@/modules/conta/services/erp10Service'

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
    partida(4, 'recibida', { sale: false, avisos: ['Reparte la base en 5 cuentas y ERP10 admite 4: no sale.', 'No tiene su PDF en Sumied: sale igual, y el PDF se pone después.'] }),
    partida(5, 'emitida', { importe: 242 }), partida(6, 'asiento', { importe: 30, numero_factura: null }), partida(7, 'asiento', { importe: 1000, numero_factura: null }),
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
const CARPETA = carpetaDeLaSalida({ carpeta: null, codigo: '0007' })

describe('Lo que sale de un mes', () => {
  const s = armarSalida(PS, RS, CARPETA)

  it('la carpeta de siempre: C:\\Sumied\\<código>\\', () => {
    expect(CARPETA).toBe('C:\\Sumied\\0007\\')
    expect(carpetaDeLaSalida({ carpeta: 'D:\\ERP10\\Doc', codigo: '0007' })).toBe('D:\\ERP10\\Doc')
  })

  it('las cinco filas de «Qué sale», con sus cifras de verdad; emitidas y asientos se cuentan y no salen', () => {
    expect(s.filas.map((f) => [f.que, f.cuantos, f.importe, f.estado, f.texto, f.sale])).toEqual([
      ['Cuentas nuevas', 1, null, 'Listo', 'ERP10 no las tiene todavía; van las primeras', true],
      ['Facturas recibidas', 2, 242, 'Mira esto', '1 sin PDF · 2 no pueden salir', true],
      ['Facturas emitidas', 1, 242, 'Todavía no sale por aquí', 'Se cuentan; aún no van en la descarga', false],
      ['Asientos', 2, 1030, 'Todavía no sale por aquí', 'Nóminas, bancos, traspasos; aún no van', false],
      ['Los PDF', 1, null, 'Listo', 'Con el nombre de su factura, para que ERP10 los pegue solo', true],
    ])
  })

  it('las listas enteras: la recibida de otro mes, marcada', () => {
    expect(s.listas.recibidas.map((f) => [f.numero, f.importe, f.deOtroMes, f.pdf])).toEqual([
      ['X04-1', 121, false, '20261003_Proveedor-Inventado-X04-S-L_X04-1.pdf'],
      ['X04-2', 121, true, null],
    ])
    expect(s.listas.asientos).toHaveLength(2)
    expect(s.listas.emitidas).toHaveLength(1)
  })

  it('«Qué mirar»: la sin PDF, y las que no pueden salir con su frase (la de la base sin el aviso del PDF, y la del X03)', () => {
    expect(s.sinPdf.map((f) => f.numero)).toEqual(['X04-2'])
    expect(s.noPuedenSalir.map((x) => [x.numero, x.porque])).toEqual([
      ['X04-3', 'Es una compra de bienes en otro país de la UE, y ERP10 solo la admite al importar si es de servicios. Métela a mano en ERP10.'],
      ['X04-4', 'Reparte la base en 5 cuentas y ERP10 admite 4: no sale.'],
    ])
  })

  it('las cuentas nuevas: la del proveedor (la de gasto ya salió), con su ficha y su gasto habitual', () => {
    expect(s.listas.cuentas).toEqual([{ codigo: '40000001', codigoErp10: '40000001', nombre: 'Proveedor Inventado X04', nif: 'B00000000' }])
    expect(s.ficheros.subcuentas).toEqual([['40000001', 'Proveedor Inventado X04', 'B00000000', '62900000']])
  })

  it('las comprobaciones que se afirman de lo que sale', () => {
    expect(s.comprobaciones).toEqual(['Cada factura lleva su registro de IVA', 'Ninguna repetida', 'Todas cuadran'])
    expect(armarSalida({ ...PS, partidas: [] }, { ...RS, recibidas: [] }, CARPETA).comprobaciones).toEqual([])
  })

  it('la ruta del PDF en la fila es la carpeta y el nombre', () => {
    expect(s.ficheros.recibidas[0].fila).toContain(`C:\\Sumied\\0007\\${s.listas.pdf[0].nombre}`)
    expect(s.ficheros.pdfs).toEqual([{ nombre: s.listas.pdf[0].nombre, ruta: 'inventado/x04/1.pdf' }])
  })

  it('la descarga: dos libros sin títulos, con su huella, y una huella por cada factura', async () => {
    const d = await prepararDescarga(s)
    expect(d.libros.map((l) => [l.nombre, l.filas])).toEqual([['subcuentas.xlsx', 1], ['recibidas.xlsx', 2]])
    for (const l of d.libros) expect(l.huella).toMatch(/^[0-9a-f]{64}$/)
    const wb = XLSX.read(new Uint8Array(d.libros[1].bytes), { type: 'array' })
    expect(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })).toHaveLength(2)
    expect(d.partidas.map((p) => [p.entry_id, p.clase])).toEqual([[id(1), 'recibida'], [id(2), 'recibida']])
    expect(new Set(d.partidas.map((p) => p.huella)).size).toBe(2)
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
