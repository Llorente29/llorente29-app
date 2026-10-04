// src/modules/conta/proveedor/piezas.tsx
//
// Las piezas de la ficha y la lista de proveedores en el estilo nuevo (C01b,
// maquetas N4Proveedor y M4Proveedor). Botones y enlaces de verdad, foco
// visible, zonas de 44 px y etiqueta encima de cada campo. Los estilos están
// en ../estilo/proveedor.css y los colores, solo en tokens.css.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Miga } from '@/config/navegacion'
import { Hueso } from '@/modules/conta/ui/piezas'
import { useFicha } from '@/modules/conta/proveedor/contexto'

/** Migas pequeñas encima del nombre: «Cocina › Proveedores». */
export function Migas({ migas }: { migas: Miga[] }) {
  return (
    <nav className="cxp-migas" aria-label="Estás en">
      {migas.map((m, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span aria-hidden="true">›</span>}
          {m.ruta ? <Link to={m.ruta}>{m.etiqueta}</Link> : <span aria-current="page">{m.etiqueta}</span>}
        </span>
      ))}
    </nav>
  )
}

/**
 * Un campo: etiqueta encima, ayuda, y el fallo o el aviso debajo en lenguaje
 * normal. `campo` es la clave de la ficha y da el id `campo-<campo>`, adonde
 * llevan los enlaces de «Falta: …».
 */
export function Campo({ campo, etiqueta, ayuda, error, aviso, children }: {
  campo: string; etiqueta: string; ayuda?: ReactNode; error?: string | null; aviso?: string | null
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode
}) {
  const id = `campo-${campo}`
  const descId = useId()
  const describe = error || aviso || ayuda ? descId : undefined
  return (
    <div className="cx-campo">
      <label htmlFor={id}>{etiqueta}</label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describe })}
      <div id={descId}>
        {error && <div className="cx-error" role="alert">{error}</div>}
        {!error && aviso && <div className="cx-aviso">{aviso}</div>}
        {!error && !aviso && ayuda && <span className="cx-ayuda">{ayuda}</span>}
      </div>
    </div>
  )
}

export interface OpcionPildora<V extends string> {
  valor: V
  texto: string
  /** Lo guardado que las tablas ya no ofrecen (regla 30): sale, y lo dice. */
  nota?: string
}

/**
 * Píldoras para elegir (IVA, retención, plazo, tipo de NIF…): nunca texto
 * libre. Con `varias`, se pueden marcar varias (IVA). Cada píldora es un botón
 * con aria-pressed; el grupo lleva su etiqueta y el id del campo, para que los
 * enlaces de «Falta: …» lleguen hasta él.
 */
export function Pildoras<V extends string>({ campo, etiqueta, opciones, elegidas, alCambiar, varias = false, ayuda, aviso, error }: {
  campo: string; etiqueta: string; opciones: OpcionPildora<V>[]; elegidas: readonly V[]
  alCambiar: (nuevas: V[]) => void; varias?: boolean; ayuda?: ReactNode; aviso?: string | null; error?: string | null
}) {
  const idEtiqueta = useId()
  return (
    <div className="cx-campo" role="group" aria-labelledby={idEtiqueta} id={`campo-${campo}`} tabIndex={-1}>
      <span className="cx-etiqueta" id={idEtiqueta}>{etiqueta}</span>
      <div className="cx-tablas-filtros">
        {opciones.map((o) => {
          const marcada = elegidas.includes(o.valor)
          return (
            <button key={o.valor} type="button" className="cx-pildora" aria-pressed={marcada} title={o.nota}
              onClick={() => alCambiar(varias
                ? (marcada ? elegidas.filter((x) => x !== o.valor) : [...elegidas, o.valor])
                : (marcada ? [] : [o.valor]))}>
              {o.texto}{o.nota ? ' *' : ''}
            </button>
          )
        })}
      </div>
      {opciones.some((o) => o.nota) && <span className="cx-ayuda">* {opciones.find((o) => o.nota)?.nota}</span>}
      {error && <div className="cx-error" role="alert">{error}</div>}
      {!error && aviso && <div className="cx-aviso">{aviso}</div>}
      {!error && !aviso && ayuda && <span className="cx-ayuda">{ayuda}</span>}
    </div>
  )
}

/**
 * «Se guarda al salir del campo» y, cuando se ha guardado, qué (regla 8:
 * con contenido, no un visto). Discreto: una línea pequeña en verde.
 */
export function SeGuarda({ texto, ocupado }: { texto: string | null; ocupado?: boolean }) {
  return (
    <div role="status" aria-live="polite" className="cxp-guardado-discreto">
      {ocupado ? 'Guardando…' : texto ?? <span className="cxp-se-guarda">Se guarda al salir del campo.</span>}
    </div>
  )
}

