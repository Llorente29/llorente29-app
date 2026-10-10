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

// ── Repaso (10/10): una fila por decisión, no por papel ────────────────────
//
// «Qué tienes que mirar» se agrupa por lo que hay que decidir: un nombre que
// no se sabe de quién es (una vez para todos sus papeles), una ficha a la que
// le falta algo (todo junto), el mismo papel contra la misma ficha… Agrupar
// no esconde (regla 7): cada fila lleva sus papeles y la pantalla los enseña.

/** Normaliza como lo hace la base para comparar (sin tildes, minúsculas, sin forma social). */
export function normaNombre(t: string | null | undefined): string {
  return (t ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/^\s*\d+\s*-\s*/, ' ').replace(/[^a-z0-9]+/g, ' ')
    .replace(/(\s(s l u|s l l|s l|s a u|s a|sl|slu|sll|sa|sau|s coop|sociedad limitada|sociedad anonima|unipersonal))+\s*$/, ' ')
    .replace(/\s+/g, ' ').trim()
}

const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'en', 'food', 'foods', 'grupo', 'group', 'sl', 'sa'])
const palabras = (t: string) => normaNombre(t).split(' ').filter((p) => p.length >= 4 && !PALABRAS_VACIAS.has(p))

export interface Propuesta { tipo: 'empresa' | 'proveedor'; id: string; nombre: string; porque: string }

/**
 * Como mucho dos propuestas para «¿de quién es este nombre?», las más
 * probables y con su porqué. Sin ninguna pista, ninguna: mejor «Es de otro…»
 * que un botón por cada empresa y proveedor.
 */
export function propuestasDeNombre(nombre: string, candidatos: readonly Candidato[], quienLoTrae: readonly string[]): Propuesta[] {
  const mias = new Set(palabras(nombre))
  const puntuadas = candidatos.map((c) => {
    const comunes = palabras(c.nombre).filter((p) => mias.has(p))
    const trae = c.tipo === 'proveedor' && quienLoTrae.includes(c.id)
    const porques: string[] = []
    if (comunes.length) porques.push(`comparte «${comunes.join(' ')}»`)
    if (trae) porques.push('es quien trae el género')
    return { c, puntos: comunes.length * 3 + (trae ? 2 : 0), porque: porques.join(' y ') }
  }).filter((x) => x.puntos > 0)
  puntuadas.sort((a, b) => b.puntos - a.puntos || a.c.nombre.localeCompare(b.c.nombre, 'es'))
  const vistas = new Set<string>()
  const r: Propuesta[] = []
  for (const x of puntuadas) {
    if (vistas.has(x.c.id)) continue
    vistas.add(x.c.id)
    r.push({ tipo: x.c.tipo, id: x.c.id, nombre: x.c.nombre, porque: x.porque.replace(/^./, (l) => l.toUpperCase()) })
    if (r.length === 2) break
  }
  return r
}

export type FilaAMirar =
  | { tipo: 'nombre'; clave: string; nombre: string; papeles: RecepcionAMirar[]; candidatos: Candidato[] }
  | { tipo: 'liquida'; clave: string; proveedor: string; proveedor_nombre: string; papeles: RecepcionAMirar[] }
  | { tipo: 'sin_iva'; clave: string; nombre: string; papeles: RecepcionAMirar[] }
  | { tipo: 'papel_ficha'; clave: string; proveedor: string; proveedor_nombre: string; papel: string | null; ficha: FormaFacturar | null; sugerida: FormaFacturar | null; papeles: RecepcionAMirar[] }
  | { tipo: 'ficha'; clave: string; proveedor: string; proveedor_nombre: string; falta: FaltaFicha[]; sugerida: FormaFacturar | null; papeles: RecepcionAMirar[] }
  | { tipo: 'otra'; clave: string; pregunta: Pregunta; proveedor: string | null; proveedor_nombre: string | null; papeles: RecepcionAMirar[] }
  | { tipo: 'sin_camino'; clave: string; recepciones: SinCamino[] }

