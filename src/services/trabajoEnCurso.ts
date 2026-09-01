// src/services/trabajoEnCurso.ts
//
// «NUNCA EN MITAD DE UN PEDIDO» (Julio, 01/09).
//
// La tablet se recarga sola cuando hay versión nueva, porque no tiene a nadie
// delante que pulse un botón. Pero recargar mientras hay comandas vivas en
// pantalla es peor que quedarse en la versión vieja: la cocina pierde de vista
// lo que está haciendo justo cuando más mira.
//
// Este registro es la frontera entre las dos cosas. El vigía de versión NO
// sabe qué es un pedido, y no debe saberlo. Las pantallas que sí lo saben
// declaran aquí cuánto trabajo tienen encima, y el vigía solo pregunta
// «¿puedo?». Si mañana hay otra cosa que tampoco se puede interrumpir —un
// conteo a medias, una comanda editándose— se declara aquí y el vigía no
// cambia.
//
// Se declara por CLAVE para que dos pantallas montadas a la vez no se pisen:
// la última en decir «0» no puede borrar el «3» de la otra.

const registro = new Map<string, number>()

/**
 * Declara cuántas unidades de trabajo tiene abiertas una pantalla.
 * `0` = esta pantalla está libre. Llamar con 0 al desmontar.
 */
export function declaraTrabajoEnCurso(clave: string, cuantas: number): void {
  if (cuantas <= 0) registro.delete(clave)
  else registro.set(clave, cuantas)
}

/** ¿Hay algo abierto en cualquier pantalla? */
export function hayTrabajoEnCurso(): boolean {
  for (const n of registro.values()) if (n > 0) return true
  return false
}

/** Cuánto, y de quién. Para poder decirlo en pantalla en vez de solo callarse. */
export function detalleTrabajoEnCurso(): { clave: string; cuantas: number }[] {
  return Array.from(registro, ([clave, cuantas]) => ({ clave, cuantas }))
    .filter(x => x.cuantas > 0)
    .sort((a, b) => b.cuantas - a.cuantas)
}

/** Solo para los tests. */
export function _vaciaRegistro(): void {
  registro.clear()
}
