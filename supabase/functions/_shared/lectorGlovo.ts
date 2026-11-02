// supabase/functions/_shared/lectorGlovo.ts
//
// S01j · Vive aquí para que lo usen los dos lados: la pantalla (el Excel subido a
// mano; src/modules/conta/lib/lectorGlovo.ts lo reexporta) y la entrada de correo
// (el Excel que llega con la factura de Glovo). Es el mismo lector.
//
// V02 · Entrega 2 · EL LECTOR DE LA LIQUIDACIÓN DE GLOVO. Puro: ni red ni base.
// Glovo manda dos ficheros por tienda y quincena, con el mismo número:
//   · el PDF «Invoicing_Document-<n>.pdf»: es su FACTURA DE COMISIÓN (a
//     Compras, como cualquier recibida) y lleva al pie la liquidación: Productos,
//     Servicio de entrega, Total factura e «Ingreso a cuenta colaborador» (el neto);
//   · el Excel «invoice-<n>.XLSX»: los pedidos uno a uno, con el ID de la tienda.
// La tienda se reconoce por su «ID de la tienda» del Excel (nunca por su
// nombre); el PDF no lo trae, así que solo con el PDF va por un nombre ya visto.
//
// La forma, medida en la de Julio (I170326000540680, Mila's Sandwiches, 1–15/10):
//   · Excel: una fila por pedido; lo que paga el cliente va en negativo
//     (Productos −25,90; Servicio de entrega −4,50; Recargo por mínimo de pedido
//     −3,00) y lo que cobra Glovo en positivo («Amount 1» es su base: Tasa de
//     acceso + Recargo Glovo Prime);
//   · PDF: «Factura Nº», «Servicio prestado entre dd.mm.aaaa - dd.mm.aaaa»,
//     «Fecha de Pago», «Base imponible (21%)», «IVA/IGIC/IPSI (21%)», «Total
//     factura (IVA/IGIC/IPSI incluido)», «Productos», «Servicio de entrega»,
//     «Ingreso a cuenta colaborador».
// Cuadrado al céntimo: Productos 218,00 + Servicio de entrega 61,50 (49,50 de
// envío + 12,00 de mínimo de pedido) − factura 43,23 = ingreso 236,27. El IVA de
// la factura se calcula sobre su base total (7,50), no pedido a pedido (7,51).
//
// Lo que no se ha visto aún (promociones a cargo del local, incidencias,
// devoluciones): si una liquidación las trae, se dice en «avisos» y el neto que
// vale es el del PDF.

import { eurosExactos } from './euros.ts'

/** Lo que va a conta_liquidacion_registrar (la misma forma que DatosRegistrar del front). */
export interface DatosRegistrar {
  proveedor: string
  origen: string
  tienda: string | null
  tienda_id: string | null
  desde: string
  hasta: string
  pedidos: number | null
  ventas: { total: number; base?: number | null; iva?: number | null }
  pedidos_total?: number | null
  comision: number
  otros: number
  neto: number
  referencia?: string | null
  pago_el?: string | null
  factura?: { numero: string | null; base: number; iva: number; total: number } | null
  intermediario?: { nombre: string; nif: string | null } | null
  avisos?: string[]
  email_id?: string | null
}

export class NoEsLiquidacionGlovo extends Error {}

const r2 = (x: number): number => Math.round(x * 100) / 100
const quitar = (s: string): string => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
const n = (v: unknown): number => (typeof v === 'number' ? v : v === null || v === undefined || v === '' ? 0 : Number(String(v).replace(',', '.')))
const GLOVO = { nombre: 'Glovoapp Spain Platform S.L.', nif: 'B67282871' }

/** Lo que dice el Excel de una factura (un número). */
export interface ExcelGlovo {
  numero: string
  fechaFactura: string
  tienda: string
  direccion: string
  tiendaId: string
  pedidos: number
  productos: number
  entrega: number
  comisionBase: number
  sinVer: string[]
}

/** Lo que dice el PDF. */
export interface PdfGlovo {
  numero: string
  desde: string
  hasta: string
  fecha: string
  pagoEl: string | null
  tienda: string | null
  base: number
  iva: number
  total: number
  productos: number
  entrega: number
  ingreso: number
}

const fechaDe = (v: unknown): string => {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  const s = String(v ?? '').trim()
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  throw new NoEsLiquidacionGlovo(`«${s}» no es una fecha.`)
}

