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
//
// Lo que no cabe en la fila no se esconde (regla 7): va a «Más ▾», al final,
// con el título de su grupo. Se mide al pintar y cada vez que cambia el ancho.

import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ContadoresPestanas } from '@/modules/conta/esqueleto/contadoresPestanas'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { ICONOS_NUCLEO } from './iconos'
import type { Boton, PestanaCinta } from './mapa'

/** Lo que se deja libre a la derecha para «Más ▾» cuando hace falta. */
const SITIO_DEL_MAS = 96

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

function BotonCinta({ x, actual, contadores, pulsar, enMenu = false }: {
  x: Boton; actual: string | null; contadores: ContadoresPestanas; pulsar: (b: Boton) => void; enMenu?: boolean
}) {
  const Dibujo = ICONOS_NUCLEO[x.icono]
  const c = x.contador ? contadores[x.contador] : undefined
  return (
    <button type="button" className={enMenu ? 'k-boton k-boton-menu' : 'k-boton'} aria-current={x.id === actual ? 'page' : undefined}
      data-boton={x.id} title={x.llega ? `${x.etiqueta} · ${x.llega}` : undefined} onClick={() => pulsar(x)}>
      <Dibujo size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>{x.etiqueta}</span>
      <Contador c={c} />
      {x.llega && <span className="k-contador" data-tono="llega">{x.llega}</span>}
    </button>
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
  const fila = useRef<HTMLDivElement | null>(null)
  // Cuántos botones caben en la fila (null: todos, sin medir todavía).
  const [caben, setCaben] = useState<number | null>(null)
  const { abierto: masAbierto, setAbierto: setMasAbierto, alternar: alternarMas, caja: masCaja, boton: masBoton } = useDesplegable()
  const clave = `${pestana?.id}|${pestana?.grupos.map((g) => g.botones.map((b) => b.id).join(',')).join('|')}|${plegada}`
  const [medida, setMedida] = useState(clave)
  if (medida !== clave) { setMedida(clave); setCaben(null) }

  // Medir con todos pintados (caben null): el primero que se sale, y desde él, a «Más ▾».
  useLayoutEffect(() => {
    const el = fila.current
    if (!el || caben !== null) return
    const botones = [...el.querySelectorAll<HTMLElement>('.k-cinta-grupo > .k-boton')]
    const ancho = el.clientWidth
    const derecha = (b: HTMLElement) => b.offsetLeft + b.offsetWidth
    if (botones.every((b) => derecha(b) <= ancho)) return
    setCaben(Math.max(0, botones.findIndex((b) => derecha(b) > ancho - SITIO_DEL_MAS)))
  }, [caben, clave])
  // Si cambia el ancho de la fila (la ventana, los módulos plegados), se vuelve a medir.
  const anchoVisto = useRef(0)
  useLayoutEffect(() => {
    const el = fila.current
    if (!el) return
    anchoVisto.current = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === anchoVisto.current) return
      anchoVisto.current = el.clientWidth
      setCaben(null)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [plegada, pestana?.id])

  // Los grupos, partidos entre la fila y «Más ▾».
  let i = 0
  const enFila: { titulo: string; botones: Boton[] }[] = []
  const enMas: { titulo: string; botones: Boton[] }[] = []
  for (const g of pestana?.grupos ?? []) {
    const aqui: Boton[] = []
    const alla: Boton[] = []
    for (const b of g.botones) { (caben === null || i < caben ? aqui : alla).push(b); i += 1 }
    if (aqui.length) enFila.push({ titulo: g.titulo, botones: aqui })
    if (alla.length) enMas.push({ titulo: g.titulo, botones: alla })
  }

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
        <div id="k-cinta-botones" role="tabpanel" aria-labelledby={`k-cinta-${pestana.id}`} className="k-cinta-botones" ref={fila}>
          {enFila.map((g) => (
            <div key={g.titulo} role="group" aria-label={g.titulo} className="k-cinta-grupo">
              {g.botones.map((x) => <BotonCinta key={x.id} x={x} actual={actual} contadores={contadores} pulsar={pulsar} />)}
            </div>
          ))}
          {enMas.length > 0 && (
            <div className="k-desplegable k-cinta-mas" ref={masCaja}>
              <button type="button" ref={masBoton} className="k-boton" aria-expanded={masAbierto} aria-haspopup="true" onClick={alternarMas}>
                Más <ChevronDown size={14} aria-hidden="true" />
              </button>
              {masAbierto && (
                <div className="k-menu k-menu-derecha" role="group" aria-label="Más botones">
                  <div className="k-menu-columna">
                    {enMas.map((g) => (
                      <div key={g.titulo} role="group" aria-label={g.titulo}>
                        <span className="k-menu-titulo">{g.titulo}</span>
                        {g.botones.map((x) => <BotonCinta key={x.id} x={x} actual={actual} contadores={contadores} enMenu
                          pulsar={(b) => { setMasAbierto(false); pulsar(b) }} />)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
