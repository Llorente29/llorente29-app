// src/modules/conta/lib/traer/index.ts
//
// N04 · Traer de ERP10: reconocer y leer sus ficheros. Módulo PURO: sin base y sin
// pantalla. Recibe los ficheros que sube la persona (ya abiertos, abrirExcel) y
// devuelve qué es cada uno, lo que trae, lo que no cuadra y lo que Sumied aprende,
// escrito ya como se va a leer en «Traer de ERP10» (la maqueta aprobada).
//
//   leerCarga(ficheros, conexion?)   todo junto (lo que usará la pantalla, N07); X12: con lo traído
//                                    de ERP10 por la conexión (conexion.ts), que entra igual
//   abrirExcel(nombre, bytes)        abrir un .xlsx con el tipo de cada celda
//   reconocer(fichero)               qué es un fichero, por lo que lleva dentro
//   leerSumasYSaldos(hoja, fila)     suelto: lo usa también la salida a ERP10
//   compararConSumas(lado, sumas)    suelto: cuenta a cuenta contra un sumas y saldos
//
// Los libros de facturas (recibidas y emitidas) son el formato oficial de la AEAT: los
// lee igual vengan de ERP10, de Diez o de otro programa.

import { cuantos, type FicheroExcel } from './excel'
import { nombreDe, reconocer, TIPOS, type TipoFichero } from './reconocer'
import {
  leerDiario, leerInmovilizado, leerLibro, leerPlan, leerSumasYSaldos, leerTerceros,
  type DiarioLeido, type InmovilizadoLeido, type LibroLeido, type PlanLeido, type SumasLeidas, type TercerosLeidos,
} from './leer'
import {
  casarFacturas, compararConSumas, cuentasQueFaltan, ivaPorTrimestre, largoDeLasCuentas, sumarPorSubcuenta, tercerosRaros,
  type Casado, type CuentaComparada, type IvaTrimestre, type Largos, type TerceroRaro,
} from './comprobar'
import { aprenderProveedores, type Aprendido, type Pendiente } from './aprender'
import { pendientesPorPagos } from './casarPagos'
import { NOMBRE_CALCULADO, NOMBRE_CONEXION, fraseDeLasSeries, type LeidoDeLaConexion, type TipoDeLaConexion } from './conexion'

export * from './excel'
export * from './reconocer'
export * from './leer'
export * from './comprobar'
export * from './aprender'
export * from './paraLaBase'
export * from './pantalla'
export * from './casarPagos'
export * from './conexion'
export * from './unBoton'

/** Cómo está cada fichero en la lista de la maqueta: «Leído», «Mira esto» o «Falta». */
export type Estado = 'leido' | 'mira' | 'falta'

export interface FicheroDeLaCarga {
  tipo: TipoFichero
  /** «Diario», «Facturas recibidas»… */
  que: string
  /** El fichero subido (nulo si falta). */
  fichero: string | null
  /** «Ha leído»: «16 cuentas», «10 asientos · 26 apuntes», «3 facturas». */
  haLeido: string | null
  estado: Estado
  /** Lo que hay que mirar de este fichero, en una frase cada cosa. */
  avisos: string[]
  /** X12 · De dónde sale: un fichero soltado, la conexión con ERP10, o calculado de los asientos. */
  origen: 'fichero' | 'conexion' | 'calculado' | null
}

export interface Carga {
  /** Los ocho, en el orden de la maqueta: los que están y los que faltan. */
  ficheros: FicheroDeLaCarga[]
  /** Lo que no es de ninguno: no reconocidos, repetidos, no es un Excel. */
  avisos: string[]
  plan: PlanLeido | null
  proveedores: TercerosLeidos | null
  clientes: TercerosLeidos | null
  inmovilizado: InmovilizadoLeido | null
  diario: DiarioLeido | null
  sumas: SumasLeidas | null
  recibidas: LibroLeido | null
  expedidas: LibroLeido | null
  comprobado: {
    /** El diario, sumado por subcuenta, contra el sumas y saldos (nulo si falta alguno). */
    sumas: CuentaComparada[] | null
    iva: IvaTrimestre[]
    facturas: Casado | null
    largos: Largos
    fueraDelPlan: string[]
    tercerosFueraDeListados: string[]
    tercerosRaros: TerceroRaro[]
    /** Todo lo que no cuadra, en una frase cada cosa (lo que enseña «Qué mirar antes de traerlo»). */
    frases: string[]
  }
  aprendido: { proveedores: Aprendido[]; pendientes: Pendiente[] }
  /** X12 · Lo traído por la conexión: cómo han venido las facturas y la comprobación de ERP10. Null sin conexión. */
  conexion: { ejercicio: string; series: string; resumen: LeidoDeLaConexion['resumen']; sinSaber: string[] } | null
}

/** Lo que se sube: ya abierto, o un fichero que no se pudo abrir (con su porqué). */
export type Subido = FicheroExcel | { nombre: string; noSeAbre: string }

