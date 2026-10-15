// src/modules/conta/marco/nuevo/BarraInferior.tsx
//
// M01 · En el móvil, la barra de módulos pasa abajo (maqueta N30 §1): Inicio,
// Compras, Bancos y Libros, y «Más», que abre todos en una hoja (también
// Impuestos, apagado, y «Volver a Folvy» si no es el producto vendido solo).

import { useEffect, useId, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { rutaConta } from '@/config/navegacion'
import { Icono } from '@/modules/conta/ui/Icono'
import type { CuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { Circulo } from '@/modules/conta/marco/nuevo/BarraModulos'
import { TEXTO_PROXIMAMENTE, moduloDe, modulosVisibles, type IdModulo, type ModuloConta } from '@/modules/conta/marco/nuevo/modulos'

const EN_LA_BARRA: IdModulo[] = ['inicio', 'compras', 'bancos', 'libros']

function Hoja({ solo, cuentas, cerrar }: { solo: boolean; cuentas: CuentasMenu; cerrar: () => void }) {
  const { pathname } = useLocation()
  const id = useId()
  const activo = moduloDe(pathname)?.id
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [cerrar])
  const fila = (m: ModuloConta) => m.ruta === null
    ? (
      <span key={m.id} className="cxm-hoja-item cxm-modulo-apagado" aria-disabled="true">
        <Circulo m={m} /><span className="cxm-modulo-nombre">{m.etiqueta}</span><span className="cxm-apoyo">{TEXTO_PROXIMAMENTE}</span>
      </span>
    )
    : (
      <Link key={m.id} to={rutaConta(m.ruta)} className="cxm-hoja-item" aria-current={activo === m.id ? 'page' : undefined} onClick={cerrar}>
        <Circulo m={m} cuenta={m.cuenta ? cuentas[m.cuenta] : undefined} /><span className="cxm-modulo-nombre">{m.etiqueta}</span>
      </Link>
    )
  return (
    <div className="cx-hoja-velo" onClick={cerrar}>
      <div className="cx-hoja cxm-hoja" role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()}>
        <span className="cx-hoja-asa" aria-hidden="true" />
        <span id={id} className="cxm-menu-titulo">Menú</span>
        {modulosVisibles(solo).map(fila)}
        {!solo && (
          <Link to="/" className="cxm-hoja-item" onClick={cerrar}>
            <span className="cxm-circulo cxm-circulo-vacio" aria-hidden="true"><Icono nombre="folvy" tam={16} /></span>
            <span className="cxm-modulo-nombre">Volver a Folvy</span>
          </Link>
        )}
        <div className="cx-hoja-pie">
          <span />
          <button type="button" className="cx-boton-sec" onClick={cerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

export function BarraInferior({ solo, cuentas }: { solo: boolean; cuentas: CuentasMenu }) {
  const { pathname } = useLocation()
  const [mas, setMas] = useState(false)
  const activo = moduloDe(pathname)?.id
  const lista = modulosVisibles(solo).filter((m) => EN_LA_BARRA.includes(m.id) && m.ruta !== null)
  const enLaBarra = lista.some((m) => m.id === activo)
  return (
    <nav className="cxm-barra-inferior" aria-label="Menú de contabilidad">
      {lista.map((m) => (
        <Link key={m.id} to={rutaConta(m.ruta!)} className="cxm-barra-item" aria-current={activo === m.id ? 'page' : undefined}>
          <Circulo m={m} cuenta={m.cuenta ? cuentas[m.cuenta] : undefined} />
          <span className="cxm-modulo-nombre">{m.etiqueta}</span>
        </Link>
      ))}
      <button type="button" className="cxm-barra-item" aria-haspopup="dialog" aria-expanded={mas} onClick={() => setMas(true)}
        aria-current={!enLaBarra && activo ? 'page' : undefined}>
        <span className="cxm-circulo cxm-circulo-vacio" aria-hidden="true"><Icono nombre="mas" tam={16} /></span>
        <span className="cxm-modulo-nombre">Más</span>
      </button>
      {mas && <Hoja solo={solo} cuentas={cuentas} cerrar={() => setMas(false)} />}
    </nav>
  )
}
