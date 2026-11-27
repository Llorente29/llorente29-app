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

import { extracto, type ApunteMayor, type FiltroMayor, type MesResumido } from '@/modules/conta/lib/extractos'
import type { FilaSumas } from '@/modules/conta/lib/sumasSaldos'
import { cuadreConDiario, faltaParaCompletar, filtrar, type AnotacionLibro, type FiltrosLibro } from '@/modules/conta/lib/libroRegistro'

export type QueListado = 'sumas' | 'mayor' | 'diario' | 'emitidas' | 'recibidas'

export type Celda = string | number | null

/**
 * Q07 · Una columna por lo que ES (su clave), no por su sitio: las opciones de
 * sumas y saldos (el saldo inicial) y «Comparar con» cambian las columnas, y
 * cada fila se escribe por clave (celdasDe). `peso` reparte el ancho en la
 * pantalla y en la hoja; `suma` dice si entra en «Suma y sigue».
 */
export type Clave =
  | 'cuenta' | 'asiento' | 'nombre' | 'inicial' | 'debe' | 'haber' | 'deudor' | 'acreedor' | 'saldo' | 'otro' | 'dif' | 'pct'
  | 'fecha' | 'numero' | 'nif' | 'base' | 'tipo' | 'cuota' | 'total'

export interface Columna { clave: Clave; titulo: string; cifra: boolean; peso: number; suma?: boolean }

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
  /** Con un filtro puesto (libro de IVA): de cuántas («3 de 12 facturas», regla 7). */
  de?: number
  /** Debe = Haber (o el libro cuadra con el diario). null: no se mira (el mayor de unas cuentas no tiene por qué cuadrar). */
  cuadra: boolean | null
  /** Lo mirado que no es de una fila (Debe ≠ Haber, el cuadre del libro con el diario). */
  avisos: string[]
  /** «Comparar con»: lo que se dice del otro periodo («2025: sin movimientos en Sumied»). */
  notaComparar?: string
}

const c = (n: number) => Math.round(n * 100)
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const ddmmaaaa = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const nombreMes = (m: string): string => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
const dosDecimales = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Un saldo en sus columnas deudor/acreedor: positivo al deudor, negativo al acreedor (en positivo), cero al deudor. */
export function deudorAcreedor(saldo: number): [number | null, number | null] {
  const s = c(saldo)
  if (s > 0) return [s / 100, null]
  if (s < 0) return [null, -s / 100]
  return [0, null]
}

// ── Las columnas ──────────────────────────────────────────────────────────

const col = (clave: Clave, titulo: string, cifra: boolean, peso: number, suma = false): Columna => ({ clave, titulo, cifra, peso, ...(suma ? { suma } : {}) })

/** «Comparar con»: el nombre corto de cada lado («2026» y «2025»). */
export interface Comparar { este: string; otro: string }

/** Las columnas de un listado, con el saldo inicial de sumas y saldos (si se pide) y «Comparar con». */
export function columnasDe(que: QueListado, o: { inicial?: boolean; comparar?: Comparar | null } = {}): Columna[] {
  const cmp = o.comparar
  const saldos = (peso: number) => (cmp
    ? [col('saldo', `Saldo ${cmp.este}`, true, peso), col('otro', `Saldo ${cmp.otro}`, true, peso), col('dif', 'Diferencia', true, peso), col('pct', '%', true, 7)]
    : [col('deudor', 'Saldo deudor', true, peso + 0.5), col('acreedor', 'Saldo acreedor', true, peso + 0.5)])
  if (que === 'sumas') {
    return [col('cuenta', 'Cuenta', false, 17), col('nombre', 'Nombre', false, cmp ? 24 : 30), ...(o.inicial ? [col('inicial', 'Saldo inicial', true, 12)] : []),
      col('debe', 'Debe', true, 13, true), col('haber', 'Haber', true, 13, true), ...saldos(cmp ? 11 : 13)]
  }
  if (que === 'mayor') {
    return [col('cuenta', 'Cuenta', false, 13), col('asiento', 'Asiento', false, 8), col('nombre', 'Nombre', false, cmp ? 23 : 31),
      col('debe', 'Debe', true, 12, true), col('haber', 'Haber', true, 12, true), ...saldos(cmp ? 11 : 11.5)]
  }
  if (que === 'diario') return [col('cuenta', 'Cuenta', false, 18), col('nombre', 'Nombre', false, 46), col('debe', 'Debe', true, 18, true), col('haber', 'Haber', true, 18, true)]
  return [col('fecha', 'Fecha', false, 11), col('numero', 'Número', false, 15), col('nif', 'NIF', false, 12), col('nombre', 'Nombre', false, 20),
    col('base', 'Base', true, 11, true), col('tipo', '%', true, 6), col('cuota', 'Cuota', true, 12, true), col('total', 'Total', true, 13, true)]
}