function empuja<T extends { papeles: RecepcionAMirar[] }>(m: Map<string, T>, k: string, crea: () => T, r: RecepcionAMirar) {
  const f = m.get(k) ?? crea()
  f.papeles.push(r)
  m.set(k, f)
}

/** Agrupa lo que devuelve compras_mirar en filas de decisión, en un orden estable. */
export function agruparAMirar(m: Mirar): FilaAMirar[] {
  const nombres = new Map<string, Extract<FilaAMirar, { tipo: 'nombre' }>>()
  const liquida = new Map<string, Extract<FilaAMirar, { tipo: 'liquida' }>>()
  const sinIva = new Map<string, Extract<FilaAMirar, { tipo: 'sin_iva' }>>()
  const papelFicha = new Map<string, Extract<FilaAMirar, { tipo: 'papel_ficha' }>>()
  const fichas = new Map<string, Extract<FilaAMirar, { tipo: 'ficha' }>>()
  const otras = new Map<string, Extract<FilaAMirar, { tipo: 'otra' }>>()
  for (const f of m.fichas) fichas.set(f.proveedor, { tipo: 'ficha', clave: `ficha-${f.proveedor}`, proveedor: f.proveedor, proveedor_nombre: f.proveedor_nombre, falta: [...f.falta], sugerida: null, papeles: [] })
  const recepciones = [...m.recepciones].sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.codigo ?? '').localeCompare(b.codigo ?? ''))
  for (const r of recepciones) {
    const d = r.detalle ?? {}
    if (r.pregunta === 'a_nombre_de' && d.proveedor) {
      empuja(liquida, d.proveedor, () => ({ tipo: 'liquida' as const, clave: `liquida-${d.proveedor}`, proveedor: d.proveedor!, proveedor_nombre: d.proveedor_nombre ?? 'ese proveedor', papeles: [] }), r)
    } else if (r.pregunta === 'a_nombre_de' && r.a_nombre_de) {
      const k = normaNombre(r.a_nombre_de)
      empuja(nombres, k, () => ({ tipo: 'nombre' as const, clave: `nombre-${k}`, nombre: r.a_nombre_de!, papeles: [], candidatos: d.candidatos ?? [] }), r)
    } else if (r.pregunta === 'a_nombre_de_otro') {
      const k = normaNombre(r.a_nombre_de)
      empuja(sinIva, k, () => ({ tipo: 'sin_iva' as const, clave: `iva-${k}`, nombre: r.a_nombre_de ?? 'otro', papeles: [] }), r)
    } else if (r.pregunta === 'ficha_sin_forma' && r.proveedor) {
      const f = fichas.get(r.proveedor) ?? { tipo: 'ficha' as const, clave: `ficha-${r.proveedor}`, proveedor: r.proveedor, proveedor_nombre: r.proveedor_nombre ?? 'Este proveedor', falta: [{ falta: 'forma_facturar' as const, ultimo_papel: r.papel }], sugerida: null, papeles: [] }
      if (!f.falta.some((x) => x.falta === 'forma_facturar')) f.falta.push({ falta: 'forma_facturar', ultimo_papel: r.papel })
      f.sugerida ??= d.sugerida ?? null
      f.papeles.push(r)
      fichas.set(r.proveedor, f)
    } else if (r.pregunta === 'papel_y_ficha' && r.proveedor) {
      const papel = d.papel ?? r.papel
      const k = `${r.proveedor}-${papel}`
      empuja(papelFicha, k, () => ({ tipo: 'papel_ficha' as const, clave: `pf-${k}`, proveedor: r.proveedor!, proveedor_nombre: r.proveedor_nombre ?? 'Este proveedor', papel, ficha: d.ficha ?? null, sugerida: d.sugerida ?? null, papeles: [] }), r)
    } else {
      const k = `${r.pregunta}-${r.proveedor ?? r.recepcion}`
      empuja(otras, k, () => ({ tipo: 'otra' as const, clave: `otra-${k}`, pregunta: r.pregunta, proveedor: r.proveedor, proveedor_nombre: r.proveedor_nombre, papeles: [] }), r)
    }
  }
  const porNombre = <T extends { papeles: RecepcionAMirar[] }>(xs: Iterable<T>, n: (x: T) => string) => [...xs].sort((a, b) => b.papeles.length - a.papeles.length || n(a).localeCompare(n(b), 'es'))
  const filas: FilaAMirar[] = [
    ...porNombre(nombres.values(), (x) => x.nombre),
    ...porNombre(liquida.values(), (x) => x.proveedor_nombre),
    ...porNombre(sinIva.values(), (x) => x.nombre),
    ...porNombre(papelFicha.values(), (x) => x.proveedor_nombre),
    ...porNombre(otras.values(), (x) => x.proveedor_nombre ?? ''),
    ...[...fichas.values()].filter((f) => f.falta.length > 0).sort((a, b) => b.papeles.length - a.papeles.length || a.proveedor_nombre.localeCompare(b.proveedor_nombre, 'es')),
  ]
  if (m.sin_camino.length) filas.push({ tipo: 'sin_camino', clave: 'sin-camino', recepciones: [...m.sin_camino].sort((a, b) => a.fecha.localeCompare(b.fecha)) })
  return filas
}

