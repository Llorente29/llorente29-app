// src/modules/conta/esqueleto/Favoritos.tsx
//
// S01 · Favoritos, en la cabecera: lo que la persona fija sale aquí, en el
// orden en que lo fijó, y se guarda en la base (le sigue de un ordenador a
// otro). Se fija desde el mismo menú: la pantalla en la que está y cada
// orden de su cinta, con su estrella.
//
// Un favorito que en esta empresa no se puede abrir (Liquidaciones en una
// empresa sin hostelería) no se esconde: sale en gris y dice por qué (regla
// 7). Quitarlo es cosa de la persona. Fijar y quitar lo dicen (regla 8).

import { Link } from 'react-router-dom'
import { rutaConta } from '@/config/navegacion'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { Boton, Icono } from '@/modules/conta/diseno'
import type { Favorito, Orden } from './ordenes'

const destino = (o: Orden) => ('ruta' in o.a ? rutaConta(o.a.ruta) : null)

export function Favoritos({ favoritos, fijables, movil, alternar, alAbrirBuscador }: {
  favoritos: Favorito[]
  /** Lo que se puede fijar desde aquí: la pantalla actual y las órdenes de su cinta. */
  fijables: Orden[]
  movil: boolean
  /** Fija o quita (y lo dice quien lo llama). */
  alternar: (o: { id: string; etiqueta: string }) => void
  alAbrirBuscador: () => void
}) {
  const { abierto: menuAbierto, setAbierto: menuSetAbierto, alternar: menuAlternar, caja: menuCaja, boton: menuBoton } = useDesplegable()
  const fijados = new Set(favoritos.map((f) => f.id))
  const abrir = (o: Orden) => {
    menuSetAbierto(false)
    if ('accion' in o.a) alAbrirBuscador()
  }
  return (
    <div className="s-desplegable" ref={menuCaja}>
      <Boton ref={menuBoton} variante="fantasma" icono="favorito" aria-expanded={menuAbierto} aria-haspopup="true"
        aria-label={movil ? 'Favoritos' : undefined} onClick={menuAlternar}>{movil ? '' : 'Favoritos'}</Boton>
      {menuAbierto && (
        <div className="s-menu s-menu-derecha" role="group" aria-label="Favoritos">
          <span className="s-menu-titulo">Favoritos</span>
          {favoritos.length === 0 && <p className="s-menu-nota">Aún no tienes ninguno. Fija abajo lo que más uses y saldrá aquí.</p>}
          {favoritos.map((f) => {
            const nombre = f.orden?.etiqueta ?? f.id
            const a = f.orden && f.disponible ? destino(f.orden) : null
            return (
              <div key={f.id} className="s-menu-fila">
                {f.orden && f.disponible
                  ? (a
                    ? <Link to={a} className="s-menu-item" onClick={() => menuSetAbierto(false)}>{nombre}</Link>
                    : <button type="button" className="s-menu-item" onClick={() => abrir(f.orden!)}>{nombre}</button>)
                  : (
                    <span className="s-menu-item" aria-disabled="true">
                      <span>{nombre}</span>
                      <span className="s-menu-nota">{f.orden ? 'no está en esta empresa' : 'ya no existe'}</span>
                    </span>
                  )}
                <Boton variante="fantasma" icono="desfijar" aria-label={`Quitar «${nombre}» de Favoritos`} title="Quitar de Favoritos"
                  onClick={() => alternar({ id: f.id, etiqueta: nombre })}>{''}</Boton>
              </div>
            )
          })}
          {fijables.length > 0 && (
            <>
              <div className="s-menu-separador" />
              <span className="s-menu-titulo">Fijar desde aquí</span>
              {fijables.map((o) => (
                <button key={o.id} type="button" className="s-menu-item" aria-pressed={fijados.has(o.id)}
                  onClick={() => alternar({ id: o.id, etiqueta: o.etiqueta })}>
                  <span>{o.etiqueta}</span>
                  <Icono nombre={fijados.has(o.id) ? 'favorito' : 'fijar'} />
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
