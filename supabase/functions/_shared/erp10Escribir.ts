// supabase/functions/_shared/erp10Escribir.ts
//
// X10b (19/11) · ERP10 POR LA API, FASE 2: ESCRIBIR LAS RECIBIDAS. Lo que decide, contra un
// puerto (la base y el ERP10 los pone conta-erp10-escribir; las pruebas, uno simulado):
// tests/conta/erp10/escribir.test.ts.
//
// La recibida llega como la lee la salida a ERP10 (ficheros.ts, leerRecibida), con las
// cuentas YA CONVERTIDAS a las de ERP10: las mismas que el Excel, para que el paso 3 case
// cuenta a cuenta. La factura es la de la serie 2 medida en Diez (la misma API,
// _shared/diezRecibida.ts): TipoAsiento 2, TipoFactura 1, el proveedor con su NIF y su
// nombre, hasta tres tipos de IVA y los gastos en Apuntes, que suman las bases.
// Lo que no está medido por aquí no sale por aquí (sale por el Excel, que no cambia):
// retención, inversión del sujeto pasivo, intracomunitaria, más de tres tipos de IVA.
//
// LO QUE ENTRA EN ERP10 NO SE PUEDE BORRAR (no hay DELETE en la API). Por eso, nada sale
// dos veces aunque se pulse dos veces o se corte a la mitad:
//   1. Se coge el asiento (conta_erp10_envio_tomar: una sola sentencia). Si está en ERP10
//      o en marcha, no se toca.
//   2. Se busca en ERP10 la factura por su número y su proveedor, desde el mes del asiento
//      hasta hoy. Una: se enlaza (el corte fue después de escribir, o alguien la metió).
//      Más de una: no se toca nada. Ninguna: se escribe.
//   3. Lo que pasa se apunta en el acto: en ERP10 con su número, o no pudo con su motivo.
//   4. El PDF, después: si no se sube, la factura sigue en ERP10 y se dice.

import { descripcionRecibida } from './diezTexto.ts'

/** La recibida como la lee la salida a ERP10, con las cuentas de ERP10 y los importes en céntimos. */
export type RecibidaParaApi = {
  entryId: string
  numero: string
  /** AAAA-MM-DD */
  fechaFactura: string
  fechaAsiento: string
  nif: string
  nombre: string
  /** La cuenta del proveedor, en ERP10. */
  proveedor: string
  tipoOperacion: string
  gastos: { cuenta: string; importe: number }[]
  iva: { pct: number; base: number; cuota: number }[]
  retencion: unknown | null
  total: number
}

/** Una cuenta que la salida da por nueva (ERP10 no la tiene): se da de alta si falta. */
export type CuentaNueva = { codigo: string; nombre: string; nif: string | null }

export const SERIE_RECIBIDAS = '2'
const MESES_BUSQUEDA = 13
const e = (cent: number) => Math.round(cent) / 100
const aaaammdd = (iso: string) => Number(iso.slice(0, 10).replaceAll('-', ''))
/** El número de factura para comparar: sin espacios, en mayúsculas. */
export const numeroComparable = (x: unknown) => String(x ?? '').replace(/\s+/g, '').toUpperCase()

