// src/modules/conta/lib/ejercicios.ts
//
// Regla 3 del núcleo del C00 (§5): los ejercicios de una empresa van sin
// solapes ni huecos, y un mes cerrado no admite cambios con fecha dentro de
// él. Los meses se cierran en orden y solo se reabre el último cerrado (con
// motivo). La base lo garantiza también (conta_cerrar_mes / conta_reabrir_mes
// y el disparador de fiscal_year); esto es lo que la pantalla sabe ANTES de
// pedirlo, para decirlo en palabras.

export interface Ejercicio { code: string; startsOn: string; endsOn: string }

const dia = (iso: string) => new Date(`${iso}T00:00:00Z`)
const masUnDia = (iso: string) => { const d = dia(iso); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
/** AAAA-MM-01 del mes de una fecha. */
export const mesDe = (iso: string) => `${iso.slice(0, 7)}-01`

/** Los problemas de una lista de ejercicios, en frases. Vacía = bien. */
export function problemasDeEjercicios(lista: Ejercicio[]): string[] {
  const out: string[] = []
  const orden = [...lista].sort((a, b) => a.startsOn.localeCompare(b.startsOn))
  for (const e of orden) {
    if (e.endsOn < e.startsOn) out.push(`El ejercicio ${e.code} acaba antes de empezar.`)
    const tope = dia(e.startsOn); tope.setUTCFullYear(tope.getUTCFullYear() + 1)
    if (dia(e.endsOn) >= tope) out.push(`El ejercicio ${e.code} pasa de doce meses.`)
  }
  for (let i = 1; i < orden.length; i++) {
    const a = orden[i - 1]; const b = orden[i]
    if (b.startsOn <= a.endsOn) out.push(`Los ejercicios ${a.code} y ${b.code} se pisan.`)
    else if (masUnDia(a.endsOn) !== b.startsOn) out.push(`Entre el ${a.code} y el ${b.code} hay un hueco: el ${b.code} tendría que empezar el ${masUnDia(a.endsOn)}.`)
  }
  return out
}

/** Los meses (AAAA-MM-01) de un ejercicio, en orden. */
export function mesesDe(e: Ejercicio): string[] {
  const out: string[] = []
  let m = mesDe(e.startsOn)
  while (m <= e.endsOn) {
    out.push(m)
    const d = dia(m); d.setUTCMonth(d.getUTCMonth() + 1); m = d.toISOString().slice(0, 10)
  }
  return out
}

/** ¿Está cerrado el mes de esta fecha? `cerrados` = meses AAAA-MM-01 con cierre vivo. */
export function mesCerrado(cerrados: string[], fecha: string): boolean {
  return cerrados.includes(mesDe(fecha))
}

/** ¿Se puede apuntar algo con esta fecha? Si no, por qué. */
export function sePuedeApuntar(cerrados: string[], fecha: string): { ok: true } | { ok: false; motivo: string } {
  return mesCerrado(cerrados, fecha)
    ? { ok: false, motivo: 'Ese mes está cerrado: para cambiar algo con esa fecha hay que reabrirlo, y queda apuntado quién y por qué.' }
    : { ok: true }
}

/** El mes que toca cerrar ahora (el primero abierto del ejercicio), o null si están todos. */
export function siguienteMesACerrar(e: Ejercicio, cerrados: string[]): string | null {
  return mesesDe(e).find((m) => !cerrados.includes(m)) ?? null
}

/** El único mes que se puede reabrir: el último cerrado. */
export function mesQueSePuedeReabrir(cerrados: string[]): string | null {
  return [...cerrados].sort().at(-1) ?? null
}
