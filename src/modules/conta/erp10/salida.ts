// src/modules/conta/erp10/salida.ts
//
// X04 · Lo que la pantalla «Salida a ERP10» enseña y baja, sin red ni base:
// junta lo que sale del mes (conta_erp10_por_salir), las recibidas con lo que
// necesita su fila (conta_erp10_recibidas_por_salir) y el módulo del X03
// (ficheros.ts). De aquí salen las cinco filas de «Qué sale», los avisos de «Qué
// mirar antes de sacarlo», las comprobaciones que se pueden afirmar, los dos
// ficheros con sus huellas, la lista de PDF y cómo se reparten en ficheros
// comprimidos.
//
// Por ahora solo salen las cuentas nuevas y las facturas recibidas (encargo
// X04): las emitidas y los asientos se cuentan y se enseñan, con «Todavía no sale
// por aquí», pero no entran en la descarga (regla 7: se dice, no se esconde).

import { zipSync } from 'fflate'
import { columnas } from '../../../../supabase/functions/_shared/diezExcel.ts'
import { XML_RECIBIDAS } from '@/modules/conta/erp10/configuracion'
import {
  FICHERO_RECIBIDAS, FICHERO_SUBCUENTAS, convertirCuentas, filaSubcuenta, huellaFila, libroErp10, prepararRecibidas, type Fila,
} from '@/modules/conta/erp10/ficheros'
import type { PartidaPorSalir, PorSalir, RecibidasPorSalir } from '@/modules/conta/services/erp10Service'

export type Estado = 'Listo' | 'Mira esto' | 'Todavía no sale por aquí' | 'Nada'
export interface FilaQueSale { id: 'cuentas' | 'recibidas' | 'emitidas' | 'asientos' | 'pdf'; que: string; cuantos: number; importe: number | null; estado: Estado; texto: string; sale: boolean }

export interface FacturaQueSale { entryId: string; fecha: string; proveedor: string; numero: string; importe: number; deOtroMes: boolean; pdf: string | null }
export interface NoPuedeSalir { entryId: string; fecha: string; quien: string; numero: string; porque: string }

export interface Salida {
  filas: FilaQueSale[]
  /** Las listas de cada fila, enteras (regla 7). */
  listas: {
    cuentas: { codigo: string; codigoErp10: string; nombre: string; nif: string | null }[]
    recibidas: FacturaQueSale[]
    emitidas: PartidaPorSalir[]
    asientos: PartidaPorSalir[]
    pdf: { nombre: string; ruta: string; factura: string }[]
  }
  /** «Qué mirar antes de sacarlo». */
  sinPdf: FacturaQueSale[]
  noPuedenSalir: NoPuedeSalir[]
  /** Las comprobaciones que se pueden afirmar de verdad de lo que sale. */
  comprobaciones: string[]
  /** Lo que va a los ficheros. */
  ficheros: {
    subcuentas: Fila[]
    recibidas: { entryId: string; fila: Fila }[]
    pdfs: { nombre: string; ruta: string }[]
  }
  /** Lo que suma lo que sale (para la confirmación). */
  totalRecibidas: number
}

const c = (x: number) => Math.round(x * 100)

/**
 * Junta lo que sale. `carpeta`: la carpeta del ordenador de ERP10 donde se
 * descomprimen los PDF (la de la ficha, o C:\Sumied\<código>\).
 */
