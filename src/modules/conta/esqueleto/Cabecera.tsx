// src/modules/conta/esqueleto/Cabecera.tsx
//
// S01 · La cabecera: UNA fila de 48 px (Julio, respuesta 3 del 17/10; la
// maqueta 1 con dos filas no vale):
//   logo y nombre del cliente con el cambio de empresa · ejercicio y mes (solo
//   en las pantallas que lo leen) · pestañas del producto (las que no caben,
//   en «Más ▾») · «Buscar · Ctrl K» · Favoritos · usuario y su nivel.
// S01c (18/10): el logo de la marca sale UNA vez: en el ordenador, arriba de
// la barra de productos (no aquí); en el móvil, aquí, con el botón que abre el
// cajón de productos.
// S01d (Julio, 18/10): en el móvil la cabecera es solo menú, logo y Buscar. La
// empresa va ENTERA en la fila de debajo, con el ejercicio y el mes de la
// pantalla que los lea; Favoritos y el usuario, en el cajón del menú. Las
// pestañas, en una fila que se desliza debajo.

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { rutaAltaEmpresa, rutaConta } from '@/config/navegacion'
import { LogoHorizontal } from '@/marca/PiezasMarca'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { Boton, Icono } from '@/modules/conta/diseno'
import { iniciales } from '@/modules/conta/lib/formato'
import { anchoParaPestanas, cuantasCaben, type Pestana, type Producto } from './productos'
import { conConsulta } from './ordenes'
import { useDeslizable } from './deslizable'

/** La dirección de una pestaña, llevándose lo elegido: el ejercicio (Libros), el mes y el banco (Bancos). */
function useRutaPestana() {
  const { search } = useLocation()
  return (t: Pestana) => conConsulta(rutaConta(t.ruta!), search)
}

const HUECO = 4
/** El hueco de la cabecera entre el cliente y el ejercicio (gap de .s-cab-izquierda). */
const HUECO_CAB = 8

function Pestanas({ producto, pestanas, activa, periodo }: { producto: Producto; pestanas: Pestana[]; activa: string | null; periodo: HTMLDivElement | null }) {
  const ruta = useRutaPestana()
  const caja = useRef<HTMLDivElement | null>(null)
  const medida = useRef<HTMLDivElement | null>(null)
  const [caben, setCaben] = useState(pestanas.length)
  const { abierto: masAbierto, alternar: masAlternar, caja: masCaja, boton: masBoton } = useDesplegable()
  const claves = pestanas.map((t) => t.id).join(',')
  const n = pestanas.length
  // S01e · El sitio del ejercicio o el mes se guarda esté o no: «Más ▾» no cambia de sitio entre pantallas.
  const reserva = producto.periodo ?? 0

  useLayoutEffect(() => {
    const c = caja.current, me = medida.current
    if (!c || !me) return
    // En la medida, cada pestaña en negrita (como la activa), luego «Más ▾» y luego cada «Pestaña ▾»:
    // lo que se ve no depende de cuál esté activa.
    const medir = () => {
      const anchos = Array.from(me.children).map((x) => (x as HTMLElement).offsetWidth)
      const ocupaPeriodo = periodo && periodo.offsetWidth > 0 ? periodo.offsetWidth + HUECO_CAB : 0
      setCaben(cuantasCaben(anchos.slice(0, n), anchoParaPestanas(c.clientWidth, ocupaPeriodo, reserva), anchos[n] ?? 0, HUECO, anchos.slice(n + 1)))
    }
    medir()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir)
    ro?.observe(c)
    ro?.observe(me)
    if (periodo) ro?.observe(periodo)
    // Con la letra ya cargada, las medidas cambian.
    let vivo = true
    document.fonts?.ready.then(() => { if (vivo) medir() }).catch(() => {})
    return () => { vivo = false; ro?.disconnect() }
  }, [claves, n, periodo, reserva])

  const vistas = pestanas.slice(0, caben)
  const resto = pestanas.slice(caben)
  const enResto = resto.find((t) => t.id === activa)
  const enlace = (t: Pestana, clase: string) => (
    <Link key={t.id} to={ruta(t)} className={clase} aria-current={t.id === activa ? 'page' : undefined}>{t.etiqueta}</Link>
  )
  return (
    <div className="s-pestanas-caja" ref={caja}>
      <div className="s-pestanas-medida" ref={medida} aria-hidden="true">
        {pestanas.map((t) => <span key={t.id} className="s-pestana s-pestana-activa">{t.etiqueta}</span>)}
        <span className="s-pestana s-pestana-activa">Más ▾</span>
        {pestanas.map((t) => <span key={`${t.id}-mas`} className="s-pestana s-pestana-activa">{`${t.etiqueta} ▾`}</span>)}
      </div>
      <nav className="s-pestanas" aria-label={`Pestañas de ${producto.etiqueta}`}>
        {vistas.map((t) => enlace(t, 's-pestana'))}
        {resto.length > 0 && (
          <div className="s-desplegable" ref={masCaja}>
            <button type="button" ref={masBoton} className={enResto ? 's-pestana s-pestana-activa' : 's-pestana'}
              aria-expanded={masAbierto} aria-haspopup="true" onClick={masAlternar}>
              {enResto ? `${enResto.etiqueta} ▾` : 'Más ▾'}
            </button>
            {masAbierto && <div className="s-menu s-menu-derecha">{resto.map((t) => enlace(t, 's-menu-item'))}</div>}
          </div>
        )}
      </nav>
    </div>
  )
}