/** Las de siempre, sin opciones (las del Q06). */
export const COLUMNAS: Record<QueListado, Columna[]> = {
  sumas: columnasDe('sumas'), mayor: columnasDe('mayor'), diario: columnasDe('diario'), emitidas: columnasDe('emitidas'), recibidas: columnasDe('recibidas'),
}

/** Las celdas de una fila en el orden de sus columnas, por clave (lo que no se dice, vacío). */
export const celdasDe = (cs: readonly Columna[], r: Partial<Record<Clave, Celda>>): Celda[] => cs.map((x) => r[x.clave] ?? null)

/** El saldo (deudor/acreedor) o, comparando, el saldo con su signo, el del otro periodo, la diferencia y el %. */
function saldosDe(saldo: number, otro: number | null | undefined, cmp: boolean): Partial<Record<Clave, Celda>> {
  if (!cmp) { const [d, a] = deudorAcreedor(saldo); return { deudor: d, acreedor: a } }
  const o = otro ?? 0
  const dif = (c(saldo) - c(o)) / 100
  return { saldo, otro: o, dif, pct: c(o) === 0 ? null : Math.round((dif / Math.abs(o)) * 1000) / 10 }
}

// ── Lo que Sumied ha mirado ───────────────────────────────────────────────

/** Lo que dice una subcuenta por el signo de su saldo, si no es el suyo. Null: nada que mirar. */
export function mirarSaldo(cuenta: string, saldo: number): string | null {
  const s = c(saldo)
  if (cuenta.startsWith('43') && s < 0) return 'Un cliente con saldo a su favor: suele ser un cobro apuntado dos veces.'
  if ((cuenta.startsWith('40') || cuenta.startsWith('41')) && s > 0) return 'Un proveedor con saldo a tu favor: suele ser un pago apuntado dos veces.'
  if (cuenta.startsWith('570') && s < 0) return 'La caja en negativo: falta apuntar una entrada o sobra una salida.'
  return null
}

const descuadre = (debe: number, haber: number) => `Debe y haber no cuadran: ${dosDecimales(Math.abs(debe - haber))} de diferencia.`

// ── Los periodos de «Comparar con» ────────────────────────────────────────

export type ConQue = 'nada' | 'año' | 'periodo'

