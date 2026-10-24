// src/modules/conta/diseno/plantillas/Asistente.tsx
//
// S02 · La plantilla ASISTENTE (tablero 8): presentar un impuesto, dar de alta
// la empresa, cerrar el ejercicio.
//   · Pasos numerados a la izquierda, uno cada vez.
//   · Casillas por color: verde si sale de los libros, blanco si la rellena el
//     usuario, gris si la calcula Sumied. Cada casilla lleva «De dónde sale»,
//     que abre el libro de IVA filtrado. Su número oficial va a su lado
//     ([04], [06]…), comprobado en la orden del modelo (Norma del S02).
//   · «Verificado» por bloque. Abajo, «Atrás», «Guardar y seguir luego» y el
//     principal «Siguiente: …».

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icono } from '../Icono'
import { NOMBRE_ORIGEN, type OrigenCasilla } from './valores'

export interface PasoAsistente { id: string; titulo: string; apoyo?: string; estado: 'hecho' | 'actual' | 'pendiente' }

export function PasosAsistente({ pasos, etiqueta = 'Pasos' }: { pasos: readonly PasoAsistente[]; etiqueta?: string }) {
  return (
    <ol className="s-pasos" aria-label={etiqueta}>
      {pasos.map((p, i) => (
        <li key={p.id} className="s-paso" data-estado={p.estado} aria-current={p.estado === 'actual' ? 'step' : undefined}>
          <span className="s-paso-numero" aria-hidden="true">{p.estado === 'hecho' ? <Icono nombre="ok" /> : i + 1}</span>
          <span className="s-paso-texto"><span className="s-paso-titulo">{p.titulo}</span>{p.apoyo && <span className="s-paso-apoyo">{p.apoyo}</span>}</span>
        </li>
      ))}
    </ol>
  )
}


export function LeyendaCasillas() {
  return (
    <ul className="s-leyenda-casillas" aria-label="Qué es cada color">
      {(['libros', 'tu', 'sumied'] as const).map((o) => <li key={o}><span className="s-casilla-muestra" data-origen={o} aria-hidden="true" /> {NOMBRE_ORIGEN[o]}</li>)}
    </ul>
  )
}

/** Una casilla: su número oficial y su importe, del color de dónde sale. */
export function Casilla({ numero, valor, origen, etiqueta }: { numero: string; valor: string; origen: OrigenCasilla; etiqueta: string }) {
  return (
    <span className="s-casilla" data-origen={origen} title={`${etiqueta} · casilla [${numero}] · ${NOMBRE_ORIGEN[origen].toLowerCase()}`}>
      <span className="s-casilla-numero">[{numero}]</span><span className="s-cifra">{valor}</span>
    </span>
  )
}

export function BloqueAsistente({ titulo, verificado, alVerificar, children }: { titulo: string; verificado: boolean; alVerificar?: () => void; children: ReactNode }) {
  return (
    <section className="s-bloque-asistente" aria-label={titulo}>
      <div className="s-bloque-ficha-cabeza">
        <h2>{titulo}</h2>
        {verificado
          ? <span className="s-chip" data-tono="seguro"><Icono nombre="ok" /> Verificado</span>
          : alVerificar && <button type="button" className="s-boton s-boton-secundario" onClick={alVerificar}>Marcar como verificado</button>}
      </div>
      {children}
    </section>
  )
}

export function DeDondeSale({ a }: { a: string }) {
  return <Link to={a} className="s-de-donde">De dónde sale</Link>
}

export function PieAsistente({ atras, guardar, siguiente }: { atras: ReactNode; guardar?: ReactNode; siguiente: ReactNode }) {
  return <div className="s-pie-asistente"><div className="s-pie-asistente-izquierda">{atras}{guardar}</div>{siguiente}</div>
}

export function Asistente({ pasos, children }: { pasos: ReactNode; children: ReactNode }) {
  return <div className="s-asistente">{pasos}<div className="s-asistente-paso">{children}</div></div>
}
