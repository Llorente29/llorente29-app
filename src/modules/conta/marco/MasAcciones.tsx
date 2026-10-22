// src/modules/conta/marco/MasAcciones.tsx
//
// S02 · «Más acciones ▾» y los selectores de una página (encargo S02,
// «Encabezado de cada página»: un solo principal; lo demás, en botones blancos
// o en «Más acciones ▾»). Dentro del menú, cada grupo con su título: es ahí, y
// solo ahí, donde va el nombre del grupo (se acabaron las etiquetas sueltas
// debajo de los botones). Un menú se cierra al elegir, al pulsar fuera, con
// Escape (y el foco vuelve a su botón) y al cambiar de dirección.

import { Link } from 'react-router-dom'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { Icono } from '@/modules/conta/diseno'
import type { Accion, GrupoDeAcciones, Selector } from './acciones'

/** Una acción como botón (blanco o principal). */
export function BotonDeAccion({ a, principal = false }: { a: Accion; principal?: boolean }) {
  const clase = `s-boton ${principal ? 's-boton-principal' : 's-boton-secundario'}${a.aviso ? ' s-boton-aviso' : ''}`
  const contenido = (
    <>
      <span className="s-boton-texto">{a.etiqueta}</span>
      {a.numero !== undefined && <span className="s-boton-contador s-cifra" data-tono={a.aviso ? 'duda' : 'neutro'}>{a.numero}</span>}
    </>
  )
  if (a.a) return <Link to={a.a} className={clase} title={a.dato} aria-current={a.actual ? 'page' : undefined}>{contenido}</Link>
  return <button type="button" className={clase} title={a.dato} onClick={a.alPulsar}>{contenido}</button>
}

/** Una entrada de un menú: enlace o botón, con su número y su dato. */
function EntradaMenu({ a, cerrar }: { a: Accion; cerrar: () => void }) {
  const dentro = (
    <>
      <span className="s-menu-texto">
        <span>{a.etiqueta}</span>
        {a.dato && <span className="s-menu-nota">{a.dato}</span>}
      </span>
      {a.numero !== undefined && <span className="s-boton-contador s-cifra" data-tono={a.aviso ? 'duda' : 'neutro'}>{a.numero}</span>}
    </>
  )
  if (a.a) {
    return <Link to={a.a} className="s-menu-item" aria-current={a.actual ? 'true' : undefined} onClick={cerrar}>{dentro}</Link>
  }
  return <button type="button" className="s-menu-item" onClick={() => { cerrar(); a.alPulsar?.() }}>{dentro}</button>
}

function Grupos({ grupos, cerrar }: { grupos: readonly GrupoDeAcciones[]; cerrar: () => void }) {
  return (
    <>
      {grupos.map((g, i) => (
        <div key={`${g.titulo}-${i}`} role="group" aria-label={g.titulo} className="s-menu-grupo">
          {(grupos.length > 1 || g.titulo) && <span className="s-menu-titulo">{g.titulo}</span>}
          {g.acciones.map((a) => <EntradaMenu key={a.id} a={a} cerrar={cerrar} />)}
        </div>
      ))}
    </>
  )
}

/** «Más acciones ▾»: lo que no cabe en los botones, por grupos. */
export function MasAcciones({ grupos, etiqueta = 'Más acciones', derecha = true }: { grupos: readonly GrupoDeAcciones[]; etiqueta?: string; derecha?: boolean }) {
  const { abierto, setAbierto, alternar, caja, boton } = useDesplegable()
  if (grupos.length === 0) return null
  return (
    <div className="s-desplegable" ref={caja}>
      <button ref={boton} type="button" className="s-boton s-boton-secundario" aria-expanded={abierto} aria-haspopup="true" onClick={alternar}>
        <span className="s-boton-texto">{etiqueta}</span><Icono nombre="desplegar" />
      </button>
      {abierto && (
        <div className={`s-menu${derecha ? ' s-menu-derecha' : ''}`} role="group" aria-label={etiqueta}>
          <Grupos grupos={grupos} cerrar={() => setAbierto(false)} />
        </div>
      )}
    </div>
  )
}

/** Un selector de la página: «Ver: Libro mayor ▾», «Tus bancos: BBVA ▾». */
export function SelectorDePagina({ s }: { s: Selector }) {
  const { abierto, setAbierto, alternar, caja, boton } = useDesplegable()
  const actual = s.actual?.etiqueta ?? 'Elegir'
  return (
    <div className="s-desplegable" ref={caja}>
      <button ref={boton} type="button" className="s-boton s-boton-secundario s-selector" aria-expanded={abierto} aria-haspopup="true"
        aria-label={`${s.titulo}: ${actual}. Cambiar`} onClick={alternar}>
        <span className="s-selector-titulo">{s.titulo}:</span><span className="s-boton-texto">{actual}</span>
        {s.actual?.numero !== undefined && <span className="s-boton-contador s-cifra" data-tono={s.actual.aviso ? 'duda' : 'neutro'}>{s.actual.numero}</span>}
        <Icono nombre="desplegar" />
      </button>
      {abierto && (
        <div className="s-menu" role="group" aria-label={s.titulo}>
          <Grupos grupos={s.opciones} cerrar={() => setAbierto(false)} />
        </div>
      )}
    </div>
  )
}
