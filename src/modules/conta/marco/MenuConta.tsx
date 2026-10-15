// src/modules/conta/marco/MenuConta.tsx
//
// La cabecera de la empresa del menú de antes («Cambiar de empresa»). El menú
// flotante y la barra inferior se fueron con el marco nuevo (M01,
// marco/nuevo/); queda esta pieza porque la usa todavía Ajustes en el móvil
// (ajustes/MarcoAjustes.tsx), dentro de la pantalla.

import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAltaEmpresa } from '@/config/navegacion'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
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