export function armarSalida(ps: PorSalir, rs: RecibidasPorSalir, carpeta: string): Salida {
  const plan = new Map(rs.cuentas.map((x) => [x.codigo, x.plantilla]))
  for (const r of rs.recibidas) for (const l of r.lineas) plan.set(l.cuenta, l.plantilla)
  const prep = prepararRecibidas(rs.recibidas, { plan, largo: ps.largo, carpetaPdf: carpeta, yaSalidas: rs.yaSalidas })
  const porId = new Map(rs.recibidas.map((r) => [r.entryId, r]))
  const partida = new Map(ps.partidas.map((p) => [p.entryId, p]))
  const colTotal = columnas(XML_RECIBIDAS)['045'] - 1

  // Las recibidas que salen, con su total de factura (la columna del total en su fila).
  const recibidas: FacturaQueSale[] = prep.filas.map((f) => {
    const r = porId.get(f.entryId)!
    return {
      entryId: f.entryId, fecha: r.factura.fecha, proveedor: r.proveedor.nombre, numero: f.numero, importe: Number(f.fila[colTotal]),
      deOtroMes: partida.get(f.entryId)?.deOtroMes ?? false, pdf: f.pdf,
    }
  })
  const totalRecibidas = recibidas.reduce((t, x) => t + c(x.importe), 0) / 100

  // Las cuentas nuevas: las que usan las filas que salen y no han salido nunca.
  const salidas = new Set(rs.yaSalidas.values())
  const nuevas = [...prep.cuentas].filter((k) => !salidas.has(k)).sort()
  const datos = new Map(rs.cuentas.map((x) => [x.codigo, x]))
  // La cuenta de gasto habitual va en la ficha si ERP10 la va a tener: sale ahora o ya salió.
  const conGasto = [...new Set([...nuevas, ...nuevas.map((k) => datos.get(k)?.gastoHabitual).filter((g): g is string => !!g && plan.has(g))])]
  const { erp } = convertirCuentas(conGasto, plan, ps.largo, rs.yaSalidas)
  for (const [x, k] of rs.yaSalidas) erp.set(k, x)
  const cuentas = nuevas.map((k) => ({ codigo: k, codigoErp10: erp.get(k) ?? k, nombre: datos.get(k)?.nombre ?? k, nif: datos.get(k)?.nif ?? null }))
  const subcuentas = nuevas.map((k) => {
    const g = datos.get(k)?.gastoHabitual ?? null
    return filaSubcuenta({ codigo: k, nombre: datos.get(k)?.nombre ?? k, nif: datos.get(k)?.nif ?? null, gastoHabitual: g && erp.has(g) && (nuevas.includes(g) || salidas.has(g)) ? g : null }, erp)
  })

  // Lo que no puede salir: lo que la base ya dice que no sale (de las recibidas) y lo que no pasa el módulo.
  const quien = (p: PartidaPorSalir) => p.tercero ?? p.concepto
  const noPuedenSalir: NoPuedeSalir[] = [
    ...ps.partidas.filter((p) => p.clase === 'recibida' && !p.sale).map((p) => ({
      entryId: p.entryId, fecha: p.fecha, quien: quien(p), numero: p.numeroFactura ?? `${p.serie}/${p.numero ?? ''}`,
      porque: p.avisos.filter((a) => !a.startsWith('No tiene su PDF')).join(' '),
    })),
    ...prep.noSalen.map((x) => {
      const r = porId.get(x.entryId)
      return { entryId: x.entryId, fecha: r?.factura.fecha ?? '', quien: r?.proveedor.nombre ?? '', numero: x.numero, porque: x.porque }
    }),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero.localeCompare(b.numero))

  const sinPdf = recibidas.filter((x) => !x.pdf)
  const pdfs = prep.filas.filter((f) => f.pdf).map((f) => ({ nombre: f.pdf!, ruta: porId.get(f.entryId)!.pdf!.ruta }))
  const emitidas = ps.partidas.filter((p) => p.clase === 'emitida')
  const asientos = ps.partidas.filter((p) => p.clase === 'asiento')
  const suma = (xs: PartidaPorSalir[]) => xs.reduce((t, p) => t + c(p.importe), 0) / 100

  const filas: FilaQueSale[] = [
    { id: 'cuentas', que: 'Cuentas nuevas', cuantos: nuevas.length, importe: null, sale: true,
      estado: nuevas.length ? 'Listo' : 'Nada', texto: nuevas.length ? 'ERP10 no las tiene todavía; van las primeras' : 'Todas las que usan ya están en ERP10' },
    { id: 'recibidas', que: 'Facturas recibidas', cuantos: recibidas.length, importe: totalRecibidas, sale: true,
      estado: sinPdf.length || noPuedenSalir.length ? 'Mira esto' : recibidas.length ? 'Listo' : 'Nada',
      texto: [sinPdf.length ? `${sinPdf.length} sin PDF` : '', noPuedenSalir.length ? `${noPuedenSalir.length} no ${noPuedenSalir.length === 1 ? 'puede' : 'pueden'} salir` : ''].filter(Boolean).join(' · ')
        || (recibidas.length ? 'Todas con su PDF' : 'Ninguna este mes') },
    { id: 'emitidas', que: 'Facturas emitidas', cuantos: emitidas.length, importe: suma(emitidas), sale: false, estado: 'Todavía no sale por aquí',
      texto: emitidas.length ? 'Se cuentan; aún no van en la descarga' : 'Ninguna este mes' },
    { id: 'asientos', que: 'Asientos', cuantos: asientos.length, importe: suma(asientos), sale: false, estado: 'Todavía no sale por aquí',
      texto: asientos.length ? 'Nóminas, bancos, traspasos; aún no van' : 'Ninguno este mes' },
    { id: 'pdf', que: 'Los PDF', cuantos: pdfs.length, importe: null, sale: true, estado: pdfs.length ? 'Listo' : 'Nada',
      texto: pdfs.length ? 'Con el nombre de su factura, para que ERP10 los pegue solo' : 'Ninguno' },
  ]

  // Se afirman de lo que sale: cada fila lleva su registro de IVA (la clase «recibida» es tenerlo),
  // ninguna repetida (la base las aparta) y todas cuadran (el módulo no deja salir ninguna que no).
  const comprobaciones = recibidas.length ? ['Cada factura lleva su registro de IVA', 'Ninguna repetida', 'Todas cuadran'] : []

  return {
    filas,
    listas: {
      cuentas, recibidas, emitidas, asientos,
      pdf: prep.filas.filter((f) => f.pdf).map((f) => ({ nombre: f.pdf!, ruta: porId.get(f.entryId)!.pdf!.ruta, factura: f.numero })),
    },
    sinPdf, noPuedenSalir, comprobaciones,
    ficheros: { subcuentas, recibidas: prep.filas.map((f) => ({ entryId: f.entryId, fila: f.fila })), pdfs },
    totalRecibidas,
  }
}

