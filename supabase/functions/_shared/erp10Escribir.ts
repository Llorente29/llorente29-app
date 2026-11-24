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

import { descripcionRecibida, textoDiez } from './diezTexto.ts'
import type { AsientoParaApi, DiaParaApi, EmitidaParaApi, RecibidaParaApi } from './erp10Ficheros.ts'

// X10c: la recibida y la emitida, como las lee la salida a ERP10 (erp10Ficheros.ts), con las cuentas
// de ERP10 y los importes en céntimos. Las arma el servidor desde la base (erp10DesdeLaBase.ts).
export type { AsientoParaApi, DiaParaApi, EmitidaParaApi, RecibidaParaApi }

/** Una cuenta que la salida da por nueva (ERP10 no la tiene): se da de alta si falta. */
export type CuentaNueva = { codigo: string; nombre: string; nif: string | null }

export const SERIE_RECIBIDAS = '2'
/** X10c · Las emitidas: la serie 1 de Diez (C04b R13, medida en la C0009: TipoAsiento 1, TipoFactura 1). */
export const SERIE_EMITIDAS = '1'
/** X10d · Los asientos: la serie 1, la misma que lleva el fichero de asientos del Excel (X07, filasAsiento). */
export const SERIE_ASIENTOS = '1'
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

/**
 * X10c · La factura (FacturaData) de una emitida; o por qué no sale por aquí. La forma de la serie 1
 * medida en Diez (_shared/diezFactura.ts): el cliente con su NIF y su nombre, hasta tres tipos de
 * IVA, y los ingresos en Apuntes, que suman las bases. ERP10 hace el asiento (430 D, 7 H, 477 H).
 */