const masDias = (f: string, n: number) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const finDeMes = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
/** El mismo día un año antes (el 29/02, al 28/02). */
function unAnoAntes(f: string): string {
  const y = Number(f.slice(0, 4)) - 1
  const m = Number(f.slice(5, 7))
  const d = Math.min(Number(f.slice(8, 10)), new Date(Date.UTC(y, m, 0)).getUTCDate())
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * El otro periodo de «Comparar con». El año anterior: las mismas fechas, un año
 * antes. El periodo anterior: si va de primero a último de mes, los mismos
 * meses justo antes (el 3T, el 2T; el año, el anterior); si no, los mismos
 * días justo antes. Con su nombre corto para las columnas.
 */
export function otroPeriodo(desde: string, hasta: string, con: Exclude<ConQue, 'nada'>): { desde: string; hasta: string; este: string; otro: string } {
  const mismoAno = desde.slice(0, 4) === hasta.slice(0, 4)
  if (con === 'año') {
    const d = unAnoAntes(desde)
    const h = hasta.slice(5) === '02-29' || hasta === finDeMes(Number(hasta.slice(0, 4)), Number(hasta.slice(5, 7))) ? finDeMes(Number(hasta.slice(0, 4)) - 1, Number(hasta.slice(5, 7))) : unAnoAntes(hasta)
    return { desde: d, hasta: h, este: mismoAno ? desde.slice(0, 4) : 'este', otro: mismoAno ? d.slice(0, 4) : 'año anterior' }
  }
  const deMeses = desde.slice(8) === '01' && hasta === finDeMes(Number(hasta.slice(0, 4)), Number(hasta.slice(5, 7)))
  if (deMeses) {
    const meses = (Number(hasta.slice(0, 4)) - Number(desde.slice(0, 4))) * 12 + Number(hasta.slice(5, 7)) - Number(desde.slice(5, 7)) + 1
    const ini = new Date(Date.UTC(Number(desde.slice(0, 4)), Number(desde.slice(5, 7)) - 1 - meses, 1))
    const fin = new Date(Date.UTC(Number(desde.slice(0, 4)), Number(desde.slice(5, 7)) - 1, 0))
    const d = ini.toISOString().slice(0, 10)
    const h = fin.toISOString().slice(0, 10)
    return { desde: d, hasta: h, este: 'este', otro: 'anterior' }
  }
  const dias = Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000)
  const h = masDias(desde, -1)
  return { desde: masDias(h, -dias), hasta: h, este: 'este', otro: 'anterior' }
}

/** «2025: sin movimientos en Sumied»: lo que se dice si el otro periodo no tiene nada (sus cifras salen a cero, nunca vacías). */
export const sinMovimientos = (otro: string, d: string, h: string): string => `${/^\d{4}$/.test(otro) ? otro : `Del ${ddmmaaaa(d)} al ${ddmmaaaa(h)}`}: sin movimientos en Sumied.`

// ── Sumas y saldos ────────────────────────────────────────────────────────

export interface OpcionesArbolSumas {
  /** Con un rango de cuentas, Debe y Haber no tienen por qué cuadrar. */
  conRango?: boolean
  /** La columna del saldo inicial (solo el periodo, con saldo inicial: como hoy). */
  inicial?: boolean
  /** «Comparar con»: los nombres y el saldo de cada fila en el otro periodo, por `${nivel}:${código}`. */
  comparar?: (Comparar & { saldos: ReadonlyMap<string, number>; nota?: string }) | null
}

const PREFIJO: Record<FilaSumas['nivel'], string> = { grupo: 'g', subgrupo: 's', cuenta: 't', subcuenta: 'c' }

/**
 * Sumas y saldos con los niveles pedidos (grupo, subgrupo, cuenta, subcuenta),
 * con lo que da `sumasYSaldos`. El saldo deudor y el acreedor de una fila con
 * hijos son la suma de los de sus hijos, cada uno por su lado (ERP10 y la
 * maqueta: «4» lleva 3.408,82 deudor y 5.766,54 acreedor). La subcuenta es la
 * que se abre en sus movimientos (y F5 abre su mayor); la cuenta de 3 cifras,
 * F5 abre el mayor de todas las suyas.
 */
