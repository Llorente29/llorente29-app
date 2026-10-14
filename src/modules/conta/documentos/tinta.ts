// src/modules/conta/documentos/tinta.ts
//
// D01 R5 · 4 · Hasta dónde llega lo escrito en una página pintada (RGBA): la
// última fila con algún píxel que no sea casi blanco, más un margen. Pura (la
// prueba documentosPantalla.test.ts la mide sobre lienzos inventados). Se mira
// una columna de cada `paso` para no recorrer millones de píxeles.

export function hastaDondeHayTinta(rgba: ArrayLike<number>, ancho: number, alto: number, o: { umbral?: number; paso?: number; margen?: number } = {}): number {
  const umbral = o.umbral ?? 235
  const paso = Math.max(1, o.paso ?? 2)
  const margen = o.margen ?? Math.round(alto * 0.02)
  for (let y = alto - 1; y >= 0; y--) {
    const fila = y * ancho * 4
    for (let x = 0; x < ancho; x += paso) {
      const i = fila + x * 4
      if (rgba[i + 3] > 0 && (rgba[i] < umbral || rgba[i + 1] < umbral || rgba[i + 2] < umbral)) return Math.min(alto, y + 1 + margen)
    }
  }
  return 0
}