/** Una ventana encima de la ficha. Escape y el fondo la cierran; el foco vuelve adonde estaba. */
export function Dialogo({ titulo, children, alCerrar }: { titulo: string; children: ReactNode; alCerrar: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const cerrar = useRef(alCerrar)
  useEffect(() => { cerrar.current = alCerrar }, [alCerrar])
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar.current() }
    window.addEventListener('keydown', tecla)
    return () => { window.removeEventListener('keydown', tecla); previo?.focus() }
  }, [])
  return (
    <div className="cxp-velo cx" onMouseDown={(e) => { if (e.target === e.currentTarget) alCerrar() }}>
      <div className="cxp-dialogo" role="dialog" aria-modal="true" aria-label={titulo} ref={ref}>
        <h2>{titulo}</h2>
        {children}
      </div>
    </div>
  )
}

/** La píldora del NIF de la cabecera: verde «✓ comprobado», «Comprobando con la UE…» o ámbar. */
export function PildoraNif() {
  const { datos: { ficha: f }, comprobandoVies } = useFicha()
  if (!f.taxId) return <span className="cx-chip cx-chip-ambar">Sin NIF</span>
  if (f.taxIdType === 'vat_eu' && (comprobandoVies || f.taxIdCheckStatus === 'pending')) {
    return <span className="cx-chip cx-chip-ambar" role="status">{f.taxId} · Comprobando con la UE…</span>
  }
  if (f.taxIdCheckStatus === 'valid' && f.taxIdVerifiedAt) return <span className="cx-chip cx-chip-ia">{f.taxId} ✓ comprobado</span>
  if (f.taxIdCheckStatus === 'invalid') return <span className="cx-chip cx-chip-ambar">{f.taxId} · no válido</span>
  if (f.taxIdType === 'foreign') return <span className="cx-chip">{f.taxId}</span>
  return <span className="cx-chip cx-chip-ambar">{f.taxId} · sin comprobar</span>
}

/** Lo mismo en una línea de texto (cabecera del móvil). */
export function TextoNif() {
  const { datos: { ficha: f }, comprobandoVies } = useFicha()
  if (!f.taxId) return <span className="cx-chip-ambar" style={{ background: 'none' }}>Sin NIF</span>
  if (f.taxIdType === 'vat_eu' && (comprobandoVies || f.taxIdCheckStatus === 'pending')) return <span>{f.taxId} · Comprobando con la UE…</span>
  if (f.taxIdCheckStatus === 'valid' && f.taxIdVerifiedAt) return <span>{f.taxId} <span className="cxm-ok">✓ comprobado</span></span>
  return <span>{f.taxId}</span>
}

/** Cargando: el esqueleto con la forma de lo que va a salir. */
export function EsqueletoFicha({ movil }: { movil: boolean }) {
  if (movil) {
    return (
      <div aria-busy="true" aria-label="Cargando la ficha" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Hueso alto={46} ancho={46} />
        <Hueso alto={52} ancho="80%" />
        <Hueso alto={52} />
        <Hueso alto={84} />
        <Hueso alto={340} />
      </div>
    )
  }
  return (
    <div aria-busy="true" aria-label="Cargando la ficha" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}><Hueso alto={60} ancho={60} /><Hueso alto={60} ancho={420} /></div>
      <Hueso alto={68} />
      <div className="cxp-cifras">{[0, 1, 2, 3].map((i) => <Hueso key={i} alto={96} />)}</div>
      <div className="cxp-columnas"><div className="cxp-col-ancha"><Hueso alto={320} /></div><div className="cxp-col-estrecha"><Hueso alto={320} /></div></div>
    </div>
  )
}

/** «Hecho» con su deshacer al lado (marcar como pagada). Se va solo a los 12 s. */
export function HechoConDeshacer({ texto, deshacer, alIrse }: { texto: string; deshacer?: () => Promise<void>; alIrse: () => void }) {
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const irse = useRef(alIrse)
  useEffect(() => { irse.current = alIrse }, [alIrse])
  useEffect(() => { const t = window.setTimeout(() => irse.current(), 12000); return () => window.clearTimeout(t) }, [texto])
  return (
    <div role="status" aria-live="polite">
      <div className="cxp-hecho">
        <span>{texto}</span>
        {deshacer && (
          <button type="button" className="cx-enlace" disabled={ocupado} style={{ color: 'var(--cx-verde-oscuro)' }}
            onClick={async () => {
              setOcupado(true); setFallo(null)
              try { await deshacer() } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo deshacer.'); setOcupado(false) }
            }}>{ocupado ? 'Deshaciendo…' : 'Deshacer'}</button>
        )}
      </div>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
    </div>
  )
}

export function IconoTelefono() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
}

export function IconoCamara() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
}
