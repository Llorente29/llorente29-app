// src/modules/conta/nucleo/listado/arbol.ts
//
// Q06 · El listado del núcleo, como dato (maquetas nucleo_7 y nucleo_8,
// aprobadas por Julio el 17/11; ERP10, «Listado: Libro mayor de cuenta»). Una
// sola ventana para todos los listados, y aquí, sin React, lo que se decide:
//
//   · Las filas de cada listado como un árbol que se abre hacia abajo: grupo ›
//     subgrupo › subcuenta › movimientos en sumas y saldos; cuenta › saldo
//     inicial y movimientos en el mayor; mes › cuenta › movimientos en el
//     diario; mes › factura en el libro de IVA.
//   · LAS CIFRAS SON LAS DE HOY (regla 31): cada árbol se construye con lo que
//     ya calculan los listados de hoy (sumasYSaldos, extracto, resumir,
//     cifrasLibro). Aquí solo se ordena y se reparte en columnas; no se vuelve
//     a sumar nada que no sea la suma de lo ya calculado.
//   · Lo que Sumied ha mirado («Mira esto.»): reglas sobre lo listado, con su
//     frase. Ninguna esconde nada (regla 7): marcan la fila, no la quitan.
//   · Qué filas se ven con lo abierto, y «Abrir: todo · a 3 cifras · a 1 cifra».
//   · La hoja impresa: las líneas y las páginas, una sola paginación para la
//     pantalla, el PDF y la impresora (maqueta 8: «Suma y sigue», «Página 1 de 6»).
//
// Lo prueba tests/unit/modules/conta/q06/listado.test.ts.

import { extracto, type ApunteMayor, type MesResumido } from '@/modules/conta/lib/extractos'
import type { FilaSumas } from '@/modules/conta/lib/sumasSaldos'
import { cuadreConDiario, faltaParaCompletar, type AnotacionLibro } from '@/modules/conta/lib/libroRegistro'

export type QueListado = 'sumas' | 'mayor' | 'diario' | 'emitidas' | 'recibidas'

export type Celda = string | number | null

export interface Columna { titulo: string; cifra: boolean }

export type ClaseFila = 'grupo' | 'cuenta' | 'inicial' | 'movimiento' | 'mes' | 'factura'

export interface Fila {
  id: string
  padre: string | null
  /** La hondura: 0 arriba del todo. */
  nivel: number
  clase: ClaseFila
  celdas: Celda[]
  /** Las primeras celdas van juntas («4 · Acreedores y deudores»): cuántas (2; en el libro de IVA, las 4 de texto). */
  junta?: number
  hijos: string[]
  /** La subcuenta de la fila (F5 abre su mayor). */
  cuenta?: string
  /** El asiento del movimiento o de la factura (Intro lo abre). */
  entryId?: string
  /** Sus movimientos aún no se han leído: se leen al abrirla. */
  porLeer?: boolean
  /** «Mira esto.»: lo que Sumied ha visto en esta fila. */
  mirar?: string
}

export interface Arbol {
  raiz: string[]
  filas: Map<string, Fila>
  columnas: Columna[]
  /** Los totales, en las columnas de cifras (null en las de texto). */
  total: Celda[]
  /** Cuántas cuentas (subcuentas) o facturas lista: «Cuadra. 212 cuentas». */
  cuantas: number
  /** Debe = Haber (o el libro cuadra con el diario). null: no se mira (el mayor de unas cuentas no tiene por qué cuadrar). */
  cuadra: boolean | null
  /** Lo mirado que no es de una fila (Debe ≠ Haber, el cuadre del libro con el diario). */
  avisos: string[]
}

