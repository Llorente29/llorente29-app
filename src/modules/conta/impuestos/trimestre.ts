// src/modules/conta/impuestos/trimestre.ts
//
// I01c · Pieza 3, la parte que ordena (Julio, 19/10) · Impuestos › Trimestre,
// fiel a maqueta_303_v2. Núcleo puro: lo que dice cada tarjeta de la tira y
// cada línea de la cartera de cuotas a compensar, a partir de lo que devuelve
// conta_impuesto_trimestre (0280). Se prueba sin React
// (tests/unit/modules/conta/i01c/trimestre.test.ts).
//
// La cartera, como el Pre303 de la AEAT: lo pendiente al empezar el año, lo que
// cada trimestre anterior dejó a compensar o aplicó, y en el trimestre, la
// [110] (pendiente al empezar), la [78] (se aplica ahora), la [87] (queda de
// antes) y el total a compensar después. Sale de los 303 presentados, también
// de los subidos. Si un trimestre de antes no está, se dice: la cadena no se
// inventa (regla 7).

import type { TonoChip } from '@/modules/conta/diseno'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import type { Cadencia, Estado, Resultado } from './calendario'

export interface CasillaTrimestre { casilla: string; valor: number | null; texto: string | null; origen: 'calculated' | 'manual' | 'justificante' | string; motivo: string | null }

export interface DeclaracionTrimestre {
  id: string
  cuenta: string
  estado: Estado
  estado_texto: string
  resultado: Resultado | null
  importe: number | null
  presentada: string | null
  presentada_por: string | null
  por: 'sumied' | 'outside' | null
  csv: string | null
  justificante: string | null
  justificante_pdf: string | null
  traido: boolean | null
  expediente: string | null
  presentador: { nif: string | null; nombre: string | null } | null
  casillas: CasillaTrimestre[]
}

export interface ModeloTrimestre {
  modelo: string
  nombre: string
  cadencia: Cadencia
  periodo: string | null
  no_toca: boolean
  presentacion: string | null
  domiciliacion: string | null
  declaracion: DeclaracionTrimestre | null
}

export interface FilaCartera {
  periodo: string
  declaracion: string | null
  estado: Estado | null
  presentada: boolean | null
  resultado: Resultado | null
  importe: number | null
  c110: number | null
  c78: number | null
  c87: number | null
  origen110: string | null
}

export interface Cartera {
  filas: FilaCartera[]
  pendiente_al_empezar: { importe: number; de: string } | null
  esperada_110: { importe: number; de: string } | null
  borrador: { id: string; estado: Estado; c110: number | null; origen110: string | null } | null
  desfasada: boolean
}

export interface Trimestre {
  empresa: { id: string; nombre: string; razon_social: string; nif: string | null }
  ejercicio: number
  trimestre: string
  puede_gestionar: boolean
  modelos: ModeloTrimestre[]
  cartera: Cartera
}

const PRESENTADAS: ReadonlySet<Estado> = new Set(['filed', 'booked', 'paid', 'offset', 'refunded'])
export const estaPresentada = (e: Estado | null | undefined): boolean => !!e && PRESENTADAS.has(e)

/** «3T» → 3. Lo que no sea un trimestre, null. */
export function numeroTrimestre(t: string | undefined): number | null {
  const m = /^([1-4])T$/i.exec(t ?? '')
  return m ? Number(m[1]) : null
}

/**
 * El trimestre que se abre sin decir cuál: el último acabado, que es el que se
 * presenta (el 19/10/2026, el 3T de 2026; en enero, el 4T del año anterior).
 */
export function trimestrePorDefecto(hoy: string): { ejercicio: number; trimestre: string } {
  const y = Number(hoy.slice(0, 4))
  const mes = Number(hoy.slice(5, 7))
  const q = Math.floor((mes - 1) / 3) // el que va en curso, 0..3
  return q === 0 ? { ejercicio: y - 1, trimestre: '4T' } : { ejercicio: y, trimestre: `${q}T` }
}

/** «3.er trimestre 2026», «2.º trimestre 2026», como la miga de la maqueta. */
export function tituloTrimestre(ejercicio: number, trimestre: string): string {
  const n = numeroTrimestre(trimestre) ?? 0
  return `${n}.${n === 1 || n === 3 ? 'er' : 'º'} trimestre ${ejercicio}`
}

/** El nombre corto de la tarjeta: «IVA · 303», «Retenciones · 111», «Alquiler · 115», «Sociedades · 202». */
export function nombreTarjeta(m: Pick<ModeloTrimestre, 'modelo' | 'nombre' | 'periodo' | 'cadencia'>): string {
  const corto: Record<string, string> = { '303': 'IVA', '111': 'Retenciones', '115': 'Alquiler', '202': 'Sociedades' }
  const mes = m.cadencia === 'monthly' && m.periodo ? ` · mes ${Number(m.periodo)}` : ''
  return `${corto[m.modelo] ?? m.nombre} · ${m.modelo}${mes}`
}

