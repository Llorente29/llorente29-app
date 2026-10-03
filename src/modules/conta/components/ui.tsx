// src/modules/conta/components/ui.tsx
//
// Piezas comunes de las pantallas de contabilidad, con el estilo de la
// maqueta (conta.css). Botones y enlaces de verdad (`button`, `a`), con foco
// visible y zonas táctiles de 44 px.

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Miga } from '@/config/navegacion'

export function Migas({ migas }: { migas: Miga[] }) {
  return (
    <nav className="cf-migas" aria-label="Estás en">
      {migas.map((m, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span aria-hidden="true">›</span>}
          {m.ruta
            ? <Link to={m.ruta}>{m.etiqueta}</Link>
            : <span className="cf-actual" aria-current="page">{m.etiqueta}</span>}
        </span>
      ))}
    </nav>
  )
}

export function Tarjeta({ titulo, children, id, estilo }: { titulo?: string; children: ReactNode; id?: string; estilo?: React.CSSProperties }) {
  return (
    <section className="cf-tarjeta" aria-labelledby={titulo && id ? `${id}-t` : undefined} id={id} style={estilo}>
      {titulo && <h2 id={id ? `${id}-t` : undefined}>{titulo}</h2>}
      {children}
    </section>
  )
}

/** Un dato de solo lectura: etiqueta pequeña encima, valor debajo. */
export function Dato({ etiqueta, valor, pie, pieClase, vacio = 'Sin anotar' }: {
  etiqueta: string; valor: ReactNode | null | undefined; pie?: ReactNode; pieClase?: string; vacio?: string
}) {
  const hay = valor !== null && valor !== undefined && valor !== ''
  return (
    <div className="cf-dato">
      <span className="cf-dato-et">{etiqueta}</span>
      {hay ? <span className="cf-dato-valor">{valor}</span> : <span className="cf-dato-vacio">{vacio}</span>}
      {pie && <span className={pieClase ?? 'cf-dato-pie'}>{pie}</span>}
    </div>
  )
}

/**
 * Un campo de formulario: etiqueta encima, ayuda, error en lenguaje normal.
 * `campo` es la clave de la ficha: da el id `campo-<campo>` al que apuntan
 * los enlaces de «Falta: …» de la barra del %.
 */
export function Campo({ campo, etiqueta, ayuda, error, aviso, children }: {
  campo: string; etiqueta: string; ayuda?: ReactNode; error?: string | null; aviso?: string | null
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode
}) {
  const id = `campo-${campo}`
  const descId = useId()
  const describe = error || aviso || ayuda ? descId : undefined
  return (
    <div className="cf-campo">
      <label htmlFor={id}>{etiqueta}</label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describe })}
      <div id={descId}>
        {error && <div className="cf-campo-error" role="alert">{error}</div>}
        {!error && aviso && <div className="cf-campo-aviso">{aviso}</div>}
        {!error && !aviso && ayuda && <div className="cf-ayuda">{ayuda}</div>}
      </div>
    </div>
  )
}

export function Hueso({ alto, ancho = '100%', radio }: { alto: number; ancho?: number | string; radio?: number }) {
  return <div className="cf-hueso" style={{ height: alto, width: ancho, borderRadius: radio }} aria-hidden="true" />
}

/** Cargando: el esqueleto de la ficha, con la forma de lo que va a salir. */
export function EsqueletoFicha({ movil }: { movil: boolean }) {
  if (movil) {
    return (
      <div aria-busy="true" aria-label="Cargando la ficha">
        <div className="cfm-cabecera"><Hueso alto={44} ancho={44} /><Hueso alto={30} ancho="70%" /><Hueso alto={50} /></div>
        <div className="cfm-cuerpo"><Hueso alto={84} /><Hueso alto={336} /></div>
      </div>
    )
  }
  return (
    <div aria-busy="true" aria-label="Cargando la ficha" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Hueso alto={18} ancho={260} />
      <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}><Hueso alto={64} ancho={64} radio={16} /><Hueso alto={64} ancho={420} /></div>
      <Hueso alto={64} />
      <Hueso alto={46} />
      <div className="cf-cifras">{[0, 1, 2, 3].map((i) => <Hueso key={i} alto={88} />)}</div>
      <Hueso alto={300} />
    </div>
  )
}

export function ErrorConReintento({ mensaje, alReintentar }: { mensaje: string; alReintentar: () => void }) {
  return (
    <div className="cf-error" role="alert">
      <span>{mensaje}</span>
      <button type="button" className="cf-boton-sec cf-boton-peq" onClick={alReintentar}>Reintentar</button>
    </div>
  )
}

export function Guardado({ texto }: { texto: string | null }) {
  return <span className="cf-guardado" role="status" aria-live="polite">{texto ?? ''}</span>
}

export function Dialogo({ titulo, children, alCerrar }: { titulo: string; children: ReactNode; alCerrar: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar() }
    window.addEventListener('keydown', tecla)
    return () => { window.removeEventListener('keydown', tecla); previo?.focus() }
  }, [alCerrar])
  return (
    <div className="cf-velo cf" style={{ background: 'rgba(27,31,36,.45)' }} onMouseDown={(e) => { if (e.target === e.currentTarget) alCerrar() }}>
      <div className="cf-dialogo" role="dialog" aria-modal="true" aria-label={titulo} ref={ref}>
        <h2>{titulo}</h2>
        {children}
      </div>
    </div>
  )
}

export function Comprobado({ children }: { children: ReactNode }) {
  return (
    <span className="cf-ok">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      {children}
    </span>
  )
}