export function arbolSumas(filas: readonly FilaSumas[], nombres: ReadonlyMap<string, string>, opciones: OpcionesArbolSumas | boolean = {}): Arbol {
  const o: OpcionesArbolSumas = typeof opciones === 'boolean' ? { conRango: opciones } : opciones
  const cmp = o.comparar ?? null
  const cs = columnasDe('sumas', { inicial: o.inicial, comparar: cmp })
  const porId = new Map(filas.map((f) => [`${f.nivel}:${f.code}`, f]))
  const out = new Map<string, Fila>()
  const hijosDe = (f: FilaSumas) => f.hijos.map((h) => porId.get(h)).filter((x): x is FilaSumas => !!x)
  // Lo deudor y lo acreedor de una fila: el suyo si no tiene hijos; si no, la suma de los de sus hijos.
  const da = (f: FilaSumas): [number, number] => {
    const hs = hijosDe(f)
    if (!hs.length) { const [d, a] = deudorAcreedor(f.saldo); return [c(d ?? 0), c(a ?? 0)] }
    return hs.map(da).reduce((x, y) => [x[0] + y[0], x[1] + y[1]], [0, 0])
  }
  const saldosFila = (f: FilaSumas): Partial<Record<Clave, Celda>> => {
    if (cmp) return saldosDe(f.saldo, cmp.saldos.get(`${f.nivel}:${f.code}`), true)
    const [d, a] = da(f)
    return hijosDe(f).length ? { deudor: d / 100 || null, acreedor: a / 100 || null } : saldosDe(f.saldo, null, false)
  }
  const construir = (f: FilaSumas, padre: string | null, nivel: number): string => {
    const id = `${PREFIJO[f.nivel]}:${f.code}`
    const base = { debe: f.debe, haber: f.haber, ...(o.inicial ? { inicial: f.inicial } : {}), ...saldosFila(f) }
    if (f.nivel === 'subcuenta') {
      out.set(id, { id, padre, nivel, clase: 'cuenta', celdas: celdasDe(cs, { cuenta: f.code, nombre: f.name, ...base }), hijos: [], cuenta: f.code, porLeer: true, mirar: mirarSaldo(f.code, f.saldo) ?? undefined })
      return id
    }
    const nombre = nombres.get(f.code)
    const fila: Fila = {
      id, padre, nivel, clase: 'grupo', celdas: celdasDe(cs, { cuenta: nombre ? `${f.code} · ${nombre}` : f.code, nombre: '', ...base }), junta: 2, hijos: [],
      ...(f.nivel === 'cuenta' ? { cuenta: f.code } : {}),
    }
    out.set(id, fila)
    fila.hijos = hijosDe(f).map((h) => construir(h, id, nivel + 1))
    return id
  }
  const orden: FilaSumas['nivel'][] = ['grupo', 'subgrupo', 'cuenta', 'subcuenta']
  const arriba = orden.find((n) => filas.some((f) => f.nivel === n))
  const raiz = filas.filter((f) => f.nivel === arriba).map((f) => construir(f, null, 0))
  // Las hojas: las del nivel más hondo que se ha pedido (las que no tienen hijos).
  const hojas = filas.filter((f) => !f.hijos.length)
  const sumar = (xs: readonly FilaSumas[], k: 'debe' | 'haber' | 'inicial' | 'saldo') => xs.reduce((x, h) => x + c(h[k]), 0) / 100
  const deArriba = filas.filter((f) => f.nivel === arriba)
  const [td, ta] = deArriba.map(da).reduce((x, y) => [x[0] + y[0], x[1] + y[1]], [0, 0])
  const totales: Partial<Record<Clave, Celda>> = {
    debe: sumar(hojas, 'debe'), haber: sumar(hojas, 'haber'), ...(o.inicial ? { inicial: sumar(hojas, 'inicial') } : {}),
    ...(cmp ? saldosDe(sumar(deArriba, 'saldo'), deArriba.reduce((x, f) => x + c(cmp.saldos.get(`${f.nivel}:${f.code}`) ?? 0), 0) / 100, true) : { deudor: td / 100, acreedor: ta / 100 }),
  }
  const cuadra = c(totales.debe as number) === c(totales.haber as number)
  return {
    raiz, filas: out, columnas: cs, total: celdasDe(cs, totales), cuantas: filas.filter((f) => f.nivel === 'subcuenta').length || hojas.length, cuadra,
    // Con un rango de cuentas, Debe y Haber no tienen por qué cuadrar (lo dice hoy SumasSaldos).
    avisos: cuadra || o.conRango ? [] : [descuadre(totales.debe as number, totales.haber as number)],
    ...(cmp?.nota ? { notaComparar: cmp.nota } : {}),
  }
}

type Apunte = ApunteMayor & { concepto: string; serie?: number; numero?: number | null }

