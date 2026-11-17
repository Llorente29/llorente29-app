// src/modules/conta/lib/traer/leer.ts
//
// N04 · Leer cada fichero de ERP10 (y los dos libros de facturas de la AEAT), con las
// reglas medidas sobre los ficheros reales (erp10_formatos_de_salida.md, 1 a 4 y 7 a 9).
// Los importes, en CÉNTIMOS enteros; las cuentas, como texto y con los números que
// traían; las fechas, AAAA-MM-DD. Cada lector devuelve lo leído y sus avisos, ya en
// palabras de quien lo va a leer (un administrativo): sin «hoja» ni «cabecera».

import { centimos, cifra, cuenta, fecha, fechaDeGente, texto, type Celda, type Hoja } from './excel'
import { clavesDeFila, titulosDobles } from './reconocer'
import { limpiar } from '@/modules/conta/lib/importarPlan'
import { normalizarNif } from '@/modules/conta/lib/nif'

const filasDesde = (h: Hoja, desde: number): Celda[][] => h.filas.slice(desde)
const vacia = (f: readonly Celda[]) => f.every((c) => c === null || texto(c) === '')
const col = (m: Map<string, number>, k: string): number | null => m.get(k) ?? null
const celda = (f: readonly Celda[], i: number | null): Celda => (i === null ? null : f[i] ?? null)

// ── Plan de cuentas ──────────────────────────────────────────────────────────────────

export interface Subcuenta { codigo: string; nombre: string }
export interface PlanLeido { subcuentas: Subcuenta[]; avisos: string[] }

/** Una fila por subcuenta; solo valen la subcuenta y su descripción (los nombres de los niveles no son de fiar). */
export function leerPlan(h: Hoja, fila: number): PlanLeido {
  const t = clavesDeFila(h.filas[fila])
  const cs = col(t, 'subcuenta'), cn = col(t, 'descripcion')
  const subcuentas: Subcuenta[] = []
  for (const f of filasDesde(h, fila + 1)) {
    const codigo = cuenta(celda(f, cs))
    if (!codigo) continue
    subcuentas.push({ codigo, nombre: limpiar(texto(celda(f, cn))) })
  }
  return { subcuentas, avisos: [] }
}

// ── Proveedores y clientes ───────────────────────────────────────────────────────────

export interface Tercero { codigo: string; nombreFiscal: string; nombreComercial: string; nif: string | null; poblacion: string }
export interface TercerosLeidos { terceros: Tercero[]; avisos: string[] }

/** No todos llevan NIF (una cuenta genérica, la …0000, llega sin él); los de otro país, con su prefijo. */
export function leerTerceros(h: Hoja, fila: number): TercerosLeidos {
  const t = clavesDeFila(h.filas[fila])
  const [cc, cf, cm, cn, cp] = ['codigo', 'nombrefiscal', 'nombrecomercial', 'nif', 'poblacion'].map((k) => col(t, k))
  const terceros: Tercero[] = []
  for (const f of filasDesde(h, fila + 1)) {
    const codigo = cuenta(celda(f, cc))
    if (!codigo) continue
    const nif = normalizarNif(texto(celda(f, cn)))
    terceros.push({
      codigo, nombreFiscal: limpiar(texto(celda(f, cf))), nombreComercial: limpiar(texto(celda(f, cm))),
      nif: nif || null, poblacion: limpiar(texto(celda(f, cp))),
    })
  }
  return { terceros, avisos: [] }
}

// ── Inmovilizado ─────────────────────────────────────────────────────────────────────

export interface Elemento {
  codigo: string; subcuenta: string; descripcion: string; compra: string | null; baja: string | null
  precio: number; amortizado: number; valorContable: number; amortizacionFiscal: number
}
export interface InmovilizadoLeido {
  /** «En alta a fecha: dd/mm/aaaa», si lo trae. */
  aFecha: string | null
  elementos: Elemento[]
  /** La fila de totales (sin código): no es un elemento, se guarda para comprobar. */
  totales: { precio: number; amortizado: number; valorContable: number; amortizacionFiscal: number } | null
  avisos: string[]
}

