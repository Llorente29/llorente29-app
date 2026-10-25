// src/modules/conta/lib/verifactu/huella.ts
//
// V03 · E1 · LA HUELLA OFICIAL DE VERIFACTU, como la describe la AEAT.
//
// Fuente: «Detalle de las especificaciones técnicas para generación de la huella
// o hash de los registros de facturación», v0.1.2 (27/08/2024), §3 y §5, que
// desarrolla el art. 13 de la Orden HAC/1177/2024.
//
//   · SHA-256 sobre «nombre=valor&nombre=valor…», en el orden de la AEAT y en
//     UTF-8; cada valor sin espacios al principio ni al final.
//   · Un campo vacío va como «nombre=» (el primer registro: «Huella=»).
//   · La salida, en hexadecimal y MAYÚSCULAS: 64 caracteres.
//
// La huella de verdad la calcula la base al emitir (el registro no se edita
// nunca). Esta copia es la vara con la que se mide: las pruebas unitarias la
// comprueban con los ejemplos oficiales, y la de staging compara la de la base
// con ésta, registro a registro.

/** Los campos del registro de ALTA que entran en la huella, en su orden (§3.a). */
export interface DatosHuellaAlta {
  idEmisorFactura: string
  numSerieFactura: string
  /** DD-MM-AAAA, como va en el XML. */
  fechaExpedicionFactura: string
  tipoFactura: TipoFactura
  /** Como va en el XML: «12.35». */
  cuotaTotal: string
  importeTotal: string
  /** La huella del registro anterior; vacía en el primero de la cadena. */
  huellaAnterior: string
  /** AAAA-MM-DDThh:mm:ss±hh:mm */
  fechaHoraHusoGenRegistro: string
}

/** Los del registro de ANULACIÓN (§3.b). */
export interface DatosHuellaAnulacion {
  idEmisorFacturaAnulada: string
  numSerieFacturaAnulada: string
  fechaExpedicionFacturaAnulada: string
  huellaAnterior: string
  fechaHoraHusoGenRegistro: string
}

/** Lista L2 de la Orden: F1 completa, F2 simplificada, F3 sustitutiva de simplificadas, R1–R5 rectificativas. */
export type TipoFactura = 'F1' | 'F2' | 'F3' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5'

const v = (s: string | null | undefined) => (s ?? '').trim()

export function cadenaAlta(d: DatosHuellaAlta): string {
  return [
    `IDEmisorFactura=${v(d.idEmisorFactura)}`,
    `NumSerieFactura=${v(d.numSerieFactura)}`,
    `FechaExpedicionFactura=${v(d.fechaExpedicionFactura)}`,
    `TipoFactura=${v(d.tipoFactura)}`,
    `CuotaTotal=${v(d.cuotaTotal)}`,
    `ImporteTotal=${v(d.importeTotal)}`,
    `Huella=${v(d.huellaAnterior)}`,
    `FechaHoraHusoGenRegistro=${v(d.fechaHoraHusoGenRegistro)}`,
  ].join('&')
}

export function cadenaAnulacion(d: DatosHuellaAnulacion): string {
  return [
    `IDEmisorFacturaAnulada=${v(d.idEmisorFacturaAnulada)}`,
    `NumSerieFacturaAnulada=${v(d.numSerieFacturaAnulada)}`,
    `FechaExpedicionFacturaAnulada=${v(d.fechaExpedicionFacturaAnulada)}`,
    `Huella=${v(d.huellaAnterior)}`,
    `FechaHoraHusoGenRegistro=${v(d.fechaHoraHusoGenRegistro)}`,
  ].join('&')
}

export async function sha256Mayusculas(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto)
  const h = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

export const huellaAlta = (d: DatosHuellaAlta) => sha256Mayusculas(cadenaAlta(d))
export const huellaAnulacion = (d: DatosHuellaAnulacion) => sha256Mayusculas(cadenaAnulacion(d))

/** Lo que valida la AEAT de una huella (Validaciones v1.2.2, §3.1.3.18): 64 hexadecimales en mayúsculas. */
export const esHuella = (h: string) => /^[0-9A-F]{64}$/.test(h)

// ── Formatos del XML (los mismos que entran en la huella) ──────────────────

/** «2026-10-24» → «24-10-2026». */
export function fechaAeat(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) throw new Error(`Fecha no válida: ${iso}`)
  return `${m[3]}-${m[2]}-${m[1]}`
}

/** Un importe con punto y dos decimales: 123.4 → «123.40»; −3.9 → «-3.90». */
export function importeAeat(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Importe no válido: ${n}`)
  const centimos = Math.round(Math.abs(n) * 100)
  const signo = n < 0 && centimos > 0 ? '-' : ''
  return `${signo}${Math.floor(centimos / 100)}.${String(centimos % 100).padStart(2, '0')}`
}

/**
 * El instante en hora de Madrid con su huso, sin milisegundos:
 * 2026-10-24T16:01:12Z → «2026-10-24T18:01:12+02:00» (verano) o «…+01:00» (invierno).
 */
export function fechaHoraHusoMadrid(instante: Date): string {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instante)
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value])) as Record<string, string>
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  const minutos = Math.round((local - Math.floor(instante.getTime() / 1000) * 1000) / 60000)
  const signo = minutos >= 0 ? '+' : '-'
  const a = Math.abs(minutos)
  const huso = `${signo}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${huso}`
}
