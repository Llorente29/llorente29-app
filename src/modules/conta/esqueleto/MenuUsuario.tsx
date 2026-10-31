// src/modules/conta/esqueleto/MenuUsuario.tsx
//
// El usuario, a la derecha de la cabecera. S02 (tableros 1 a 9): el círculo
// con su inicial y su nombre. Dentro, lo que es de cada persona y se guarda en
// la base: el nivel (cambia palabras, ayuda y lo que se ofrece de serie; nunca
// dónde está cada cosa) y la densidad (Cómoda, filas de 56 px; Compacta, de
// 40: decisión 2 de Julio, 22/10). Y, si no es el producto vendido solo,
// «Volver a Folvy». S02: se acabó la cinta, y con ella «Ocultar la cinta».
// S01f (31/10): al final, separado, «Cerrar sesión»: en app.sumied.com,
// entrando directo, no había forma de salir. El mismo signOut que Folvy
// (ShellTopBar) y a /login, que enseña la entrada de la marca en la que se está.

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signOut } from '@/services/authService'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { iniciales } from '@/modules/conta/lib/formato'
import { Icono } from '@/modules/conta/diseno'
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
  const navigate = useNavigate()
  const [saliendo, setSaliendo] = useState(false)
  const [errorSalir, setErrorSalir] = useState<string | null>(null)
  const salir = async () => {
    setSaliendo(true); setErrorSalir(null)
    const r = await signOut()
    if (!r.ok) { setSaliendo(false); setErrorSalir(`No se ha podido cerrar la sesión: ${r.error ?? 'sin respuesta'}. Vuelve a probar.`); return }
    menuSetAbierto(false)
    // Sin sesión, la app enseña la entrada de su marca (Sumied o Folvy) en /login.
    // Como Folvy (ShellTopBar), sin reemplazar: al volver atrás, /conta sin sesión
    // también enseña la entrada.
    navigate('/login')
  }
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
      {!enCajon && (
        <button ref={menuBoton} type="button" className="s-usuario-boton" aria-expanded={menuAbierto} aria-haspopup="true"
          aria-label={`${nombre}, nivel ${NOMBRE_NIVEL[prefs.nivel].toLowerCase()}. Tus preferencias`} title={nombre} onClick={menuAlternar}>
          <span className="s-usuario-inicial" aria-hidden="true">{iniciales(nombre).slice(0, 1)}</span>
          {!movil && <span className="s-usuario-nombre">{nombre}</span>}
        </button>
      )}
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
            {([['comoda', 'Cómoda', 'filas de 56 px'], ['compacta', 'Compacta', 'filas de 40 px']] as [Densidad, string, string][]).map(([v, t, nota]) => (
              <button key={v} type="button" className="s-menu-item" aria-pressed={prefs.densidad === v}
                onClick={() => elegir({ densidad: v }, `Densidad: ${t.toLowerCase()}, ${nota}.`)}>
                <span>{t}</span><span className="s-menu-nota">{nota}</span>
              </button>
            ))}
          </div>
          {/* En el cajón, «Volver a Folvy» ya es una fila del propio cajón: no se repite. */}
          {!solo && !enCajon && (
            <>
              <div className="s-menu-separador" />
              <Link to="/" className="s-menu-item">Volver a Folvy</Link>
            </>
          )}
          <div className="s-menu-separador" />
          <button type="button" className="s-menu-item s-menu-salir" onClick={() => void salir()} disabled={saliendo}>
            <span>{saliendo ? 'Cerrando la sesión…' : 'Cerrar sesión'}</span><Icono nombre="salir" />
          </button>
          {errorSalir && <p className="s-menu-nota" role="alert">{errorSalir}</p>}
        </div>
      )}
    </div>
  )
}
