// src/modules/conta/lib/diario.ts
//
// C04 · Tarea 4. Lo que las pantallas del libro (N11 Libro diario, N12 Asiento)
// deciden sin tocar la base: los filtros por origen, el estado que se pinta,
// las cuatro cifras de arriba, «Lo que he hecho yo» y el «Cierre del mes».
// Núcleo puro, con pruebas en tests/unit/modules/conta/diarioC04.test.ts.
//
// Regla 7 de CLAUDE.md: un filtro ordena y etiqueta, nunca esconde. Los
// filtros de origen solo aparecen si la empresa tiene asientos de ese origen
// (una ferretería no ve «Plataformas»), pero «Todos» enseña siempre todo,
// también lo anulado, y cada filtro dice cuántos tiene.

import { euros } from '@/modules/conta/lib/formato'
import { NOMBRE_SERIE, cuadre, red2, type Confianza, type OrigenAsiento, type Razon, type Serie } from '@/modules/conta/lib/libro'

export type EstadoAsiento = 'propuesto' | 'borrador' | 'validado' | 'anulado'

export interface ApunteDiario {
  posicion: number
  cuentaId: string
  cuenta: string
  nombreCuenta: string
  debe: number
  haber: number
  concepto: string | null
  localId: string | null
  local: string | null
  comun: boolean
  marcaId: string | null
  marca: string | null
  cedida: boolean
  documento: string | null
  iva: { tipoId: string; base: number; libro: string; tipo: number | null } | null
  retencion: { base: number; modelo: string } | null
}

export interface AsientoDiario {
  id: string
  serie: Serie
  numero: number | null
  fecha: string
  concepto: string
  origen: OrigenAsiento
  origenId: string | null
  estado: EstadoAsiento
  confianza: Confianza | null
  porque: string | null
  razones: Razon[]
  documento: string | null
  terceroId: string | null
  creadoPor: string | null
  creadoEn: string
  validadoPor: string | null
  validadoEn: string | null
  anuladoPor: string | null
  anuladoEn: string | null
  motivoAnulacion: string | null
  anuladoCon: string | null
  anulaA: string | null
  traido: { programa: string; serie: string | null; numero: string | null } | null
  huella: string | null
  huellaAnterior: string | null
  cadena: number | null
  apuntes: ApunteDiario[]
}

// ── Filtros por origen ──────────────────────────────────────────────────────

export type FiltroDiario = 'todos' | 'revisar' | 'ventas' | 'compras' | 'plataformas' | 'socios' | 'banco' | 'nominas' | 'manuales' | 'traidos' | 'anulados'

const ORIGENES: Record<Exclude<FiltroDiario, 'todos' | 'revisar' | 'anulados'>, readonly OrigenAsiento[]> = {
  ventas: ['sales_day', 'sales_adjustment'],
  compras: ['supplier_invoice', 'supplier_payment'],
  plataformas: ['channel_settlement'],
  socios: ['licensed_settlement'],
  banco: ['bank'],
  nominas: ['payroll'],
  manuales: ['manual', 'template', 'opening', 'closing', 'vat_settlement'],
  traidos: ['migrated'],
}

export const FILTROS_DIARIO: readonly { id: FiltroDiario; texto: string }[] = [
  { id: 'todos', texto: 'Todos' },
  { id: 'revisar', texto: 'Para revisar' },
  { id: 'ventas', texto: 'Ventas' },
  { id: 'compras', texto: 'Compras' },
  { id: 'plataformas', texto: 'Plataformas' },
  { id: 'socios', texto: 'Socios de marca' },
  { id: 'banco', texto: 'Banco' },
  { id: 'nominas', texto: 'Nóminas' },
  { id: 'manuales', texto: 'Manuales' },
  { id: 'traidos', texto: 'Traídos' },
  { id: 'anulados', texto: 'Anulados' },
]

/** El contraasiento va con el origen del asiento que anula (si se filtra «Compras», salen los dos). */
function origenEfectivo(a: AsientoDiario, porId: Map<string, AsientoDiario>): OrigenAsiento {
  if (a.origen === 'reversal' && a.anulaA) return porId.get(a.anulaA)?.origen ?? 'manual'
  return a.origen
}