export function leerInmovilizado(h: Hoja, fila: number): InmovilizadoLeido {
  const t = clavesDeFila(h.filas[fila])
  const [cc, cs, cd, cf, cb, cp, ca, cv, cx] = ['codigo', 'subcuenta', 'descripcion', 'fcompra', 'fbaja', 'precio', 'amortizado', 'vcontable', 'amfiscal'].map((k) => col(t, k))
  const elementos: Elemento[] = []
  let totales: InmovilizadoLeido['totales'] = null
  for (const f of filasDesde(h, fila + 1)) {
    if (vacia(f)) continue
    const n = (i: number | null) => centimos(celda(f, i)) ?? 0
    const codigo = texto(celda(f, cc))
    if (!codigo) {
      if (centimos(celda(f, cp)) !== null) totales = { precio: n(cp), amortizado: n(ca), valorContable: n(cv), amortizacionFiscal: n(cx) }
      continue
    }
    elementos.push({
      codigo, subcuenta: cuenta(celda(f, cs)), descripcion: limpiar(texto(celda(f, cd))), compra: fecha(celda(f, cf)), baja: fecha(celda(f, cb)),
      precio: n(cp), amortizado: n(ca), valorContable: n(cv), amortizacionFiscal: n(cx),
    })
  }
  const aFecha = h.filas.slice(0, fila).flat().map((c) => /En alta a fecha:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(texto(c))?.[1]).find(Boolean)
  const avisos: string[] = []
  if (totales) {
    const suma = elementos.reduce((s, e) => s + e.precio, 0)
    if (suma !== totales.precio) avisos.push(`Los elementos suman ${cifra(suma)} de precio y la línea de totales dice ${cifra(totales.precio)}.`)
  }
  return { aFecha: aFecha ? fecha({ t: 's', v: aFecha }) : null, elementos, totales, avisos }
}

// ── Diario ───────────────────────────────────────────────────────────────────────────

export interface Apunte { subcuenta: string; nombre: string; concepto: string; debe: number; haber: number }
export interface Asiento {
  /** «2.18»: la serie y el documento, como los escribe ERP10. */
  clave: string
  serie: string
  documento: string
  fecha: string
  apuntes: Apunte[]
  debe: number
  haber: number
}
export interface DiarioLeido {
  ejercicio: string | null
  asientos: Asiento[]
  apuntes: number
  debe: number
  haber: number
  /** «Serie» llegó como número en alguna fila: «2.1» y «2.10» ya no se distinguen. */
  serieComoNumero: boolean
  avisos: string[]
}

/**
 * «Serie» trae serie y documento juntos, como texto («2.18»: serie 2, documento 18).
 * «Asiento» no sirve para agrupar (viene a «0»): un asiento es serie + documento + fecha.
 * La columna sin título que sigue a «Subcuenta» es su nombre.
 */
export function leerDiario(h: Hoja, fila: number): DiarioLeido {
  const t = clavesDeFila(h.filas[fila])
  const [cs, cf, csub, cc, cd, ch] = ['serie', 'fecha', 'subcuenta', 'concepto', 'debe', 'haber'].map((k) => col(t, k))
  const cnom = csub !== null && !texto((h.filas[fila] ?? [])[csub + 1]) ? csub + 1 : null
  const avisos: string[] = []
  const porClave = new Map<string, Asiento>()
  let serieComoNumero = false
  let apuntes = 0
  const sinFecha: number[] = []
  filasDesde(h, fila + 1).forEach((f, i) => {
    if (vacia(f)) return
    const s = celda(f, cs)
    if (s?.t === 'n') serieComoNumero = true
    const [serie, documento] = texto(s).split('.')
    const dia = fecha(celda(f, cf))
    if (!dia) { sinFecha.push(fila + 2 + i); return }
    const k = `${serie}.${documento ?? ''}|${dia}`
    let a = porClave.get(k)
    if (!a) { a = { clave: `${serie}.${documento ?? ''}`, serie, documento: documento ?? '', fecha: dia, apuntes: [], debe: 0, haber: 0 }; porClave.set(k, a) }
    const ap: Apunte = {
      subcuenta: cuenta(celda(f, csub)), nombre: limpiar(texto(celda(f, cnom))), concepto: limpiar(texto(celda(f, cc))),
      debe: centimos(celda(f, cd)) ?? 0, haber: centimos(celda(f, ch)) ?? 0,
    }
    a.apuntes.push(ap); a.debe += ap.debe; a.haber += ap.haber
    apuntes++
  })
  const asientos = [...porClave.values()]
  if (serieComoNumero) {
    avisos.push('En el diario, la «Serie» ha llegado como número, no como texto: «2.1» y «2.10» ya no se distinguen. Sácalo otra vez de ERP10 y súbelo sin abrirlo ni guardarlo en Excel.')
  }
  if (sinFecha.length) avisos.push(`En el diario hay ${sinFecha.length === 1 ? 'una línea' : `${sinFecha.length} líneas`} sin fecha, que no se han leído.`)
  for (const a of asientos) {
    if (a.debe !== a.haber) {
      avisos.push(`El asiento ${a.clave} del ${fechaDeGente(a.fecha)} no cuadra: ${cifra(a.debe)} al debe y ${cifra(a.haber)} al haber (${cifra(Math.abs(a.debe - a.haber))} de diferencia).`)
    }
  }
  const ejercicio = h.filas.slice(0, fila).flat().map((c) => /Ejercicio\s+(\d{4})/i.exec(texto(c))?.[1]).find(Boolean) ?? null
  return {
    ejercicio, asientos, apuntes, debe: asientos.reduce((s, a) => s + a.debe, 0), haber: asientos.reduce((s, a) => s + a.haber, 0),
    serieComoNumero, avisos,
  }
}

