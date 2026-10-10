// src/modules/conta/marco/MenuConta.tsx
//
// El menú flotante del módulo (ordenador) y la barra inferior (móvil), los dos
// sacados de la configuración única (src/config/navegacion.ts). Arriba del
// menú, la empresa con «Cambiar de empresa».
//
// Lo que la maqueta no dibuja y hace falta dentro de Folvy: «Volver a Folvy»,
// para salir del módulo al resto de la aplicación (el módulo trae su propio
// marco y tapa la barra de Folvy). Y en el móvil, la barra inferior no tiene
// sitio para la empresa: «Tu empresa» saca esta misma cabecera cuando la
// cuenta lleva más de una (con una sola no hay nada que cambiar).

import { useId, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  BARRA_CONTA, MENU_CONTA, entradaActiva, entradasVisibles, rutaAltaEmpresa, rutaConta,
} from '@/config/navegacion'
import { Icono } from '@/modules/conta/ui/Icono'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { BotonIAMovil } from '@/modules/conta/marco/BarraPregunta'
import { useCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { iniciales } from '@/modules/conta/lib/formato'

export function CabeceraEmpresa() {
  const { activa, empresas, elegir, cargando } = useEmpresas()
  const [abierta, setAbierta] = useState(false)
  const idLista = useId()

  if (cargando) {
    return (
      <div className="cx-menu-empresa" aria-hidden="true">
        <span className="cx-menu-logo" />
        <span className="cx-hueso" style={{ width: 140, height: 16 }} />
      </div>
    )
  }
  if (!activa) {
    return (
      <Link to={rutaAltaEmpresa()} className="cx-menu-empresa">
        <span className="cx-menu-logo" aria-hidden="true">+</span>
        <span>
          <span className="cx-menu-empresa-nombre">Tu empresa</span>
          <span className="cx-menu-empresa-accion">Darla de alta</span>
        </span>
      </Link>
    )
  }
  return (
    <>
      <button type="button" className="cx-menu-empresa" aria-expanded={abierta} aria-controls={idLista}
        onClick={() => setAbierta((v) => !v)}>
        <span className="cx-menu-logo" aria-hidden="true">{iniciales(activa.nombre).slice(0, 1)}</span>
        <span>
          <span className="cx-menu-empresa-nombre">{activa.nombre}</span>
          <span className="cx-menu-empresa-accion">Cambiar de empresa</span>
        </span>
      </button>
      {abierta && (
        <div id={idLista} className="cx-menu-empresas">
          <ul className="cx-menu-lista" aria-label="Tus empresas">
            {empresas.map((e) => (
              <li key={e.id}>
                <button type="button" className="cx-menu-item" style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer' }}
                  aria-current={e.id === activa.id ? 'true' : undefined}
                  onClick={() => { elegir(e.id); setAbierta(false) }}>
                  <span className="cx-menu-item-texto" style={{ textAlign: 'left' }}>{e.nombre}</span>
                  {e.id === activa.id && <span className="cx-chip cx-chip-azul">Ahora</span>}
                </button>
              </li>
            ))}
          </ul>
          <Link to={rutaAltaEmpresa()} className="cx-menu-item" onClick={() => setAbierta(false)}>
            <span className="cx-menu-item-texto">+ Dar de alta otra empresa</span>
          </Link>
        </div>
      )}
    </>
  )
}

export function MenuConta() {
  const { pathname } = useLocation()
  const todas = MENU_CONTA.flat()
  const activa = entradaActiva(pathname, todas)
  const grupos = MENU_CONTA.map(entradasVisibles).filter((g) => g.length > 0)
  const cuentas = useCuentasMenu()
  return (
    <nav className="cx-menu" aria-label="Menú de contabilidad">
      <CabeceraEmpresa />
      {grupos.map((grupo, i) => (
        <div key={grupo[0].id} style={{ display: 'contents' }}>
          {i > 0 && <div className="cx-menu-separador" aria-hidden="true" />}
          {grupo.map((e) => (
            // El número no cambia el nombre del enlace («Libros» sigue siendo «Libros»): va como su
            // descripción. Con aria-label dentro, el nombre pasaba a «Libros 3 por mirar» (e2e 172).
            <Link key={e.id} to={rutaConta(e.ruta)} className="cx-menu-item" aria-current={activa === e.id ? 'page' : undefined}
              aria-describedby={(cuentas[e.id] ?? 0) > 0 ? `cx-menu-cuenta-${e.id}` : undefined}>
              <Icono nombre={e.icono} />
              <span className="cx-menu-item-texto">{e.etiqueta}</span>
              {(cuentas[e.id] ?? 0) > 0 && <span className="cx-insignia cx-menu-cuenta" aria-hidden="true">{cuentas[e.id]}</span>}
              {(cuentas[e.id] ?? 0) > 0 && <span id={`cx-menu-cuenta-${e.id}`} hidden>{cuentas[e.id]} por mirar</span>}
            </Link>
          ))}
        </div>
      ))}
      <div className="cx-menu-separador" aria-hidden="true" />
      <Link to="/" className="cx-menu-item">
        <Icono nombre="folvy" />
        <span className="cx-menu-item-texto">Volver a Folvy</span>
      </Link>
    </nav>
  )
}

export function BarraInferiorConta() {
  const { pathname } = useLocation()
  const izquierda = entradasVisibles(BARRA_CONTA.izquierda)
  const derecha = entradasVisibles(BARRA_CONTA.derecha)
  const activa = entradaActiva(pathname, [...BARRA_CONTA.izquierda, ...BARRA_CONTA.derecha])
  const enlace = (e: (typeof izquierda)[number]) => (
    <Link key={e.id} to={rutaConta(e.ruta)} className="cx-barra-item" aria-current={activa === e.id ? 'page' : undefined}>
      <Icono nombre={e.icono} />{e.etiqueta}
    </Link>
  )
  return (
    <nav className="cx-barra-inferior" aria-label="Menú de contabilidad">
      {izquierda.length > 0 ? izquierda.map(enlace) : (
        <Link to="/" className="cx-barra-item"><Icono nombre="folvy" />Folvy</Link>
      )}
      <BotonIAMovil />
      {derecha.map(enlace)}
    </nav>
  )
}
