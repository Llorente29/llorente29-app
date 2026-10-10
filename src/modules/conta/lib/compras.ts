// src/modules/conta/lib/compras.ts
//
// Compras (encargo «Contabilidad: las compras», §6): lo que la pantalla dice
// de cada cosa, sin tocar la base. Las frases salen de lo que devuelve
// compras_mirar / compras_esperando_factura / compras_liquidaciones (0170).
//
// Regla 7: nada de aquí decide si una fila existe. Ordena y pone palabras.

import { eurosExactos } from '@/modules/conta/lib/formato'

export type FormaFacturar = 'per_delivery' | 'delivery_note_then_invoice' | 'monthly_settlement'

/** Las tres formas, con el texto fijo de Julio (N20). */
export const FORMAS: { valor: FormaFacturar; titulo: string; explicacion: string }[] = [
  { valor: 'per_delivery', titulo: 'Con cada entrega',
    explicacion: 'El papel que trae con el género ya es la factura. Se contabiliza sola al recibirlo. También vale para quien no entrega género: el alquiler, la luz, la gestoría.' },
  { valor: 'delivery_note_then_invoice', titulo: 'Entrega con albarán y factura después',
    explicacion: 'Lo recibido queda esperando factura. Cuando llega, la junto con sus albaranes y te digo si cuadra.' },
  { valor: 'monthly_settlement', titulo: 'Liquidación mensual',
    explicacion: 'No factura cada entrega. Cada mes te manda su factura y la tuya, y se paga la diferencia. Lo que recibes sirve para comprobar que su cuenta es verdad.' },
]

export function tituloForma(f: string | null | undefined): string | null {
  return FORMAS.find((x) => x.valor === f)?.titulo ?? null
}

const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MES_CORTO = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.']
const DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function partes(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return [y, m, d]
}

/** «del lunes 5 de octubre» (N18, la fila de una recepción). */
export function diaConNombre(iso: string): string {
  const [y, m, d] = partes(iso)
  return `${DIA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} de ${MES[m - 1]}`
}

/** «4 de sept.» */
export function diaCorto(iso: string): string {
  const [, m, d] = partes(iso)
  return `${d} de ${MES_CORTO[m - 1]}`
}

/** «octubre de 2026» */
export function mesLargo(iso: string): string {
  const [y, m] = partes(iso)
  return `${MES[m - 1]} de ${y}`
}

/** «septiembre» */
export function nombreMes(iso: string): string {
  return MES[partes(iso)[1] - 1]
}

