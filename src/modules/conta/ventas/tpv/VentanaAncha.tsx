// src/modules/conta/ventas/tpv/VentanaAncha.tsx
//
// R06 · La ventana lateral ANCHA de las maquetas 2 y 3: sobre la lista en gris,
// con los pasos arriba (si los hay), dos columnas y el pie con la frase y los
// botones siempre a la vista. Propia: la común (Dialogo lateral) es de 420 px y
// apila los botones. Se porta como la común: Escape y el fondo la cierran, el
// foco entra dentro y vuelve adonde estaba, y Tab no se escapa por detrás.
// Estilos en estilo/tpv.css.

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Boton } from '@/modules/conta/diseno'

const ENFOCABLES = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

export function VentanaAncha({ titulo, pasos, paso, izquierda, derecha, frase, acciones, alCerrar, reparto }: {
  titulo: string
  /** Los pasos de arriba, si los hay; `paso` es el de ahora (desde 1). */
  pasos?: readonly string[]
  paso?: number
  izquierda: ReactNode
  derecha?: ReactNode
  frase?: ReactNode
  acciones: ReactNode
  alCerrar: () => void
  /** Cómo se reparten las dos columnas: la de «Subir» (55/45) o la de las formas de pago (58/42). */
  reparto?: 'subir' | 'formas'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const cerrar = useRef(alCerrar)
  const id = useId()
  useEffect(() => { cerrar.current = alCerrar }, [alCerrar])
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null
    const caja = ref.current
    const enfocables = () => Array.from(caja?.querySelectorAll<HTMLElement>(ENFOCABLES) ?? [])
    ;(caja?.querySelector<HTMLElement>('[data-autofocus]') ?? caja)?.focus()   // la ventana misma: lo de dentro aún se está leyendo
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (e.defaultPrevented) return; e.stopPropagation(); cerrar.current(); return }
      if (e.key !== 'Tab') return
      const l = enfocables()
      if (!l.length) return
      if (e.shiftKey && document.activeElement === l[0]) { e.preventDefault(); l[l.length - 1].focus() }
      else if (!e.shiftKey && document.activeElement === l[l.length - 1]) { e.preventDefault(); l[0].focus() }
    }
    window.addEventListener('keydown', tecla)
    return () => { window.removeEventListener('keydown', tecla); previo?.focus() }
  }, [])
  return (
    <div className="tpv-velo cx" onMouseDown={(e) => { if (e.target === e.currentTarget) alCerrar() }}>
      <div className="tpv-ventana" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        <div className="tpv-cabeza">
          <h2 id={id} className="tpv-titulo">{titulo}</h2>
          {pasos && (
            <ol className="tpv-pasos" aria-label="Pasos">
              {pasos.map((p, i) => (
                <li key={p} className="tpv-paso" aria-current={paso === i + 1 ? 'step' : undefined}>
                  {i > 0 && <span className="tpv-paso-raya" aria-hidden="true" />}
                  <span className="tpv-paso-num" aria-hidden="true">{i + 1}</span>
                  <span className="tpv-paso-texto">{p}</span>
                </li>
              ))}
            </ol>
          )}
          <Boton variante="fantasma" icono="cerrar" className="tpv-cerrar" aria-label="Cerrar" onClick={alCerrar}>{''}</Boton>
        </div>
        <div className={derecha ? 'tpv-cuerpo' : 'tpv-cuerpo tpv-cuerpo-solo'} data-reparto={reparto}>
          <div className="tpv-izq">{izquierda}</div>
          {derecha && <div className="tpv-der">{derecha}</div>}
        </div>
        <div className="tpv-pie">
          {frase ? <p className="tpv-pie-frase">{frase}</p> : <span className="tpv-pie-frase" />}
          {acciones}
        </div>
      </div>
    </div>
  )
}
