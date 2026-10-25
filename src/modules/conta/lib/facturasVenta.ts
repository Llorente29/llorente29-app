// src/modules/conta/lib/facturasVenta.ts
//
// V01 · Entrega 1 · Ventas › Facturas: lo que decide la lista y la ficha sin
// React (regla react-refresh: los componentes solo exportan componentes).
//
//   · Una sola lista con todas las de venta: las de Sumied (customer_invoice:
//     a mano y rectificativas) y las que ya estaban en el libro de expedidas
//     (los resúmenes del cierre del día y las traídas de Diez), que no se
//     duplican: lo de Sumied se lee de su factura, no de su anotación.
//   · El estado de cobro lo calcula la base, en UN sitio (PC01: la vista
//     conta_factura_cobro): Cobrada, Cobrada en parte, Vencida, Esperando
//     liquidación (la de una plataforma, hasta su día de pago más el margen),
//     Falta su liquidación (la de una plataforma, pasado ese día y sin ninguna
//     liquidación: ámbar, no Vencida; Julio, 25/10), Vence esta semana y Por
//     cobrar (aquí, Emitida o Enviada). Aquí solo se
//     traduce; lo guardado da Borrador y Anulada. Sin estado de la base (las del
//     libro), como antes.
//   · Pestañas que suman «Todas» (regla 7): las de Sumied por su estado; las
//     del libro, que no llevan su cobro aquí (lo lleva Bancos o su
//     liquidación), en su propia pestaña, «Del libro», solo si las hay.
//   · Las cifras de arriba: Por cobrar (sin las vencidas), Vencido, Falta su
//     liquidación (aparte: no suma en Vencido), Cobrado en el mes y Borradores.
//   · Las cuentas de una factura (líneas, IVA por tipo, recargo, retención),
//     igual que las hace la base (_conta_venta_cifras): redondeo por tipo.

import { leerOrden, ordenar, pestanasConTodas, type PestanaEstado, type Sentido } from '@/modules/conta/diseno/plantillas/lista'

export type OrigenFactura = 'a_mano' | 'recurrente' | 'presupuesto' | 'cierre_dia' | 'tienda' | 'automatica' | 'traida'
export const NOMBRE_ORIGEN: Record<OrigenFactura, string> = {
  a_mano: 'A mano', recurrente: 'Recurrente', presupuesto: 'De presupuesto', cierre_dia: 'Cierre del día',
  tienda: 'Tienda online', automatica: 'Automática', traida: 'Traída de Diez',
}
export const TONO_ORIGEN: Record<OrigenFactura, 'propuesto' | 'duda' | 'seguro' | 'neutro' | 'falta'> = {
  a_mano: 'propuesto', recurrente: 'neutro', presupuesto: 'seguro', cierre_dia: 'duda', tienda: 'neutro', automatica: 'neutro', traida: 'neutro',
}

export type EstadoFactura = 'borrador' | 'emitida' | 'enviada' | 'cobrada_parte' | 'cobrada' | 'vencida' | 'esperando_liquidacion' | 'falta_liquidacion' | 'vence_semana' | 'anulada'
/** PC01 · El estado de cobro que calcula la base (conta_factura_cobro). */
export type EstadoCobroBase = 'borrador' | 'anulada' | 'emitida' | 'cobrada' | 'vencida' | 'cobrada_parte' | 'esperando_liquidacion' | 'falta_liquidacion' | 'vence_semana' | 'por_cobrar'
export const NOMBRE_ESTADO: Record<EstadoFactura, { texto: string; tono: 'neutro' | 'propuesto' | 'duda' | 'seguro' | 'falta' }> = {
  borrador: { texto: 'Borrador', tono: 'neutro' },
  emitida: { texto: 'Emitida', tono: 'propuesto' },
  enviada: { texto: 'Enviada', tono: 'propuesto' },
  cobrada_parte: { texto: 'Cobrada en parte', tono: 'duda' },
  cobrada: { texto: 'Cobrada', tono: 'seguro' },
  vencida: { texto: 'Vencida', tono: 'falta' },
  esperando_liquidacion: { texto: 'Esperando liquidación', tono: 'propuesto' },
  falta_liquidacion: { texto: 'Falta su liquidación', tono: 'duda' },
  vence_semana: { texto: 'Vence esta semana', tono: 'duda' },
  anulada: { texto: 'Anulada', tono: 'neutro' },
}

