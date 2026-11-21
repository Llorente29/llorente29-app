// src/modules/conta/nucleo/ficha/reparto.ts
//
// K06 · El reparto entre el formulario y el documento de una ficha del núcleo
// (la raya del panel), sin React: lo que se recuerda de cada usuario, lo que
// sale al abrir y cuánto puede ocupar el documento.
//
// Se recuerda en este navegador, por usuario (localStorage, con su id en la
// clave): si no se puede leer o escribir (navegación privada), sale el de
// siempre y no falla nada.

/** Desde este ancho de ventana, la mitad para el documento si nunca se ha movido (Julio, 19/11). */
export const ANCHO_MITAD = 1600
/** Lo menos que ocupa el documento, en píxeles. */
export const DOCUMENTO_MINIMO = 240

const clave = (usuario: string) => `folvy.conta.nucleo.reparto.${usuario}`

/** La parte del documento (0–1) que recuerda este usuario, o null. */
export function leerReparto(usuario: string | null): number | null {
  if (!usuario) return null
  try {
    const x = Number(window.localStorage.getItem(clave(usuario)))
    return Number.isFinite(x) && x > 0 && x < 1 ? x : null
  } catch { return null }
}

export function guardarReparto(usuario: string | null, parte: number): void {
  if (!usuario || !(parte > 0 && parte < 1)) return
  try { window.localStorage.setItem(clave(usuario), String(Math.round(parte * 10000) / 10000)) } catch { /* sin almacén: no se recuerda */ }
}

/** La parte del documento al abrir: la recordada; si no, la mitad desde 1600 px; si no, null (la de la maqueta). */
export function repartoDeSalida(recordada: number | null, anchoVentana: number): number | null {
  if (recordada !== null) return recordada
  return anchoVentana >= ANCHO_MITAD ? 0.5 : null
}

/** El ancho del documento que cabe: entre su mínimo y lo que deja el mínimo del formulario. */
export function anchoDelDocumento(pedido: number, ancho: number, minimoFormulario: number): number {
  const max = Math.max(DOCUMENTO_MINIMO, ancho - minimoFormulario)
  return Math.min(max, Math.max(DOCUMENTO_MINIMO, pedido))
}
