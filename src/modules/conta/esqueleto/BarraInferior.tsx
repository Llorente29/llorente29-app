// src/modules/conta/esqueleto/BarraInferior.tsx
//
// S01 · En el móvil, la barra de productos va abajo: Inicio, Contabilidad,
// Compras y gastos, Bancos y «Más», que abre todos los que tiene la cuenta en
// una hoja (y «Volver a Folvy» si no es el producto vendido solo).

import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaConta } from '@/config/navegacion'
import { Boton, Icono } from '@/modules/conta/diseno'
import type { IdProducto, Producto } from './productos'

const EN_LA_BARRA: IdProducto[] = ['inicio', 'contabilidad', 'compras', 'bancos']

function Hoja({ productos, activo, solo, cerrar }: { productos: Producto[]; activo: string | null; solo: boolean; cerrar: () => void }) {
  const id = useId()
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [cerrar])
  return (
    <div className="s-hoja-velo" onClick={cerrar}>
      <div className="s-hoja" role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()}>
        <span id={id} className="s-menu-titulo">Menú</span>
        {productos.map((p) => (
          <Link key={p.id} to={rutaConta(p.ruta!)} className="s-menu-item" aria-current={activo === p.id ? 'page' : undefined} onClick={cerrar}>
            <span>{p.etiqueta}</span><Icono nombre={p.icono} />
          </Link>
        ))}
        {!solo && <Link to="/" className="s-menu-item" onClick={cerrar}>Volver a Folvy</Link>}
        <Boton onClick={cerrar}>Cerrar</Boton>
      </div>
    </div>
  )
}

export function BarraInferior({ productos, activo, solo }: { productos: Producto[]; activo: string | null; solo: boolean }) {
  const [mas, setMas] = useState(false)
  const abajo = productos.filter((p) => EN_LA_BARRA.includes(p.id))
  const enLaBarra = abajo.some((p) => p.id === activo)
  return (
    <nav className="s-barra-inferior" aria-label="Menú de contabilidad">
      {abajo.map((p) => (
        <Link key={p.id} to={rutaConta(p.ruta!)} className="s-barra-item" aria-current={activo === p.id ? 'page' : undefined}>
          <Icono nombre={p.icono} grande />
          <span className="s-barra-nombre">{p.etiqueta}</span>
        </Link>
      ))}
      <button type="button" className="s-barra-item" aria-haspopup="dialog" aria-expanded={mas} onClick={() => setMas(true)}
        aria-current={!enLaBarra && activo ? 'page' : undefined}>
        <Icono nombre="menu" grande />
        <span className="s-barra-nombre">Más</span>
      </button>
      {mas && <Hoja productos={productos} activo={activo} solo={solo} cerrar={() => setMas(false)} />}
    </nav>
  )
}
