// src/modules/conta/marco/periodo.ts
//
// S02 · Lo que dice el botón del periodo de la cabecera (encargo S02,
// «Cabecera»; decisión 3 de Julio, 22/10): sale SOLO en las pantallas que leen
// el periodo, y donde sale es siempre el mismo control, en el mismo sitio, con
// el mismo formato: «Octubre 2026 · Ejercicio 2026 · abierto». Una pantalla
// que lee el ejercicio entero dice «Ejercicio 2026 · abierto». Núcleo puro.

export interface Ejercicio {
  /** El código del ejercicio (fiscal_year.code): «2026». */
  codigo: string
  desde: string
  hasta: string
  estado: 'open' | 'closed'
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const mayuscula = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

/** «2026-10» → «Octubre 2026». */
export function nombreDelMes(mes: string): string {
  const y = mes.slice(0, 4)
  const m = Number(mes.slice(5, 7))
  return m >= 1 && m <= 12 ? `${mayuscula(MESES[m - 1])} ${y}` : mes
}

/** El ejercicio en el que cae un día ('YYYY-MM-DD'), o null si no hay ninguno dado de alta. */
export function ejercicioDelDia(dia: string, ejercicios: readonly Ejercicio[]): Ejercicio | null {
  return ejercicios.find((e) => e.desde <= dia && dia <= e.hasta) ?? null
}

/** «abierto» o «cerrado». */
export const estadoDelEjercicio = (e: Ejercicio): string => (e.estado === 'closed' ? 'cerrado' : 'abierto')

/**
 * Las dos líneas del botón. De un mes: «Octubre 2026» y «Ejercicio 2026 ·
 * abierto». De un ejercicio: «Ejercicio 2026» y «abierto». Sin ejercicio dado de
 * alta para esa fecha, se dice («sin ejercicio»): no se inventa un estado.
 */
export function textoDelPeriodo(p: { mes: string } | { ejercicio: string }, ejercicios: readonly Ejercicio[]): { arriba: string; abajo: string; entero: string } {
  if ('mes' in p) {
    const e = ejercicioDelDia(`${p.mes}-01`, ejercicios)
    const arriba = nombreDelMes(p.mes)
    const abajo = e ? `Ejercicio ${e.codigo} · ${estadoDelEjercicio(e)}` : 'sin ejercicio dado de alta'
    return { arriba, abajo, entero: `${arriba} · ${abajo}` }
  }
  const e = ejercicios.find((x) => x.codigo === p.ejercicio) ?? null
  const arriba = `Ejercicio ${p.ejercicio}`
  const abajo = e ? estadoDelEjercicio(e) : 'sin dar de alta'
  return { arriba, abajo, entero: `${arriba} · ${abajo}` }
}
