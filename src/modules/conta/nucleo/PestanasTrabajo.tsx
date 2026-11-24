// src/modules/conta/nucleo/PestanasTrabajo.tsx
//
// K03 · Las pestañas de trabajo (maqueta nucleo_1, nucleo_5, nucleo_6): la
// activa en blanco con su filo azul arriba, las demás en gris, el aspa pequeña
// a la derecha del nombre y «+» al final (abre el buscador, para ir a otra
// cosa). Inicio, la primera, fija y sin aspa (decisión 4).
//
//   · Una pestaña con cambios sin guardar se distingue sin abrirla: un punto
//     ámbar delante del nombre (el ámbar de «mira esto» de la maqueta), y el
//     lector lo dice («con cambios sin guardar»).
//   · Cuando no caben en la fila, las que no van a «N más ▾», al final, que
//     dice cuántas son y las lista (regla 7: ninguna se cierra sola). La
//     activa siempre se ve en la fila.
//   · A la derecha, «El mayor · F5»: hace lo mismo que F5 (decisión 10), y
//     dice de qué cuenta, o que no hay ninguna elegida.

import { useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, ChevronDown, Plus, X } from 'lucide-react'
import { useDesplegable } from '@/modules/conta/marco/nuevo/useDesplegable'
import { cuantasCaben } from './pestanas'

export interface PestanaEnFila { id: string; nombre: string; conCambios: boolean; cerrable: boolean }

const SITIO_DEL_MAS = 96

export function PestanasTrabajo({ pestanas, activa, ir, cerrar, abrirOtra, cuenta, abrirMayor }: {
  pestanas: PestanaEnFila[]
  activa: string
  ir: (id: string) => void
  cerrar: (id: string) => void
  abrirOtra: () => void
  /** La cuenta elegida en la pantalla (F5), o null. */
  cuenta: string | null
  abrirMayor: () => void
}) {
  const fila = useRef<HTMLDivElement | null>(null)
  const [enMenu, setEnMenu] = useState<string[]>([])
  const { abierto, setAbierto, alternar, caja, boton } = useDesplegable()
  const clave = `${pestanas.map((p) => `${p.id}:${p.nombre}:${p.conCambios}`).join('|')}|${activa}`

  // Cuántas caben: se miden todas (las del menú también se pintan, escondidas) y se reparte.
  useLayoutEffect(() => {
    const medir = () => {
      const el = fila.current
      if (!el) return
      const nodos = [...el.querySelectorAll<HTMLElement>('[data-pestana-trabajo]')]
      const anchos = nodos.map((n) => n.scrollWidth + 4)
      const disponible = el.clientWidth
      const { enMenu: fuera } = cuantasCaben(anchos, disponible, SITIO_DEL_MAS, pestanas.findIndex((p) => p.id === activa))
      const ids = fuera.map((i) => pestanas[i].id)
      setEnMenu((antes) => (antes.join('|') === ids.join('|') ? antes : ids))
    }
    medir()
    const ro = new ResizeObserver(medir)
    if (fila.current) ro.observe(fila.current)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  const etiqueta = (p: PestanaEnFila) => (p.conCambios ? `${p.nombre}, con cambios sin guardar` : p.nombre)
  const menu = pestanas.filter((p) => enMenu.includes(p.id))
  return (
    <div className="k-trabajo-fila">
      <div className="k-trabajo-pestanas" role="tablist" aria-label="Lo que tienes abierto" ref={fila}>
        {pestanas.map((p) => {
          const sel = p.id === activa
          return (
            <span key={p.id} className="k-trabajo-pestana" data-pestana-trabajo={p.id} data-activa={sel ? "si" : "no"} data-cambios={p.conCambios ? 'si' : 'no'}
              data-en-menu={enMenu.includes(p.id) ? 'si' : undefined} inert={enMenu.includes(p.id) || undefined}>
              <button type="button" role="tab" className="k-trabajo-ir" aria-selected={sel} aria-label={etiqueta(p)}
                title={etiqueta(p)} onClick={() => ir(p.id)}>
                {p.conCambios && <span className="k-trabajo-punto" aria-hidden="true" />}
                <span className="k-trabajo-nombre">{p.nombre}</span>
              </button>
              {p.cerrable && (
                <button type="button" className="k-trabajo-cerrar" aria-label={`Cerrar ${p.nombre}`} title={`Cerrar ${p.nombre}`} onClick={() => cerrar(p.id)}>
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </span>
          )
        })}
        {menu.length > 0 && (
          <div className="k-desplegable" ref={caja}>
            <button type="button" ref={boton} className="k-trabajo-mas-pestanas" aria-expanded={abierto} aria-haspopup="true" onClick={alternar}>
              {menu.length} más <ChevronDown size={14} aria-hidden="true" />
            </button>
            {abierto && (
              <div className="k-menu" role="group" aria-label="Las demás pestañas">
                <div className="k-menu-columna">
                  <span className="k-menu-titulo">No caben en la fila</span>
                  {menu.map((p) => (
                    <div key={p.id} className="k-menu-fila">
                      <button type="button" className="k-menu-item" onClick={() => { setAbierto(false); ir(p.id) }}>
                        <span>{p.conCambios && <span className="k-trabajo-punto" aria-hidden="true" />}{p.nombre}</span>
                        {p.conCambios && <span className="k-menu-nota">sin guardar</span>}
                      </button>
                      {p.cerrable && (
                        <button type="button" className="k-trabajo-cerrar" aria-label={`Cerrar ${p.nombre}`} onClick={() => { setAbierto(false); cerrar(p.id) }}>
                          <X size={13} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <button type="button" className="k-trabajo-mas" aria-label="Abrir otra cosa" title="Abrir otra cosa" onClick={abrirOtra}>
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      <button type="button" className="k-trabajo-mayor" onClick={abrirMayor} aria-keyshortcuts="F5"
        title={cuenta ? `Abre el mayor de la ${cuenta} en otra pestaña` : 'Elige una cuenta (una fila o una casilla con cuenta) para abrir su mayor'}>
        <BookOpen size={14} aria-hidden="true" />
        <span>{cuenta ? `El mayor de la ${cuenta}` : 'El mayor'}</span>
        <kbd className="k-tecla">F5</kbd>
      </button>
    </div>
  )
}