/** «el NIF», «el tipo de gasto» y «cómo te factura», unidos como se dice. */
export function listaFaltas(falta: readonly FaltaFicha[]): string {
  const t = falta.map((f) => (f.falta === 'nif' ? 'el NIF' : f.falta === 'tipo_gasto' ? 'el tipo de gasto' : 'cómo te factura'))
  return t.length <= 1 ? (t[0] ?? '') : `${t.slice(0, -1).join(', ')} y ${t[t.length - 1]}`
}

/** «A Verduras del Huerto le faltan el NIF, el tipo de gasto y cómo te factura.» */
export function fraseFicha(prov: string, falta: readonly FaltaFicha[]): string {
  return `A ${prov} le ${falta.length === 1 ? 'falta' : 'faltan'} ${listaFaltas(falta)}.`
}

/** Lo que dice debajo la fila de una ficha: por qué importa cada cosa que falta, en una frase. */
export function porQueFicha(falta: readonly FaltaFicha[]): string {
  const t: string[] = []
  const nif = falta.find((f) => f.falta === 'nif')
  if (nif && nif.falta === 'nif') t.push(nif.ofrece ? `Sin NIF no puedo contabilizar sus facturas; ${nif.veces && nif.veces > 1 ? `en ${nif.veces} de sus papeles` : 'en su último papel'} pone ${nif.ofrece}${nif.otros_distintos > 0 ? ' (y hay otro distinto)' : ''}: compruébalo antes de aceptarlo` : 'Sin NIF no puedo contabilizar sus facturas, y ninguno de sus papeles lo trae')
  if (falta.some((f) => f.falta === 'tipo_gasto')) t.push('sin tipo de gasto no sé a qué cuenta van')
  const forma = falta.find((f) => f.falta === 'forma_facturar')
  if (forma && forma.falta === 'forma_facturar') t.push(`sin saber cómo factura no sé si esperar su factura${forma.ultimo_papel ? ` (su último papel fue ${papelConArticulo(forma.ultimo_papel)})` : ''}`)
  return conPunto(t.join('; ').replace(/^./, (l) => l.toUpperCase()))
}