/** Los movimientos de una cuenta, para colgarlos de su fila: con su saldo arrastrado (extracto, como el mayor de hoy) y el filtro de local y marca. */
export function filasDeMovimientos(padre: Fila, apuntes: readonly Apunte[], desde: string, hasta: string, que: 'sumas' | 'mayor', cs: readonly Columna[] = COLUMNAS[que], filtro: Omit<FiltroMayor, 'desde' | 'hasta'> = {}): Fila[] {
  const x = extracto([...apuntes], { desde, hasta, ...filtro })
  const fuera: Fila[] = []
  const nivel = padre.nivel + 1
  const cuenta = padre.cuenta
  const conSaldo = (s: number): Partial<Record<Clave, Celda>> => (cs.some((k) => k.clave === 'saldo') ? { saldo: s } : saldosDe(s, null, false))
  if (c(x.inicial) !== 0 || que === 'mayor') {
    fuera.push({ id: `${padre.id}:inicial`, padre: padre.id, nivel, clase: 'inicial', hijos: [], cuenta, celdas: celdasDe(cs, { cuenta: ddmm(desde), asiento: '', nombre: 'Saldo inicial', ...conSaldo(x.inicial) }) })
  }
  x.filas.forEach((m, i) => {
    const asiento = m.numero === null || m.numero === undefined ? '' : `${m.serie ?? ''}/${m.numero}`
    fuera.push({
      id: `${padre.id}:m${i}`, padre: padre.id, nivel, clase: 'movimiento', hijos: [], cuenta, entryId: m.entryId,
      celdas: celdasDe(cs, { cuenta: ddmm(m.fecha), asiento, nombre: m.concepto, debe: m.debe || null, haber: m.haber || null, ...conSaldo(m.saldo) }),
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
 * El filtro de local y marca del mayor, el mismo que hoy (LibroMayor): «» es
 * todos; «comun», solo lo común; «sin», sin marca. El saldo inicial se filtra
 * igual (extracto), para que el arrastre no mezcle.
 */
export function filtroMayor(local: string, marca: string): Omit<FiltroMayor, 'desde' | 'hasta'> {
  return {
    localId: local === '' ? undefined : local === 'comun' ? null : local,
    marcaId: marca === '' ? undefined : marca === 'sin' ? null : marca,
    soloComun: local === 'comun',
  }
}

export interface OpcionesMayor {
  filtro?: Omit<FiltroMayor, 'desde' | 'hasta'>
  /** «Comparar con»: los nombres y el saldo final de cada cuenta en el otro periodo (su mayor, abierto solo). */
  comparar?: (Comparar & { saldos: ReadonlyMap<string, number>; nota?: string }) | null
}

/**
 * El mayor: una fila por cuenta del rango con su extracto colgando (saldo
 * inicial y movimientos con el saldo arrastrado), como el mayor de hoy: los
 * apuntes desde el primer día del ejercicio, el saldo inicial es lo de antes
 * de `desde`. Solo las cuentas con algo: saldo inicial o movimientos.
 */
export function arbolMayor(apuntes: readonly (ApunteMayor & { concepto: string; serie: number; numero: number | null })[], desde: string, hasta: string, rango: { desde: string; hasta: string }, o: OpcionesMayor = {}): Arbol {
  const cmp = o.comparar ?? null
  const cs = columnasDe('mayor', { comparar: cmp })
  const porCuenta = new Map<string, typeof apuntes[number][]>()
  for (const m of apuntes) {
    if (!enRango(m.cuenta, rango.desde, rango.hasta)) continue
    const l = porCuenta.get(m.cuenta) ?? []
    l.push(m)
    porCuenta.set(m.cuenta, l)
  }
  const filas = new Map<string, Fila>()
  const raiz: string[] = []
  let td = 0, th = 0, ts = 0, to = 0
  for (const cuenta of [...porCuenta.keys()].sort()) {
    const ms = porCuenta.get(cuenta)!
    const x = extracto([...ms], { desde, hasta, ...o.filtro })
    if (c(x.inicial) === 0 && !x.filas.length) continue
    const id = `c:${cuenta}`
    const fila: Fila = {
      id, padre: null, nivel: 0, clase: 'cuenta', hijos: [], cuenta, mirar: mirarSaldo(cuenta, x.final) ?? undefined,
      celdas: celdasDe(cs, { cuenta, asiento: '', nombre: ms[0].nombreCuenta, debe: x.debe, haber: x.haber, ...saldosDe(x.final, cmp?.saldos.get(cuenta), !!cmp) }),
    }
    filas.set(id, fila)
    const hijas = filasDeMovimientos(fila, ms, desde, hasta, 'mayor', cs, o.filtro)
    for (const h of hijas) filas.set(h.id, h)
    fila.hijos = hijas.map((h) => h.id)
    raiz.push(id)
    td += c(x.debe); th += c(x.haber); ts += c(x.final); to += c(cmp?.saldos.get(cuenta) ?? 0)
  }
  const total: Partial<Record<Clave, Celda>> = { debe: td / 100, haber: th / 100, ...(cmp ? saldosDe(ts / 100, to / 100, true) : {}) }
  return { raiz, filas, columnas: cs, total: celdasDe(cs, total), cuantas: raiz.length, cuadra: null, avisos: [], ...(cmp?.nota ? { notaComparar: cmp.nota } : {}) }
}

// ── El diario ─────────────────────────────────────────────────────────────

/**
 * El diario (resumido, como hoy): mes › cuenta, con lo que da `resumir`; de
 * cada cuenta cuelgan sus movimientos del mes. El total de cada mes y del
 * diario, el de hoy.
 */
export function arbolDiario(meses: readonly MesResumido[], apuntes: readonly (ApunteMayor & { concepto: string })[]): Arbol {
  const cs = COLUMNAS.diario
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
  for (const mes of meses) {
    const id = `mes:${mes.mes}`
    const cuadraMes = c(mes.debe) === c(mes.haber)
    const fila: Fila = {
      id, padre: null, nivel: 0, clase: 'mes', junta: 2, hijos: [],
      celdas: celdasDe(cs, { cuenta: `${nombreMes(mes.mes)} · ${mes.asientos} ${mes.asientos === 1 ? 'asiento' : 'asientos'}`, nombre: '', debe: mes.debe, haber: mes.haber }),
      mirar: cuadraMes ? undefined : `No cuadra: ${dosDecimales(Math.abs(mes.debe - mes.haber))} de diferencia entre Debe y Haber. Un asiento validado siempre cuadra: avisa, es un fallo.`,
    }
    filas.set(id, fila)
    raiz.push(id)
    for (const f of mes.filas) {
      const idc = `${id}:${f.cuenta}`
      const ms = porMesYCuenta.get(`${mes.mes}|${f.cuenta}`) ?? []
      const cuenta: Fila = { id: idc, padre: id, nivel: 1, clase: 'cuenta', celdas: celdasDe(cs, { cuenta: f.cuenta, nombre: f.nombre, debe: f.debe || null, haber: f.haber || null }), hijos: [], cuenta: f.cuenta }
      filas.set(idc, cuenta)
      fila.hijos.push(idc)
      ms.forEach((m, i) => {
        const idm = `${idc}:m${i}`
        filas.set(idm, { id: idm, padre: idc, nivel: 2, clase: 'movimiento', celdas: celdasDe(cs, { cuenta: ddmm(m.fecha), nombre: m.concepto, debe: m.debe || null, haber: m.haber || null }), hijos: [], cuenta: f.cuenta, entryId: m.entryId })
        cuenta.hijos.push(idm)
      })
    }
    td += c(mes.debe); th += c(mes.haber)
  }
  const asientos = meses.reduce((x, m) => x + m.asientos, 0)
  return { raiz, filas, columnas: cs, total: celdasDe(cs, { debe: td / 100, haber: th / 100 }), cuantas: asientos, cuadra: td === th, avisos: [] }
}

// ── El libro de IVA ───────────────────────────────────────────────────────

export interface OpcionesIva {
  /** Los filtros de hoy (el «Listado de facturación» de Diez), aplicados con `filtrar`, la misma función. */
  filtros?: FiltrosLibro
  /** Las cuentas de cada asiento, para el filtro de subcuenta (cuentasPorAsiento, como hoy). */
  cuentas?: Map<string, string[]>
  /** «Agrupar por NIF»: en vez de por mes, por NIF. */
  porNif?: boolean
}

/** ¿Hay un filtro que recorta el libro? (como hoy: «Ver anuladas» no recorta, añade). */
export const hayFiltroIva = (f: FiltrosLibro = {}): boolean => !!(f.subcuenta || f.nif || f.importeSuperiorA || f.tipos?.length || f.solo347)

/**
 * El libro de IVA: mes › factura (o NIF › factura), con los filtros de hoy
 * (`filtrar`, la misma función). Sin «Ver anuladas», sin las anuladas; con él,
 * salen, dicen que lo están y no suman. Los totales son los de lo que se ve
 * (sin filtro, los de `cifrasLibro`); con un filtro, «3 de 12» (regla 7) y el
 * cuadre con el diario no se mira (es del libro entero). Lo que falta para
 * completar una anotación y el cuadre, con las frases de hoy.
 */
export function arbolIva(anotaciones: readonly AnotacionLibro[], libro: 'issued' | 'received', movimientoDiario: number | null, o: OpcionesIva = {}): Arbol {
  const cs = COLUMNAS.emitidas
  const f = o.filtros ?? {}
  const filtrado = hayFiltroIva(f)
  const lista = filtrar([...anotaciones], f, o.cuentas ?? new Map())
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || (a.number ?? '').localeCompare(b.number ?? '') || a.id.localeCompare(b.id))
  const vivas = lista.filter((a) => !a.voidedAt)
  const filas = new Map<string, Fila>()
  const raiz: string[] = []
  const grupoDe = (a: AnotacionLibro) => (o.porNif ? { id: `nif:${a.counterpartTaxId ?? ''}`, nombre: a.counterpartTaxId ? `${a.counterpartTaxId} · ${a.counterpartName ?? ''}` : 'Sin NIF' } : { id: `mes:${a.issueDate.slice(0, 7)}`, nombre: nombreMes(a.issueDate.slice(0, 7)) })
  const sumas = new Map<string, { base: number; cuota: number; total: number }>()
  const ordenados = o.porNif ? [...lista].sort((a, b) => (a.counterpartTaxId ?? '~').localeCompare(b.counterpartTaxId ?? '~') || a.issueDate.localeCompare(b.issueDate)) : lista
  for (const a of ordenados) {
    const g = grupoDe(a)
    let m = filas.get(g.id)
    if (!m) {
      m = { id: g.id, padre: null, nivel: 0, clase: 'mes', junta: 4, celdas: [], hijos: [] }
      filas.set(g.id, m)
      raiz.push(g.id)
      sumas.set(g.id, { base: 0, cuota: 0, total: 0 })
      ;(m as Fila & { nombre?: string }).nombre = g.nombre
    }
    const falta = a.voidedAt ? [] : faltaParaCompletar(a)
    const numero = [a.series, a.number].filter(Boolean).join('-') + (a.numberTo ? `–${a.numberTo}` : '')
    const id = `f:${a.id}`
    filas.set(id, {
      id, padre: g.id, nivel: 1, clase: 'factura', hijos: [], entryId: a.entryId,
      celdas: celdasDe(cs, { fecha: ddmm(a.issueDate), numero, nif: a.counterpartTaxId ?? '', nombre: `${a.counterpartName ?? ''}${a.voidedAt ? ' · anulada' : ''}`, base: a.taxBase, tipo: a.taxRate, cuota: a.taxAmount, total: a.total }),
      mirar: falta.length ? `Le falta para un requerimiento: ${falta.join(', ')}.` : undefined,
    })
    m.hijos.push(id)
    if (!a.voidedAt) { const s = sumas.get(g.id)!; s.base += c(a.taxBase); s.cuota += c(a.taxAmount); s.total += c(a.total ?? 0) }
  }
  for (const id of raiz) {
    const m = filas.get(id)! as Fila & { nombre?: string }
    const s = sumas.get(id)!
    m.celdas = celdasDe(cs, { fecha: `${m.nombre} · ${m.hijos.length} ${m.hijos.length === 1 ? 'factura' : 'facturas'}`, base: s.base / 100, cuota: s.cuota / 100, total: s.total / 100 })
    delete m.nombre
  }
  const base = vivas.reduce((x, a) => x + c(a.taxBase), 0) / 100
  const cuota = vivas.reduce((x, a) => x + c(a.taxAmount), 0) / 100
  const total = vivas.reduce((x, a) => x + c(a.total ?? 0), 0) / 100
  const cuadre = movimientoDiario === null || filtrado ? null : cuadreConDiario([...anotaciones], libro, movimientoDiario)
  return {
    raiz, filas, columnas: cs, total: celdasDe(cs, { base, cuota, total }), cuantas: vivas.length, ...(filtrado ? { de: anotaciones.filter((a) => !a.voidedAt).length } : {}),
    cuadra: filtrado ? null : cuadre ? cuadre.cuadra : true, avisos: cuadre && !cuadre.cuadra ? [cuadre.frase] : [],
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

/** Las columnas que se suman en «Suma y sigue»: las de Debe y Haber; en el libro de IVA, base, cuota y total. */
export const columnasQueSuman = (cs: readonly Columna[]): number[] => cs.flatMap((x, i) => (x.suma ? [i] : []))

/**
 * Las líneas de la hoja, en su orden, con las columnas del listado. Sumas y
 * saldos: las filas sin hijos (las subcuentas, como la maqueta 8). Mayor: cada
 * cuenta como cabecera, su saldo inicial, sus movimientos y su suma. Diario:
 * cada mes como cabecera, sus cuentas y su total. Libro de IVA: las facturas.
 * En «Suma y sigue» solo cuentan las líneas.
 */
export function lineasDeLaHoja(a: Arbol, que: QueListado): LineaHoja[] {
  const fuera: LineaHoja[] = []
  const f = (id: string) => a.filas.get(id)!
  const cs = a.columnas
  const solo = (r: Partial<Record<Clave, Celda>>) => celdasDe(cs, r)
  const de = (x: Fila, k: Clave) => { const i = cs.findIndex((y) => y.clave === k); return i < 0 ? null : x.celdas[i] }
  const cifrasDe = (x: Fila) => Object.fromEntries(cs.filter((y) => y.cifra).map((y) => [y.clave, de(x, y.clave)])) as Partial<Record<Clave, Celda>>
  if (que === 'sumas') {
    const ir = (id: string) => { const x = f(id); if (x.clase === 'cuenta' || (x.clase === 'grupo' && !x.hijos.length)) fuera.push({ celdas: x.celdas, clase: 'linea' }); else x.hijos.forEach(ir) }
    a.raiz.forEach(ir)
  } else if (que === 'mayor') {
    for (const id of a.raiz) {
      const x = f(id)
      fuera.push({ celdas: solo({ cuenta: de(x, 'cuenta'), nombre: de(x, 'nombre') }), clase: 'cabecera' })
      for (const h of x.hijos) fuera.push({ celdas: f(h).celdas, clase: f(h).clase === 'movimiento' ? 'linea' : 'suma' })
      fuera.push({ celdas: solo({ ...cifrasDe(x), nombre: 'Suma de la cuenta' }), clase: 'suma' })
    }
  } else if (que === 'diario') {
    for (const id of a.raiz) {
      const x = f(id)
      fuera.push({ celdas: solo({ cuenta: de(x, 'cuenta') }), clase: 'cabecera' })
      for (const h of x.hijos) fuera.push({ celdas: f(h).celdas, clase: 'linea' })
      fuera.push({ celdas: solo({ nombre: 'Total del mes', debe: de(x, 'debe'), haber: de(x, 'haber') }), clase: 'suma' })
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