/** La factura (FacturaData) de una recibida; o por qué no sale por aquí. */
export function facturaRecibidaErp10(x: RecibidaParaApi, o: { hoy: string }): { factura: Record<string, unknown> } | { porque: string } {
  const numero = x.numero.trim()
  if (!numero) return { porque: 'No tiene número de factura, y por él se busca en ERP10 para no meterla dos veces.' }
  if (x.retencion) return { porque: 'Lleva retención, y cómo la guarda ERP10 por aquí no está medido. Sácala con el Excel.' }
  if (x.tipoOperacion !== 'OI') return { porque: 'Es de inversión del sujeto pasivo o intracomunitaria, y por aquí todavía no sale. Sácala con el Excel.' }
  if (!x.nombre.trim()) return { porque: 'Le falta el nombre del proveedor.' }
  if (!x.iva.length) return { porque: 'No lleva IVA, y ERP10 la guarda con su registro de IVA.' }
  if (x.iva.length > 3) return { porque: `Lleva ${x.iva.length} tipos de IVA, y por aquí salen hasta tres. Sácala con el Excel.` }
  const gastos = x.gastos.filter((g) => g.importe !== 0)
  if (!gastos.length) return { porque: 'No lleva ninguna cuenta de gasto.' }
  const bases = x.iva.reduce((t, i) => t + i.base, 0)
  const cuotas = x.iva.reduce((t, i) => t + i.cuota, 0)
  const sumaGastos = gastos.reduce((t, g) => t + g.importe, 0)
  if (sumaGastos !== bases) return { porque: `El gasto (${e(sumaGastos)}) no es la suma de las bases (${e(bases)}): ERP10 lo exige.` }
  if (bases + cuotas !== x.total) return { porque: `No cuadra: bases ${e(bases)} + cuotas ${e(cuotas)} no son el total ${e(x.total)}.` }
  if (x.total <= 0) return { porque: 'Es un abono (total negativo o cero), y por aquí no está medido. Sácalo con el Excel.' }

  const descripcion = descripcionRecibida(numero, x.nombre)
  const fecha = aaaammdd(x.fechaAsiento)
  const tipos: Record<string, number> = {}
  ;[...x.iva].sort((a, b) => b.pct - a.pct).forEach((i, n) => {
    tipos[`BaseImponible${n + 1}`] = e(i.base)
    tipos[`PorcentajeIVA${n + 1}`] = i.pct
    tipos[`CuotaIVA${n + 1}`] = e(i.cuota)
  })
  const factura: Record<string, unknown> = {
    Ejercicio: x.fechaAsiento.slice(0, 4), Serie: SERIE_RECIBIDAS, TipoAsiento: 2, TipoFactura: 1,
    Fecha: fecha, FechaFactura: aaaammdd(x.fechaFactura), FechaIntroduccionFactura: aaaammdd(o.hoy),
    CuentaCliente: x.proveedor, ...(x.nif.trim() ? { CifCliente: x.nif.trim() } : {}), NombreCliente: x.nombre.trim(),
    NumeroFactura: numero, Descripcion: descripcion,
    ...tipos,
    TotalFactura: e(x.total), TotalGastosIngresos: e(bases),
    Apuntes: [...gastos].sort((a, b) => a.cuenta.localeCompare(b.cuenta)).map((g, i) => ({ Linea: i + 1, Cuenta: g.cuenta, Concepto: descripcion, Fecha: fecha, Importe: e(g.importe) })),
  }
  return { factura }
}