export function facturaEmitidaErp10(x: EmitidaParaApi, o: { hoy: string }): { factura: Record<string, unknown> } | { porque: string } {
  const numero = x.numero.trim()
  if (!numero) return { porque: 'No tiene número de factura, y por él se busca en ERP10 para no meterla dos veces.' }
  if (!x.nombre.trim()) return { porque: 'Le falta el nombre del cliente.' }
  if (!x.iva.length) return { porque: 'No lleva IVA, y ERP10 la guarda con su registro de IVA.' }
  if (x.iva.length > 3) return { porque: `Lleva ${x.iva.length} tipos de IVA, y por aquí salen hasta tres. Sácala con el Excel.` }
  const ingresos = x.ingresos.filter((g) => g.importe !== 0)
  if (!ingresos.length) return { porque: 'No lleva ninguna cuenta de ingreso.' }
  const bases = x.iva.reduce((t, i) => t + i.base, 0)
  const cuotas = x.iva.reduce((t, i) => t + i.cuota, 0)
  const suma = ingresos.reduce((t, g) => t + g.importe, 0)
  if (suma !== bases) return { porque: `Los ingresos (${e(suma)}) no son la suma de las bases (${e(bases)}): ERP10 lo exige.` }
  if (bases + cuotas !== x.total) return { porque: `No cuadra: bases ${e(bases)} + cuotas ${e(cuotas)} no son el total ${e(x.total)}.` }
  if (x.total <= 0) return { porque: 'El total no es positivo, y por aquí no está medido. Sácala con el Excel.' }
  const descripcion = descripcionRecibida(numero, x.nombre)
  const fecha = aaaammdd(x.fechaAsiento)
  const tipos: Record<string, number> = {}
  ;[...x.iva].sort((a, b) => b.pct - a.pct).forEach((i, n) => {
    tipos[`BaseImponible${n + 1}`] = e(i.base)
    tipos[`PorcentajeIVA${n + 1}`] = i.pct
    tipos[`CuotaIVA${n + 1}`] = e(i.cuota)
  })
  return {
    factura: {
      Ejercicio: x.fechaAsiento.slice(0, 4), Serie: SERIE_EMITIDAS, TipoAsiento: 1, TipoFactura: 1,
      Fecha: fecha, FechaFactura: aaaammdd(x.fechaFactura), FechaIntroduccionFactura: aaaammdd(o.hoy),
      CuentaCliente: x.cliente, ...(x.nif.trim() ? { CifCliente: x.nif.trim() } : {}), NombreCliente: x.nombre.trim(),
      NumeroFactura: numero, Descripcion: descripcion,
      ...tipos,
      TotalFactura: e(x.total), TotalGastosIngresos: e(bases),
      Apuntes: [...ingresos].sort((a, b) => a.cuenta.localeCompare(b.cuenta)).map((g, i) => ({ Linea: i + 1, Cuenta: g.cuenta, Concepto: descripcion, Fecha: fecha, Importe: e(g.importe) })),
    },
  }
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

/**
 * X31 · 2 · Lo que ya está en ERP10 y espera a que una persona diga si es lo mismo (antes de enviar, mirar). Nunca se
 * enlaza ni se manda solo. De una factura, su número y los dos totales (ERP10 no admite dos con el mismo número del mismo
 * tercero: no hay «Es otra»); de un asiento, su día (con «Es otro, mándalo»).
 */
export type DudaErp10 = {
  que: 'factura' | 'asiento'; ejercicio: string; serie: string; documento: number
  /** Cuántos encajan en ERP10 (el primero, el que se enseña). */
  cuantos: number
  numero?: string | null; fecha?: string | null
  /** En céntimos: el de ERP10 y el de Sumied (una factura). */
  totalErp10Cent?: number | null; totalSumiedCent?: number | null
}

export type Envio = {
  id: string; entry_id: string; estado: 'enviando' | 'en_erp10' | 'no_pudo' | 'duda'
  erp10_ejercicio: string | null; erp10_serie: string | null; erp10_documento: number | null
  enlazada: boolean; pdf: 'subido' | 'fallo' | null; motivo: string | null; intentos: number; lote_id: string | null
  /** X10e · Es de un día del TPV; y el número del cobro de un día de un solo asiento. */
  dia?: boolean | null; cobro_serie?: string | null; cobro_documento?: number | null
  /** X10f · Cómo salió: «sola» (la cola), «a_mano» (el botón) o «excel» (no sale por la conexión). */
  como?: 'sola' | 'a_mano' | 'excel' | null
  /** X31 · 2 · Lo que ya estaba en ERP10 (estado «duda») y lo que dijo la persona. */
  duda?: DudaErp10 | null; decision?: 'la_misma' | 'otro' | null
  /**
   * X31 · 2 · Cuándo pidió Sumied el alta en ERP10 (justo antes de escribir). Si un envío cortado a la mitad vuelve y
   * encuentra en ERP10 lo que encaja, es lo suyo y se enlaza; sin esto, lo que encaja lo metió alguien: en duda.
   */
  alta_pedida_en?: string | null
}

/** X31 · 2 · Lo que la búsqueda en ERP10 necesita del envío: si ya pidió el alta antes (es lo suyo) y apuntarlo antes de escribir. */
type DelEnvio = { propia: boolean; antes: () => Promise<void> }
const delEnvio = (v: Envio, p: PuertoEscribir): DelEnvio => ({ propia: !!v.alta_pedida_en, antes: () => p.poner(v.id, { alta_pedida_en: new Date().toISOString() }) })

export interface PuertoEscribir {
  /** conta_erp10_envio_tomar: coge el asiento (una sola sentencia). */
  tomar(entryId: string, clase: 'recibida' | 'emitida' | 'asiento'): Promise<{ tomado: boolean; envio: Envio }>
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
    /** X10d · Los apuntes (asientos) de un mes, y el alta de un asiento. */
    apuntesDelMes?(aaaa_mm: string): Promise<{ Ejercicio?: string; Serie?: string; Documento?: number; TipoAsiento?: number; Fecha?: number; Detalles?: { Cuenta?: string; Debe?: number; Haber?: number }[] }[]>
    altaApunte?(ap: Record<string, unknown>): Promise<Record<string, unknown>>
  }
  /** X10d · Los números de ERP10 que ya son de otro asiento de Sumied (para no enlazar un asiento a su gemelo). */
  usados?(entryId: string): Promise<Set<string>>
  hoy: string
}

