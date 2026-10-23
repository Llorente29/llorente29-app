// src/modules/conta/documentos/PapelPdf.tsx
//
// D01 · N23: el PDF de la factura, pintado con pdfjs (el mismo que ya carga el
// módulo, plan/leerFicheros.ts). Un PDF dentro de un iframe no se ve en el
// Safari del móvil ni en el Chromium de las pruebas. Si no se puede pintar, lo
// dice y deja «Abrir».
//
// D04 · Nítido (Julio, con la COHELDI en producción: «se ve borroso, y al
// ampliarlo sigue borroso»). Antes se pintaba UNA vez la primera página, al
// ancho que tuviera la caja al abrir, y el navegador la estiraba. Ahora:
//   · cada página se pinta a la resolución real del panel (su ancho en píxeles
//     CSS × devicePixelRatio, escalaPdf.ts);
//   · se vuelve a pintar cada vez que cambia ese ancho: al ampliar o reducir
//     (el zoom del panel cambia el ancho de la hoja), al mover el separador o
//     al cambiar la ventana (ResizeObserver);
//   · al abrir, ocupa todo el ancho del panel;
//   · todas las páginas, una debajo de otra: se recorren con el scroll.

import { useEffect, useRef, useState } from 'react'
import { pdfjs } from '@/modules/conta/plan/leerFicheros'
import { escalaParaPintar } from '@/modules/conta/documentos/escalaPdf'

/** Lo que se usa de pdfjs para pintar (el tipo compartido solo describe la lectura de celdas). */
interface PdfParaPintar {
  getDocument: (src: { data: Uint8Array; isEvalSupported?: boolean }) => {
    promise: Promise<DocPdf>
    destroy: () => Promise<void>
  }
}
interface DocPdf { numPages: number; getPage: (n: number) => Promise<Pagina> }
interface Pagina {
  getViewport: (o: { scale: number }) => { width: number; height: number }
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void>; cancel?: () => void }
}

export function PapelPdf({ url, titulo }: { url: string; titulo: string }) {
  const caja = useRef<HTMLDivElement>(null)
  const lienzos = useRef<(HTMLCanvasElement | null)[]>([])
  const [doc, setDoc] = useState<{ url: string; doc: DocPdf | null; fallo: string | null }>({ url: '', doc: null, fallo: null })
  // El ancho del panel en píxeles CSS y la densidad de la pantalla: lo que decide la resolución.
  const [medida, setMedida] = useState<{ ancho: number; dpr: number }>({ ancho: 0, dpr: 1 })

  // 1 · Leer el PDF (una vez por dirección).
  useEffect(() => {
    let vivo = true
    let soltar: (() => Promise<void>) | null = null
    ;(async () => {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
      const pdf = (await pdfjs()) as unknown as PdfParaPintar
      const tarea = pdf.getDocument({ data: bytes, isEvalSupported: false })
      // Con su `this`: suelto (`soltar = tarea.destroy`), al salir de la página
      // antes de pintar reventaba con «Cannot set properties of undefined
      // (setting 'destroyed')» (S01, e2e de «No es una factura»).
      soltar = () => tarea.destroy()
      const d = await tarea.promise
      if (vivo) setDoc({ url, doc: d, fallo: null })
    })().catch((e: unknown) => { if (vivo) setDoc({ url, doc: null, fallo: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false; soltar?.().catch(() => {}) }
  }, [url])

  // 2 · Medir el panel, y volver a medir cuando cambie (zoom, separador, ventana).
  useEffect(() => {
    const c = caja.current
    if (!c) return
    const medir = () => {
      const ancho = Math.round(c.clientWidth)
      const dpr = window.devicePixelRatio || 1
      setMedida((m) => (m.ancho === ancho && m.dpr === dpr ? m : { ancho, dpr }))
    }
    medir()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null
    ro?.observe(c)
    window.addEventListener('resize', medir)
    return () => { ro?.disconnect(); window.removeEventListener('resize', medir) }
  }, [])

  // 3 · Pintar cada página a esa resolución; si cambia antes de acabar, se cancela y se vuelve a pintar.
  const d = doc.url === url ? doc.doc : null
  const [fallo, setFallo] = useState<string | null>(null)
  useEffect(() => {
    if (!d || medida.ancho <= 0) return
    let vivo = true
    const tareas: { cancel?: () => void }[] = []
    ;(async () => {
      for (let n = 1; n <= d.numPages && vivo; n++) {
        const pagina = await d.getPage(n)
        const c = lienzos.current[n - 1]
        if (!vivo || !c) return
        const e = escalaParaPintar(medida.ancho, pagina.getViewport({ scale: 1 }), medida.dpr)
        const vista = pagina.getViewport({ scale: e.escala })
        // Se pinta en uno aparte y se copia: el lienzo visible no se queda en blanco mientras.
        const tmp = document.createElement('canvas')
        tmp.width = e.ancho; tmp.height = e.alto
        const ctx = tmp.getContext('2d')
        if (!ctx) throw new Error('el navegador no deja pintar')
        const t = pagina.render({ canvasContext: ctx, viewport: vista })
        tareas.push(t)
        await t.promise
        if (!vivo) return
        c.width = e.ancho; c.height = e.alto
        c.getContext('2d')?.drawImage(tmp, 0, 0)
        c.dataset.anchoCss = String(medida.ancho)
        c.dataset.dpr = String(medida.dpr)
      }
      if (vivo) setFallo(null)
    })().catch((e: unknown) => {
      // Cancelado porque cambió el ancho: no es un fallo.
      if (vivo && !(e instanceof Error && /cancel/i.test(e.name + e.message))) setFallo(e instanceof Error ? e.message : String(e))
    })
    return () => { vivo = false; for (const t of tareas) t.cancel?.() }
  }, [d, medida])

  const paginas = d?.numPages ?? 1
  const noSePinta = (doc.url === url ? doc.fallo : null) ?? fallo
  return (
    <div ref={caja} className="s-papel-pdf" data-prueba="papel-pdf" data-paginas={d?.numPages ?? undefined}>
      {Array.from({ length: paginas }, (_, i) => (
        <canvas key={i} ref={(el) => { lienzos.current[i] = el }} className="cxr-papel-lienzo" role="img"
          aria-label={i === 0 ? titulo : `Página ${i + 1} de ${paginas}`} />
      ))}
      {noSePinta && <p className="cx-ayuda">No he podido pintar el PDF ({noSePinta}). Ábrelo con «Abrir».</p>}
    </div>
  )
}