export function cumple(a: AsientoDiario, f: FiltroDiario, porId: Map<string, AsientoDiario>): boolean {
  if (f === 'todos') return true
  if (f === 'revisar') return a.estado === 'propuesto' || a.estado === 'borrador'
  if (f === 'anulados') return a.estado === 'anulado' || a.origen === 'reversal'
  return ORIGENES[f].includes(origenEfectivo(a, porId))
}

/** Los filtros que se enseñan: Todos y Para revisar siempre; los de origen, solo si hay asientos de ese origen. */
export function filtrosVisibles(asientos: readonly AsientoDiario[]): { id: FiltroDiario; texto: string; n: number }[] {
  const porId = new Map(asientos.map((a) => [a.id, a]))
  return FILTROS_DIARIO
    .map((f) => ({ ...f, n: asientos.filter((a) => cumple(a, f.id, porId)).length }))
    .filter((f) => f.id === 'todos' || f.id === 'revisar' || f.n > 0)
}

/** Lo que se ve con un filtro: lo propuesto primero (es lo que espera), luego por fecha y número, lo último arriba. */
export function filtrar(asientos: readonly AsientoDiario[], f: FiltroDiario): AsientoDiario[] {
  const porId = new Map(asientos.map((a) => [a.id, a]))
  return asientos.filter((a) => cumple(a, f, porId)).sort((x, y) => {
    const px = x.estado === 'propuesto' || x.estado === 'borrador' ? 0 : 1
    const py = y.estado === 'propuesto' || y.estado === 'borrador' ? 0 : 1
    if (px !== py) return px - py
    if (x.fecha !== y.fecha) return y.fecha.localeCompare(x.fecha)
    return (y.numero ?? 0) - (x.numero ?? 0) || y.creadoEn.localeCompare(x.creadoEn)
  })
}

// ── Estado, importe y lo que se dice en la fila ─────────────────────────────

export type TonoEstado = 'ambar' | 'verde' | 'azul' | 'neutro' | 'gris'

/** ¿Lo validó Folvy solo? (la opción de la empresa para los Seguros de ventas del día) */
export const hechoPorFolvy = (a: Pick<AsientoDiario, 'validadoPor'>): boolean => (a.validadoPor ?? '').startsWith('Folvy')

export function estadoDe(a: AsientoDiario): { texto: string; tono: TonoEstado } {
  if (a.estado === 'propuesto') return { texto: 'Para revisar', tono: 'ambar' }
  if (a.estado === 'borrador') return { texto: 'Borrador', tono: 'neutro' }
  if (a.estado === 'anulado') return { texto: 'Anulado', tono: 'gris' }
  if (a.origen === 'reversal') return { texto: 'Contraasiento', tono: 'gris' }
  if (a.origen === 'migrated') return { texto: 'Traído', tono: 'neutro' }
  if (hechoPorFolvy(a)) return { texto: 'Hecho por Folvy', tono: 'verde' }
  return { texto: 'Validado', tono: 'azul' }
}

/** El importe del asiento: lo que suma su Debe. */
export const importe = (a: Pick<AsientoDiario, 'apuntes'>): number => red2(a.apuntes.reduce((s, l) => s + l.debe, 0))

/** El número que se enseña: serie por su palabra y número (el código, solo en Detalle contable). */
export function numeroVisible(a: Pick<AsientoDiario, 'numero' | 'serie'>): string {
  return a.numero === null ? '—' : a.numero.toLocaleString('es-ES')
}
export const nombreSerie = (s: Serie): string => NOMBRE_SERIE[s]

