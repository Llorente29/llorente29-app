// tests/conta/e05/ejemplo.ts
//
// E05 · Una quincena de Catcher INVENTADA con la misma forma que los ficheros
// reales (doc de Julio, 15/10): el ZIP de PDF, el Excel FACTURAS (Invoices,
// Amounts By Partners, Commissions By Partners) y el Excel PEDIDOS
// (Worksheet). Nada real: los nombres, NIF/NIE, direcciones e importes son
// inventados (RGPD: lo de los riders, solo en producción).
//
// La quincena: 2.ª de septiembre de 2026, dos tiendas, tres riders, una flota
// y la comisión de Catcher. Lleva a propósito lo que pasó de verdad: un pedido
// cancelado con comisión cobrada y sin rider que lo facture (el «G236»), y un
// código de pedido que se repite en dos días.

import * as XLSX from 'xlsx'
import { zipSync } from 'fflate'
import { jsPDF } from 'jspdf'

export const TIENDA_A = 'FoodInt Camichi'
export const TIENDA_B = 'FoodInt Florencio Llorente'
export const EMPRESA = { nombre: 'EMPRESA INVENTADA, S.L.', nif: 'B00000099', domicilio: 'Calle Inventada 1, 28000 Madrid' }

export type FacturaInventada = {
  numero: string; pdf: string; nombre: string; nif: string; domicilio: string; cp: string; ciudad: string
  base: number; cuota: number; total: number; pedidos: number; fecha: string
  /** Lo de cada tienda (Amounts By Partners o, para Catcher, Commissions By Partners). */
  tiendas: { tienda: string; total: number; pedidos: number }[]
  tipo: 'rider' | 'flota' | 'catcher'
}

const r2 = (x: number) => Math.round(x * 100) / 100
const fac = (o: Omit<FacturaInventada, 'cuota' | 'total' | 'fecha'> & { fecha?: string }): FacturaInventada => {
  const cuota = r2(o.base * 0.21)
  return { ...o, cuota, total: r2(o.base + cuota), fecha: o.fecha ?? '2026-09-30' }
}

export const FACTURAS: FacturaInventada[] = [
  fac({ numero: 'ES_I_1001_26_7', pdf: 'invoice_1001_ES_I_1001_26_7.pdf', nombre: 'RIDER INVENTADO UNO', nif: '00000001R', domicilio: 'Calle Falsa 1', cp: '28001', ciudad: 'Madrid',
    base: 20.4, pedidos: 5, tiendas: [{ tienda: TIENDA_A, total: 12.24, pedidos: 3 }, { tienda: TIENDA_B, total: 8.16, pedidos: 2 }], tipo: 'rider' }),
  fac({ numero: 'ES_I_1002_26_7', pdf: 'invoice_1002_ES_I_1002_26_7.pdf', nombre: 'RIDER INVENTADA DOS', nif: 'X0000002T', domicilio: 'Calle Falsa 2', cp: '28002', ciudad: 'Madrid',
    base: 8.2, pedidos: 2, tiendas: [{ tienda: TIENDA_B, total: 8.2, pedidos: 2 }], tipo: 'rider' }),
  fac({ numero: 'ES_I_1003_26_7', pdf: 'invoice_1003_ES_I_1003_26_7.pdf', nombre: 'RIDER INVENTADO TRES', nif: '00000003A', domicilio: 'Calle Falsa 3', cp: '28003', ciudad: 'Madrid',
    base: 4, pedidos: 1, tiendas: [{ tienda: TIENDA_A, total: 4, pedidos: 1 }], tipo: 'rider' }),
  fac({ numero: 'ES_F_2001_26_7', pdf: 'invoice_fleet_2001_ES_F_2001_26_7.pdf', nombre: 'FLOTA INVENTADA, S.L.', nif: 'B00000044', domicilio: 'Polígono Inventado 4', cp: '28004', ciudad: 'Madrid',
    base: 4.7, pedidos: 1, tiendas: [{ tienda: TIENDA_B, total: 4.7, pedidos: 1 }], tipo: 'flota' }),
  // La comisión: 0,79 € de base por pedido, 10 pedidos (9 entregados + el cancelado).
  fac({ numero: 'CMS_2026_09_2', pdf: 'invoice_3001_CMS_2026_09_2.pdf', nombre: 'Catcher Marketplace SL', nif: 'B00000125', domicilio: 'Avenida Inventada 5', cp: '28005', ciudad: 'Madrid',
    base: 7.9, pedidos: 10, tiendas: [{ tienda: TIENDA_A, total: 3.16, pedidos: 4 }, { tienda: TIENDA_B, total: 4.74, pedidos: 6 }], tipo: 'catcher' }),
]

