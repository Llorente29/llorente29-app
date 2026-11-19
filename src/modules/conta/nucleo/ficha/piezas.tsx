// src/modules/conta/nucleo/ficha/piezas.tsx
//
// K04 · Las piezas de una ficha del núcleo, medidas sobre las maquetas
// aprobadas (nucleo_1, nucleo_2 y nucleo_3). Son de la ficha, no de la
// recibida: las heredan la emitida (K05) y el asiento (K06). Propias del
// núcleo (kf-*), no las de hoy: los componentes comunes no dan esta densidad
// (rótulo de 11 px encima, casilla de 24, origen en azul a la derecha).
//
//   · Casilla: el rótulo, su origen («PDF», «por NIF»…) y lo que se escribe.
//     Con duda, el borde ámbar. Lleva data-casilla: es la lista de Intro.
//   · EstadoFicha: la pastilla de la cabecera («Rellenada por Sumied, con 1
//     duda.» en ámbar; «La escribes tú.» en gris).
//   · Comprobaciones: una línea con su visto; la que falla, en ámbar o rojo con
//     su frase, la misma de la base.
//   · Duda: la franja ámbar «Mira esto.» con el botón relleno y el hueco.
//   · AsientoQueSale: el asiento en su caja, con «Cuadra · 357,44» en verde o
//     lo que falta en ámbar, debe a la izquierda y haber a la derecha.
//   · AyudaTeclas: cada tecla en su recuadro; por debajo de 800 de alto no sale
//     (decisión 13, en el CSS).

import { useState, type ReactNode } from 'react'
import { fechaEscrita, fechaVista } from './teclas'
import './ficha.css'
import { cifra, TECLAS_DE_LA_FICHA } from './textos'

export function Casilla({ rotulo, origen, duda, ancho, htmlFor, children, accion }: {
  rotulo: string
  origen?: string | null
  duda?: boolean
  /** La parte del ancho de la fila (grid): 1 por defecto. */
  ancho?: number
  htmlFor: string
  children: ReactNode
  /** Un enlace a la derecha del rótulo, en lugar del origen. */
  accion?: ReactNode
}) {
  return (
    <div className="kf-casilla" data-duda={duda ? 'si' : undefined} style={ancho ? { gridColumn: `span ${ancho}` } : undefined}>
      <div className="kf-rotulo">
        <label htmlFor={htmlFor}>{rotulo}</label>
        {accion ?? (origen ? <span className="kf-origen" data-prueba="origen">{origen}</span> : null)}
      </div>
      {children}
    </div>
  )
}

export type TonoEstado = 'ambar' | 'gris' | 'verde'

export function EstadoFicha({ tono, fuerte, resto }: { tono: TonoEstado; fuerte: string; resto: string }) {
  return (
    <span className="kf-estado" data-tono={tono} role="status">
      <span className="kf-estado-punto" aria-hidden="true" />
      <strong>{fuerte}</strong> {resto}
    </span>
  )
}

export interface UnaComprobacion { id: string; texto: string; tono: 'bien' | 'ambar' | 'rojo' }

export function Comprobaciones({ lista, nota }: { lista: readonly UnaComprobacion[]; nota?: string | null }) {
  if (nota) return <p className="kf-comprobaciones" data-nota="si"><span className="kf-visto" aria-hidden="true">✓</span> {nota}</p>
  return (
    <ul className="kf-comprobaciones" aria-label="Comprobaciones">
      {lista.map((c) => (
        <li key={c.id} data-tono={c.tono} data-comprobacion={c.id}>
          <span className="kf-visto" aria-hidden="true">{c.tono === 'bien' ? '✓' : '!'}</span>{c.texto}
        </li>
      ))}
    </ul>
  )
}

export function Duda({ fuerte = 'Mira esto.', texto, principal, secundario }: {
  fuerte?: string
  texto: ReactNode
  principal?: { texto: string; hacer: () => void }
  secundario?: { texto: string; hacer: () => void }
}) {
  return (
    <div className="kf-duda" role="group" aria-label={fuerte}>
      <p><strong>{fuerte}</strong> {texto}</p>
      {(principal || secundario) && (
        <div className="kf-duda-botones">
          {principal && <button type="button" className="kf-boton-ambar" onClick={principal.hacer}>{principal.texto}</button>}
          {secundario && <button type="button" className="kf-boton-hueco" onClick={secundario.hacer}>{secundario.texto}</button>}
        </div>
      )}
    </div>
  )
}

export interface LineaAsiento { codigo: string; nombre: string; debe: number | null; haber: number | null; aMano?: boolean }


export function AsientoQueSale({ lineas, etiqueta, editar }: {
  lineas: readonly LineaAsiento[]
  /** «Cuadra · 357,44» (verde), lo que le falta (ámbar), o «Se forma al escribir» (verde claro). */
  etiqueta: { texto: string; tono: 'bien' | 'ambar' | 'vacio' }
  editar?: { texto: string; hacer: () => void } | null
}) {
  return (
    <section className="kf-asiento" aria-label="El asiento que sale">
      <header>
        <h3>El asiento que sale</h3>
        <span className="kf-etiqueta" data-tono={etiqueta.tono} data-prueba="cuadra">{etiqueta.texto}</span>
        <span className="kf-apoyo">Debe a la izquierda, haber a la derecha</span>
        {editar && <button type="button" className="kf-enlace kf-asiento-editar" onClick={editar.hacer}>{editar.texto}</button>}
      </header>
      {lineas.length > 0 && (
        <table>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={`${l.codigo}-${i}`} data-a-mano={l.aMano ? 'si' : undefined}>
                <td className="kf-asiento-cuenta">{l.codigo || '—'}</td>
                <td className="kf-asiento-nombre">{l.nombre}</td>
                <td className="kf-cifra">{cifra(l.debe)}</td>
                <td className="kf-cifra">{cifra(l.haber)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}


export function AyudaTeclas({ teclas = TECLAS_DE_LA_FICHA }: { teclas?: readonly { tecla: string; texto: string }[] }) {
  return (
    <footer className="kf-ayuda" aria-label="Teclas">
      {teclas.map((t) => <span key={t.tecla}><kbd>{t.tecla}</kbd> {t.texto}</span>)}
    </footer>
  )
}

/**
 * Una fecha como se escribe en ERP10 (dd/mm/aaaa, «1/7/26», «01072026»), no el
 * calendario del navegador: sale igual en cualquier idioma del navegador y se
 * escribe sin ratón. Se entiende al salir de la casilla; si no es una fecha, lo
 * dice y no la cambia.
 */
export function CasillaFecha({ id, iso, poner, hoy, etiqueta, casilla = true }: { id: string; iso: string; poner: (iso: string) => void; hoy: string; etiqueta: string; casilla?: boolean }) {
  const [texto, setTexto] = useState<string | null>(null)
  const mal = texto !== null && texto.trim() !== '' && fechaEscrita(texto, hoy) === null
  return (
    <input id={id} aria-label={etiqueta} data-casilla={casilla ? '' : undefined} inputMode="numeric" placeholder="dd/mm/aaaa"
      value={texto ?? fechaVista(iso)} aria-invalid={mal || undefined} title={mal ? 'No es una fecha: escríbela como 01/07/2026.' : undefined}
      onFocus={(e) => { setTexto(fechaVista(iso)); e.target.select() }}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => { const f = texto !== null ? fechaEscrita(texto, hoy) : null; if (f) poner(f); else if (texto !== null && texto.trim() === '') poner(''); setTexto(null) }} />
  )
}
