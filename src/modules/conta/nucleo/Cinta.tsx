// src/modules/conta/nucleo/Cinta.tsx
//
// K02 · La cinta del núcleo (maqueta nucleo_1 y nucleo_3): las pestañas en una
// línea, sobre el azul, con la elegida en blanco; a la derecha, «Plegar los
// botones ▴» o «Ver los botones ▾». Debajo, en blanco, los botones de la
// pestaña elegida, en grupos separados por una raya, cada uno con su icono y,
// si lo lleva, su contador. El botón de la pantalla abierta, marcado.
//
// Cambiar de pestaña no cambia de pantalla (como en ERP10): solo enseña otros
// botones. Pulsar un botón abre su pantalla.

import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ContadoresPestanas } from '@/modules/conta/esqueleto/contadoresPestanas'
import { ICONOS_NUCLEO } from './iconos'
import type { Boton, PestanaCinta } from './mapa'

function Contador({ c }: { c: ContadoresPestanas[string] }) {
  if (!c) return null
  // Lo que suma dos cosas («por revisar» y «por aclarar»), cada una en su contador, como hoy.
  const partes = c.partes ?? [{ n: c.n, frase: c.frase }]
  return (
    <>
      {partes.map((x) => <span key={x.frase} className="k-contador" data-tono={c.tono} title={x.frase} aria-hidden="true">{x.n}</span>)}
      <span className="k-oculto">{` · ${c.frase}`}</span>
    </>
  )
}

export function Cinta({ pestanas, elegida, elegir, plegada, alternarPlegada, actual, contadores, pulsar }: {
  pestanas: PestanaCinta[]
  elegida: string
  elegir: (id: string) => void
  plegada: boolean
  alternarPlegada: () => void
  /** El id del botón de la pantalla abierta. */
  actual: string | null
  contadores: ContadoresPestanas
  pulsar: (b: Boton) => void
}) {
  const pestana = pestanas.find((p) => p.id === elegida) ?? pestanas[0]
  return (
    <div className="k-cinta" data-plegada={plegada ? 'si' : 'no'}>
      <div className="k-cinta-pestanas">
        <div role="tablist" aria-label="La cinta" className="k-cinta-lista">
          {pestanas.map((p) => (
            <button key={p.id} type="button" role="tab" id={`k-cinta-${p.id}`} aria-selected={p.id === pestana?.id}
              aria-controls="k-cinta-botones" className="k-cinta-pestana" onClick={() => elegir(p.id)}>{p.etiqueta}</button>
          ))}
        </div>
        <button type="button" className="k-cinta-plegar" aria-expanded={!plegada} onClick={alternarPlegada}>
          {plegada ? <>Ver los botones <ChevronDown size={14} aria-hidden="true" /></> : <>Plegar los botones <ChevronUp size={14} aria-hidden="true" /></>}
        </button>
      </div>
      {!plegada && pestana && (
        <div id="k-cinta-botones" role="tabpanel" aria-labelledby={`k-cinta-${pestana.id}`} className="k-cinta-botones">
          {pestana.grupos.map((g) => (
            <div key={g.titulo} role="group" aria-label={g.titulo} className="k-cinta-grupo">
              {g.botones.map((x) => {
                const Dibujo = ICONOS_NUCLEO[x.icono]
                const c = x.contador ? contadores[x.contador] : undefined
                return (
                  <button key={x.id} type="button" className="k-boton" aria-current={x.id === actual ? 'page' : undefined}
                    data-boton={x.id} title={x.llega ? `${x.etiqueta} · ${x.llega}` : undefined} onClick={() => pulsar(x)}>
                    <Dibujo size={16} strokeWidth={1.75} aria-hidden="true" />
                    <span>{x.etiqueta}</span>
                    <Contador c={c} />
                    {x.llega && <span className="k-contador" data-tono="llega">{x.llega}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