/**
 * El envío a Diez de su asiento: enviada (✓ Diez), en cola, con error,
 * apagado, en el traspaso del mes (V01c: la empresa traspasa una vez al mes y
 * aún no ha ido) o nada (borrador).
 */
export type DiezFactura = 'enviada' | 'en_cola' | 'error' | 'sin_envio' | 'traspaso' | null

/**
 * V01c · El envío de una factura, del estado del envío de su asiento
 * (external_send.status) y de cómo envía la empresa. En traspaso MENSUAL nada
 * va a Diez al validar: lo que no ha llegado aún va en el traspaso de su mes,
 * nunca «En cola» (no hay cola: lo manda el traspaso, desde Contabilidad › Cierre).
 */
export function diezDeFactura(estado: string | undefined, empresa: { encendido: boolean; mensual: boolean }, emitida: boolean): DiezFactura {
  if (!emitida) return null
  if (estado === 'enviado' || estado === 'enlazado') return 'enviada'
  if (estado === 'error' || estado === 'por_aclarar') return 'error'
  if (empresa.mensual) return 'traspaso'
  if (estado) return 'en_cola'
  return empresa.encendido ? 'en_cola' : 'sin_envio'
}

/** «En el traspaso de octubre»: la misma pieza que el Libro y el asiento (lib/enDiez). */
export { textoTraspaso } from '@/modules/conta/lib/enDiez'

export interface FacturaVenta {
  id: string
  /** 'sumied': una factura de customer_invoice (su ficha). 'libro': una anotación del libro de expedidas (su asiento). */
  fuente: 'sumied' | 'libro'
  entryId: string | null
  numero: string | null
  serie: string | null
  fecha: string
  vence: string | null
  cliente: string | null
  nif: string | null
  origen: OrigenFactura
  base: number
  iva: number
  total: number
  cobrado: number
  /** Lo guardado: borrador, emitida o anulada. */
  guardado: 'borrador' | 'emitida' | 'anulada'
  enviada: boolean
  rectificativa: boolean
  localId: string | null
  diez: DiezFactura
  /** PC01 · El estado de cobro de la base (conta_factura_cobro); null en las del libro. */
  estadoCobro: EstadoCobroBase | null
}

const c = (n: number) => Math.round(n * 100)

/** Lo que queda por cobrar (en céntimos exactos). */
export const quedaPorCobrar = (f: Pick<FacturaVenta, 'total' | 'cobrado'>): number => Math.max(0, c(f.total) - c(f.cobrado)) / 100

/** El estado de una factura el día `hoy` (AAAA-MM-DD). */
export function estadoDe(f: FacturaVenta, hoy: string): EstadoFactura {
  if (f.guardado === 'borrador') return 'borrador'
  if (f.guardado === 'anulada') return 'anulada'
  // PC01: lo que dice la base manda (un solo sitio); aquí solo se traduce.
  if (f.estadoCobro && f.estadoCobro !== 'borrador' && f.estadoCobro !== 'anulada') {
    if (f.estadoCobro === 'por_cobrar' || f.estadoCobro === 'emitida') return f.enviada ? 'enviada' : 'emitida'
    return f.estadoCobro
  }
  // Una rectificativa en negativo (o una a cero) no se cobra: queda emitida.
  if (f.total <= 0) return f.enviada ? 'enviada' : 'emitida'
  const queda = quedaPorCobrar(f)
  if (queda === 0) return 'cobrada'
  if (f.vence && f.vence < hoy) return 'vencida'
  if (f.cobrado > 0) return 'cobrada_parte'
  return f.enviada ? 'enviada' : 'emitida'
}

export type IdPestanaFacturas = 'todas' | 'borradores' | 'por-cobrar' | 'falta-liquidacion' | 'vencidas' | 'cobradas' | 'anuladas' | 'emitidas' | 'del-libro'