/** «del 2 al 9 de octubre» / «del 30 de septiembre al 2 de octubre» / «del 5 de octubre». */
export function rangoFechas(fechas: readonly string[]): string {
  if (!fechas.length) return ''
  const s = [...fechas].sort()
  const [a, b] = [s[0], s[s.length - 1]]
  const [, ma, da] = a.split('-').map(Number)
  const [, mb, db] = b.split('-').map(Number)
  if (a === b) return `del ${da} de ${MES[ma - 1]}`
  return ma === mb ? `del ${da} al ${db} de ${MES[mb - 1]}` : `del ${da} de ${MES[ma - 1]} al ${db} de ${MES[mb - 1]}`
}

export function totalPapeles(papeles: readonly { base: number | null }[]): { total: number; sinImporte: number } {
  return { total: Math.round(papeles.reduce((s, p) => s + (p.base ?? 0), 0) * 100) / 100, sinImporte: papeles.filter((p) => p.base == null).length }
}

// ── La liquidación: tres veredictos, con su umbral escrito ─────────────────
//
// Coincide · se parece (cuánto y dónde) · no lo puedo comprobar (por qué y qué
// hace falta). Coincide = la diferencia no pasa de 2 € ni del 0,1 % de lo que
// dice él (lo que sea mayor): el redondeo de una cuenta larga, nada más.

export const UMBRAL_COINCIDE = { euros: 2, proporcion: 0.001 }

export function coincide(diferencia: number, referencia: number): boolean {
  return Math.abs(diferencia) <= Math.max(UMBRAL_COINCIDE.euros, Math.abs(referencia) * UMBRAL_COINCIDE.proporcion)
}

export type EstadoVeredicto = 'coincide' | 'se_parece' | 'no_se_puede'
export interface Veredicto { estado: EstadoVeredicto; titulo: string; detalle: string }

export interface ContrasteCompras { folvy: number; recepciones: number; sin_base: number; documento: number | null; diferencia: number | null }
export interface ContrasteVenta { plataforma: string; documento: number | null; folvy: number | null; pedidos: number | null; diferencia: number }
export interface ContrasteProductos {
  casados: number; no_nuestros: number; sin_casar: number; sin_casar_con_compras: number
  no_coinciden: { nombre: string; documento: number; unidad: string; folvy: number | null; comparable: boolean }[]
}

const mas = (d: number) => (d > 0 ? 'más' : 'menos')

export function veredictoCompras(c: ContrasteCompras): Veredicto {
  const recibido = `En el local se recibieron ${c.recepciones} ${c.recepciones === 1 ? 'albarán' : 'albaranes'} por ${eurosExactos(c.folvy)}${c.sin_base ? ` (y ${c.sin_base} sin importe)` : ''}.`
  if (c.documento == null) {
    return { estado: 'no_se_puede', titulo: 'Lo que dice que te mandó no lo puedo comprobar.', detalle: `Falta su inventario: es el que dice lo que te mandó. ${recibido}` }
  }
  const dif = Math.round((c.folvy - c.documento) * 100) / 100
  if (coincide(dif, c.documento) && c.sin_base === 0) {
    return { estado: 'coincide', titulo: 'Lo que dice que te mandó coincide con lo que recibiste.', detalle: `Él dice ${eurosExactos(c.documento)}. ${recibido} Diferencia: ${eurosExactos(Math.abs(dif))}.` }
  }
  return {
    estado: 'se_parece', titulo: 'Lo que dice que te mandó no es lo que recibiste.',
    detalle: `Él dice ${eurosExactos(c.documento)}. ${recibido} En el local consta ${eurosExactos(Math.abs(dif))} ${mas(dif)}${c.sin_base ? '; las que no tienen importe no cuentan' : ''}.`,
  }
}

