// src/modules/conta/lib/liquidacionesMes.ts
//
// S01q · PR C · Lo que enseña Ventas › Liquidaciones, mes a mes (las maquetas
// aprobadas por Julio el 02/11, respuesta S01q·1). Lo decide la base
// (conta_liquidaciones_mes); aquí solo se ordena y se escribe:
//   · un mes en una pantalla, por plataforma y tienda;
//   · los cuatro estados: Completa · Aún no toca · Te necesita · No cuadra;
//   · cada periodo con sus cuatro piezas: lo vendido, la liquidación, su
//     factura de comisión y el cobro;
//   · las marcas cedidas, aparte: «se cuadran con su socio».
// Regla 7: un filtro ordena y elige lo que se ve, nunca hace que algo deje de
// contarse: la frase del resumen y la barra cuentan siempre el mes entero.

import { filaMotor, type FilaMotor } from '@/modules/conta/lib/liquidacionesMotor'

export type EstadoMes = 'completa' | 'aun_no_toca' | 'te_necesita' | 'no_cuadra'
export type AccionMes = 'pidela' | 'subela' | 'ver_por_que' | 'elige_local' | 'elige_marca' | 'mira_el_banco' | null

export const ESTADOS_MES: readonly EstadoMes[] = ['completa', 'aun_no_toca', 'te_necesita', 'no_cuadra']
export const NOMBRE_ESTADO: Record<EstadoMes, string> = { completa: 'Completa', aun_no_toca: 'Aún no toca', te_necesita: 'Te necesita', no_cuadra: 'No cuadra' }
export const NOMBRE_ACCION: Record<Exclude<AccionMes, null>, string> = {
  pidela: 'Pídela', subela: 'Súbela', ver_por_que: 'Ver por qué', elige_local: 'Elige el local', elige_marca: 'Elige la marca', mira_el_banco: 'Mira el banco',
}
const ACCIONES = Object.keys(NOMBRE_ACCION) as Exclude<AccionMes, null>[]

export interface TiendaMes { id: string; nombre: string; localId: string | null }

/** Una fila del mes: una tienda (su marca y su local) y un periodo. */
export interface FilaMes {
  clave: string
  canal: string
  estado: EstadoMes
  frase: string
  accion: AccionMes
  cuando: string | null
  sinLocal: boolean
  tiendas: TiendaMes[]
  /** La diferencia de un «no cuadra» (positiva: te pagan de menos). */
  diferencia: number | null
  /** Glovo: se compara por productos a precio de carta. */
  comparado: { vendido: number; liquidacion: number; pedidosNuestros: number | null; pedidosLiquidacion: number | null; promociones: number } | null
  motor: FilaMotor
}

/** Lo que liquida cada mes el socio de las marcas cedidas, por local. */
export interface CedidaMes {
  socio: string
  socioId: string | null
  local: string | null
  localId: string | null
  marcas: string[]
  vendido: { total: number; pedidos: number }
  estado: EstadoMes
  frase: string
  cuando: string | null
  liquidacion: { id: string; total: number | null } | null
}

export interface Resumen { total: number; completa: number; aunNoToca: number; teNecesita: number; noCuadra: number }

export interface MesLiquidaciones { mes: string; desde: string; hasta: string; resumen: Resumen; filas: FilaMes[]; cedidas: CedidaMes[] }

type J = Record<string, unknown>
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const n = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v))
const estadoDe = (v: unknown): EstadoMes => (ESTADOS_MES.includes(v as EstadoMes) ? (v as EstadoMes) : 'te_necesita')
const accionDe = (v: unknown): AccionMes => (ACCIONES.includes(v as Exclude<AccionMes, null>) ? (v as AccionMes) : null)