/** El importe con su sentido: a pagar en positivo; a compensar o a devolver, en negativo (como la maqueta). */
export function importeConSigno(d: Pick<DeclaracionTrimestre, 'resultado' | 'importe'>): number | null {
  if (d.importe === null || d.importe === undefined || d.resultado === null) return null
  return d.resultado === 'to_offset' || d.resultado === 'to_refund' ? -Math.abs(d.importe) : Math.abs(d.importe)
}

/** Días de un día a otro (los dos 'AAAA-MM-DD'). */
const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)

/**
 * Lo que dice cada tarjeta de la tira: el importe y su chip (estado y fecha).
 * Sin presentar, lo que vence hoy o ya se pasó va en rojo y lo dice (Julio,
 * 20/10, punto 5: «Sin calcular · vence hoy»).
 */
export function tarjeta(m: ModeloTrimestre, hoy?: string): { titulo: string; importe: string; chip: { tono: TonoChip; texto: string } } {
  const titulo = nombreTarjeta(m)
  if (m.no_toca) return { titulo, importe: '—', chip: { tono: 'neutro', texto: 'No toca este trimestre' } }
  const d = m.declaracion
  const falta = hoy && m.presentacion ? dias(hoy, m.presentacion) : null
  const vence = falta === null ? '' : falta < 0 ? 'fuera de plazo' : falta === 0 ? 'vence hoy' : ''
  const conVence = (chip: { tono: TonoChip; texto: string }) => (vence ? { tono: 'falta' as TonoChip, texto: `${chip.texto} · ${vence}` } : chip)
  if (!d || d.estado === 'pending') {
    if (vence) return { titulo, importe: '—', chip: { tono: 'falta', texto: falta! < 0 ? 'Fuera de plazo' : 'Vence hoy' } }
    return { titulo, importe: '—', chip: { tono: 'neutro', texto: m.presentacion ? `Hasta el ${diaMesCorto(m.presentacion)}` : 'Sin plazo' } }
  }
  const v = importeConSigno(d)
  const importe = v === null ? '—' : eurosExactos(v)
  if (estaPresentada(d.estado)) {
    return { titulo, importe, chip: { tono: 'seguro', texto: d.presentada ? `Presentado ${diaMesCorto(d.presentada)}` : 'Presentado' } }
  }
  if (d.estado === 'not_required') return { titulo, importe: '—', chip: { tono: 'neutro', texto: 'No hace falta' } }
  if (d.estado === 'reviewed') return { titulo, importe, chip: conVence({ tono: 'accion', texto: 'Revisado · para presentar' }) }
  if (d.resultado === null) return { titulo, importe: '—', chip: conVence({ tono: 'falta', texto: 'Sin calcular' }) }
  return { titulo, importe, chip: conVence({ tono: 'accion', texto: 'Para revisar' }) }
}

/** La casilla del resultado de cada modelo: la que va en negrita en la ficha. */
export const CASILLA_RESULTADO: Readonly<Record<string, string>> = { '303': '71', '111': '30', '115': '05', '202': '03' }

/**
 * Quién lo presentó, en palabras: la gestoría con su nombre (y su NIF), o «La
 * propia empresa» si el NIF del presentador es el de la empresa. Sin dato, null.
 */
