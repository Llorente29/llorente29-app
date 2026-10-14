// src/modules/conta/documentos/PapelPdf.tsx
//
// D01 · N23: la primera página del PDF de la factura, pintada como imagen a la
// izquierda (maqueta N23Revisar). Un PDF dentro de un iframe no se ve en el
// Safari del móvil ni en el Chromium de las pruebas: por eso se pinta con
// pdfjs, el mismo que ya carga el módulo (plan/leerFicheros.ts), y solo cuando
// llega un PDF. Si no se puede pintar, lo dice y deja «Abrir».
//
// R5 · 4: al pintar, mide hasta dónde llega la tinta (`hastaDondeHayTinta`) y
// lo dice con `alMedir`, para que el móvil recorte el papel a la altura de lo
// escrito y no a la de la hoja en blanco.

import { useEffect, useRef, useState } from 'react'
import { pdfjs } from '@/modules/conta/plan/leerFicheros'
import { hastaDondeHayTinta } from '@/modules/conta/documentos/tinta'

/** Lo que se usa de pdfjs para pintar (el tipo compartido solo describe la lectura de celdas). */
interface PdfParaPintar {
  getDocument: (src: { data: Uint8Array; isEvalSupported?: boolean }) => {
    promise: Promise<{ numPages: number; getPage: (n: number) => Promise<Pagina> }>
    destroy: () => Promise<void>
  }
}
interface Pagina {
  getViewport: (o: { scale: number }) => { width: number; height: number }
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> }
}

export function PapelPdf({ url, titulo, alMedir }: { url: string; titulo: string; alMedir?: (altoCss: number) => void }) {
  const lienzo = useRef<HTMLCanvasElement>(null)
  const [estado, setEstado] = useState<{ url: string; paginas: number | null; fallo: string | null }>({ url: '', paginas: null, fallo: null })

  useEffect(() => {
    let vivo = true
    let soltar: (() => Promise<void>) | null = null
    ;(async () => {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
      const pdf = (await pdfjs()) as unknown as PdfParaPintar
      const tarea = pdf.getDocument({ data: bytes, isEvalSupported: false })
      soltar = tarea.destroy
      const doc = await tarea.promise
      const pagina = await doc.getPage(1)
      const c = lienzo.current
      if (!vivo || !c) return
      // Al ancho de su caja, con la densidad de la pantalla (nítido en el móvil).
      const ancho = c.parentElement?.clientWidth || 600
      const base = pagina.getViewport({ scale: 1 })
      const escala = (ancho / base.width) * (window.devicePixelRatio || 1)
      const vista = pagina.getViewport({ scale: escala })
      c.width = Math.floor(vista.width)
      c.height = Math.floor(vista.height)
      c.style.width = `${ancho}px`
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('el navegador no deja pintar')
      await pagina.render({ canvasContext: ctx, viewport: vista }).promise
      if (!vivo) return
      if (alMedir) {
        const img = ctx.getImageData(0, 0, c.width, c.height)
        alMedir(hastaDondeHayTinta(img.data, c.width, c.height) / (window.devicePixelRatio || 1))
      }
      setEstado({ url, paginas: doc.numPages, fallo: null })
    })().catch((e: unknown) => { if (vivo) setEstado({ url, paginas: null, fallo: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false; void soltar?.() }
  // alMedir no cambia lo que se pinta: no vuelve a pintar por él.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const e = estado.url === url ? estado : null
  return (
    <>
      <canvas ref={lienzo} role="img" aria-label={titulo} className="cxr-papel-lienzo" />
      {e?.fallo && <p className="cx-ayuda">No he podido pintar el PDF ({e.fallo}). Ábrelo con «Abrir».</p>}
      {e?.paginas && e.paginas > 1 && <p className="cx-ayuda">Página 1 de {e.paginas}: el resto, con «Abrir».</p>}
    </>
  )
}
