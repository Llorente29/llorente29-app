// src/modules/conta/nucleo/ficha/PanelDocumento.tsx
//
// K04 · El panel de la derecha de una ficha del núcleo (maquetas nucleo_1 y
// nucleo_2): gris, con sus dos pestañas («El documento» y la otra que diga la
// ficha: «El mayor del proveedor» en la recibida), la lupa (− 100 % +) y
// «Pantalla completa».
//
//   · El documento, a su ancho: el PDF lo pinta PapelPdf (el de la ficha de
//     hoy, nítido a cualquier ancho); una foto, como imagen. La lupa cambia el
//     ancho de la hoja y PapelPdf la vuelve a pintar.
//   · Sin documento, la zona de soltar: «Arrastra aquí el PDF o una foto», que
//     también se pulsa (y se llega con el teclado) para elegirlo.
//   · El resaltado de lo leído no entra (decisión 14).

import { useRef, useState, type ReactNode } from 'react'
import { PapelPdf } from '@/modules/conta/documentos/PapelPdf'

const ZOOM = [50, 75, 100, 125, 150, 200] as const

export interface SinDocumento { marcado: boolean; motivo: string; poner: (marcado: boolean, motivo: string) => void }

export function PanelDocumento({ documento, otra, alElegir, acepta, textoSoltar, sinDocumento, accion, sinDocumentoTexto }: {
  /** El documento: su dirección y si es una foto; null = sin documento; undefined = cargando. */
  documento: { url: string; foto: boolean; titulo: string } | null | undefined
  /** La segunda pestaña: su nombre y lo que enseña. */
  otra: { nombre: string; contenido: ReactNode }
  /** Sin documento: lo que se hace con el fichero elegido o soltado. Sin esto, no hay zona de soltar. */
  alElegir?: (f: File) => void
  acepta?: string
  textoSoltar?: string
  /** «Sin documento», con su motivo: sin él, una factura sin PDF no se valida (paraValidar.faltaDocumento). */
  sinDocumento?: SinDocumento
  /** Q06 · Lo que va arriba a la derecha, al lado de las pestañas (el listado: «Abrir el asiento»). */
  accion?: ReactNode
  /** Q06 · Lo que dice sin documento y sin zona de soltar (por defecto, «Esta factura no tiene documento.»). */
  sinDocumentoTexto?: string
}) {
  const [ver, setVer] = useState<'documento' | 'otra'>('documento')
  const [zoom, setZoom] = useState<(typeof ZOOM)[number]>(100)
  const [encima, setEncima] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  const elegir = useRef<HTMLInputElement>(null)
  const i = ZOOM.indexOf(zoom)
  const completa = () => {
    if (documento) { window.open(documento.url, '_blank', 'noopener'); return }
    void caja.current?.requestFullscreen?.()
  }
  return (
    <aside className="kf-panel" aria-label="El documento" ref={caja}>
      <div className="kf-panel-arriba">
        <div className="kf-segmentos" role="tablist" aria-label="Qué se ve">
          <button type="button" role="tab" aria-selected={ver === 'documento'} onClick={() => setVer('documento')}>El documento</button>
          <button type="button" role="tab" aria-selected={ver === 'otra'} onClick={() => setVer('otra')}>{otra.nombre}</button>
        </div>
        {accion && <span className="kf-panel-accion">{accion}</span>}
      </div>
      <div className="kf-panel-lupa">
        <button type="button" aria-label="Reducir" disabled={i <= 0 || ver !== 'documento'} onClick={() => setZoom(ZOOM[i - 1])}>−</button>
        <span aria-live="polite">{zoom} %</span>
        <button type="button" aria-label="Ampliar" disabled={i >= ZOOM.length - 1 || ver !== 'documento'} onClick={() => setZoom(ZOOM[i + 1])}>+</button>
        <button type="button" className="kf-boton-hueco" onClick={completa}>Pantalla completa</button>
      </div>
      <div className="kf-panel-cuerpo" data-ver={ver}>
        {ver === 'otra' ? otra.contenido
          : documento === undefined ? <p className="kf-panel-nota" aria-busy="true">Cargando el documento…</p>
          : documento ? (
            <div className="kf-hoja" style={{ width: `${zoom}%` }}>
              {documento.foto ? <img src={documento.url} alt={documento.titulo} /> : <PapelPdf url={documento.url} titulo={documento.titulo} />}
            </div>
          ) : alElegir ? (
            <button type="button" className="kf-soltar" data-encima={encima ? 'si' : undefined}
              onClick={() => elegir.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setEncima(true) }} onDragLeave={() => setEncima(false)}
              onDrop={(e) => { e.preventDefault(); setEncima(false); const f = e.dataTransfer.files[0]; if (f) alElegir(f) }}>
              <span className="kf-soltar-flecha" aria-hidden="true">⤒</span>
              <strong>Arrastra aquí el PDF o una foto</strong>
              <span>{textoSoltar ?? 'Sumied lo lee y rellena la ficha. También puedes guardar la factura sin documento.'}</span>
              <input ref={elegir} type="file" accept={acepta} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) alElegir(f); e.target.value = '' }} />
            </button>
          ) : <p className="kf-panel-nota">{sinDocumentoTexto ?? 'Esta factura no tiene documento.'}</p>}
        {ver === 'documento' && documento === null && sinDocumento && (
          <div className="kf-sin-documento">
            <label><input type="checkbox" checked={sinDocumento.marcado} onChange={(e) => sinDocumento.poner(e.target.checked, sinDocumento.motivo)} /> Guardarla sin documento</label>
            {sinDocumento.marcado && (
              <input aria-label="Por qué no tiene documento" placeholder="Por qué (por ejemplo: «el proveedor no la manda»)" value={sinDocumento.motivo}
                onChange={(e) => sinDocumento.poner(true, e.target.value)} />
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
