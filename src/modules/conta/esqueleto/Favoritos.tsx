// src/modules/conta/esqueleto/Favoritos.tsx
//
// Favoritos. S02 (tablero 0: «Favoritos y Ajustes, abajo en la barra»): una
// entrada más de la barra, abajo, separada, con Ajustes; su menú sale a su
// lado. Lo que la persona fija sale aquí, en el orden en que lo fijó, y se
// guarda en la base (le sigue de un ordenador a otro). Se fija desde el mismo
// menú: la página en la que está y cada acción de la página, con su estrella.
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

export function Favoritos({ favoritos, cargando = false, fijables, alternar, alAbrirBuscador, enCajon = false, plegada = false }: {
  favoritos: Favorito[]
  /** Aún se están leyendo de la base: no se dice «ninguno» de lo que no se sabe. */
  cargando?: boolean
  /** Lo que se puede fijar desde aquí: la pantalla actual y las órdenes de su cinta. */
  fijables: Orden[]
  /** Fija o quita (y lo dice quien lo llama). */
  alternar: (o: { id: string; etiqueta: string }) => void
  alAbrirBuscador: () => void
  /** En el móvil va en el cajón del menú y el menú se abre debajo; en la barra, a su lado. */
  enCajon?: boolean
  /** La barra está plegada: solo la estrella, con su nombre al pasar el ratón. */
  plegada?: boolean
}) {
  const { abierto: menuAbierto, setAbierto: menuSetAbierto, alternar: menuAlternar, caja: menuCaja, boton: menuBoton } = useDesplegable()
  const fijados = new Set(favoritos.map((f) => f.id))
  const abrir = (o: Orden) => {
    menuSetAbierto(false)
    if ('accion' in o.a) alAbrirBuscador()
  }
  return (
    <div className="s-desplegable" ref={menuCaja}>
      <button ref={menuBoton} type="button" className="s-barra-item" aria-expanded={menuAbierto} aria-haspopup="true" onClick={menuAlternar}
        title={plegada ? 'Favoritos' : undefined}>
        <Icono nombre="favorito" grande /><span className="s-barra-nombre">Favoritos</span>
      </button>
      {menuAbierto && (
        <div className={enCajon ? 's-menu' : 's-menu s-menu-lado'} role="group" aria-label="Favoritos" aria-busy={cargando}>
          <span className="s-menu-titulo">Favoritos</span>
          {cargando && <p className="s-menu-nota">Leyendo tus favoritos…</p>}
          {!cargando && favoritos.length === 0 && <p className="s-menu-nota">Aún no tienes ninguno. Fija abajo lo que más uses y saldrá aquí.</p>}
          {!cargando && favoritos.map((f) => {
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
