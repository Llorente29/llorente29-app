// src/modules/conta/nucleo/piezas/Lineas.tsx
//
// K12 · Pieza común 12 (del concepto): las líneas que se repiten (contrapartidas, pagos, cobros, los apuntes de un
// asiento), una por fila. La lista ocupa el alto que le deja su bloque y, desde la quinta, se desplaza dentro: la
// pantalla no crece. Debajo, la línea que se edita (`edicion`, como ERP10) y el pie: «⊕ otra línea» con su número a la
// izquierda y la suma de control a la derecha (`suma`), en ámbar si no cuadra.

import type { ReactNode } from 'react'
import { BotonMas } from './Ventana'
import { cuantasLineas, seDesplaza } from './logica'

export interface Columna { clave: string; titulo: ReactNode; ancho?: string; cifra?: boolean; className?: string }

export function Lineas<T>({ etiqueta, columnas, filas, celda, elegida, alElegir, edicion, otra, suma, vacia }: {
  etiqueta: string; columnas: readonly Columna[]; filas: readonly T[]
  celda: (f: T, clave: string, i: number) => ReactNode
  elegida: number | null; alElegir?: (i: number) => void
  edicion?: ReactNode
  /** «⊕ otra línea»: qué hace (sin él, no sale el botón, pero sí el número de líneas). */
  otra?: () => void
  suma?: ReactNode
  vacia?: ReactNode
}) {
  return (
    <div className="kp-lineas" data-pieza="lineas" data-desplaza={seDesplaza(filas.length) ? 'si' : undefined}>
      <div className="kp-lineas-marco">
        <div className="kp-lineas-lista">
          <table aria-label={etiqueta}>
            <colgroup>{columnas.map((c) => <col key={c.clave} style={c.ancho ? { width: c.ancho } : undefined} />)}</colgroup>
            <thead><tr>{columnas.map((c) => <th key={c.clave} className={`${c.cifra ? 'kp-num ' : ''}${c.className ?? ''}`.trim() || undefined}>{c.titulo}</th>)}</tr></thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i} aria-selected={elegida === i} tabIndex={alElegir ? 0 : undefined}
                  onClick={alElegir ? () => alElegir(i) : undefined}
                  onKeyDown={alElegir ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); alElegir(i) } } : undefined}>
                  {columnas.map((c) => <td key={c.clave} className={`${c.cifra ? 'kp-num ' : ''}${c.className ?? ''}`.trim() || undefined}>{celda(f, c.clave, i)}</td>)}
                </tr>
              ))}
              {filas.length === 0 && vacia && <tr><td colSpan={columnas.length} className="kp-lineas-vacia">{vacia}</td></tr>}
            </tbody>
          </table>
        </div>
        {edicion && <div className="kp-lineas-edicion">{edicion}</div>}
      </div>
      <div className="kp-lineas-pie">
        <span className="kp-lineas-otra">
          {otra ? <BotonMas etiqueta="Otra línea" hacer={otra} texto={`otra línea · ${cuantasLineas(filas.length)}`} />
            : <span className="kp-lineas-cuantas">{cuantasLineas(filas.length)}</span>}
        </span>
        {suma}
      </div>
    </div>
  )
}