const COLS_SIN_VER = ['promoción producto asumida por partner', 'promoción de oferta flash a cargo del partner', 'promoción df asumida por partner',
  'coste de incidencias sobre productos', 'devoluciones de incidencias sobre productos', 'glovos ya remunerados', 'tasa de servicio pagada en efectivo'] as const

/** ¿Son las filas del Excel de Glovo? (las de la primera hoja, como objetos por su cabecera). */
export const esExcelGlovo = (filas: readonly Record<string, unknown>[]): boolean => {
  const k = new Set(Object.keys(filas[0] ?? {}).map(quitar))
  return k.has('número de factura') && k.has('id de la tienda') && k.has('productos') && k.has('código de glovo')
}

/** El Excel: una liquidación por número de factura. */
export function leerExcelGlovo(filas: readonly Record<string, unknown>[]): ExcelGlovo[] {
  if (!filas.length || !esExcelGlovo(filas)) throw new NoEsLiquidacionGlovo('No es el Excel de una liquidación de Glovo.')
  const porNumero = new Map<string, ExcelGlovo>()
  for (const bruta of filas) {
    const f: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(bruta)) f[quitar(k)] = v
    const numero = String(f['número de factura'] ?? '').trim()
    if (!numero) continue
    let x = porNumero.get(numero)
    if (!x) {
      x = { numero, fechaFactura: fechaDe(f['fecha de factura']), tienda: String(f['nombre de la tienda'] ?? '').trim(), direccion: String(f['dirección de la tienda'] ?? '').trim(),
            tiendaId: String(f['id de la tienda'] ?? '').trim(), pedidos: 0, productos: 0, entrega: 0, comisionBase: 0, sinVer: [] }
      porNumero.set(numero, x)
    }
    x.pedidos += 1
    x.productos = r2(x.productos - n(f['productos']))
    x.entrega = r2(x.entrega - n(f['servicio de entrega']) - n(f['recargo por mínimo de pedido']))
    x.comisionBase = r2(x.comisionBase + n(f['amount 1']))
    for (const c of COLS_SIN_VER) if (n(f[c]) !== 0 && !x.sinVer.includes(c)) x.sinVer.push(c)
  }
  if (!porNumero.size) throw new NoEsLiquidacionGlovo('El Excel no trae ningún pedido.')
  return [...porNumero.values()]
}

const importePdf = (texto: string, etiqueta: RegExp): number | null => {
  const m = new RegExp(etiqueta.source + String.raw`\s+(-?[\d.]+,\d{2})\s*EUR`, 'i').exec(texto)
  return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null
}

