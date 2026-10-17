// src/modules/conta/ui/marco/TeTocaHoy.tsx
//
// M01 · La franja «Te toca hoy» (maqueta N30 §4): un chip con el número de
// cada cosa pendiente. Pulsarlo lleva a ella (o filtra, si la pantalla lo
// dice). En el Inicio junta los de todos los módulos.
//
// Julio, 16/10: el chip a 0 no sale (no es una fila que se esconda: es un
// aviso de que hay algo, y con 0 no hay nada que avisar); si todo está a 0, la
// franja lo dice en una línea gris, «Nada pendiente hoy». Mientras se cuenta
// sale «…»; si no se ha podido contar, «—»: ninguno de los dos se confunde
// con un 0 ni con «nada pendiente» (chipsQueSalen).

import { Link } from 'react-router-dom'
import { miles } from '@/modules/conta/ui/tabla/tablaDensa'
import { chipsQueSalen } from '@/modules/conta/marco/nuevo/teTocaHoy'

export interface ChipPendiente {
  id: string
  etiqueta: string
  /** undefined = contando todavía («…»); null = no se ha podido contar («—»). */
  numero: number | null | undefined
  ruta?: string
  alPulsar?: () => void
  activo?: boolean
}

function Contenido({ c }: { c: ChipPendiente }) {
  return (
    <>
      <span className="cxm-chip-numero">{c.numero === undefined ? '…' : c.numero === null ? '—' : miles(c.numero)}</span>
      <span>{c.etiqueta}</span>
    </>
  )
}

export function TeTocaHoy({ chips, titulo = 'Te toca hoy' }: { chips: ChipPendiente[]; titulo?: string }) {
  if (chips.length === 0) return null
  const { visibles, nada } = chipsQueSalen(chips)
  const tono = (c: ChipPendiente) => (c.numero == null ? 'cxm-chip cxm-chip-gris' : c.numero > 0 ? 'cxm-chip cxm-chip-ambar' : 'cxm-chip cxm-chip-verde')
  return (
    <section className="cxm-te-toca" aria-label={titulo} aria-busy={chips.some((c) => c.numero === undefined)}>
      <h2 className="cxm-te-toca-titulo">{titulo}</h2>
      {nada && <p className="cxm-te-toca-nada">Nada pendiente hoy</p>}
      {visibles.length > 0 && <ul className="cxm-te-toca-lista">
        {visibles.map((c) => (
          <li key={c.id}>
            {c.ruta
              ? <Link to={c.ruta} className={tono(c)}><Contenido c={c} /></Link>
              : <button type="button" className={tono(c)} aria-pressed={c.activo ?? false} onClick={c.alPulsar}><Contenido c={c} /></button>}
          </li>
        ))}
      </ul>}
    </section>
  )
}
