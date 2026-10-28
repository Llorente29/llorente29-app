// src/modules/personal/laboral/personas.ts
//
// W08 (28/10/2026). El orden de las personas en Registro de jornada: primero las
// activas y después las de baja, cada grupo por nombre. La pantalla abre con la
// primera ACTIVA: abría con la primera de la lista por nombre, y en producción
// era una persona de baja.

export interface PersonaDeLaLista { id: string; name: string; active: boolean }

/** Activas primero y después las de baja; dentro de cada grupo, por nombre. */
export function ordenarPersonas<T extends PersonaDeLaLista>(personas: readonly T[]): T[] {
  return [...personas].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'es'))
}

/** Con quién abre la pantalla si no lo dice el enlace: la primera activa (o, si no hay, la primera). */
export function personaPorDefecto(personas: readonly PersonaDeLaLista[]): string {
  return ordenarPersonas(personas)[0]?.id ?? ''
}
