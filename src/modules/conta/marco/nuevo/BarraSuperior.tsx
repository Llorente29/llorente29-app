// src/modules/conta/marco/nuevo/BarraSuperior.tsx
//
// M01 · La barra de arriba, una sola fila de unos 48 px (maqueta N30 §2):
//   · izquierda: la empresa («Llorente29 Food SL ▾», sin código: decisión de
//     Julio, F01 respuesta 7), que abre el cambio de empresa, y el hueco del
//     ejercicio y el periodo, que solo llena la pantalla que lo lee;
//   · centro: las pestañas del módulo (la activa en azul, negrita y subrayada);
//     las que no caben, en «Más ▾»;
//   · derecha: «Buscar todo» con Ctrl K, Cómoda | Compacta y el usuario.
// En el móvil: la empresa y el buscador; las pestañas, en una fila que se
// desliza debajo.

import { useLayoutEffect, useRef, useState, type RefCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { rutaAltaEmpresa, rutaConta } from '@/config/navegacion'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { Tecla } from '@/modules/conta/ui/marco/Tecla'
import { cuantasCaben, pestanaDe, type ModuloConta, type PestanaModulo } from '@/modules/conta/marco/nuevo/modulos'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import type { Densidad } from '@/modules/conta/marco/nuevo/preferencias'

function Empresa({ movil }: { movil: boolean }) {
  const { activa, empresas, elegir, cargando } = useEmpresas()
  const { abierto, setAbierto, alternar, caja, boton } = useDesplegable()
  if (cargando) return <span className="cxm-empresa" aria-hidden="true"><span className="cx-hueso" style={{ width: 160, height: 14 }} /></span>
  if (!activa) {
    return (
      <Link to={rutaAltaEmpresa()} className="cxm-empresa">
        <span className="cxm-empresa-nombre">Tu empresa</span><span className="cxm-apoyo">Darla de alta</span>
      </Link>
    )
  }
  return (
    <div className="cxm-desplegable" ref={caja}>
      <button type="button" ref={boton} className="cxm-empresa" aria-expanded={abierto} aria-haspopup="true"
        aria-label={`${activa.nombre}. Cambiar de empresa`} onClick={alternar}>
        <span className="cxm-empresa-nombre">{activa.nombre}</span><span className="cxm-flecha" aria-hidden="true">▾</span>
      </button>
      {abierto && (
        <div className={movil ? 'cxm-menu cxm-menu-movil' : 'cxm-menu'}>
          <span className="cxm-menu-titulo">Tus empresas</span>
          <ul className="cxm-menu-lista" aria-label="Tus empresas">
            {empresas.map((e) => (
              <li key={e.id}>
                <button type="button" className="cxm-menu-item" aria-current={e.id === activa.id ? 'true' : undefined}
                  onClick={() => { elegir(e.id); setAbierto(false) }}>
                  <span>{e.nombre}</span>
                  {e.nif && <span className="cxm-cifra cxm-apoyo">{e.nif}</span>}
                </button>
              </li>
            ))}
          </ul>
          <Link to={rutaAltaEmpresa()} className="cxm-menu-item cxm-menu-item-enlace" onClick={() => setAbierto(false)}>+ Dar de alta otra empresa</Link>
        </div>
      )}
    </div>
  )
}

/** La dirección de una pestaña, llevándose el ejercicio elegido si lo hay (lo leen Libros y el diario). */
function useRutaPestana() {
  const { search } = useLocation()
  const ejercicio = new URLSearchParams(search).get('ejercicio')
  return (p: PestanaModulo) => `${rutaConta(p.ruta)}${ejercicio ? `?ejercicio=${encodeURIComponent(ejercicio)}` : ''}`
}

const ANCHO_MAS = 76
const HUECO = 4

function Pestanas({ m }: { m: ModuloConta }) {
  const { pathname } = useLocation()
  const activa = pestanaDe(m, pathname)
  const ruta = useRutaPestana()
  const caja = useRef<HTMLDivElement | null>(null)
  const medida = useRef<HTMLDivElement | null>(null)
  const [caben, setCaben] = useState(m.pestanas.length)
  const { abierto: masAbierto, alternar: alternarMas, caja: cajaMas, boton: botonMas } = useDesplegable()

  useLayoutEffect(() => {
    const c = caja.current, me = medida.current
    if (!c || !me) return
    const medir = () => {
      const anchos = Array.from(me.children).map((x) => (x as HTMLElement).offsetWidth)
      setCaben(cuantasCaben(anchos, c.clientWidth, ANCHO_MAS, HUECO))
    }
    medir()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir)
    ro?.observe(c)
    return () => ro?.disconnect()
  }, [m.id, m.pestanas.length])

  const vistas = m.pestanas.slice(0, caben)
  const resto = m.pestanas.slice(caben)
  const enResto = resto.some((p) => p.id === activa?.id)
  const enlace = (p: PestanaModulo, clase: string) => (
    <Link key={p.id} to={ruta(p)} className={clase} aria-current={p.id === activa?.id ? 'page' : undefined}>{p.etiqueta}</Link>
  )
  return (
    <div className="cxm-pestanas-caja" ref={caja}>
      <div className="cxm-pestanas-medida" ref={medida} aria-hidden="true">
        {m.pestanas.map((p) => <span key={p.id} className="cxm-pestana">{p.etiqueta}</span>)}
      </div>
      <nav className="cxm-pestanas" aria-label={`Pestañas de ${m.etiqueta}`}>
        {vistas.map((p) => enlace(p, 'cxm-pestana'))}
        {resto.length > 0 && (
          <div className="cxm-desplegable" ref={cajaMas}>
            <button type="button" ref={botonMas} className={enResto ? 'cxm-pestana cxm-pestana-activa' : 'cxm-pestana'}
              aria-expanded={masAbierto} aria-haspopup="true" onClick={alternarMas}>
              {enResto && activa ? `${activa.etiqueta} ▾` : 'Más ▾'}
            </button>
            {masAbierto && (
              <div className="cxm-menu cxm-menu-derecha">
                {resto.map((p) => enlace(p, 'cxm-menu-item cxm-menu-item-enlace'))}
              </div>
            )}
          </div>
        )}
      </nav>
    </div>
  )
}