export function veredictoVentas(v: readonly ContrasteVenta[], marcas: string): Veredicto {
  const conFolvy = v.filter((x) => x.folvy != null)
  if (marcas === 'ninguna' || conFolvy.length === 0) {
    return {
      estado: 'no_se_puede', titulo: 'Sus ventas no las puedo comprobar.',
      detalle: marcas === 'ninguna'
        ? 'Folvy no sabe qué marcas son suyas: hace falta ponerle sus acuerdos de cesión en su ficha.'
        : 'Folvy no tiene ventas de sus marcas en este local y este mes: hacen falta los pedidos cerrados de sus marcas (o sus acuerdos de cesión, si son otras).',
    }
  }
  const sinDoc = v.filter((x) => x.documento == null)
  const distintas = v.filter((x) => x.documento != null && !coincide(x.diferencia, x.documento))
  if (!sinDoc.length && !distintas.length) {
    return { estado: 'coincide', titulo: 'Sus ventas y las que tiene Folvy coinciden.', detalle: 'De estas ventas sale tu servicio.' }
  }
  const total = Math.round(v.reduce((s, x) => s + x.diferencia, 0) * 100) / 100
  const partes = [...distintas].sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia))
    .map((x) => `${x.plataforma}, ${eurosExactos(Math.abs(x.diferencia))} ${mas(x.diferencia)}`)
  for (const x of sinDoc) partes.push(`${x.plataforma}, que él no trae`)
  return {
    estado: 'se_parece', titulo: 'Sus ventas y las que tiene Folvy se parecen, pero no son iguales.',
    detalle: `Folvy cuenta ${eurosExactos(Math.abs(total))} ${mas(total)} que él, sin IVA: ${partes.join('; ')}. De estas ventas sale tu servicio; para saber quién tiene razón pedido a pedido hace falta el detalle de cada plataforma.`,
  }
}

export function veredictoProductos(p: ContrasteProductos, total: number): Veredicto {
  if (total === 0) return { estado: 'no_se_puede', titulo: 'El género producto a producto no lo puedo comprobar.', detalle: 'Su inventario no trae productos.' }
  if (p.sin_casar > 0) {
    return {
      estado: 'no_se_puede', titulo: 'El género que dice que gastaste todavía no lo puedo comprobar producto a producto.',
      detalle: `Reconozco ${p.casados + p.no_nuestros} de sus ${total} productos. Los otros ${p.sin_casar} los llama de otra manera. Dime una vez cuál es cuál y lo recuerdo para todos los meses.`,
    }
  }
  if (p.no_coinciden.length === 0) return { estado: 'coincide', titulo: 'El género coincide producto a producto.', detalle: `Los ${total} productos de su inventario están casados y cuadran con lo recibido.` }
  return {
    estado: 'se_parece', titulo: `En ${p.no_coinciden.length} ${p.no_coinciden.length === 1 ? 'producto' : 'productos'} lo que dice no es lo que recibiste.`,
    detalle: p.no_coinciden.map((x) => `${x.nombre}: él dice ${String(x.documento).replace('.', ',')} ${x.unidad}; ${x.comparable ? `aquí ${String(x.folvy ?? 0).replace('.', ',')} ${x.unidad}` : 'aquí se cuenta en otra unidad'}`).join('. ') + '.',
  }
}

/** Los cinco documentos de una liquidación: cuáles han llegado y qué no se comprueba sin cada uno. */
export function documentosLeidos(l: { emitida?: unknown; recibida?: unknown; transaccion?: unknown; ventas?: unknown; inventario?: unknown }):
  { nombre: string; llegado: boolean; sinEl: string }[] {
  return [
    { nombre: 'Tu factura', llegado: !!l.emitida, sinEl: 'sin ella no hay liquidación que apuntar' },
    { nombre: 'Su factura', llegado: !!l.recibida, sinEl: 'sin ella no se apunta lo que te vende' },
    { nombre: 'La cuenta', llegado: !!l.transaccion, sinEl: 'sin ella no compruebo el saldo' },
    { nombre: 'Ventas', llegado: !!l.ventas, sinEl: 'sin ellas no compruebo tu servicio' },
    { nombre: 'Inventario', llegado: !!l.inventario, sinEl: 'sin él no compruebo el género, ni en total ni producto a producto' },
  ]
}