export type Resultado = {
  entryId: string; numero: string
  /** X10c; X10d, también asiento; X10e, el día del TPV. */
  clase?: 'recibida' | 'emitida' | 'asiento' | 'dia'
  /** X10e · El cobro del día (en un día de un solo asiento, en la misma fila). */
  cobro?: { serie: string; documento: number; enlazado: boolean }
  /** X10e · Es el cobro (aparte) del día con este entryId: la pantalla lo cuenta con su día, no como un asiento más. */
  cobroDe?: string
  /**
   * en_erp10: ha entrado ahora (o se ha enlazado); ya_estaba: entró antes; en_marcha: otro envío la tiene; no_pudo: con su
   * porqué; X31 · duda: ya hay en ERP10 algo que encaja y espera a una persona (no se ha mandado).
   */
  estado: 'en_erp10' | 'ya_estaba' | 'en_marcha' | 'no_pudo' | 'duda'
  duda?: DudaErp10
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
export function sacarRecibida(x: RecibidaParaApi, cuentasNuevas: readonly CuentaNueva[], pdf: { ruta: string; nombre: string } | null, p: PuertoEscribir): Promise<Resultado> {
  return sacarFactura({ clase: 'recibida', entryId: x.entryId, numero: x.numero, fechaAsiento: x.fechaAsiento, hecha: facturaRecibidaErp10(x, { hoy: p.hoy }), usa: [x.proveedor, ...x.gastos.map((g) => g.cuenta)] }, cuentasNuevas, pdf, p)
}
/** X10c · Saca una emitida a ERP10, con las mismas protecciones. */
export function sacarEmitida(x: EmitidaParaApi, cuentasNuevas: readonly CuentaNueva[], pdf: { ruta: string; nombre: string } | null, p: PuertoEscribir): Promise<Resultado> {
  return sacarFactura({ clase: 'emitida', entryId: x.entryId, numero: x.numero, fechaAsiento: x.fechaAsiento, hecha: facturaEmitidaErp10(x, { hoy: p.hoy }), usa: [x.cliente, ...x.ingresos.map((g) => g.cuenta)] }, cuentasNuevas, pdf, p)
}

type Pedida = {
  clase: 'recibida' | 'emitida'; entryId: string; numero: string; fechaAsiento: string
  hecha: { factura: Record<string, unknown> } | { porque: string }
  /** Las cuentas (de ERP10) que usa la factura. */
  usa: string[]
}

/** Saca una factura (recibida o emitida) a ERP10, sin que pueda salir dos veces. */
async function sacarFactura(x: Pedida, cuentasNuevas: readonly CuentaNueva[], pdf: { ruta: string; nombre: string } | null, p: PuertoEscribir): Promise<Resultado> {
  const base = { entryId: x.entryId, numero: x.numero, clase: x.clase }
  const hecha = x.hecha
  if ('porque' in hecha) return { ...base, estado: 'no_pudo', porque: hecha.porque }

  // 1 · Coger el asiento.
  const t = await p.tomar(x.entryId, x.clase)
  const v = t.envio
  if (!t.tomado) {
    if (v.estado === 'en_erp10') {
      return { ...base, estado: 'ya_estaba', ejercicio: v.erp10_ejercicio ?? undefined, serie: v.erp10_serie ?? undefined, documento: v.erp10_documento ?? undefined, enlazada: v.enlazada, pdf: v.pdf, sinApuntar: !v.lote_id }
    }
    if (v.estado === 'duda') return { ...base, estado: 'duda', porque: v.motivo ?? undefined, ...(v.duda ? { duda: v.duda } : {}) }
    return { ...base, estado: 'en_marcha', porque: 'Otro envío la está metiendo en ERP10 ahora mismo (otra pestaña u otro clic). Espera un momento y vuelve a mirar.' }
  }

  const fd = hecha.factura
  const e = delEnvio(v, p)
  let ejercicio: string, serie: string, documento: number, enlazada: boolean
  try {
    // 2 · Las cuentas que ERP10 no tiene, antes de la factura que las usa.
    await altasDeCuentas(x.usa, cuentasNuevas, p)
    // 3 · ¿Ya está en ERP10? X31 · 2: no se enlaza sola; queda en duda para una persona. Si no, la escribe.
    const r = await facturaEnErp10(fd, x, p, e)
    if ('duda' in r) return await enDuda(v.id, base, r.duda, p)
    ;({ ejercicio, serie, documento, enlazada } = r)
  } catch (err) {
    const porque = mensaje(err)
    await p.poner(v.id, { estado: 'no_pudo', motivo: porque })
    return { ...base, estado: 'no_pudo', porque }
  }
  // En el acto: en ERP10, con su número.
  await p.poner(v.id, { estado: 'en_erp10', erp10_ejercicio: ejercicio, erp10_serie: serie, erp10_documento: documento, enlazada, motivo: null })

  // 4 · El PDF, a la que acaba de entrar o a la que escribió este mismo envío antes de cortarse (es la suya). A una que
  // metió otro en ERP10 nunca se le sube el de Sumied (X31 · 2: esas no se enlazan aquí; las enlaza una persona).
  let estadoPdf: 'subido' | 'fallo' | null = null
  let motivoPdf: string | null = null
  if (pdf && (!enlazada || e.propia)) {
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

/** Las cuentas que ERP10 no tiene, de las que usa lo que va a entrar, antes de escribirlo. */
async function altasDeCuentas(usa: Iterable<string>, cuentasNuevas: readonly CuentaNueva[], p: PuertoEscribir): Promise<void> {
  const u = new Set(usa)
  for (const c of cuentasNuevas.filter((k) => u.has(k.codigo))) {
    if (!(await p.erp10.tieneSubcuenta(c.codigo))) await p.erp10.crearSubcuenta({ Codigo: c.codigo, Descripcion: c.nombre, NIF: c.nif })
  }
}

type EnErp10 = { ejercicio: string; serie: string; documento: number; enlazada: boolean }

/** X31 · 2 · «Ya está en ERP10 (asiento N)»: lo que dice la fila en duda. */
export const textoDuda = (d: Pick<DudaErp10, 'documento' | 'cuantos'>) =>
  `Ya está en ERP10 (asiento ${d.documento})${d.cuantos > 1 ? ` y ${d.cuantos - 1} más que encajan` : ''}.`

/** Deja la fila en duda (no se manda nada) y lo dice. */
async function enDuda(id: string, base: { entryId: string; numero: string; clase: Resultado['clase'] }, duda: DudaErp10, p: PuertoEscribir, extra?: Partial<Envio>): Promise<Resultado> {
  const porque = textoDuda(duda)
  await p.poner(id, { estado: 'duda', duda, motivo: porque, ...(extra ?? {}) })
  return { ...base, estado: 'duda', duda, porque }
}

const nifComparable = (x: unknown) => String(x ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().replace(/^ES/, '')

/**
 * ¿Ya está la factura en ERP10? Por su número y su tercero (su cuenta o su NIF), desde el mes del asiento hasta hoy.
 * X31 · 2: si hay una, no se enlaza sola: vuelve en duda, con los dos totales; si hay más de una, no se toca nada. Si no
 * hay ninguna, la escribe (ERP10 no admite otra con el mismo número del mismo tercero).
 */
async function facturaEnErp10(fd: Record<string, unknown>, x: { clase: 'recibida' | 'emitida'; numero: string; fechaAsiento: string }, p: PuertoEscribir, e: DelEnvio): Promise<EnErp10 | { duda: DudaErp10 }> {
  const meses = mesesDeBusqueda(x.fechaAsiento, p.hoy)
  if (meses.length > MESES_BUSQUEDA) throw new Error(`Es de hace más de ${MESES_BUSQUEDA - 1} meses: no sale sola, mírala a mano en ERP10.`)
  const vistas = new Map<string, Record<string, unknown>>()
  for (const m of meses) {
    for (const f of await p.erp10.facturasDelMes(m)) {
      const mismoTercero = String(f.CuentaCliente ?? '') === String(fd.CuentaCliente)
        || (!!nifComparable(fd.CifCliente) && nifComparable(f.CifCliente) === nifComparable(fd.CifCliente))
      if (numeroComparable(f.NumeroFactura) !== numeroComparable(fd.NumeroFactura) || !mismoTercero || (f.Serie != null && String(f.Serie) !== String(fd.Serie))) continue
      vistas.set(`${f.Ejercicio ?? ''}|${f.Serie ?? ''}|${f.Documento ?? ''}`, f)
    }
  }
  const ya = [...vistas.values()]
  if (ya.length > 1) throw new Error(`Hay ${ya.length} facturas ${x.numero} de este ${x.clase === 'recibida' ? 'proveedor' : 'cliente'} en ERP10: no se toca nada. Míralo en ERP10.`)
  // La que escribió este mismo envío antes de cortarse: es la suya, se enlaza.
  if (ya.length === 1 && e.propia) return { ejercicio: String(ya[0].Ejercicio ?? fd.Ejercicio), serie: String(ya[0].Serie ?? fd.Serie), documento: Number(ya[0].Documento), enlazada: true }
  if (ya.length === 1) {
    return { duda: { que: 'factura', ejercicio: String(ya[0].Ejercicio ?? fd.Ejercicio), serie: String(ya[0].Serie ?? fd.Serie), documento: Number(ya[0].Documento), cuantos: 1,
      numero: x.numero, fecha: ya[0].Fecha != null ? String(ya[0].Fecha) : null, totalErp10Cent: cent(ya[0].TotalFactura), totalSumiedCent: cent(fd.TotalFactura) } }
  }
  await e.antes()
  const creada = await p.erp10.altaFactura(fd)
  return { ejercicio: String(creada.Ejercicio ?? fd.Ejercicio), serie: String(creada.Serie ?? fd.Serie), documento: Number(creada.Documento), enlazada: false }
}

// ── X10d · Los asientos ─────────────────────────────────────────────────────────────

const cent = (x: unknown) => Math.round(Number(x ?? 0) * 100)

/**
 * El asiento de ERP10 (ApunteSimplificado, POST /api/apuntes/add) de un asiento de Sumied; o por
 * qué no sale por aquí. Una línea por apunte (un apunte con debe y haber a la vez, en dos, como el
 * Excel), con las cuentas de ERP10, la serie de asientos del Excel y el concepto en 40 caracteres.
 */
export function asientoErp10(x: AsientoParaApi): { apunte: Record<string, unknown> } | { porque: string } {
  const vivos = x.apuntes.filter((l) => l.debe !== 0 || l.haber !== 0)
  if (vivos.length < 2) return { porque: 'No tiene dos apuntes con importe. Míralo en Sumied.' }
  if (vivos.some((l) => l.debe < 0 || l.haber < 0)) return { porque: 'Lleva un importe en negativo, y ERP10 los quiere en positivo. Métela a mano en ERP10.' }
  const d = vivos.reduce((t, l) => t + l.debe, 0), h = vivos.reduce((t, l) => t + l.haber, 0)
  if (d !== h) return { porque: `No cuadra: ${e(d)} al debe y ${e(h)} al haber.` }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.fecha)) return { porque: 'El asiento no tiene fecha.' }
  const concepto = textoDiez(vivos.find((l) => l.concepto.trim())?.concepto ?? `Asiento ${x.numero}`)
  const lineas = vivos.flatMap((l) => [
    ...(l.debe ? [{ Cuenta: l.cuenta, Debe: e(l.debe), Haber: 0, Descripcion: textoDiez(l.concepto || concepto) }] : []),
    ...(l.haber ? [{ Cuenta: l.cuenta, Debe: 0, Haber: e(l.haber), Descripcion: textoDiez(l.concepto || concepto) }] : []),
  ])
  return {
    apunte: {
      Ejercicio: x.fecha.slice(0, 4), Serie: SERIE_ASIENTOS, Fecha: aaaammdd(x.fecha), Descripcion: concepto,
      Detalles: lineas.map((l, i) => ({ Linea: i + 1, ...l })),
    },
  }
}

/**
 * X10d · Saca un asiento a ERP10, sin que pueda salir dos veces: lo coge, da de alta las cuentas que
 * falten, busca en ERP10 uno general del mismo día con las mismas líneas (sin los que ya son de otro
 * asiento de Sumied: los gemelos) y lo enlaza, o lo escribe; su número se apunta en el acto.
 */
export async function sacarAsiento(x: AsientoParaApi, cuentasNuevas: readonly CuentaNueva[], p: PuertoEscribir, extra?: Partial<Envio>): Promise<Resultado> {
  const base = { entryId: x.entryId, numero: x.numero, clase: 'asiento' as const }
  const hecho = asientoErp10(x)
  if ('porque' in hecho) return { ...base, estado: 'no_pudo', porque: hecho.porque }
  if (!p.erp10.apuntesDelMes || !p.erp10.altaApunte) return { ...base, estado: 'no_pudo', porque: 'Esta conexión no sabe escribir asientos.' }
  const t = await p.tomar(x.entryId, 'asiento')
  const v = t.envio
  if (!t.tomado) {
    if (v.estado === 'en_erp10') return { ...base, estado: 'ya_estaba', ejercicio: v.erp10_ejercicio ?? undefined, serie: v.erp10_serie ?? undefined, documento: v.erp10_documento ?? undefined, enlazada: v.enlazada, pdf: null, sinApuntar: !v.lote_id }
    if (v.estado === 'duda') return { ...base, estado: 'duda', porque: v.motivo ?? undefined, ...(v.duda ? { duda: v.duda } : {}) }
    return { ...base, estado: 'en_marcha', porque: 'Otro envío lo está metiendo en ERP10 ahora mismo (otra pestaña u otro clic). Espera un momento y vuelve a mirar.' }
  }
  const ap = hecho.apunte
  const detalles = ap.Detalles as { Cuenta: string; Debe: number; Haber: number }[]
  let ejercicio: string, serie: string, documento: number, enlazada: boolean
  try {
    await altasDeCuentas(detalles.map((l) => l.Cuenta), cuentasNuevas, p)
    // X31 · 2: si ya hay uno que encaja, en duda; si la persona dijo «Es otro», se manda sin mirar.
    const r = await apunteEnErp10(ap, x.entryId, p, v.decision === 'otro', delEnvio(v, p))
    if ('duda' in r) return await enDuda(v.id, base, r.duda, p, extra)
    ;({ ejercicio, serie, documento, enlazada } = r)
  } catch (err) {
    const porque = mensaje(err)
    await p.poner(v.id, { estado: 'no_pudo', motivo: porque, ...(extra ?? {}) })
    return { ...base, estado: 'no_pudo', porque }
  }
  await p.poner(v.id, { estado: 'en_erp10', erp10_ejercicio: ejercicio, erp10_serie: serie, erp10_documento: documento, enlazada, motivo: null, ...(extra ?? {}) })
  return { ...base, estado: 'en_erp10', ejercicio, serie, documento, enlazada, pdf: null, sinApuntar: true }
}

/** X31 · 2 · La línea que más mueve de un asiento (su cuenta y su importe, con su lado): con ella se busca en ERP10. */
export function lineaPrincipal(xs: readonly { Cuenta?: string; Debe?: number; Haber?: number }[]): { cuenta: string; debe: number; haber: number } | null {
  const ls = xs.map((l) => ({ cuenta: String(l.Cuenta ?? '').trim(), debe: cent(l.Debe), haber: cent(l.Haber) })).filter((l) => l.cuenta && (l.debe || l.haber))
  if (!ls.length) return null
  return ls.reduce((a, b) => (Math.max(b.debe, b.haber) > Math.max(a.debe, a.haber) ? b : a))
}

/**
 * ¿Ya está el asiento en ERP10? X31 · 2: uno general del mismo día con la misma cuenta y el mismo importe en su línea
 * principal, sin los números que ya son de otro asiento de Sumied (los gemelos): no se enlaza solo, vuelve en duda («Es el
 * mismo, no lo mandes» o «Es otro, mándalo»). Con `esOtro` (la persona dijo «Es otro»), se escribe sin mirar.
 */
async function apunteEnErp10(ap: Record<string, unknown>, entryId: string, p: PuertoEscribir, esOtro: boolean, e: DelEnvio): Promise<EnErp10 | { duda: DudaErp10 }> {
  if (!p.erp10.apuntesDelMes || !p.erp10.altaApunte) throw new Error('Esta conexión no sabe escribir asientos.')
  const detalles = ap.Detalles as { Cuenta: string; Debe: number; Haber: number }[]
  const fecha = String(ap.Fecha)
  if (!esOtro) {
    const usados = p.usados ? await p.usados(entryId) : new Set<string>()
    const principal = lineaPrincipal(detalles)
    const vistos = new Map<string, { Ejercicio?: string; Serie?: string; Documento?: number }>()
    for (const d of await p.erp10.apuntesDelMes(`${fecha.slice(0, 4)}-${fecha.slice(4, 6)}`)) {
      if (Number(d.TipoAsiento ?? 0) !== 0 || Number(d.Fecha) !== Number(ap.Fecha) || !principal) continue
      const encaja = (d.Detalles ?? []).some((l) => String(l.Cuenta ?? '').trim() === principal.cuenta && cent(l.Debe) === principal.debe && cent(l.Haber) === principal.haber)
      if (!encaja) continue
      const k = `${d.Serie ?? ''}/${d.Documento ?? ''}`
      if (!usados.has(k)) vistos.set(`${d.Ejercicio ?? ''}|${k}`, d)
    }
    const ya = [...vistos.values()]
    // El que escribió este mismo envío antes de cortarse: es el suyo, se enlaza.
    if (ya.length === 1 && e.propia) return { ejercicio: String(ya[0].Ejercicio ?? ap.Ejercicio), serie: String(ya[0].Serie ?? ap.Serie), documento: Number(ya[0].Documento), enlazada: true }
    if (ya.length) {
      return { duda: { que: 'asiento', ejercicio: String(ya[0].Ejercicio ?? ap.Ejercicio), serie: String(ya[0].Serie ?? ap.Serie), documento: Number(ya[0].Documento), cuantos: ya.length,
        fecha: `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}` } }
    }
  }
  await e.antes()
  const creado = await p.erp10.altaApunte(ap)
  return { ejercicio: String(creado.Ejercicio ?? ap.Ejercicio), serie: String(creado.Serie ?? ap.Serie), documento: Number(creado.Documento), enlazada: false }
}

// ── X10e · Los días del TPV ─────────────────────────────────────────────────────────

/**
 * La factura del día para ERP10: la emitida (POST /api/facturas/add) con «Clientes de contado» y, además, el resumen
 * de facturas del día: NumeroFacturasIncluidas340, PrimerNumeroFactura340 y UltimoNumeroFactura340 (las columnas 069,
 * 070 y 071 del Excel). O por qué no sale por aquí.
 */
export function facturaDiaErp10(x: DiaParaApi, o: { hoy: string }): { factura: Record<string, unknown> } | { porque: string } {
  if (!x.facturas || !x.primero.trim() || !x.ultimo.trim()) return { porque: 'Le falta el rango de facturas del día.' }
  const h = facturaEmitidaErp10(x, o)
  if ('porque' in h) return h
  return { factura: { ...h.factura, NumeroFacturasIncluidas340: x.facturas, PrimerNumeroFactura340: x.primero.trim(), UltimoNumeroFactura340: x.ultimo.trim() } }
}

/**
 * X10e · Saca un día del TPV a ERP10: su factura del día y su cobro, con las mismas protecciones.
 *   · Un día de UN solo asiento (los de antes del R07): un solo envío para los dos. Se coge el asiento, se busca o se
 *     escribe la factura, después el cobro, y solo entonces queda «en ERP10» con los dos números (el del cobro, en
 *     cobro_serie y cobro_documento). Otro clic a la vez lo ve «en marcha»; si se corta a la mitad, al volver la
 *     búsqueda enlaza lo que ya entró, sin escribirlo otra vez.
 *   · Un día de DOS asientos (R07): la factura con su envío y, solo si ha entrado, el cobro con el suyo (sacarAsiento).
 * Los dos envíos, con la marca del día: «el primer día de cada sociedad sale solo» va aparte de emitidas y asientos.
 */
export async function sacarDia(x: DiaParaApi, cobro: { api: AsientoParaApi; aparte: boolean }, cuentasNuevas: readonly CuentaNueva[], p: PuertoEscribir): Promise<Resultado[]> {
  const base = { entryId: x.entryId, numero: x.numero, clase: 'dia' as const }
  const hf = facturaDiaErp10(x, { hoy: p.hoy })
  if ('porque' in hf) return [{ ...base, estado: 'no_pudo', porque: hf.porque }]
  const hc = asientoErp10(cobro.api)
  if ('porque' in hc) return [{ ...base, estado: 'no_pudo', porque: `Su cobro: ${hc.porque}` }]
  if (!p.erp10.apuntesDelMes || !p.erp10.altaApunte) return [{ ...base, estado: 'no_pudo', porque: 'Esta conexión no sabe escribir asientos, y el cobro del día es uno.' }]
  const conCobro = (r: Resultado) => (cobro.aparte && (r.estado === 'en_erp10' || r.estado === 'ya_estaba')
    ? sacarAsiento(cobro.api, cuentasNuevas, p, { dia: true }).then((c) => [r, { ...c, cobroDe: x.entryId, ...(c.porque && c.estado !== 'en_erp10' ? { porque: `Su cobro: ${c.porque}` } : {}) }])
    : Promise.resolve([r]))

  const t = await p.tomar(x.entryId, 'emitida')
  const v = t.envio
  if (!t.tomado) {
    if (v.estado === 'en_erp10') {
      return conCobro({ ...base, estado: 'ya_estaba', ejercicio: v.erp10_ejercicio ?? undefined, serie: v.erp10_serie ?? undefined, documento: v.erp10_documento ?? undefined, enlazada: v.enlazada, pdf: null, sinApuntar: !v.lote_id,
        ...(v.cobro_documento ? { cobro: { serie: v.cobro_serie ?? '', documento: v.cobro_documento, enlazado: false } } : {}) })
    }
    if (v.estado === 'duda') return [{ ...base, estado: 'duda', porque: v.motivo ?? undefined, ...(v.duda ? { duda: v.duda } : {}) }]
    return [{ ...base, estado: 'en_marcha', porque: 'Otro envío lo está metiendo en ERP10 ahora mismo (otra pestaña u otro clic). Espera un momento y vuelve a mirar.' }]
  }
  const detallesCobro = hc.apunte.Detalles as { Cuenta: string }[]
  let f: EnErp10, c: EnErp10 | null = null
  try {
    await altasDeCuentas([x.cliente, ...x.ingresos.map((g) => g.cuenta), ...(cobro.aparte ? [] : detallesCobro.map((l) => l.Cuenta))], cuentasNuevas, p)
    const rf = await facturaEnErp10(hf.factura, { clase: 'emitida', numero: x.numero, fechaAsiento: x.fechaAsiento }, p, delEnvio(v, p))
    if ('duda' in rf) return [await enDuda(v.id, base, rf.duda, p, { dia: true })]
    f = rf
    if (!cobro.aparte) {
      const rc = await apunteEnErp10(hc.apunte, x.entryId, p, v.decision === 'otro', delEnvio(v, p))
      if ('duda' in rc) return [await enDuda(v.id, base, rc.duda, p, { dia: true })]
      c = rc
    }
  } catch (err) {
    const porque = mensaje(err)
    await p.poner(v.id, { estado: 'no_pudo', motivo: porque, dia: true })
    return [{ ...base, estado: 'no_pudo', porque }]
  }
  await p.poner(v.id, { estado: 'en_erp10', erp10_ejercicio: f.ejercicio, erp10_serie: f.serie, erp10_documento: f.documento, enlazada: f.enlazada, motivo: null, dia: true,
    ...(c ? { cobro_serie: c.serie, cobro_documento: c.documento } : {}) })
  return conCobro({ ...base, estado: 'en_erp10', ejercicio: f.ejercicio, serie: f.serie, documento: f.documento, enlazada: f.enlazada, pdf: null, sinApuntar: true,
    ...(c ? { cobro: { serie: c.serie, documento: c.documento, enlazado: c.enlazada } } : {}) })
}

// ── X10e · Uno de lo que sale, sea lo que sea, y su partida del lote ────────────────

/** Lo que sale, tal como lo arma erp10DesdeLaBase (sin importar el tipo, para no cruzar las dos piezas). */
export type UnoQueSale =
  | { clase: 'recibida'; entryId: string; api: RecibidaParaApi; huella: string; pdf: { ruta: string; nombre: string } | null }
  | { clase: 'emitida'; entryId: string; api: EmitidaParaApi; huella: string; pdf: { ruta: string; nombre: string } | null }
  | { clase: 'asiento'; entryId: string; api: AsientoParaApi; huella: string; pdf: null }
  | { clase: 'dia'; entryId: string; api: DiaParaApi; huella: string; pdf: null; cobro: { entryId: string; api: AsientoParaApi; aparte: boolean; huella: string } }

/** Saca uno a ERP10 (el servidor y el simulado de las pruebas, la misma pieza). Un día puede dar dos resultados: su factura y su cobro. */
export async function sacarUno(x: UnoQueSale, cuentasNuevas: readonly CuentaNueva[], p: PuertoEscribir): Promise<Resultado[]> {
  if (x.clase === 'recibida') return [await sacarRecibida(x.api, cuentasNuevas, x.pdf, p)]
  if (x.clase === 'emitida') return [await sacarEmitida(x.api, cuentasNuevas, x.pdf, p)]
  if (x.clase === 'asiento') return [await sacarAsiento(x.api, cuentasNuevas, p)]
  return sacarDia(x.api, x.cobro, cuentasNuevas, p)
}

/**
 * Cómo se apunta cada resultado en la salida de Sumied: la misma partida que deja el Excel. La factura del día va
 * como «emitida» con la huella de su fila (y la del cobro, si va en el mismo asiento); el cobro aparte, como «asiento».
 */
export function partidasDeLoQueSale(salen: readonly UnoQueSale[]): Map<string, { clase: 'recibida' | 'emitida' | 'asiento'; huella: string }> {
  const m = new Map<string, { clase: 'recibida' | 'emitida' | 'asiento'; huella: string }>()
  for (const x of salen) {
    if (x.clase !== 'dia') { m.set(x.entryId, { clase: x.clase, huella: x.huella }); continue }
    m.set(x.entryId, { clase: 'emitida', huella: x.huella })
    if (x.cobro.aparte) m.set(x.cobro.entryId, { clase: 'asiento', huella: x.cobro.huella })
  }
  return m
}