export function PestanasMovil({ producto, pestanas, activa }: { producto: Producto; pestanas: Pestana[]; activa: string | null }) {
  const ruta = useRutaPestana()
  // S01e · Se desliza hasta la activa y dice con un degradado que hay más.
  const fila = useDeslizable<HTMLElement>(`${producto.id}:${activa ?? ''}`)
  return (
    <nav ref={fila} className="s-pestanas s-pestanas-movil" aria-label={`Pestañas de ${producto.etiqueta}`}>
      {pestanas.map((t) => (
        <Link key={t.id} to={ruta(t)} className="s-pestana" aria-current={t.id === activa ? 'page' : undefined}>{t.etiqueta}</Link>
      ))}
    </nav>
  )
}

/** El logo y el nombre del cliente, con el cambio de empresa. Sin logo, sus iniciales. */
function Cliente({ logo, movil }: { logo: string | null; movil: boolean }) {
  const { activa, empresas, elegir, cargando } = useEmpresas()
  const { abierto: menuAbierto, setAbierto: menuSetAbierto, alternar: menuAlternar, caja: menuCaja, boton: menuBoton } = useDesplegable()
  if (cargando) return <span className="s-cab-cliente" aria-hidden="true"><span className="s-cab-cliente-logo" /></span>
  if (!activa) {
    return (
      <Link to={rutaAltaEmpresa()} className="s-cab-empresa"><span className="s-cab-empresa-nombre">Tu empresa · darla de alta</span></Link>
    )
  }
  return (
    <div className="s-cab-cliente s-desplegable" ref={menuCaja}>
      {!movil && (logo
        ? <img className="s-cab-cliente-logo" src={logo} alt="" aria-hidden="true" />
        : <span className="s-cab-cliente-logo" aria-hidden="true">{iniciales(activa.nombre)}</span>)}
      <button type="button" ref={menuBoton} className="s-cab-empresa" aria-expanded={menuAbierto} aria-haspopup="true"
        aria-label={`${activa.nombre}. Cambiar de empresa`} title={movil ? undefined : activa.nombre} onClick={menuAlternar}>
        <span className="s-cab-empresa-nombre">{activa.nombre}</span><Icono nombre="desplegar" />
      </button>
      {menuAbierto && (
        <div className="s-menu">
          <span className="s-menu-titulo">Tus empresas</span>
          <ul className="s-barra-lista" aria-label="Tus empresas">
            {empresas.map((e) => (
              <li key={e.id}>
                <button type="button" className="s-menu-item" aria-current={e.id === activa.id ? 'true' : undefined}
                  onClick={() => { elegir(e.id); menuSetAbierto(false) }}>
                  <span>{e.nombre}</span>{e.nif && <span className="s-cifra s-menu-nota">{e.nif}</span>}
                </button>
              </li>
            ))}
          </ul>
          <Link to={rutaAltaEmpresa()} className="s-menu-item" onClick={() => menuSetAbierto(false)}>+ Dar de alta otra empresa</Link>
        </div>
      )}
    </div>
  )
}

export function Cabecera({ producto, pestanas, pestanaActiva, movil, logoCliente, huecoPeriodo, abrirBuscador, favoritos, usuario, abrirMenu, menuAbierto }: {
  producto: Producto | null
  /** Las pestañas que salen en la cabecera (vacío: ninguna). */
  pestanas: Pestana[]
  pestanaActiva: string | null
  movil: boolean
  logoCliente: string | null
  huecoPeriodo: RefCallback<HTMLDivElement>
  abrirBuscador: () => void
  /** Favoritos y el usuario: en el ordenador, aquí; en el móvil van en el cajón (S01d). */
  favoritos: ReactNode
  usuario: ReactNode
  /** En el móvil: abre el cajón de productos. */
  abrirMenu?: () => void
  menuAbierto?: boolean
}) {
  // El hueco del ejercicio y el mes: lo llena la pantalla (MarcoNuevo) y lo miden las pestañas.
  const [periodo, setPeriodo] = useState<HTMLDivElement | null>(null)
  const refPeriodo = useCallback((el: HTMLDivElement | null) => { huecoPeriodo(el); setPeriodo(el) }, [huecoPeriodo])
  return (
    <>
      <header className="s-cabecera">
        <div className="s-cab-izquierda">
          {movil && (
            <>
              <Boton variante="fantasma" className="s-cab-menu" icono="menu" aria-label="Abrir el menú" aria-haspopup="dialog" aria-expanded={!!menuAbierto} onClick={abrirMenu}>{''}</Boton>
              <Link to={rutaConta('inicio')} className="s-cab-logotipo" aria-label="Inicio"><LogoHorizontal alto={18} /></Link>
            </>
          )}
          {!movil && <Cliente logo={logoCliente} movil={false} />}
          {/* El ejercicio y el mes: lo pone la pantalla que lo lee (PeriodoEnBarra); vacío, no sale. En el móvil, en su fila. */}
          {!movil && <div className="s-cab-periodo" ref={refPeriodo} />}
        </div>
        <div className="s-cab-centro">
          {!movil && producto && pestanas.length > 0 && <Pestanas key={producto.id} producto={producto} pestanas={pestanas} activa={pestanaActiva} periodo={periodo} />}
        </div>
        <div className="s-cab-derecha">
          <Boton variante="fantasma" className="s-cab-buscar" icono="buscar" tecla={movil ? undefined : 'Ctrl K'} atajo="Control+K"
            aria-label={movil ? 'Buscar' : undefined} onClick={abrirBuscador}>{movil ? '' : 'Buscar'}</Boton>
          {!movil && favoritos}
          {!movil && usuario}
        </div>
      </header>
      {movil && (
        <div className="s-cab-fila-movil">
          <Cliente logo={logoCliente} movil />
          <div className="s-cab-periodo s-cab-periodo-movil" ref={refPeriodo} />
        </div>
      )}
      {movil && producto && pestanas.length > 1 && <PestanasMovil producto={producto} pestanas={pestanas} activa={pestanaActiva} />}
    </>
  )
}