/** En qué pestaña cae cada factura: una y solo una (regla 7). */
export function pestanaDe(f: FacturaVenta, hoy: string): Exclude<IdPestanaFacturas, 'todas'> {
  if (f.fuente === 'libro') return f.guardado === 'anulada' ? 'anuladas' : 'del-libro'
  const e = estadoDe(f, hoy)
  if (e === 'borrador') return 'borradores'
  if (e === 'anulada') return 'anuladas'
  if (e === 'vencida') return 'vencidas'
  if (e === 'falta_liquidacion') return 'falta-liquidacion'
  if (e === 'cobrada') return 'cobradas'
  if (f.total <= 0) return 'emitidas'
  return 'por-cobrar'
}

const PESTANAS: { id: Exclude<IdPestanaFacturas, 'todas'>; etiqueta: string; siempre: boolean }[] = [
  { id: 'borradores', etiqueta: 'Borradores', siempre: true },
  { id: 'por-cobrar', etiqueta: 'Por cobrar', siempre: true },
  // PC01 · Las de plataforma pasadas de plazo sin ninguna liquidación: solo si las hay.
  { id: 'falta-liquidacion', etiqueta: 'Falta su liquidación', siempre: false },
  { id: 'vencidas', etiqueta: 'Vencidas', siempre: true },
  { id: 'cobradas', etiqueta: 'Cobradas', siempre: true },
  { id: 'anuladas', etiqueta: 'Anuladas', siempre: true },
  // Las rectificativas en negativo y las del libro: su pestaña, solo si las hay (y así todas suman «Todas»).
  { id: 'emitidas', etiqueta: 'Rectificativas', siempre: false },
  { id: 'del-libro', etiqueta: 'Del libro', siempre: false },
]

export function pestanasFacturas(fs: readonly FacturaVenta[], hoy: string): PestanaEstado[] {
  const n = new Map<string, number>()
  for (const f of fs) { const p = pestanaDe(f, hoy); n.set(p, (n.get(p) ?? 0) + 1) }
  return pestanasConTodas(PESTANAS.map((p) => ({ ...p, n: n.get(p.id) ?? 0 })))
}

export interface CifrasFacturas {
  /** Por cobrar sin vencer; dentro, las de plataforma que esperan su liquidación (PC01). */
  porCobrar: { total: number; n: number; esperando: number }
  vencido: { total: number; n: number; masAntigua: { cliente: string | null; dias: number } | null }
  /** PC01 · Las de plataforma pasadas de plazo sin ninguna liquidación: aparte, no suman en Vencido. */
  faltaLiquidacion: { total: number; n: number }
  cobradoMes: { total: number; n: number }
  borradores: { total: number; n: number }
}

const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000)

/** Las cuatro cifras de arriba. `cobros`: los cobros de las facturas, con su fecha. */
export function cifrasFacturas(fs: readonly FacturaVenta[], cobros: readonly { fecha: string; importe: number }[], hoy: string): CifrasFacturas {
  const suma = (xs: readonly number[]) => xs.reduce((t, x) => t + c(x), 0) / 100
  const deSumied = fs.filter((f) => f.fuente === 'sumied')
  const por = deSumied.filter((f) => pestanaDe(f, hoy) === 'por-cobrar')
  const ven = deSumied.filter((f) => estadoDe(f, hoy) === 'vencida')
  const falta = deSumied.filter((f) => estadoDe(f, hoy) === 'falta_liquidacion')
  const vieja = [...ven].sort((a, b) => (a.vence ?? '').localeCompare(b.vence ?? ''))[0]
  const mes = hoy.slice(0, 7)
  const delMes = cobros.filter((x) => x.fecha.startsWith(mes))
  const bor = deSumied.filter((f) => f.guardado === 'borrador')
  return {
    porCobrar: { total: suma(por.map(quedaPorCobrar)), n: por.length, esperando: por.filter((f) => estadoDe(f, hoy) === 'esperando_liquidacion').length },
    vencido: { total: suma(ven.map(quedaPorCobrar)), n: ven.length, masAntigua: vieja ? { cliente: vieja.cliente, dias: dias(vieja.vence ?? hoy, hoy) } : null },
    faltaLiquidacion: { total: suma(falta.map(quedaPorCobrar)), n: falta.length },
    cobradoMes: { total: suma(delMes.map((x) => x.importe)), n: delMes.length },
    borradores: { total: suma(bor.map((f) => f.total)), n: bor.length },
  }
}

