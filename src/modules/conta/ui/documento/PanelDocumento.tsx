// src/modules/conta/ui/documento/PanelDocumento.tsx
//
// M01 · Pieza común · El panel del documento (maqueta N30 §6): a la derecha
// del formulario, unos 420 px, fondo #E9EDF3. El PDF o la foto, con −, +,
// «Cambiar» y «Ocultar ›». Ocultarlo deja el formulario a todo el ancho y se
// recuerda (en el marco, por usuario y en el navegador: preferencias.ts).
// Debajo, el recuadro «Por qué lo propongo así».
//
// Fuera del marco (una prueba) se recuerda solo mientras la pantalla vive.
// Sin documento dice que no hay, con «Subir» si la pantalla deja: regla 7, el
// hueco no desaparece sin decir por qué.

import { useState, type ReactNode } from 'react'
import { useMarco } from '@/modules/conta/marco/nuevo/contexto'
import { siguienteZoom, ZOOM_INICIAL } from '@/modules/conta/ui/documento/zoom'

export interface PropsPanelDocumento {
  /** «Factura F-2026-118 · Distribuciones Prueba». */
  titulo: string
  /** La dirección del fichero (firmada si es privado); null si aún no hay. */
  url: string | null
  tipo: 'pdf' | 'imagen'
  /** «Cambiar» (subir otro) o, sin documento, «Subir». */
  alCambiar?: () => void
  /** El recuadro «Por qué lo propongo así». */
  porque?: ReactNode
}

export function PanelDocumento({ titulo, url, tipo, alCambiar, porque }: PropsPanelDocumento) {
  const marco = useMarco()
  const [ocultoSuelto, setOcultoSuelto] = useState(false)
  const oculto = marco ? marco.documentoOculto : ocultoSuelto
  const ocultar = (v: boolean) => (marco ? marco.ocultarDocumento(v) : setOcultoSuelto(v))
  const [zoom, setZoom] = useState(ZOOM_INICIAL)

  if (oculto) {
    return (
      <aside className="cxdoc cxdoc-oculto" aria-label="Documento">
        <button type="button" className="cxdoc-mostrar" aria-expanded="false" onClick={() => ocultar(false)}>‹ Documento</button>
      </aside>
    )
  }
  return (
    <aside className="cxdoc" aria-label="Documento">
      <div className="cxdoc-barra">
        <span className="cxdoc-titulo" title={titulo}>{titulo}</span>
        <button type="button" className="cxdoc-boton" onClick={() => setZoom((z) => siguienteZoom(z, -1))} disabled={!url} aria-label="Alejar">−</button>
        <span className="cxdoc-zoom cxm-cifra" aria-live="polite">{zoom} %</span>
        <button type="button" className="cxdoc-boton" onClick={() => setZoom((z) => siguienteZoom(z, 1))} disabled={!url} aria-label="Acercar">+</button>
        {alCambiar && <button type="button" className="cxdoc-boton" onClick={alCambiar}>{url ? 'Cambiar' : 'Subir'}</button>}
        <button type="button" className="cxdoc-boton" aria-expanded="true" onClick={() => ocultar(true)}>Ocultar ›</button>
      </div>
      <div className="cxdoc-hoja">
        {!url
          ? <p className="cxdoc-nada">Aún no hay documento.{alCambiar ? ' Súbelo con «Subir» y lo pongo aquí.' : ''}</p>
          : tipo === 'imagen'
            ? <img src={url} alt={titulo} style={{ width: `${zoom}%` }} />
            : <iframe src={`${url}#zoom=${zoom}`} title={titulo} />}
      </div>
      {porque && (
        <section className="cxdoc-porque" aria-label="Por qué lo propongo así">
          <h3 className="cxdoc-porque-titulo">Por qué lo propongo así</h3>
          <div>{porque}</div>
        </section>
      )}
    </aside>
  )
}
