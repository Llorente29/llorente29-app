// src/modules/conta/esqueleto/BarraProductos.tsx
//
// S01 · La barra de productos, a la izquierda (maqueta 1): azul noche en
// Sumied, unos 88 px, el símbolo de la marca arriba y los productos con su
// nombre; Ajustes, abajo del todo. Debajo de Inicio, lo que hay por revisar de
// todos los productos («7 por revisar»): es un aviso, solo sale si hay algo
// (regla 7). Plegada, solo los iconos (con su nombre para el lector y al pasar
// el ratón). Un producto que la cuenta no tiene, o sin pantalla, no sale.

import { Link } from 'react-router-dom'
import { rutaConta } from '@/config/navegacion'
import { CuadradoMarca } from '@/marca/PiezasMarca'
import { Boton, Icono } from '@/modules/conta/diseno'
import type { Producto } from './productos'

function Item({ p, activo, pendientes }: { p: Producto; activo: boolean; pendientes?: number }) {
  const hay = (pendientes ?? 0) > 0
  return (
    <li>
      <Link to={rutaConta(p.ruta!)} className="s-barra-item" aria-current={activo ? 'page' : undefined} title={p.etiqueta}
        aria-describedby={hay ? `s-barra-pend-${p.id}` : undefined}>
        <Icono nombre={p.icono} grande />
        <span className="s-barra-nombre">{p.etiqueta}</span>
        {/* El número no cambia el nombre del enlace: va como su descripción (e2e 172). */}
        {hay && <span className="s-barra-destacado" aria-hidden="true">{pendientes} por revisar</span>}
        {hay && <span id={`s-barra-pend-${p.id}`} hidden>{pendientes} por revisar</span>}
      </Link>
    </li>
  )
}

export function BarraProductos({ productos, activo, pendientes, desplegada, alternar }: {
  productos: Producto[]
  activo: string | null
  /** Lo que hay por revisar de todos los productos (debajo de Inicio). Null: no se ha podido contar. */
  pendientes: number | null
  desplegada: boolean
  alternar: () => void
}) {
  const arriba = productos.filter((p) => !p.abajo)
  const abajo = productos.filter((p) => p.abajo)
  return (
    <nav className="s-barra" aria-label="Menú de contabilidad" data-desplegada={desplegada ? 'si' : 'no'}>
      <div className="s-barra-marca"><CuadradoMarca lado={36} /></div>
      <ul className="s-barra-lista">
        {arriba.map((p) => <Item key={p.id} p={p} activo={activo === p.id} pendientes={p.id === 'inicio' ? pendientes ?? undefined : undefined} />)}
      </ul>
      <ul className="s-barra-lista s-barra-lista-abajo">
        {abajo.map((p) => <Item key={p.id} p={p} activo={activo === p.id} />)}
      </ul>
      <Boton variante="fantasma" className="s-barra-plegar" icono={desplegada ? 'barraPlegar' : 'barraDesplegar'}
        aria-expanded={desplegada} aria-label={desplegada ? 'Plegar el menú' : 'Desplegar el menú'} onClick={alternar}>{''}</Boton>
    </nav>
  )
}
