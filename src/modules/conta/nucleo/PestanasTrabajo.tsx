// src/modules/conta/nucleo/PestanasTrabajo.tsx
//
// K02 · Las pestañas de trabajo (maqueta nucleo_1): cada cosa abierta es una
// pestaña, con su aspa, y «+» abre otra. En el K02, una sola además de Inicio
// (decisión 4: Inicio, la primera, fija y sin aspa): la de la dirección. Cerrar
// la pestaña vuelve a Inicio. «+» abre el buscador, para ir a otra cosa. Las
// pestañas vivas (varias a la vez, cada una con lo suyo) son el K03.

import { Plus, X } from 'lucide-react'

export function PestanasTrabajo({ enInicio, nombre, irAInicio, cerrar, abrirOtra }: {
  enInicio: boolean
  /** El nombre de la pestaña de la pantalla abierta (si no es Inicio). */
  nombre: string
  irAInicio: () => void
  cerrar: () => void
  abrirOtra: () => void
}) {
  return (
    <div className="k-trabajo-pestanas" role="tablist" aria-label="Lo que tienes abierto">
      <button type="button" role="tab" className="k-trabajo-pestana" aria-selected={enInicio} onClick={irAInicio}>
        <span className="k-trabajo-nombre">Inicio</span>
      </button>
      {!enInicio && (
        <span role="tab" className="k-trabajo-pestana" aria-selected="true" tabIndex={-1}>
          <span className="k-trabajo-nombre" title={nombre}>{nombre}</span>
          <button type="button" className="k-trabajo-cerrar" aria-label={`Cerrar ${nombre}`} onClick={cerrar}><X size={13} aria-hidden="true" /></button>
        </span>
      )}
      <button type="button" className="k-trabajo-mas" aria-label="Abrir otra cosa" title="Abrir otra cosa" onClick={abrirOtra}>
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