/** El texto del PDF (la factura con la liquidación al pie). */
export function leerPdfGlovo(texto: string): PdfGlovo {
  const t = texto.replace(/\u00a0/g, ' ')
  if (!/glovoapp/i.test(t) || !/Ingreso a cuenta colaborador/i.test(t)) throw new NoEsLiquidacionGlovo('No es la factura con la liquidación de Glovo.')
  const numero = /Factura N[ºo°]:?\s+([A-Z0-9-]+)/i.exec(t)?.[1]
  const periodo = /Servicio prestado entre\s+(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/i.exec(t)
  const fecha = /Fecha:\s+(\d{2}\.\d{2}\.\d{4})/i.exec(t)?.[1]
  if (!numero || !periodo || !fecha) throw new NoEsLiquidacionGlovo('La factura de Glovo no dice su número, su periodo o su fecha.')
  const base = importePdf(t, /Base imponible \(\d+%\)/); const iva = importePdf(t, /IVA\/IGIC\/IPSI \(\d+%\)/)
  const total = importePdf(t, /Total factura \(IVA\/IGIC\/IPSI incluido\)/); const productos = importePdf(t, /Productos/)
  const entrega = importePdf(t, /Servicio de entrega/) ?? 0; const ingreso = importePdf(t, /Ingreso a cuenta colaborador/)
  if (base === null || iva === null || total === null || productos === null || ingreso === null) throw new NoEsLiquidacionGlovo('A la factura de Glovo le faltan importes.')
  if (Math.round(base * 100) + Math.round(iva * 100) !== Math.round(total * 100)) throw new NoEsLiquidacionGlovo('La factura de Glovo no cuadra: base + IVA no es el total.')
  if (Math.round((productos + entrega - total) * 100) !== Math.round(ingreso * 100)) throw new NoEsLiquidacionGlovo('La liquidación de Glovo no cuadra: productos + entrega − factura no es el ingreso.')
  // La tienda: la línea con « - MAD - » (o la segunda del destinatario), sin el nombre de la empresa delante.
  // La calle, en la línea de debajo (lo de antes del hueco con «Fecha:»).
  const mTienda = /\n\s*([^\n]*? - [A-Z]{3} - [^\n]*?)\s+Servicio prestado[^\n]*\n\s*(.+?)\s{2,}Fecha:/i.exec(t)
  const tienda = mTienda ? nombreTienda(mTienda[1], mTienda[2]) : null
  const pagoEl = /Fecha de Pago:\s+(\d{2}\.\d{2}\.\d{4})/i.exec(t)?.[1]
  return { numero, desde: fechaDe(periodo[1]), hasta: fechaDe(periodo[2]), fecha: fechaDe(fecha), pagoEl: pagoEl ? fechaDe(pagoEl) : null, tienda,
           base, iva, total, productos, entrega, ingreso }
}

/** El nombre con el que se aprende la tienda: «Marca - MAD - calle corta (Calle y número)», igual desde el Excel y desde el PDF. */
export const nombreTienda = (nombre: string, direccion: string): string =>
  `${nombre.split(';').pop()!.replace(/^LLORENTE29 FOOD\s+/i, '').trim()} (${direccion.split(',')[0].trim()})`

/** La quincena de una factura de Glovo: la del 15 cubre del 1 al 15; la de fin de mes, del 16 al último. */
export function quincenaDe(fechaFactura: string): [string, string] {
  const [a, m, d] = fechaFactura.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return d <= 15 ? [`${a}-${mm}-01`, `${a}-${mm}-15`] : [`${a}-${mm}-16`, `${a}-${mm}-${String(ultimo).padStart(2, '0')}`]
}

/**
 * Lo que va a la base, con el Excel, el PDF o los dos (del mismo número). Con
 * los dos manda el PDF en los importes (es el documento fiscal) y el Excel pone
 * el ID de la tienda y los pedidos; si no casan, se dice.
 */
export function paraRegistrarGlovo(x: { excel?: ExcelGlovo | null; pdf?: PdfGlovo | null }): DatosRegistrar {
  const { excel, pdf } = x
  if (!excel && !pdf) throw new NoEsLiquidacionGlovo('Falta la liquidación de Glovo.')
  if (excel && pdf && excel.numero !== pdf.numero) throw new NoEsLiquidacionGlovo(`El Excel (${excel.numero}) y el PDF (${pdf.numero}) no son de la misma liquidación.`)
  const avisos: string[] = []
  const [desde, hasta] = pdf ? [pdf.desde, pdf.hasta] : quincenaDe(excel!.fechaFactura)
  const base = pdf?.base ?? excel!.comisionBase
  const iva = pdf?.iva ?? r2(base * 0.21)
  const total = pdf?.total ?? r2(base + iva)
  const productos = pdf?.productos ?? excel!.productos
  const entrega = pdf?.entrega ?? excel!.entrega
  const neto = pdf?.ingreso ?? r2(productos + entrega - total)
  if (excel && pdf && (Math.round(excel.productos * 100) !== Math.round(pdf.productos * 100) || Math.round(excel.entrega * 100) !== Math.round(pdf.entrega * 100))) {
    avisos.push(`El Excel suma ${eurosExactos(excel.productos)} de productos y ${eurosExactos(excel.entrega)} de entrega, y el PDF ${eurosExactos(pdf.productos)} y ${eurosExactos(pdf.entrega)}: vale el PDF.`)
  }
  if (excel?.sinVer.length) avisos.push(`Trae ${excel.sinVer.join(', ')}: ${pdf ? 'el neto es el del PDF' : 'súbela con su PDF para que el neto sea el de Glovo'}.`)
  const tienda = excel ? nombreTienda(excel.tienda, excel.direccion) : pdf!.tienda
  return {
    proveedor: 'glovo', origen: excel ? 'excel' : 'pdf', tienda, tienda_id: excel?.tiendaId ?? null, desde, hasta,
    pedidos: excel?.pedidos ?? null, ventas: { total: productos }, comision: total, otros: entrega, neto,
    referencia: (excel ?? pdf)!.numero, pago_el: pdf?.pagoEl ?? null,
    factura: { numero: (excel ?? pdf)!.numero, base, iva, total }, intermediario: GLOVO, avisos,
  }
}
