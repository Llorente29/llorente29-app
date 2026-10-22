// src/modules/conta/diseno/plantillas/Bandeja.tsx
//
// S02 · La plantilla BANDEJA (tablero 1, Inicio): todo lo pendiente de todos
// los apartados, con «Empezar».
//   · Cuatro cifras: dinero en tus bancos, te deben, debes e IVA del
//     trimestre. Cada una lleva a su lista.
//   · «Te toca hoy»: una fila por tipo de pendiente, con su número y
//     «Empezar». El total de la cabecera ES la suma de las filas (se calcula
//     aquí, no se pasa: no puede no cuadrar).
//   · A la derecha, los próximos impuestos y «Lo que ha hecho Sumied desde
//     ayer», con Ver y Deshacer por lote.
// Con la cola vacía, «Todo al día» (regla 2 del patrón).

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icono } from '../Icono'
import type { NombreIcono } from '../iconos'
import { totalTeToca } from './valores'

export interface CifraBandeja { etiqueta: string; valor: string; apoyo: string; a: string }
export interface FilaTeToca { id: string; icono: NombreIcono; titulo: string; apoyo: string; n: number; a: string; accion?: string; aviso?: boolean }

export function CifrasBandeja({ cifras }: { cifras: readonly CifraBandeja[] }) {
  return (
    <div className="s-bandeja-cifras">
      {cifras.map((c) => (
        <Link key={c.etiqueta} to={c.a} className="s-bandeja-cifra">
          <span className="s-bandeja-cifra-etiqueta">{c.etiqueta}</span>
          <span className="s-bandeja-cifra-valor s-cifra">{c.valor}</span>
          <span className="s-bandeja-cifra-apoyo">{c.apoyo}</span>
        </Link>
      ))}
    </div>
  )
}


export function TeTocaHoy({ filas, titulo = 'Te toca hoy' }: { filas: readonly FilaTeToca[]; titulo?: string }) {
  const total = totalTeToca(filas)
  return (
    <section className="s-bandeja-bloque" aria-label={titulo}>
      <div className="s-bandeja-bloque-cabeza"><h2>{titulo}</h2><span className="s-bandeja-total">{total === 0 ? 'Todo al día' : `${total.toLocaleString('es-ES')} en total`}</span></div>
      {filas.length === 0 && <p className="s-bandeja-nada">Todo al día: no hay nada esperando una decisión tuya.</p>}
      <ul className="s-bandeja-filas">
        {filas.map((f) => (
          <li key={f.id} className="s-bandeja-fila">
            <span className="s-bandeja-icono" data-aviso={f.aviso ? '' : undefined}><Icono nombre={f.icono} /></span>
            <span className="s-bandeja-fila-texto"><span className="s-bandeja-fila-titulo">{f.titulo}</span><span className="s-bandeja-fila-apoyo">{f.apoyo}</span></span>
            <Link to={f.a} className="s-boton s-boton-secundario">{f.accion ?? 'Empezar'}</Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** La bandeja entera: las cifras arriba; «Te toca hoy» a la izquierda y lo de al lado a la derecha. */
export function Bandeja({ cifras, principal, lateral }: { cifras: ReactNode; principal: ReactNode; lateral?: ReactNode }) {
  return (
    <div className="s-bandeja">
      {cifras}
      <div className="s-bandeja-cuerpo">
        <div className="s-bandeja-principal">{principal}</div>
        {lateral && <div className="s-bandeja-lateral">{lateral}</div>}
      </div>
    </div>
  )
}

/** «Lo que ha hecho Sumied desde ayer»: cada lote con Ver y, si se puede, Deshacer los N. */
export function HechoAutomatico({ lotes, verTodo }: {
  lotes: readonly { id: string; texto: string; ver: string; deshacer?: { texto: string; alPulsar: () => void } }[]
  verTodo: string
}) {
  return (
    <section className="s-bandeja-bloque s-bandeja-hecho" aria-label="Lo que ha hecho Sumied desde ayer">
      <h2><Icono nombre="ia" /> Lo que ha hecho Sumied desde ayer</h2>
      {lotes.length === 0 && <p className="s-bandeja-nada">Desde ayer no ha hecho nada solo.</p>}
      <ul className="s-bandeja-filas">
        {lotes.map((l) => (
          <li key={l.id} className="s-bandeja-hecho-fila">
            <span>{l.texto}</span>
            <span className="s-bandeja-hecho-acciones">
              <Link to={l.ver}>Ver</Link>
              {l.deshacer && <button type="button" className="s-boton s-boton-enlace" onClick={l.deshacer.alPulsar}>{l.deshacer.texto}</button>}
            </span>
          </li>
        ))}
      </ul>
      <Link to={verTodo} className="s-bandeja-ver-todo">Todo lo hecho automáticamente</Link>
    </section>
  )
}