/** Los pedidos: [factura, tipo, código, estado, fecha y hora de Madrid, base]. G901 se repite en dos días; G236, cancelado, solo en la comisión. */
export const PEDIDOS: [string, string, string, string, string, number][] = [
  ['ES_I_1001_26_7', 'rider to pitcher', 'G901', 'finish', '2026-09-16 13:05:00', 4.2],
  ['ES_I_1001_26_7', 'rider to pitcher', 'G902', 'finish', '2026-09-16 13:40:00', 4.0],
  ['ES_I_1001_26_7', 'rider to pitcher', 'G903', 'finish', '2026-09-18 21:10:00', 4.0],
  ['ES_I_1001_26_7', 'rider to pitcher', 'G904', 'finish', '2026-09-20 14:02:00', 4.2],
  ['ES_I_1001_26_7', 'rider to pitcher', 'G905', 'finish', '2026-09-20 14:30:00', 4.0],
  ['ES_I_1002_26_7', 'rider to pitcher', 'G901', 'finish', '2026-09-27 20:15:00', 4.0],
  ['ES_I_1002_26_7', 'rider to pitcher', 'G906', 'finish', '2026-09-28 21:45:00', 4.2],
  ['ES_I_1003_26_7', 'rider to pitcher', 'G907', 'finish', '2026-09-29 13:30:00', 4.0],
  ['ES_F_2001_26_7', 'rider to pitcher', 'G908', 'finish', '2026-09-30 22:50:00', 4.7],
  ...(['G901|2026-09-16 13:05:00', 'G902|2026-09-16 13:40:00', 'G903|2026-09-18 21:10:00', 'G904|2026-09-20 14:02:00', 'G905|2026-09-20 14:30:00',
    'G901|2026-09-27 20:15:00', 'G906|2026-09-28 21:45:00', 'G907|2026-09-29 13:30:00', 'G908|2026-09-30 22:50:00'].map((x) => {
    const [cod, f] = x.split('|')
    return ['CMS_2026_09_2', 'pitcher commissions', cod, 'finish', f, 0.79] as [string, string, string, string, string, number]
  })),
  ['CMS_2026_09_2', 'pitcher commissions', 'G236', 'canceled', '2026-09-23 16:29:00', 0.79],
]

function libro(hojas: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new()
  for (const [n, filas] of Object.entries(hojas)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), n)
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

export function excelFacturas(fs: FacturaInventada[] = FACTURAS, empresa: typeof EMPRESA = EMPRESA): Uint8Array {
  const invoices = [['number', 'amount', 'vat', 'total', 'from_name', 'from_cif', 'from_location', 'from_cp', 'from_city', 'to_name', 'to_cif', 'to_location', 'to_cp', 'to_city',
    'total_orders', 'date_from', 'date_to', 'period', 'quarter', 'date_issue', 'external_invoice_number'],
  ...fs.map((f) => [f.numero, f.base, f.cuota, f.total, f.nombre, f.nif, f.domicilio, f.cp, f.ciudad, empresa.nombre, empresa.nif, 'Calle Inventada 1', '28000', 'Madrid',
    f.pedidos, '2026-09-16', '2026-09-30', '2026-09-2', '3T', f.fecha, ''])]
  const partners = [['id', 'name', 'socialName', 'totalOrders', 'total', 'driverId', 'riderDni', 'riderName', 'riderDir', 'type'],
    ...fs.filter((f) => f.tipo !== 'catcher').flatMap((f, i) => f.tiendas.map((t) => [i + 1, t.tienda, f.tipo === 'flota' ? f.nombre : '', t.pedidos, t.total, 100 + i,
      f.tipo === 'flota' ? '' : f.nif, f.tipo === 'flota' ? '' : f.nombre, f.domicilio, f.tipo === 'flota' ? 'fleet' : 'rider']))]
  const comisiones = [['id', 'name', 'totalOrders', 'total'], ...fs.filter((f) => f.tipo === 'catcher').flatMap((f) => f.tiendas.map((t, i) => [i + 1, t.tienda, t.pedidos, t.total]))]
  return libro({ Invoices: invoices, 'Amounts By Partners': partners, 'Commissions By Partners': comisiones })
}

export function excelPedidos(ps = PEDIDOS): Uint8Array {
  return libro({ Worksheet: [['invoice_number', 'type', 'order_code', 'order_status', 'order_date', 'amount', 'vat', 'total'],
    ...ps.map(([fa, t, cod, est, f, base]) => [fa, t, cod, est, f, base, r2(base * 0.21), r2(base * 1.21)])] })
}

// eslint-disable-next-line no-restricted-syntax -- importes inventados de la prueba, nunca null.
const coma = (x: number) => x.toFixed(2).replace('.', ',')
/** El PDF de una factura, con lo que lleva el de verdad. `cambia`: para hacer uno que no cuadra. */
export function pdf(f: FacturaInventada, cambia: Partial<FacturaInventada> = {}, empresa: typeof EMPRESA = EMPRESA): Uint8Array {
  const x = { ...f, ...cambia }
  const d = new jsPDF()
  const l = [
    'FACTURA', `Número: ${x.numero}`, `Fecha: ${x.fecha.split('-').reverse().join('/')}`,
    `Emisor: ${x.nombre}`, `NIF: ${x.nif}`, `${x.domicilio}, ${x.cp} ${x.ciudad}`,
    `Cobrar a: ${empresa.nombre}`, `NIF: ${empresa.nif}`, empresa.domicilio,
    'Ejercicio: 2026-09-16 - 2026-09-30', `Pedidos entregados: ${x.pedidos}`,
    `Base imponible: ${coma(x.base)} €`, `IVA 21%: ${coma(x.cuota)} €`, `Total: ${coma(x.total)} €`,
  ]
  l.forEach((t, i) => d.text(t, 15, 20 + i * 8))
  return new Uint8Array(d.output('arraybuffer'))
}

export function zip(fs: FacturaInventada[] = FACTURAS, extra: Record<string, Uint8Array> = {}, empresa: typeof EMPRESA = EMPRESA): Uint8Array {
  return zipSync({ ...Object.fromEntries(fs.map((f) => [f.pdf, pdf(f, {}, empresa)])), ...extra })
}

/** Los tres ficheros, como se arrastran. `empresa`: la que las recibe (en la e2e, la de la cuenta A de staging). */
export function quincenaInventada(empresa: typeof EMPRESA = EMPRESA) {
  return [
    { nombre: 'facturas-2026-09-2.zip', bytes: zip(FACTURAS, {}, empresa) },
    { nombre: 'FACTURAS_2026-09-2.xlsx', bytes: excelFacturas(FACTURAS, empresa) },
    { nombre: 'PEDIDOS_2026-09-2.xlsx', bytes: excelPedidos() },
  ]
}