/** Los meses (AAAAMM) desde el del asiento hasta hoy. */
export function mesesDeBusqueda(desde: string, hoy: string): string[] {
  const r: string[] = []
  let [a, m] = desde.slice(0, 7).split('-').map(Number)
  const [ah, mh] = hoy.slice(0, 7).split('-').map(Number)
  while ((a < ah || (a === ah && m <= mh)) && r.length < 60) { r.push(`${a}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; a++ } }
  return r
}

// ── El envío, contra un puerto ──────────────────────────────────────────────────────

export type Envio = {
  id: string; entry_id: string; estado: 'enviando' | 'en_erp10' | 'no_pudo'
  erp10_ejercicio: string | null; erp10_serie: string | null; erp10_documento: number | null
  enlazada: boolean; pdf: 'subido' | 'fallo' | null; motivo: string | null; intentos: number; lote_id: string | null
}

export interface PuertoEscribir {
  /** conta_erp10_envio_tomar: coge el asiento (una sola sentencia). */
  tomar(entryId: string): Promise<{ tomado: boolean; envio: Envio }>
  /** Apunta lo que ha pasado en la fila del asiento. */
  poner(id: string, cambios: Partial<Envio>): Promise<void>
  /** El PDF de la factura (lo guardado en Sumied). */
  pdf(ruta: string): Promise<Uint8Array>
  erp10: {
    tieneSubcuenta(codigo: string): Promise<boolean>
    crearSubcuenta(sc: { Codigo: string; Descripcion: string; NIF?: string | null }): Promise<void>
    facturasDelMes(aaaa_mm: string): Promise<Record<string, unknown>[]>
    altaFactura(fd: Record<string, unknown>): Promise<Record<string, unknown>>
    subirDocumento(d: { Ejercicio: string; Serie: string; Documento: number; NombreArchivo: string; Archivo: string }): Promise<{ status: number; motivo: string | null }>
  }
  hoy: string
}

export type Resultado = {
  entryId: string; numero: string
  /** en_erp10: ha entrado ahora (o se ha enlazado); ya_estaba: entró antes; en_marcha: otro envío la tiene; no_pudo: con su porqué. */
  estado: 'en_erp10' | 'ya_estaba' | 'en_marcha' | 'no_pudo'
  ejercicio?: string; serie?: string; documento?: number; enlazada?: boolean
  pdf?: 'subido' | 'fallo' | null
  /** Sin apuntar todavía en la salida de Sumied (hay que apuntarla). */
  sinApuntar?: boolean
  porque?: string
}

const base64 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
const mensaje = (x: unknown) => (x instanceof Error ? x.message : String(x))

/** Saca una recibida a ERP10, sin que pueda salir dos veces. */
export async function sacarRecibida(x: RecibidaParaApi, cuentasNuevas: readonly CuentaNueva[], pdf: { ruta: string; nombre: string } | null, p: PuertoEscribir): Promise<Resultado> {
  const base = { entryId: x.entryId, numero: x.numero }
  const hecha = facturaRecibidaErp10(x, { hoy: p.hoy })
  if ('porque' in hecha) return { ...base, estado: 'no_pudo', porque: hecha.porque }

  // 1 · Coger el asiento.
  const t = await p.tomar(x.entryId)
  const v = t.envio
  if (!t.tomado) {
    if (v.estado === 'en_erp10') {
      return { ...base, estado: 'ya_estaba', ejercicio: v.erp10_ejercicio ?? undefined, serie: v.erp10_serie ?? undefined, documento: v.erp10_documento ?? undefined, enlazada: v.enlazada, pdf: v.pdf, sinApuntar: !v.lote_id }
    }
    return { ...base, estado: 'en_marcha', porque: 'Otro envío la está metiendo en ERP10 ahora mismo (otra pestaña u otro clic). Espera un momento y vuelve a mirar.' }
  }

  const fd = hecha.factura
  let ejercicio = String(fd.Ejercicio), serie = SERIE_RECIBIDAS, documento: number, enlazada = false
  try {
    // 2 · Las cuentas que ERP10 no tiene, antes de la factura que las usa.
    const usa = new Set([String(fd.CuentaCliente), ...x.gastos.map((g) => g.cuenta)])
    for (const c of cuentasNuevas.filter((k) => usa.has(k.codigo))) {
      if (!(await p.erp10.tieneSubcuenta(c.codigo))) await p.erp10.crearSubcuenta({ Codigo: c.codigo, Descripcion: c.nombre, NIF: c.nif })
    }
    // 3 · ¿Ya está en ERP10? Por su número y su proveedor, desde el mes del asiento hasta hoy.
    const meses = mesesDeBusqueda(x.fechaAsiento, p.hoy)
    if (meses.length > MESES_BUSQUEDA) throw new Error(`Es de hace más de ${MESES_BUSQUEDA - 1} meses: no sale sola, mírala a mano en ERP10.`)
    const vistas = new Map<string, Record<string, unknown>>()
    for (const m of meses) {
      for (const f of await p.erp10.facturasDelMes(m)) {
        if (numeroComparable(f.NumeroFactura) !== numeroComparable(fd.NumeroFactura) || String(f.CuentaCliente ?? '') !== String(fd.CuentaCliente)) continue
        vistas.set(`${f.Ejercicio ?? ''}|${f.Serie ?? ''}|${f.Documento ?? ''}`, f)
      }
    }
    const ya = [...vistas.values()]
    if (ya.length > 1) throw new Error(`Hay ${ya.length} facturas ${x.numero} de este proveedor en ERP10: no se toca nada. Míralo en ERP10.`)
    if (ya.length === 1) {
      ejercicio = String(ya[0].Ejercicio ?? ejercicio); serie = String(ya[0].Serie ?? serie); documento = Number(ya[0].Documento); enlazada = true
    } else {
      const creada = await p.erp10.altaFactura(fd)
      ejercicio = String(creada.Ejercicio ?? ejercicio); serie = String(creada.Serie ?? serie); documento = Number(creada.Documento)
    }
  } catch (err) {
    const porque = mensaje(err)
    await p.poner(v.id, { estado: 'no_pudo', motivo: porque })
    return { ...base, estado: 'no_pudo', porque }
  }
  // En el acto: en ERP10, con su número.
  await p.poner(v.id, { estado: 'en_erp10', erp10_ejercicio: ejercicio, erp10_serie: serie, erp10_documento: documento, enlazada, motivo: null })

  // 4 · El PDF (si se enlaza una que ya estaba, también: puede que no lo tenga).
  let estadoPdf: 'subido' | 'fallo' | null = null
  let motivoPdf: string | null = null
  if (pdf) {
    try {
      const bytes = await p.pdf(pdf.ruta)
      const r = await p.erp10.subirDocumento({ Ejercicio: ejercicio, Serie: serie, Documento: documento, NombreArchivo: pdf.nombre, Archivo: base64(bytes) })
      estadoPdf = r.status === 200 ? 'subido' : 'fallo'
      motivoPdf = r.status === 200 ? null : `ERP10 no ha guardado el PDF (${r.status}): ${r.motivo ?? 'sin motivo'}`
    } catch (err) { estadoPdf = 'fallo'; motivoPdf = `No se ha subido el PDF: ${mensaje(err)}` }
    await p.poner(v.id, { pdf: estadoPdf, motivo: motivoPdf })
  }
  return { ...base, estado: 'en_erp10', ejercicio, serie, documento, enlazada, pdf: estadoPdf, sinApuntar: true, ...(motivoPdf ? { porque: motivoPdf } : {}) }
}
