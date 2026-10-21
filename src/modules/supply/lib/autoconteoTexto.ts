// src/modules/supply/lib/autoconteoTexto.ts
//
// EL AUTOCONTEO, EN PALABRAS DE OFICINA (encargo de Julio del 21/10).
//
// Desde la 0400 un autoconteo se aplica solo, entero, con cualquier
// diferencia: al terminarlo en la tablet, o por la noche si nadie lo terminó.
// Nadie lo aprueba, así que la pantalla ya no enseña «lo que se revisó»: enseña
// CUÁNDO se aplicó y QUÉ cambió en el stock, con las palabras con que se dice
// en una oficina («faltaban 3 ud», «sobraban 1,2 kg»), no con columnas de
// «esperaba / contado / dif.».
//
// La hora es la REAL de cuando se aplicó, en Madrid (regla 4): el cron corre a
// las 03:10 UTC, que son las 5:10 en verano y las 4:10 en invierno.
//
// Las frases están escritas contra la población real: 60 líneas de autoconteos
// aprobados de Foodint (tests/inventario/diferencias-reales.json, sin nombres),
// con su teórico en negativo, sus líneas sin referencia y sus apartadas.

export type ViaAutoconteo = 'al_terminar' | 'cron' | 'rezagado'

/** Una fila de autoconteos_sin_aplicar() (0400): lo que avisa la pantalla de inventario. */
export interface AutoconteoSinAplicar {
  countId: string
  code: string | null
  locationName: string | null
  createdAt: string
  countedLines: number
  error: string | null
  failedAt: string | null
}

const TZ = 'Europe/Madrid'

/** «5:10», en hora de Madrid. */
export function horaMadrid(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: TZ }).format(new Date(iso))
}

function diaMadrid(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ }).format(new Date(iso))
}

/** «del martes 22», en hora de Madrid. */
function delDia(iso: string): string {
  return 'del ' + new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', timeZone: TZ }).format(new Date(iso))
}

/**
 * «Aplicado solo a las 5:10». Si se aplicó otro día que el del recuento (lo
 * normal de noche: el de ayer se aplica de madrugada), se dice cuál.
 */
export function fraseDelAplicado(p: {
  via: ViaAutoconteo
  approvedAt: string
  createdAt: string
  approvedByName?: string | null
}): string {
  const otroDia = diaMadrid(p.approvedAt) !== diaMadrid(p.createdAt) ? ` ${delDia(p.approvedAt)}` : ''
  const a = `a las ${horaMadrid(p.approvedAt)}${otroDia}`
  if (p.via === 'al_terminar') {
    const quien = p.approvedByName && p.approvedByName !== 'Autoconteo' ? `, lo terminó ${p.approvedByName}` : ''
    return `Aplicado al terminar el recuento, ${a}${quien}`
  }
  if (p.via === 'rezagado') return `Aplicado solo ${a}, al preparar el recuento siguiente`
  return `Aplicado solo ${a}`
}

const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 })
const nfEur = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** «1,2 kg», «361 g», «45,24 ud». Espacio de no separación entre cifra y unidad. */
export function cantidad(v: number, unidad: string | null): string {
  const u = (unidad ?? '').toLowerCase()
  const a = Math.abs(v)
  // El menos tipográfico, como el resto de la pantalla (y no el guion).
  const signo = v < 0 ? '−' : ''
  if ((u === 'g' || u === 'ml') && a >= 1000) return `${signo}${nf2.format(a / 1000)}\u00A0${u === 'g' ? 'kg' : 'l'}`
  if (u === 'g' || u === 'ml') return `${signo}${nf0.format(a)}\u00A0${u}`
  return `${signo}${nf2.format(a)}${unidad ? `\u00A0${unidad}` : ''}`
}

/** «−2,10 €» / «+2,50 €» / null (sin coste: se dice aparte, nunca un 0 callado). */
export function euros(v: number | null): string | null {
  if (v === null) return null
  if (Math.abs(v) < 0.005) return '0,00\u00A0€'
  return `${v < 0 ? '−' : '+'}${nfEur.format(Math.abs(v))}\u00A0€`
}