// ── Sumas y saldos ───────────────────────────────────────────────────────────────────

export interface FilaSumas { subcuenta: string; nombre: string; debe: number; haber: number; deudor: number; acreedor: number }
export interface SumasLeidas {
  filas: FilaSumas[]
  /** La fila «TOTALES:»: no es una cuenta, sus cuatro cifras se guardan para comprobar. */
  totales: { debe: number; haber: number; deudor: number; acreedor: number } | null
  avisos: string[]
}

/**
 * Lee un balance de sumas y saldos de ERP10. Suelto: lo usa también la comparación de la
 * salida a ERP10. Los importes llegan con decimales de coma flotante (…,6300000001) y se
 * redondean a céntimos.
 */
export function leerSumasYSaldos(h: Hoja, fila: number): SumasLeidas {
  const t = clavesDeFila(h.filas[fila])
  const [cs, cd, ch, cdu, cac] = ['subcuenta', 'debe', 'haber', 'deudor', 'acreedor'].map((k) => col(t, k))
  const cnom = cs !== null && !texto((h.filas[fila] ?? [])[cs + 1]) ? cs + 1 : null
  const filas: FilaSumas[] = []
  let totales: SumasLeidas['totales'] = null
  for (const f of filasDesde(h, fila + 1)) {
    if (vacia(f)) continue
    const n = (i: number | null) => centimos(celda(f, i)) ?? 0
    if (f.some((c) => /^totales:?$/i.test(texto(c)))) { totales = { debe: n(cd), haber: n(ch), deudor: n(cdu), acreedor: n(cac) }; continue }
    const subcuenta = cuenta(celda(f, cs))
    if (!subcuenta) continue
    filas.push({ subcuenta, nombre: limpiar(texto(celda(f, cnom))), debe: n(cd), haber: n(ch), deudor: n(cdu), acreedor: n(cac) })
  }
  const avisos: string[] = []
  if (totales) {
    const suma = (k: keyof FilaSumas) => filas.reduce((s, x) => s + (x[k] as number), 0)
    const nombres: Record<'debe' | 'haber' | 'deudor' | 'acreedor', string> = { debe: 'Debe', haber: 'Haber', deudor: 'saldo deudor', acreedor: 'saldo acreedor' }
    for (const k of ['debe', 'haber', 'deudor', 'acreedor'] as const) {
      if (suma(k) !== totales[k]) avisos.push(`En el sumas y saldos, las cuentas suman ${cifra(suma(k))} de ${nombres[k]} y la línea «TOTALES:» dice ${cifra(totales[k])}.`)
    }
  } else {
    avisos.push('El sumas y saldos no trae la línea «TOTALES:»: puede que esté cortado.')
  }
  return { filas, totales, avisos }
}

// ── Libros de facturas (formato de la AEAT) ──────────────────────────────────────────

export interface TramoIva { base: number; tipo: number | null; cuota: number }
export interface Factura {
  /** «A-10» (recibidas: la serie-número del que la expide; expedidas: serie y número juntos, «F-1»). */
  numero: string
  expedicion: string
  operacion: string | null
  /** El trimestre que dice el libro («1T») y su ejercicio. */
  periodo: string | null
  ejercicio: string | null
  nif: string | null
  nombre: string
  tipoFactura: string | null
  tramos: TramoIva[]
  base: number
  cuota: number
  /** La suma del «Total Factura» de sus filas (viene repartido por fila). */
  total: number
  retencion: { tipo: number | null; importe: number } | null
}
export interface LibroLeido { facturas: Factura[]; filas: number; avisos: string[] }

