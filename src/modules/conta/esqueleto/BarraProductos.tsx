// src/modules/conta/esqueleto/BarraProductos.tsx
//
// S01c · La barra de productos, a la izquierda (encargo S01b, 18/10; la de
// 88 px solo con texto partía los nombres y no cabía el contador):
//   · desplegada, 220 px: el logo horizontal blanco arriba; cada producto con
//     su icono de 20 px y su nombre en una línea, a 14 px; lo que pide una
//     decisión, como chip a la derecha (el de Inicio es la suma, la misma que
//     el «Te toca hoy»); el activo con fondo y una barra de 3 px a la
//     izquierda; Ajustes abajo, separado;
//   · plegada, 64 px: el símbolo y solo los iconos, con el nombre al pasar el
//     ratón; el chip, como un globo sobre el icono.
// El botón de plegar se ve siempre y lo elegido se recuerda por persona
// (conta_user_pref.barra_desplegada). Un producto que la cuenta no tiene, o
// sin pantalla, no sale. En el móvil va en un cajón (CajonProductos).

import { Link } from 'react-router-dom'
import { rutaConta } from '@/config/navegacion'
import { CuadradoMarca, LogoHorizontal } from '@/marca/PiezasMarca'
import { Icono } from '@/modules/conta/diseno'
import { frasePendientes } from './cuentasBarra'
import type { IdProducto, Producto } from './productos'

export function ItemBarra({ p, activo, pendientes, alPulsar }: { p: Producto; activo: boolean; pendientes?: number | null; alPulsar?: () => void }) {
  const hay = typeof pendientes === 'number' && pendientes > 0
  const desc = hay ? `s-barra-pend-${p.id}` : undefined
  return (
    <li>
      <Link to={rutaConta(p.ruta!)} className="s-barra-item" aria-current={activo ? 'page' : undefined} title={hay ? `${p.etiqueta} · ${frasePendientes(pendientes)}` : p.etiqueta}
        aria-describedby={desc} onClick={alPulsar}>
        <Icono nombre={p.icono} grande />
        <span className="s-barra-nombre">{p.etiqueta}</span>
        {/* El número no cambia el nombre del enlace: va como su descripción (e2e 172). */}
        {hay && <span className="s-barra-chip" aria-hidden="true">{pendientes}</span>}
        {hay && <span id={desc} hidden>{frasePendientes(pendientes)}</span>}
      </Link>
    </li>
  )
}

export function BarraProductos({ productos, activo, pendientes, desplegada, alternar }: {
  productos: Producto[]
  activo: string | null
  /** Lo que pide una decisión en cada producto (cuentasDeLaBarra). */
  pendientes: Partial<Record<IdProducto, number | null>>
  desplegada: boolean
  alternar: () => void
}) {
  const arriba = productos.filter((p) => !p.abajo)
  const abajo = productos.filter((p) => p.abajo)
  return (
    <nav className="s-barra" aria-label="Menú de contabilidad" data-desplegada={desplegada ? 'si' : 'no'}>
      <div className="s-barra-marca">{desplegada ? <LogoHorizontal blanco alto={26} /> : <CuadradoMarca lado={28} />}</div>
      <ul className="s-barra-lista">
        {arriba.map((p) => <ItemBarra key={p.id} p={p} activo={activo === p.id} pendientes={pendientes[p.id]} />)}
      </ul>
      <div className="s-barra-pie">
        <ul className="s-barra-lista">
          {abajo.map((p) => <ItemBarra key={p.id} p={p} activo={activo === p.id} pendientes={pendientes[p.id]} />)}
        </ul>
        <button type="button" className="s-barra-plegar" aria-expanded={desplegada} title={desplegada ? 'Plegar el menú' : 'Desplegar el menú'}
          aria-label={desplegada ? 'Plegar el menú' : 'Desplegar el menú'} onClick={alternar}>
          <Icono nombre={desplegada ? 'barraPlegar' : 'barraDesplegar'} grande />
          <span className="s-barra-nombre" aria-hidden="true">Plegar</span>
        </button>
      </div>
    </nav>
  )
}