/** Las pastillas de la fila: el local (o «N locales», o «Común») y la marca (propias o la cedida, dicha). */
export function pastillas(a: Pick<AsientoDiario, 'apuntes'>): { texto: string; tono: 'azul' | 'neutro' | 'ambar' }[] {
  const locales = new Map<string, string>()
  let comun = false
  for (const l of a.apuntes) {
    if (l.comun) comun = true
    else if (l.localId) locales.set(l.localId, l.local ?? 'local')
  }
  const r: { texto: string; tono: 'azul' | 'neutro' | 'ambar' }[] = []
  if (locales.size === 1) r.push({ texto: [...locales.values()][0], tono: 'azul' })
  else if (locales.size > 1) r.push({ texto: `${locales.size} locales`, tono: 'azul' })
  if (comun) r.push({ texto: 'Común', tono: 'azul' })
  const cedidas = new Map<string, string>()
  let propias = false
  for (const l of a.apuntes) {
    if (!l.marcaId) continue
    if (l.cedida) cedidas.set(l.marcaId, l.marca ?? 'marca')
    else propias = true
  }
  if (propias) r.push({ texto: 'Marcas propias', tono: 'neutro' })
  for (const m of cedidas.values()) r.push({ texto: `${m} · cedida`, tono: 'ambar' })
  return r
}

const ORIGEN_TEXTO: Record<OrigenAsiento, string> = {
  sales_day: 'Resumen de ventas del día', sales_adjustment: 'Lo que decidió la plataforma', supplier_invoice: 'Factura de proveedor',
  supplier_payment: 'Pago a proveedor', channel_settlement: 'Liquidación de la plataforma', licensed_settlement: 'Liquidación del socio de marca',
  payroll: 'Resumen de nóminas', bank: 'Movimiento del banco', vat_settlement: 'Liquidación del IVA', manual: 'A mano', template: 'Predefinido',
  reversal: 'Contraasiento', opening: 'Apertura', closing: 'Cierre', migrated: 'Traído',
}

/** De dónde sale, en palabras. */
export function deDondeSale(a: AsientoDiario): string {
  if (a.traido) return `Traído de ${a.traido.programa}${a.traido.serie ? ` · serie ${a.traido.serie}` : ''}${a.traido.numero ? ` nº ${a.traido.numero}` : ''}`
  const base = ORIGEN_TEXTO[a.origen]
  if (a.origen === 'manual') return a.creadoPor ? `A mano · ${a.creadoPor}` : base
  return a.documento ? `${base} · ${a.documento}` : base
}

