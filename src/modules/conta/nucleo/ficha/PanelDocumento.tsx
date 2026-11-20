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
//   · E05 · Bancos: «Qué es» va primero y se abre en ella (otraPrimero), y sin
//     justificante la zona de soltar dice «Falta el justificante» (tituloSoltar).
//   · K06 · La raya entre el formulario y el documento (Julio, 19/11), en la
//     recibida, la emitida y el asiento (raya): se arrastra (o se mueve con las
//     flechas) y Sumied recuerda el reparto de cada usuario. Desde 1600 px de
//     ancho, la mitad para el documento si no se ha movido nunca; por debajo,
//     el de la maqueta. El formulario tiene un ancho mínimo (--kf-min-form, el
//     que tiene a 1366 sin cortar nada) y la raya no pasa de ahí. Al abrir otro
//     documento, la lupa vuelve al 100 %: ajustado al ancho de su hueco.
//   · Lo que dice sin documento, el de cada pantalla (sinDocumentoTexto): en el
//     asiento, «Este asiento no tiene justificante».

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { PapelPdf } from '@/modules/conta/documentos/PapelPdf'
import { anchoDelDocumento, guardarReparto, leerReparto, repartoDeSalida } from './reparto'

const ZOOM = [50, 75, 100, 125, 150, 200] as const

export interface SinDocumento { marcado: boolean; motivo: string; poner: (marcado: boolean, motivo: string) => void }