function PestanasMovil({ m }: { m: ModuloConta }) {
  const { pathname } = useLocation()
  const activa = pestanaDe(m, pathname)
  const ruta = useRutaPestana()
  return (
    <nav className="cxm-pestanas cxm-pestanas-movil" aria-label={`Pestañas de ${m.etiqueta}`}>
      {m.pestanas.map((p) => (
        <Link key={p.id} to={ruta(p)} className="cxm-pestana" aria-current={p.id === activa?.id ? 'page' : undefined}>{p.etiqueta}</Link>
      ))}
    </nav>
  )
}

function Usuario({ nombre, solo }: { nombre: string; solo: boolean }) {
  const { abierto, alternar, caja, boton } = useDesplegable()
  // En el producto vendido solo no hay a dónde volver: el nombre, sin menú.
  if (solo) return <span className="cxm-usuario">{nombre}</span>
  return (
    <div className="cxm-desplegable" ref={caja}>
      <button type="button" ref={boton} className="cxm-usuario cxm-usuario-boton" aria-expanded={abierto} aria-haspopup="true" onClick={alternar}>
        {nombre} <span className="cxm-flecha" aria-hidden="true">▾</span>
      </button>
      {abierto && (
        <div className="cxm-menu cxm-menu-derecha">
          <Link to="/" className="cxm-menu-item cxm-menu-item-enlace">Volver a Folvy</Link>
        </div>
      )}
    </div>
  )
}

export function BarraSuperior({ modulo, conPestanas, movil, solo, usuario, densidad, cambiarDensidad, abrirBuscador, huecoPeriodo }: {
  modulo: ModuloConta | null
  conPestanas: boolean
  movil: boolean
  solo: boolean
  usuario: string | null
  densidad: Densidad
  cambiarDensidad: (d: Densidad) => void
  abrirBuscador: () => void
  huecoPeriodo: RefCallback<HTMLDivElement>
}) {
  return (
    <>
      <header className="cxm-arriba">
        <div className="cxm-arriba-izquierda">
          <Empresa movil={movil} />
          {/* Se pinta solo si la pantalla pone algo dentro (PeriodoEnBarra). */}
          <div className="cxm-periodo" ref={huecoPeriodo} />
        </div>
        <div className="cxm-arriba-centro">
          {!movil && conPestanas && modulo && <Pestanas key={modulo.id} m={modulo} />}
        </div>
        <div className="cxm-arriba-derecha">
          <button type="button" className="cxm-buscar" onClick={abrirBuscador} aria-keyshortcuts="Control+K" aria-label={movil ? 'Buscar todo' : undefined}>
            <span className="cxm-lupa" aria-hidden="true">⌕</span>
            {!movil && <><span>Buscar todo</span><Tecla>Ctrl K</Tecla></>}
          </button>
          {!movil && (
            <div className="cxm-densidad" role="group" aria-label="Densidad">
              <button type="button" aria-pressed={densidad === 'comoda'} onClick={() => cambiarDensidad('comoda')}>Cómoda</button>
              <button type="button" aria-pressed={densidad === 'compacta'} onClick={() => cambiarDensidad('compacta')}>Compacta</button>
            </div>
          )}
          {!movil && usuario && <Usuario nombre={usuario} solo={solo} />}
        </div>
      </header>
      {movil && conPestanas && modulo && <PestanasMovil m={modulo} />}
    </>
  )
}
