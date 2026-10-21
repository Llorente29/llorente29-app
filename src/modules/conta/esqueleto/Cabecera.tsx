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
// S01f (Julio, 20/10: «texto plano muy rudimentario»; la maqueta del
// trimestre v3 y la decisión de Julio de ese día): las pestañas salen de la
// cabecera a su PROPIA franja, debajo (FranjaPestanas). La cabecera se queda
// como estaba (empresa, ejercicio o mes, Buscar · Ctrl K, Favoritos y el
// usuario), con el logo de la empresa más pequeño. La franja: unos 44 px,
// fondo blanco y su separador; cada pestaña con su icono de trazo de 14 px y
// 16 px de aire a cada lado, la activa subrayada con 3 px en toda la pestaña
// y su contador donde aplique (gris lo que pide una decisión o cuántos hay,
// rojo lo que vence: contadoresPestanas.ts). A 1440 px caben todas: sin
// «Más ▾». Si la ventana es estrecha, y en el móvil, la franja se desliza sin
// cortar ninguna.
//
// El contador va FUERA del enlace (a su lado, dentro de la pestaña) y el
// enlace cubre la pestaña entera: el nombre del enlace sigue siendo el de la
// pestaña («Movimientos»), y el número lo dice su descripción al lector.

import type { ReactNode, RefCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { rutaAltaEmpresa, rutaConta } from '@/config/navegacion'
import { LogoHorizontal } from '@/marca/PiezasMarca'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { Boton, Icono } from '@/modules/conta/diseno'
import { iniciales } from '@/modules/conta/lib/formato'
import type { Pestana, Producto } from './productos'
import { clavePestana, type ContadorPestana, type ContadoresPestanas } from './contadoresPestanas'
import { conConsulta } from './ordenes'
import { useDeslizable } from './deslizable'

/** La dirección de una pestaña, llevándose lo elegido: el ejercicio (Libros), el mes y el banco (Bancos). */
function useRutaPestana() {
  const { search } = useLocation()
  return (t: Pestana) => conConsulta(rutaConta(t.ruta!), search)
}

/** El número de una pestaña: gris o rojo. Lo dice al lector la descripción del enlace. */
function Contador({ c, id }: { c: ContadorPestana | undefined; id?: string }) {
  if (!c) return null
  return (
    <>
      <span className="s-pestana-contador" data-tono={c.tono} aria-hidden="true" title={c.frase}>{c.n}</span>
      {id && <span id={id} hidden>{c.frase}</span>}
    </>
  )
}

/**
 * Una pestaña: el enlace (icono y nombre) y, al lado, su contador. El enlace
 * cubre la pestaña entera (también el contador) con su ::after.
 */
function UnaPestana({ producto, t, activa, contador, ruta }: { producto: Producto; t: Pestana; activa: boolean; contador: ContadorPestana | undefined; ruta: string }) {
  const desc = contador ? `s-pestana-n-${producto.id}-${t.id}` : undefined
  return (
    <span className="s-pestana" data-activa={activa ? '' : undefined}>
      <Link to={ruta} className="s-pestana-enlace" aria-current={activa ? 'page' : undefined} aria-describedby={desc}>
        <Icono nombre={t.icono} pestana /><span className="s-pestana-nombre">{t.etiqueta}</span>
      </Link>
      <Contador c={contador} id={desc} />
    </span>
  )
}

/**
 * S01f · La franja de pestañas del producto, debajo de la cabecera (en el
 * ordenador, fija debajo de ella). Se desliza hasta la activa y dice con un
 * degradado que hay más por un lado (S01e).
 */
export function FranjaPestanas({ producto, pestanas, activa, contadores, movil }: {
  producto: Producto; pestanas: Pestana[]; activa: string | null; contadores: ContadoresPestanas; movil: boolean
}) {
  const ruta = useRutaPestana()
  const fila = useDeslizable<HTMLElement>(`${producto.id}:${activa ?? ''}`)
  return (
    <nav ref={fila} className={movil ? 's-franja-pestanas s-pestanas s-pestanas-movil' : 's-franja-pestanas s-pestanas'} aria-label={`Pestañas de ${producto.etiqueta}`}>
      {pestanas.map((t) => (
        <UnaPestana key={t.id} producto={producto} t={t} activa={t.id === activa} contador={contadores[clavePestana(producto.id, t.id)]} ruta={ruta(t)} />
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

export function Cabecera({ movil, logoCliente, huecoPeriodo, abrirBuscador, favoritos, usuario, abrirMenu, menuAbierto }: {
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
  // El hueco del ejercicio y el mes: lo llena la pantalla (MarcoNuevo).
  const refPeriodo = huecoPeriodo
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
        {/* S01f: las pestañas van en su franja, debajo (FranjaPestanas). */}
        <div className="s-cab-centro" />
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
    </>
  )
}
