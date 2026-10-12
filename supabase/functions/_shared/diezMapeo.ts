// supabase/functions/_shared/diezMapeo.ts
//
// C04b · T3 · Núcleo puro: un asiento de Diez en la forma de Folvy, su huella
// y la comparación de un día entre los dos. Sin red y sin base: lo usan la
// edge function y las pruebas.
//
// Reglas del encargo que viven aquí:
//   1. Cuadrar al céntimo. Todo se cuenta en CÉNTIMOS enteros; un asiento que
//      no cuadra no se convierte: se devuelve el porqué.
//   2. Idempotencia. La clave es la de Diez (ejercicio, serie, documento) y la
//      huella es de lo que dice el asiento, no de cuándo se leyó: leer dos veces
//      lo mismo da la misma huella.
//   6. Comparar por día (Diez no usa analítica): cuántos asientos, debe, haber
//      y, asiento a asiento, la huella.
//
// Lo que Folvy no admite y Diez sí, y cómo se trae SIN cambiar el saldo de
// ninguna cuenta (cada cambio queda contado en `ajustes`):
//   · línea a cero (ni debe ni haber): no se trae;
//   · importe negativo: pasa al otro lado en positivo (debe −10 = haber 10);
//   · debe y haber en la misma línea: dos líneas.

import type { Apunte, DetalleApunte } from './diezCliente.ts'

export const SERIES_FOLVY = [1, 2, 3, 4, 9] as const

export type LineaFolvy = {
  posicion: number
  cuenta: string
  debe: number // céntimos
  haber: number // céntimos
  concepto: string | null
  contrapartida: string | null
  justificante: string | null
  /** Si en Diez este importe iba en NEGATIVO, en qué lado estaba: Folvy lo
   *  muestra («En Diez iba en negativo») para contrastar el diario línea a línea. */
  negativoEnDiez: 'debe' | 'haber' | null
}
export type AsientoFolvy = {
  ejercicio: string
  serie: number
  numero: number
  fecha: string // AAAA-MM-DD
  concepto: string
  tipoAsiento: number | null
  lineas: LineaFolvy[]
  debe: number // céntimos
  haber: number
  huella: string
  ajustes: { lineasACero: number; negativos: number; partidas: number }
}
export type Rechazo = { clave: string; motivo: string }

export const cent = (n: unknown): number => {
  const x = Number(n ?? 0)
  if (!Number.isFinite(x)) throw new Error(`Importe no numérico: ${String(n)}`)
  return Math.round(x * 100)
}
export const euros = (c: number) => (c / 100).toFixed(2)

/** 20260930 → '2026-09-30', comprobando que la fecha existe. */
export function fechaIso(aaaammdd: unknown): string {
  const s = String(aaaammdd ?? '')
  if (!/^\d{8}$/.test(s)) throw new Error(`Fecha de Diez no válida: ${s || '(vacía)'}`)
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new Error(`Fecha de Diez no válida: ${s}`)
  return iso
}

export const claveDiez = (a: { Ejercicio?: unknown; Serie?: unknown; Documento?: unknown }) =>
  `${String(a.Ejercicio ?? '?')}/${String(a.Serie ?? '?')}/${String(a.Documento ?? '?')}`

const texto = (s: unknown) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length ? t : null
}

// SHA-256 en hexadecimal, igual en Deno y en Node (crypto.subtle).
async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/**
 * La huella de un asiento: clave, fecha y líneas (cuenta, debe, haber en
 * céntimos), en el orden de Diez. El texto no entra: cambiar una descripción
 * en Diez no es una diferencia contable.
 */
export function huellaDe(a: { ejercicio: string; serie: number; numero: number; fecha: string; lineas: Pick<LineaFolvy, 'cuenta' | 'debe' | 'haber'>[] }) {
  return sha256(JSON.stringify([a.ejercicio, a.serie, a.numero, a.fecha, a.lineas.map((l) => [l.cuenta, l.debe, l.haber])]))
}