/** El primer día del mes de una fecha, y el del mes anterior. */
export function primeroDeMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}
export function mesAnterior(iso: string): string {
  const [y, m] = partes(iso)
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
}
export function mesSiguiente(iso: string): string {
  const [y, m] = partes(iso)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/** Días entre dos fechas 'YYYY-MM-DD'. */
export function diasEntre(desde: string, hasta: string): number {
  const [a, b, c] = partes(desde)
  const [x, y, z] = partes(hasta)
  return Math.round((Date.UTC(x, y - 1, z) - Date.UTC(a, b - 1, c)) / 86_400_000)
}

/** Cierra una frase con punto sin doblarlo («…, S.L.» + «.» → «…, S.L.»). */
export function conPunto(t: string): string {
  return t.endsWith('.') ? t : `${t}.`
}

/** «albarán» / «factura» / «papel», sin artículo («ha entregado con albarán»). */
export function papelSolo(tipo: string | null | undefined): string {
  if (tipo === 'factura' || tipo === 'albaran_factura') return 'factura'
  if (tipo === 'albaran') return 'albarán'
  if (tipo === 'ticket') return 'ticket'
  return 'un papel'
}

/** «un albarán» / «una factura» / «un papel» */
export function papelConArticulo(tipo: string | null | undefined): string {
  if (tipo === 'factura' || tipo === 'albaran_factura') return 'una factura'
  if (tipo === 'albaran') return 'un albarán'
  if (tipo === 'ticket') return 'un ticket'
  return 'un papel'
}

// ── Lo que dicen sus últimos papeles (N20) ──────────────────────────────────

/** «Sus 5 últimas entregas vinieron con albarán» / «De sus 4 últimas, 3 con albarán y 1 con factura». */
export function fraseUltimosPapeles(papeles: string[]): string | null {
  if (papeles.length === 0) return null
  const cuenta = new Map<string, number>()
  for (const p of papeles) {
    const k = p === 'albaran_factura' ? 'factura' : p
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1)
  }
  const con = (k: string) => (k === 'factura' ? 'factura' : k === 'albaran' ? 'albarán' : k === 'ticket' ? 'ticket' : 'otro papel')
  const n = papeles.length
  if (cuenta.size === 1) {
    const [k] = [...cuenta.keys()]
    return n === 1 ? `Su última entrega vino con ${con(k)}.` : `Sus ${n} últimas entregas vinieron con ${con(k)}.`
  }
  const partes = [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} con ${con(k)}`)
  return `De sus ${n} últimas entregas, ${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}.`
}

/** ¿Lo que dicen los papeles choca con lo que pone la ficha? */
export function chocaConLaFicha(papeles: string[], modo: FormaFacturar | null): boolean {
  if (!modo || papeles.length === 0 || modo === 'monthly_settlement') return false
  const facturas = papeles.filter((p) => p === 'factura' || p === 'albaran_factura').length
  return modo === 'per_delivery' ? facturas < papeles.length / 2 : facturas > papeles.length / 2
}

// ── Qué tienes que mirar ───────────────────────────────────────────────────

export type Pregunta =
  | 'a_nombre_de' | 'papel_y_ficha' | 'ficha_sin_forma' | 'sin_papel' | 'a_nombre_de_otro'
  | 'error' | 'factura_sin_importes' | 'factura_repetida'

export interface Candidato { tipo: 'empresa' | 'proveedor'; id: string; nombre: string; orden: string }

export interface DetallePregunta {
  ficha?: FormaFacturar | null
  ficha_dice?: string | null
  papel?: string | null
  sugerida?: FormaFacturar | null
  sugerida_dice?: string | null
  nombre?: string | null
  proveedor?: string | null
  proveedor_nombre?: string | null
  candidatos?: Candidato[]
}

export interface RecepcionAMirar {
  tipo: 'recepcion'
  recepcion: string
  codigo: string | null
  fecha: string
  proveedor: string | null
  proveedor_nombre: string | null
  local: string | null
  local_nombre: string | null
  base: number | null
  papel: string | null
  a_nombre_de: string | null
  camino: string
  pregunta: Pregunta
  detalle: DetallePregunta | null
  frase: string | null
  error: string | null
  factura: string | null
  sesion: string | null
}

export interface SinCamino {
  tipo: 'sin_camino'; recepcion: string; codigo: string | null; fecha: string
  proveedor_nombre: string | null; local_nombre: string | null
}

export type FaltaFicha =
  | { falta: 'nif'; ofrece: string | null; veces: number | null; otros_distintos: number }
  | { falta: 'tipo_gasto' }
  | { falta: 'forma_facturar'; ultimo_papel: string | null }

export interface FichaAMirar { tipo: 'ficha'; proveedor: string; proveedor_nombre: string; falta: FaltaFicha[] }

export interface Mirar { recepciones: RecepcionAMirar[]; sin_camino: SinCamino[]; fichas: FichaAMirar[] }

/** «Recepción del lunes 5 de octubre · Local Centro · 191,00 €» */
export function lineaRecepcion(r: Pick<RecepcionAMirar, 'fecha' | 'local_nombre' | 'base' | 'codigo'>): string {
  const t = [`Recepción${r.codigo ? ` ${r.codigo}` : ''} del ${diaConNombre(r.fecha)}`]
  if (r.local_nombre) t.push(r.local_nombre)
  t.push(r.base == null ? 'sin importe' : eurosExactos(r.base))
  return t.join(' · ')
}

/**
 * La frase principal de una pregunta. Dice qué pasa y por qué importa; la
 * razón técnica (`frase`, de la base) va debajo si añade algo.
 */
export function fraseDePregunta(r: RecepcionAMirar): string {
  const prov = r.proveedor_nombre ?? 'Este proveedor'
  const d = r.detalle ?? {}
  switch (r.pregunta) {
    case 'papel_y_ficha':
      if (d.ficha === 'monthly_settlement')
        return `${prov} ha entregado con ${papelSolo(d.papel ?? r.papel)} a nombre de tu empresa, y en su ficha pone que liquida cada mes.`
      return `${prov} ha entregado con ${papelSolo(d.papel ?? r.papel)}, y en su ficha pone que factura ${d.ficha_dice ?? 'de otra forma'}.`
    case 'ficha_sin_forma':
      return `${prov} ha entregado con ${papelSolo(d.papel ?? r.papel)}, y su ficha no dice cómo factura.`
    case 'a_nombre_de':
      if (d.proveedor_nombre) return `El papel va a nombre de ${d.proveedor_nombre}, y su ficha no dice si liquida cada mes.`
      return r.a_nombre_de
        ? `El papel de ${prov} va a nombre de «${r.a_nombre_de}», y no sé quién es.`
        : `El papel de ${prov} no dice a nombre de quién va.`
    case 'a_nombre_de_otro':
      return `${papelConArticulo(r.papel).replace(/^u/, 'U')} de ${prov} viene a nombre de «${r.a_nombre_de ?? 'otro'}», no de tu empresa. Así no puedes descontar su IVA.`
    case 'sin_papel':
      return r.frase ?? `No hay papel leído de ${prov}.`
    case 'factura_sin_importes':
      return `La factura de ${prov} no se ha podido apuntar sola: ${r.frase ?? 'le faltan importes'}`
    case 'factura_repetida':
      return `La factura de ${prov} ya estaba registrada: ${r.frase ?? 'se ha enlazado a la que había'}`
    case 'error':
    default:
      return `No he podido decidir qué hacer con la recepción de ${prov}.`
  }
}

/** Orden de «Qué tienes que mirar»: lo más antiguo primero, en su orden de llegada. */
export function ordenarAMirar(m: Mirar): Mirar {
  return {
    recepciones: [...m.recepciones].sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.codigo ?? '').localeCompare(b.codigo ?? '')),
    sin_camino: [...m.sin_camino].sort((a, b) => a.fecha.localeCompare(b.fecha)),
    fichas: [...m.fichas].sort((a, b) => a.proveedor_nombre.localeCompare(b.proveedor_nombre, 'es')),
  }
}

export function cuantasAMirar(m: Mirar): number {
  return m.recepciones.length + m.sin_camino.length + m.fichas.reduce((s, f) => s + f.falta.length, 0)
}

/** Lo que dice la fila de una ficha incompleta. */
export function fraseDeFalta(prov: string, f: FaltaFicha): string {
  if (f.falta === 'nif') {
    const base = `A ${prov} le falta el NIF. Sin él no puedo contabilizar sus facturas.`
    if (!f.ofrece) return `${base} Ninguno de sus papeles lo trae.`
    const donde = f.veces && f.veces > 1 ? `En ${f.veces} de sus papeles pone` : 'En su último papel pone'
    const otros = f.otros_distintos > 0 ? ` Ojo: ${f.otros_distintos === 1 ? 'hay otro papel con uno distinto' : `hay otros ${f.otros_distintos} distintos`}.` : ''
    return `${base} ${donde} ${f.ofrece}.${otros} Compruébalo antes de aceptarlo.`
  }
  if (f.falta === 'tipo_gasto') return `A ${prov} le falta el tipo de gasto: sin él no sé a qué cuenta van sus facturas.`
  const ultimo = f.ultimo_papel ? ` Su último papel fue ${papelConArticulo(f.ultimo_papel)}.` : ''
  return `${conPunto(`No sé cómo factura ${prov}`)}${ultimo}`
}

// ── Qué está esperando factura ─────────────────────────────────────────────

export interface EsperandoFactura {
  supplier_id: string; supplier_name: string; location_id: string | null; location_name: string | null
  receipts: number; base: number; without_base: number; oldest: string; newest: string; per_location: boolean | null
}

/** «3 desde el 4 de sept.» / «1 del 18 de sept.» */
export function albaranesDesde(e: Pick<EsperandoFactura, 'receipts' | 'oldest'>): string {
  return e.receipts === 1 ? `1 del ${diaCorto(e.oldest)}` : `${e.receipts} desde el ${diaCorto(e.oldest)}`
}

/** El importe, y si alguna no lo tiene, se dice. */
export function importeEsperando(e: Pick<EsperandoFactura, 'base' | 'without_base'>): string {
  const t = eurosExactos(e.base)
  return e.without_base > 0 ? `${t} (y ${e.without_base} sin importe)` : t
}

/** Pasado este plazo, «Cuándo llega» avisa de cuánto lleva. */
export const DIAS_SIN_FACTURAR = 35

/** «Cuándo llega»: la costumbre, o cuánto lleva si ya pasa de lo normal. */
export function cuandoLlega(e: Pick<EsperandoFactura, 'oldest' | 'per_location'>, hoy: string): string {
  const dias = diasEntre(e.oldest, hoy)
  if (dias > DIAS_SIN_FACTURAR) return `Lleva ${dias} días sin facturar`
  return e.per_location ? 'Una por local' : 'Una para todos los locales'
}

// ── Liquidaciones del mes ──────────────────────────────────────────────────

export interface FilaLiquidacion {
  proveedor: string; proveedor_nombre: string; local: string | null; local_nombre: string | null
  recepciones: number; base: number
  liquidacion: string | null; estado: string | null; referencia: string | null; saldo: number | null; bloqueos: number | null
}

export type EstadoLiquidacion = 'confirmada' | 'por_confirmar' | 'no_ha_llegado' | 'no_toca'

/**
 * Qué pasa con una liquidación. `mes` es el primer día del mes que liquida;
 * `hoy`, la fecha de Madrid. Mientras el mes no ha acabado, no toca.
 */
export function estadoLiquidacion(f: FilaLiquidacion, mes: string, hoy: string): EstadoLiquidacion {
  if (f.liquidacion) return f.estado === 'confirmada' ? 'confirmada' : 'por_confirmar'
  return hoy < mesSiguiente(mes) ? 'no_toca' : 'no_ha_llegado'
}

export function fraseLiquidacion(f: FilaLiquidacion, mes: string, hoy: string): string {
  const albaranes = `${f.recepciones} ${f.recepciones === 1 ? 'albarán' : 'albaranes'}`
  const recibido = `${albaranes} suyo${f.recepciones === 1 ? '' : 's'} por ${eurosExactos(f.base)}`
  switch (estadoLiquidacion(f, mes, hoy)) {
    case 'confirmada': return 'Ha llegado, está confirmada y en el libro.'
    case 'por_confirmar':
      return f.bloqueos && f.bloqueos > 0
        ? `Ha llegado, pero hay ${f.bloqueos === 1 ? 'una cosa que no cuadra' : `${f.bloqueos} cosas que no cuadran`}: ábrela.`
        : 'Ha llegado: falta mirarla y confirmarla.'
    case 'no_ha_llegado': return `Todavía no ha llegado. Recibiste ${recibido}.`
    case 'no_toca': return `Aún no toca: llega a primeros de ${nombreMes(mesSiguiente(mes))}. Llevas recibidos ${albaranes} por ${eurosExactos(f.base)}.`
  }
}

/** «Te paga 5.545,84 €» / «Le pagas 120,00 €» / «Quedáis en paz» */
export function fraseSaldo(saldo: number | null): string | null {
  if (saldo == null) return null
  if (Math.abs(saldo) < 0.005) return 'Quedáis en paz'
  return saldo > 0 ? `Te paga ${eurosExactos(saldo)}` : `Le pagas ${eurosExactos(-saldo)}`
}