/** El mes tal como lo devuelve la base (conta_liquidaciones_mes). */
export function mesDesdeBase(x: J): MesLiquidaciones {
  const r = (x.resumen ?? {}) as J
  const filas = ((x.filas ?? []) as J[]).filter((f) => f.grupo !== 'cedida').map((f): FilaMes => ({
    clave: String(f.clave),
    canal: String(f.canal ?? f.intermediario ?? 'Plataforma'),
    estado: estadoDe(f.estado),
    frase: String(f.frase ?? ''),
    accion: accionDe(f.accion),
    cuando: s(f.cuando),
    sinLocal: f.sin_local === true,
    tiendas: ((f.tiendas ?? []) as J[]).map((t) => ({ id: String(t.id), nombre: String(t.nombre ?? ''), localId: s(t.local_id) })),
    diferencia: f.diferencia === null || f.diferencia === undefined ? null : Number(f.diferencia),
    comparado: f.comparado ? (() => {
      const c = f.comparado as J
      return { vendido: n(c.vendido), liquidacion: n(c.liquidacion), pedidosNuestros: c.pedidos_nuestros == null ? null : n(c.pedidos_nuestros),
        pedidosLiquidacion: c.pedidos_liquidacion == null ? null : n(c.pedidos_liquidacion), promociones: n(c.promociones_local) }
    })() : null,
    motor: filaMotor({ ...f, estado: f.estado_motor ?? f.estado }),
  }))
  const cedidas = ((x.cedidas ?? []) as J[]).map((c): CedidaMes => {
    const v = (c.vendido ?? {}) as J; const l = c.liquidacion as J | null
    return {
      socio: String(c.socio ?? 'Socio'), socioId: s(c.socio_id), local: s(c.local), localId: s(c.local_id),
      marcas: ((c.marcas ?? []) as unknown[]).map(String), vendido: { total: n(v.total), pedidos: n(v.pedidos) },
      estado: estadoDe(c.estado), frase: String(c.frase ?? ''), cuando: s(c.cuando),
      liquidacion: l ? { id: String(l.id), total: l.importe === null || l.importe === undefined ? null : Number(l.importe) } : null,
    }
  })
  return {
    mes: String(x.mes ?? x.desde).slice(0, 10), desde: String(x.desde).slice(0, 10), hasta: String(x.hasta).slice(0, 10),
    resumen: { total: n(r.total), completa: n(r.completa), aunNoToca: n(r.aun_no_toca), teNecesita: n(r.te_necesita), noCuadra: n(r.no_cuadra) },
    filas, cedidas,
  }
}

// ── El mes ──────────────────────────────────────────────────────────────────

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

/** «Octubre 2026». */
export function nombreMes(iso: string): string { return `${mayuscula(MESES[Number(iso.slice(5, 7)) - 1])} ${iso.slice(0, 4)}` }

/** El primer día del mes que se abre: el de hoy, o el anterior del 1 al 5 (Julio, S01q·1, punto 8). */
export function mesInicial(hoy: string): string {
  const dia = Number(hoy.slice(8, 10))
  return dia <= 5 ? moverMes(`${hoy.slice(0, 7)}-01`, -1) : `${hoy.slice(0, 7)}-01`
}

/** El primer día del mes, n meses más allá (o más acá). */
export function moverMes(mes: string, n: number): string {
  const y = Number(mes.slice(0, 4)); const m = Number(mes.slice(5, 7)) - 1 + n
  const d = new Date(Date.UTC(y, m, 1))
  return d.toISOString().slice(0, 10)
}

/** «1–15 oct» · «28 sep–4 oct». */
export function periodoCorto(desde: string, hasta: string): string {
  const d = Number(desde.slice(8, 10)); const h = Number(hasta.slice(8, 10))
  const md = MESES_CORTO[Number(desde.slice(5, 7)) - 1]; const mh = MESES_CORTO[Number(hasta.slice(5, 7)) - 1]
  if (desde === hasta) return `${d} ${md}`
  return md === mh ? `${d}–${h} ${mh}` : `${d} ${md}–${h} ${mh}`
}

