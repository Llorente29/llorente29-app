// src/modules/conta/lib/traer/conexion.ts
//
// X12 · Traer de ERP10 POR LA CONEXIÓN: lo leído de ERP10 (supabase/functions/_shared/erp10Traer.ts,
// página a página) en la MISMA FORMA que dan los ficheros (leer.ts). Así entra por el mismo
// camino: leerCarga lo junta con lo que se suelte, paraLaBase lo prepara, y los pasos 2 y 3 no
// cambian. Puro: sin base, sin red y sin React.
//
//   · Plan de cuentas: las subcuentas.
//   · Proveedores (40 y 41) y clientes (43 y 44): las mismas subcuentas, con su NIF, su dirección
//     y su país (en una sociedad, ERP10 no tiene otra lista de terceros: X11).
//   · Diario: los asientos del ejercicio, con el nombre de cada cuenta sacado de las subcuentas.
//   · Facturas: de /api/facturas, cada una al libro que le toca POR LA CUENTA DEL TERCERO (40/41,
//     recibida; 43/44, emitida) y, si la cuenta no lo dice, POR SU SERIE cuando esa serie solo lleva
//     de un libro. La que no se puede clasificar se dice y no entra (regla 7): no se adivina.
//   · Sumas y saldos: se calcula sumando los asientos (lo que da /getSumasYsaldos son líneas, no
//     saldos: X11). Si se suelta su fichero, manda el fichero, que es la comprobación de verdad.
//   · La comprobación de ERP10: lo leído, contado por mes y tipo, contra su resumen (que cuenta LÍNEAS).
//
// Los nombres y los NIF se limpian igual que al leer los ficheros (limpiar, normalizarNif): el mismo
// ejercicio por fichero y por la conexión tiene que dejar lo mismo (regla 31, tests/conta/x12).

import { limpiar } from '@/modules/conta/lib/importarPlan'
import { normalizarNif } from '@/modules/conta/lib/nif'
import { cifra, cuantos, fechaDeGente } from './excel'
import type { Apunte, Asiento, DiarioLeido, Factura, LibroLeido, PlanLeido, SumasLeidas, Tercero, TercerosLeidos } from './leer'
import type { ApunteT, FacturaT, ResumenT, SubcuentaT } from '../../../../../supabase/functions/_shared/erp10Traer'

export type { ApunteT, FacturaT, ResumenT, SubcuentaT }

/** Lo leído de ERP10 para un ejercicio (lo que va juntando el lector). */
export interface DeLaConexion {
  ejercicio: string
  subcuentas: SubcuentaT[]
  apuntes: ApunteT[]
  facturas: FacturaT[]
  /** El resumen de ERP10 del ejercicio; null si todavía no se ha leído. */
  resumen: ResumenT[] | null
  /** Los meses leídos enteros (AAAA-MM): solo esos se comparan con el resumen. */
  mesesLeidos: string[]
}

