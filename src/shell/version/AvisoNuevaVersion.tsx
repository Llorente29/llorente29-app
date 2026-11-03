// src/shell/version/AvisoNuevaVersion.tsx
//
// El aviso de oficina: hay versión nueva, la persona decide cuándo, y ahora
// también SABE QUÉ TRAE (NV1, Julio, 03/11; maqueta «Cartel de novedades»):
//   · en el ordenador, un cartel abajo a la derecha; en el móvil, una hoja
//     desde abajo con «Actualizar ahora» a todo el ancho;
//   · de 1 a 3 frases, con su apartado en negrita (las 3 primeras, «y N más»),
//     de lo que trae la versión publicada y no la que se tiene;
//   · «Se aplica al momento. No pierdes lo que estabas haciendo.», solo si es
//     verdad: si la pantalla dice que hay algo a medias, lo dice al revés;
//   · «Ver todas las novedades», «Luego» y «Actualizar ahora».
//
// NO se recarga solo aquí a propósito. En una pantalla de oficina puede haber
// alguien a mitad de un albarán o de un cuadrante, y recargarle por debajo le
// borra el trabajo. Las tablets no pasan por aquí (TabletStationRoute,
// TrabajadorApp): siguen recargándose solas, sin cartel.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNuevaVersion } from './useNuevaVersion'
import { MARCA } from '@/marca/marca'
import { useIsMobile } from '@/shell/useIsMobile'
import { hayTrabajoEnCurso } from '@/services/trabajoEnCurso'
import { rutaNovedades } from '@/config/navegacion'
import {
  leeNovedades, marcaVistasHasta, masNueva, novedadesConocidas, nuevasDeLaVersion, paraElCartel, productoDeMarca, type Novedad,
} from './novedades'
import './cartel.css'

const CLAVE_LUEGO = 'novedades.luego'

function leerLuego(): string | null {
  try { return window.sessionStorage.getItem(CLAVE_LUEGO) } catch { return null }
}

export default function AvisoNuevaVersion() {
  const { hayNueva, publicada, recargar } = useNuevaVersion()
  const movil = useIsMobile()
  const producto = productoDeMarca(MARCA.id)
  const [nuevas, setNuevas] = useState<Novedad[] | null>(null)
  const [luego, setLuego] = useState<string | null>(leerLuego)
  const [aMedias, setAMedias] = useState(hayTrabajoEnCurso())
  const buildId = publicada?.buildId ?? null

  // Lo que trae la versión publicada: una vez por versión.
  useEffect(() => {
    if (!hayNueva || !buildId) return
    let vivo = true
    void leeNovedades().then((l) => { if (vivo) setNuevas(l ? nuevasDeLaVersion(l, novedadesConocidas(), producto) : null) })
    return () => { vivo = false }
  }, [hayNueva, buildId, producto])

  // «No pierdes lo que estabas haciendo» solo si es verdad: se vuelve a mirar mientras está a la vista.
  useEffect(() => {
    if (!hayNueva) return
    const id = window.setInterval(() => setAMedias(hayTrabajoEnCurso()), 2000)
    return () => window.clearInterval(id)
  }, [hayNueva])

  if (!hayNueva || (buildId && luego === buildId)) return null

  const { vistas, mas } = paraElCartel(nuevas ?? [])
  // Cerrarlo hasta la próxima versión.
  const cerrar = () => {
    try { if (buildId) window.sessionStorage.setItem(CLAVE_LUEGO, buildId) } catch { /* sin almacenamiento: hasta que se recargue */ }
    setLuego(buildId)
  }
  const alLuego = () => { void marcaVistasHasta(masNueva(vistas)); cerrar() }
  const alActualizar = () => { void marcaVistasHasta(masNueva(nuevas ?? [])).finally(recargar) }
  const titulo = `Hay una versión nueva de ${MARCA.nombre}`

  const lista = nuevas === null ? null : vistas.length > 0 ? (
    <ul className="nvc-lista" data-prueba="novedades-cartel">
      {vistas.map((n) => <li key={n.id}><b>{n.apartado}:</b> {n.frase}</li>)}
      {mas > 0 && <li className="nvc-mas">Y {mas} {mas === 1 ? 'novedad más' : 'novedades más'}.</li>}
    </ul>
  ) : (
    <p className="nvc-nota" data-prueba="novedades-cartel">Arreglos pequeños: nada cambia en cómo trabajas.</p>
  )
  const nota = (
    <p className="nvc-nota" data-prueba="novedades-nota">
      {aMedias ? 'Tienes algo a medias: termínalo antes, porque al actualizar se vuelve a abrir la pantalla.' : 'Se aplica al momento. No pierdes lo que estabas haciendo.'}
    </p>
  )
  // «Ver todas» no apunta lo visto: lo apunta la página después de enseñar lo «Nuevo para ti».
  const verTodas = <Link className="nvc-enlace" to={rutaNovedades(producto)} onClick={cerrar}>Ver todas las novedades</Link>

  if (movil) {
    return (
      <section className="nvc" data-forma="hoja" aria-labelledby="nvc-titulo" data-prueba="cartel-version">
        <div className="nvc-asa" aria-hidden="true" />
        <h2 id="nvc-titulo" className="nvc-titulo">{titulo}</h2>
        {lista}
        {nota}
        <button type="button" className="nvc-boton nvc-boton-azul" onClick={alActualizar}>Actualizar ahora</button>
        <div className="nvc-pie">
          {verTodas}
          <button type="button" className="nvc-boton-luego" onClick={alLuego}>Luego</button>
        </div>
      </section>
    )
  }
  return (
    <section className="nvc" data-forma="cartel" aria-labelledby="nvc-titulo" data-prueba="cartel-version">
      <div className="nvc-cab">
        <span className="nvc-icono" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1E63C9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
          </svg>
        </span>
        <h2 id="nvc-titulo" className="nvc-titulo">{titulo}</h2>
      </div>
      {lista}
      {nota}
      <div className="nvc-pie">
        {verTodas}
        <div className="nvc-botones">
          <button type="button" className="nvc-boton nvc-boton-blanco" onClick={alLuego}>Luego</button>
          <button type="button" className="nvc-boton nvc-boton-azul" onClick={alActualizar}>Actualizar ahora</button>
        </div>
      </div>
    </section>
  )
}