/** La frase del resumen: «Octubre: 30 de 42 completas · 6 aún no toca · 6 te necesitan». */
export function fraseResumen(mes: string, r: Resumen): string {
  const nombre = mayuscula(MESES[Number(mes.slice(5, 7)) - 1])
  if (r.total === 0) return `${nombre}: aún no hay ningún periodo`
  if (r.completa === r.total) return `${nombre}: completo · ${r.total} de ${r.total} ${r.total === 1 ? 'periodo' : 'periodos'} con sus cuatro piezas`
  const partes = [`${r.completa} de ${r.total} ${r.completa === 1 ? 'completa' : 'completas'}`]
  if (r.aunNoToca) partes.push(`${r.aunNoToca} aún no toca`)
  if (r.teNecesita) partes.push(`${r.teNecesita} ${r.teNecesita === 1 ? 'te necesita' : 'te necesitan'}`)
  if (r.noCuadra) partes.push(`${r.noCuadra} no ${r.noCuadra === 1 ? 'cuadra' : 'cuadran'}`)
  return `${nombre}: ${partes.join(' · ')}`
}

/** Cuántos de cada estado, para la barra. */
export function barra(r: Resumen): { estado: EstadoMes; n: number }[] {
  return [{ estado: 'completa' as const, n: r.completa }, { estado: 'aun_no_toca' as const, n: r.aunNoToca },
    { estado: 'te_necesita' as const, n: r.teNecesita }, { estado: 'no_cuadra' as const, n: r.noCuadra }].filter((x) => x.n > 0)
}

// ── Las cuatro piezas ───────────────────────────────────────────────────────

export type TonoPieza = 'si' | 'no' | 'mal' | ''
export interface Pieza { nombre: 'Vendido' | 'Liquidación' | 'Factura' | 'Cobro'; valor: string; tono: TonoPieza; explicacion: string }

/** Las cuatro piezas de un periodo: ✓ está · falta · ? (no sé de qué local) · — aún no toca. */
export function piezas(f: FilaMes): Pieza[] {
  const m = f.motor
  const llegoLiquidacion = m.liquidacion.n > 0
  const vendido: Pieza = f.sinLocal
    ? { nombre: 'Vendido', valor: '?', tono: 'no', explicacion: 'No sé de qué local es esta tienda: no puedo mirar lo que vendiste.' }
    : (m.vendido.total ?? 0) > 0 || (m.vendido.pedidos ?? 0) > 0
      ? { nombre: 'Vendido', valor: '✓', tono: 'si', explicacion: 'Tus pedidos de este periodo.' }
      : { nombre: 'Vendido', valor: '—', tono: '', explicacion: 'No hay pedidos tuyos en este periodo.' }
  const liquidacion: Pieza = llegoLiquidacion
    ? { nombre: 'Liquidación', valor: '✓', tono: f.estado === 'no_cuadra' ? 'mal' : 'si', explicacion: 'Ha llegado su liquidación.' }
    : f.estado === 'te_necesita' && m.estado === 'falta_liquidacion'
      ? { nombre: 'Liquidación', valor: 'falta', tono: 'no', explicacion: 'Ya tendría que haber llegado.' }
      : { nombre: 'Liquidación', valor: '—', tono: '', explicacion: 'Aún no toca.' }
  const factura: Pieza = !llegoLiquidacion
    ? (f.estado === 'te_necesita' && m.estado === 'falta_liquidacion'
      ? { nombre: 'Factura', valor: 'falta', tono: 'no', explicacion: 'Llega con su liquidación.' }
      : { nombre: 'Factura', valor: '—', tono: '', explicacion: 'Aún no toca.' })
    : m.faltanFacturas > 0
      ? (f.estado === 'te_necesita'
        ? { nombre: 'Factura', valor: 'falta', tono: 'no', explicacion: 'Falta su factura de comisión.' }
        : { nombre: 'Factura', valor: '—', tono: '', explicacion: 'Aún no toca.' })
      : { nombre: 'Factura', valor: '✓', tono: 'si', explicacion: 'Su factura de comisión está.' }
  const cobro: Pieza = m.cobro.llegado !== null && m.cobro.porCobrar === 0
    ? { nombre: 'Cobro', valor: '✓', tono: 'si', explicacion: 'El cobro ha llegado a tu banco.' }
    // Una liquidación que te paga 0 (la comisión se come lo vendido, medido en Just Eat en octubre): no hay nada que cobrar, y está.
    : llegoLiquidacion && m.cobro.porCobrar === 0 && (m.cobro.esperado ?? 0) === 0
      ? { nombre: 'Cobro', valor: '✓', tono: 'si', explicacion: 'Esta liquidación no te paga nada: no hay cobro que esperar.' }
    : f.estado === 'te_necesita' && m.estado === 'esperando_cobro'
      ? { nombre: 'Cobro', valor: 'falta', tono: 'no', explicacion: 'El cobro ya tendría que haber llegado.' }
      : { nombre: 'Cobro', valor: '—', tono: '', explicacion: 'Aún no toca.' }
  return [vendido, liquidacion, factura, cobro]
}

