// src/modules/conta/nucleo/ejercicio.ts
//
// K02 · El ejercicio, arriba, al lado de la empresa (decisión 3 de Julio,
// 17/11): es estado del marco. En el K02 el marco lo enseña y lo cambia, y lo
// ESCRIBE en la dirección (`?ejercicio=2026`), que es donde las pantallas lo
// leen hoy (Libros, el diario). Moverlas a leerlo del marco va pantalla a
// pantalla, en su PR. Núcleo puro.

import type { Ejercicio } from '@/modules/conta/marco/periodo'

/**
 * Qué ejercicio se enseña arriba: el de la dirección, si es de esta empresa;
 * si no, el que eligió la persona en el marco; si no, el del día de hoy; si
 * no, el más reciente. Sin ejercicios dados de alta, ninguno (no se inventa).
 */
export function ejercicioAEnsenar(deLaDireccion: string | null, elegido: string | null, ejercicios: readonly Ejercicio[], hoy: string): Ejercicio | null {
  const por = (c: string | null) => (c ? ejercicios.find((e) => e.codigo === c) ?? null : null)
  return por(deLaDireccion) ?? por(elegido) ?? ejercicios.find((e) => e.desde <= hoy && hoy <= e.hasta)
    ?? [...ejercicios].sort((a, b) => b.desde.localeCompare(a.desde))[0] ?? null
}

/** Los ejercicios en el orden en que se eligen: el más reciente arriba. */
export const ejerciciosEnOrden = (ejercicios: readonly Ejercicio[]): Ejercicio[] => [...ejercicios].sort((a, b) => b.desde.localeCompare(a.desde))

/** La consulta con el ejercicio puesto (lo demás de la dirección se queda). */
export function conEjercicio(search: string, codigo: string): string {
  const q = new URLSearchParams(search)
  q.set('ejercicio', codigo)
  return `?${q.toString()}`
}