const c = (n: number) => Math.round(n * 100)
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const ddmmaaaa = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const nombreMes = (m: string): string => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`

/** Un saldo en sus columnas deudor/acreedor: positivo al deudor, negativo al acreedor (en positivo), cero al deudor. */
export function deudorAcreedor(saldo: number): [number | null, number | null] {
  const s = c(saldo)
  if (s > 0) return [s / 100, null]
  if (s < 0) return [null, -s / 100]
  return [0, null]
}

export const COLUMNAS: Record<QueListado, Columna[]> = {
  sumas: [
    { titulo: 'Cuenta', cifra: false }, { titulo: 'Nombre', cifra: false }, { titulo: 'Debe', cifra: true }, { titulo: 'Haber', cifra: true },
    { titulo: 'Saldo deudor', cifra: true }, { titulo: 'Saldo acreedor', cifra: true },
  ],
  mayor: [
    { titulo: 'Cuenta', cifra: false }, { titulo: 'Asiento', cifra: false }, { titulo: 'Nombre', cifra: false }, { titulo: 'Debe', cifra: true },
    { titulo: 'Haber', cifra: true }, { titulo: 'Saldo deudor', cifra: true }, { titulo: 'Saldo acreedor', cifra: true },
  ],
  diario: [{ titulo: 'Cuenta', cifra: false }, { titulo: 'Nombre', cifra: false }, { titulo: 'Debe', cifra: true }, { titulo: 'Haber', cifra: true }],
  emitidas: [
    { titulo: 'Fecha', cifra: false }, { titulo: 'Número', cifra: false }, { titulo: 'NIF', cifra: false }, { titulo: 'Nombre', cifra: false },
    { titulo: 'Base', cifra: true }, { titulo: '%', cifra: true }, { titulo: 'Cuota', cifra: true }, { titulo: 'Total', cifra: true },
  ],
  recibidas: [],
}
COLUMNAS.recibidas = COLUMNAS.emitidas

// ── Lo que Sumied ha mirado ───────────────────────────────────────────────

/** Lo que dice una subcuenta por el signo de su saldo, si no es el suyo. Null: nada que mirar. */
export function mirarSaldo(cuenta: string, saldo: number): string | null {
  const s = c(saldo)
  if (cuenta.startsWith('43') && s < 0) return 'Un cliente con saldo a su favor: suele ser un cobro apuntado dos veces.'
  if ((cuenta.startsWith('40') || cuenta.startsWith('41')) && s > 0) return 'Un proveedor con saldo a tu favor: suele ser un pago apuntado dos veces.'
  if (cuenta.startsWith('570') && s < 0) return 'La caja en negativo: falta apuntar una entrada o sobra una salida.'
  return null
}

const descuadre = (debe: number, haber: number) => `Debe y haber no cuadran: ${Math.abs(debe - haber).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} de diferencia.`

// ── Sumas y saldos ────────────────────────────────────────────────────────

/**
 * Sumas y saldos: grupo › subgrupo › subcuenta, con lo que da `sumasYSaldos`
 * (niveles grupo, subgrupo y subcuenta). El saldo deudor y el acreedor de un
 * grupo son la suma de los de sus subcuentas, cada uno por su lado (ERP10 y la
 * maqueta: «4» lleva 3.408,82 deudor y 5.766,54 acreedor).
 */
export function arbolSumas(filas: readonly FilaSumas[], nombres: ReadonlyMap<string, string>, conRango = false): Arbol {
  const porId = new Map(filas.map((f) => [`${f.nivel}:${f.code}`, f]))
  const out = new Map<string, Fila>()
  const idDe = (f: FilaSumas) => (f.nivel === 'subcuenta' ? `c:${f.code}` : f.nivel === 'grupo' ? `g:${f.code}` : `s:${f.code}`)
  const hojasDe = (f: FilaSumas): FilaSumas[] => (f.nivel === 'subcuenta' ? [f] : f.hijos.map((h) => porId.get(h)).filter((x): x is FilaSumas => !!x).flatMap(hojasDe))
  const construir = (f: FilaSumas, padre: string | null, nivel: number): string => {
    const id = idDe(f)
    if (f.nivel === 'subcuenta') {
      const [d, a] = deudorAcreedor(f.saldo)
      out.set(id, { id, padre, nivel, clase: 'cuenta', celdas: [f.code, f.name, f.debe, f.haber, d, a], hijos: [], cuenta: f.code, porLeer: true, mirar: mirarSaldo(f.code, f.saldo) ?? undefined })
      return id
    }
    const hojas = hojasDe(f)
    const d = hojas.reduce((x, h) => x + c(deudorAcreedor(h.saldo)[0] ?? 0), 0) / 100
    const a = hojas.reduce((x, h) => x + c(deudorAcreedor(h.saldo)[1] ?? 0), 0) / 100
    const nombre = nombres.get(f.code)
    const fila: Fila = { id, padre, nivel, clase: 'grupo', celdas: [nombre ? `${f.code} · ${nombre}` : f.code, '', f.debe, f.haber, d || null, a || null], junta: 2, hijos: [] }
    out.set(id, fila)
    fila.hijos = f.hijos.map((h) => porId.get(h)).filter((x): x is FilaSumas => !!x).map((h) => construir(h, id, nivel + 1))
    return id
  }
  const arriba = filas.filter((f) => f.nivel === 'grupo')
  const raiz = arriba.map((f) => construir(f, null, 0))
  const hojas = filas.filter((f) => f.nivel === 'subcuenta')
  const t = (k: 'debe' | 'haber') => hojas.reduce((x, h) => x + c(h[k]), 0) / 100
  const td = hojas.reduce((x, h) => x + c(deudorAcreedor(h.saldo)[0] ?? 0), 0) / 100
  const ta = hojas.reduce((x, h) => x + c(deudorAcreedor(h.saldo)[1] ?? 0), 0) / 100
  const cuadra = c(t('debe')) === c(t('haber'))
  return {
    raiz, filas: out, columnas: COLUMNAS.sumas, total: [null, null, t('debe'), t('haber'), td, ta], cuantas: hojas.length, cuadra,
    // Con un rango de cuentas, Debe y Haber no tienen por qué cuadrar (lo dice hoy SumasSaldos).
    avisos: cuadra || conRango ? [] : [descuadre(t('debe'), t('haber'))],
  }
}

/** Los movimientos de una subcuenta, para colgarlos de su fila: con su saldo arrastrado (extracto, como el mayor de hoy). */
export function filasDeMovimientos(padre: Fila, apuntes: readonly (ApunteMayor & { concepto: string; serie?: number; numero?: number | null })[], desde: string, hasta: string, que: 'sumas' | 'mayor'): Fila[] {
  const x = extracto([...apuntes], { desde, hasta })
  const fuera: Fila[] = []
  const nivel = padre.nivel + 1
  const cuenta = padre.cuenta
  if (c(x.inicial) !== 0 || que === 'mayor') {
    const [d, a] = deudorAcreedor(x.inicial)
    fuera.push({
      id: `${padre.id}:inicial`, padre: padre.id, nivel, clase: 'inicial', hijos: [], cuenta,
      celdas: que === 'mayor' ? [ddmm(desde), '', 'Saldo inicial', null, null, d, a] : [ddmm(desde), 'Saldo inicial', null, null, d, a],
    })
  }
  x.filas.forEach((m, i) => {
    const [d, a] = deudorAcreedor(m.saldo)
    const asiento = m.numero === null || m.numero === undefined ? '' : `${m.serie ?? ''}/${m.numero}`
    fuera.push({
      id: `${padre.id}:m${i}`, padre: padre.id, nivel, clase: 'movimiento', hijos: [], cuenta, entryId: m.entryId,
      celdas: que === 'mayor' ? [ddmm(m.fecha), asiento, m.concepto, m.debe || null, m.haber || null, d, a] : [ddmm(m.fecha), m.concepto, m.debe || null, m.haber || null, d, a],
    })
  })
  return fuera
}

/** Cuelga unos movimientos de su fila (devuelve un árbol nuevo). */
export function colgar(a: Arbol, idPadre: string, hijas: readonly Fila[]): Arbol {
  const padre = a.filas.get(idPadre)
  if (!padre) return a
  const filas = new Map(a.filas)
  for (const id of padre.hijos) filas.delete(id)
  for (const h of hijas) filas.set(h.id, h)
  filas.set(idPadre, { ...padre, hijos: hijas.map((h) => h.id), porLeer: false })
  return { ...a, filas }
}

// ── El mayor ──────────────────────────────────────────────────────────────

/** ¿Una cuenta está en el rango «de la cuenta … a la …»? (el de sumas y saldos de hoy). */
export function enRango(code: string, desde: string, hasta: string): boolean {
  return (!desde || code >= desde) && (!hasta || code.slice(0, hasta.length) <= hasta)
}

/**
 * El mayor: una fila por cuenta del rango con su extracto colgando (saldo
 * inicial y movimientos con el saldo arrastrado), como el mayor de hoy: los
 * apuntes desde el primer día del ejercicio, el saldo inicial es lo de antes
 * de `desde`. Solo las cuentas con algo: saldo inicial o movimientos.
 */
export function arbolMayor(apuntes: readonly (ApunteMayor & { concepto: string; serie: number; numero: number | null })[], desde: string, hasta: string, rango: { desde: string; hasta: string }): Arbol {
  const porCuenta = new Map<string, typeof apuntes[number][]>()
  for (const m of apuntes) {
    if (!enRango(m.cuenta, rango.desde, rango.hasta)) continue
    const l = porCuenta.get(m.cuenta) ?? []
    l.push(m)
    porCuenta.set(m.cuenta, l)
  }
  const filas = new Map<string, Fila>()
  const raiz: string[] = []
  let td = 0, th = 0
  for (const cuenta of [...porCuenta.keys()].sort()) {
    const ms = porCuenta.get(cuenta)!
    const x = extracto([...ms], { desde, hasta })
    if (c(x.inicial) === 0 && !x.filas.length) continue
    const id = `c:${cuenta}`
    const [d, a] = deudorAcreedor(x.final)
    const fila: Fila = { id, padre: null, nivel: 0, clase: 'cuenta', celdas: [cuenta, '', ms[0].nombreCuenta, x.debe, x.haber, d, a], hijos: [], cuenta, mirar: mirarSaldo(cuenta, x.final) ?? undefined }
    filas.set(id, fila)
    const hijas = filasDeMovimientos(fila, ms, desde, hasta, 'mayor')
    for (const h of hijas) filas.set(h.id, h)
    fila.hijos = hijas.map((h) => h.id)
    raiz.push(id)
    td += c(x.debe); th += c(x.haber)
  }
  return { raiz, filas, columnas: COLUMNAS.mayor, total: [null, null, null, td / 100, th / 100, null, null], cuantas: raiz.length, cuadra: null, avisos: [] }
}

// ── El diario ─────────────────────────────────────────────────────────────

/**
 * El diario (resumido, como hoy): mes › cuenta, con lo que da `resumir`; de
 * cada cuenta cuelgan sus movimientos del mes. El total de cada mes y del
 * diario, el de hoy.
 */
export function arbolDiario(meses: readonly MesResumido[], apuntes: readonly (ApunteMayor & { concepto: string })[]): Arbol {
  const filas = new Map<string, Fila>()
  const raiz: string[] = []
  const porMesYCuenta = new Map<string, (typeof apuntes)[number][]>()
  for (const m of apuntes) {
    const k = `${m.fecha.slice(0, 7)}|${m.cuenta}`
    const l = porMesYCuenta.get(k) ?? []
    l.push(m)
    porMesYCuenta.set(k, l)
  }
  let td = 0, th = 0
  const avisos: string[] = []
  for (const mes of meses) {
    const id = `mes:${mes.mes}`
    const cuadraMes = c(mes.debe) === c(mes.haber)
    const fila: Fila = {
      id, padre: null, nivel: 0, clase: 'mes', junta: 2, hijos: [],
      celdas: [`${nombreMes(mes.mes)} · ${mes.asientos} ${mes.asientos === 1 ? 'asiento' : 'asientos'}`, '', mes.debe, mes.haber],
      mirar: cuadraMes ? undefined : `No cuadra: ${Math.abs(mes.debe - mes.haber).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} de diferencia entre Debe y Haber. Un asiento validado siempre cuadra: avisa, es un fallo.`,
    }
    filas.set(id, fila)
    raiz.push(id)
    for (const f of mes.filas) {
      const idc = `${id}:${f.cuenta}`
      const ms = porMesYCuenta.get(`${mes.mes}|${f.cuenta}`) ?? []
      const cuenta: Fila = { id: idc, padre: id, nivel: 1, clase: 'cuenta', celdas: [f.cuenta, f.nombre, f.debe || null, f.haber || null], hijos: [], cuenta: f.cuenta }
      filas.set(idc, cuenta)
      fila.hijos.push(idc)
      ms.forEach((m, i) => {
        const idm = `${idc}:m${i}`
        filas.set(idm, { id: idm, padre: idc, nivel: 2, clase: 'movimiento', celdas: [ddmm(m.fecha), m.concepto, m.debe || null, m.haber || null], hijos: [], cuenta: f.cuenta, entryId: m.entryId })
        cuenta.hijos.push(idm)
      })
    }
    td += c(mes.debe); th += c(mes.haber)
  }
  const asientos = meses.reduce((x, m) => x + m.asientos, 0)
  return { raiz, filas, columnas: COLUMNAS.diario, total: [null, null, td / 100, th / 100], cuantas: asientos, cuadra: td === th && !avisos.length, avisos }
}

// ── El libro de IVA ───────────────────────────────────────────────────────

/**
 * El libro de IVA: mes › factura, sin las anuladas (como el libro de hoy sin
 * «Ver anuladas»). Los totales son los de `cifrasLibro`; el total de cada
 * factura, el suyo. Lo que falta para completar una anotación y el cuadre con
 * el diario (la 477 o la 472), con las frases de hoy.
 */
export function arbolIva(anotaciones: readonly AnotacionLibro[], libro: 'issued' | 'received', movimientoDiario: number | null): Arbol {
  const vivas = anotaciones.filter((a) => !a.voidedAt).sort((a, b) => a.issueDate.localeCompare(b.issueDate) || (a.number ?? '').localeCompare(b.number ?? '') || a.id.localeCompare(b.id))
  const filas = new Map<string, Fila>()
  const raiz: string[] = []
  for (const a of vivas) {
    const mes = a.issueDate.slice(0, 7)
    const idm = `mes:${mes}`
    let m = filas.get(idm)
    if (!m) {
      m = { id: idm, padre: null, nivel: 0, clase: 'mes', junta: 4, celdas: [nombreMes(mes), '', '', '', 0, null, 0, 0], hijos: [] }
      filas.set(idm, m)
      raiz.push(idm)
    }
    const falta = faltaParaCompletar(a)
    const numero = [a.series, a.number].filter(Boolean).join('-') + (a.numberTo ? `–${a.numberTo}` : '')
    const id = `f:${a.id}`
    filas.set(id, {
      id, padre: idm, nivel: 1, clase: 'factura', hijos: [], entryId: a.entryId,
      celdas: [ddmm(a.issueDate), numero, a.counterpartTaxId ?? '', a.counterpartName ?? '', a.taxBase, a.taxRate, a.taxAmount, a.total],
      mirar: falta.length ? `Le falta para un requerimiento: ${falta.join(', ')}.` : undefined,
    })
    m.hijos.push(id)
    m.celdas[4] = (c(m.celdas[4] as number) + c(a.taxBase)) / 100
    m.celdas[6] = (c(m.celdas[6] as number) + c(a.taxAmount)) / 100
    m.celdas[7] = (c(m.celdas[7] as number) + c(a.total ?? 0)) / 100
  }
  for (const id of raiz) { const m = filas.get(id)!; m.celdas[0] = `${m.celdas[0]} · ${m.hijos.length} ${m.hijos.length === 1 ? 'factura' : 'facturas'}` }
  const base = vivas.reduce((x, a) => x + c(a.taxBase), 0) / 100
  const cuota = vivas.reduce((x, a) => x + c(a.taxAmount), 0) / 100
  const total = vivas.reduce((x, a) => x + c(a.total ?? 0), 0) / 100
  const cuadre = movimientoDiario === null ? null : cuadreConDiario([...anotaciones], libro, movimientoDiario)
  return {
    raiz, filas, columnas: COLUMNAS.emitidas, total: [null, null, null, null, base, null, cuota, total], cuantas: vivas.length,
    cuadra: cuadre ? cuadre.cuadra : true, avisos: cuadre && !cuadre.cuadra ? [cuadre.frase] : [],
  }
}

// ── Lo que se ve ──────────────────────────────────────────────────────────

export interface Visible { fila: Fila; abierta: boolean; conHijos: boolean }

/** Las filas que se ven, en su orden, con lo abierto. */
export function visibles(a: Arbol, abiertas: ReadonlySet<string>): Visible[] {
  const fuera: Visible[] = []
  const ir = (id: string) => {
    const f = a.filas.get(id)
    if (!f) return
    const conHijos = f.hijos.length > 0 || !!f.porLeer
    const abierta = conHijos && abiertas.has(id)
    fuera.push({ fila: f, abierta, conHijos })
    if (abierta) f.hijos.forEach(ir)
  }
  a.raiz.forEach(ir)
  return fuera
}

export type Hasta = 'todo' | 3 | 1

/**
 * «Abrir: todo · a 3 cifras · a 1 cifra». A 1 cifra: todo cerrado (se ven los
 * grupos, los meses, las cuentas del mayor). A 3 cifras: abiertos los grupos y
 * los meses (se ven las subcuentas). Todo: también las cuentas (sus
 * movimientos; los que aún no se han leído se leen).
 */
export function abrirHasta(a: Arbol, hasta: Hasta): Set<string> {
  if (hasta === 1) return new Set()
  const r = new Set<string>()
  for (const f of a.filas.values()) {
    if (f.clase === 'grupo' || f.clase === 'mes') r.add(f.id)
    else if (hasta === 'todo' && f.clase === 'cuenta' && (f.hijos.length || f.porLeer)) r.add(f.id)
  }
  return r
}

/** Las filas marcadas por Sumied, en el orden del listado (para «Qué mirar»). */
export function queMirar(a: Arbol): { id: string; cuenta: string; texto: string }[] {
  const fuera: { id: string; cuenta: string; texto: string }[] = []
  const ir = (id: string) => {
    const f = a.filas.get(id)
    if (!f) return
    if (f.mirar) fuera.push({ id: f.id, cuenta: String(f.celdas[0] ?? ''), texto: f.mirar })
    f.hijos.forEach(ir)
  }
  a.raiz.forEach(ir)
  return fuera
}

/** Los ids de los antepasados de una fila (para abrir el camino hasta ella). */
export function camino(a: Arbol, id: string): string[] {
  const r: string[] = []
  let p = a.filas.get(id)?.padre ?? null
  while (p) { r.unshift(p); p = a.filas.get(p)?.padre ?? null }
  return r
}

// ── La hoja impresa (maqueta 8) ───────────────────────────────────────────

export interface LineaHoja { celdas: Celda[]; clase: 'linea' | 'cabecera' | 'suma' }

export interface Pagina { numero: number; lineas: LineaHoja[]; sigue: number[] | null }

export const TITULO_HOJA: Record<QueListado, string> = {
  sumas: 'Balance de sumas y saldos',
  mayor: 'Libro mayor',
  diario: 'Libro diario resumido',
  emitidas: 'Libro registro de facturas expedidas',
  recibidas: 'Libro registro de facturas recibidas',
}

/** Las columnas que se suman en «Suma y sigue»: Debe y Haber; en el libro de IVA, base, cuota y total. */
export const SUMA_Y_SIGUE: Record<QueListado, number[]> = { sumas: [2, 3], mayor: [3, 4], diario: [2, 3], emitidas: [4, 6, 7], recibidas: [4, 6, 7] }

/** Las columnas de la hoja impresa: las del listado (en el mayor y el diario, igual). */
export const columnasHoja = (que: QueListado): Columna[] => COLUMNAS[que]

/**
 * Las líneas de la hoja, en su orden. Sumas y saldos: las subcuentas (como la
 * maqueta 8). Mayor: cada cuenta como cabecera, su saldo inicial, sus
 * movimientos y su suma. Diario: cada mes como cabecera, sus cuentas y su
 * total. Libro de IVA: las facturas. En «Suma y sigue» solo cuentan las líneas.
 */
export function lineasDeLaHoja(a: Arbol, que: QueListado): LineaHoja[] {
  const fuera: LineaHoja[] = []
  const f = (id: string) => a.filas.get(id)!
  if (que === 'sumas') {
    const ir = (id: string) => { const x = f(id); if (x.clase === 'cuenta') fuera.push({ celdas: x.celdas, clase: 'linea' }); else x.hijos.forEach(ir) }
    a.raiz.forEach(ir)
  } else if (que === 'mayor') {
    for (const id of a.raiz) {
      const x = f(id)
      fuera.push({ celdas: [x.celdas[0], '', x.celdas[2], null, null, null, null], clase: 'cabecera' })
      for (const h of x.hijos) fuera.push({ celdas: f(h).celdas, clase: f(h).clase === 'movimiento' ? 'linea' : 'suma' })
      fuera.push({ celdas: ['', '', 'Suma de la cuenta', x.celdas[3], x.celdas[4], x.celdas[5], x.celdas[6]], clase: 'suma' })
    }
  } else if (que === 'diario') {
    for (const id of a.raiz) {
      const x = f(id)
      fuera.push({ celdas: [x.celdas[0], '', null, null], clase: 'cabecera' })
      for (const h of x.hijos) fuera.push({ celdas: f(h).celdas, clase: 'linea' })
      fuera.push({ celdas: ['', 'Total del mes', x.celdas[2], x.celdas[3]], clase: 'suma' })
    }
  } else {
    for (const id of a.raiz) for (const h of f(id).hijos) fuera.push({ celdas: f(h).celdas, clase: 'linea' })
  }
  return fuera
}

/**
 * Las páginas: `porPagina` líneas en cada una; al pie de cada página menos la
 * última, «Suma y sigue» con lo acumulado de las líneas hasta ahí.
 */
export function paginar(lineas: readonly LineaHoja[], porPagina: number, sumar: readonly number[]): Pagina[] {
  const paginas: Pagina[] = []
  const acumulado = sumar.map(() => 0)
  for (let i = 0; i < Math.max(1, lineas.length); i += porPagina) {
    const trozo = lineas.slice(i, i + porPagina)
    for (const l of trozo) if (l.clase === 'linea') sumar.forEach((col, k) => { const v = l.celdas[col]; if (typeof v === 'number') acumulado[k] += c(v) })
    paginas.push({ numero: paginas.length + 1, lineas: trozo, sigue: acumulado.map((x) => x / 100) })
  }
  paginas[paginas.length - 1].sigue = null
  return paginas
}

/** «Del 01/01/2026 al 31/07/2026 · todas las cuentas» (o «de la 4300 a la 4309»). */
export function subtituloHoja(desde: string, hasta: string, rango: { desde: string; hasta: string }, que: QueListado): string {
  const fechas = `Del ${ddmmaaaa(desde)} al ${ddmmaaaa(hasta)}`
  if (que === 'emitidas' || que === 'recibidas') return fechas
  if (!rango.desde && !rango.hasta) return `${fechas} · todas las cuentas`
  return `${fechas} · ${rango.desde ? `de la ${rango.desde}` : 'desde la primera'} ${rango.hasta ? `a la ${rango.hasta}` : 'a la última'}`
}

// ── Los periodos de arriba ────────────────────────────────────────────────

export interface Periodo { id: string; nombre: string; desde: string; hasta: string }

/** «Este año, hasta hoy», el ejercicio entero y sus trimestres. «Hasta hoy» solo si hoy cae en el ejercicio. */
export function periodosDe(inicio: string, fin: string, hoy: string): Periodo[] {
  const r: Periodo[] = []
  if (hoy >= inicio && hoy <= fin) r.push({ id: 'hoy', nombre: 'Este año, hasta hoy', desde: inicio, hasta: hoy })
  r.push({ id: 'ejercicio', nombre: 'Todo el ejercicio', desde: inicio, hasta: fin })
  for (let t = 0; t < 4; t++) {
    const y = Number(inicio.slice(0, 4))
    const d = `${y}-${String(t * 3 + 1).padStart(2, '0')}-01`
    const finMes = t * 3 + 3
    const h = `${y}-${String(finMes).padStart(2, '0')}-${String(new Date(Date.UTC(y, finMes, 0)).getUTCDate()).padStart(2, '0')}`
    if (h < inicio || d > fin) continue
    r.push({ id: `${t + 1}T`, nombre: `${t + 1}T ${y}`, desde: d < inicio ? inicio : d, hasta: h > fin ? fin : h })
  }
  return r
}