/** Lo que te pagan en el periodo, o «—» si aún no ha llegado su liquidación. */
export function importe(f: FilaMes): number | null {
  return f.motor.liquidacion.n > 0 ? f.motor.liquidacion.pagan : null
}

// ── Grupos: plataforma › tienda › periodos ──────────────────────────────────

export interface Filtros { plataforma: string | null; local: string | null; soloTeNecesita: boolean }
export const SIN_LOCAL = '__sin_local__'

export interface GrupoTienda { clave: string; nombre: string; marcaLocal: string; sinLocal: boolean; filas: FilaMes[] }
export interface GrupoPlataforma { canal: string; tiendas: GrupoTienda[]; filas: FilaMes[] }

const ORDEN: Record<EstadoMes, number> = { no_cuadra: 0, te_necesita: 1, aun_no_toca: 2, completa: 3 }
/** Primero lo que te necesita: el peor estado de sus filas. */
const peor = (fs: readonly FilaMes[]) => Math.min(...fs.map((f) => ORDEN[f.estado]))

/** El nombre de la tienda tal como lo pone la plataforma (sin la dirección entre paréntesis si ya va en el nombre). */
export function nombreTienda(f: FilaMes): string {
  const t = f.tiendas[0]?.nombre
  if (t) return t.replace(/\s*\(([^)]*)\)\s*$/, (m0, dentro: string) => (t.slice(0, t.length - m0.length).includes(dentro) ? '' : m0))
  return [f.motor.marca, f.motor.local].filter(Boolean).join(' · ') || f.canal
}

/** «Meraki Pita · Carabanchel» · «Sin marca · Tienda sin local». */
export function marcaLocal(f: FilaMes): string {
  const local = f.sinLocal ? 'Tienda sin local' : (f.motor.local ?? 'Todos los locales').replace(/^Foodint\s+/i, '')
  return `${f.motor.marca ?? 'Sin marca'} · ${local}`
}

/** Agrupa las filas por plataforma y tienda, con los filtros y primero lo que te necesita. */
export function agrupar(filas: readonly FilaMes[], filtros: Filtros): GrupoPlataforma[] {
  const vistas = filas.filter((f) =>
    (!filtros.plataforma || f.canal === filtros.plataforma)
    && (!filtros.local || (filtros.local === SIN_LOCAL ? f.sinLocal : f.motor.localId === filtros.local && !f.sinLocal))
    && (!filtros.soloTeNecesita || f.estado === 'te_necesita' || f.estado === 'no_cuadra'))
  const porCanal = new Map<string, Map<string, GrupoTienda>>()
  for (const f of vistas) {
    const tiendas = porCanal.get(f.canal) ?? new Map<string, GrupoTienda>()
    porCanal.set(f.canal, tiendas)
    const clave = f.tiendas[0]?.id ?? `${f.motor.marcaId ?? '-'}:${f.motor.localId ?? '-'}`
    const g = tiendas.get(clave) ?? { clave, nombre: nombreTienda(f), marcaLocal: marcaLocal(f), sinLocal: f.sinLocal, filas: [] }
    g.filas.push(f)
    tiendas.set(clave, g)
  }
  const out: GrupoPlataforma[] = []
  for (const [canal, tiendas] of porCanal) {
    const ts = [...tiendas.values()]
    for (const t of ts) t.filas.sort((a, b) => a.motor.desde.localeCompare(b.motor.desde))
    ts.sort((a, b) => peor(a.filas) - peor(b.filas) || a.nombre.localeCompare(b.nombre, 'es'))
    out.push({ canal, tiendas: ts, filas: ts.flatMap((t) => t.filas) })
  }
  return out.sort((a, b) => peor(a.filas) - peor(b.filas) || a.canal.localeCompare(b.canal, 'es'))
}

