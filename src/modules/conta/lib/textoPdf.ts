// src/modules/conta/lib/textoPdf.ts
//
// V02 · Entrega 2 · El texto de un PDF por líneas, como lo deja `pdftotext
// -layout`: las piezas de la misma altura en una línea, de izquierda a derecha,
// y un hueco de dos espacios entre dos columnas. Lo usan los lectores que leen
// un PDF por sus etiquetas (la liquidación de Glovo). Puro: recibe las piezas
// que da pdfjs (su texto, su x, su y y su ancho), página a página.

export interface PiezaPdf { str: string; x: number; y: number; w: number }

/** Las piezas de una página → sus líneas, de arriba abajo. */
export function lineasDePagina(piezas: readonly PiezaPdf[], tolerancia = 2): string[] {
  const filas: { y: number; ps: PiezaPdf[] }[] = []
  for (const p of piezas) {
    if (!p.str) continue
    const f = filas.find((x) => Math.abs(x.y - p.y) <= tolerancia)
    if (f) f.ps.push(p)
    else filas.push({ y: p.y, ps: [p] })
  }
  return filas
    .sort((a, b) => b.y - a.y)
    .map((f) => {
      const ps = [...f.ps].sort((a, b) => a.x - b.x)
      let linea = ''
      let fin = -Infinity
      for (const p of ps) {
        const hueco = p.x - fin
        if (linea) linea += hueco > 12 ? '   ' : hueco > 1 ? ' ' : ''
        linea += p.str
        fin = p.x + p.w
      }
      return linea.replace(/\s+$/, '')
    })
    .filter((l) => l.trim() !== '')
}

/** Todas las páginas, una tras otra. */
export const textoDePaginas = (paginas: readonly (readonly PiezaPdf[])[]): string => paginas.map((p) => lineasDePagina(p).join('\n')).join('\n\n')