const numeroDe = (c: Celda): number | null => (c?.t === 'n' ? c.v : centimos(c) !== null ? (centimos(c) as number) / 100 : null)

/**
 * Una fila por tipo de IVA: las filas de la misma factura (misma identificación, NIF y
 * fecha) se juntan en una. El «Total Factura» viene repartido por fila: el total es la suma.
 */
export function leerLibro(h: Hoja, fila: number, libro: 'recibidas' | 'expedidas'): LibroLeido {
  const t = titulosDobles(h, fila)
  const c = (k: string) => t.get(k) ?? null
  const rec = libro === 'recibidas'
  const cols = {
    ejercicio: c('autoliquidacion|ejercicio'), periodo: c('autoliquidacion|periodo'), tipoFactura: c('tipodefactura|'),
    expedicion: c('fechaexpedicion|'), operacion: c('fechaoperacion|'),
    numero: rec ? c('identificacionfacturadelexpedidor|serienumero') : null,
    serie: rec ? null : c('identificaciondelafactura|serie'), num: rec ? null : c('identificaciondelafactura|numero'),
    nif: rec ? c('nifexpedidor|identificacion') : c('nifdestinatario|identificacion'),
    nombre: rec ? c('nombreexpedidor|') : c('nombredestinatario|'),
    total: c('totalfactura|'), base: c('baseimponible|'), tipo: c('tipodeiva|'),
    cuota: rec ? c('cuotaivasoportado|') : c('cuotaivarepercutida|'),
    retTipo: c('tiporetenciondelirpf|'), retImporte: c('importeretenidodelirpf|'),
  }
  const avisos: string[] = []
  const nombreLibro = rec ? 'el libro de facturas recibidas' : 'el libro de facturas emitidas'
  const faltan = Object.entries({ 'la fecha de expedición': cols.expedicion, 'el número de factura': rec ? cols.numero : cols.num, 'el NIF': cols.nif, 'la base imponible': cols.base, 'la cuota': cols.cuota })
    .filter(([, v]) => v === null).map(([k]) => k)
  if (faltan.length) avisos.push(`En ${nombreLibro} no encuentro ${faltan.join(', ')}.`)
  const facturas = new Map<string, Factura>()
  let filas = 0
  for (const f of filasDesde(h, fila + 2)) {
    if (vacia(f)) continue
    const expedicion = fecha(celda(f, cols.expedicion))
    const numero = rec ? texto(celda(f, cols.numero)) : [texto(celda(f, cols.serie)), texto(celda(f, cols.num))].filter(Boolean).join('-')
    if (!expedicion && !numero) continue
    filas++
    const nif = normalizarNif(texto(celda(f, cols.nif))) || null
    const k = `${numero}|${nif ?? ''}|${expedicion ?? ''}`
    let x = facturas.get(k)
    if (!x) {
      x = {
        numero, expedicion: expedicion ?? '', operacion: fecha(celda(f, cols.operacion)), periodo: texto(celda(f, cols.periodo)) || null,
        ejercicio: texto(celda(f, cols.ejercicio)) || null, nif, nombre: limpiar(texto(celda(f, cols.nombre))),
        tipoFactura: texto(celda(f, cols.tipoFactura)) || null, tramos: [], base: 0, cuota: 0, total: 0, retencion: null,
      }
      facturas.set(k, x)
    }
    const tramo: TramoIva = { base: centimos(celda(f, cols.base)) ?? 0, tipo: numeroDe(celda(f, cols.tipo)), cuota: centimos(celda(f, cols.cuota)) ?? 0 }
    x.tramos.push(tramo); x.base += tramo.base; x.cuota += tramo.cuota
    x.total += centimos(celda(f, cols.total)) ?? 0
    const ret = centimos(celda(f, cols.retImporte))
    if (ret) x.retencion = { tipo: numeroDe(celda(f, cols.retTipo)), importe: (x.retencion?.importe ?? 0) + ret }
  }
  const sinFecha = [...facturas.values()].filter((x) => !x.expedicion).length
  if (sinFecha) avisos.push(`En ${nombreLibro} hay ${sinFecha === 1 ? 'una factura' : `${sinFecha} facturas`} sin fecha de expedición.`)
  return { facturas: [...facturas.values()], filas, avisos }
}
