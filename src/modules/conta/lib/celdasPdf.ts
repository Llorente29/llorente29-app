// src/modules/conta/lib/celdasPdf.ts
//
// C02c · Las celdas de texto de un PDF ({x, y, texto} por página), leídas de las
// órdenes de dibujo con pdfjs-dist y no del texto «montado» (getTextContent).
//
// Por qué así: Diez coloca cada letra con un ajuste de posición (el TJ del PDF:
// «N[-4.6]O[11.2]R[-111.75]T[29.9]E…»). getTextContent convierte los ajustes grandes
// en un espacio que no está en el PDF, y salen nombres partidos
// como «PR OVEEDORES» o «NOR TE SOCIOS». Aquí se juntan las letras (textoDeGlifos) y el único
// espacio es el carácter espacio. Sin diccionario y sin adivinar.
//
// Recibe el módulo de pdfjs en vez de importarlo: el navegador le da el normal
// (con su worker, leerFicheros.ts) y las pruebas, el «legacy» de node. Las dos
// pasan por este mismo código.

import { textoDeGlifos, type Celda, type PaginaPdf } from '@/modules/conta/lib/lectorDiez'

/** Lo que se usa de pdfjs-dist (así no se arrastra su tipo entero ni se importa aquí). */
export interface PdfJs {
  OPS: Record<string, number>
  getDocument: (src: { data: Uint8Array; verbosity?: number; isEvalSupported?: boolean }) => {
    promise: Promise<{
      numPages: number
      getPage: (n: number) => Promise<{ getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }> }>
    }>
    /** Suelta el documento y su worker (en pdfjs 6 está en la tarea de carga, no en el documento). */
    destroy: () => Promise<void>
  }
}

type M = [number, number, number, number, number, number]
const ID: M = [1, 0, 0, 1, 0, 0]
const por = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
]
/** Los seis números de una matriz, vengan sueltos o en un array (pdfjs pasa un Float32Array en setTextMatrix). */
function seis(args: readonly unknown[]): M {
  const a = args.length === 1 && args[0] && typeof args[0] === 'object' && 'length' in (args[0] as object) ? Array.from(args[0] as ArrayLike<number>) : (args as number[])
  return [Number(a[0]), Number(a[1]), Number(a[2]), Number(a[3]), Number(a[4]), Number(a[5])]
}
const red = (n: number) => Math.round(n * 100) / 100

export async function celdasPdf(pdfjs: PdfJs, bytes: ArrayBuffer): Promise<PaginaPdf[]> {
  const O = pdfjs.OPS
  const carga = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), verbosity: 0, isEvalSupported: false })
  const paginas: PaginaPdf[] = []
  try {
    const doc = await carga.promise
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n)
      const ol = await pg.getOperatorList()
      const celdas: Celda[] = []
      let ctm: M = ID
      const pila: M[] = []
      let lm: M = ID // la matriz de línea del texto
      let leading = 0
      // Si dos showText van seguidos sin moverse, son la misma celda.
      let seguida = false
      for (let i = 0; i < ol.fnArray.length; i++) {
        const fn = ol.fnArray[i]
        const a = ol.argsArray[i] ?? []
        if (fn === O.save) pila.push(ctm)
        else if (fn === O.restore) ctm = pila.pop() ?? ID
        else if (fn === O.transform) ctm = por(seis(a), ctm)
        else if (fn === O.beginText) { lm = ID; seguida = false }
        else if (fn === O.setTextMatrix) { lm = seis(a); seguida = false }
        else if (fn === O.moveText) { lm = por([1, 0, 0, 1, Number(a[0]), Number(a[1])], lm); seguida = false }
        else if (fn === O.setLeadingMoveText) { leading = -Number(a[1]); lm = por([1, 0, 0, 1, Number(a[0]), Number(a[1])], lm); seguida = false }
        else if (fn === O.setLeading) leading = Number(a[0])
        else if (fn === O.nextLine) { lm = por([1, 0, 0, 1, 0, -leading], lm); seguida = false }
        else if (fn === O.showText || fn === O.showSpacedText || fn === O.nextLineShowText || fn === O.nextLineSetSpacingShowText) {
          if (fn === O.nextLineShowText || fn === O.nextLineSetSpacingShowText) { lm = por([1, 0, 0, 1, 0, -leading], lm); seguida = false }
          const glifos = (fn === O.nextLineSetSpacingShowText ? a[2] : a[0]) as unknown[]
          const texto = textoDeGlifos(Array.isArray(glifos) ? glifos : [])
          const p = por(lm, ctm)
          if (seguida && celdas.length) celdas[celdas.length - 1].texto += texto
          else celdas.push({ x: red(p[4]), y: red(p[5]), texto })
          seguida = true
        }
      }
      paginas.push({ celdas })
    }
  } finally {
    await carga.destroy()
  }
  return paginas
}