// ── Filtros, en la dirección ─────────────────────────────────────────────────

export interface FiltrosFacturas {
  pestana: IdPestanaFacturas
  q: string
  mes: string
  origen: string
  serie: string
  local: string
  orden: { columna: string; sentido: Sentido }
}
const ORDEN_DE_SERIE = { columna: 'fecha', sentido: 'desc' as Sentido }
export const COLUMNAS_ORDENABLES = ['fecha', 'numero', 'cliente', 'total', 'vence'] as const
const IDS_PESTANA: readonly IdPestanaFacturas[] = ['todas', 'borradores', 'por-cobrar', 'falta-liquidacion', 'vencidas', 'cobradas', 'anuladas', 'emitidas', 'del-libro']

export function filtrosFacturas(query: URLSearchParams): FiltrosFacturas {
  const ver = query.get('ver') as IdPestanaFacturas | null
  const orden = leerOrden(query.get('orden') ?? undefined, ORDEN_DE_SERIE)
  return {
    pestana: ver && IDS_PESTANA.includes(ver) ? ver : 'todas',
    q: query.get('q') ?? '',
    mes: /^\d{4}-\d{2}$/.test(query.get('mes') ?? '') ? query.get('mes')! : '',
    origen: query.get('origen') ?? '',
    serie: query.get('serie') ?? '',
    local: query.get('local') ?? '',
    orden: (COLUMNAS_ORDENABLES as readonly string[]).includes(orden.columna) ? orden : ORDEN_DE_SERIE,
  }
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** El buscador: cliente, NIF, número o importe («4.224», «4224,00», «4224»). */
export function casaConBusqueda(f: FacturaVenta, q: string): boolean {
  const t = sinAcentos(q.trim())
  if (!t) return true
  const texto = sinAcentos([f.cliente, f.nif, f.numero].filter(Boolean).join(' '))
  if (t.split(/\s+/).every((p) => texto.includes(p))) return true
  const importe = Number(t.replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
  if (!Number.isFinite(importe) || !/\d/.test(t)) return false
  const conDecimales = /[.,]\d{1,2}$/.test(t)
  return [f.base, f.total].some((x) => (conDecimales ? c(x) === c(importe) : Math.trunc(x) === Math.trunc(importe)))
}

/** Lo que dejan el buscador y los filtros, sin la pestaña (para contar las pestañas). */
export function filtrarSinPestana(fs: readonly FacturaVenta[], f: Pick<FiltrosFacturas, 'q' | 'mes' | 'origen' | 'serie' | 'local'>): FacturaVenta[] {
  return fs.filter((x) => (!f.mes || x.fecha.startsWith(f.mes))
    && (!f.origen || x.origen === f.origen)
    && (!f.serie || x.serie === f.serie)
    && (!f.local || x.localId === f.local)
    && casaConBusqueda(x, f.q))
}

export function filasFacturas(fs: readonly FacturaVenta[], f: FiltrosFacturas, hoy: string): FacturaVenta[] {
  const sin = filtrarSinPestana(fs, f)
  const con = f.pestana === 'todas' ? sin : sin.filter((x) => pestanaDe(x, hoy) === f.pestana)
  const valor = (x: FacturaVenta): string | number | null =>
    f.orden.columna === 'total' ? x.total : f.orden.columna === 'cliente' ? x.cliente : f.orden.columna === 'numero' ? x.numero
      : f.orden.columna === 'vence' ? x.vence : x.fecha
  // Los borradores, arriba: son lo que está por hacer.
  const ordenadas = ordenar(con, valor, f.orden.sentido)
  return [...ordenadas.filter((x) => x.guardado === 'borrador'), ...ordenadas.filter((x) => x.guardado !== 'borrador')]
}

/** Los orígenes que hay (solo salen los que existen en esa empresa). */
export function origenesQueHay(fs: readonly FacturaVenta[]): OrigenFactura[] {
  const hay = new Set(fs.map((f) => f.origen))
  return (Object.keys(NOMBRE_ORIGEN) as OrigenFactura[]).filter((o) => hay.has(o))
}
export function seriesQueHay(fs: readonly FacturaVenta[]): string[] {
  return [...new Set(fs.map((f) => f.serie).filter((s): s is string => !!s))].sort()
}

/** El total del filtro, sin las anuladas (se compensan con su rectificativa). */
export function totalDelFiltro(fs: readonly FacturaVenta[]): number {
  return fs.filter((f) => f.guardado !== 'anulada').reduce((t, f) => t + c(f.total), 0) / 100
}

// ── Las cuentas de una factura ────────────────────────────────────────────────

export interface LineaFactura {
  concepto: string
  cantidad: number
  precio: number
  /** En %, 0 a 100. */
  descuento: number
  tipoId: string
  /** El % de IVA del tipo. */
  tipo: number
  /** El % del recargo de equivalencia del tipo, si lo tiene. */
  recargo: number | null
  cuentaId: string
}

export interface CifrasFactura {
  base: number
  iva: number
  recargo: number
  retencion: number
  total: number
  porTipo: { tipo: number; base: number; iva: number; recargo: number }[]
}

/** La base de una línea: cantidad × precio − descuento, al céntimo. */
export const baseDeLinea = (l: Pick<LineaFactura, 'cantidad' | 'precio' | 'descuento'>): number =>
  Math.round(l.cantidad * l.precio * (1 - l.descuento / 100) * 100) / 100

/** Las cifras de unas líneas (como la base: el IVA y el recargo se redondean por tipo). */
export function cifrasDe(lineas: readonly LineaFactura[], conRecargo: boolean, retencionPct: number): CifrasFactura {
  const grupos = new Map<string, { tipo: number; recargo: number; base: number }>()
  for (const l of lineas) {
    const k = `${l.tipo}|${l.recargo ?? 0}`
    const g = grupos.get(k) ?? { tipo: l.tipo, recargo: l.recargo ?? 0, base: 0 }
    g.base += c(baseDeLinea(l))
    grupos.set(k, g)
  }
  const porTipo = [...grupos.values()].sort((a, b) => b.tipo - a.tipo).map((g) => ({
    tipo: g.tipo,
    base: g.base / 100,
    iva: Math.round(g.base * g.tipo / 100) / 100,
    recargo: conRecargo ? Math.round(g.base * g.recargo / 100) / 100 : 0,
  }))
  const base = porTipo.reduce((t, x) => t + c(x.base), 0)
  const iva = porTipo.reduce((t, x) => t + c(x.iva), 0)
  const recargo = porTipo.reduce((t, x) => t + c(x.recargo), 0)
  const retencion = Math.round(base * retencionPct / 100)
  return { base: base / 100, iva: iva / 100, recargo: recargo / 100, retencion: retencion / 100, total: (base + iva + recargo - retencion) / 100, porTipo }
}

/**
 * V01b · Las cifras de una factura YA EMITIDA: el IVA de cada tipo es el
 * GUARDADO en sus líneas (customer_invoice_line.tax_amount, el del libro de su
 * asiento), si todas las del tipo lo llevan; si no, el calculado (cifrasDe),
 * como hace la base (_conta_venta_cifras). Nada recalcula una emitida: en las
 * traídas de Diez, Diez truncó el medio céntimo y eso es lo declarado.
 * Sin recargo, como el PDF (va aparte); la retención, como cifrasDe.
 */
export function cifrasGuardadas(lineas: readonly (LineaFactura & { cuota: number | null })[], retencionPct = 0): CifrasFactura {
  const calculadas = cifrasDe(lineas.map((l) => ({ ...l, recargo: null })), false, retencionPct)
  const porTipo = calculadas.porTipo.map((g) => {
    const del = lineas.filter((l) => l.tipo === g.tipo)
    return del.every((l) => l.cuota !== null) ? { ...g, iva: del.reduce((t, l) => t + c(l.cuota ?? 0), 0) / 100 } : g
  })
  const iva = porTipo.reduce((t, x) => t + c(x.iva), 0)
  return { ...calculadas, iva: iva / 100, total: (c(calculadas.base) + iva - c(calculadas.retencion)) / 100, porTipo }
}

/** La diferencia de una rectificativa: lo que debía ser menos lo que fue. */
export function diferenciaDe(nueva: CifrasFactura, vieja: CifrasFactura): CifrasFactura {
  const d = (a: number, b: number) => (c(a) - c(b)) / 100
  const tipos = new Set([...nueva.porTipo.map((x) => x.tipo), ...vieja.porTipo.map((x) => x.tipo)])
  const porTipo = [...tipos].sort((a, b) => b - a).map((tipo) => {
    const n = nueva.porTipo.find((x) => x.tipo === tipo) ?? { base: 0, iva: 0, recargo: 0 }
    const v = vieja.porTipo.find((x) => x.tipo === tipo) ?? { base: 0, iva: 0, recargo: 0 }
    return { tipo, base: d(n.base, v.base), iva: d(n.iva, v.iva), recargo: d(n.recargo, v.recargo) }
  }).filter((x) => x.base !== 0 || x.iva !== 0 || x.recargo !== 0)
  return { base: d(nueva.base, vieja.base), iva: d(nueva.iva, vieja.iva), recargo: d(nueva.recargo, vieja.recargo), retencion: d(nueva.retencion, vieja.retencion), total: d(nueva.total, vieja.total), porTipo }
}

/** Lo que falta para poder guardar el borrador o emitirlo, en frases (vacío = nada). */
export function faltaParaEmitir(b: { clienteId: string | null; nif: string | null; lineas: readonly Partial<LineaFactura>[] }): string[] {
  const falta: string[] = []
  if (!b.clienteId) falta.push('el cliente')
  else if (!b.nif?.trim()) falta.push('el NIF del cliente (en su ficha de Contactos)')
  const buenas = b.lineas.filter((l) => l.concepto?.trim() && l.tipoId && l.cuentaId)
  if (buenas.length === 0) falta.push('al menos una línea con concepto, IVA y cuenta')
  if (b.lineas.some((l) => !l.concepto?.trim())) falta.push('el concepto de cada línea')
  return falta
}

/** Qué se corrige, en palabras de la calle. */
export const NOMBRE_CORRECCION: Record<'importes' | 'anular' | 'datos', { titulo: string; texto: string }> = {
  importes: { titulo: 'Importes o líneas', texto: 'Se crea una rectificativa por la diferencia. Ejemplo: eran 240 menús y fueron 232.' },
  anular: { titulo: 'Anularla entera', texto: 'Rectificativa por el total y, si quieres, una factura nueva bien hecha.' },
  datos: { titulo: 'Datos del cliente', texto: 'NIF, nombre o dirección mal puestos. Rectificativa sin cambiar importes.' },
}

// ── El borrador que se edita en la ficha ──────────────────────────────────────

/** Una línea mientras se escribe: los números, como texto («1.234,50»). */
export interface LineaEnEdicion { concepto: string; cantidad: string; precio: string; descuento: string; tipoId: string; cuentaId: string }

export interface BorradorVenta {
  [k: string]: unknown
  clienteId: string | null
  fecha: string
  vence: string | null
  serie: string
  formaCobroId: string | null
  localId: string | null
  notas: string
  correo: string
  retencionId: string | null
  motivo: string
  lineas: LineaEnEdicion[]
}

export const ETIQUETAS_BORRADOR: Partial<Record<keyof BorradorVenta, string>> = {
  clienteId: 'Cliente', fecha: 'Fecha', vence: 'Vence', serie: 'Serie', formaCobroId: 'Forma de cobro', localId: 'Local',
  notas: 'Notas', correo: 'Correo del cliente', retencionId: 'Retención', motivo: 'Motivo', lineas: 'Líneas',
}

/** «1.234,5» → 1234.5; vacío o mal escrito → null. Acepta también «1234.5». */
export function numeroDeTexto(t: string): number | null {
  const x = t.trim().replace(/\s|€|%/g, '')
  if (!x) return null
  const limpio = /,/.test(x) ? x.replace(/\./g, '').replace(',', '.') : (/^\d{1,3}(\.\d{3})+$/.test(x) ? x.replace(/\./g, '') : x)
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}

/** 1234.5 → «1.234,50» (o «1234,5» si no hace falta: los decimales que tenga, al menos dos en importes). */
export const textoDeNumero = (n: number, decimales = 2): string =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: decimales === 2 ? 2 : 0, maximumFractionDigits: Math.max(decimales, 2), useGrouping: 'always' } as Intl.NumberFormatOptions).format(n)