export const NOMBRE_CONEXION = 'Traído de ERP10'
export const NOMBRE_CALCULADO = 'Calculado de los asientos'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «2025-03» → «marzo de 2025». */
export const mesDeGente = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`
/** 20250315 → «2025-03-15». */
export const iso = (d: number | null): string | null => {
  const s = String(d ?? '')
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null
}
const n = (x: number) => x.toLocaleString('es-ES')

// ── Plan y terceros ──────────────────────────────────────────────────────────────────

export function planDeLaConexion(subs: readonly SubcuentaT[]): PlanLeido {
  return { subcuentas: subs.filter((s) => s.codigo).map((s) => ({ codigo: s.codigo, nombre: limpiar(s.nombre) })), avisos: [] }
}

/** Proveedores: 40 y 41. Clientes: 43 y 44. Con el NIF limpio como en los listados, y su dirección y su país. */
export function tercerosDeLaConexion(subs: readonly SubcuentaT[], clase: 'proveedores' | 'clientes'): TercerosLeidos {
  const pre = clase === 'proveedores' ? ['40', '41'] : ['43', '44']
  const terceros: Tercero[] = subs.filter((s) => pre.includes(s.codigo.slice(0, 2))).map((s) => ({
    codigo: s.codigo, nombreFiscal: limpiar(s.nombre), nombreComercial: limpiar(s.nombreComercial), nif: normalizarNif(s.nif) || null,
    poblacion: limpiar(s.poblacion), direccion: limpiar(s.direccion) || null, codigoPostal: s.codigoPostal || null, provincia: limpiar(s.provincia) || null,
    pais: s.pais.toUpperCase() || null,
  }))
  return { terceros, avisos: [] }
}

// ── El diario ────────────────────────────────────────────────────────────────────────

export function diarioDeLaConexion(apuntes: readonly ApunteT[], subs: readonly SubcuentaT[], ejercicio: string): DiarioLeido {
  const nombre = new Map(subs.map((s) => [s.codigo, limpiar(s.nombre)]))
  const ordenados = [...apuntes].sort((a, b) => a.fecha - b.fecha || a.serie.localeCompare(b.serie) || a.documento - b.documento)
  const avisos: string[] = []
  const asientos: Asiento[] = []
  let total = 0
  for (const a of ordenados) {
    const fecha = iso(a.fecha)
    if (!fecha) continue
    const lineas: Apunte[] = a.lineas.map((l) => ({ subcuenta: l.cuenta, nombre: nombre.get(l.cuenta) ?? '', concepto: limpiar(l.concepto || a.concepto), debe: l.debe, haber: l.haber }))
    const x: Asiento = { clave: `${a.serie}.${a.documento}`, serie: a.serie, documento: String(a.documento), fecha, apuntes: lineas,
      debe: lineas.reduce((s, l) => s + l.debe, 0), haber: lineas.reduce((s, l) => s + l.haber, 0) }
    asientos.push(x)
    total += lineas.length
    if (x.debe !== x.haber) {
      avisos.push(`El asiento ${x.clave} del ${fechaDeGente(x.fecha)} no cuadra: ${cifra(x.debe)} al debe y ${cifra(x.haber)} al haber (${cifra(Math.abs(x.debe - x.haber))} de diferencia).`)
    }
  }
  return {
    ejercicio, asientos, apuntes: total, debe: asientos.reduce((s, a) => s + a.debe, 0), haber: asientos.reduce((s, a) => s + a.haber, 0),
    serieComoNumero: false, avisos,
  }
}

/** El sumas y saldos, sumando los asientos (cuenta a cuenta), con el nombre de cada una. */
export function sumasDeLosAsientos(d: DiarioLeido): SumasLeidas {
  const por = new Map<string, { nombre: string; debe: number; haber: number }>()
  for (const a of d.asientos) for (const x of a.apuntes) {
    const y = por.get(x.subcuenta) ?? { nombre: x.nombre, debe: 0, haber: 0 }
    y.debe += x.debe; y.haber += x.haber
    por.set(x.subcuenta, y)
  }
  const filas = [...por.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([subcuenta, y]) => ({
    subcuenta, nombre: y.nombre, debe: y.debe, haber: y.haber, deudor: Math.max(y.debe - y.haber, 0), acreedor: Math.max(y.haber - y.debe, 0),
  }))
  const s = (k: 'debe' | 'haber' | 'deudor' | 'acreedor') => filas.reduce((t, x) => t + x[k], 0)
  return { filas, totales: { debe: s('debe'), haber: s('haber'), deudor: s('deudor'), acreedor: s('acreedor') }, avisos: [] }
}

// ── Las facturas: a qué libro va cada una ────────────────────────────────────────────

export type Libro = 'recibidas' | 'expedidas'
const libroDeCuenta = (c: string): Libro | null => (/^4[01]/.test(c) ? 'recibidas' : /^4[34]/.test(c) ? 'expedidas' : null)

export interface Clasificadas {
  recibidas: FacturaT[]
  expedidas: FacturaT[]
  /** Las que no se sabe de qué libro son: no entran, y se dice cada una. */
  sinSaber: { f: FacturaT; porque: string }[]
  /** Cómo han venido, por serie y cuenta del tercero (lo que se pega en el PR, sin nombres). */
  porSerie: { serie: string; libro: Libro | null; cuentas: string[]; cuantas: number }[]
}

/**
 * Por la cuenta del tercero (CuentaCliente): 40/41, recibida; 43/44, emitida. Si la cuenta no lo dice,
 * por la serie, SOLO si en ese ejercicio esa serie lleva facturas de un solo libro (por su cuenta). Si
 * no, no se sabe: se dice y no entra.
 */
export function clasificarFacturas(fs: readonly FacturaT[]): Clasificadas {
  const deSerie = new Map<string, Set<Libro>>()
  for (const f of fs) { const l = libroDeCuenta(f.cuenta); if (l) deSerie.set(f.serie, (deSerie.get(f.serie) ?? new Set()).add(l)) }
  const out: Clasificadas = { recibidas: [], expedidas: [], sinSaber: [], porSerie: [] }
  const por = new Map<string, { libro: Libro | null; cuentas: Set<string>; cuantas: number; libros: Set<Libro | null> }>()
  for (const f of fs) {
    const lc = libroDeCuenta(f.cuenta)
    const ls = deSerie.get(f.serie)
    const libro = lc ?? (ls && ls.size === 1 ? [...ls][0] : null)
    if (libro) out[libro].push(f)
    else {
      const que = `La factura ${f.numero || 'sin número'} del ${fechaDeGente(iso(f.fechaFactura ?? f.fecha) ?? '0000-00-00')} (asiento ${f.serie}/${f.documento})`
      const cuenta = f.cuenta ? `su cuenta ${f.cuenta} no es de proveedor ni de cliente` : 'no trae la cuenta del tercero'
      const serie = !ls ? `y su serie ${f.serie || '(sin serie)'} no lleva ninguna otra que lo diga` : `y su serie ${f.serie} lleva emitidas y recibidas`
      out.sinSaber.push({ f, porque: `${que}: ${cuenta}, ${serie}. No sé si es emitida o recibida y no se trae.` })
    }
    const k = f.serie
    const y = por.get(k) ?? { libro: null, cuentas: new Set<string>(), cuantas: 0, libros: new Set<Libro | null>() }
    y.cuentas.add(f.cuenta.slice(0, 2) || '—'); y.cuantas++; y.libros.add(libro)
    por.set(k, y)
  }
  out.porSerie = [...por.entries()].sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true })).map(([serie, y]) => ({
    serie, libro: y.libros.size === 1 ? [...y.libros][0] : null, cuentas: [...y.cuentas].sort(), cuantas: y.cuantas,
  }))
  return out
}

/** «F-12» → serie «F», número «12» (como el libro de la AEAT); «12» → sin serie. */
export function serieYNumero(numero: string): { serie: string | null; numeroSolo: string | null } {
  const m = /^(.*?)[\s\-/.]*(\d{1,9})$/.exec(numero.trim())
  if (!m) return { serie: null, numeroSolo: null }
  return { serie: m[1].trim() || null, numeroSolo: m[2] }
}

/** Una factura de ERP10 como la fila de su libro de la AEAT. */
export function facturaDeLaConexion(f: FacturaT, libro: Libro, ejercicio: string): Factura {
  const expedicion = iso(f.fechaFactura ?? f.fecha) ?? ''
  const fechaAsiento = iso(f.fecha) ?? expedicion
  const trimestre = fechaAsiento ? `${Math.floor((Number(fechaAsiento.slice(5, 7)) - 1) / 3) + 1}T` : null
  const sn = libro === 'expedidas' ? serieYNumero(f.numero) : { serie: null, numeroSolo: null }
  return {
    numero: f.numero, serie: sn.serie, numeroSolo: sn.numeroSolo, expedicion, operacion: iso(f.fechaOperacion), periodo: trimestre, ejercicio,
    nif: normalizarNif(f.nif) || null, nombre: limpiar(f.nombre), tipoFactura: f.claveTipo, tramos: f.tramos.map((t) => ({ ...t })),
    base: f.tramos.reduce((s, t) => s + t.base, 0), cuota: f.tramos.reduce((s, t) => s + t.cuota, 0), total: f.total,
    retencion: f.retencion ? { ...f.retencion } : null,
  }
}

export function libroDeLaConexion(fs: readonly FacturaT[], libro: Libro, ejercicio: string): LibroLeido {
  const facturas = [...fs].sort((a, b) => a.fecha - b.fecha || a.documento - b.documento).map((f) => facturaDeLaConexion(f, libro, ejercicio))
  const sinFecha = facturas.filter((x) => !x.expedicion).length
  const nombreLibro = libro === 'recibidas' ? 'el libro de facturas recibidas' : 'el libro de facturas emitidas'
  return { facturas, filas: facturas.reduce((s, x) => s + Math.max(1, x.tramos.length), 0), avisos: sinFecha ? [`En ${nombreLibro} hay ${sinFecha === 1 ? 'una factura' : `${sinFecha} facturas`} sin fecha de expedición.`] : [] }
}

/** Cómo han venido las facturas, en una línea por serie (sin nombres: se puede pegar). */
export function fraseDeLasSeries(c: Clasificadas): string {
  const libro = (l: Libro | null) => (l === 'recibidas' ? 'recibidas' : l === 'expedidas' ? 'emitidas' : 'sin saber o de los dos libros')
  const partes = c.porSerie.map((s) => `serie ${s.serie || '(sin serie)'}: ${n(s.cuantas)} ${libro(s.libro)} (cuentas ${s.cuentas.join(', ')})`)
  return `Las facturas de ERP10: ${n(c.expedidas.length)} emitidas, ${n(c.recibidas.length)} recibidas y ${n(c.sinSaber.length)} sin saber. Por serie: ${partes.join('; ') || 'ninguna'}.`
}

// ── La comprobación de ERP10: lo leído contra su resumen ─────────────────────────────

export interface ContraElResumen {
  /** El total de líneas de cada mes da lo mismo (X14l: el reparto por tipo no cuenta). */
  cuadra: boolean
  /** Lo que no da lo mismo, una frase por mes, con las dos cifras. */
  frases: string[]
  /** La línea corta: «Igual que ERP10, mes a mes» o cuántos meses no. */
  nota: string
  /** Las líneas de los meses leídos, en ERP10 y traídas. */
  lineasErp10: number
  lineasTraidas: number
}

/**
 * Lo leído, contado por mes, contra el resumen de ERP10 (sus líneas por mes). Solo los meses leídos enteros.
 * X14l (Julio, 27/11): se compara el TOTAL de líneas de cada mes. El tipo de asiento que se lee de cada asiento
 * (TipoAsiento) no usa los mismos códigos que el «tipo de introducción» del resumen (medido en el 2025 de QBO: enero,
 * 1.743 líneas en los dos, repartidas de otra forma), así que el reparto por tipo no es una diferencia: va solo como
 * detalle en la frase de un mes cuyo total no cuadra. La prueba de verdad sigue siendo el sumas y saldos, cuenta a cuenta.
 */
export function contraElResumen(apuntes: readonly ApunteT[], resumen: readonly ResumenT[], meses: readonly string[]): ContraElResumen {
  const clave = (mes: string, tipo: number | null) => `${mes}|${tipo ?? '—'}`
  const leido = new Map<string, number>(), deErp = new Map<string, number>(), nombres = new Map<string, string>()
  const enMes = new Set(meses)
  for (const a of apuntes) {
    const m = iso(a.fecha)?.slice(0, 7)
    if (!m || !enMes.has(m)) continue
    leido.set(clave(m, a.tipo), (leido.get(clave(m, a.tipo)) ?? 0) + a.lineas.length)
  }
  for (const r of resumen) {
    const m = `${r.ejercicio}-${String(r.mes).padStart(2, '0')}`
    if (!enMes.has(m)) continue
    deErp.set(clave(m, r.tipo), (deErp.get(clave(m, r.tipo)) ?? 0) + r.lineas)
    if (r.nombre) nombres.set(String(r.tipo ?? '—'), r.nombre)
  }
  const frases: string[] = []
  let lineasErp10 = 0, lineasTraidas = 0
  for (const m of [...meses].sort()) {
    const tipos = new Set([...leido.keys(), ...deErp.keys()].filter((k) => k.startsWith(`${m}|`)).map((k) => k.split('|')[1]))
    const detalle: string[] = []
    let e = 0, t = 0
    for (const tipo of [...tipos].sort()) {
      const x = deErp.get(`${m}|${tipo}`) ?? 0, y = leido.get(`${m}|${tipo}`) ?? 0
      e += x; t += y
      if (x !== y) detalle.push(`${nombres.has(tipo) ? `«${nombres.get(tipo)}»` : `el tipo ${tipo}`}: ERP10 cuenta ${cuantos(x, 'línea', 'líneas')} y se han traído ${n(y)}`)
    }
    lineasErp10 += e; lineasTraidas += t
    if (e !== t) frases.push(`En ${mesDeGente(m)} lo traído no da lo mismo que el resumen de ERP10: ERP10 cuenta ${cuantos(e, 'línea', 'líneas')} y se han traído ${n(t)}.${detalle.length ? ` Por tipo (solo de detalle: los tipos de ERP10 no son los mismos códigos), ${detalle.join('; ')}.` : ''}`)
  }
  const cuadra = frases.length === 0
  return {
    cuadra, frases, lineasErp10, lineasTraidas,
    nota: cuadra ? 'Igual que ERP10, mes a mes' : `${cuantos(frases.length, 'mes no da', 'meses no dan')} lo mismo que ERP10`,
  }
}

// ── Todo junto: lo que recibe leerCarga ─────────────────────────────────────────────

export type TipoDeLaConexion = 'plan_cuentas' | 'proveedores' | 'clientes' | 'diario' | 'recibidas' | 'expedidas'

export interface LeidoDeLaConexion {
  ejercicio: string
  plan: PlanLeido
  proveedores: TercerosLeidos
  clientes: TercerosLeidos
  diario: DiarioLeido
  recibidas: LibroLeido
  expedidas: LibroLeido
  /** El sumas y saldos calculado de los asientos (solo se usa si no se suelta su fichero). */
  sumas: SumasLeidas
  clasificadas: Clasificadas
  /** La comprobación de ERP10 (null mientras no se ha leído el resumen). */
  resumen: ContraElResumen | null
  /** Lo que dice cada fila en «Ha leído». */
  haLeido: Record<TipoDeLaConexion, string>
}

/** Lo leído de ERP10, en las formas de los ficheros. */
export function leidoDeLaConexion(d: DeLaConexion): LeidoDeLaConexion {
  const plan = planDeLaConexion(d.subcuentas)
  const proveedores = tercerosDeLaConexion(d.subcuentas, 'proveedores'), clientes = tercerosDeLaConexion(d.subcuentas, 'clientes')
  const diario = diarioDeLaConexion(d.apuntes, d.subcuentas, d.ejercicio)
  const clasificadas = clasificarFacturas(d.facturas)
  const recibidas = libroDeLaConexion(clasificadas.recibidas, 'recibidas', d.ejercicio)
  const expedidas = libroDeLaConexion(clasificadas.expedidas, 'expedidas', d.ejercicio)
  return {
    ejercicio: d.ejercicio, plan, proveedores, clientes, diario, recibidas, expedidas, sumas: sumasDeLosAsientos(diario), clasificadas,
    resumen: d.resumen ? contraElResumen(d.apuntes, d.resumen, d.mesesLeidos) : null,
    haLeido: {
      plan_cuentas: cuantos(plan.subcuentas.length, 'cuenta', 'cuentas'),
      proveedores: cuantos(proveedores.terceros.length, 'ficha', 'fichas'),
      clientes: cuantos(clientes.terceros.length, 'ficha', 'fichas'),
      diario: `${cuantos(diario.asientos.length, 'asiento', 'asientos')} · ${cuantos(diario.apuntes, 'apunte', 'apuntes')}`,
      recibidas: cuantos(recibidas.facturas.length, 'factura', 'facturas'),
      expedidas: cuantos(expedidas.facturas.length, 'factura', 'facturas'),
    },
  }
}