/** Lo que se baja y se apunta: los dos libros, con su huella y la de cada fila. */
export async function prepararDescarga(x: Salida): Promise<{
  libros: { nombre: string; bytes: ArrayBuffer; filas: number; huella: string }[]
  partidas: { entry_id: string; clase: 'recibida'; huella: string }[]
}> {
  const huellaBytes = async (b: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((v) => v.toString(16).padStart(2, '0')).join('')
  const libros: { nombre: string; bytes: ArrayBuffer; filas: number; huella: string }[] = []
  for (const [nombre, filas] of [[FICHERO_SUBCUENTAS, x.ficheros.subcuentas], [FICHERO_RECIBIDAS, x.ficheros.recibidas.map((r) => r.fila)]] as const) {
    if (!filas.length) continue
    const bytes = await libroErp10(filas)
    libros.push({ nombre, bytes, filas: filas.length, huella: await huellaBytes(bytes) })
  }
  const partidas = await Promise.all(x.ficheros.recibidas.map(async (r) => ({ entry_id: r.entryId, clase: 'recibida' as const, huella: await huellaFila(r.fila) })))
  return { libros, partidas }
}

/** El tope de cada fichero comprimido de PDF (encargo X04: si un mes pasa de 150 MB, en varios). */
export const TOPE_ZIP = 150 * 1024 * 1024

/** Reparte los PDF en ficheros comprimidos de como mucho `tope` bytes, en orden. Uno que pase del tope, solo. */
export function repartirPdfs<T extends { bytes: Uint8Array }>(pdfs: readonly T[], tope = TOPE_ZIP): T[][] {
  const grupos: T[][] = []
  let actual: T[] = []; let peso = 0
  for (const p of pdfs) {
    if (actual.length && peso + p.bytes.length > tope) { grupos.push(actual); actual = []; peso = 0 }
    actual.push(p); peso += p.bytes.length
  }
  if (actual.length) grupos.push(actual)
  return grupos
}

/** Los ficheros comprimidos: pdf.zip si es uno; pdf-1.zip, pdf-2.zip… si son varios. Los PDF ya van comprimidos: se guardan sin volver a comprimir. */
export function comprimirPdfs(pdfs: readonly { nombre: string; bytes: Uint8Array }[], tope = TOPE_ZIP): { nombre: string; bytes: Uint8Array; pdfs: number }[] {
  const grupos = repartirPdfs(pdfs, tope)
  return grupos.map((g, i) => ({
    nombre: grupos.length === 1 ? 'pdf.zip' : `pdf-${i + 1}.zip`,
    bytes: zipSync(Object.fromEntries(g.map((p) => [p.nombre, [p.bytes, { level: 0 }]]))),
    pdfs: g.length,
  }))
}

/** El mes en palabras: «noviembre de 2026». */
export function mesEnPalabras(aaaamm01: string): string {
  const [a, m] = aaaamm01.split('-').map(Number)
  return `${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][m - 1]} de ${a}`
}

/** Importe con punto de miles y coma decimal, siempre con dos decimales («20.730,65»). */
export function importe(n: number): string {
  const c = Math.round(Math.abs(n) * 100)
  return `${n < 0 ? '−' : ''}${String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${String(c % 100).padStart(2, '0')}`
}

/** Los meses desde el primero que sale hasta el de hoy, del más nuevo al más viejo. */
export function mesesDesde(desde: string, hoy: string): string[] {
  const out: string[] = []
  let [a, m] = desde.slice(0, 7).split('-').map(Number)
  const [ah, mh] = hoy.slice(0, 7).split('-').map(Number)
  if (a * 12 + m > ah * 12 + mh) [a, m] = [ah, mh]
  while (a * 12 + m <= ah * 12 + mh) { out.push(`${a}-${String(m).padStart(2, '0')}-01`); m++; if (m > 12) { m = 1; a++ } }
  return out.reverse()
}
