// src/modules/conta/documentos/escalaPdf.ts
//
// D04 · A qué resolución se pinta una página de un PDF: la del panel donde se
// ve (su ancho en píxeles CSS) por la densidad de la pantalla
// (devicePixelRatio). Antes se pintaba una vez a un tamaño y luego el
// navegador la estiraba: la COHELDI se veía borrosa, y al ampliarla, más.
//
// Núcleo puro: se prueba sin navegador.

/** Lo más que se pinta por página (píxeles de lienzo): por encima, el navegador puede quedarse sin memoria. */
export const MAX_PIXELES = 24_000_000

export interface Escala {
  /** La escala que se le pasa a pdf.js (getViewport). */
  escala: number
  /** El tamaño del lienzo, en píxeles de verdad. */
  ancho: number
  alto: number
}

/**
 * La escala para que la página ocupe `anchoCss` píxeles de pantalla con la
 * nitidez de `dpr`. `pagina` es su tamaño a escala 1 (puntos PDF).
 */
export function escalaParaPintar(anchoCss: number, pagina: { width: number; height: number }, dpr: number): Escala {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  const css = Number.isFinite(anchoCss) && anchoCss > 0 ? anchoCss : pagina.width
  let escala = (css / pagina.width) * d
  const pixeles = pagina.width * pagina.height * escala * escala
  if (pixeles > MAX_PIXELES) escala *= Math.sqrt(MAX_PIXELES / pixeles)
  return { escala, ancho: Math.floor(pagina.width * escala), alto: Math.floor(pagina.height * escala) }
}
