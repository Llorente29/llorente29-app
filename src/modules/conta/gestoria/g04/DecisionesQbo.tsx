// src/modules/conta/gestoria/g04/DecisionesQbo.tsx
//
// Q08 · Paso 2 · «Cargar decisiones de QBO», en la pantalla de Clientes que
// monta la ruta (la G04). El #800 lo puso en ClientesCuotas.tsx, la pantalla de
// antes, que ya no monta ninguna ruta: en producción no se veía (Julio, 25/11).
//
// El botón va arriba, al lado de «Exportar»; lo que ha pasado, debajo de la
// cabecera: la frase con sus números (regla 8) y, fila a fila, lo que no se ha
// atado con su porqué (regla 7: nada se calla). El Excel se lee en el
// navegador y no pasa por el repositorio (T11). Solo pinta: lo que se hace al
// elegir el fichero lo decide la página.

import { useRef } from 'react'
import type { Linea } from '@/modules/conta/gestoria/decisionesQbo'

export interface EstadoDecisiones {
  cargando: boolean
  /** La frase de lo que ha pasado (o el porqué del fallo), y si salió bien. */
  aviso: { ok: boolean; texto: string } | null
  lineas: Linea[] | null
}

export function BotonDecisionesQbo({ cargando, alElegir }: { cargando: boolean; alElegir: (f: File) => void }) {
  const fichero = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className="g4-boton" onClick={() => fichero.current?.click()} disabled={cargando}>
        {cargando ? 'Cargando las decisiones de QBO…' : 'Cargar decisiones de QBO'}
      </button>
      <input ref={fichero} type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="El Excel de QBO con sus decisiones"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) alElegir(f); e.target.value = '' }} />
    </>
  )
}

const noAtada = (l: Linea) => l.resultado !== 'atado' && l.resultado !== 'solo'

export function ResultadoDecisionesQbo({ aviso, lineas }: EstadoDecisiones) {
  if (!aviso) return null
  const sin = (lineas ?? []).filter(noAtada)
  return (
    <section className="g4-decisiones" aria-label="Las decisiones de QBO" data-prueba="decisiones-qbo">
      <p className="g4-decisiones-frase" data-tono={aviso.ok ? 'bien' : 'mal'} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p>
      {sin.length > 0 && (
        <details className="cxg-decisiones" open>
          <summary>Lo que no se ha atado ({sin.length})</summary>
          <ul>
            {sin.map((l) => <li key={l.fila} data-resultado={l.resultado}><strong>{l.cliente}</strong> ({l.emisor}, fila {l.fila}): {l.frase}</li>)}
          </ul>
        </details>
      )}
    </section>
  )
}
