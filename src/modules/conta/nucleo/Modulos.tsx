// src/modules/conta/nucleo/Modulos.tsx
//
// K02 · Los módulos, a la izquierda (maqueta nucleo_1): Contabilidad,
// Facturación, Impuestos, Personal y Despacho, cada uno con su icono en un
// cuadrado y su nombre debajo; el elegido, en azul claro. Arriba, «« Plegar»:
// plegados, solo los iconos (el nombre, al pasar el ratón). Plegar se recuerda
// por persona (conta_user_pref.barraDesplegada, la misma de la barra de hoy).

import { ICONOS_NUCLEO } from './iconos'
import type { IdModulo, Modulo } from './mapa'

export function Modulos({ modulos, elegido, elegir, plegados, alternar }: {
  modulos: Modulo[]
  elegido: IdModulo
  elegir: (m: Modulo) => void
  plegados: boolean
  alternar: () => void
}) {
  return (
    <nav className="k-modulos" aria-label="Módulos" data-plegados={plegados ? 'si' : 'no'}>
      <button type="button" className="k-modulos-plegar" aria-expanded={!plegados} onClick={alternar}
        aria-label={plegados ? 'Desplegar los módulos' : 'Plegar los módulos'}>
        {plegados ? '»' : '« Plegar'}
      </button>
      <ul className="k-modulos-lista">
        {modulos.map((m) => {
          const Dibujo = ICONOS_NUCLEO[m.icono]
          return (
            <li key={m.id}>
              <button type="button" className="k-modulo" aria-current={m.id === elegido ? 'true' : undefined}
                title={plegados ? m.etiqueta : undefined} aria-label={plegados ? m.etiqueta : undefined} onClick={() => elegir(m)}>
                <span className="k-modulo-icono" aria-hidden="true"><Dibujo size={18} strokeWidth={1.75} /></span>
                {!plegados && <span className="k-modulo-nombre">{m.etiqueta}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