export type TonoDiferencia = 'falta' | 'sobra' | 'cuadra' | 'saneado' | 'apartada' | 'sin_contar'

export interface LineaParaDiferencia {
  systemQty: number | null
  countedQty: number | null
  varianceQty: number | null
  varianceValue: number | null
  unitAbbr: string | null
  excludedAt: string | null
  excludedReason?: string | null
}

export interface Diferencia {
  tono: TonoDiferencia
  /** La frase, sin el nombre del producto: «Faltaban 3 ud». */
  texto: string
  /** «−2,10 €», o null si no hay coste con que valorarlo. */
  valor: string | null
  /** Para ordenar: lo que más pesa primero. */
  peso: number
}

const CASI_CERO = 1e-7

export function diferenciaEnPalabras(l: LineaParaDiferencia): Diferencia {
  if (l.countedQty === null) {
    return { tono: 'sin_contar', texto: 'No se contó: no entra en el ajuste', valor: null, peso: 0 }
  }
  const contado = cantidad(l.countedQty, l.unitAbbr)
  if (l.excludedAt) {
    const por = l.excludedReason ? ` («${l.excludedReason}»)` : ''
    return { tono: 'apartada', texto: `Apartada a mano${por}: no se aplica. Se contaron ${contado}`, valor: null, peso: 0 }
  }
  // El teórico estaba en negativo: el recuento lo corrige, pero no es una
  // pérdida del periodo (close_inventory_count lo valora a 0 a propósito).
  if (l.systemQty !== null && l.systemQty < 0) {
    return {
      tono: 'saneado',
      texto: `El stock decía ${cantidad(l.systemQty, l.unitAbbr)}, que no puede ser; queda en lo contado, ${contado}. No cuenta como merma`,
      valor: null,
      peso: 0,
    }
  }
  const dif = l.varianceQty ?? (l.systemQty === null ? null : l.countedQty - l.systemQty)
  if (dif === null) {
    return { tono: 'sobra', texto: `No había stock anterior con que comparar; queda en ${contado}`, valor: euros(l.varianceValue), peso: Math.abs(l.varianceValue ?? 0) }
  }
  if (Math.abs(dif) < CASI_CERO) {
    return { tono: 'cuadra', texto: `Cuadra: ${contado}`, valor: null, peso: 0 }
  }
  const valor = euros(l.varianceValue)
  const peso = Math.abs(l.varianceValue ?? 0) || Math.abs(dif) / 1e6
  if (dif < 0) return { tono: 'falta', texto: `Faltaban ${cantidad(-dif, l.unitAbbr)}; quedan ${contado}`, valor, peso }
  return { tono: 'sobra', texto: `Sobraban ${cantidad(dif, l.unitAbbr)}; quedan ${contado}`, valor, peso }
}

/** Las que cambian el stock primero (por valor), luego las saneadas; cuadran y apartadas aparte. */
export function repartirDiferencias<T extends LineaParaDiferencia>(lineas: T[]): {
  cambian: { linea: T; d: Diferencia }[]
  cuadran: { linea: T; d: Diferencia }[]
  apartadas: { linea: T; d: Diferencia }[]
  sinContar: number
} {
  const cambian: { linea: T; d: Diferencia }[] = []
  const cuadran: { linea: T; d: Diferencia }[] = []
  const apartadas: { linea: T; d: Diferencia }[] = []
  let sinContar = 0
  for (const linea of lineas) {
    const d = diferenciaEnPalabras(linea)
    if (d.tono === 'sin_contar') sinContar++
    else if (d.tono === 'apartada') apartadas.push({ linea, d })
    else if (d.tono === 'cuadra') cuadran.push({ linea, d })
    else cambian.push({ linea, d })
  }
  const orden = (t: TonoDiferencia) => (t === 'saneado' ? 1 : 0)
  cambian.sort((a, b) => orden(a.d.tono) - orden(b.d.tono) || b.d.peso - a.d.peso)
  return { cambian, cuadran, apartadas, sinContar }
}
