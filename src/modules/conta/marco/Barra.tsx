// src/modules/conta/marco/Barra.tsx
//
// S02 · La barra lateral (encargo S02, «Barra lateral»; tableros 1 a 9):
//   · 232 px, azul noche. Plegada, 64 px: solo los iconos, con el nombre al
//     pasar el ratón; plegarla se recuerda por persona (conta_user_pref);
//   · arriba, el logo horizontal blanco de la identidad, de 40 px y una vez;
//   · los apartados, en el orden del mapa, con su icono de 20 px y su nombre
//     en una línea de 14 px; lo que espera una acción, como chip a la derecha;
//   · EL APARTADO ACTIVO SE ABRE y enseña sus páginas debajo, con sangría; la
//     página activa en el azul de acción con el texto blanco;
//   · abajo, separados por una línea, Favoritos y Ajustes;
//   · un apartado sin contenido o sin contratar no sale.
// En el móvil, lo mismo va en un cajón (Cajon), que abre el botón de menú.

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { rutaConta } from '@/config/navegacion'
import { CuadradoMarca, LogoHorizontal } from '@/marca/PiezasMarca'
import { Icono } from '@/modules/conta/diseno'
import { frasePendientes } from '@/modules/conta/esqueleto/cuentasBarra'
import { clavePestana, type ContadoresPestanas } from '@/modules/conta/esqueleto/contadoresPestanas'
import { conConsulta } from '@/modules/conta/esqueleto/ordenes'
import { pestanasVisibles, type Contexto, type IdProducto, type Pestana, type Producto } from '@/modules/conta/esqueleto/productos'

export interface DatosBarra {
  productos: Producto[]
  activo: IdProducto | null
  pagina: string | null
  ctx: Contexto
  /** Lo que espera una acción en cada apartado (cuentasDeLaBarra). */
  pendientes: Partial<Record<IdProducto, number | null>>
  /** S02 · PR 3: qué son las que cuenta cada chip (frasesDeLaBarra); sin ella, «N por revisar». */
  frases?: Partial<Record<IdProducto, string>>
  contadores: ContadoresPestanas
  /** La consulta de la dirección de ahora: el ejercicio, el mes y el banco viajan de una página a otra. */
  search: string
}

function Chip({ n, id, frase }: { n: number | null | undefined; id: string; frase?: string }) {
  if (typeof n !== 'number' || n <= 0) return null
  return (
    <>
      <span className="s-barra-chip" aria-hidden="true">{n}</span>
      <span id={id} hidden>{frase ?? frasePendientes(n)}</span>
    </>
  )
}

function Paginas({ p, paginas, actual, contadores, search, alPulsar }: {
  p: Producto; paginas: Pestana[]; actual: string | null; contadores: ContadoresPestanas; search: string; alPulsar?: () => void
}) {
  if (paginas.length === 0) return null
  return (
    <ul className="s-barra-paginas" aria-label={`Páginas de ${p.etiqueta}`}>
      {paginas.map((t, i) => {
        const c = contadores[clavePestana(p.id, t.id)]
        const desc = c ? `s-pagina-n-${p.id}-${t.id}` : undefined
        // V01 · El título del bloque («Hostelería») encima de su primera página.
        const bloque = t.bloque && t.bloque !== paginas[i - 1]?.bloque ? t.bloque : null
        return (
          <li key={t.id}>
            {bloque && <span className="s-barra-bloque">{bloque}</span>}
            <Link to={conConsulta(rutaConta(t.ruta!), search)} className="s-barra-pagina" aria-current={t.id === actual ? 'page' : undefined}
              aria-describedby={desc} onClick={alPulsar}>
              <span className="s-barra-nombre">{t.etiqueta}</span>
              {t.llega && <span className="s-barra-pagina-chip" data-tono="llega">{t.llega}</span>}
              {c && (c.partes
                ? c.partes.map((x) => <span key={x.frase} className="s-barra-pagina-chip" data-tono={c.tono} aria-hidden="true" title={x.frase}>{x.n}</span>)
                : <span className="s-barra-pagina-chip" data-tono={c.tono} aria-hidden="true" title={c.frase}>{c.n}</span>)}
              {c && <span id={desc} hidden>{c.frase}</span>}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Un apartado: su enlace (icono, nombre y chip) y, si es el activo, sus páginas debajo. */
export function Apartado({ p, d, desplegada = true, alPulsar }: { p: Producto; d: DatosBarra; desplegada?: boolean; alPulsar?: () => void }) {
  const activo = d.activo === p.id
  const paginas = activo && desplegada ? pestanasVisibles(p, d.ctx) : []
  const conPagina = activo && paginas.some((t) => t.id === d.pagina)
  const n = d.pendientes[p.id]
  const desc = typeof n === 'number' && n > 0 ? `s-barra-pend-${p.id}` : undefined
  return (
    <li className="s-barra-apartado" data-abierto={activo && paginas.length > 0 ? '' : undefined}>
      <Link to={rutaConta(p.ruta!)} className="s-barra-item" title={desc ? `${p.etiqueta} · ${d.frases?.[p.id] ?? frasePendientes(n as number)}` : p.etiqueta}
        aria-current={activo ? (conPagina ? 'true' : 'page') : undefined} aria-describedby={desc} onClick={alPulsar}>
        <Icono nombre={p.icono} grande />
        <span className="s-barra-nombre">{p.etiqueta}</span>
        {desc && <Chip n={n} id={desc} frase={d.frases?.[p.id]} />}
      </Link>
      <Paginas p={p} paginas={paginas} actual={d.pagina} contadores={d.contadores} search={d.search} alPulsar={alPulsar} />
    </li>
  )
}

export function Barra({ d, desplegada, alternar, favoritos }: {
  d: DatosBarra
  desplegada: boolean
  alternar: () => void
  /** Favoritos, que va abajo con Ajustes. */
  favoritos: ReactNode
}) {
  const arriba = d.productos.filter((p) => !p.abajo)
  const abajo = d.productos.filter((p) => p.abajo)
  return (
    <nav className="s-barra" aria-label="Menú de contabilidad" data-desplegada={desplegada ? 'si' : 'no'}>
      <div className="s-barra-marca">
        <Link to={rutaConta('inicio')} aria-label="Inicio" className="s-barra-logo">
          {desplegada ? <LogoHorizontal blanco alto={40} /> : <CuadradoMarca lado={28} />}
        </Link>
      </div>
      <ul className="s-barra-lista">
        {arriba.map((p) => <Apartado key={p.id} p={p} d={d} desplegada={desplegada} />)}
      </ul>
      <div className="s-barra-pie">
        <ul className="s-barra-lista">
          <li>{favoritos}</li>
          {abajo.map((p) => <Apartado key={p.id} p={p} d={d} desplegada={desplegada} />)}
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