/** «2 de 2» · «1 completa · 1 aún no toca» · «0 de 4 · 4 te necesitan» (la tienda); «18 de 18 completas» (la plataforma). */
export function cuenta(filas: readonly FilaMes[], deGrupo = false): string {
  const c = { completa: 0, aun_no_toca: 0, te_necesita: 0, no_cuadra: 0 } as Record<EstadoMes, number>
  for (const f of filas) c[f.estado]++
  const total = filas.length
  if (c.completa === total) return deGrupo ? `${total} de ${total} ${total === 1 ? 'completa' : 'completas'}` : `${total} de ${total}`
  const resto: string[] = []
  if (c.aun_no_toca) resto.push(`${c.aun_no_toca} aún no toca`)
  if (c.te_necesita) resto.push(`${c.te_necesita} ${c.te_necesita === 1 ? 'te necesita' : 'te necesitan'}`)
  if (c.no_cuadra) resto.push(`${c.no_cuadra} no ${c.no_cuadra === 1 ? 'cuadra' : 'cuadran'}`)
  const primero = c.completa === 0 && !deGrupo ? `0 de ${total}` : c.completa > 0 ? `${c.completa} ${c.completa === 1 ? 'completa' : 'completas'}` : null
  return [primero, ...resto].filter(Boolean).join(' · ')
}

/** Las plataformas y los locales que hay en el mes, para los filtros. */
export function opciones(filas: readonly FilaMes[]): { plataformas: string[]; locales: { id: string; nombre: string }[]; haySinLocal: boolean } {
  const plataformas = [...new Set(filas.map((f) => f.canal))].sort((a, b) => a.localeCompare(b, 'es'))
  const locales = new Map<string, string>()
  for (const f of filas) if (f.motor.localId && f.motor.local && !f.sinLocal) locales.set(f.motor.localId, f.motor.local.replace(/^Foodint\s+/i, ''))
  return {
    plataformas,
    locales: [...locales.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    haySinLocal: filas.some((f) => f.sinLocal),
  }
}

// ── El Excel ────────────────────────────────────────────────────────────────

/** Una fila del Excel por periodo, con las mismas cifras que la pantalla. */
export function filasExcel(m: MesLiquidaciones): (string | number | null)[][] {
  const cab = ['Plataforma', 'Tienda', 'Marca', 'Local', 'Desde', 'Hasta', 'Estado', 'Vendido', 'Liquidación', 'Factura', 'Cobro', 'Lo que te pagan (€)', 'Qué pasa']
  const filas = m.filas.map((f) => {
    const p = piezas(f)
    return [f.canal, nombreTienda(f), f.motor.marca ?? '', f.sinLocal ? 'Tienda sin local' : (f.motor.local ?? ''), f.motor.desde, f.motor.hasta,
      NOMBRE_ESTADO[f.estado], p[0].valor, p[1].valor, p[2].valor, p[3].valor, importe(f), f.frase]
  })
  const cedidas = m.cedidas.map((c) => ['Marcas cedidas', c.socio, c.marcas.join(', '), c.local ?? '', m.desde, m.hasta,
    NOMBRE_ESTADO[c.estado], c.vendido.total > 0 ? '✓' : '—', c.liquidacion ? '✓' : '—', '', '', c.liquidacion?.total ?? null, c.frase])
  return [cab, ...filas, ...cedidas]
}
