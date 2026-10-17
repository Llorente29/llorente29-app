// src/modules/conta/esqueleto/MenuUsuario.tsx
//
// S01 · El usuario y su nivel, a la derecha de la cabecera («Julio · Medio ▾»).
// Dentro, lo que es de cada persona y se guarda en la base: el nivel (cambia
// palabras, ayuda y lo que se ofrece de serie; nunca dónde está cada cosa),
// la densidad (antes un interruptor suelto en la barra) y la cinta. Y, si no
// es el producto vendido solo, «Volver a Folvy».

import { Link } from 'react-router-dom'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { iniciales } from '@/modules/conta/lib/formato'
import { Boton } from '@/modules/conta/diseno'
import { NIVELES, NOMBRE_NIVEL, type Densidad, type Nivel, type Preferencias } from './preferencias'

const AYUDA_NIVEL: Record<Nivel, string> = {
  sin_experiencia: 'Te lo explico con palabras de todos los días.',
  medio: 'Con los nombres de la contabilidad, sin códigos.',
  experto: 'Con cuentas, claves y referencias a la norma.',
}

export function MenuUsuario({ nombre, prefs, solo, movil, cambiar }: {
  nombre: string
  prefs: Preferencias
  solo: boolean
  movil: boolean
  cambiar: (c: Partial<Preferencias>, dicho: string) => void
}) {
  const { abierto: menuAbierto, setAbierto: menuSetAbierto, alternar: menuAlternar, caja: menuCaja, boton: menuBoton } = useDesplegable()
  const elegir = (c: Partial<Preferencias>, dicho: string) => { cambiar(c, dicho); menuSetAbierto(false) }
  return (
    <div className="s-desplegable" ref={menuCaja}>
      <Boton ref={menuBoton} variante="fantasma" icono="desplegar" aria-expanded={menuAbierto} aria-haspopup="true"
        aria-label={`${nombre}, nivel ${NOMBRE_NIVEL[prefs.nivel].toLowerCase()}. Tus preferencias`} onClick={menuAlternar}>
        {/* En el móvil no cabe «Nombre · Nivel»: sus iniciales; el nivel, en el menú y en el nombre del botón. */}
        {/* El nivel ocupa siempre lo del más largo: cambiarlo no mueve nada (ni manda una pestaña a «Más»). */}
        {movil ? iniciales(nombre) : (
          <>{nombre} · <strong className="s-usuario-nivel">
            {NIVELES.map((n) => <span key={n} aria-hidden={n !== prefs.nivel} data-actual={n === prefs.nivel || undefined}>{NOMBRE_NIVEL[n]}</span>)}
          </strong></>
        )}
      </Boton>
      {menuAbierto && (
        <div className="s-menu s-menu-derecha">
          <div role="group" aria-label="Tu nivel">
            <span className="s-menu-titulo">Tu nivel</span>
            {NIVELES.map((n) => (
              <button key={n} type="button" className="s-menu-item" aria-pressed={prefs.nivel === n}
                onClick={() => elegir({ nivel: n }, `Nivel: ${NOMBRE_NIVEL[n].toLowerCase()}. Cambian las palabras; cada cosa sigue en su sitio.`)}>
                <span>{NOMBRE_NIVEL[n]}</span><span className="s-menu-nota">{AYUDA_NIVEL[n]}</span>
              </button>
            ))}
          </div>
          <div className="s-menu-separador" />
          <div role="group" aria-label="Densidad">
            <span className="s-menu-titulo">Densidad</span>
            {([['comoda', 'Cómoda'], ['compacta', 'Compacta']] as [Densidad, string][]).map(([v, t]) => (
              <button key={v} type="button" className="s-menu-item" aria-pressed={prefs.densidad === v}
                onClick={() => elegir({ densidad: v }, `Densidad: ${t.toLowerCase()}.`)}>{t}</button>
            ))}
          </div>
          <div className="s-menu-separador" />
          <button type="button" className="s-menu-item"
            onClick={() => elegir({ cintaOculta: !prefs.cintaOculta }, prefs.cintaOculta ? 'La cinta vuelve a estar a la vista.' : 'Cinta oculta: «Mostrar la cinta» la saca otra vez.')}>
            {prefs.cintaOculta ? 'Mostrar la cinta' : 'Ocultar la cinta'}
          </button>
          {!solo && (
            <>
              <div className="s-menu-separador" />
              <Link to="/" className="s-menu-item">Volver a Folvy</Link>
            </>
          )}
        </div>
      )}
    </div>
  )
}