/** Reconoce, lee, comprueba entre ficheros y calcula lo aprendido. No escribe nada. */
export function leerCarga(subidos: readonly Subido[], conexion: LeidoDeLaConexion | null = null): Carga {
  const avisos: string[] = []
  const porTipo = new Map<TipoFichero, { nombre: string; leido: ReturnType<typeof leerUno>; origen: 'fichero' | 'conexion' | 'calculado' }>()
  for (const s of subidos) {
    if ('noSeAbre' in s) { avisos.push(`«${s.nombre}» no es un Excel que se pueda abrir: ${s.noSeAbre}`); continue }
    const r = reconocer(s)
    if (!r) {
      avisos.push(`No reconozco «${s.nombre}»: no es ninguno de los listados de ERP10 que sé leer (plan de cuentas, proveedores, clientes, inmovilizado, diario, sumas y saldos, y los libros de facturas recibidas y emitidas).`)
      continue
    }
    const ya = porTipo.get(r.tipo)
    if (ya) {
      avisos.push(`Hay dos ficheros de ${nombreDe(r.tipo).toLowerCase()}: «${ya.nombre}» y «${s.nombre}». Me quedo con el primero; quita el que sobra.`)
      continue
    }
    porTipo.set(r.tipo, { nombre: s.nombre, leido: leerUno(r.tipo, r.hoja, r.fila), origen: 'fichero' })
  }
  // X12 · Lo traído de ERP10 por la conexión manda sobre un fichero del mismo tipo; el sumas y saldos, al revés:
  // si se suelta, manda el fichero (es la comprobación independiente), y si no, se calcula de los asientos.
  if (conexion) {
    const datos: Record<TipoDeLaConexion, Leido> = {
      plan_cuentas: conexion.plan, proveedores: conexion.proveedores, clientes: conexion.clientes, diario: conexion.diario,
      recibidas: conexion.recibidas, expedidas: conexion.expedidas,
    }
    for (const t of Object.keys(datos) as TipoDeLaConexion[]) {
      const ya = porTipo.get(t)
      if (ya) avisos.push(`Has soltado «${ya.nombre}» y ${nombreDe(t).toLowerCase()} también se trae de ERP10: me quedo con lo traído de ERP10.`)
      const extra = t === 'diario' ? (conexion.resumen?.frases ?? []) : []
      porTipo.set(t, { nombre: NOMBRE_CONEXION, origen: 'conexion', leido: { datos: datos[t], haLeido: conexion.haLeido[t], avisos: [...(datos[t] as { avisos: string[] }).avisos, ...extra] } })
    }
    if (!porTipo.has('sumas_saldos')) {
      porTipo.set('sumas_saldos', { nombre: NOMBRE_CALCULADO, origen: 'calculado', leido: { datos: conexion.sumas, haLeido: cuantos(conexion.sumas.filas.length, 'cuenta', 'cuentas'), avisos: [] } })
    }
    const sin = conexion.clasificadas.sinSaber
    if (sin.length) {
      avisos.push(`${sin.length === 1 ? 'Una factura de ERP10 no se sabe' : `${sin.length} facturas de ERP10 no se sabe`} si ${sin.length === 1 ? 'es emitida o recibida' : 'son emitidas o recibidas'}, y no se ${sin.length === 1 ? 'trae' : 'traen'}. ${sin.slice(0, 10).map((x) => x.porque).join(' ')}${sin.length > 10 ? ` Y ${sin.length - 10} más.` : ''}`)
    }
  }
  const de = <T,>(t: TipoFichero) => (porTipo.get(t)?.leido.datos ?? null) as T | null
  const plan = de<PlanLeido>('plan_cuentas'), proveedores = de<TercerosLeidos>('proveedores'), clientes = de<TercerosLeidos>('clientes')
  const inmovilizado = de<InmovilizadoLeido>('inmovilizado'), diario = de<DiarioLeido>('diario'), sumas = de<SumasLeidas>('sumas_saldos')
  const recibidas = de<LibroLeido>('recibidas'), expedidas = de<LibroLeido>('expedidas')

  // ── Entre ficheros ──
  const terceros = [...(proveedores?.terceros ?? []), ...(clientes?.terceros ?? [])]
  const hayListados = proveedores !== null || clientes !== null
  const frasesPor = new Map<TipoFichero, string[]>()
  const anotar = (t: TipoFichero, f: string) => frasesPor.set(t, [...(frasesPor.get(t) ?? []), f])
  // Calculado de los mismos asientos, el sumas y saldos no comprueba nada contra ellos: no se compara.
  const cmpSumas = diario && sumas && porTipo.get('sumas_saldos')?.origen !== 'calculado' ? compararConSumas(sumarPorSubcuenta(diario.asientos), sumas.filas) : null
  for (const c of cmpSumas ?? []) if (c.frase) anotar('sumas_saldos', c.frase)
  const iva = diario ? ivaPorTrimestre(diario, recibidas, expedidas) : []
  for (const x of iva) if (!x.cuadra) anotar(x.libro, x.frase)
  const facturas = diario && (recibidas || expedidas) ? casarFacturas(diario, recibidas, expedidas, terceros) : null
  for (const x of facturas?.sinCasar ?? []) anotar(x.libro, x.porque)
  const largos = largoDeLasCuentas([
    { nombre: 'el plan de cuentas', cuentas: plan?.subcuentas.map((s) => s.codigo) ?? [] },
    { nombre: 'los proveedores', cuentas: proveedores?.terceros.map((t) => t.codigo) ?? [] },
    { nombre: 'los clientes', cuentas: clientes?.terceros.map((t) => t.codigo) ?? [] },
    { nombre: 'el inmovilizado', cuentas: inmovilizado?.elementos.map((e) => e.subcuenta) ?? [] },
    { nombre: 'el diario', cuentas: diario?.asientos.flatMap((a) => a.apuntes.map((x) => x.subcuenta)) ?? [] },
    { nombre: 'el sumas y saldos', cuentas: sumas?.filas.map((x) => x.subcuenta) ?? [] },
  ])
  const faltan = diario ? cuentasQueFaltan(diario, plan, hayListados ? terceros : null) : { fueraDelPlan: [], tercerosFueraDeListados: [], frases: [] }
  for (const f of faltan.frases) anotar('diario', f)
  const raros = hayListados ? tercerosRaros(terceros, [...(recibidas?.facturas ?? []), ...(expedidas?.facturas ?? [])]) : []
  for (const r of raros) anotar(proveedores?.terceros.some((t) => r.cuentas.includes(t.codigo)) ? 'proveedores' : 'clientes', r.frase)

  // ── Lo aprendido ──
  const aprendidos = diario && proveedores ? aprenderProveedores(diario, proveedores.terceros, facturas?.casadas ?? []) : []
  // N09 · Lo pendiente de cada factura, casando cada pago con su factura (antes, repartiendo el saldo).
  const pendientes = diario
    ? pendientesPorPagos(diario, [...(proveedores?.terceros ?? []).map((t) => ({ t, clase: 'proveedor' as const })), ...(clientes?.terceros ?? []).map((t) => ({ t, clase: 'cliente' as const }))],
      [...(recibidas?.facturas ?? []), ...(expedidas?.facturas ?? [])], sumas ?? null)
    : []

  const ficheros: FicheroDeLaCarga[] = TIPOS.map(({ tipo, nombre }) => {
    const x = porTipo.get(tipo)
    if (!x) return { tipo, que: nombre, fichero: null, haLeido: null, estado: 'falta', avisos: [], origen: null }
    const todos = [...x.leido.avisos, ...(frasesPor.get(tipo) ?? [])]
    return { tipo, que: nombre, fichero: x.nombre, haLeido: x.leido.haLeido, estado: todos.length ? 'mira' : 'leido', avisos: todos, origen: x.origen }
  })
  const frases = [...avisos, ...ficheros.flatMap((f) => f.avisos), ...(largos.frase ? [largos.frase] : [])]
  return {
    ficheros, avisos, plan, proveedores, clientes, inmovilizado, diario, sumas, recibidas, expedidas,
    comprobado: {
      sumas: cmpSumas, iva, facturas, largos, fueraDelPlan: faltan.fueraDelPlan, tercerosFueraDeListados: faltan.tercerosFueraDeListados,
      tercerosRaros: raros, frases,
    },
    aprendido: { proveedores: aprendidos, pendientes },
    conexion: conexion ? { ejercicio: conexion.ejercicio, series: fraseDeLasSeries(conexion.clasificadas), resumen: conexion.resumen, sinSaber: conexion.clasificadas.sinSaber.map((x) => x.porque) } : null,
  }
}

