// src/modules/conta/diseno/plantillas/reparto.ts
//
// D04 · El reparto de la ficha entre los datos y el documento (Julio, con la
// COHELDI en producción: los datos se llevaban dos tercios y el PDF un cuarto).
//   · Los datos, como mucho 680 px: sus campos no necesitan más.
//   · El documento, todo lo que queda (en un monitor de 1920 px, más de la mitad).
//   · Entre los dos, un separador que se arrastra (o se mueve con las flechas);
//     el ancho se recuerda por persona, en su navegador.
//
// Núcleo puro: se prueba sin React ni navegador.

/** Lo más que se llevan los datos (y lo de serie). */
export const DATOS_MAX = 680
/** Lo menos: por debajo, los campos de importe ya no caben. */
export const DATOS_MIN = 360
/** Lo que mueve cada flecha del teclado. */
export const PASO_TECLADO = 20

/** Un ancho dentro de lo que se deja, redondeado al píxel. Lo que no es un número, lo de serie. */
export function acotarAncho(px: unknown): number {
  const n = typeof px === 'number' ? px : typeof px === 'string' && px.trim() !== '' ? Number(px) : NaN
  if (!Number.isFinite(n)) return DATOS_MAX
  return Math.round(Math.min(DATOS_MAX, Math.max(DATOS_MIN, n)))
}

/** La clave del navegador, por persona (sin persona, una común). */
export const claveAncho = (usuario: string | null | undefined): string => `folvy.conta.ficha.anchoDatos.${usuario || 'anonimo'}`

/** El ancho guardado para esta persona; si no hay o no se entiende, lo de serie. */
export function leerAncho(usuario: string | null | undefined, almacen: Pick<Storage, 'getItem'> | null): number {
  try { return acotarAncho(almacen?.getItem(claveAncho(usuario)) ?? undefined) } catch { return DATOS_MAX }
}

/** Lo guarda (sin romper si el navegador no deja). */
export function guardarAncho(usuario: string | null | undefined, px: number, almacen: Pick<Storage, 'setItem'> | null): void {
  try { almacen?.setItem(claveAncho(usuario), String(acotarAncho(px))) } catch { /* sin almacén: vale para esta visita */ }
}

/** El ancho tras una tecla del separador; null si la tecla no es suya. */
export function anchoConTecla(actual: number, tecla: string): number | null {
  switch (tecla) {
    case 'ArrowLeft': return acotarAncho(actual - PASO_TECLADO)
    case 'ArrowRight': return acotarAncho(actual + PASO_TECLADO)
    case 'Home': return DATOS_MIN
    case 'End': return DATOS_MAX
    default: return null
  }
}