export const lineaVacia = (tipoId: string, cuentaId: string): LineaEnEdicion => ({ concepto: '', cantidad: '1', precio: '', descuento: '', tipoId, cuentaId })

/** Las líneas escritas, en números: las que no se pueden leer, fuera (y dicho en `mal`). */
export function lineasLeidas(ls: readonly LineaEnEdicion[], tipos: readonly { id: string; tipo: number }[]): { lineas: LineaFactura[]; mal: string[] } {
  const mal: string[] = []
  const lineas: LineaFactura[] = []
  ls.forEach((l, i) => {
    if (!l.concepto.trim() && !l.precio.trim()) return
    const cantidad = numeroDeTexto(l.cantidad)
    const precio = numeroDeTexto(l.precio)
    const descuento = l.descuento.trim() ? numeroDeTexto(l.descuento) : 0
    const t = tipos.find((x) => x.id === l.tipoId)
    if (cantidad === null || cantidad === 0) mal.push(`la cantidad de la línea ${i + 1}`)
    else if (precio === null) mal.push(`el precio de la línea ${i + 1}`)
    else if (descuento === null || descuento < 0 || descuento > 100) mal.push(`el descuento de la línea ${i + 1} (de 0 a 100)`)
    else if (!t) mal.push(`el IVA de la línea ${i + 1}`)
    else lineas.push({ concepto: l.concepto.trim(), cantidad, precio, descuento, tipoId: t.id, tipo: t.tipo, recargo: null, cuentaId: l.cuentaId })
  })
  return { lineas, mal }
}