type Leido = PlanLeido | TercerosLeidos | InmovilizadoLeido | DiarioLeido | SumasLeidas | LibroLeido

function leerUno(tipo: TipoFichero, hoja: Parameters<typeof leerPlan>[0], fila: number): { datos: Leido; haLeido: string; avisos: string[] } {
  switch (tipo) {
    case 'plan_cuentas': { const d = leerPlan(hoja, fila); return { datos: d, haLeido: cuantos(d.subcuentas.length, 'cuenta', 'cuentas'), avisos: d.avisos } }
    case 'proveedores':
    case 'clientes': { const d = leerTerceros(hoja, fila); return { datos: d, haLeido: cuantos(d.terceros.length, 'ficha', 'fichas'), avisos: d.avisos } }
    case 'inmovilizado': { const d = leerInmovilizado(hoja, fila); return { datos: d, haLeido: cuantos(d.elementos.length, 'elemento', 'elementos'), avisos: d.avisos } }
    case 'diario': { const d = leerDiario(hoja, fila); return { datos: d, haLeido: `${cuantos(d.asientos.length, 'asiento', 'asientos')} · ${cuantos(d.apuntes, 'apunte', 'apuntes')}`, avisos: d.avisos } }
    case 'sumas_saldos': { const d = leerSumasYSaldos(hoja, fila); return { datos: d, haLeido: cuantos(d.filas.length, 'cuenta', 'cuentas'), avisos: d.avisos } }
    case 'recibidas':
    case 'expedidas': { const d = leerLibro(hoja, fila, tipo); return { datos: d, haLeido: cuantos(d.facturas.length, 'factura', 'facturas'), avisos: d.avisos } }
  }
}