export function PanelDocumento({ documento, otra, alElegir, acepta, textoSoltar, tituloSoltar, sinDocumento, otraPrimero = false, accion, sinDocumentoTexto, raya }: {
  /** El documento: su dirección y si es una foto; null = sin documento; undefined = cargando. */
  documento: { url: string; foto: boolean; titulo: string } | null | undefined
  /** La segunda pestaña: su nombre y lo que enseña. */
  otra: { nombre: string; contenido: ReactNode }
  /** Sin documento: lo que se hace con el fichero elegido o soltado. Sin esto, no hay zona de soltar. */
  alElegir?: (f: File) => void
  acepta?: string
  textoSoltar?: string
  /** El título de la zona de soltar (por defecto, «Arrastra aquí el PDF o una foto»). */
  tituloSoltar?: string
  /** La otra pestaña va primero y se abre en ella (Bancos: «Qué es»). */
  otraPrimero?: boolean
  /** «Sin documento», con su motivo: sin él, una factura sin PDF no se valida (paraValidar.faltaDocumento). */
  sinDocumento?: SinDocumento
  /** Q06 · Lo que va arriba a la derecha, al lado de las pestañas (el listado: «Abrir el asiento»). */
  accion?: ReactNode
  /** Q06 · Lo que dice sin documento y sin zona de soltar (por defecto, «Esta factura no tiene documento.»). */
  sinDocumentoTexto?: string
  /** K06 · La raya que se arrastra, y de quién es el reparto que se recuerda (su id de usuario; null: no se recuerda). */
  raya?: { usuario: string | null }
}) {
  const [ver, setVer] = useState<'documento' | 'otra'>(otraPrimero ? 'otra' : 'documento')
  const [zoom, setZoom] = useState<(typeof ZOOM)[number]>(100)
  // Otro documento se abre ajustado al ancho de su hueco: la lupa, al 100 %.
  const url = documento?.url ?? ''
  const [deUrl, setDeUrl] = useState(url)
  if (deUrl !== url) { setDeUrl(url); setZoom(100) }
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
      {raya && <Raya usuario={raya.usuario} />}
      <div className="kf-panel-arriba">
        <div className="kf-segmentos" role="tablist" aria-label="Qué se ve">
          {otraPrimero && <button type="button" role="tab" aria-selected={ver === 'otra'} onClick={() => setVer('otra')}>{otra.nombre}</button>}
          <button type="button" role="tab" aria-selected={ver === 'documento'} onClick={() => setVer('documento')}>El documento</button>
          {!otraPrimero && <button type="button" role="tab" aria-selected={ver === 'otra'} onClick={() => setVer('otra')}>{otra.nombre}</button>}
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
              <strong>{tituloSoltar ?? 'Arrastra aquí el PDF o una foto'}</strong>
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

/** La rejilla de la ficha (.kf-cuerpo): el padre del panel en el que va la raya. */
const cuerpoDe = (raya: HTMLElement | null) => raya?.parentElement?.parentElement ?? null

/** Pone la parte del documento en la rejilla (null: la de la maqueta) y la dice en la raya (aria-valuenow). */
function aplicar(raya: HTMLElement | null, x: number | null) {
  const c = cuerpoDe(raya)
  if (!c || !raya) return
  if (x === null) { c.style.removeProperty('--kf-doc'); delete c.dataset.raya; raya.removeAttribute('aria-valuenow'); return }
  c.style.setProperty('--kf-doc', `${Math.round(x * 10000) / 100}%`)
  c.dataset.raya = 'si'
  raya.setAttribute('aria-valuenow', String(Math.round(x * 100)))
}

/**
 * K06 · La raya entre el formulario y el documento. Pone en la rejilla de la ficha (.kf-cuerpo, el padre del panel)
 * la parte del documento (--kf-doc) y el CSS la sujeta: el formulario nunca por debajo de su mínimo (--kf-min-form).
 * La parte vive en la rejilla y en un ref: arrastrar no vuelve a pintar la ficha.
 */
function Raya({ usuario }: { usuario: string | null }) {
  const yo = useRef<HTMLDivElement>(null)
  const parte = useRef<number | null>(null)
  const poner = (x: number | null) => { parte.current = x; aplicar(yo.current, x) }
  // Al abrir: lo que recuerda de este usuario; si nunca la ha movido, la mitad desde 1600 px y, por debajo, la maqueta.
  useLayoutEffect(() => {
    const raya = yo.current
    const x = repartoDeSalida(leerReparto(usuario), window.innerWidth)
    parte.current = x
    aplicar(raya, x)
    return () => aplicar(raya, null)
  }, [usuario])
  /** La parte del documento que cabe, para un ancho del documento en píxeles (la sujeta el mínimo del formulario). */
  const sujetar = (doc: number) => {
    const c = cuerpoDe(yo.current)
    if (!c) return null
    const ancho = c.getBoundingClientRect().width
    const min = parseFloat(getComputedStyle(c).getPropertyValue('--kf-min-form')) || 680
    return anchoDelDocumento(doc, ancho, min) / ancho
  }
  const arrastrando = useRef(false)
  const alBajar = (e: PointerEvent<HTMLDivElement>) => { e.preventDefault(); arrastrando.current = true; e.currentTarget.setPointerCapture(e.pointerId) }
  const alMover = (e: PointerEvent<HTMLDivElement>) => {
    if (!arrastrando.current) return
    const c = cuerpoDe(yo.current)
    if (!c) return
    const x = sujetar(c.getBoundingClientRect().right - e.clientX)
    if (x !== null) poner(x)
  }
  const alSoltar = (e: PointerEvent<HTMLDivElement>) => {
    if (!arrastrando.current) return
    arrastrando.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (parte.current !== null) guardarReparto(usuario, parte.current)
  }
  const alPulsar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault(); e.stopPropagation()
    const c = cuerpoDe(yo.current)
    if (!c) return
    const ahora = c.querySelector(':scope > .kf-panel')?.getBoundingClientRect().width ?? c.getBoundingClientRect().width / 2
    const x = sujetar(ahora + (e.key === 'ArrowLeft' ? 24 : -24))
    if (x !== null) { poner(x); guardarReparto(usuario, x) }
  }
  return (
    <div ref={yo} className="kf-raya" role="separator" aria-orientation="vertical" aria-label="El reparto entre el formulario y el documento"
      aria-valuemin={0} aria-valuemax={100} tabIndex={0}
      title="Arrástrala para dar más sitio al documento o al formulario" data-prueba="raya-panel"
      onPointerDown={alBajar} onPointerMove={alMover} onPointerUp={alSoltar} onPointerCancel={alSoltar} onKeyDown={alPulsar} />
  )
}