// ── Las cuatro cifras ───────────────────────────────────────────────────────

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const nombreMes = (mes: string): string => MESES[Number(mes.slice(5, 7)) - 1]
export const mesDe = (fecha: string): string => `${fecha.slice(0, 7)}-01`
/** El mes anterior, 'YYYY-MM-01'. */
export function mesAnterior(mes: string): string {
  const y = Number(mes.slice(0, 4)); const m = Number(mes.slice(5, 7))
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
}
export function finDeMes(mes: string): string {
  const y = Number(mes.slice(0, 4)); const m = Number(mes.slice(5, 7))
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

export interface CierreMes { mes: string; tipo: 'manual' | 'tax_filed' | 'migrated'; quien: string | null }

export type EstadoMes = { cerrado: false; texto: string; apoyo: string } | { cerrado: true; tipo: CierreMes['tipo']; texto: string; apoyo: string }

/** El estado de un mes: abierto (y hasta dónde está cerrado lo anterior) o cerrado y por qué. */
export function estadoMes(mes: string, cierres: readonly CierreMes[]): EstadoMes {
  const este = cierres.find((c) => c.mes === mes)
  if (este) {
    const apoyo = este.tipo === 'migrated' ? 'traído de otro programa: no se toca aquí'
      : este.tipo === 'tax_filed' ? 'su impuesto está presentado'
        : `cerrado${este.quien ? ` por ${este.quien}` : ''}`
    return { cerrado: true, tipo: este.tipo, texto: este.tipo === 'migrated' ? 'Traído' : 'Cerrado', apoyo }
  }
  const anteriores = cierres.filter((c) => c.mes < mes).map((c) => c.mes).sort()
  const ultimo = anteriores[anteriores.length - 1]
  return { cerrado: false, texto: 'Abierto', apoyo: ultimo ? `${nombreMes(ultimo)} cerrado` : 'ningún mes anterior cerrado' }
}

export interface Cifras {
  asientosMes: number
  apoyoAsientos: string
  revisar: number
  apoyoRevisar: string
  mes: EstadoMes
  resultado: number | null
  apoyoResultado: string
}

/**
 * Las cuatro de N11: asientos del mes (validados y anulados: los dos están en
 * el libro), lo que espera revisión (de cualquier mes: un filtro no esconde),
 * el estado del mes y su resultado por local.
 */
export function cifras(asientos: readonly AsientoDiario[], mes: string, cierres: readonly CierreMes[],
  resultado: { total: number; porLocal: { nombre: string; resultado: number }[] } | null): Cifras {
  const delMes = asientos.filter((a) => mesDe(a.fecha) === mes && (a.estado === 'validado' || a.estado === 'anulado'))
  const revisar = asientos.filter((a) => a.estado === 'propuesto' || a.estado === 'borrador')
  const propuestosFolvy = revisar.filter((a) => a.estado === 'propuesto').length
  const porOrigen = new Map<string, number>()
  for (const a of delMes) porOrigen.set(a.origen, (porOrigen.get(a.origen) ?? 0) + 1)
  const partes: string[] = []
  const ventas = porOrigen.get('sales_day') ?? 0
  const facturas = porOrigen.get('supplier_invoice') ?? 0
  const liqs = (porOrigen.get('channel_settlement') ?? 0) + (porOrigen.get('licensed_settlement') ?? 0)
  if (ventas) partes.push(`${ventas} de ventas del día`)
  if (facturas) partes.push(`${facturas} ${facturas === 1 ? 'factura' : 'facturas'}`)
  if (liqs) partes.push(`${liqs} ${liqs === 1 ? 'liquidación' : 'liquidaciones'}`)
  const resto = delMes.length - ventas - facturas - liqs
  if (resto > 0 && partes.length) partes.push(`${resto} más`)
  return {
    asientosMes: delMes.length,
    apoyoAsientos: delMes.length === 0 ? 'aún no hay ninguno en el libro' : partes.length ? partes.join(' · ') : 'en el libro',
    revisar: revisar.length,
    apoyoRevisar: revisar.length === 0 ? 'nada esperando' : propuestosFolvy === revisar.length ? 'propuestos por Folvy'
      : `${propuestosFolvy} propuestos por Folvy · ${revisar.length - propuestosFolvy} borradores`,
    mes: estadoMes(mes, cierres),
    resultado: resultado ? red2(resultado.total) : null,
    apoyoResultado: !resultado ? 'sin datos' : resultado.porLocal.length === 0 ? 'aún sin ingresos ni gastos'
      : resultado.porLocal.map((l) => `${l.nombre} ${l.resultado >= 0 ? '+' : '−'}${euros(Math.round(Math.abs(l.resultado))).replace(' €', '')}`).join(' · '),
  }
}

// ── «Lo que he hecho yo» ────────────────────────────────────────────────────

export interface HechoYo { asientoId: string; titulo: string; apoyo: string; deshacer: boolean }

/** Lo que hizo Folvy: lo que validó solo (con Deshacer, que lo anula) y lo que dejó para revisar (con su porqué). */
export function loQueHeHechoYo(asientos: readonly AsientoDiario[], max = 5): HechoYo[] {
  const hechos = asientos
    .filter((a) => (a.estado === 'validado' && hechoPorFolvy(a) && a.origen !== 'reversal') || a.estado === 'propuesto')
    .sort((x, y) => (y.validadoEn ?? y.creadoEn).localeCompare(x.validadoEn ?? x.creadoEn))
  return hechos.slice(0, max).map((a) => a.estado === 'validado'
    ? { asientoId: a.id, titulo: `Asenté «${a.concepto}»`, apoyo: a.porque ?? 'Seguro: cuadraba con sus pedidos.', deshacer: true }
    : { asientoId: a.id, titulo: `Dejé «${a.concepto}» para revisar`, apoyo: a.porque ?? '', deshacer: false })
}

// ── El cierre del mes ───────────────────────────────────────────────────────

export interface FuenteCierre {
  /** Días con ventas del mes (por local) y cuántos tienen asiento validado. */
  diasVenta: { total: number; asentadas: number } | null
  facturas: { total: number; asentadas: number } | null
  liquidaciones: { total: number; asentadas: number } | null
  socios: { total: number; asentadas: number } | null
  nominas: { total: number; asentadas: number } | null
  /** Propuestas o borradores del mes sin validar. */
  pendientes: number
  cerrado: boolean
}

export interface PasoCierre { texto: string; hecho: boolean }

/**
 * La lista de N11 («Cierre de septiembre»). Solo sale lo que la empresa tiene
 * (sin plataformas no hay paso de plataformas), y un paso con 0 de 0 no sale:
 * no hay nada que asentar, no es que esté hecho. Cada paso dice sus números.
 */
export function pasosCierre(f: FuenteCierre): PasoCierre[] {
  const r: PasoCierre[] = []
  const paso = (x: { total: number; asentadas: number } | null, nombre: string) => {
    if (!x || x.total === 0) return
    r.push({ texto: `${nombre}: ${x.asentadas} de ${x.total}`, hecho: x.asentadas >= x.total })
  }
  paso(f.diasVenta, 'Días de ventas asentados')
  paso(f.facturas, 'Facturas de proveedor')
  paso(f.liquidaciones, 'Liquidaciones de plataformas')
  paso(f.socios, 'Liquidaciones del socio de marca')
  paso(f.nominas, 'Nóminas')
  r.push({ texto: f.pendientes === 0 ? 'Nada esperando revisión' : `${f.pendientes} ${f.pendientes === 1 ? 'asiento espera' : 'asientos esperan'} revisión`, hecho: f.pendientes === 0 })
  r.push({ texto: f.cerrado ? 'Mes cerrado' : 'Cerrar el mes', hecho: f.cerrado })
  return r
}

/** ¿Se puede cerrar? Todo lo anterior hecho. Si no, qué falta (en una frase). */
export function sePuedeCerrar(pasos: readonly PasoCierre[]): { puede: boolean; falta: string | null } {
  const faltan = pasos.slice(0, -1).filter((p) => !p.hecho)
  return faltan.length === 0 ? { puede: true, falta: null } : { puede: false, falta: `Falta: ${faltan.map((p) => p.texto.toLowerCase()).join('; ')}.` }
}

// ── El asiento a mano ───────────────────────────────────────────────────────

export interface LineaMano { cuenta: string; debe: string; haber: string; localId: string | null; comun: boolean; concepto: string }

const numero = (t: string): number => {
  const limpio = t.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  const n = Number(limpio)
  return Number.isFinite(n) ? n : NaN
}

/** Lo que falta para poder guardar un asiento a mano, en frases; vacío = se puede. */
export function problemasMano(concepto: string, fecha: string, lineas: readonly LineaMano[], cuentas: ReadonlySet<string>): string[] {
  const r: string[] = []
  if (!concepto.trim()) r.push('Ponle un concepto.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) r.push('Pon la fecha.')
  const usadas = lineas.filter((l) => l.cuenta.trim() || l.debe.trim() || l.haber.trim())
  if (usadas.length < 2) r.push('Un asiento tiene al menos dos apuntes.')
  usadas.forEach((l, i) => {
    const d = l.debe.trim() ? numero(l.debe) : 0
    const h = l.haber.trim() ? numero(l.haber) : 0
    const n = `Apunte ${i + 1}`
    if (!l.cuenta.trim()) r.push(`${n}: elige la cuenta.`)
    else if (!cuentas.has(l.cuenta.trim())) r.push(`${n}: la ${l.cuenta.trim()} no es una cuenta de apunte de tu plan.`)
    if (Number.isNaN(d) || Number.isNaN(h)) r.push(`${n}: el importe no es un número.`)
    else if ((d > 0) === (h > 0)) r.push(`${n}: va al Debe o al Haber, uno de los dos.`)
    else if (d < 0 || h < 0) r.push(`${n}: sin importes negativos; cámbialo de lado.`)
    if (!l.comun && !l.localId) r.push(`${n}: elige el local, o márcalo como común.`)
  })
  const c = cuadreMano(lineas)
  if (usadas.length >= 2 && !c.cuadra) r.push(c.texto)
  return r
}

export function cuadreMano(lineas: readonly LineaMano[]) {
  return cuadre(lineas.map((l) => ({ debe: l.debe.trim() ? numero(l.debe) || 0 : 0, haber: l.haber.trim() ? numero(l.haber) || 0 : 0 })))
}

export const importeMano = (t: string): number => (t.trim() ? numero(t) : 0)