/** Un asiento de Diez en la forma de Folvy, o el porqué de que no se pueda. */
export async function convertirAsiento(a: Apunte): Promise<{ ok: AsientoFolvy } | { rechazo: Rechazo }> {
  const clave = claveDiez(a)
  const no = (motivo: string) => ({ rechazo: { clave, motivo } })
  const serie = Number(a.Serie)
  if (!(SERIES_FOLVY as readonly number[]).includes(serie)) return no(`serie ${String(a.Serie)} no está entre las de Folvy (${SERIES_FOLVY.join(', ')})`)
  const numero = Number(a.Documento)
  if (!Number.isInteger(numero) || numero <= 0) return no('sin número de documento')
  if (!/^\d{4}$/.test(String(a.Ejercicio ?? ''))) return no('ejercicio no válido')
  let fecha: string
  try { fecha = fechaIso(a.Fecha) } catch (e) { return no((e as Error).message) }

  const ajustes = { lineasACero: 0, negativos: 0, partidas: 0 }
  const lineas: LineaFolvy[] = []
  const detalles: DetalleApunte[] = [...(a.Detalles ?? [])].sort((x, y) => (Number(x.Linea) || 0) - (Number(y.Linea) || 0))
  for (const d of detalles) {
    const cuenta = String(d.Cuenta ?? '').trim()
    if (!/^\d{3,12}$/.test(cuenta)) return no(`línea ${d.Linea ?? '?'}: cuenta no válida`)
    const debeDiez = cent(d.Debe), haberDiez = cent(d.Haber)
    // Lo que acaba en cada lado de Folvy y de qué lado de Diez sale.
    const alDebe = Math.max(debeDiez, 0) + Math.max(-haberDiez, 0)
    const alHaber = Math.max(haberDiez, 0) + Math.max(-debeDiez, 0)
    if (debeDiez < 0) ajustes.negativos++
    if (haberDiez < 0) ajustes.negativos++
    const comun = { cuenta, concepto: texto(d.Descripcion), contrapartida: texto(d.Contrapartida), justificante: texto(d.Justificante) }
    // Un lado de Folvy lleva la marca si algo de lo suyo era un negativo del otro.
    const marcaDebe = haberDiez < 0 ? 'haber' as const : null
    const marcaHaber = debeDiez < 0 ? 'debe' as const : null
    if (alDebe === 0 && alHaber === 0) { ajustes.lineasACero++; continue }
    if (alDebe > 0 && alHaber > 0) {
      ajustes.partidas++
      lineas.push({ posicion: 0, ...comun, debe: alDebe, haber: 0, negativoEnDiez: marcaDebe }, { posicion: 0, ...comun, debe: 0, haber: alHaber, negativoEnDiez: marcaHaber })
    } else if (alDebe > 0) lineas.push({ posicion: 0, ...comun, debe: alDebe, haber: 0, negativoEnDiez: marcaDebe })
    else lineas.push({ posicion: 0, ...comun, debe: 0, haber: alHaber, negativoEnDiez: marcaHaber })
  }
  if (lineas.length < 2) return no(`${lineas.length} línea${lineas.length === 1 ? '' : 's'} con importe`)
  lineas.forEach((l, i) => (l.posicion = i + 1))
  const debe = lineas.reduce((s, l) => s + l.debe, 0)
  const haber = lineas.reduce((s, l) => s + l.haber, 0)
  if (debe !== haber) return no(`descuadrado: debe ${euros(debe)} y haber ${euros(haber)}`)

  const concepto = texto(a.Descripcion) ?? lineas.find((l) => l.concepto)?.concepto ?? `Asiento ${serie}/${numero} traído de Diez`
  const base = { ejercicio: String(a.Ejercicio), serie, numero, fecha, lineas }
  return { ok: { ...base, concepto, tipoAsiento: a.TipoAsiento ?? null, debe, haber, huella: await huellaDe(base), ajustes } }
}

// ── Comparar un día ─────────────────────────────────────────────────────────
export type ResumenAsiento = { clave: string; huella: string; debe: number; haber: number }
export type Diferencia =
  | { tipo: 'solo_folvy'; clave: string }
  | { tipo: 'solo_diez'; clave: string }
  | { tipo: 'distinto'; clave: string; folvy: { debe: number; haber: number }; diez: { debe: number; haber: number } }
export type ComparacionDia = {
  dia: string
  estado: 'igual' | 'distinto' | 'solo_folvy' | 'solo_diez'
  folvy: { n: number; debe: number; haber: number }
  diez: { n: number; debe: number; haber: number }
  diferencias: Diferencia[]
}

/**
 * Compara los asientos de un día, uno a uno por su clave de Diez. «igual» es
 * mismos asientos con la misma huella; si solo hay de un lado, ese lado; si
 * no, «distinto» con cada diferencia (sin importes de terceros: solo claves y
 * sumas, que es lo que se guarda en external_compare_day).
 */
export function compararDia(dia: string, folvy: ResumenAsiento[], diez: ResumenAsiento[]): ComparacionDia {
  const suma = (xs: ResumenAsiento[]) => ({ n: xs.length, debe: xs.reduce((s, x) => s + x.debe, 0), haber: xs.reduce((s, x) => s + x.haber, 0) })
  const F = new Map(folvy.map((x) => [x.clave, x])), D = new Map(diez.map((x) => [x.clave, x]))
  if (F.size !== folvy.length || D.size !== diez.length) throw new Error(`Clave repetida en el día ${dia}`)
  const diferencias: Diferencia[] = []
  for (const [k, f] of F) {
    const d = D.get(k)
    if (!d) diferencias.push({ tipo: 'solo_folvy', clave: k })
    else if (d.huella !== f.huella) diferencias.push({ tipo: 'distinto', clave: k, folvy: { debe: f.debe, haber: f.haber }, diez: { debe: d.debe, haber: d.haber } })
  }
  for (const k of D.keys()) if (!F.has(k)) diferencias.push({ tipo: 'solo_diez', clave: k })
  diferencias.sort((a, b) => a.clave.localeCompare(b.clave))
  const estado = diferencias.length === 0 ? 'igual' : folvy.length === 0 ? 'solo_diez' : diez.length === 0 ? 'solo_folvy' : 'distinto'
  return { dia, estado, folvy: suma(folvy), diez: suma(diez), diferencias }
}