export function presentadorEnPalabras(p: DeclaracionTrimestre['presentador'], nifEmpresa: string | null): string | null {
  if (!p || (!p.nif && !p.nombre)) return null
  const limpio = (x: string | null) => (x ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (p.nif && nifEmpresa && limpio(p.nif) === limpio(nifEmpresa)) return 'La propia empresa'
  return p.nombre ? `${p.nombre}${p.nif ? ` (${p.nif})` : ''}` : p.nif
}

// ── La cartera ──────────────────────────────────────────────────────────────

export interface LineaCartera { texto: string; casilla?: string; importe: number | null; nota?: string; fuerte?: boolean }

/** La [110] que se enseña del trimestre: la del 303 presentado; la del borrador si está al día; si no, la que le toca. */
function c110DelTrimestre(c: Cartera, fila: FilaCartera | undefined): number | null {
  if (fila && estaPresentada(fila.estado)) return fila.c110
  if (c.borrador && !c.desfasada && c.borrador.c110 !== null) return c.borrador.c110
  return c.esperada_110?.importe ?? null
}

/**
 * Las líneas de «Cuotas a compensar de trimestres anteriores», trimestre a
 * trimestre, con la [110], la [78] y la [87] del trimestre y el total después.
 */
export function lineasCartera(t: Pick<Trimestre, 'ejercicio' | 'trimestre' | 'cartera'>): { lineas: LineaCartera[]; total: LineaCartera; cuadra: boolean | null } {
  const c = t.cartera
  const q = numeroTrimestre(t.trimestre) ?? 1
  const lineas: LineaCartera[] = []
  let cadena: number | null = c.pendiente_al_empezar?.importe ?? null
  lineas.push(c.pendiente_al_empezar
    ? { texto: `Pendiente de ${t.ejercicio - 1}`, importe: c.pendiente_al_empezar.importe }
    : { texto: `Pendiente de ${t.ejercicio - 1}`, importe: null, nota: `No se sabe: falta el 303 del 4T de ${t.ejercicio - 1} o el del 1T de ${t.ejercicio}.` })
  for (const f of c.filas) {
    const n = numeroTrimestre(f.periodo) ?? 0
    if (n >= q) continue
    if (!estaPresentada(f.estado)) {
      lineas.push({ texto: `${f.periodo} ${t.ejercicio} · no está presentado en Sumied`, importe: null, nota: 'Súbelo en Presentados para que la cartera siga.' })
      cadena = null
      continue
    }
    if (f.resultado === 'to_offset' && f.importe !== null) {
      lineas.push({ texto: `${f.periodo} ${t.ejercicio} · salió a compensar`, importe: Math.abs(f.importe) })
      if (cadena !== null) cadena += Math.abs(f.importe)
    }
    if ((f.c78 ?? 0) > 0) {
      lineas.push({ texto: `${f.periodo} ${t.ejercicio} · aplicado`, importe: -(f.c78 ?? 0) })
      if (cadena !== null) cadena -= f.c78 ?? 0
    }
  }
  const fila = c.filas.find((f) => f.periodo === t.trimestre)
  const c110 = c110DelTrimestre(c, fila)
  const tieneCalculo = !!fila && fila.estado !== null && fila.estado !== 'pending' && (estaPresentada(fila.estado) || !c.desfasada)
  const c78 = tieneCalculo ? fila!.c78 : null
  const c87 = tieneCalculo ? fila!.c87 : null
  lineas.push({ texto: `Pendiente al empezar el ${t.trimestre}`, casilla: '110', importe: c110, fuerte: false })
  lineas.push({ texto: 'Se aplica ahora', casilla: '78', importe: c78 })
  lineas.push({ texto: 'Queda de antes', casilla: '87', importe: c87 })
  const aCompensar = tieneCalculo && fila!.resultado === 'to_offset' && fila!.importe !== null ? Math.abs(fila!.importe) : 0
  const total: LineaCartera = {
    texto: `Total a compensar después del ${t.trimestre}`,
    importe: tieneCalculo && c87 !== null && fila!.resultado !== null ? c87 + aCompensar : null,
    fuerte: true,
  }
  // La cadena de los presentados tiene que dar la [110] del trimestre (lo pendiente + lo que salió a compensar − lo aplicado).
  const cuadra = cadena === null || c110 === null || q === 1 ? null : Math.abs(cadena - c110) < 0.005
  return { lineas, total, cuadra }
}

/** El borrador desfasado, en una frase: qué [110] tiene y cuál le toca. */
export function fraseDesfasada(t: Pick<Trimestre, 'trimestre' | 'cartera'>): string | null {
  const c = t.cartera
  if (!c.desfasada || !c.esperada_110 || !c.borrador) return null
  const tiene = c.borrador.c110 === null ? 'no tiene [110]' : `tiene la [110] en ${eurosExactos(c.borrador.c110)}`
  return `El borrador del ${t.trimestre} se calculó antes de tener el ${c.esperada_110.de} presentado: ${tiene} y le tocan ${eurosExactos(c.esperada_110.importe)}.`
}

/**
 * Lo que dice la pantalla después de volver a calcular un borrador desfasado
 * (regla 8: con contenido), como la maqueta: «Vuelto a calcular el 3T: trae
 * 3.796,17 € a compensar del 2T. El resultado del IVA aún no se sabe: falta el
 * libro de IVA del trimestre.»
 */
export function fraseRecalculado(trimestre: string, de: string, c110: number | null, conResultado = true): string {
  if (c110 === null) return `Vuelto a calcular el ${trimestre}, pero sigue sin la [110]: mira el IVA del trimestre.`
  const delAnterior = de.split('/')[0]
  const base = `Vuelto a calcular el ${trimestre}: trae ${eurosExactos(c110)} a compensar del ${delAnterior}.`
  return conResultado ? base : `${base} El resultado del IVA aún no se sabe: falta el libro de IVA del trimestre.`
}
