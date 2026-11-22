// src/modules/conta/nucleo/piezas/Documento.tsx
//
// K12 · Piezas comunes 8 y 11: el documento a la derecha, con su zoom (− 100 % +), «Adjuntar el documento» y
// «Pantalla completa»; y el separador entre la pantalla y el documento, que se mueve arrastrándolo (o con ← →) y con
// «‹» pliega la pantalla del todo (y «›» la despliega). Sumied recuerda el ancho de cada persona EN LA BASE
// (conta_user_pref.reparto_documento), no en el navegador: abre igual en otro ordenador. Si no se puede leer ni
// guardar, sale el de siempre y no falla nada.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { PapelPdf } from '@/modules/conta/documentos/PapelPdf'
import { guardarRepartoDocumento, leerRepartoDocumento } from '@/modules/conta/services/asientoGeneralService'
import { PLEGADO, parteDeSalida, parteQueCabe } from './logica'

const ZOOM = [50, 75, 100, 125, 150, 200] as const

/** 8 · El documento a la derecha. Sin documento, lo que diga la pantalla (`vacio`). */
export function DocumentoDerecha({ documento, alAdjuntar, acepta = 'application/pdf,image/*', vacio, adjuntando = false }: {
  documento: { url: string; foto: boolean; titulo: string } | null | undefined
  alAdjuntar?: (f: File) => void; acepta?: string; vacio?: ReactNode; adjuntando?: boolean
}) {
  const [zoom, setZoom] = useState<(typeof ZOOM)[number]>(100)
  const i = ZOOM.indexOf(zoom)
  const fichero = useRef<HTMLInputElement>(null)
  const caja = useRef<HTMLDivElement>(null)
  const [encima, setEncima] = useState(false)
  const completa = () => { if (documento) window.open(documento.url, '_blank', 'noopener'); else void caja.current?.requestFullscreen?.() }
  return (
    <aside className="kp-documento" aria-label="El documento" ref={caja} data-pieza="documento" data-encima={encima ? 'si' : undefined}
      onDragOver={alAdjuntar ? (e) => { e.preventDefault(); setEncima(true) } : undefined} onDragLeave={() => setEncima(false)}
      onDrop={alAdjuntar ? (e) => { e.preventDefault(); setEncima(false); const f = e.dataTransfer.files[0]; if (f) alAdjuntar(f) } : undefined}>
      <div className="kp-documento-barra">
        <button type="button" aria-label="Reducir" disabled={i <= 0 || !documento} onClick={() => setZoom(ZOOM[i - 1])}>−</button>
        <span aria-live="polite">{zoom} %</span>
        <button type="button" aria-label="Ampliar" disabled={i >= ZOOM.length - 1 || !documento} onClick={() => setZoom(ZOOM[i + 1])}>+</button>
        {alAdjuntar && (
          <button type="button" className="kp-documento-accion" disabled={adjuntando} onClick={() => fichero.current?.click()}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M8 12.5l6.4-6.4a3 3 0 1 1 4.2 4.2l-8 8a5 5 0 0 1-7-7l7.6-7.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            {adjuntando ? 'Adjuntando…' : 'Adjuntar el documento'}
          </button>
        )}
        {alAdjuntar && <input ref={fichero} type="file" accept={acepta} hidden aria-label="El documento" data-prueba="adjuntar-documento"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) alAdjuntar(f); e.target.value = '' }} />}
        <button type="button" className="kp-documento-accion" onClick={completa}>
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
          Pantalla completa
        </button>
      </div>
      <div className="kp-documento-cuerpo">
        {documento === undefined ? <p className="kp-documento-vacio" aria-busy="true">Cargando el documento…</p>
          : documento ? (
            <div className="kp-hoja" style={{ width: `${zoom}%` }}>
              {documento.foto ? <img src={documento.url} alt={documento.titulo} /> : <PapelPdf url={documento.url} titulo={documento.titulo} />}
            </div>
          ) : <div className="kp-documento-vacio">{vacio}</div>}
      </div>
    </aside>
  )
}

