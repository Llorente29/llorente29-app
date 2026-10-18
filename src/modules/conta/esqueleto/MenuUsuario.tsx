// src/modules/conta/esqueleto/MenuUsuario.tsx
//
// S01 · El usuario y su nivel, a la derecha de la cabecera: el nombre y,
// debajo, «Nivel medio» (S01e: antes «Julio · Medio», con el punto colgando
// si el nombre se cortaba y «Medio» suelto, sin decir de qué).
// Dentro, lo que es de cada persona y se guarda en la base: el nivel (cambia
// palabras, ayuda y lo que se ofrece de serie; nunca dónde está cada cosa),
// la densidad (antes un interruptor suelto en la barra) y la cinta. Y, si no
// es el producto vendido solo, «Volver a Folvy».

import { Link } from 'react-router-dom'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { iniciales } from '@/modules/conta/lib/formato'
import { Boton, Icono } from '@/modules/conta/diseno'
import { NIVELES, NOMBRE_NIVEL, fraseNivel, type Densidad, type Nivel, type Preferencias } from './preferencias'

const AYUDA_NIVEL: Record<Nivel, string> = {
  sin_experiencia: 'Te lo explico con palabras de todos los días.',
  medio: 'Con los nombres de la contabilidad, sin códigos.',
  experto: 'Con cuentas, claves y referencias a la norma.',
}

export function MenuUsuario({ nombre, prefs, solo, movil, cambiar, enCajon = false }: {
  nombre: string
  prefs: Preferencias
  solo: boolean
  movil: boolean
  cambiar: (c: Partial<Preferencias>, dicho: string) => void
  /** S01d · En el móvil va en el cajón del menú: una fila «Nombre · Nivel», y el menú se abre debajo. */
  enCajon?: boolean
}) {
  const { abierto: menuAbierto, setAbierto: menuSetAbierto, alternar: menuAlternar, caja: menuCaja, boton: menuBoton } = useDesplegable()
  const elegir = (c: Partial<Preferencias>, dicho: string) => { cambiar(c, dicho); menuSetAbierto(false) }
  return (
    <div className="s-desplegable" ref={menuCaja}>
      {enCajon && (
        <button ref={menuBoton} type="button" className="s-barra-item" aria-expanded={menuAbierto} aria-haspopup="true"
          aria-label={`${nombre}, nivel ${NOMBRE_NIVEL[prefs.nivel].toLowerCase()}. Tus preferencias`} onClick={menuAlternar}>
          <span className="s-cajon-iniciales" aria-hidden="true">{iniciales(nombre)}</span>
          <span className="s-barra-nombre">{nombre} · {fraseNivel(prefs.nivel).toLowerCase()}</span>
          <Icono nombre="desplegar" />
        </button>
      )}
      {!enCajon && <Boton ref={menuBoton} variante="fantasma" icono="desplegar" aria-expanded={menuAbierto} aria-haspopup="true"
        aria-label={`${nombre}, nivel ${NOMBRE_NIVEL[prefs.nivel].toLowerCase()}. Tus preferencias`} onClick={menuAlternar}>
        {/* En el móvil no cabe el nombre y el nivel: sus iniciales; el nivel, en el menú y en el nombre del botón. */}
        {/* El nivel ocupa siempre lo del más largo: cambiarlo no mueve nada (ni manda una pestaña a «Más»). */}
        {movil ? iniciales(nombre) : (
          <span className="s-usuario">
            <span className="s-usuario-nombre" title={nombre}>{nombre}</span>
            <span className="s-usuario-nivel">
              {NIVELES.map((n) => <span key={n} aria-hidden={n !== prefs.nivel} data-actual={n === prefs.nivel || undefined}>{fraseNivel(n)}</span>)}
            </span>
          </span>
        )}
      </Boton>}
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
          {/* En el cajón, «Volver a Folvy» ya es una fila del propio cajón: no se repite. */}
          {!solo && !enCajon && (
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