/** Vence: la fecha más los días de su ficha (sin días, nada). */
export function venceCon(fecha: string, dias: number | null): string | null {
  if (dias === null || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** La vista previa del asiento (como lo hará conta_venta_emitir): 430 por el total, 70x por cuenta, 477 por tipo y la 473. */
export function asientoPrevio(
  cifras: CifrasFactura, lineas: readonly LineaFactura[], cliente: string | null,
  cuentas: readonly { id: string; code: string; nombre: string }[],
): { codigo: string; nombre: string; debe: number | null; haber: number | null }[] {
  // Cada cuenta en su lado de siempre; en negativo (una rectificativa), en el otro.
  const al = (x: number, lado: 'debe' | 'haber') => {
    const pos = x > 0 ? x : null
    const neg = x < 0 ? -x : null
    return lado === 'debe' ? { debe: pos, haber: neg } : { debe: neg, haber: pos }
  }
  const out: { codigo: string; nombre: string; debe: number | null; haber: number | null }[] = []
  if (cifras.total !== 0) out.push({ codigo: '430', nombre: `Clientes · ${cliente ?? 'el cliente'}`, ...al(cifras.total, 'debe') })
  const porCuenta = new Map<string, number>()
  for (const l of lineas) porCuenta.set(l.cuentaId, (porCuenta.get(l.cuentaId) ?? 0) + Math.round(baseDeLinea(l) * 100))
  for (const [id, cts] of porCuenta) {
    const c = cuentas.find((x) => x.id === id)
    out.push({ codigo: c?.code ?? '70', nombre: c?.nombre ?? 'Ventas', ...al(cts / 100, 'haber') })
  }
  for (const t of cifras.porTipo) {
    if (t.iva !== 0) out.push({ codigo: '477', nombre: `IVA repercutido ${textoDeNumero(t.tipo, 0)} %`, ...al(t.iva, 'haber') })
  }
  if (cifras.retencion !== 0) out.push({ codigo: '473', nombre: 'Retenciones que te hacen tus clientes', ...al(cifras.retencion, 'debe') })
  return out
}