/**
 * 11 · La pantalla y el documento, con el separador en medio. `minimo`: lo menos que ocupa la pantalla sin plegar
 * (lo que tiene a 1366 sin cortar nada). `persona`: de quién es el ancho que se recuerda (sin ella, no se recuerda).
 */
export function ConDocumento({ izquierda, derecha, persona, minimo }: {
  izquierda: ReactNode; derecha: ReactNode; persona: { cuenta: string; usuario: string } | null; minimo: number
}) {
  const caja = useRef<HTMLDivElement>(null)
  const [parte, setParte] = useState<number>(() => parteDeSalida(null, typeof window === 'undefined' ? 1366 : window.innerWidth))
  const antes = useRef<number>(parte < PLEGADO ? parte : parteDeSalida(null, 1366))
  const cuenta = persona?.cuenta ?? null
  const usuario = persona?.usuario ?? null
  useEffect(() => {
    if (!cuenta || !usuario) return
    let vivo = true
    void leerRepartoDocumento(cuenta, usuario).then((x) => { if (vivo && x !== null) { setParte(x); if (x < PLEGADO) antes.current = x } })
    return () => { vivo = false }
  }, [cuenta, usuario])
  // El ancho de la caja, para decir (y guardar) la parte que de verdad cabe: la pedida, sujeta por los dos mínimos.
  const [ancho, setAncho] = useState(0)
  useEffect(() => {
    const c = caja.current
    if (!c || typeof ResizeObserver === 'undefined') return
    const o = new ResizeObserver((es) => setAncho(es[0]?.contentRect.width ?? 0))
    o.observe(c)
    return () => o.disconnect()
  }, [])
  const guardar = (x: number) => { if (cuenta && usuario) void guardarRepartoDocumento(cuenta, usuario, x).catch(() => undefined) }
  const sujetar = (docPx: number) => {
    const ancho = caja.current?.getBoundingClientRect().width ?? 0
    return parteQueCabe(docPx, ancho, minimo)
  }
  const arrastrando = useRef(false)
  const alBajar = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault(); arrastrando.current = true; e.currentTarget.setPointerCapture(e.pointerId)
  }
  const alMover = (e: PointerEvent<HTMLDivElement>) => {
    if (!arrastrando.current || !caja.current) return
    const x = sujetar(caja.current.getBoundingClientRect().right - e.clientX)
    setParte(x); antes.current = x
  }
  const alSoltar = (e: PointerEvent<HTMLDivElement>) => {
    if (!arrastrando.current) return
    arrastrando.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    guardar(parte)
  }
  const alPulsar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault(); e.stopPropagation()
    if (parte >= PLEGADO) return
    const x = sujetar(efectiva * (caja.current?.getBoundingClientRect().width ?? 0) + (e.key === 'ArrowLeft' ? 24 : -24))
    setParte(x); antes.current = x; guardar(x)
  }
  const plegada = parte >= PLEGADO
  const efectiva = plegada ? PLEGADO : ancho > 0 ? parteQueCabe(parte * ancho, ancho, minimo) : parte
  const plegar = () => { const x = plegada ? antes.current : PLEGADO; setParte(x); guardar(x) }
  return (
    <div className="kp-con-documento" ref={caja} data-plegada={plegada ? 'si' : undefined}
      style={{ ['--kp-doc' as string]: plegada ? '100%' : `${Math.round(efectiva * 10000) / 100}%`, ['--kp-min' as string]: `${minimo}px` }}>
      <div className="kp-con-documento-izq" hidden={plegada}>{izquierda}</div>
      <div className="kp-separador" role="separator" aria-orientation="vertical" aria-label="El separador entre la pantalla y el documento"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(efectiva * 100)} tabIndex={0} data-pieza="separador"
        title="Arrástralo para dar más sitio al documento o a la pantalla"
        onPointerDown={alBajar} onPointerMove={alMover} onPointerUp={alSoltar} onPointerCancel={alSoltar} onKeyDown={alPulsar}>
        <button type="button" className="kp-plegar" aria-label={plegada ? 'Desplegar la pantalla' : 'Plegar la pantalla'} onClick={plegar}>{plegada ? '›' : '‹'}</button>
      </div>
      <div className="kp-con-documento-der">{derecha}</div>
    </div>
  )
}
