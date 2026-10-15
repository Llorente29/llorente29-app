// src/modules/conta/ui/marco/TeTocaHoy.tsx
//
// M01 · La franja «Te toca hoy» (maqueta N30 §4): un chip con el número de
// cada cosa pendiente. Pulsarlo lleva a ella (o filtra, si la pantalla lo
// dice). En el Inicio junta los de todos los módulos.
//
// Regla 7: es una pantalla que se abre a propósito, así que el chip sale
// también con 0 —en verde, «al día»—; el número ordena y da el tono, no
// decide si existe.

import { Link } from 'react-router-dom'

export interface ChipPendiente {
  id: string
  etiqueta: string
  /** null = no se ha podido contar (sale, y lo dice). */
  numero: number | null
  ruta?: string
  alPulsar?: () => void
  activo?: boolean
}

function Contenido({ c }: { c: ChipPendiente }) {
  return (
    <>
      <span className="cxm-chip-numero">{c.numero === null ? '—' : c.numero.toLocaleString('es-ES')}</span>
      <span>{c.etiqueta}</span>
    </>
  )
}

export function TeTocaHoy({ chips, titulo = 'Te toca hoy' }: { chips: ChipPendiente[]; titulo?: string }) {
  if (chips.length === 0) return null
  const tono = (c: ChipPendiente) => (c.numero === null ? 'cxm-chip cxm-chip-gris' : c.numero > 0 ? 'cxm-chip cxm-chip-ambar' : 'cxm-chip cxm-chip-verde')
  return (
    <section className="cxm-te-toca" aria-label={titulo}>
      <h2 className="cxm-te-toca-titulo">{titulo}</h2>
      <ul className="cxm-te-toca-lista">
        {chips.map((c) => (
          <li key={c.id}>
            {c.ruta
              ? <Link to={c.ruta} className={tono(c)}><Contenido c={c} /></Link>
              : <button type="button" className={tono(c)} aria-pressed={c.activo ?? false} onClick={c.alPulsar}><Contenido c={c} /></button>}
          </li>
        ))}
      </ul>
    </section>
  )
}
